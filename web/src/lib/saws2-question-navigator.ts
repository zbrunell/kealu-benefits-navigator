//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Question-at-a-time navigation over the planner's output.
 *
 * The planner is pure and stateless: it reports what is still unanswered. That
 * makes it unusable as a cursor on its own, because the moment an answer is
 * committed the question leaves the list. This module owns the *interaction*
 * state that sits on top of it:
 *
 * - a **trail** of the questions the user has actually been shown, so a question
 *   can be revisited after it has been answered and therefore left the plan;
 * - a **draft** for the question on screen, so typing does not touch application
 *   state until the answer is submitted;
 * - explicit `submit` / `back` transitions.
 *
 * Everything here is pure: same inputs, same outputs, no mutation. The React
 * component holds one `QuestionFlowState` and renders it. The planner's own
 * semantics are untouched.
 *
 * Two different "back" concepts exist and must not be conflated:
 * `back()` moves within the questionnaire's trail; when it reports
 * `atStart: true` the component is responsible for leaving the questionnaire
 * step entirely.
 */

import {
  getRequiredApplicationQuestions,
  readPath,
  safeEntries,
  writePath,
  type PlannedQuestion,
} from '@/lib/saws2-question-planner';
import type { Saws2PlusApplicationData } from '@/types/application';

export interface QuestionFlowState {
  /**
   * Questions the user has been shown, in visit order. Snapshots are kept so an
   * answered question — which the planner no longer reports — can still be
   * rendered when the user goes back. Snapshots carry only prompt/path/kind, so
   * they hold no applicant data.
   */
  trail: PlannedQuestion[];
  /** Index into `trail` of the question on screen. -1 when nothing remains. */
  index: number;
  /** Uncommitted text for the question on screen. */
  draft: string;
  /** Validation message for the current draft, or null. */
  error: string | null;
  /**
   * Questions the user chose to skip.
   *
   * A skipped question is not re-asked while walking forward, and nothing is
   * written for it — the corresponding PDF field simply stays blank. Skipping is
   * not an answer: it never becomes a No, and the planner still counts the
   * question as unanswered.
   */
  skipped: string[];
}

export const EMPTY_FLOW: QuestionFlowState = {
  trail: [],
  index: -1,
  draft: '',
  error: null,
  skipped: [],
};

/** Question kinds that submit through a draft + explicit Continue/Enter. */
export function usesDraft(question: PlannedQuestion | null): boolean {
  return question?.kind === 'field';
}

/** Record-field keys the form prints as a date. */
const DATE_KEYS = new Set(['startDate', 'endDate', 'changeDate', 'dateOfBirth']);

/** Record-field keys the form prints as an amount. */
const NUMBER_KEYS = new Set([
  'grossPerPeriod',
  'grossReceivedThisMonth',
  'hourlyRate',
  'hoursPerWeek',
  'grossMonthly',
  'netMonthly',
  'amountMonthly',
  'estimatedMonthlyValue',
  'balance',
  'amountOwed',
  'estimatedValue',
  'lowestCostPremium',
  'monthlyPayment',
  'expenseAmount',
]);

/** Final segment of a dotted path. */
function leafKey(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1] ?? '';
}

export type DraftKind = 'text' | 'number' | 'date';

/** How the current question's input should behave. */
export function draftKind(question: PlannedQuestion | null): DraftKind {
  if (!question) return 'text';

  const key = leafKey(question.path);

  if (DATE_KEYS.has(key)) return 'date';
  if (NUMBER_KEYS.has(key)) return 'number';

  return 'text';
}

export interface ValidatedAnswer {
  ok: boolean;
  /** The value to commit — a trimmed string, or a number for amount fields. */
  value?: string | number;
  error?: string;
}

/**
 * Validate and normalize a draft before it may be committed.
 *
 * A required answer is never committed empty, and a date or amount must parse.
 * This runs before anything is written, so an invalid draft can never reach
 * application state.
 */
export function validateDraft(
  question: PlannedQuestion | null,
  draft: string,
): ValidatedAnswer {
  if (!question) return { ok: false, error: 'There is no question to answer.' };

  const trimmed = draft.trim();

  if (!trimmed) {
    return { ok: false, error: 'Please enter an answer.' };
  }

  const kind = draftKind(question);

  if (kind === 'number') {
    const amount = Number(trimmed);

    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, error: 'Enter an amount using numbers only.' };
    }

    return { ok: true, value: amount };
  }

  if (kind === 'date') {
    const parsed = new Date(trimmed);

    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'Enter a valid date.' };
    }

    return { ok: true, value: trimmed };
  }

  return { ok: true, value: trimmed };
}

