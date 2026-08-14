//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The Q23 tax household: Q23b filer, Q23c spouse, Q23d/Q23e dependents.
 *
 * Two things the printed form is strict about and this product must not blur:
 *
 * - a tax dependent is not necessarily a household member, so the model must be
 *   able to name someone who lives elsewhere rather than borrow a member id;
 * - a tax relationship is not the Q6 household relationship, so Q23e is asked
 *   rather than inferred from "son" already appearing in the household table.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory } from '@/lib/saws2-inventory';
import {
  getRequiredApplicationQuestions,
  writePath,
} from '@/lib/saws2-question-planner';
import { SAWS2_FIELD_BY_ID } from '@/lib/saws2-schema';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

function member(id: string, first: string, last: string): HouseholdMember {
  return {
    id,
    firstName: first,
    middleName: '',
    lastName: last,
    dateOfBirth: '2015-05-05',
    relationshipToApplicant: 'Daughter',
  };
}

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: [member('m1', 'Sofia', 'Delgado')],
  };
}

function write(
  data: Saws2PlusApplicationData,
  path: string,
  value: unknown,
): Saws2PlusApplicationData {
  return { ...data, questionnaire: writePath(data.questionnaire, path, value) };
}

function outstanding(data: Saws2PlusApplicationData): Set<string> {
  return new Set(
    getRequiredApplicationQuestions(data).outstanding.map((q) => q.id),
  );
}

function planValue(data: Saws2PlusApplicationData, key: string): unknown {
  return buildApplicationFieldPlan(data, {}).find((e) => e.key === key)?.value;
}

/** A household that plans to file, so the tax block is active. */
function filing(): Saws2PlusApplicationData {
  return write(seed(), 'health.taxFiler', true);
}

describe('the tax block is gated on Q23', () => {
  it('asks nothing about the tax household while Q23 is unanswered', () => {
    const ids = outstanding(seed());

    for (const id of [
      'health.tax_filer_person',
      'health.spouse_filing_jointly',
      'health.tax_dependents',
    ]) {
      expect(ids.has(id), id).toBe(false);
    }
  });

  it('asks nothing about the tax household when Q23 is No', () => {
    const ids = outstanding(write(seed(), 'health.taxFiler', false));

    for (const id of [
      'health.tax_filer_person',
      'health.spouse_filing_jointly',
      'health.tax_dependents',
    ]) {
      expect(ids.has(id), id).toBe(false);
    }
  });

  it('asks the filer, joint filing and dependents once Q23 is Yes', () => {
    const ids = outstanding(filing());

    expect(ids.has('health.tax_filer_person')).toBe(true);
    expect(ids.has('health.spouse_filing_jointly')).toBe(true);
    expect(ids.has('health.tax_dependents')).toBe(true);
  });

  it('emits no tax lines at all when Q23 is No', () => {
    // Even with stale answers left behind by an earlier Yes.
    let data = filing();
    data = write(data, 'health.taxFilerName', 'Maria Delgado');
    data = write(data, 'health.spouseFilingJointly', true);
    data = write(data, 'health.spouseName', 'Luis Delgado');
    data = write(data, 'health.taxDependents.answer', true);

    expect(planValue(data, 'health.tax_filer_name')).toBe('Maria Delgado');

    data = write(data, 'health.taxFiler', false);

    for (const key of [
      'health.tax_filer_name',
      'health.spouse_name',
      'health.has_tax_dependents',
      'health.tax_dependent_names',
      'health.tax_dependent_relationships',
    ]) {
      expect(planValue(data, key), key).toBeUndefined();
    }
  });
});

describe('Q23b — who is filing', () => {
  it('offers the household members as choices', () => {
    const question = getRequiredApplicationQuestions(filing()).outstanding.find(
      (q) => q.id === 'health.tax_filer_person',
    );

    expect(question?.kind).toBe('choice');
    expect(question?.options?.map((o) => o.value)).toContain('applicant');
    expect(question?.options?.map((o) => o.value)).toContain('m1');
  });

  it('prints the member’s real name when a member is chosen', () => {
    const data = write(filing(), 'health.taxFilerMemberId', 'applicant');

    expect(planValue(data, 'health.tax_filer_name')).toBe('Maria Delgado');
    expect(outstanding(data).has('health.tax_filer_person')).toBe(false);
  });

  it('accepts a filer who is not a household member', () => {
    const data = write(filing(), 'health.taxFilerName', 'Ana Ruiz');

    expect(planValue(data, 'health.tax_filer_name')).toBe('Ana Ruiz');
    expect(outstanding(data).has('health.tax_filer_person')).toBe(false);
  });
});

