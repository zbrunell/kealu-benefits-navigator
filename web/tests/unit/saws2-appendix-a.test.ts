import { describe, expect, it } from 'vitest';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory, inventoryCounts } from '@/lib/saws2-inventory';
import { writePath } from '@/lib/saws2-question-planner';
import { SAWS2_FIELD_BY_ID } from '@/lib/saws2-schema';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    applicant: { ...EMPTY_APPLICATION_DATA.applicant, firstName: 'Maria', lastName: 'Delgado', dateOfBirth: '1990-01-01' },
    householdMembers: [{ id: 'm1', firstName: 'Luis', middleName: '', lastName: 'Delgado', dateOfBirth: '1991-09-02', relationshipToApplicant: 'Spouse' }],
  };
}
const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({ ...d, questionnaire: writePath(d.questionnaire, p, v) });
const val = (d: Saws2PlusApplicationData, k: string) => buildApplicationFieldPlan(d, {}).find((e) => e.key === k)?.value;

const employer = (over: Record<string, unknown> = {}) => {
  let d = w(seed(), 'health.employerCoverage.answer', true);
  return w(d, 'health.employerCoverage.entries', [{
    id: 'e1', memberId: 'm1', employerName: 'Acme Diner', employerPhone: '323-555-0100',
    offersCoverage: true, eligibleNowOrSoon: undefined,
    employerIdentificationNumber: '', employerAddress: '', employerCity: '',
    employerState: '', employerZipCode: '', employerEmail: '',
    waitingPeriodEnrollmentDate: '', otherEligibleMemberIds: [],
    planChangeDate: '', ...over,
  }]);
};

describe('Appendix A', () => {
  it('resolves the employee from the member id', () => {
    expect(val(employer(), 'appendices.employer_coverage.0.employee_name')).toBe('Luis Delgado');
  });

  it('emits nothing while Q22a is not Yes', () => {
    let d = employer();
    expect(val(d, 'appendices.employer_coverage.0.employer_name')).toBe('Acme Diner');
    d = w(d, 'health.employerCoverage.answer', false);
    expect(val(d, 'appendices.employer_coverage.0.employer_name')).toBeUndefined();
  });

  it('suppresses everything below item 13 when not eligible', () => {
    const d = employer({
      eligibleNowOrSoon: false, waitingPeriodEnrollmentDate: '2026-10-01',
      meetsMinimumValueStandard: true, lowestCostPremium: 120,
      lowestCostPremiumFrequency: 'monthly', planChange: 'no_changes_expected',
    });
    expect(val(d, 'appendices.employer_coverage.0.eligible_now_or_soon')).toBe(false);
    for (const k of ['waiting_period_enrollment_date', 'meets_minimum_value_standard',
      'lowest_cost_premium', 'lowest_cost_premium_frequency', 'plan_change']) {
      expect(val(d, `appendices.employer_coverage.0.${k}`), k).toBeUndefined();
    }
  });

  it('emits the changed premium only for the change that alters it', () => {
    let d = employer({ eligibleNowOrSoon: true, planChange: 'will_no_longer_provide', changedPremium: 140 });
    expect(val(d, 'appendices.employer_coverage.0.changed_premium')).toBeUndefined();
    d = employer({ eligibleNowOrSoon: true, planChange: 'will_start_offering_or_change_premium', changedPremium: 140 });
    expect(val(d, 'appendices.employer_coverage.0.changed_premium')).toBe(140);
  });

  it('resolves other-eligible people to real names', () => {
    const d = employer({ eligibleNowOrSoon: true, otherEligibleMemberIds: ['applicant'] });
    expect(val(d, 'appendices.employer_coverage.0.other_eligible.0')).toBe('Maria Delgado');
  });

  it('offers six premium frequencies including quarterly and yearly', () => {
    for (const f of ['weekly', 'bi_weekly', 'twice_a_month', 'monthly', 'quarterly', 'yearly']) {
      const d = employer({ eligibleNowOrSoon: true, lowestCostPremiumFrequency: f });
      expect(val(d, 'appendices.employer_coverage.0.lowest_cost_premium_frequency'), f).toBe(f);
    }
  });

  it('never emits any SSN-shaped key', () => {
    const d = employer({ eligibleNowOrSoon: true, employerIdentificationNumber: '95-1234567' });
    for (const field of buildApplicationFieldPlan(d, {})) {
      expect(field.key).not.toMatch(/ssn|social_security/i);
    }
  });

  it('survives a legacy record missing every appendix field', () => {
    let d = w(seed(), 'health.employerCoverage.answer', true);
    d = w(d, 'health.employerCoverage.entries', [{
      id: 'e1', memberId: 'm1', employerName: 'Acme', employerPhone: '',
      offersCoverage: true, eligibleNowOrSoon: true,
    }]);
    expect(() => buildApplicationFieldPlan(d, {})).not.toThrow();
    expect(val(d, 'appendices.employer_coverage.0.employer_name')).toBe('Acme');
  });

  it('is recorded in the schema and no longer unmodeled', () => {
    expect(SAWS2_FIELD_BY_ID.get('appendices.employer_coverage')?.saws).toBe('Appendix A');
    expect(buildInventory().find((e) => e.saws === 'Appendix A')?.status).toBe('collected_and_mapped');
  });

  it('leaves no printed question unmodeled', () => {
    expect(inventoryCounts().not_modeled ?? 0).toBe(0);
  });
});
