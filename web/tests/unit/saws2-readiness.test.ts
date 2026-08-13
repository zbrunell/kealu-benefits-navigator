//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Tests for the readiness validator.
 *
 * The rules under test come from authoritative sources; see
 * docs/saws2-readiness-requirements.md. The behavioral contract:
 *
 * - name + address make an application filing-ready (the signature is manual);
 * - an unanswered questionnaire gateway never blocks filing;
 * - determination requirements differ per program;
 * - "not determinationReady" is not "invalid".
 */
import { describe, it, expect } from 'vitest';

import { buildInitialApplicationData } from '@/lib/application-data';
import {
  evaluateApplicationReadiness,
  looksExpeditedEligible,
} from '@/lib/saws2-readiness';
import { writePath } from '@/lib/saws2-question-planner';
import type { Saws2PlusApplicationData } from '@/types/application';

function base(): Saws2PlusApplicationData {
  let n = 0;
  const data = buildInitialApplicationData(
    {
      zipCode: '90001',
      city: 'Los Angeles',
      state: 'CA',
      county: 'Los Angeles',
      preferredLanguage: 'English',
      householdProfile: 'me and my one year old',
      householdSize: 2,
      householdMembers: [{ age: 1 }],
      annualHouseholdIncome: 26000,
      incomeType: '',
      existingBenefits: '',
    },
    () => `member-${++n}`,
  );

  return {
    ...data,
    selectedPrograms: ['calfresh'],
    applicant: {
      ...data.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1993-04-12',
      homeAddress: { ...data.applicant.homeAddress, street: '1420 E 41st St' },
    },
  };
}

function set(
  data: Saws2PlusApplicationData,
  path: string,
  value: unknown,
): Saws2PlusApplicationData {
  return { ...data, questionnaire: writePath(data.questionnaire, path, value) };
}

/** Answer the three income gateways so determination rules can be isolated. */
function withIncomeAnswered(data: Saws2PlusApplicationData) {
  let next = set(data, 'income.earned.answer', false);
  next = set(next, 'income.selfEmployment.answer', false);
  return set(next, 'income.unearned.answer', false);
}

// ---------------------------------------------------------------------------
// Filing readiness
// ---------------------------------------------------------------------------

describe('filing readiness', () => {
  it('is ready with a name and an address', () => {
    const readiness = evaluateApplicationReadiness(base());

    expect(readiness.filingReady).toBe(true);
    expect(readiness.missingForFiling).toEqual([]);
  });

  it('is blocked without a name', () => {
    const data = base();
    const readiness = evaluateApplicationReadiness({
      ...data,
      applicant: { ...data.applicant, firstName: '', lastName: '' },
    });

    expect(readiness.filingReady).toBe(false);
    expect(readiness.missingForFiling.map((r) => r.id)).toContain(
      'filing.applicant_name',
    );
  });

  it('is blocked without an address', () => {
    const data = base();
    const readiness = evaluateApplicationReadiness({
      ...data,
      applicant: {
        ...data.applicant,
        homeAddress: { ...data.applicant.homeAddress, street: '', city: '', zipCode: '' },
      },
    });

    expect(readiness.filingReady).toBe(false);
    expect(readiness.missingForFiling.map((r) => r.id)).toContain(
      'filing.applicant_address',
    );
  });

  it('does not block a homeless applicant on the address', () => {
    const data = base();
    const readiness = evaluateApplicationReadiness({
      ...data,
      applicant: {
        ...data.applicant,
        homeAddress: { ...data.applicant.homeAddress, street: '', city: '', zipCode: '' },
      },
      preferences: { ...data.preferences, homeless: true },
    });

    expect(readiness.filingReady).toBe(true);
  });

  /** The central rule: unanswered questionnaire gateways are not filing blockers. */
  it('stays filing-ready with the entire questionnaire unanswered', () => {
    const readiness = evaluateApplicationReadiness(base());

    expect(readiness.filingReady).toBe(true);
    expect(readiness.fullyPrefilled).toBe(false);
    expect(readiness.missingForFiling).toEqual([]);
  });

  it('never lists the signature as missing for filing', () => {
    const readiness = evaluateApplicationReadiness(base());

    expect(readiness.missingForFiling.map((r) => r.id)).not.toContain(
      'manual.signature',
    );
    expect(readiness.manualCompletionRequired.map((r) => r.id)).toContain(
      'manual.signature',
    );
  });
});

// ---------------------------------------------------------------------------
// Determination readiness differs per program
// ---------------------------------------------------------------------------

