//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Field-plan tests for the questionnaire answers.
 *
 * The three-state contract must survive into the plan: Yes emits `true`, an
 * explicit No emits `false`, and unknown emits nothing at all so the adapter
 * leaves both PDF checkboxes blank.
 */
import { describe, it, expect } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';
import { APPLICANT_MEMBER_ID } from '@/types/saws-questionnaire';

function withAnswers(
  entries: Array<[string, unknown]>,
): Saws2PlusApplicationData {
  let questionnaire = EMPTY_APPLICATION_DATA.questionnaire;

  for (const [path, value] of entries) {
    questionnaire = writePath(questionnaire, path, value);
  }

  return { ...EMPTY_APPLICATION_DATA, questionnaire };
}

function planMap(application: Saws2PlusApplicationData) {
  return new Map(
    buildApplicationFieldPlan(application).map((field) => [field.key, field.value]),
  );
}

describe('three-state answers in the field plan', () => {
  it('emits true for Yes', () => {
    const plan = planMap(withAnswers([['programIntegrity.fleeingFelon', true]]));

    expect(plan.get('integrity.fleeing_felon')).toBe(true);
  });

  it('emits false for an explicit No', () => {
    const plan = planMap(withAnswers([['programIntegrity.fleeingFelon', false]]));

    expect(plan.get('integrity.fleeing_felon')).toBe(false);
  });

  it('emits nothing for unknown', () => {
    const plan = planMap(withAnswers([]));

    expect(plan.has('integrity.fleeing_felon')).toBe(false);
    expect(plan.has('health.tax_filer')).toBe(false);
    expect(plan.has('resources.has_vehicles')).toBe(false);
  });

  it('keeps false through the plan filter that drops empty values', () => {
    // The plan filter removes nulls and blank strings; false must survive.
    const plan = buildApplicationFieldPlan(
      withAnswers([
        ['programIntegrity.duplicateBenefits', false],
        ['circumstances.californiaResident', false],
      ]),
    );

    const values = plan.filter((field) => field.value === false).map((f) => f.key);

    expect(values).toContain('integrity.duplicate_benefits');
    expect(values).toContain('household.california_resident');
  });

  it('omits an explanation whose gateway is not Yes', () => {
    const plan = planMap(
      withAnswers([
        ['programIntegrity.fleeingFelon', false],
        ['programIntegrity.fleeingFelonWho', 'Someone typed this earlier'],
      ]),
    );

    expect(plan.has('integrity.fleeing_felon_who')).toBe(false);
  });

  it('includes an explanation when the gateway is Yes', () => {
    const plan = planMap(
      withAnswers([
        ['programIntegrity.fleeingFelon', true],
        ['programIntegrity.fleeingFelonWho', 'Household member 2'],
      ]),
    );

    expect(plan.get('integrity.fleeing_felon_who')).toBe('Household member 2');
  });

  it('omits the recent-birth follow-up unless breastfeeding is Yes', () => {
    const notBreastfeeding = planMap(
      withAnswers([
        ['otherServices.breastfeeding', false],
        ['otherServices.gaveBirthInLastTwelveMonths', true],
      ]),
    );
    expect(notBreastfeeding.has('services.gave_birth_last_twelve_months')).toBe(false);

    const breastfeeding = planMap(
      withAnswers([
        ['otherServices.breastfeeding', true],
        ['otherServices.gaveBirthInLastTwelveMonths', true],
      ]),
    );
    expect(breastfeeding.get('services.gave_birth_last_twelve_months')).toBe(true);
  });
});

