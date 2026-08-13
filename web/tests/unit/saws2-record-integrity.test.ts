//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Regression coverage for the questionnaire record layer.
 *
 * Two defects are pinned here:
 *
 * 1. `writePath` turned an array into an object keyed by "0" when writing
 *    through an array index. The planner emits exactly such paths for a missing
 *    field inside a record (`income.earned.entries.0.employerName`), so the first
 *    keystroke corrupted `entries` and the next planner run threw
 *    "entries.forEach is not a function".
 * 2. The planner assumed `entries` was always an array. It is now normalized at
 *    the boundary, and a non-array is treated as no records — never reinterpreted
 *    as record data.
 *
 * Plus the person-scoped Add contract: records are created with a real member id
 * chosen from the household, and no placeholder person ever reaches the PDF.
 */
import { describe, it, expect } from 'vitest';

import { buildInitialApplicationData } from '@/lib/application-data';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  activeEntries,
  allowsMultiplePerPerson,
  getRequiredApplicationQuestions,
  isPersonScoped,
  RECORD_SCOPES,
  readPath,
  safeEntries,
  selectableMembers,
  writePath,
} from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';
import { APPLICANT_MEMBER_ID } from '@/types/saws-questionnaire';

function set(
  data: Saws2PlusApplicationData,
  path: string,
  value: unknown,
): Saws2PlusApplicationData {
  return { ...data, questionnaire: writePath(data.questionnaire, path, value) };
}

