import { describe, expect, it } from 'vitest';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory } from '@/lib/saws2-inventory';
import { appendixEApplies, getActiveAppendices, getRequiredApplicationQuestions, writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

function seed(programs: Saws2PlusApplicationData['selectedPrograms'] = ['medi_cal']): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: programs,
    applicant: { ...EMPTY_APPLICATION_DATA.applicant, firstName: 'Maria', lastName: 'Delgado', dateOfBirth: '1990-01-01' },
    householdMembers: [],
  };
}
const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({ ...d, questionnaire: writePath(d.questionnaire, p, v) });
const ids = (d: Saws2PlusApplicationData) => new Set(getRequiredApplicationQuestions(d).outstanding.map((q) => q.id));
const val = (d: Saws2PlusApplicationData, k: string) => buildApplicationFieldPlan(d, {}).find((e) => e.key === k)?.value;

const withVehicle = (d: Saws2PlusApplicationData, over: Record<string, unknown> = {}) => {
  let x = w(d, 'resources.vehicles.answer', true);
  x = w(x, 'appendices.vehicleDetails.answer', true);
  return w(x, 'appendices.vehicleDetails.entries', [{
    id: 'v1', ownerMemberId: 'applicant', userMemberId: 'applicant',
    yearMakeModel: '2012 Toyota Corolla', vehicleLicenseNumber: '7ABC123',
    fairMarketValueSourceOther: '', amountOwedSourceOther: '', ...over,
  }]);
};

describe('Appendix E applicability', () => {
  it('does not apply to a plain Medi-Cal household with no elderly or disabled member', () => {
    expect(appendixEApplies(seed(['medi_cal']))).toBe(false);
  });

  it('applies for cash aid', () => {
    expect(appendixEApplies(seed(['calworks']))).toBe(true);
  });

  it('is not asked when it does not apply, even with a vehicle', () => {
    const d = w(seed(['medi_cal']), 'resources.vehicles.answer', true);
    expect(ids(d).has('appendices.vehicle_details.records')).toBe(false);
  });

  it('is asked for cash aid with a vehicle', () => {
    const d = w(seed(['calworks']), 'resources.vehicles.answer', true);
    expect(ids(d).has('appendices.vehicle_details.records')).toBe(true);
  });

  it('is not asked when Q26 says there is no vehicle', () => {
    const d = w(seed(['calworks']), 'resources.vehicles.answer', false);
    expect(ids(d).has('appendices.vehicle_details.records')).toBe(false);
  });

  it('uses one definition shared with the appendix list', () => {
    const d = withVehicle(seed(['calworks']));
    expect(getActiveAppendices(d).map((a) => a.id)).toContain('E');
  });
});

describe('Appendix E mapping', () => {
  it('keeps owner and user as separate facts', () => {
    const d = withVehicle(seed(['calworks']), { ownerMemberId: 'applicant', userMemberId: 'applicant' });
    expect(val(d, 'appendices.vehicle.0.owner_name')).toBe('Maria Delgado');
    expect(val(d, 'appendices.vehicle.0.user_name')).toBe('Maria Delgado');
  });

  it('emits the transfer kind only when the transfer answer is Yes', () => {
    let d = withVehicle(seed(['calworks']), { isGiftDonationOrTransfer: true, transferKind: 'family_transfer' });
    expect(val(d, 'appendices.vehicle.0.transfer_kind')).toBe('family_transfer');
    d = withVehicle(seed(['calworks']), { isGiftDonationOrTransfer: false, transferKind: 'family_transfer' });
    expect(val(d, 'appendices.vehicle.0.transfer_kind')).toBeUndefined();
  });

  it('emits the other-source text only for the other choice', () => {
    let d = withVehicle(seed(['calworks']), { fairMarketValueSource: 'other', fairMarketValueSourceOther: 'Dealer quote' });
    expect(val(d, 'appendices.vehicle.0.fair_market_value_source_other')).toBe('Dealer quote');
    d = withVehicle(seed(['calworks']), { fairMarketValueSource: 'mechanic', fairMarketValueSourceOther: 'stale' });
    expect(val(d, 'appendices.vehicle.0.fair_market_value_source_other')).toBeUndefined();
  });

  it('stops emitting detail when Q26 becomes No', () => {
    let d = withVehicle(seed(['calworks']), { isLeased: true });
    expect(val(d, 'appendices.vehicle.0.is_leased')).toBe(true);
    d = w(d, 'resources.vehicles.answer', false);
    expect(val(d, 'appendices.vehicle.0.is_leased')).toBeUndefined();
    expect(val(d, 'appendices.vehicle.0.owner_name')).toBeUndefined();
  });

  it('survives a legacy questionnaire with no vehicleDetails', () => {
    const d = w(seed(['calworks']), 'resources.vehicles.answer', true);
    const apx = { ...d.questionnaire.appendices } as Record<string, unknown>;
    delete apx.vehicleDetails;
    const legacy = { ...d, questionnaire: { ...d.questionnaire, appendices: apx as unknown as typeof d.questionnaire.appendices } };
    expect(() => getRequiredApplicationQuestions(legacy)).not.toThrow();
    expect(() => buildApplicationFieldPlan(legacy, {})).not.toThrow();
    expect(ids(legacy).has('appendices.vehicle_details.records')).toBe(true);
  });

  it('is no longer unmodeled', () => {
    expect(buildInventory().find((e) => e.saws === 'Appendix E')?.status).toBe('collected_and_mapped');
  });
});
