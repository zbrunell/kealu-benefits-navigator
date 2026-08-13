//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * An explicit No is an answer.
 *
 * The rule these tests defend: a boolean question is "answered" when it holds
 * `true` or `false`, and only `undefined` means unanswered. Truthiness checks
 * (`if (!value)`) collapse a No into "never asked" and make the flow ask again.
 *
 * Every behaviour is checked on at least two unrelated gateways so that a fix
 * cannot be a health-coverage special case.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  getRequiredApplicationQuestions,
  isAnswered,
  isUnanswered,
  readPath,
  sawsQuestionFor,
  writePath,
} from '@/lib/saws2-question-planner';
import {
  advance,
  back,
  committedValue,
  currentQuestion,
  resync,
  skipCurrent,
  startFlow,
  submitChoice,
  type QuestionFlowState,
} from '@/lib/saws2-question-navigator';
import {
  EMPTY_APPLICATION_DATA,
  type Saws2PlusApplicationData,
} from '@/types/application';

/** Two unrelated gateways, so nothing here can be a healthcare-only patch. */
const GATEWAYS = [
  {
    id: 'health.current_coverage',
    path: 'health.currentCoverage.answer',
    entriesPath: 'health.currentCoverage.entries',
  },
  {
    id: 'resources.vehicles',
    path: 'resources.vehicles.answer',
    entriesPath: 'resources.vehicles.entries',
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

function outstandingIds(data: Saws2PlusApplicationData): Set<string> {
  return new Set(
    getRequiredApplicationQuestions(data).outstanding.map((q) => q.id),
  );
}

/** Put a specific question on screen without answering anything else. */
function flowShowing(
  data: Saws2PlusApplicationData,
  id: string,
): QuestionFlowState {
  const question = getRequiredApplicationQuestions(data).outstanding.find(
    (q) => q.id === id,
  );

  if (!question) throw new Error(`${id} is not outstanding`);

  return {
    trail: [question],
    index: 0,
    draft: '',
    error: null,
    skipped: [],
  };
}

// ---------------------------------------------------------------------------
// The definition itself
// ---------------------------------------------------------------------------

describe('isAnswered', () => {
  it('treats false as an answer', () => {
    expect(isAnswered(false)).toBe(true);
    expect(isUnanswered(false)).toBe(false);
  });

  it('treats true as an answer', () => {
    expect(isAnswered(true)).toBe(true);
  });

  it('treats undefined as unanswered', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isUnanswered(undefined)).toBe(true);
  });

  it('does not use truthiness', () => {
    // The exact shape that caused the bug: `!value` is true for a valid No.
    const no: boolean | undefined = false;

    expect(!no).toBe(true);
    expect(isUnanswered(no)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Planner: what is still outstanding
// ---------------------------------------------------------------------------

describe.each(GATEWAYS)('gateway $id', (gateway) => {
  it('is asked while unanswered', () => {
    expect(outstandingIds(seed()).has(gateway.id)).toBe(true);
  });

  it('stops being asked after Yes', () => {
    const data = write(seed(), gateway.path, true);

    expect(outstandingIds(data).has(gateway.id)).toBe(false);
  });

  it('stops being asked after No', () => {
    const data = write(seed(), gateway.path, false);

    expect(readPath(data.questionnaire, gateway.path)).toBe(false);
    expect(outstandingIds(data).has(gateway.id)).toBe(false);
  });

  it('is still outstanding after being skipped', () => {
    // Skipping writes nothing, so the question remains genuinely unanswered.
    const data = seed();
    const flow = skipCurrent(data, flowShowing(data, gateway.id));

    expect(readPath(data.questionnaire, gateway.path)).toBeUndefined();
    expect(outstandingIds(data).has(gateway.id)).toBe(true);
    expect(flow.skipped).toContain(gateway.id);
  });

  it('is not re-added by a resync after No', () => {
    let data = seed();
    let flow = flowShowing(data, gateway.id);

    const answered = submitChoice(data, flow, gateway.path, false);
    data = answered.data;
    flow = answered.state;

    // Resync repeatedly, as the component does after every data change.
    for (let i = 0; i < 5; i += 1) flow = resync(data, flow);

    expect(readPath(data.questionnaire, gateway.path)).toBe(false);
    expect(currentQuestion(flow)?.id).not.toBe(gateway.id);
    expect(outstandingIds(data).has(gateway.id)).toBe(false);
  });

  it('is not re-offered while walking the rest of the flow', () => {
    let data = write(seed(), gateway.path, false);
    let flow = startFlow(data);

    for (let i = 0; i < 300; i += 1) {
      const question = currentQuestion(flow);
      if (!question) break;

      expect(question.id).not.toBe(gateway.id);
      flow = advance(data, {
        ...flow,
        skipped: [...flow.skipped, question.id],
      });
    }

    expect(readPath(data.questionnaire, gateway.path)).toBe(false);
  });

  it('can still be revisited and changed with Back', () => {
    let data = seed();
    let flow = flowShowing(data, gateway.id);

    const answered = submitChoice(data, flow, gateway.path, false);
    data = answered.data;
    flow = answered.state;

    const returned = back(data, flow);

    expect(returned.atStart).toBe(false);
    expect(currentQuestion(returned.state)?.id).toBe(gateway.id);

    // Changing the answer from the revisited question works.
    const changed = submitChoice(
      data,
      returned.state,
      gateway.path,
      true,
    );

    expect(readPath(changed.data.questionnaire, gateway.path)).toBe(true);
  });

  it('reveals its detail records on No -> Yes', () => {
    const no = write(seed(), gateway.path, false);
    const yes = write(no, gateway.path, true);

    expect(
      outstandingIds(no).has(`${gateway.id}.records`),
    ).toBe(false);
    expect(
      outstandingIds(yes).has(`${gateway.id}.records`),
    ).toBe(true);
  });

  it('deactivates its detail records on Yes -> No', () => {
    let data = write(seed(), gateway.path, true);
    data = write(data, gateway.entriesPath, [
      { id: 'r1', memberId: 'applicant' },
    ]);

    const outstandingWhileYes = outstandingIds(data);
    const afterNo = outstandingIds(write(data, gateway.path, false));

    // Some detail question existed while Yes, and none survives the No.
    expect(
      [...outstandingWhileYes].some((id) => id.startsWith(`${gateway.id}.`)),
    ).toBe(true);
    expect([...afterNo].some((id) => id.startsWith(`${gateway.id}.`))).toBe(
      false,
    );
  });

  it('leaves the draft empty for a boolean, so No is never shown as text', () => {
    const data = write(seed(), gateway.path, false);
    const question = getRequiredApplicationQuestions(seed()).outstanding.find(
      (q) => q.id === gateway.id,
    )!;

    expect(committedValue(data, question)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Skip stays distinct from No
// ---------------------------------------------------------------------------

describe('skip versus No', () => {
  it('writes nothing when a question is skipped', () => {
    const data = seed();
    const before = JSON.stringify(data.questionnaire);

    skipCurrent(data, flowShowing(data, 'health.current_coverage'));

    expect(JSON.stringify(data.questionnaire)).toBe(before);
    expect(
      readPath(data.questionnaire, 'health.currentCoverage.answer'),
    ).toBeUndefined();
  });

  it('a skipped question reappears as unanswered in a fresh flow', () => {
    // Skip state lives in the flow, not in the application, so restarting the
    // questionnaire offers the question again — a No never would.
    const data = seed();
    const skippedFlow = skipCurrent(
      data,
      flowShowing(data, 'health.current_coverage'),
    );

    expect(skippedFlow.skipped).toContain('health.current_coverage');
    expect(outstandingIds(data).has('health.current_coverage')).toBe(true);

    const fresh = startFlow(data);
    const reachable = new Set([
      ...fresh.trail.map((q) => q.id),
      ...getRequiredApplicationQuestions(data).outstanding.map((q) => q.id),
    ]);

    expect(reachable.has('health.current_coverage')).toBe(true);
  });

  it('never converts a skip into a No', () => {
    const data = seed();
    const flow = skipCurrent(data, flowShowing(data, 'resources.vehicles'));

    expect(flow.skipped).toContain('resources.vehicles');
    expect(
      readPath(data.questionnaire, 'resources.vehicles.answer'),
    ).not.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// False survives every hop out of the application
// ---------------------------------------------------------------------------

describe('an explicit No survives serialization', () => {
  it('round-trips through JSON', () => {
    const data = write(seed(), 'health.currentCoverage.answer', false);
    const revived = JSON.parse(
      JSON.stringify(data),
    ) as Saws2PlusApplicationData;

    expect(readPath(revived.questionnaire, 'health.currentCoverage.answer')).toBe(
      false,
    );
    expect(outstandingIds(revived).has('health.current_coverage')).toBe(false);
  });

  it('reaches the canonical field plan as false, not as a missing key', () => {
    const data = write(seed(), 'health.currentCoverage.answer', false);
    const plan = buildApplicationFieldPlan(data, {});
    const emitted = plan.find((e) => e.key === 'health.has_current_coverage');

    expect(emitted).toBeDefined();
    expect(emitted?.value).toBe(false);
  });

  it('emits nothing at all for a question that was never answered', () => {
    const plan = buildApplicationFieldPlan(seed(), {});

    expect(
      plan.find((e) => e.key === 'health.has_current_coverage'),
    ).toBeUndefined();
  });

  it('distinguishes No from skipped in the field plan', () => {
    const no = buildApplicationFieldPlan(
      write(seed(), 'resources.vehicles.answer', false),
      {},
    );
    const skipped = buildApplicationFieldPlan(seed(), {});

    expect(no.find((e) => e.key === 'resources.has_vehicles')?.value).toBe(
      false,
    );
    expect(
      skipped.find((e) => e.key === 'resources.has_vehicles'),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Q22: four independent printed questions
// ---------------------------------------------------------------------------

describe('Q22 health coverage branching', () => {
  const Q22 = 'health.current_coverage';
  const SIBLINGS = [
    'health.employer_coverage',
    'health.coverage_ending',
    'health.retroactive_medical',
  ];

  it('numbers Q22, Q22a, Q22b and Q22c distinctly', () => {
    // Three of these were all badged "Q22", which is what made the flow look
    // like it was asking the same question over and over.
    expect(sawsQuestionFor(Q22)).toBe('Q22');
    expect(sawsQuestionFor('health.employer_coverage')).toBe('Q22a');
    expect(sawsQuestionFor('health.coverage_ending')).toBe('Q22b');
    expect(sawsQuestionFor('health.retroactive_medical')).toBe('Q22c');

    const numbers = [Q22, ...SIBLINGS].map(sawsQuestionFor);
    expect(new Set(numbers).size).toBe(4);
  });

  it('does not ask Q22 again once answered No', () => {
    const data = write(seed(), 'health.currentCoverage.answer', false);

    expect(outstandingIds(data).has(Q22)).toBe(false);
  });

  it('suppresses only the coverage details that require Q22 = Yes', () => {
    const data = write(seed(), 'health.currentCoverage.answer', false);
    const ids = outstandingIds(data);

    expect([...ids].some((id) => id.startsWith(`${Q22}.`))).toBe(false);
  });

  it.each(SIBLINGS)('still asks %s after Q22 = No', (sibling) => {
    // No current coverage does not mean no job-based offer (Q22a), no coverage
    // ending (Q22b), and no wish for help with past medical bills (Q22c).
    const data = write(seed(), 'health.currentCoverage.answer', false);

    expect(outstandingIds(data).has(sibling)).toBe(true);
  });

  it.each(SIBLINGS)('%s is answerable independently of Q22', (sibling) => {
    const paths: Record<string, string> = {
      'health.employer_coverage': 'health.employerCoverage.answer',
      'health.coverage_ending': 'health.coverageEnding.answer',
      'health.retroactive_medical': 'health.retroactiveMedicalHelp',
    };

    let data = write(seed(), 'health.currentCoverage.answer', false);
    data = write(data, paths[sibling], true);

    const ids = outstandingIds(data);

    expect(ids.has(sibling)).toBe(false);
    expect(ids.has(Q22)).toBe(false);
    // Answering a sibling never resurrects Q22.
    expect(readPath(data.questionnaire, 'health.currentCoverage.answer')).toBe(
      false,
    );
  });

  it('answering Q22 No leaves the other three untouched', () => {
    const data = write(seed(), 'health.currentCoverage.answer', false);

    expect(
      readPath(data.questionnaire, 'health.employerCoverage.answer'),
    ).toBeUndefined();
    expect(
      readPath(data.questionnaire, 'health.coverageEnding.answer'),
    ).toBeUndefined();
    expect(
      readPath(data.questionnaire, 'health.retroactiveMedicalHelp'),
    ).toBeUndefined();
  });
});
