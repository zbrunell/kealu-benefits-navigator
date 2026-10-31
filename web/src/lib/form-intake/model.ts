//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What a form asks, as data: sections, questions, and what opens each one.
 *
 * The California application flow is a hand-written component per step, with
 * requiredness in one module, branching in the question planner, and the
 * questions themselves in JSX. That works, and it is 3,000 lines. Building the
 * Texas flow the same way would have produced a second 3,000 lines with the
 * same shape and no shared guarantees.
 *
 * So the Texas flow is a *configuration* — `tx-h1010.ts` — read by a renderer
 * that knows nothing about Texas. This module is the vocabulary the two share.
 *
 * ── What a question is ─────────────────────────────────────────────────────
 * A question is not a field name. It is a prompt, a way of capturing an answer,
 * and a pair of functions that read and write that answer in the application
 * state. The read/write pair is deliberately a *function*, not a dotted path
 * string: the application state is a typed structure with nested optional
 * records, and a stringly-typed setter over it would push every type error to
 * runtime — in the one place where a wrong write means a wrong answer on a
 * government form.
 *
 * ── The three states, kept apart ───────────────────────────────────────────
 * `undefined` means never answered. `false` means the applicant answered No.
 * And a question whose gate is shut is not asked at all, so it has no answer to
 * confuse with either. Those are three distinct outcomes and every part of this
 * module preserves the distinction:
 *
 * * :func:`isAsked` decides applicability from the gate, never from emptiness.
 * * :func:`isAnswered` treats `false` and `0` as answers.
 * * :func:`missingRequired` only ever reports a question that is *asked*.
 *
 * The canonical field plan then emits nothing for an unasked question, which is
 * what lets the Python mapping layer report the printed box as "not applicable"
 * with a reason rather than as work the applicant still owes.
 *
 * ── What is deliberately not here ──────────────────────────────────────────
 * No jurisdiction, no form id, no canonical key, and no English. A question
 * carries catalog keys; the renderer resolves them in the applicant's language.
 * Nothing in this file knows that Texas exists.
 */

import type { SupportedApplicationForm } from '@/lib/state-applications';

/** A Yes/No answer, where `undefined` means the question has not been put. */
export type TriState = boolean | undefined;

/** Everything a question can hold. */
export type AnswerValue = string | number | boolean | undefined;

/**
 * How an answer is captured.
 *
 * `yes_no` is its own kind rather than a two-option `choice` because it is the
 * one that must round-trip `undefined`: a pair of radio buttons with no third
 * option cannot express "not answered", and a checkbox cannot express "No".
 */
export type QuestionKind =
  | 'text'
  | 'tel'
  | 'email'
  | 'date'
  | 'integer'
  | 'money'
  | 'choice'
  | 'yes_no';

export interface QuestionOption {
  value: string;
  /** Catalog key for the option's label. */
  labelKey: string;
  /**
   * A label to show verbatim, instead of resolving `labelKey`.
   *
   * For an option whose text is not translatable because it is not ours: a
   * household member's name is what they typed. Passing it through the catalog
   * would either throw on a missing key or, worse, silently render the key.
   */
  label?: string;
}

/**
 * A gate: the answer that has to be given before another question is asked.
 *
 * Only ever refers to a question *earlier in the same form*, which
 * :func:`validateIntakeForm` enforces — a cycle would render a form that can
 * never be completed, and a forward reference would ask a follow-up above the
 * question that unlocks it.
 */
export interface Gate {
  /** Id of the question that opens this one. */
  questionId: string;
  /** The answer that opens it. */
  equals: boolean;
}

export interface IntakeQuestion<TState> {
  /** Stable id. Also the test id and the anchor a validation message links to. */
  id: string;

  /** Catalog key for the prompt. */
  promptKey: string;

  /** Catalog key for help text shown under the prompt. */
  helpKey?: string;

  kind: QuestionKind;

  /** Options for a `choice` question, in the order they should be offered. */
  options?: readonly QuestionOption[];

  read: (state: TState) => AnswerValue;

  write: (state: TState, value: AnswerValue) => TState;

  /**
   * Whether the flow refuses to continue without it.
   *
   * Semantic, not "the form has a box": a question is required because the
   * document or the eligibility reasoning cannot be right without it. The
   * asterisk on screen and the check that blocks Continue read this same field,
   * so they cannot disagree.
   */
  required?: boolean;

