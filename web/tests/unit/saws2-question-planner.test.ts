//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Tests for the pure SAWS 2 PLUS question planner.
 *
 * The contract: unknown asks, explicit No suppresses, Yes unlocks details, and
 * hidden records are never treated as active answers.
 */
import { describe, it, expect } from 'vitest';

import { buildInitialApplicationData } from '@/lib/application-data';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  activeEntries,
  appendixDApplies,
  getActiveAppendices,
  getRequiredApplicationQuestions,
  householdHasElderlyOrDisabledMember,
  memberOptions,
  readPath,
  writePath,
} from '@/lib/saws2-question-planner';
import type { Saws2PlusApplicationData } from '@/types/application';
import { APPLICANT_MEMBER_ID } from '@/types/saws-questionnaire';

function baseApplication(): Saws2PlusApplicationData {
  let n = 0;
  const application = buildInitialApplicationData(
    {
      zipCode: '90001',
      city: 'Los Angeles',
      state: 'CA',
      county: 'Los Angeles',
      preferredLanguage: 'English',
      householdProfile: 'me and my one year old',
      householdSize: 2,
      householdMembers: [{ age: 1 }],
      annualHouseholdIncome: 32000,
      incomeType: '',
      existingBenefits: '',
    },
    () => `member-${++n}`,
  );

  return {
    ...application,
    selectedPrograms: ['medi_cal', 'calfresh'],
    applicant: {
      ...application.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1993-04-12',
    },
    householdMembers: [
      { ...application.householdMembers[0], dateOfBirth: '2024-06-15' },
    ],
  };
}

function set(
  application: Saws2PlusApplicationData,
  path: string,
  value: unknown,
): Saws2PlusApplicationData {
  return {
    ...application,
    questionnaire: writePath(application.questionnaire, path, value),
  };
}

function ids(application: Saws2PlusApplicationData): string[] {
  return getRequiredApplicationQuestions(application).outstanding.map((q) => q.id);
}

// ---------------------------------------------------------------------------
// Three-state gateway behavior
// ---------------------------------------------------------------------------

