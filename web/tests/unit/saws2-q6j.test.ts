//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Q6j per-disabled-person detail.
 *
 * The four sub-questions are deliberately not collapsed into one `disabled`
 * flag: the county uses them for different rules, and the printed form asks
 * each separately. Answers are keyed by stable member id so a detail cannot
 * drift onto another person.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory } from '@/lib/saws2-inventory';
import { getRequiredApplicationQuestions, writePath } from '@/lib/saws2-question-planner';
import { SAWS2_FIELD_BY_ID } from '@/lib/saws2-schema';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    applicant: { ...EMPTY_APPLICATION_DATA.applicant, firstName: 'Maria', lastName: 'Delgado', dateOfBirth: '1990-01-01' },
    householdMembers: [{
      id: 'm1', firstName: 'Rosa', middleName: '', lastName: 'Marin',
      dateOfBirth: '1955-02-10', relationshipToApplicant: 'Mother',
    }],
  };
}
const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({ ...d, questionnaire: writePath(d.questionnaire, p, v) });
const ids = (d: Saws2PlusApplicationData) => new Set(getRequiredApplicationQuestions(d).outstanding.map((q) => q.id));
const val = (d: Saws2PlusApplicationData, k: string) => buildApplicationFieldPlan(d, {}).find((e) => e.key === k)?.value;

/** Q6i answered Yes, so Q6j applies. */
const limited = () => w(seed(), 'circumstances.disabilityLimitsActivities', true);

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'd1', memberId: 'm1',
  needsHelpWithDailyLivingExplanation: '', worksWithMedicalExpensesExplanation: '',
  medicalFacilityName: '', ...over,
});

describe('Q6j is conditional on Q6i', () => {
  it('is not asked while Q6i is unanswered', () => {
    expect(ids(seed()).has('circumstances.disability_details.records')).toBe(false);
  });

  it('is not asked when Q6i is No', () => {
    const d = w(seed(), 'circumstances.disabilityLimitsActivities', false);
    expect(ids(d).has('circumstances.disability_details.records')).toBe(false);
  });

  it('asks for a person once Q6i is Yes', () => {
    expect(ids(limited()).has('circumstances.disability_details.records')).toBe(true);
  });

  it('stops emitting detail when Q6i goes back to No', () => {
    let d = w(limited(), 'circumstances.disabilityDetails.answer', true);
    d = w(d, 'circumstances.disabilityDetails.entries', [detail({ needsCareForOthersToWork: true })]);
    expect(val(d, 'household.disability_detail.0.needs_care_for_others_to_work')).toBe(true);

    d = w(d, 'circumstances.disabilityLimitsActivities', false);
    expect(val(d, 'household.disability_detail.0.needs_care_for_others_to_work')).toBeUndefined();
    expect(val(d, 'household.disability_detail.0.person_name')).toBeUndefined();
  });
});

describe('Q6j sub-questions stay distinct', () => {
  const withDetail = (over: Record<string, unknown>) => {
    let d = w(limited(), 'circumstances.disabilityDetails.answer', true);
    return w(d, 'circumstances.disabilityDetails.entries', [detail(over)]);
  };

  it('asks all four per person', () => {
    const s = ids(withDetail({}));
    for (const k of ['needsCareForOthersToWork', 'needsHelpWithDailyLiving', 'worksWithMedicalExpenses', 'inMedicalFacility']) {
      expect(s.has(`circumstances.disability_details.0.${k}`), k).toBe(true);
    }
  });

  it('keeps a No to one from answering the others', () => {
    const d = withDetail({ needsCareForOthersToWork: false });
    expect(val(d, 'household.disability_detail.0.needs_care_for_others_to_work')).toBe(false);
    expect(val(d, 'household.disability_detail.0.needs_help_daily_living')).toBeUndefined();
    expect(val(d, 'household.disability_detail.0.in_medical_facility')).toBeUndefined();
  });

  it('resolves the person to their real name via member id', () => {
    const d = withDetail({ inMedicalFacility: true });
    expect(val(d, 'household.disability_detail.0.person_name')).toBe('Rosa Marin');
    expect(val(d, 'household.disability_detail.0.member_id')).toBe('m1');
  });

  it('emits explanations only for their own Yes', () => {
    let d = withDetail({
      needsHelpWithDailyLiving: true, needsHelpWithDailyLivingExplanation: 'Bathing',
      worksWithMedicalExpenses: false, worksWithMedicalExpensesExplanation: 'stale',
    });
    expect(val(d, 'household.disability_detail.0.needs_help_daily_living_explanation')).toBe('Bathing');
    expect(val(d, 'household.disability_detail.0.works_with_medical_expenses_explanation')).toBeUndefined();
  });

  it('emits the facility name only when in a facility', () => {
    let d = withDetail({ inMedicalFacility: true, medicalFacilityName: 'Sunrise Care' });
    expect(val(d, 'household.disability_detail.0.medical_facility_name')).toBe('Sunrise Care');
    d = withDetail({ inMedicalFacility: false, medicalFacilityName: 'Sunrise Care' });
    expect(val(d, 'household.disability_detail.0.medical_facility_name')).toBeUndefined();
  });

  it('emits the duration choice as the form words it', () => {
    const d = withDetail({ expectedDuration: 'twelve_months_or_more' });
    expect(val(d, 'household.disability_detail.0.expected_duration')).toBe('twelve_months_or_more');
  });

  it('keeps two people in separate records', () => {
    let d = w(limited(), 'circumstances.disabilityDetails.answer', true);
    d = w(d, 'circumstances.disabilityDetails.entries', [
      detail({ id: 'd1', memberId: 'm1', inMedicalFacility: true }),
      detail({ id: 'd2', memberId: 'applicant', inMedicalFacility: false }),
    ]);
    expect(val(d, 'household.disability_detail.0.person_name')).toBe('Rosa Marin');
    expect(val(d, 'household.disability_detail.1.person_name')).toBe('Maria Delgado');
    expect(val(d, 'household.disability_detail.0.in_medical_facility')).toBe(true);
    expect(val(d, 'household.disability_detail.1.in_medical_facility')).toBe(false);
  });
});

describe('legacy payloads', () => {
  it('survives a questionnaire with no disabilityDetails', () => {
    const d = limited();
    const circ = { ...d.questionnaire.circumstances } as Record<string, unknown>;
    delete circ.disabilityDetails;
    const legacy = {
      ...d,
      questionnaire: { ...d.questionnaire, circumstances: circ as unknown as typeof d.questionnaire.circumstances },
    };
    expect(() => getRequiredApplicationQuestions(legacy)).not.toThrow();
    expect(() => buildApplicationFieldPlan(legacy, {})).not.toThrow();
    expect(ids(legacy).has('circumstances.disability_details.records')).toBe(true);
  });
});

describe('schema and inventory', () => {
  it('records Q6j', () => {
    expect(SAWS2_FIELD_BY_ID.get('circumstances.disability_details')?.saws).toBe('Q6j');
  });

  it('is no longer unmodeled', () => {
    expect(buildInventory().find((e) => e.saws === 'Q6j')?.status).toBe('collected_and_mapped');
  });
});
