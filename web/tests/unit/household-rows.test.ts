//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Row assignment for the SAWS 2 PLUS Q6 adult and child tables.
 *
 * Each test names the specific way a person used to end up in the wrong printed
 * row. "Appears somewhere on page 3" is deliberately never asserted — that is
 * what allowed the misplacements to go unnoticed.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { planHouseholdRows, tableForMember } from '@/lib/household-rows';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

/** Fixed "today" so an age assertion never depends on when the suite runs. */
const TODAY = new Date('2026-08-11T00:00:00Z');

function member(overrides: Partial<HouseholdMember>): HouseholdMember {
  return {
    id: overrides.id ?? 'm',
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    relationshipToApplicant: '',
    ...overrides,
  };
}

function application(
  overrides: Partial<Saws2PlusApplicationData> = {},
): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-03-04',
    },
    householdMembers: [],
    ...overrides,
  };
}

/** The row a canonical prefix was assigned, straight from the field plan. */
function assignedRow(
  data: Saws2PlusApplicationData,
  prefix: string,
): { table: unknown; row: unknown } {
  const plan = buildApplicationFieldPlan(data, {});
  const find = (key: string) => plan.find((e) => e.key === key)?.value;

  return {
    table: find(`${prefix}.table`),
    row: find(`${prefix}.table_row`),
  };
}

describe('applicant placement', () => {
  it('gives the applicant the first adult row', () => {
    const plan = planHouseholdRows(application(), TODAY);

    expect(plan.adults[0].isApplicant).toBe(true);
    expect(plan.adults[0].row).toBe(0);
  });

  it('keeps the applicant in row 0 even with no name entered yet', () => {
    // The adapter used to append the applicant only once a name existed, so an
    // unnamed applicant surrendered row 0 to the spouse.
    const data = application({
      applicant: {
        ...EMPTY_APPLICATION_DATA.applicant,
        firstName: '',
        lastName: '',
        dateOfBirth: '1990-03-04',
      },
      householdMembers: [
        member({ id: 's', firstName: 'Luis', dateOfBirth: '1991-09-02' }),
      ],
    });

    const plan = planHouseholdRows(data, TODAY);

    expect(plan.adults[0].isApplicant).toBe(true);
    expect(plan.adults[1].memberIndex).toBe(0);
    expect(assignedRow(data, 'household.members.0')).toEqual({
      table: 'adult',
      row: 1,
    });
  });

  it('puts a minor applicant in the child table, not the adult table', () => {
    const data = application({
      applicant: {
        ...EMPTY_APPLICATION_DATA.applicant,
        firstName: 'Sam',
        lastName: 'Reyes',
        dateOfBirth: '2012-01-01',
      },
    });

    const plan = planHouseholdRows(data, TODAY);

    expect(plan.adults).toHaveLength(0);
    expect(plan.children[0].isApplicant).toBe(true);
    expect(plan.children[0].row).toBe(0);
    // A minor applicant keeps the single applicant detail namespace.
    expect(plan.children[0].detailsPrefix).toBe('applicant.household');
  });
});