describe('gateway three-state behavior', () => {
  it('asks a gateway whose answer is unknown', () => {
    expect(ids(baseApplication())).toContain('income.unearned');
  });

  it('suppresses details when a gateway is explicitly No', () => {
    const application = set(baseApplication(), 'income.unearned.answer', false);
    const outstanding = ids(application);

    expect(outstanding).not.toContain('income.unearned');
    expect(outstanding).not.toContain('income.unearned.records');
  });

  it('asks for at least one record when a gateway is Yes and empty', () => {
    const application = set(baseApplication(), 'income.unearned.answer', true);

    expect(ids(application)).toContain('income.unearned.records');
  });

  it('stops asking once a record with the required fields exists', () => {
    let application = set(baseApplication(), 'income.unearned.answer', true);
    application = set(application, 'income.unearned.entries', [
      { id: 'r1', memberId: APPLICANT_MEMBER_ID, source: 'SSI', amountMonthly: 900 },
    ]);

    const outstanding = ids(application);
    expect(outstanding).not.toContain('income.unearned.records');
    expect(outstanding.filter((id) => id.startsWith('income.unearned.'))).toEqual([]);
  });

  it('surfaces a missing required field inside an active record', () => {
    let application = set(baseApplication(), 'income.earned.answer', true);
    application = set(application, 'income.earned.entries', [
      { id: 'r1', memberId: APPLICANT_MEMBER_ID, employerName: '', startDate: '' },
    ]);

    expect(ids(application)).toContain('income.earned.0.employerName');
  });

  it('keeps explicit No distinguishable from unknown', () => {
    const unknown = baseApplication();
    const no = set(unknown, 'resources.accounts.answer', false);

    expect(readPath(unknown.questionnaire, 'resources.accounts.answer')).toBeUndefined();
    expect(readPath(no.questionnaire, 'resources.accounts.answer')).toBe(false);
  });

  it('never uses false as a default for an unasked question', () => {
    const questionnaire = baseApplication().questionnaire;

    expect(questionnaire.programIntegrity.fleeingFelon).toBeUndefined();
    expect(questionnaire.income.earned.answer).toBeUndefined();
    expect(questionnaire.health.taxFiler).toBeUndefined();
    expect(questionnaire.resources.vehicles.answer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Stale records after Yes → No
// ---------------------------------------------------------------------------

describe('records hidden by a No gateway', () => {
  function withStaleRecords(): Saws2PlusApplicationData {
    let application = set(baseApplication(), 'resources.vehicles.answer', true);
    application = set(application, 'resources.vehicles.entries', [
      {
        id: 'v1',
        memberId: APPLICANT_MEMBER_ID,
        year: '2015',
        make: 'Honda',
        model: 'Civic',
        usedFor: 'work',
      },
    ]);

    // The applicant changes their mind.
    return set(application, 'resources.vehicles.answer', false);
  }

  it('retains the typed records in state so nothing is lost', () => {
    expect(withStaleRecords().questionnaire.resources.vehicles.entries).toHaveLength(1);
  });

  it('treats them as inactive', () => {
    expect(
      activeEntries(withStaleRecords().questionnaire.resources.vehicles),
    ).toEqual([]);
  });

  it('does not submit them into the field plan', () => {
    const plan = buildApplicationFieldPlan(withStaleRecords());
    const keys = plan.map((field) => field.key);

    expect(keys).not.toContain('resources.vehicles.0.make');
    // The explicit No itself is still submitted.
    expect(plan.find((field) => field.key === 'resources.has_vehicles')?.value).toBe(
      false,
    );
  });

  it('reactivates them when the gateway goes back to Yes', () => {
    const reactivated = set(withStaleRecords(), 'resources.vehicles.answer', true);

    expect(activeEntries(reactivated.questionnaire.resources.vehicles)).toHaveLength(1);
    expect(
      buildApplicationFieldPlan(reactivated).find(
        (field) => field.key === 'resources.vehicles.0.make',
      )?.value,
    ).toBe('Honda');
  });
});

// ---------------------------------------------------------------------------
// Conditional questions
// ---------------------------------------------------------------------------

describe('conditional follow-ups', () => {
  it('asks about a recent birth only when breastfeeding is Yes', () => {
    expect(ids(baseApplication())).not.toContain('services.gave_birth_recently');

    const breastfeeding = set(baseApplication(), 'otherServices.breastfeeding', true);
    expect(ids(breastfeeding)).toContain('services.gave_birth_recently');

    const no = set(baseApplication(), 'otherServices.breastfeeding', false);
    expect(ids(no)).not.toContain('services.gave_birth_recently');
  });

  it('asks about joint filing only for a tax filer', () => {
    expect(ids(baseApplication())).not.toContain('health.spouse_filing_jointly');

    const filer = set(baseApplication(), 'health.taxFiler', true);
    expect(ids(filer)).toContain('health.spouse_filing_jointly');
  });

  it('asks for an explanation only after an affirmative legal answer', () => {
    expect(ids(baseApplication())).not.toContain('integrity.fleeing_felon_who');

    const yes = set(baseApplication(), 'programIntegrity.fleeingFelon', true);
    expect(ids(yes)).toContain('integrity.fleeing_felon_who');

    const no = set(baseApplication(), 'programIntegrity.fleeingFelon', false);
    expect(ids(no)).not.toContain('integrity.fleeing_felon_who');
  });

  it('asks about medical expenses only for an elderly or disabled household', () => {
    expect(ids(baseApplication())).not.toContain('expenses.medical');

    const application = baseApplication();
    const disabled: Saws2PlusApplicationData = {
      ...application,
      applicant: {
        ...application.applicant,
        householdDetails: { ...application.applicant.householdDetails, disabled: true },
      },
    };

    expect(householdHasElderlyOrDisabledMember(disabled)).toBe(true);
    expect(ids(disabled)).toContain('expenses.medical');
  });

  it('asks about pregnancy help only when someone is pregnant', () => {
    expect(ids(baseApplication())).not.toContain('services.pregnancy_assistance');

    const pregnant: Saws2PlusApplicationData = {
      ...baseApplication(),
      pregnancy: { anyonePregnant: true, presumptiveEligibilityCard: undefined },
    };

    expect(ids(pregnant)).toContain('services.pregnancy_assistance');
  });
});

// ---------------------------------------------------------------------------
// Appendices
// ---------------------------------------------------------------------------

describe('appendix activation', () => {
  it('activates none for a plain application', () => {
    expect(getActiveAppendices(baseApplication())).toEqual([]);
  });

  it('activates Appendix A only when employer coverage records exist', () => {
    let application = set(baseApplication(), 'health.employerCoverage.answer', true);
    application = set(application, 'health.employerCoverage.entries', [
      { id: 'e1', memberId: APPLICANT_MEMBER_ID, employerName: 'Acme', employerPhone: '' },
    ]);

    expect(getActiveAppendices(application).map((a) => a.id)).toContain('A');
  });

  it('does not activate Appendix A when the gateway is No', () => {
    let application = set(baseApplication(), 'health.employerCoverage.answer', true);
    application = set(application, 'health.employerCoverage.entries', [
      { id: 'e1', memberId: APPLICANT_MEMBER_ID, employerName: 'Acme', employerPhone: '' },
    ]);
    application = set(application, 'health.employerCoverage.answer', false);

    expect(getActiveAppendices(application).map((a) => a.id)).not.toContain('A');
  });

  it('activates Appendix B for an American Indian or Alaska Native household', () => {
    const application = set(
      baseApplication(),
      'health.americanIndianOrAlaskaNative',
      true,
    );

    expect(getActiveAppendices(application).map((a) => a.id)).toContain('B');
    expect(ids(application)).toContain('appendices.tribal_name');
  });

  it('activates Appendix C only for a health-coverage representative', () => {
    let application = set(
      baseApplication(),
      'circumstances.authorizedRepresentative.answer',
      true,
    );
    application = set(application, 'circumstances.authorizedRepresentative.entries', [
      { name: 'Ana Ruiz', organization: '', phone: '', address: '', forHealthCoverage: true },
    ]);

    expect(getActiveAppendices(application).map((a) => a.id)).toContain('C');
  });

  it('activates Appendix D only for cash aid with a second adult', () => {
    const application = baseApplication();
    expect(appendixDApplies(application)).toBe(false);

    const calworksOnly: Saws2PlusApplicationData = {
      ...application,
      selectedPrograms: ['calworks'],
    };
    // The only other member is a 1-year-old, so there is no second adult.
    expect(appendixDApplies(calworksOnly)).toBe(false);

    const withAdult: Saws2PlusApplicationData = {
      ...calworksOnly,
      householdMembers: [
        { ...application.householdMembers[0], age: 34, dateOfBirth: '1991-02-02' },
      ],
    };
    expect(appendixDApplies(withAdult)).toBe(true);
    expect(getActiveAppendices(withAdult).map((a) => a.id)).toContain('D');
  });

  it('activates Appendix E only when vehicles exist and detail is required', () => {
    let application = set(baseApplication(), 'resources.vehicles.answer', true);
    application = set(application, 'resources.vehicles.entries', [
      { id: 'v1', memberId: APPLICANT_MEMBER_ID, year: '2015', make: 'Honda', model: 'Civic', usedFor: '' },
    ]);

    // Neither cash aid nor an elderly/disabled member: no Appendix E yet.
    expect(getActiveAppendices(application).map((a) => a.id)).not.toContain('E');

    const required = set(
      application,
      'appendices.detailedVehicleInformationRequired',
      true,
    );
    expect(getActiveAppendices(required).map((a) => a.id)).toContain('E');
  });
});

// ---------------------------------------------------------------------------
// Multiple household members and member binding
// ---------------------------------------------------------------------------

describe('household members', () => {
  it('offers the applicant plus every member as options', () => {
    const application = baseApplication();
    const options = memberOptions(application);

    expect(options[0].id).toBe(APPLICANT_MEMBER_ID);
    expect(options).toHaveLength(1 + application.householdMembers.length);
  });

  it('binds records to the member id, not to a row position', () => {
    const application = baseApplication();
    const memberId = application.householdMembers[0].id;

    let updated = set(application, 'income.unearned.answer', true);
    updated = set(updated, 'income.unearned.entries', [
      { id: 'r1', memberId, source: 'Child support', amountMonthly: 200 },
    ]);

    const plan = buildApplicationFieldPlan(updated);
    expect(plan.find((f) => f.key === 'income.unearned.0.member_id')?.value).toBe(
      memberId,
    );
  });

  it('asks for a date of birth when a member has neither age nor DOB', () => {
    const application = baseApplication();
    const unknownAge: Saws2PlusApplicationData = {
      ...application,
      householdMembers: [
        { ...application.householdMembers[0], age: undefined, dateOfBirth: '' },
      ],
    };

    expect(ids(unknownAge)).toContain('household.member.0.age');
  });
});

// ---------------------------------------------------------------------------
// Planner hygiene
// ---------------------------------------------------------------------------

describe('planner hygiene', () => {
  it('never puts applicant data into a question id or path', () => {
    let application = set(baseApplication(), 'income.earned.answer', true);
    application = set(application, 'income.earned.entries', [
      { id: 'r1', memberId: APPLICANT_MEMBER_ID, employerName: '', startDate: '' },
    ]);

    for (const question of getRequiredApplicationQuestions(application).outstanding) {
      expect(question.id).not.toMatch(/Maria|Delgado|90001|1993/);
      expect(question.path).not.toMatch(/Maria|Delgado|90001|1993/);
      expect(question.id).toMatch(/^[a-z0-9_.]+$/i);
    }
  });

  it('does not mutate the application it is given', () => {
    const application = baseApplication();
    const snapshot = JSON.stringify(application);

    getRequiredApplicationQuestions(application);

    expect(JSON.stringify(application)).toBe(snapshot);
  });

  it('reports progress that rises as questions are answered', () => {
    const before = getRequiredApplicationQuestions(baseApplication());
    const after = getRequiredApplicationQuestions(
      set(baseApplication(), 'income.unearned.answer', false),
    );

    expect(after.answeredCount).toBe(before.answeredCount + 1);
    expect(after.outstanding.length).toBeLessThan(before.outstanding.length);
  });

  it('groups questions into sections', () => {
    const plan = getRequiredApplicationQuestions(baseApplication());
    const sections = plan.sections.map((section) => section.section);

    expect(sections).toContain('income');
    expect(sections).toContain('integrity');
    expect(new Set(sections).size).toBe(sections.length);
  });
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe('readPath / writePath', () => {
  it('writes immutably and leaves siblings untouched', () => {
    const application = baseApplication();
    const updated = writePath(
      application.questionnaire,
      'income.earned.answer',
      true,
    );

    expect(readPath(updated, 'income.earned.answer')).toBe(true);
    expect(application.questionnaire.income.earned.answer).toBeUndefined();
    expect(readPath(updated, 'resources.accounts.answer')).toBeUndefined();
    expect(updated.programIntegrity).toBe(application.questionnaire.programIntegrity);
  });
});