  gate?: Gate;

  /** Normalisation safe to apply while someone is still typing. */
  normalize?: (raw: string) => string;

  /** A message key when the answer cannot be used, or null when it can. */
  validate?: (value: AnswerValue) => string | null;
}

export interface IntakeSection<TState> {
  id: string;
  titleKey: string;
  introKey?: string;
  /** Shuts the whole section, not just one question. */
  gate?: Gate;
  /**
   * A condition that is not another question's answer.
   *
   * The expedited-service screen is Texas's SNAP screen: it applies because
   * the household asked for food benefits, and "which programmes did you
   * select" is a choice made on an earlier screen rather than a question in
   * this form. Kept separate from `gate` rather than folded into it, because a
   * gate is checkable — :func:`validateIntakeForm` proves every gate names a
   * question asked earlier — and an arbitrary predicate is not.
   */
  appliesWhen?: (state: TState) => boolean;
  questions: readonly IntakeQuestion<TState>[];
}

export interface IntakeForm<TState> {
  formId: SupportedApplicationForm;
  sections: readonly IntakeSection<TState>[];
}

// ---------------------------------------------------------------------------
// Reading a form
// ---------------------------------------------------------------------------

/** Every question in the form, in order, sections flattened. */
export function allQuestions<TState>(
  form: IntakeForm<TState>,
): readonly IntakeQuestion<TState>[] {
  return form.sections.flatMap((section) => section.questions);
}

export function questionById<TState>(
  form: IntakeForm<TState>,
  id: string,
): IntakeQuestion<TState> | undefined {
  return allQuestions(form).find((question) => question.id === id);
}

/**
 * Whether an answer has been given.
 *
 * `false` and `0` are answers. Only `undefined` and an empty string are not —
 * which is why this exists rather than a truthiness check, since the truthiness
 * check is how an explicit No becomes an unanswered question.
 */
export function isAnswered(value: AnswerValue): boolean {
  if (value === undefined) return false;

  if (typeof value === 'string') return value.trim().length > 0;

  return true;
}

/** Whether a gate is open, given the state. */
function gateIsOpen<TState>(
  form: IntakeForm<TState>,
  state: TState,
  gate: Gate | undefined,
): boolean {
  if (!gate) return true;

  const question = questionById(form, gate.questionId);

  if (!question) return false;

  const answer = question.read(state);

  /*
   * An unanswered gate is shut. That is the opposite of the rule the mapping
   * layer uses for a *printed* box, and deliberately so: there, an unanswered
   * gateway must never discard an answer the applicant already gave; here, a
   * follow-up must not appear on screen before the question that introduces it
   * has been answered.
   */
  if (answer === undefined) return false;

  return answer === gate.equals;
}

/** Whether this question is put to the applicant at all. */
export function isAsked<TState>(
  form: IntakeForm<TState>,
  state: TState,
  question: IntakeQuestion<TState>,
): boolean {
  const section = form.sections.find((candidate) =>
    candidate.questions.some((entry) => entry.id === question.id),
  );

  if (section && !sectionIsAsked(form, state, section)) return false;

  return gateIsOpen(form, state, question.gate);
}

/** Whether this section is shown at all. */
export function sectionIsAsked<TState>(
  form: IntakeForm<TState>,
  state: TState,
  section: IntakeSection<TState>,
): boolean {
  if (section.appliesWhen && !section.appliesWhen(state)) return false;

  return gateIsOpen(form, state, section.gate);
}

/** The questions actually put to this applicant, in a section. */
export function askedQuestions<TState>(
  form: IntakeForm<TState>,
  state: TState,
  section: IntakeSection<TState>,
): readonly IntakeQuestion<TState>[] {
  if (!sectionIsAsked(form, state, section)) return [];

  return section.questions.filter((question) =>
    isAsked(form, state, question),
  );
}

/**
 * Required questions this applicant has been asked and has not answered.
 *
 * A question behind a shut gate is never reported. "You have not answered a
 * question we never asked you" is the single most common way a form flow tells
 * someone something untrue.
 */
