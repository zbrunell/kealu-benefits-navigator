//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Newly modeled printed questions: Q2a, Q6i, Q6k, Q6m, Q6n, Q6o and Q21a.
 *
 * Each is checked end to end — schema entry, planner behaviour, conditional
 * activation, and canonical emission — because a question modeled in one layer
 * and forgotten in another is exactly the failure this phase exists to prevent.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInventory } from '@/lib/saws2-inventory';
import {
  getRequiredApplicationQuestions,
  readPath,
  writePath,
} from '@/lib/saws2-question-planner';
import { SAWS2_FIELD_BY_ID } from '@/lib/saws2-schema';
import {
  EMPTY_APPLICATION_DATA,
  type Saws2PlusApplicationData,
} from '@/types/application';

/** Every question added in this phase: schema id, printed number, path, key. */
const NEW_QUESTIONS = [
  {
    id: 'circumstances.health_coverage_representative',
    saws: 'Q2a',
    path: 'circumstances.healthCoverageRepresentative',
    key: 'household.health_coverage_representative',
  },
  {
    id: 'circumstances.disability_limits_activities',
    saws: 'Q6i',
    path: 'circumstances.disabilityLimitsActivities',
    key: 'household.disability_limits_activities',
  },
  {
    id: 'circumstances.needs_care_from_member',
    saws: 'Q6k',
    path: 'circumstances.needsCareFromHouseholdMember',
    key: 'household.needs_care_from_member',
  },
  {
    id: 'circumstances.pregnant_or_teen_parent',
    saws: 'Q6m',
    path: 'circumstances.pregnantOrTeenParent',
    key: 'household.pregnant_or_teen_parent',
  },
  {
    id: 'circumstances.cal_learn',
    saws: 'Q6n',
    path: 'circumstances.calLearnHistory',
    key: 'household.cal_learn_history',
  },
  {
    id: 'circumstances.ever_in_foster_care',
    saws: 'Q6o',
    path: 'circumstances.everInFosterCare',
    key: 'household.ever_in_foster_care',
  },
] as const;

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: [],
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

function planValue(
  data: Saws2PlusApplicationData,
  key: string,
): unknown {
  return buildApplicationFieldPlan(data, {}).find((e) => e.key === key)?.value;
}