describe('Q23c — the spouse', () => {
  it('asks for a name only after joint filing is Yes', () => {
    let data = write(filing(), 'health.spouseFilingJointly', false);
    expect(outstanding(data).has('health.spouse_name')).toBe(false);

    data = write(filing(), 'health.spouseFilingJointly', true);
    expect(outstanding(data).has('health.spouse_name')).toBe(true);
  });

  it('does not print a stale spouse name after Yes becomes No', () => {
    let data = write(filing(), 'health.spouseFilingJointly', true);
    data = write(data, 'health.spouseName', 'Luis Delgado');

    expect(planValue(data, 'health.spouse_name')).toBe('Luis Delgado');

    data = write(data, 'health.spouseFilingJointly', false);

    expect(planValue(data, 'health.spouse_name')).toBeUndefined();
  });
});

describe('Q23d / Q23e — dependents', () => {
  const withDependents = (
    entries: Array<Record<string, unknown>>,
  ): Saws2PlusApplicationData => {
    let data = write(filing(), 'health.taxDependents.answer', true);
    return write(data, 'health.taxDependents.entries', entries);
  };

  it('asks for at least one dependent after Yes', () => {
    const data = write(filing(), 'health.taxDependents.answer', true);

    expect(outstanding(data).has('health.tax_dependents.records')).toBe(true);
  });

  it('asks Q23e for every dependent that has no relationship yet', () => {
    const data = withDependents([
      { id: 'd1', memberId: 'm1', name: '', relationshipToFiler: '' },
      { id: 'd2', memberId: undefined, name: 'Mateo Ruiz', relationshipToFiler: '' },
    ]);

    const ids = outstanding(data);

    expect(ids.has('health.tax_dependents.0.relationshipToFiler')).toBe(true);
    expect(ids.has('health.tax_dependents.1.relationshipToFiler')).toBe(true);
  });

  it('never infers the tax relationship from the household relationship', () => {
    // Sofia is the applicant's daughter in the Q6 table; Q23e is still asked.
    const data = withDependents([
      { id: 'd1', memberId: 'm1', name: '', relationshipToFiler: '' },
    ]);

    expect(
      outstanding(data).has('health.tax_dependents.0.relationshipToFiler'),
    ).toBe(true);
    expect(planValue(data, 'health.tax_dependent_relationships')).toBeUndefined();
  });

  it('resolves a household dependent to their real name', () => {
    const data = withDependents([
      { id: 'd1', memberId: 'm1', name: '', relationshipToFiler: 'Daughter' },
    ]);

    expect(planValue(data, 'health.tax_dependent_names')).toBe('Sofia Delgado');
    expect(planValue(data, 'health.tax_dependent_relationships')).toBe('Daughter');
  });

  it('supports a dependent who is not in the household', () => {
    const data = withDependents([
      { id: 'd1', memberId: undefined, name: 'Mateo Ruiz', relationshipToFiler: 'Nephew' },
    ]);

    expect(planValue(data, 'health.tax_dependent_names')).toBe('Mateo Ruiz');
    expect(planValue(data, 'health.tax_dependent_relationships')).toBe('Nephew');
  });

  it('joins several dependents onto the single printed line', () => {
    const data = withDependents([
      { id: 'd1', memberId: 'm1', name: '', relationshipToFiler: 'Daughter' },
      { id: 'd2', memberId: undefined, name: 'Mateo Ruiz', relationshipToFiler: 'Nephew' },
    ]);

    expect(planValue(data, 'health.tax_dependent_names')).toBe(
      'Sofia Delgado, Mateo Ruiz',
    );
    expect(planValue(data, 'health.tax_dependent_relationships')).toBe(
      'Daughter, Nephew',
    );
  });

  it('drops dependent detail when the gateway becomes No', () => {
    let data = withDependents([
      { id: 'd1', memberId: 'm1', name: '', relationshipToFiler: 'Daughter' },
    ]);

    expect(planValue(data, 'health.tax_dependent_names')).toBe('Sofia Delgado');

    data = write(data, 'health.taxDependents.answer', false);

    expect(planValue(data, 'health.has_tax_dependents')).toBe(false);
    expect(planValue(data, 'health.tax_dependent_names')).toBeUndefined();
    expect(planValue(data, 'health.tax_dependent_relationships')).toBeUndefined();
  });
});