/**
 * Whether a keyboard event should submit the current answer.
 *
 * Enter submits single-line inputs. Shift+Enter never submits, so a multiline
 * field keeps its newline behavior.
 */
export function shouldSubmitOnKey(
  event: { key: string; shiftKey?: boolean },
  multiline = false,
): boolean {
  if (event.key !== 'Enter') return false;
  if (event.shiftKey) return false;

  return !multiline;
}

/** The committed value at a question's path, as a string for the input. */
export function committedValue(
  data: Saws2PlusApplicationData,
  question: PlannedQuestion | null,
): string {
  if (!question) return '';

  const value = readPath(data.questionnaire, question.path);

  if (value === undefined || value === null) return '';
  // A boolean is shown by its selected button, and a record list has no draft.
  if (typeof value === 'boolean' || typeof value === 'object') return '';

  return String(value);
}

/**
 * Whether a previously-visited question still applies.
 *
 * Branching means an answered question can stop being relevant: turning a
 * gateway to No makes its record fields inert, and removing a record makes that
 * record's field questions meaningless. Going back must respect the current
 * planner state rather than resurrecting those.
 */
export function stillRelevant(
  data: Saws2PlusApplicationData,
  question: PlannedQuestion,
  outstandingIds?: Set<string>,
): boolean {
  const ids =
    outstandingIds ??
    new Set(getRequiredApplicationQuestions(data).outstanding.map((q) => q.id));

  // Anything the planner is still asking for is relevant by definition.
  if (ids.has(question.id)) return true;

  // A field inside a record: its gateway must still be Yes and the record must
  // still exist at that index.
  const recordField = question.path.match(/^(.*)\.entries\.(\d+)\./);

  if (recordField) {
    const [, sectionPath, indexText] = recordField;
    const section = readPath(data.questionnaire, sectionPath) as
      | { answer?: boolean; entries?: unknown }
      | undefined;

    if (section?.answer !== true) return false;

    return safeEntries(section.entries).length > Number(indexText);
  }

  // A "add at least one record" question: only while its gateway is Yes.
  if (question.kind === 'records') {
    const sectionPath = question.path.replace(/\.entries$/, '');
    const section = readPath(data.questionnaire, sectionPath) as
      | { answer?: boolean }
      | undefined;

    return section?.answer === true;
  }

  // A gateway or standalone field that has been answered: still editable.
  return true;
}

/** The next question to show: the first outstanding one not already on the trail. */
export function nextUnvisited(
  data: Saws2PlusApplicationData,
  trail: PlannedQuestion[],
  skipped: string[] = [],
): PlannedQuestion | null {
  const seen = new Set([...trail.map((question) => question.id), ...skipped]);
  const outstanding = getRequiredApplicationQuestions(data).outstanding;

  // Outstanding is already ordered by priority, so this walks tier 1 first.
  const unseen = outstanding.find((question) => !seen.has(question.id));
  if (unseen) return unseen;

  // Everything left has been visited or skipped; offer the first required one
  // again rather than a skipped optional question.
  return (
    outstanding.find(
      (question) =>
        question.requirement === 'required' && !skipped.includes(question.id),
    ) ?? null
  );
}

/** Whether the question on screen may be passed over without an answer. */
export function canSkip(question: PlannedQuestion | null): boolean {
  return question !== null && question.requirement !== 'required';
}

/**
 * Skip the current question.
 *
 * Writes nothing: the answer stays unknown and the PDF field stays blank. A
 * required (tier 1) question cannot be skipped.
 */
export function skipCurrent(
  data: Saws2PlusApplicationData,
  state: QuestionFlowState,
): QuestionFlowState {
  const question = currentQuestion(state);

  if (!canSkip(question)) {
    return { ...state, error: 'This answer is needed to file the application.' };
  }

  return advance(data, {
    ...state,
    skipped: [...state.skipped, question!.id],
    error: null,
  });
}

/** Start (or restart) the flow at the first outstanding question. */
export function startFlow(data: Saws2PlusApplicationData): QuestionFlowState {
  const first = nextUnvisited(data, []);

  if (!first) return EMPTY_FLOW;

  return {
    trail: [first],
    index: 0,
    draft: committedValue(data, first),
    error: null,
    skipped: [],
  };
}

/** The question currently on screen, or null when the flow is finished. */
export function currentQuestion(
  state: QuestionFlowState,
): PlannedQuestion | null {
  if (state.index < 0 || state.index >= state.trail.length) return null;

  return state.trail[state.index];
}

/** Replace the draft. Never touches application data. */
export function setDraft(
  state: QuestionFlowState,
  draft: string,
): QuestionFlowState {
  return { ...state, draft, error: null };
}

