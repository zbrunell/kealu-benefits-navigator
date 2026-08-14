import { describe, expect, it } from 'vitest';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory } from '@/lib/saws2-inventory';
import { getRequiredApplicationQuestions, writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    applicant: { ...EMPTY_APPLICATION_DATA.applicant, firstName: 'Maria', lastName: 'Delgado', dateOfBirth: '1990-01-01' },
    householdMembers: [],
  };
}
const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({ ...d, questionnaire: writePath(d.questionnaire, p, v) });
const ids = (d: Saws2PlusApplicationData) => new Set(getRequiredApplicationQuestions(d).outstanding.map((q) => q.id));
const val = (d: Saws2PlusApplicationData, k: string) => buildApplicationFieldPlan(d, {}).find((e) => e.key === k)?.value;

describe('Q25 personal property', () => {
  it('is asked and is distinct from Q24', () => {
    const s = ids(seed());
    expect(s.has('resources.personal_property')).toBe(true);
    expect(s.has('resources.accounts')).toBe(true);
  });

  it('answering Q24 does not answer Q25', () => {
    const d = w(seed(), 'resources.accounts.answer', false);
    expect(val(d, 'resources.has_accounts')).toBe(false);
    expect(val(d, 'resources.has_personal_property')).toBeUndefined();
    expect(ids(d).has('resources.personal_property')).toBe(true);
  });

  it('asks for items after Yes', () => {
    const d = w(seed(), 'resources.personalProperty.answer', true);
    expect(ids(d).has('resources.personal_property.records')).toBe(true);
  });

  it('emits categories and items only while Yes', () => {
    let d = w(seed(), 'resources.personalProperty.answer', true);
    d = w(d, 'resources.personalPropertyCategories', ['livestock', 'personal_tools']);
    d = w(d, 'resources.personalProperty.entries', [
      { id: 'p1', memberId: 'applicant', item: 'Table saw', listedForSale: false, purchasePriceOrCurrentValue: 600 },
    ]);

    expect(val(d, 'resources.personal_property.category.livestock')).toBe(true);
    expect(val(d, 'resources.personal_property.category.personal_tools')).toBe(true);
    expect(val(d, 'resources.personal_property.category.tools')).toBeUndefined();
    expect(val(d, 'resources.personal_property.0.item')).toBe('Table saw');
    expect(val(d, 'resources.personal_property.0.listed_for_sale')).toBe(false);
    expect(val(d, 'resources.personal_property.0.person_name')).toBe('Maria Delgado');

    d = w(d, 'resources.personalProperty.answer', false);
    expect(val(d, 'resources.has_personal_property')).toBe(false);
    expect(val(d, 'resources.personal_property.category.livestock')).toBeUndefined();
    expect(val(d, 'resources.personal_property.0.item')).toBeUndefined();
  });

  it('survives a legacy questionnaire with no personalProperty', () => {
    const d = seed();
    const res = { ...d.questionnaire.resources } as Record<string, unknown>;
    delete res.personalProperty;
    delete res.personalPropertyCategories;
    const legacy = { ...d, questionnaire: { ...d.questionnaire, resources: res as unknown as typeof d.questionnaire.resources } };
    expect(() => getRequiredApplicationQuestions(legacy)).not.toThrow();
    expect(() => buildApplicationFieldPlan(legacy, {})).not.toThrow();
    expect(ids(legacy).has('resources.personal_property')).toBe(true);
  });

  it('is no longer unmodeled', () => {
    expect(buildInventory().find((e) => e.saws === 'Q25')?.status).toBe('collected_and_mapped');
  });
});
