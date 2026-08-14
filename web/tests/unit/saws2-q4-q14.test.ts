import { describe, expect, it } from 'vitest';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory } from '@/lib/saws2-inventory';
import { getRequiredApplicationQuestions, writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    applicant: { ...EMPTY_APPLICATION_DATA.applicant, firstName: 'A', lastName: 'B', dateOfBirth: '1990-01-01' },
    householdMembers: [],
  };
}
const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({
  ...d, questionnaire: writePath(d.questionnaire, p, v),
});
const ids = (d: Saws2PlusApplicationData) =>
  new Set(getRequiredApplicationQuestions(d).outstanding.map((q) => q.id));
const val = (d: Saws2PlusApplicationData, k: string) =>
  buildApplicationFieldPlan(d, {}).find((e) => e.key === k)?.value;

const SUBS = [
  ['specialDiet', 'diet'], ['specialPhoneOrEquipment', 'phone_or_equipment'],
  ['housework', 'housework'], ['highUtilityUse', 'high_utility_use'],
  ['specialLaundry', 'laundry'], ['otherSpecialNeed', 'other'],
] as const;

describe('Q14 six independent sub-questions', () => {
  it.each(SUBS)('%s is asked, answerable, and emitted', (path, key) => {
    expect(ids(seed()).has(`expenses.special_needs.${path}`)).toBe(true);
    const yes = w(seed(), `expenses.specialNeedsExpenses.${path}`, true);
    expect(ids(yes).has(`expenses.special_needs.${path}`)).toBe(false);
    expect(val(yes, `expenses.special_need.${key}`)).toBe(true);
    const no = w(seed(), `expenses.specialNeedsExpenses.${path}`, false);
    expect(val(no, `expenses.special_need.${key}`)).toBe(false);
  });

  it('a No to one says nothing about the others', () => {
    const d = w(seed(), 'expenses.specialNeedsExpenses.specialDiet', false);
    expect(val(d, 'expenses.special_need.diet')).toBe(false);
    for (const [, key] of SUBS.slice(1)) {
      expect(val(d, `expenses.special_need.${key}`)).toBeUndefined();
    }
  });

  it('asks the shared explanation only once something is Yes', () => {
    expect(ids(seed()).has('expenses.special_needs.person')).toBe(false);
    const d = w(seed(), 'expenses.specialNeedsExpenses.housework', true);
    expect(ids(d).has('expenses.special_needs.person')).toBe(true);
  });

  it('drops the explanation when every answer becomes No', () => {
    let d = w(seed(), 'expenses.specialNeedsExpenses.housework', true);
    d = w(d, 'expenses.specialNeedsExpenses.personAndExplanation', 'Rosa – mobility');
    expect(val(d, 'expenses.special_need.person')).toBe('Rosa – mobility');
    d = w(d, 'expenses.specialNeedsExpenses.housework', false);
    expect(val(d, 'expenses.special_need.person')).toBeUndefined();
  });

  it('asks and drops the other-description with its own answer', () => {
    let d = w(seed(), 'expenses.specialNeedsExpenses.otherSpecialNeed', true);
    expect(ids(d).has('expenses.special_needs.other_description')).toBe(true);
    d = w(d, 'expenses.specialNeedsExpenses.otherSpecialNeedDescription', 'Ramp');
    expect(val(d, 'expenses.special_need.other_description')).toBe('Ramp');
    d = w(d, 'expenses.specialNeedsExpenses.otherSpecialNeed', false);
    expect(val(d, 'expenses.special_need.other_description')).toBeUndefined();
  });
});

describe('Q4 interview preference', () => {
  it('asks both independent checkboxes', () => {
    const s = ids(seed());
    expect(s.has('preferences.in_person_interview')).toBe(true);
    expect(s.has('preferences.interview_disability_arrangements')).toBe(true);
  });

  it('emits each answer separately', () => {
    const d = { ...seed(), preferences: { ...seed().preferences, prefersInPersonInterview: true } };

    expect(val(d, 'applicant.prefers_in_person_interview')).toBe(true);
    // The plan drops null-valued entries, so an unanswered checkbox emits
    // nothing at all and its box stays unticked.
    expect(val(d, 'applicant.needs_disability_interview_arrangements')).toBeUndefined();
  });
});

describe('legacy payloads', () => {
  it('survives a questionnaire with no specialNeedsExpenses', () => {
    const d = seed();
    const expenses = { ...d.questionnaire.expenses } as Record<string, unknown>;
    delete expenses.specialNeedsExpenses;
    const legacy = {
      ...d,
      questionnaire: { ...d.questionnaire, expenses: expenses as unknown as typeof d.questionnaire.expenses },
    };
    expect(() => getRequiredApplicationQuestions(legacy)).not.toThrow();
    expect(() => buildApplicationFieldPlan(legacy, {})).not.toThrow();
    expect(ids(legacy).has('expenses.special_needs.specialDiet')).toBe(true);
  });

  it('survives an application with no preferences object', () => {
    const legacy = { ...seed(), preferences: undefined as unknown as Saws2PlusApplicationData['preferences'] };
    expect(() => getRequiredApplicationQuestions(legacy)).not.toThrow();
  });
});

describe('inventory', () => {
  it.each(['Q4', 'Q14'])('%s is no longer unmodeled', (saws) => {
    expect(buildInventory().find((e) => e.saws === saws)?.status).toBe('collected_and_mapped');
  });
});