describe.each(NEW_QUESTIONS)('$saws ($id)', (question) => {
  it('has a schema entry with the right printed number', () => {
    const field = SAWS2_FIELD_BY_ID.get(question.id);

    expect(field).toBeDefined();
    expect(field?.saws).toBe(question.saws);
    expect(field?.path).toBe(question.path);
    expect(field?.canonicalKey).toBe(question.key);
    expect(field?.support).toBe('askable');
  });

  it('appears in the inventory as collected and mapped', () => {
    const entry = buildInventory().find((e) => e.saws === question.saws);

    expect(entry?.status).toBe('collected_and_mapped');
    expect(entry?.schemaIds).toContain(question.id);
  });

  it('is asked while unanswered', () => {
    expect(outstanding(seed()).has(question.id)).toBe(true);
  });

  it('stops being asked once answered Yes', () => {
    const data = write(seed(), question.path, true);

    expect(outstanding(data).has(question.id)).toBe(false);
  });

  it('stops being asked once answered No', () => {
    const data = write(seed(), question.path, false);

    expect(readPath(data.questionnaire, question.path)).toBe(false);
    expect(outstanding(data).has(question.id)).toBe(false);
  });

  it('reaches the canonical plan as a real boolean', () => {
    expect(planValue(write(seed(), question.path, true), question.key)).toBe(
      true,
    );
    expect(planValue(write(seed(), question.path, false), question.key)).toBe(
      false,
    );
  });

  it('emits nothing while unanswered', () => {
    expect(planValue(seed(), question.key)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Q2a is not a follow-up to Q2
// ---------------------------------------------------------------------------

describe('Q2 and Q2a are independent', () => {
  it('asks Q2a even after Q2 is answered No', () => {
    // Q2 appoints a CalFresh representative; Q2a a health-coverage one. The
    // printed form asks them separately, so a No to one settles nothing.
    const data = write(seed(), 'circumstances.authorizedRepresentative.answer', false);

    expect(outstanding(data).has('circumstances.health_coverage_representative')).toBe(
      true,
    );
  });

  it('asks Q2 even after Q2a is answered No', () => {
    const data = write(seed(), 'circumstances.healthCoverageRepresentative', false);

    expect(outstanding(data).has('circumstances.authorized_representative')).toBe(true);
  });

  it('keeps their canonical answers separate', () => {
    let data = write(seed(), 'circumstances.authorizedRepresentative.answer', false);
    data = write(data, 'circumstances.healthCoverageRepresentative', true);

    expect(planValue(data, 'household.authorized_representative')).toBe(false);
    expect(planValue(data, 'household.health_coverage_representative')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Q21a is conditional on Q21
// ---------------------------------------------------------------------------

describe('Q21a follows Q21', () => {
  const Q21 = 'circumstances.buysAndPreparesFoodTogether';
  const Q21A = 'circumstances.elderly_separate_meals';

  it('is not asked while Q21 is unanswered', () => {
    expect(outstanding(seed()).has(Q21A)).toBe(false);
  });

  it('is not asked when the household all buys and prepares food together', () => {
    // A household that already eats together has ruled this situation out.
    const data = write(seed(), Q21, true);

    expect(outstanding(data).has(Q21A)).toBe(false);
  });

  it('is asked once Q21 is No', () => {
    const data = write(seed(), Q21, false);

    expect(outstanding(data).has(Q21A)).toBe(true);
  });

  it('disappears again if Q21 is changed back to Yes', () => {
    let data = write(seed(), Q21, false);
    expect(outstanding(data).has(Q21A)).toBe(true);

    data = write(data, Q21, true);
    expect(outstanding(data).has(Q21A)).toBe(false);
  });

  it('asks who only after a Yes', () => {
    let data = write(seed(), Q21, false);
    data = write(data, 'circumstances.elderlyUnableToPrepareMealsSeparately', false);

    expect(outstanding(data).has('circumstances.elderly_separate_meals_who')).toBe(
      false,
    );

    data = write(data, 'circumstances.elderlyUnableToPrepareMealsSeparately', true);
    expect(outstanding(data).has('circumstances.elderly_separate_meals_who')).toBe(
      true,
    );
  });

  it('does not emit the who line when the answer is No', () => {
    // Stale child data must not reach the form after a Yes -> No change.
    let data = write(seed(), Q21, false);
    data = write(data, 'circumstances.elderlyUnableToPrepareMealsSeparately', true);
    data = write(data, 'circumstances.elderlyUnableToPrepareMealsWho', 'Rosa Marin');

    expect(planValue(data, 'household.elderly_unable_to_prepare_meals_who')).toBe(
      'Rosa Marin',
    );

    data = write(data, 'circumstances.elderlyUnableToPrepareMealsSeparately', false);

    expect(planValue(data, 'household.elderly_unable_to_prepare_meals')).toBe(false);
    expect(
      planValue(data, 'household.elderly_unable_to_prepare_meals_who'),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Q6o and Q6p ask different things
// ---------------------------------------------------------------------------

describe('Q6o and Q6p are distinct', () => {
  it('asks both', () => {
    const ids = outstanding(seed());

    expect(ids.has('circumstances.ever_in_foster_care')).toBe(true);
    expect(ids.has('circumstances.foster_care')).toBe(true);
  });

  it('keeps opposite answers apart', () => {
    // Someone was in foster care in the past; no foster child lives there now.
    let data = write(seed(), 'circumstances.everInFosterCare', true);
    data = write(data, 'circumstances.fosterCare.answer', false);

    expect(planValue(data, 'household.ever_in_foster_care')).toBe(true);
    expect(planValue(data, 'household.foster_care')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multi-question interaction
// ---------------------------------------------------------------------------

describe('answering the whole new block', () => {
  it('removes every new question and emits every answer', () => {
    let data = seed();

    for (const question of NEW_QUESTIONS) {
      data = write(data, question.path, false);
    }
    data = write(data, 'circumstances.buysAndPreparesFoodTogether', false);
    data = write(data, 'circumstances.elderlyUnableToPrepareMealsSeparately', false);

    const ids = outstanding(data);

    for (const question of NEW_QUESTIONS) {
      expect(ids.has(question.id), question.saws).toBe(false);
      expect(planValue(data, question.key), question.saws).toBe(false);
    }

    expect(ids.has('circumstances.elderly_separate_meals')).toBe(false);
    expect(planValue(data, 'household.elderly_unable_to_prepare_meals')).toBe(false);
  });

  it('never emits a sensitive key for any of them', () => {
    let data = seed();
    for (const question of NEW_QUESTIONS) data = write(data, question.path, true);

    for (const field of buildApplicationFieldPlan(data, {})) {
      expect(field.key).not.toMatch(/ssn|social_security|signature/i);
    }
  });
});
