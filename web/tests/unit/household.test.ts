//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Unit tests for household composition and derived household size.
 *
 * Contract: household size is never asked for. Before the application flow it
 * comes from the intake household answer; once structured members exist it is
 * the applicant plus those member rows, recomputed on read so it cannot drift.
 */
import { describe, it, expect } from 'vitest';

import {
  buildHouseholdMemberPrefill,
  householdSizeFromMembers,
  parseHouseholdComposition,
} from '@/lib/household';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { EMPTY_APPLICATION_DATA, type HouseholdMember } from '@/types/application';

// ---------------------------------------------------------------------------
// Intake household answer
// ---------------------------------------------------------------------------

/**
 * Regression suite for the phrasings people actually type.
 *
 * The reported defect: "me and my 6 year old" derived a household size of 1
 * because an age written as "N year old" was invisible to the parser and the
 * child was never counted. Related failures found while fixing it:
 * "I have a 6 year old child" derived size 7 (the "6" was read as a child
 * count), and "single parent with a 6 year old" derived size 1.
 */
describe('parseHouseholdComposition — natural phrasings', () => {
  const CASES: Array<{
    profile: string;
    size: number;
    adults: number;
    children: number;
    ages: number[];
    members: Array<{ age?: number }>;
  }> = [
    // The exact phrasing that regressed to 1.
    {
      profile: 'me and my 6 year old',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    {
      profile: 'my 6 year old and me',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    {
      profile: 'I have a 6 year old child',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    {
      profile: 'me and my child, age 6',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    {
      profile: 'one adult and one child',
      size: 2, adults: 1, children: 1, ages: [], members: [{}],
    },
    {
      profile: 'single parent with a 6 year old',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    {
      profile: 'myself, my spouse, and our 6 year old',
      size: 3, adults: 2, children: 1, ages: [6], members: [{}, { age: 6 }],
    },
    {
      profile: 'me and my two kids, ages 4 and 8',
      size: 3, adults: 1, children: 2, ages: [4, 8], members: [{ age: 4 }, { age: 8 }],
    },
    // Hyphenated and abbreviated age spellings.
    {
      profile: 'Me and my 6-year-old',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    {
      profile: 'just me and my 6 yo',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    {
      profile: 'me and my 6 yrs old son',
      size: 2, adults: 1, children: 1, ages: [6], members: [{ age: 6 }],
    },
    // Two children described individually by age.
    {
      profile: 'me, my 6 year old son and my 9 year old daughter',
      size: 3, adults: 1, children: 2, ages: [6, 9], members: [{ age: 6 }, { age: 9 }],
    },
    // An adult dependent stated by age is an adult, not a child.
    {
      profile: 'me and my 20 year old',
      size: 2, adults: 2, children: 0, ages: [20], members: [{ age: 20 }],
    },
  ];

  for (const expected of CASES) {
    it(`derives ${expected.size} for ${JSON.stringify(expected.profile)}`, () => {
      const result = parseHouseholdComposition(expected.profile);

      expect(result.size).toBe(expected.size);
      expect(result.adults).toBe(expected.adults);
      expect(result.children).toBe(expected.children);
      expect(result.ages).toEqual(expected.ages);
      expect(buildHouseholdMemberPrefill(result)).toEqual(expected.members);
    });
  }

  it('counts the applicant exactly once however often they are named', () => {
    // "me" and "I" both refer to the applicant — one person, not two.
    const result = parseHouseholdComposition('me and my 6 year old, I am the parent');

    expect(result.size).toBe(2);
    expect(result.people.filter((person) => person.role === 'applicant')).toHaveLength(1);
  });

  it('never reads an age as a person count', () => {
    // The "6" belongs to the age, not to the number of children.
    expect(parseHouseholdComposition('I have a 6 year old child').children).toBe(1);
    expect(parseHouseholdComposition('a 12 year old kid and me').children).toBe(1);
  });

  it('always includes the applicant when only dependents are named', () => {
    expect(parseHouseholdComposition('my 6 year old').size).toBe(2);
    expect(parseHouseholdComposition('one child').size).toBe(2);
    expect(parseHouseholdComposition('two kids, ages 4 and 8').size).toBe(3);
  });

  it('does not add an extra applicant when adults are already counted', () => {
    // "two adults" includes the applicant — the household is 2, not 3.
    expect(parseHouseholdComposition('two adults').size).toBe(2);
    expect(parseHouseholdComposition('one adult and one child').size).toBe(2);
  });

  it('marks exactly one applicant in every parse', () => {
    for (const profile of [
      '',
      'just me, 41',
      'me and my 6 year old',
      'Two adults, ages 32 and 30, and two children, ages 4 and 8.',
      'myself, my spouse, and our 6 year old',
      '3 people',
    ]) {
      const applicants = parseHouseholdComposition(profile).people.filter(
        (person) => person.role === 'applicant',
      );

      expect(applicants, profile).toHaveLength(1);
    }
  });

  it('settles an unstated plural count from the ages that follow it', () => {
    const result = parseHouseholdComposition('me and my kids, ages 4, 8 and 12');

    expect(result.children).toBe(3);
    expect(result.size).toBe(4);
    expect(result.ages).toEqual([4, 8, 12]);
  });

  it('reads a bare trailing age list positionally', () => {
    expect(parseHouseholdComposition('just me, 20').ages).toEqual([20]);
    expect(parseHouseholdComposition('me and my son, 34 and 7').ages).toEqual([34, 7]);
  });
});

describe('parseHouseholdComposition', () => {
  it('parses adults, children, and ages from the guided example answer', () => {
    const result = parseHouseholdComposition(
      'Two adults, ages 32 and 30, and two children, ages 4 and 8.',
    );

    expect(result.adults).toBe(2);
    expect(result.children).toBe(2);
    expect(result.size).toBe(4);
    expect(result.ages).toEqual([32, 30, 4, 8]);
  });

  it('treats a single-person answer as a household of one', () => {
    const result = parseHouseholdComposition('just me, 20');

    expect(result.size).toBe(1);
    expect(result.adults).toBe(1);
    expect(result.children).toBe(0);
    expect(result.ages).toEqual([20]);
  });

  it('does not mistake a child count for an age', () => {
    const result = parseHouseholdComposition('Single parent with 2 kids ages 4 and 9');

    expect(result.adults).toBe(1);
    expect(result.children).toBe(2);
    expect(result.size).toBe(3);
    expect(result.ages).toEqual([4, 9]);
  });

  it('counts a spouse as a second adult', () => {
    expect(parseHouseholdComposition('Me and my wife').size).toBe(2);
  });

  it('flags pregnancy, disability, and veteran status', () => {
    const result = parseHouseholdComposition(
      'Me and my pregnant spouse; I am a disabled veteran',
    );

    expect(result.pregnant).toBe(true);
    expect(result.disability).toBe(true);
    expect(result.veteran).toBe(true);
  });

  it('never returns a household size below 1', () => {
    expect(parseHouseholdComposition('').size).toBe(1);
    expect(parseHouseholdComposition(undefined).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Derived size from structured members
// ---------------------------------------------------------------------------

describe('householdSizeFromMembers', () => {
  it('counts the primary applicant plus each member row', () => {
    expect(householdSizeFromMembers(0)).toBe(1);
    expect(householdSizeFromMembers(1)).toBe(2);
    expect(householdSizeFromMembers(4)).toBe(5);
  });

  it('clamps invalid counts to the applicant alone', () => {
    expect(householdSizeFromMembers(-3)).toBe(1);
    expect(householdSizeFromMembers(Number.NaN)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Member prefill from intake
// ---------------------------------------------------------------------------

describe('buildHouseholdMemberPrefill', () => {
  it('creates one row per additional member, excluding the applicant', () => {
    const rows = buildHouseholdMemberPrefill(
      parseHouseholdComposition(
        'Two adults, ages 32 and 30, and two children, ages 4 and 8.',
      ),
    );

    expect(rows).toHaveLength(3);
    // The first adult age is the applicant's; the rest map in order.
    expect(rows).toEqual([{ age: 30 }, { age: 4 }, { age: 8 }]);
  });

  it('returns no rows for a single-person household', () => {
    expect(buildHouseholdMemberPrefill(parseHouseholdComposition('just me, 41'))).toEqual([]);
  });

  it('attaches each stated age to the person it was given for', () => {
    const rows = buildHouseholdMemberPrefill(
      parseHouseholdComposition('Single parent with 2 kids ages 4 and 9'),
    );

    // The applicant's age was not stated, but both children's were, and they
    // belong to the child rows — not to whichever row came first.
    expect(rows).toEqual([{ age: 4 }, { age: 9 }]);
  });

  it('omits the age for a person the answer did not give one for', () => {
    const rows = buildHouseholdMemberPrefill(
      parseHouseholdComposition('me, my spouse, and our 6 year old'),
    );

    expect(rows).toEqual([{}, { age: 6 }]);
  });

  it('never invents names or dates of birth', () => {
    const rows = buildHouseholdMemberPrefill(
      parseHouseholdComposition('Two adults, ages 32 and 30'),
    );

    for (const row of rows) {
      expect(row.dateOfBirth).toBeUndefined();
      expect(Object.keys(row).every((key) => key === 'age' || key === 'dateOfBirth')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Derived size flows into the canonical SAWS field plan
// ---------------------------------------------------------------------------

function member(id: string): HouseholdMember {
  return {
    id,
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    relationshipToApplicant: '',
  };
}

function planValue(members: HouseholdMember[]): unknown {
  const plan = buildApplicationFieldPlan({
    ...EMPTY_APPLICATION_DATA,
    householdMembers: members,
  });

  return plan.find((field) => field.key === 'household.size')?.value;
}

describe('household.size in the SAWS 2 PLUS field plan', () => {
  it('is 1 when the applicant is the only person', () => {
    expect(planValue([])).toBe(1);
  });

  it('tracks members as they are added', () => {
    expect(planValue([member('a')])).toBe(2);
    expect(planValue([member('a'), member('b'), member('c')])).toBe(4);
  });

  it('tracks members as they are removed', () => {
    const members = [member('a'), member('b'), member('c')];
    expect(planValue(members)).toBe(4);
    expect(planValue(members.filter((m) => m.id !== 'b'))).toBe(3);
  });

  it('is not duplicated anywhere else in the plan', () => {
    const plan = buildApplicationFieldPlan({
      ...EMPTY_APPLICATION_DATA,
      householdMembers: [member('a')],
    });

    const sizeKeys = plan.filter((field) => field.key === 'household.size');
    expect(sizeKeys).toHaveLength(1);
  });
});