describe('determination readiness', () => {
  it('is false while income is unanswered, without invalidating the filing', () => {
    const readiness = evaluateApplicationReadiness(base());

    expect(readiness.filingReady).toBe(true);
    expect(readiness.determinationReady).toBe(false);
    expect(readiness.missingForDetermination.map((r) => r.id)).toContain(
      'determination.calfresh.income',
    );
  });

  it('requires shelter costs for CalFresh but not for Medi-Cal', () => {
    const data = withIncomeAnswered(base());

    const calfresh = evaluateApplicationReadiness(
      { ...data, selectedPrograms: ['calfresh'] },
      ['calfresh'],
    );
    expect(calfresh.missingForDetermination.map((r) => r.id)).toContain(
      'determination.calfresh.shelter_costs',
    );

    const mediCal = evaluateApplicationReadiness(
      { ...data, selectedPrograms: ['medi_cal'] },
      ['medi_cal'],
    );
    expect(mediCal.missingForDetermination.map((r) => r.id)).not.toContain(
      'determination.calfresh.shelter_costs',
    );
  });

  it('requires a resource answer for CalWORKs but not for CalFresh', () => {
    const data = withIncomeAnswered(base());

    const calworks = evaluateApplicationReadiness(
      { ...data, selectedPrograms: ['calworks'] },
      ['calworks'],
    );
    expect(calworks.missingForDetermination.map((r) => r.id)).toContain(
      'determination.calworks.resources',
    );

    const calfresh = evaluateApplicationReadiness(
      { ...data, selectedPrograms: ['calfresh'] },
      ['calfresh'],
    );
    expect(calfresh.missingForDetermination.map((r) => r.id)).not.toContain(
      'determination.calworks.resources',
    );
  });

  it('requires citizenship answers and a tax-household answer for Medi-Cal only', () => {
    const data = withIncomeAnswered(base());

    const mediCal = evaluateApplicationReadiness(
      { ...data, selectedPrograms: ['medi_cal'] },
      ['medi_cal'],
    );
    const ids = mediCal.missingForDetermination.map((r) => r.id);

    expect(ids).toContain('determination.medi_cal.citizenship');
    expect(ids).toContain('determination.medi_cal.tax_household');

    const calfresh = evaluateApplicationReadiness(
      { ...data, selectedPrograms: ['calfresh'] },
      ['calfresh'],
    );
    expect(calfresh.missingForDetermination.map((r) => r.id)).not.toContain(
      'determination.medi_cal.citizenship',
    );
  });

  it('reports per-program readiness separately', () => {
    let data = withIncomeAnswered(base());
    data = set(data, 'expenses.household.answer', true);
    data = { ...data, selectedPrograms: ['calfresh', 'calworks'] };

    const readiness = evaluateApplicationReadiness(data);

    // CalFresh has what it needs; CalWORKs still wants a resource answer.
    expect(readiness.selectedPrograms.calfresh?.determinationReady).toBe(true);
    expect(readiness.selectedPrograms.calworks?.determinationReady).toBe(false);
    expect(readiness.determinationReady).toBe(false);
  });

  it('becomes determination-ready for CalFresh once its own items are answered', () => {
    let data = withIncomeAnswered(base());
    data = set(data, 'expenses.household.answer', true);

    const readiness = evaluateApplicationReadiness(data, ['calfresh']);

    expect(readiness.determinationReady).toBe(true);
    expect(readiness.missingForDetermination).toEqual([]);
  });

  it('blocks determination when a household member has no age or date of birth', () => {
    let data = withIncomeAnswered(base());
    data = set(data, 'expenses.household.answer', true);
    data = {
      ...data,
      householdMembers: [
        { ...data.householdMembers[0], age: undefined, dateOfBirth: '' },
      ],
    };

    const readiness = evaluateApplicationReadiness(data, ['calfresh']);

    expect(readiness.determinationReady).toBe(false);
    expect(readiness.missingForDetermination.map((r) => r.id)).toContain(
      'determination.calfresh.household_ages',
    );
  });
});

// ---------------------------------------------------------------------------
// Manual items and the privacy boundary
// ---------------------------------------------------------------------------