export function missingRequired<TState>(
  form: IntakeForm<TState>,
  state: TState,
  section?: IntakeSection<TState>,
): readonly IntakeQuestion<TState>[] {
  const sections = section ? [section] : form.sections;

  return sections.flatMap((entry) =>
    askedQuestions(form, state, entry).filter(
      (question) => question.required && !isAnswered(question.read(state)),
    ),
  );
}

/**
 * Required fields of one record of a repeating list that are still blank.
 *
 * Records have no gates — a job either exists or it does not — so this is the
 * whole of requiredness for a row, and it uses the same `required` flag and the
 * same `isAnswered` rule as a top-level question rather than a second notion of
 * "filled in".
 */
export function missingRecordAnswers<TRecord>(
  fields: readonly IntakeQuestion<TRecord>[],
  record: TRecord,
): readonly IntakeQuestion<TRecord>[] {
  return fields.filter(
    (field) => field.required && !isAnswered(field.read(record)),
  );
}

/** Whether every required question the applicant was asked has an answer. */
export function isComplete<TState>(
  form: IntakeForm<TState>,
  state: TState,
  section?: IntakeSection<TState>,
): boolean {
  return missingRequired(form, state, section).length === 0;
}

/** Answers that cannot be used, as `{ questionId, messageKey }`. */
export function findProblems<TState>(
  form: IntakeForm<TState>,
  state: TState,
): readonly { questionId: string; messageKey: string }[] {
  const problems: { questionId: string; messageKey: string }[] = [];

  for (const section of form.sections) {
    for (const question of askedQuestions(form, state, section)) {
      const messageKey = question.validate?.(question.read(state)) ?? null;

      if (messageKey) problems.push({ questionId: question.id, messageKey });
    }
  }

  return problems;
}

/** How far through the asked questions this applicant is. */
export function progress<TState>(
  form: IntakeForm<TState>,
  state: TState,
): { answered: number; asked: number } {
  let answered = 0;
  let asked = 0;

  for (const section of form.sections) {
    for (const question of askedQuestions(form, state, section)) {
      asked += 1;

      if (isAnswered(question.read(state))) answered += 1;
    }
  }

  return { answered, asked };
}

// ---------------------------------------------------------------------------
// Checking a form
// ---------------------------------------------------------------------------

/**
 * Structural problems with a form definition, as English for a failing test.
 *
 * Not a runtime guard — a form is a constant, so these are all mistakes made
 * while writing one. Reported as a list rather than thrown so a test names all
 * of them at once.
 */
export function validateIntakeForm<TState>(
  form: IntakeForm<TState>,
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const positionOf = new Map<string, number>();

  allQuestions(form).forEach((question, index) => {
    if (seen.has(question.id)) {
      problems.push(`duplicate question id: ${question.id}`);
    }

    seen.add(question.id);
    positionOf.set(question.id, index);

    if (question.kind === 'choice' && !question.options?.length) {
      problems.push(`${question.id}: a choice question needs options`);
    }

    if (question.kind !== 'choice' && question.options?.length) {
      problems.push(`${question.id}: options only apply to a choice question`);
    }
  });

  const checkGate = (owner: string, gate: Gate | undefined) => {
    if (!gate) return;

    const gatePosition = positionOf.get(gate.questionId);

    if (gatePosition === undefined) {
      problems.push(`${owner}: gate names unknown question ${gate.questionId}`);
      return;
    }

    const ownPosition = positionOf.get(owner);

    if (ownPosition !== undefined && gatePosition >= ownPosition) {
      problems.push(
        `${owner}: gate ${gate.questionId} is not asked before it`,
      );
    }
  };

  for (const section of form.sections) {
    if (section.gate) {
      const gatePosition = positionOf.get(section.gate.questionId);
      const first = section.questions[0];

      if (gatePosition === undefined) {
        problems.push(
          `${section.id}: gate names unknown question ${section.gate.questionId}`,
        );
      } else if (
        first &&
        gatePosition >= (positionOf.get(first.id) ?? Number.MAX_SAFE_INTEGER)
      ) {
        problems.push(
          `${section.id}: gate ${section.gate.questionId} is not asked before it`,
        );
      }
    }

    for (const question of section.questions) {
      checkGate(question.id, question.gate);
    }
  }

  return problems;
}
