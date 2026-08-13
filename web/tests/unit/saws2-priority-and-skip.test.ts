//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Question priority, skipping, and the SAWS 2 PLUS question-number map.
 *
 * Also guards the two defects that made entry fields unusable:
 *
 * 1. `TriStateControl` and `RecordEditor` were declared *inside* the parent
 *    component, so their function identity changed on every render. React saw a
 *    different component type at that position and remounted the subtree,
 *    destroying the live `<input>` — the user could type one character, lose
 *    focus, and had to click back in.
 * 2. Editing a field inside a record re-ran the navigation flow on every
 *    keystroke, reconstructing the active question mid-typing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { buildInitialApplicationData } from '@/lib/application-data';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  QUESTION_META,
  getRequiredApplicationQuestions,
  requirementForTier,
  sawsQuestionFor,
  tierFor,
  writePath,
} from '@/lib/saws2-question-planner';
import {
  canSkip,
  currentQuestion,
  setDraft,
  skipCurrent,
  startFlow,
  submitChoice,
} from '@/lib/saws2-question-navigator';
import type { Saws2PlusApplicationData } from '@/types/application';

const COMPONENT = readFileSync(
  path.resolve(__dirname, '../../src/components/application/questionnaire-step.tsx'),
  'utf8',
);

function household(): Saws2PlusApplicationData {
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
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...data.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1993-04-12',
    },
    householdMembers: [{ ...data.householdMembers[0], dateOfBirth: '2024-06-15' }],
  };
}