describe('repeated records in the field plan', () => {
  it('maps multiple jobs with per-record indices', () => {
    const plan = planMap(
      withAnswers([
        ['income.earned.answer', true],
        [
          'income.earned.entries',
          [
            {
              id: 'j1',
              memberId: APPLICANT_MEMBER_ID,
              employerName: 'Acme Diner',
              startDate: '2024-01-15',
              payFrequency: 'every_two_weeks',
              grossPerPeriod: 800,
              hoursPerWeek: 30,
            },
            {
              id: 'j2',
              memberId: 'member-1',
              employerName: 'Night Shift Co',
              startDate: '2025-02-01',
              grossPerPeriod: 400,
            },
          ],
        ],
      ]),
    );

    expect(plan.get('income.earned.0.employer_name')).toBe('Acme Diner');
    expect(plan.get('income.earned.0.gross_per_period')).toBe(800);
    expect(plan.get('income.earned.0.hours_per_week')).toBe(30);
    expect(plan.get('income.earned.1.employer_name')).toBe('Night Shift Co');
    expect(plan.get('income.earned.1.member_id')).toBe('member-1');
  });

  it('maps multiple resources and vehicles', () => {
    const plan = planMap(
      withAnswers([
        ['resources.accounts.answer', true],
        [
          'resources.accounts.entries',
          [
            { id: 'a1', memberId: APPLICANT_MEMBER_ID, kind: 'checking', institution: 'Bank A', balance: 250 },
            { id: 'a2', memberId: APPLICANT_MEMBER_ID, kind: 'savings', institution: 'Bank B', balance: 1000 },
          ],
        ],
        ['resources.vehicles.answer', true],
        [
          'resources.vehicles.entries',
          [
            { id: 'v1', memberId: APPLICANT_MEMBER_ID, year: '2012', make: 'Toyota', model: 'Corolla', usedFor: 'work' },
            { id: 'v2', memberId: 'member-1', year: '2004', make: 'Ford', model: 'Focus', usedFor: 'school' },
          ],
        ],
      ]),
    );

    expect(plan.get('resources.accounts.0.institution')).toBe('Bank A');
    expect(plan.get('resources.accounts.1.balance')).toBe(1000);
    expect(plan.get('resources.vehicles.0.make')).toBe('Toyota');
    expect(plan.get('resources.vehicles.1.make')).toBe('Ford');
  });

  it('maps self-employment detail', () => {
    const plan = planMap(
      withAnswers([
        ['income.selfEmployment.answer', true],
        [
          'income.selfEmployment.entries',
          [
            {
              id: 's1',
              memberId: APPLICANT_MEMBER_ID,
              businessName: 'Delgado Cleaning',
              businessType: 'House cleaning',
              startDate: '2023-05-01',
              grossMonthly: 2200,
              netMonthly: 1500,
              expenseMethod: 'standard_40_percent',
            },
          ],
        ],
      ]),
    );

    expect(plan.get('income.self_employment.0.business_type')).toBe('House cleaning');
    expect(plan.get('income.self_employment.0.gross_monthly')).toBe(2200);
    expect(plan.get('income.self_employment.0.net_monthly')).toBe(1500);
    expect(plan.get('income.self_employment.0.expense_method')).toBe(
      'standard_40_percent',
    );
  });

  it('maps household expenses and medical expenses separately', () => {
    const plan = planMap(
      withAnswers([
        ['expenses.household.answer', true],
        [
          'expenses.household.entries',
          [
            { id: 'e1', kind: 'rent_or_mortgage', amountMonthly: 1400, description: '' },
            { id: 'e2', kind: 'electricity', amountMonthly: 90, description: '' },
          ],
        ],
        ['expenses.medical.answer', true],
        [
          'expenses.medical.entries',
          [{ id: 'm1', memberId: APPLICANT_MEMBER_ID, kind: 'Prescriptions', amountMonthly: 45 }],
        ],
      ]),
    );

    expect(plan.get('expenses.household.0.amount_monthly')).toBe(1400);
    expect(plan.get('expenses.household.1.kind')).toBe('electricity');
    expect(plan.get('expenses.medical.0.kind')).toBe('Prescriptions');
  });
});