/** Applicant + a named spouse + an unnamed child. */
function household(): Saws2PlusApplicationData {
  let n = 0;
  const data = buildInitialApplicationData(
    {
      zipCode: '90001',
      city: 'Los Angeles',
      state: 'CA',
      county: 'Los Angeles',
      preferredLanguage: 'English',
      householdProfile: 'me, my spouse, and our one year old',
      householdSize: 3,
      householdMembers: [{ age: 34 }, { age: 1 }],
      annualHouseholdIncome: 32000,
      incomeType: '',
      existingBenefits: '',
    },
    () => `member-${++n}`,
  );

  return {
    ...data,
    applicant: {
      ...data.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1993-04-12',
    },
    householdMembers: [
      {
        ...data.householdMembers[0],
        firstName: 'Luis',
        lastName: 'Delgado',
        relationshipToApplicant: 'Spouse',
      },
      // Deliberately unnamed: the UI must label it without inventing a name.
      { ...data.householdMembers[1], relationshipToApplicant: 'Daughter' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1–3. Malformed entries
// ---------------------------------------------------------------------------

describe('malformed entries cannot crash the planner', () => {
  const MALFORMED: Array<[string, unknown]> = [
    ['object keyed by index', { 0: { id: 'j1', memberId: 'applicant', employerName: 'X' } }],
    ['empty object', {}],
    ['string', 'Acme Diner'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['boolean', true],
  ];

  for (const [label, value] of MALFORMED) {
    it(`survives ${label} in income.earned.entries`, () => {
      let data = set(household(), 'income.earned.answer', true);
      data = set(data, 'income.earned.entries', value);

      expect(() => getRequiredApplicationQuestions(data)).not.toThrow();
    });

    it(`treats ${label} as no active records`, () => {
      let data = set(household(), 'income.earned.answer', true);
      data = set(data, 'income.earned.entries', value);

      expect(activeEntries(data.questionnaire.income.earned)).toEqual([]);

      // Nothing is fabricated into the field plan either.
      const keys = buildApplicationFieldPlan(data).map((field) => field.key);
      expect(keys.filter((key) => key.startsWith('income.earned.'))).toEqual([]);
    });
  }

  it('asks for a record again when the entries value is unusable', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', { 0: { employerName: 'X' } });

    const ids = getRequiredApplicationQuestions(data).outstanding.map((q) => q.id);

    // Yes with no usable records behaves like Yes with an empty list.
    expect(ids).toContain('income.earned.records');
  });

  it('never reinterprets an object or string as record data', () => {
    expect(safeEntries({ 0: { employerName: 'X' } })).toEqual([]);
    expect(safeEntries('Acme')).toEqual([]);
    expect(safeEntries(7)).toEqual([]);
    expect(safeEntries(null)).toEqual([]);
  });

  it('survives a malformed value in every repeatable section', () => {
    for (const entriesPath of Object.keys(RECORD_SCOPES)) {
      const sectionPath = entriesPath.replace(/\.entries$/, '');
      let data = set(household(), `${sectionPath}.answer`, true);
      data = set(data, entriesPath, { 0: {} });

      expect(
        () => getRequiredApplicationQuestions(data),
        entriesPath,
      ).not.toThrow();
      expect(() => buildApplicationFieldPlan(data), entriesPath).not.toThrow();
    }
  });

  it('tolerates a null record inside an otherwise valid array', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      null,
      { id: 'j1', memberId: APPLICANT_MEMBER_ID, employerName: 'Acme' },
    ]);

    expect(() => getRequiredApplicationQuestions(data)).not.toThrow();
  });
});

describe('valid arrays behave exactly as before', () => {
  it('keeps a well-formed record active and mapped', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      {
        id: 'j1',
        memberId: APPLICANT_MEMBER_ID,
        employerName: 'Acme Diner',
        employerAddress: '',
        employerPhone: '',
        startDate: '',
        hoursPerWeek: 30,
      },
    ]);

    expect(activeEntries(data.questionnaire.income.earned)).toHaveLength(1);

    const plan = new Map(
      buildApplicationFieldPlan(data).map((field) => [field.key, field.value]),
    );
    expect(plan.get('income.earned.0.employer_name')).toBe('Acme Diner');
    expect(plan.get('income.earned.0.hours_per_week')).toBe(30);
  });

  it('still hides records behind a No gateway', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId: APPLICANT_MEMBER_ID, employerName: 'Acme' },
    ]);
    data = set(data, 'income.earned.answer', false);

    expect(activeEntries(data.questionnaire.income.earned)).toEqual([]);
    expect(data.questionnaire.income.earned.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The writePath source fix
// ---------------------------------------------------------------------------

describe('writePath preserves arrays', () => {
  it('keeps entries an array when writing through an index', () => {
    let questionnaire = writePath(
      EMPTY_APPLICATION_DATA.questionnaire,
      'income.earned.answer',
      true,
    );
    questionnaire = writePath(questionnaire, 'income.earned.entries', [
      { id: 'j1', memberId: APPLICANT_MEMBER_ID, employerName: '' },
    ]);

    // The exact path the planner emits for a missing required field.
    const updated = writePath(
      questionnaire,
      'income.earned.entries.0.employerName',
      'Acme Diner',
    );

    const entries = readPath(updated, 'income.earned.entries');
    expect(Array.isArray(entries)).toBe(true);
    expect((entries as Array<{ employerName: string }>)[0].employerName).toBe(
      'Acme Diner',
    );
  });

  it('does not disturb sibling records', () => {
    let questionnaire = writePath(
      EMPTY_APPLICATION_DATA.questionnaire,
      'income.earned.entries',
      [
        { id: 'a', memberId: APPLICANT_MEMBER_ID, employerName: 'First' },
        { id: 'b', memberId: APPLICANT_MEMBER_ID, employerName: 'Second' },
      ],
    );

    questionnaire = writePath(
      questionnaire,
      'income.earned.entries.1.employerName',
      'Changed',
    );

    const entries = readPath(questionnaire, 'income.earned.entries') as Array<{
      employerName: string;
    }>;

    expect(entries).toHaveLength(2);
    expect(entries[0].employerName).toBe('First');
    expect(entries[1].employerName).toBe('Changed');
  });

  it('round-trips the full planner → write → planner cycle without throwing', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId: APPLICANT_MEMBER_ID, employerName: '', startDate: '' },
    ]);

    const question = getRequiredApplicationQuestions(data).outstanding.find(
      (q) => q.id === 'income.earned.0.employerName',
    );
    expect(question).toBeDefined();

    const afterWrite = set(data, question!.path, 'Acme Diner');

    expect(() => getRequiredApplicationQuestions(afterWrite)).not.toThrow();
    expect(
      getRequiredApplicationQuestions(afterWrite).outstanding.map((q) => q.id),
    ).not.toContain('income.earned.0.employerName');
  });

  it('leaves a non-numeric key against an array harmless', () => {
    const questionnaire = writePath(
      EMPTY_APPLICATION_DATA.questionnaire,
      'income.earned.entries',
      [{ id: 'a' }],
    );

    const updated = writePath(questionnaire, 'income.earned.entries.oops', 'x');

    expect(Array.isArray(readPath(updated, 'income.earned.entries'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4–9. Person-scoped record creation
// ---------------------------------------------------------------------------

describe('record scope classification', () => {
  it('classifies household-level sections as not person-scoped', () => {
    for (const path of [
      'circumstances.authorizedRepresentative.entries',
      'expenses.household.entries',
      'expenses.otherTaxDeductible.entries',
    ]) {
      expect(isPersonScoped(path), path).toBe(false);
    }
  });

  it('classifies person-scoped sections', () => {
    for (const path of [
      'income.earned.entries',
      'income.selfEmployment.entries',
      'expenses.medical.entries',
      'resources.vehicles.entries',
      'health.currentCoverage.entries',
    ]) {
      expect(isPersonScoped(path), path).toBe(true);
    }
  });

  it('allows multiple jobs for the same person', () => {
    expect(allowsMultiplePerPerson('income.earned.entries')).toBe(true);
    expect(allowsMultiplePerPerson('resources.accounts.entries')).toBe(true);
    expect(allowsMultiplePerPerson('expenses.medical.entries')).toBe(true);
  });

  it('marks one-per-person facts as such', () => {
    expect(allowsMultiplePerPerson('circumstances.students.entries')).toBe(false);
    expect(allowsMultiplePerPerson('circumstances.militaryService.entries')).toBe(false);
    expect(allowsMultiplePerPerson('circumstances.fosterCare.entries')).toBe(false);
  });

  it('does not treat a household-level section as multi-per-person', () => {
    expect(allowsMultiplePerPerson('expenses.household.entries')).toBe(false);
  });
});

describe('member selection for person-scoped records', () => {
  it('offers the applicant and every household member', () => {
    const choices = selectableMembers(household(), 'income.earned.entries');

    expect(choices).toHaveLength(3);
    expect(choices[0].id).toBe(APPLICANT_MEMBER_ID);
    expect(choices[0].label).toBe('Maria Delgado');
    expect(choices[1].label).toBe('Luis Delgado');
  });

  it('labels an unnamed member neutrally without inventing a name', () => {
    const choices = selectableMembers(household(), 'income.earned.entries');
    const unnamed = choices[2];

    expect(unnamed.label).toBe('Daughter');
    expect(unnamed.label).not.toMatch(/^Household member/);
  });

  it('falls back to a neutral index label when nothing identifies the person', () => {
    const data = household();
    const anonymous: Saws2PlusApplicationData = {
      ...data,
      householdMembers: [
        { ...data.householdMembers[1], relationshipToApplicant: '' },
      ],
    };

    expect(selectableMembers(anonymous, 'income.earned.entries')[1].label).toBe(
      'Household member 1',
    );
  });

  it('keeps offering the same person for a repeatable section', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId: APPLICANT_MEMBER_ID, employerName: 'Acme' },
    ]);

    const choices = selectableMembers(data, 'income.earned.entries');

    expect(choices.map((c) => c.id)).toContain(APPLICANT_MEMBER_ID);
  });

  it('removes an already-used person from a one-per-person section', () => {
    let data = set(household(), 'circumstances.students.answer', true);
    data = set(data, 'circumstances.students.entries', [
      { id: 's1', memberId: APPLICANT_MEMBER_ID, schoolName: 'City College' },
    ]);

    const choices = selectableMembers(data, 'circumstances.students.entries');

    expect(choices.map((c) => c.id)).not.toContain(APPLICANT_MEMBER_ID);
    expect(choices).toHaveLength(2);
  });

  it('returns every member for a household-level section', () => {
    // Household-level sections never ask, but the helper must not filter.
    expect(
      selectableMembers(household(), 'expenses.household.entries'),
    ).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 5–6. Names come from the household, never from a placeholder
// ---------------------------------------------------------------------------

describe('printed person names', () => {
  function planFor(memberId: string) {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId, employerName: 'Acme Diner' },
    ]);

    return new Map(
      buildApplicationFieldPlan(data).map((field) => [field.key, field.value]),
    );
  }

  it('derives the applicant name from the household model', () => {
    expect(planFor(APPLICANT_MEMBER_ID).get('income.earned.0.person_name')).toBe(
      'Maria Delgado',
    );
  });

  it('derives a member name from the household model', () => {
    expect(planFor('member-1').get('income.earned.0.person_name')).toBe(
      'Luis Delgado',
    );
  });

  it('writes no name for a member who has none, rather than a placeholder', () => {
    const plan = planFor('member-2');

    expect(plan.has('income.earned.0.person_name')).toBe(false);
    // And the member id is still stored as the stable relationship.
    expect(plan.get('income.earned.0.member_id')).toBe('member-2');
  });

  it('never emits a synthetic "Household member" label into the plan', () => {
    const data = household();
    const anonymous: Saws2PlusApplicationData = {
      ...data,
      householdMembers: [
        { ...data.householdMembers[1], relationshipToApplicant: '' },
      ],
    };

    let withJob = set(anonymous, 'income.earned.answer', true);
    withJob = set(withJob, 'income.earned.entries', [
      { id: 'j1', memberId: anonymous.householdMembers[0].id, employerName: 'Acme' },
    ]);

    for (const field of buildApplicationFieldPlan(withJob)) {
      expect(String(field.value)).not.toMatch(/Household member/);
    }
  });

  it('stores only the member id in the record, not a duplicated name', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId: 'member-1', employerName: 'Acme' },
    ]);

    const record = data.questionnaire.income.earned.entries[0] as unknown as Record<
      string,
      unknown
    >;

    expect(record.memberId).toBe('member-1');
    expect(Object.keys(record)).not.toContain('personName');
    expect(Object.keys(record)).not.toContain('name');
  });
});

// ---------------------------------------------------------------------------
// 7. Multiple records per person still work end to end
// ---------------------------------------------------------------------------

describe('multiple records for the same person', () => {
  it('maps two jobs for one person into separate indexed rows', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId: APPLICANT_MEMBER_ID, employerName: 'Day Job' },
      { id: 'j2', memberId: APPLICANT_MEMBER_ID, employerName: 'Night Job' },
    ]);

    const plan = new Map(
      buildApplicationFieldPlan(data).map((field) => [field.key, field.value]),
    );

    expect(plan.get('income.earned.0.employer_name')).toBe('Day Job');
    expect(plan.get('income.earned.1.employer_name')).toBe('Night Job');
    expect(plan.get('income.earned.0.person_name')).toBe('Maria Delgado');
    expect(plan.get('income.earned.1.person_name')).toBe('Maria Delgado');
  });
});