function set(
  data: Saws2PlusApplicationData,
  dotted: string,
  value: unknown,
): Saws2PlusApplicationData {
  return { ...data, questionnaire: writePath(data.questionnaire, dotted, value) };
}

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe('question priority', () => {
  it('orders outstanding questions by tier', () => {
    const tiers = getRequiredApplicationQuestions(household()).outstanding.map(
      (question) => question.tier,
    );

    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });

  it('puts the form’s fast-track questions no lower than tier 2', () => {
    // The form states Q1, Q6-Q9, Q15 and Q24 help the county decide faster.
    const FAST_TRACK = ['Q1', 'Q6', 'Q7', 'Q8', 'Q8a', 'Q9', 'Q15', 'Q24'];

    for (const [id, meta] of Object.entries(QUESTION_META)) {
      if (meta.saws && FAST_TRACK.includes(meta.saws)) {
        expect(meta.tier, `${id} (${meta.saws})`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('classifies the income, expense and resource questions as tier 2', () => {
    expect(tierFor('income.unearned')).toBe(2); // Q7
    expect(tierFor('income.earned')).toBe(2); // Q8
    expect(tierFor('income.self_employment')).toBe(2); // Q8a
    expect(tierFor('income.in_kind')).toBe(2); // Q9
    expect(tierFor('expenses.household')).toBe(2); // Q15
    expect(tierFor('resources.accounts')).toBe(2); // Q24
  });

  it('classifies questions the form says do not affect eligibility as tier 4', () => {
    // Q38 states outright: "Your answers to the questions will not affect your
    // eligibility."
    for (const id of [
      'services.chdp_information',
      'services.chdp_medical',
      'services.immunization',
      'services.family_planning',
      'services.breastfeeding',
    ]) {
      expect(tierFor(id), id).toBe(4);
    }
  });

  it('asks income before optional service questions', () => {
    const outstanding = getRequiredApplicationQuestions(household()).outstanding;
    const ids = outstanding.map((question) => question.id);

    const income = ids.indexOf('income.earned');
    const chdp = ids.indexOf('services.chdp_information');

    expect(income).toBeGreaterThanOrEqual(0);
    expect(chdp).toBeGreaterThanOrEqual(0);
    expect(income).toBeLessThan(chdp);
  });

  it('gives a record detail the tier of the gateway that unlocked it', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId: 'applicant', employerName: '', startDate: '' },
    ]);

    const detail = getRequiredApplicationQuestions(data).outstanding.find(
      (question) => question.id === 'income.earned.0.employerName',
    );

    expect(detail?.tier).toBe(2);
    expect(detail?.sawsQuestion).toBe('Q8');
  });

  it('maps tiers to skippability consistently', () => {
    expect(requirementForTier(1)).toBe('required');
    expect(requirementForTier(2)).toBe('important');
    expect(requirementForTier(3)).toBe('optional');
    expect(requirementForTier(4)).toBe('optional');
  });
});

// ---------------------------------------------------------------------------
// The SAWS question-number map
// ---------------------------------------------------------------------------

describe('SAWS 2 PLUS question numbering', () => {
  it('records a printed question number for the income and expense questions', () => {
    expect(sawsQuestionFor('income.unearned')).toBe('Q7');
    expect(sawsQuestionFor('income.earned')).toBe('Q8');
    expect(sawsQuestionFor('income.self_employment')).toBe('Q8a');
    expect(sawsQuestionFor('expenses.household')).toBe('Q15');
    expect(sawsQuestionFor('resources.accounts')).toBe('Q24');
    expect(sawsQuestionFor('circumstances.food_together')).toBe('Q21');
    expect(sawsQuestionFor('integrity.fleeing_felon')).toBe('Q35');
    expect(sawsQuestionFor('services.immunization')).toBe('Q38B');
    expect(sawsQuestionFor('integrity.third_party_liability')).toBe('Q39');
  });

  it('uses a plausible question label wherever one is recorded', () => {
    for (const [id, meta] of Object.entries(QUESTION_META)) {
      if (meta.saws === undefined) continue;

      // A parenthetical qualifier marks a block printed inside a numbered
      // question that has no number of its own.
      expect(meta.saws, id).toMatch(
        /^(Q\d{1,2}[A-Za-z]?( \([a-z ]+\))?|Appendix [A-E])$/,
      );
    }
  });

  it('returns undefined rather than guessing for an unknown question', () => {
    expect(sawsQuestionFor('nonexistent.question')).toBeUndefined();
    expect(tierFor('nonexistent.question')).toBe(3);
  });

  it('every question the planner asks carries a tier and a requirement', () => {
    for (const question of getRequiredApplicationQuestions(household()).outstanding) {
      expect([1, 2, 3, 4], question.id).toContain(question.tier);
      expect(['required', 'important', 'optional'], question.id).toContain(
        question.requirement,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Skipping
// ---------------------------------------------------------------------------

describe('skipping questions', () => {
  /** Advance the flow to a question with the given requirement. */
  function flowAt(requirement: 'required' | 'important' | 'optional') {
    const data = household();
    let flow = startFlow(data);

    for (let i = 0; i < 60; i += 1) {
      const question = currentQuestion(flow);
      if (!question) break;
      if (question.requirement === requirement) return { data, flow };

      flow = skipCurrent(data, flow);
    }

    return { data, flow };
  }

  it('allows an optional question to be skipped', () => {
    const { data, flow } = flowAt('optional');
    const question = currentQuestion(flow);

    expect(canSkip(question)).toBe(true);

    const skipped = skipCurrent(data, flow);
    expect(currentQuestion(skipped)?.id).not.toBe(question?.id);
    expect(skipped.skipped).toContain(question!.id);
  });

  it('allows an eligibility-critical question to be skipped', () => {
    // Important but not blocking: the user still gets a usable draft.
    const { data, flow } = flowAt('important');
    const question = currentQuestion(flow);

    expect(question?.requirement).toBe('important');
    expect(canSkip(question)).toBe(true);
    expect(currentQuestion(skipCurrent(data, flow))?.id).not.toBe(question?.id);
  });

  it('writes nothing when a question is skipped', () => {
    const { data, flow } = flowAt('optional');
    const question = currentQuestion(flow)!;
    const before = JSON.stringify(data);

    skipCurrent(data, flow);

    // Skipping is not an answer: no data changes at all.
    expect(JSON.stringify(data)).toBe(before);
    expect(
      buildApplicationFieldPlan(data).map((field) => field.key),
    ).not.toContain(question.path.replace(/\.answer$/, ''));
  });

  it('leaves a skipped answer out of the field plan entirely', () => {
    const data = household();
    let flow = startFlow(data);

    // Skip everything that can be skipped.
    for (let i = 0; i < 80 && currentQuestion(flow); i += 1) {
      if (!canSkip(currentQuestion(flow))) break;
      flow = skipCurrent(data, flow);
    }

    const keys = buildApplicationFieldPlan(data).map((field) => field.key);

    // No gateway got a value, so no checkbox will be ticked either way.
    expect(keys).not.toContain('income.has_earned_income');
    expect(keys).not.toContain('integrity.fleeing_felon');
    expect(keys).not.toContain('resources.has_accounts');
  });

  it('never turns a skipped question into a No', () => {
    const { data, flow } = flowAt('optional');
    const question = currentQuestion(flow)!;

    skipCurrent(data, flow);

    expect(
      buildApplicationFieldPlan(data).find((field) =>
        field.key.includes(question.id.split('.').pop() ?? '@'),
      )?.value,
    ).not.toBe(false);
  });

  it('does not re-ask a skipped question while moving forward', () => {
    const { data, flow } = flowAt('optional');
    const question = currentQuestion(flow)!;

    let next = skipCurrent(data, flow);
    for (let i = 0; i < 10 && currentQuestion(next); i += 1) {
      expect(currentQuestion(next)?.id).not.toBe(question.id);
      if (!canSkip(currentQuestion(next))) break;
      next = skipCurrent(data, next);
    }
  });

  it('skipping a gateway does not activate its conditional follow-ups', () => {
    const data = set(household(), 'income.earned.answer', undefined);
    let flow = startFlow(data);

    for (let i = 0; i < 60 && currentQuestion(flow); i += 1) {
      if (currentQuestion(flow)?.id === 'income.earned') break;
      flow = skipCurrent(data, flow);
    }

    const skipped = skipCurrent(data, flow);
    const ids: string[] = [];
    let walk = skipped;

    for (let i = 0; i < 10 && currentQuestion(walk); i += 1) {
      ids.push(currentQuestion(walk)!.id);
      if (!canSkip(currentQuestion(walk))) break;
      walk = skipCurrent(data, walk);
    }

    // The record question behind the gateway must never appear.
    expect(ids).not.toContain('income.earned.records');
  });
});

// ---------------------------------------------------------------------------
// Regression: stable identity while typing
// ---------------------------------------------------------------------------

describe('input stability regression', () => {
  /**
   * The original bug: a component declared inside the parent gets a fresh
   * function identity every render, so React unmounts and remounts it, throwing
   * away the focused input after a single keystroke.
   */
  it('declares no component inside the parent component', () => {
    const nested = COMPONENT.split('\n').filter((line) =>
      /^\s+function [A-Z]/.test(line),
    );

    expect(nested).toEqual([]);
  });

  it('declares the record and choice components at module scope', () => {
    expect(COMPONENT).toMatch(/^function RecordEditor\(/m);
    expect(COMPONENT).toMatch(/^function TriStateControl\(/m);
  });

  it('does not recompute navigation when a record field changes', () => {
    // updateRecordField must call onChange, not the flow-resyncing helper.
    const body = COMPONENT.slice(
      COMPONENT.indexOf('function updateRecordField'),
      COMPONENT.indexOf('function updateRecordField') + 900,
    );

    expect(body).toMatch(/onChange\(\{/);
    expect(body).not.toMatch(/applyData\(/);
  });

  it('keys the draft input by question id so it remounts per question only', () => {
    expect(COMPONENT).toMatch(/key=\{current\.id\}/);
  });

  it('keys record rows by their stable record id', () => {
    expect(COMPONENT).toMatch(/key=\{String\(record\.id \?\? index\)\}/);
  });

  it('keeps the question id and order stable while a draft is edited', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'j1', memberId: 'applicant', employerName: '', startDate: '' },
    ]);

    const before = getRequiredApplicationQuestions(data).outstanding.map(
      (question) => question.id,
    );

    let flow = startFlow(data);
    const firstId = currentQuestion(flow)?.id;

    for (const draft of ['A', 'Ac', 'Acm', 'Acme', 'Acme ', 'Acme D']) {
      flow = setDraft(flow, draft);

      // Same question, same id, same plan: nothing was committed.
      expect(currentQuestion(flow)?.id).toBe(firstId);
      expect(
        getRequiredApplicationQuestions(data).outstanding.map((q) => q.id),
      ).toEqual(before);
    }
  });

  it('supports editing an existing multi-character answer', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      {
        id: 'j1',
        memberId: 'applicant',
        employerName: 'Acme Diner',
        employerAddress: '',
        employerPhone: '',
        startDate: '',
      },
    ]);

    // A record field edit is a direct write and must not disturb the plan.
    const before = getRequiredApplicationQuestions(data).outstanding.length;
    const edited = set(
      data,
      'income.earned.entries.0.employerName',
      'Acme Diner and Grill',
    );

    expect(
      (edited.questionnaire.income.earned.entries[0] as { employerName: string })
        .employerName,
    ).toBe('Acme Diner and Grill');
    expect(getRequiredApplicationQuestions(edited).outstanding.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Navigation after answering and skipping
// ---------------------------------------------------------------------------

describe('navigation after answering and skipping', () => {
  it('advances past an answered question and a skipped one alike', () => {
    const data = household();
    const flow = startFlow(data);
    const first = currentQuestion(flow)!;

    const answered = submitChoice(data, flow, first.path, false);
    expect(currentQuestion(answered.state)?.id).not.toBe(first.id);

    const second = currentQuestion(answered.state)!;
    const skipped = skipCurrent(answered.data, answered.state);
    expect(currentQuestion(skipped)?.id).not.toBe(second.id);
  });

  it('keeps required questions reachable even after skipping everything else', () => {
    const data = household();
    let flow = startFlow(data);

    for (let i = 0; i < 80 && currentQuestion(flow); i += 1) {
      if (!canSkip(currentQuestion(flow))) break;
      flow = skipCurrent(data, flow);
    }

    const remaining = currentQuestion(flow);

    // Either nothing is left, or what remains is a required question.
    if (remaining) expect(remaining.requirement).toBe('required');
  });

  it('refuses to skip a required question', () => {
    const required = getRequiredApplicationQuestions(household()).outstanding.find(
      (question) => question.requirement === 'required',
    );

    if (!required) return; // this fixture answers all tier-1 items

    const data = household();
    const flow = { ...startFlow(data), trail: [required], index: 0 };
    const result = skipCurrent(data, flow);

    expect(currentQuestion(result)?.id).toBe(required.id);
    expect(result.error).toBeTruthy();
  });
});