describe('privacy boundary in the questionnaire plan', () => {
  it('never emits an SSN or signature key from any questionnaire answer', () => {
    const plan = buildApplicationFieldPlan(
      withAnswers([
        ['income.earned.answer', true],
        [
          'income.earned.entries',
          [{ id: 'j1', memberId: APPLICANT_MEMBER_ID, employerName: 'Acme', startDate: '' }],
        ],
        ['programIntegrity.fleeingFelon', false],
        ['health.taxFiler', true],
      ]),
    );

    for (const field of plan) {
      expect(field.key).not.toMatch(/ssn|social_security|signature|signed/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Page-9 earned income: the columns the adapter writes
// ---------------------------------------------------------------------------

describe('earned income reaches the plan with page-9 column semantics', () => {
  const JOB = {
    id: 'j1',
    memberId: APPLICANT_MEMBER_ID,
    employerName: 'Acme Diner',
    employerAddress: '88 Main St',
    employerPhone: '323-555-7000',
    startDate: '2024-01-15',
    payFrequency: 'every_two_weeks' as const,
    hourlyRate: 17.5,
    grossPerPeriod: 800,
    grossReceivedThisMonth: 2100,
    hoursPerWeek: 30,
    expectedToContinue: true,
  };

  function withJob(overrides: Record<string, unknown> = {}) {
    const application = {
      ...EMPTY_APPLICATION_DATA,
      applicant: {
        ...EMPTY_APPLICATION_DATA.applicant,
        firstName: 'Maria',
        lastName: 'Delgado',
      },
    };

    let questionnaire = writePath(application.questionnaire, 'income.earned.answer', true);
    questionnaire = writePath(questionnaire, 'income.earned.entries', [
      { ...JOB, ...overrides },
    ]);

    return { ...application, questionnaire };
  }

  it('emits every column the page-9 row can hold', () => {
    const plan = planMap(withJob());

    expect(plan.get('income.earned.0.person_name')).toBe('Maria Delgado');
    expect(plan.get('income.earned.0.employer_name')).toBe('Acme Diner');
    expect(plan.get('income.earned.0.employer_address')).toBe('88 Main St');
    expect(plan.get('income.earned.0.employer_phone')).toBe('323-555-7000');
    expect(plan.get('income.earned.0.hourly_rate')).toBe(17.5);
    expect(plan.get('income.earned.0.hours_per_week')).toBe(30);
    expect(plan.get('income.earned.0.pay_frequency')).toBe('every_two_weeks');
    expect(plan.get('income.earned.0.gross_received_this_month')).toBe(2100);
    expect(plan.get('income.earned.0.expected_to_continue')).toBe(true);
  });

  it('keeps the per-period amount separate from the monthly total', () => {
    const plan = planMap(withJob());

    expect(plan.get('income.earned.0.gross_per_period')).toBe(800);
    expect(plan.get('income.earned.0.gross_received_this_month')).toBe(2100);
  });

  it('emits expected_to_continue as three-state', () => {
    expect(planMap(withJob({ expectedToContinue: false })).get(
      'income.earned.0.expected_to_continue',
    )).toBe(false);

    expect(
      planMap(withJob({ expectedToContinue: undefined })).has(
        'income.earned.0.expected_to_continue',
      ),
    ).toBe(false);
  });

  it('leaves the person name empty when the person has no typed name', () => {
    const application = {
      ...EMPTY_APPLICATION_DATA,
      questionnaire: writePath(
        writePath(EMPTY_APPLICATION_DATA.questionnaire, 'income.earned.answer', true),
        'income.earned.entries',
        [JOB],
      ),
    };

    expect(planMap(application).has('income.earned.0.person_name')).toBe(false);
  });

  it('omits every earned-income key once the gateway is No', () => {
    const application = withJob();
    const disabled = {
      ...application,
      questionnaire: writePath(application.questionnaire, 'income.earned.answer', false),
    };

    const keys = [...planMap(disabled).keys()];

    expect(keys.filter((key) => key.startsWith('income.earned.'))).toEqual([]);
    expect(planMap(disabled).get('income.has_earned_income')).toBe(false);
  });

  it('omits every earned-income key while the gateway is unknown', () => {
    const application = withJob();
    const unknown = {
      ...application,
      questionnaire: writePath(
        application.questionnaire,
        'income.earned.answer',
        undefined,
      ),
    };

    const keys = [...planMap(unknown).keys()];

    expect(keys.filter((key) => key.startsWith('income.'))).toEqual([]);
  });

  it('indexes multiple jobs so each maps to its own printed row', () => {
    const application = {
      ...EMPTY_APPLICATION_DATA,
      questionnaire: writePath(
        writePath(EMPTY_APPLICATION_DATA.questionnaire, 'income.earned.answer', true),
        'income.earned.entries',
        [
          { ...JOB, id: 'a', employerName: 'First' },
          { ...JOB, id: 'b', employerName: 'Second' },
          { ...JOB, id: 'c', employerName: 'Third' },
          { ...JOB, id: 'd', employerName: 'Fourth' },
          { ...JOB, id: 'e', employerName: 'Fifth' },
        ],
      ),
    };

    const plan = planMap(application);

    expect(plan.get('income.earned.0.employer_name')).toBe('First');
    expect(plan.get('income.earned.3.employer_name')).toBe('Fourth');
    // A fifth record is still planned; the adapter caps writing at four rows
    // because the printed table has four.
    expect(plan.get('income.earned.4.employer_name')).toBe('Fifth');
  });
});
