//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * "Skip for now" has to survive the click.
 *
 * A blank answer is ambiguous. Unasked, not applicable, unsupported by the
 * form, and consciously postponed all look identical in the data, and the
 * completion guide has to tell the applicant which of those it is. So a
 * deferral is recorded rather than inferred.
 *
 * Before this, a skip lived only in the questionnaire's component state: it
 * stopped the question being re-asked while walking forward and was gone the
 * moment the applicant navigated away. Nothing downstream ever saw it, so the
 * guide never mentioned the answer they had deliberately postponed.
 */

import { describe, expect, it } from 'vitest';

import { buildCompletionGuide } from '@/lib/completion-guide';
import { assessDraftCompletion } from '@/lib/draft-completion';
import {
  canSkip,
  currentQuestion,
  skipCurrent,
  startFlow,
  submitChoice,
} from '@/lib/saws2-question-navigator';
import { getRequiredApplicationQuestions } from '@/lib/saws2-question-planner';
import {
  EMPTY_APPLICATION_DATA,
  type Saws2PlusApplicationData,
} from '@/types/application';

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: [],
  };
}

/** Walk to the first question that may be deferred. */
function atSkippableQuestion(data: Saws2PlusApplicationData) {
  let flow = startFlow(data);

  for (let guard = 0; guard < 200; guard += 1) {
    const question = currentQuestion(flow);

    if (question && canSkip(question)) return { data, flow, question };

    // Answer whatever is required until a skippable one comes up.
    if (!question) break;

    const result = submitChoice(data, flow, question.path, false);
    data = result.data;
    flow = result.state;
  }

  throw new Error('no skippable question found');
}

describe('a deferral is recorded on the application', () => {
  it('starts with nothing deferred', () => {
    expect(seed().deferredQuestionIds).toEqual([]);
  });

  it('records the question id when it is skipped', () => {
    const { data, flow, question } = atSkippableQuestion(seed());
    const result = skipCurrent(data, flow);

    expect(result.data.deferredQuestionIds).toContain(question.id);
  });

  it('survives being read back from the application, not the flow', () => {
    /*
     * The regression: the deferral used to live in QuestionFlowState, which is
     * component state. Re-deriving completion from the application data — which
     * is what the guide does — must still see it.
     */
    const { data, flow } = atSkippableQuestion(seed());
    const result = skipCurrent(data, flow);
    const completion = assessDraftCompletion(result.data);

    expect(completion.byReason.deferred.length).toBeGreaterThan(0);
  });

  it('records a question only once however often it is skipped', () => {
    const { data, flow } = atSkippableQuestion(seed());
    const once = skipCurrent(data, flow);
    const twice = skipCurrent(once.data, flow);

    expect(twice.data.deferredQuestionIds).toEqual(once.data.deferredQuestionIds);
  });

  it('refuses to defer a required question', () => {
    const data = seed();
    const flow = startFlow(data);
    const question = currentQuestion(flow);

    if (question && !canSkip(question)) {
      const result = skipCurrent(data, flow);

      expect(result.state.error).toBe('answer_error_required_to_file');
      expect(result.data.deferredQuestionIds).toEqual([]);
    }
  });

  it('clears the deferral once the question is actually answered', () => {
    const { data, flow, question } = atSkippableQuestion(seed());
    const skipped = skipCurrent(data, flow);

    expect(skipped.data.deferredQuestionIds).toContain(question.id);

    const answered = submitChoice(
      skipped.data,
      // Re-open the same question rather than wherever the skip moved to.
      { ...skipped.state, index: flow.index, trail: flow.trail },
      question.path,
      false,
    );

    expect(answered.data.deferredQuestionIds).not.toContain(question.id);
  });
});

describe('the guide tells the applicant what they postponed', () => {
  it('lists the deferred answer with a place to complete it', () => {
    const { data, flow } = atSkippableQuestion(seed());
    const result = skipCurrent(data, flow);

    const guide = buildCompletionGuide({
      application: result.data,
      audience: 'applicant',
      county: 'Fresno',
      draft: { reference: 'ABCD1234', generatedAt: '2026-08-18T00:00:00Z' },
    });

    const section = guide.sections.find((s) => s.id === 'deferred');

    expect(section).toBeDefined();
    expect(section!.items.length).toBeGreaterThan(0);
    expect(section!.intro).toMatch(/skipped these for now/i);

    for (const item of section!.items) {
      // Every item says what to do about it.
      expect(item.detail).toMatch(/answer this later/i);
    }
  });

  it('says nothing about deferrals when none were made', () => {
    const guide = buildCompletionGuide({
      application: seed(),
      audience: 'applicant',
      county: 'Fresno',
      draft: { reference: 'ABCD1234', generatedAt: '2026-08-18T00:00:00Z' },
    });

    expect(guide.sections.map((s) => s.id)).not.toContain('deferred');
  });
});

describe('the five states a blank answer can be in stay distinct', () => {
  const { data, flow } = atSkippableQuestion(seed());
  const deferred = skipCurrent(data, flow).data;
  const completion = assessDraftCompletion(deferred);

  it('separates deferred from merely unanswered', () => {
    const deferredIds = completion.byReason.deferred.map((i) => i.id);
    const missingIds = completion.byReason.missing_answer.map((i) => i.id);

    expect(deferredIds.length).toBeGreaterThan(0);
    expect(missingIds.length).toBeGreaterThan(0);

    // No question is reported as both.
    for (const id of deferredIds) {
      expect(missingIds).not.toContain(id.replace('deferred.', 'missing.'));
    }
  });

  it('separates both from not-applicable, which is not an item at all', () => {
    // A conditional section this household skips is reported as a skipped
    // section, never as outstanding work.
    expect(completion.skippedSections.length).toBeGreaterThan(0);

    const outstandingSaws = completion.manualItems.map((i) => i.saws);

    for (const section of completion.skippedSections) {
      expect(outstandingSaws).not.toContain(section.saws);
    }
  });

  it('separates all of those from unsupported, which the form cannot carry', () => {
    // Q23f is askable and answerable; it is unsupported because the printed
    // page has one checkbox between two opposite choices.
    const unsupported = completion.byReason.unsupported.map((i) => i.saws);
    const deferredSaws = completion.byReason.deferred.map((i) => i.saws);

    for (const saws of unsupported) {
      expect(deferredSaws).not.toContain(saws);
    }
  });

  it('keeps a deferral out of the answered count', () => {
    const plan = getRequiredApplicationQuestions(deferred);

    // Deferring is not answering: the question is still outstanding.
    expect(plan.outstanding.length).toBeGreaterThan(0);
    expect(plan.answeredCount).toBeLessThan(plan.totalCount);
  });
});