describe('schema and inventory', () => {
  it.each([
    ['health.tax_filer_person', 'Q23b'],
    ['health.spouse_name', 'Q23c'],
    ['health.tax_dependents', 'Q23d'],
    ['health.tax_dependent_relationships', 'Q23e'],
  ])('%s carries printed number %s', (id, saws) => {
    expect(SAWS2_FIELD_BY_ID.get(id)?.saws).toBe(saws);
    expect(SAWS2_FIELD_BY_ID.get(id)?.pdf).toBe('mapped');
  });

  it.each(['Q23b', 'Q23d', 'Q23e'])(
    '%s is no longer reported as unmodeled',
    (saws) => {
      expect(buildInventory().find((e) => e.saws === saws)?.status).toBe(
        'collected_and_mapped',
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Payloads written against an older shape
// ---------------------------------------------------------------------------

/**
 * `applicationData` arrives as JSON from the client, so a session that started
 * before these fields existed sends a questionnaire without them. The draft
 * endpoint must still generate a PDF rather than returning a 500 — this is the
 * exact failure the live E2E caught after the tax block was added.
 */
describe('a questionnaire missing the new fields', () => {
  function legacy(): Saws2PlusApplicationData {
    const data = write(seed(), 'health.taxFiler', true);
    const health = { ...data.questionnaire.health } as Record<string, unknown>;

    // Simulate the older payload: these keys simply are not present.
    delete health.taxDependents;
    delete health.taxFilerName;
    delete health.taxFilerMemberId;
    delete health.spouseName;

    const circumstances = { ...data.questionnaire.circumstances } as Record<
      string,
      unknown
    >;
    delete circumstances.elderlyUnableToPrepareMealsWho;

    return {
      ...data,
      questionnaire: {
        ...data.questionnaire,
        health: health as unknown as typeof data.questionnaire.health,
        circumstances:
          circumstances as unknown as typeof data.questionnaire.circumstances,
      },
    };
  }

  it('builds a field plan without throwing', () => {
    expect(() => buildApplicationFieldPlan(legacy(), {})).not.toThrow();
  });

  it('plans questions without throwing', () => {
    expect(() => getRequiredApplicationQuestions(legacy())).not.toThrow();
  });

  it('still asks for the missing tax answers', () => {
    const ids = outstanding(legacy());

    expect(ids.has('health.tax_filer_person')).toBe(true);
    expect(ids.has('health.tax_dependents')).toBe(true);
  });

  it('emits no tax dependent answer it does not have', () => {
    expect(planValue(legacy(), 'health.has_tax_dependents')).toBeUndefined();
    expect(planValue(legacy(), 'health.tax_dependent_names')).toBeUndefined();
  });

  it('survives a spouse-name read when joint filing is Yes', () => {
    const data = write(legacy(), 'health.spouseFilingJointly', true);

    expect(() => buildApplicationFieldPlan(data, {})).not.toThrow();
    expect(planValue(data, 'health.spouse_name')).toBeUndefined();
  });

  it('survives the Q21a who-line read', () => {
    let data = write(legacy(), 'circumstances.buysAndPreparesFoodTogether', false);
    data = write(data, 'circumstances.elderlyUnableToPrepareMealsSeparately', true);

    expect(() => getRequiredApplicationQuestions(data)).not.toThrow();
    expect(() => buildApplicationFieldPlan(data, {})).not.toThrow();
  });
})