export interface SubmitResult {
  /** Application data after the answer was written, or unchanged on failure. */
  data: Saws2PlusApplicationData;
  state: QuestionFlowState;
  /** True when the answer was accepted and written. */
  committed: boolean;
}

/**
 * Commit the current draft and advance.
 *
 * On failure nothing is written and the question stays on screen with an error.
 * On success the value goes through `writePath` (which preserves arrays), the
 * planner is re-run, and the flow moves to the next question.
 */
export function submitDraft(
  data: Saws2PlusApplicationData,
  state: QuestionFlowState,
): SubmitResult {
  const question = currentQuestion(state);
  const validated = validateDraft(question, state.draft);

  if (!question || !validated.ok) {
    return {
      data,
      state: { ...state, error: validated.error ?? 'Please enter an answer.' },
      committed: false,
    };
  }

  const nextData: Saws2PlusApplicationData = {
    ...data,
    questionnaire: writePath(data.questionnaire, question.path, validated.value),
  };

  return { data: nextData, state: advance(nextData, state), committed: true };
}

/**
 * Commit an explicit choice — a Yes/No answer or a member selection.
 *
 * These are already deliberate clicks, so they write immediately and advance
 * without a second confirmation step.
 */
export function submitChoice(
  data: Saws2PlusApplicationData,
  state: QuestionFlowState,
  path: string,
  value: unknown,
): SubmitResult {
  const nextData: Saws2PlusApplicationData = {
    ...data,
    questionnaire: writePath(data.questionnaire, path, value),
  };

  return { data: nextData, state: advance(nextData, state), committed: true };
}

/**
 * Move forward after a successful commit.
 *
 * When the user was editing an earlier trail entry, forward means the next trail
 * entry that still applies; otherwise it means the next outstanding question.
 */
export function advance(
  data: Saws2PlusApplicationData,
  state: QuestionFlowState,
): QuestionFlowState {
  const outstandingIds = new Set(
    getRequiredApplicationQuestions(data).outstanding.map((q) => q.id),
  );

  // Editing an earlier answer: step forward through the existing trail.
  for (let i = state.index + 1; i < state.trail.length; i += 1) {
    if (stillRelevant(data, state.trail[i], outstandingIds)) {
      return {
        ...state,
        index: i,
        draft: committedValue(data, state.trail[i]),
        error: null,
      };
    }
  }

  const next = nextUnvisited(data, state.trail, state.skipped);

  if (!next) {
    // Nothing left to ask: keep the trail for Back, but show no question.
    return { ...state, index: state.trail.length, draft: '', error: null };
  }

  const trail = [...state.trail, next];

  return {
    ...state,
    trail,
    index: trail.length - 1,
    draft: committedValue(data, next),
    error: null,
  };
}

export interface BackResult {
  state: QuestionFlowState;
  /**
   * True when there is no earlier question to return to. The component then
   * leaves the questionnaire step — this is the application-step Back, which is
   * a different concept from moving within the trail.
   */
  atStart: boolean;
}

/**
 * Step back to the previous question that still applies.
 *
 * Never writes: going back cannot change an answer, erase one, or activate a
 * stale record. The previous answer is loaded into the draft so it appears
 * prefilled and can be edited.
 */
export function back(
  data: Saws2PlusApplicationData,
  state: QuestionFlowState,
): BackResult {
  const outstandingIds = new Set(
    getRequiredApplicationQuestions(data).outstanding.map((q) => q.id),
  );

  const from = Math.min(state.index, state.trail.length);

  for (let i = from - 1; i >= 0; i -= 1) {
    if (stillRelevant(data, state.trail[i], outstandingIds)) {
      return {
        state: {
          ...state,
          index: i,
          draft: committedValue(data, state.trail[i]),
          error: null,
        },
        atStart: false,
      };
    }
  }

  return { state, atStart: true };
}

/**
 * Re-sync the flow after application data changed outside the current question —
 * for example a record was added or removed.
 *
 * Keeps the user where they are when that question still applies; otherwise
 * moves to the next thing worth asking.
 */
export function resync(
  data: Saws2PlusApplicationData,
  state: QuestionFlowState,
): QuestionFlowState {
  if (state.trail.length === 0) return startFlow(data);

  const question = currentQuestion(state);

  if (question && stillRelevant(data, question)) {
    // Refresh the draft only when the user has not typed anything yet.
    return state.draft === ''
      ? { ...state, draft: committedValue(data, question) }
      : state;
  }

  return advance(data, { ...state, index: state.index - 1 });
}