describe('manual completion', () => {
  it('lists the SSN only for Medi-Cal, as a follow-up rather than a filing blocker', () => {
    const calfresh = evaluateApplicationReadiness(base(), ['calfresh']);
    expect(calfresh.manualCompletionRequired.map((r) => r.id)).not.toContain(
      'manual.ssn_medi_cal',
    );

    const mediCal = evaluateApplicationReadiness(base(), ['medi_cal']);
    const ssn = mediCal.manualCompletionRequired.find(
      (r) => r.id === 'manual.ssn_medi_cal',
    );

    expect(ssn).toBeDefined();
    expect(ssn?.effect).toBe('allows_filing_requires_follow_up');
    expect(ssn?.manualOnly).toBe(true);
    expect(ssn?.source).toMatch(/435\.910/);
  });

  it('marks every manual item as manualOnly', () => {
    const readiness = evaluateApplicationReadiness(base(), [
      'calfresh',
      'calworks',
      'medi_cal',
    ]);

    for (const requirement of readiness.manualCompletionRequired) {
      expect(requirement.manualOnly, requirement.id).toBe(true);
    }
  });

  it('flags the contested CalWORKs SAWS 1 rule instead of blocking on it', () => {
    const readiness = evaluateApplicationReadiness(base(), ['calworks']);
    const saws1 = readiness.manualCompletionRequired.find(
      (r) => r.id === 'manual.calworks_saws1',
    );

    expect(saws1?.unresolved).toBeTruthy();
    expect(saws1?.effect).toBe('allows_filing_requires_follow_up');
    // A contested rule must not make the application fail filing readiness.
    expect(readiness.filingReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

describe('traceability', () => {
  it('gives every requirement an authoritative source', () => {
    const readiness = evaluateApplicationReadiness(base(), [
      'calfresh',
      'calworks',
      'medi_cal',
    ]);

    const all = [
      ...readiness.missingForFiling,
      ...readiness.missingForDetermination,
      ...readiness.manualCompletionRequired,
      ...readiness.recommendedButOptional,
    ];

    expect(all.length).toBeGreaterThan(0);

    for (const requirement of all) {
      expect(requirement.source, requirement.id).toMatch(
        /CFR|MPP|county policy/i,
      );
      expect(requirement.id).toMatch(/^[a-z0-9_.]+$/i);
    }
  });

  it('never puts applicant data in a requirement id', () => {
    const readiness = evaluateApplicationReadiness(base(), ['calfresh']);

    for (const requirement of [
      ...readiness.missingForDetermination,
      ...readiness.manualCompletionRequired,
    ]) {
      expect(requirement.id).not.toMatch(/Maria|Delgado|90001/);
    }
  });

  it('is pure — it does not mutate the application', () => {
    const data = base();
    const snapshot = JSON.stringify(data);

    evaluateApplicationReadiness(data, ['calfresh', 'calworks', 'medi_cal']);

    expect(JSON.stringify(data)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Expedited screening
// ---------------------------------------------------------------------------

describe('expedited service screening', () => {
  it('is listed as optional, never as a filing or determination blocker', () => {
    const readiness = evaluateApplicationReadiness(base(), ['calfresh']);
    const expedited = readiness.recommendedButOptional.find(
      (r) => r.id === 'expedited.calfresh_screening',
    );

    expect(expedited?.effect).toBe('affects_expedited_screening_only');
    expect(readiness.missingForFiling.map((r) => r.id)).not.toContain(
      'expedited.calfresh_screening',
    );
    expect(readiness.missingForDetermination.map((r) => r.id)).not.toContain(
      'expedited.calfresh_screening',
    );
  });

  it('is not raised for a Medi-Cal-only application', () => {
    const readiness = evaluateApplicationReadiness(base(), ['medi_cal']);

    expect(readiness.recommendedButOptional.map((r) => r.id)).not.toContain(
      'expedited.calfresh_screening',
    );
  });

  it('distinguishes unknown from not-entitled', () => {
    const data = base();

    expect(looksExpeditedEligible(data)).toBeUndefined();

    expect(
      looksExpeditedEligible({
        ...data,
        expeditedService: {
          ...data.expeditedService,
          grossIncomeUnder150AndResourcesUnder100: true,
        },
      }),
    ).toBe(true);

    expect(
      looksExpeditedEligible({
        ...data,
        expeditedService: {
          ...data.expeditedService,
          grossIncomeUnder150AndResourcesUnder100: false,
          incomeAndResourcesLessThanHousingCosts: false,
          migrantOrSeasonalFarmWorker: false,
        },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fullyPrefilled
// ---------------------------------------------------------------------------

describe('fullyPrefilled', () => {
  it('is independent of filing readiness', () => {
    const readiness = evaluateApplicationReadiness(base(), ['calfresh']);

    expect(readiness.filingReady).toBe(true);
    expect(readiness.fullyPrefilled).toBe(false);
  });

  it('does not require SSN or signature to become true', () => {
    // Whatever makes fullyPrefilled true, it is driven by planner questions,
    // and the planner never asks for an SSN or a signature.
    const readiness = evaluateApplicationReadiness(base(), ['medi_cal']);
    const manualIds = readiness.manualCompletionRequired.map((r) => r.id);

    expect(manualIds).toContain('manual.signature');
    expect(manualIds).toContain('manual.ssn_medi_cal');
    // Those manual items are reported separately and are not planner questions.
    expect(readiness.missingForFiling.map((r) => r.id)).not.toContain(
      'manual.ssn_medi_cal',
    );
  });
});