describe('adult ordering', () => {
  it('places applicant then spouse in consecutive adult rows', () => {
    const data = application({
      householdMembers: [
        member({
          id: 's',
          firstName: 'Luis',
          lastName: 'Delgado',
          dateOfBirth: '1991-09-02',
          relationshipToApplicant: 'Spouse',
        }),
      ],
    });

    const plan = planHouseholdRows(data, TODAY);

    expect(plan.adults.map((a) => a.row)).toEqual([0, 1]);
    expect(plan.adults[1].prefix).toBe('household.members.0');
    expect(plan.adults[1].detailsPrefix).toBe('household.members.0.adult');
  });

  it('numbers multiple adults in stable application order', () => {
    const data = application({
      householdMembers: [
        member({ id: 'a', firstName: 'Luis', dateOfBirth: '1991-09-02' }),
        member({ id: 'b', firstName: 'Rosa', dateOfBirth: '1965-04-10' }),
        member({ id: 'c', firstName: 'Toni', dateOfBirth: '2000-12-01' }),
      ],
    });

    const plan = planHouseholdRows(data, TODAY);

    expect(plan.adults.map((a) => [a.memberIndex, a.row])).toEqual([
      [null, 0],
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('does not shift adults when a child exists between them', () => {
    // Child at array index 0 must not consume adult row 1.
    const data = application({
      householdMembers: [
        member({ id: 'kid', firstName: 'Sofia', dateOfBirth: '2024-06-15' }),
        member({ id: 'spouse', firstName: 'Luis', dateOfBirth: '1991-09-02' }),
      ],
    });

    const plan = planHouseholdRows(data, TODAY);

    expect(plan.adults.map((a) => [a.memberIndex, a.row])).toEqual([
      [null, 0],
      [1, 1],
    ]);
    expect(plan.children.map((c) => [c.memberIndex, c.row])).toEqual([[0, 0]]);
  });

  it('keeps an adult in the same row when an unrelated child is added', () => {
    const spouse = member({
      id: 'spouse',
      firstName: 'Luis',
      dateOfBirth: '1991-09-02',
    });

    const before = planHouseholdRows(
      application({ householdMembers: [spouse] }),
      TODAY,
    );

    const after = planHouseholdRows(
      application({
        householdMembers: [
          spouse,
          member({ id: 'kid', firstName: 'Sofia', dateOfBirth: '2024-06-15' }),
        ],
      }),
      TODAY,
    );

    expect(before.adults[1].row).toBe(1);
    expect(after.adults[1].row).toBe(1);
    expect(after.adults[1].prefix).toBe(before.adults[1].prefix);
  });

  it('gives every person a distinct row within their table', () => {
    const data = application({
      householdMembers: [
        member({ id: 'a', firstName: 'Luis', dateOfBirth: '1991-09-02' }),
        member({ id: 'b', firstName: 'Rosa', dateOfBirth: '1965-04-10' }),
        member({ id: 'c', firstName: 'Sofia', dateOfBirth: '2024-06-15' }),
        member({ id: 'd', firstName: 'Mateo', dateOfBirth: '2019-02-02' }),
      ],
    });

    const plan = planHouseholdRows(data, TODAY);

    expect(new Set(plan.adults.map((a) => a.row)).size).toBe(
      plan.adults.length,
    );
    expect(new Set(plan.children.map((c) => c.row)).size).toBe(
      plan.children.length,
    );
  });
});

describe('adult / child classification', () => {
  it('uses a stated age when no date of birth exists', () => {
    // "me and my one year old": intake knows the age, never a birth date. The
    // adapter read only the date, got nothing, and filed the child as an adult.
    const child = member({ id: 'k', age: 1 });

    expect(tableForMember(child, TODAY)).toBe('child');
  });

  it('keeps an age-only adult in the adult table', () => {
    expect(tableForMember(member({ id: 'a', age: 34 }), TODAY)).toBe('adult');
  });

  it('prefers the date of birth over a stale stated age', () => {
    const stale = member({ id: 'x', age: 12, dateOfBirth: '1985-01-01' });

    expect(tableForMember(stale, TODAY)).toBe('adult');
  });

  it('treats the 18th birthday as adult', () => {
    expect(
      tableForMember(member({ id: 'x', dateOfBirth: '2008-08-11' }), TODAY),
    ).toBe('adult');
    expect(
      tableForMember(member({ id: 'y', dateOfBirth: '2008-08-12' }), TODAY),
    ).toBe('child');
  });

  it('records why an unknown age was placed in the adult table', () => {
    const data = application({
      householdMembers: [member({ id: 'unknown' })],
    });

    const plan = planHouseholdRows(data, TODAY);

    expect(plan.adults[1].basis).toBe('unknown_age_defaults_to_adult');
  });
});

describe('canonical field plan', () => {
  it('states each member exists even before their name is entered', () => {
    // Presence used to be inferred from a non-empty first name, so an unnamed
    // member truncated the adapter's discovery loop and deleted every member
    // after them.
    const data = application({
      householdMembers: [
        member({ id: 'unnamed', dateOfBirth: '1991-09-02' }),
        member({ id: 'named', firstName: 'Rosa', dateOfBirth: '1965-04-10' }),
      ],
    });

    const plan = buildApplicationFieldPlan(data, {});

    expect(
      plan.find((e) => e.key === 'household.members.0.present')?.value,
    ).toBe(true);
    expect(
      plan.find((e) => e.key === 'household.members.1.present')?.value,
    ).toBe(true);
    expect(plan.find((e) => e.key === 'household.members.count')?.value).toBe(2);
    expect(assignedRow(data, 'household.members.1')).toEqual({
      table: 'adult',
      row: 2,
    });
  });

  it('publishes the applicant row assignment', () => {
    expect(assignedRow(application(), 'applicant')).toEqual({
      table: 'adult',
      row: 0,
    });
  });

  it('counts each table separately', () => {
    const data = application({
      householdMembers: [
        member({ id: 'spouse', dateOfBirth: '1991-09-02' }),
        member({ id: 'kid', age: 3 }),
      ],
    });

    const plan = buildApplicationFieldPlan(data, {});

    expect(plan.find((e) => e.key === 'household.adult_rows.count')?.value).toBe(
      2,
    );
    expect(plan.find((e) => e.key === 'household.child_rows.count')?.value).toBe(
      1,
    );
  });
});
