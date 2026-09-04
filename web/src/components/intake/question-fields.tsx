//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

/**
 * One question, rendered. Nothing here knows which form it is serving.
 *
 * The renderer is deliberately small and the configuration is where the
 * knowledge lives, so a second form is a data file rather than a second set of
 * components. What that buys concretely: the tri-state control, the asterisk,
 * the error line and the `aria-describedby` wiring are written once, so they
 * cannot be right on one state's flow and wrong on another's.
 *
 * ── The tri-state control ──────────────────────────────────────────────────
 * Two buttons and a third state. Neither button is "the input", so
 * `aria-required` sits on the group; the answer is missing only while both are
 * unpressed; and there is an explicit way back to unanswered, because someone
 * who taps Yes by mistake on a phone must be able to undo it without being
 * stuck asserting something on a government form.
 */

import { useState } from "react";

import { useTranslation } from "@/hooks/use-translation";
import {
  FieldLabelText,
  RequiredMark,
} from "@/components/application/required-marker";
import {
  isAnswered,
  type AnswerValue,
  type IntakeQuestion,
} from "@/lib/form-intake/model";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200";

/** The three-state Yes/No control. */
export function TriStateAnswer({
  id,
  value,
  onChange,
  labelledBy,
}: {
  id: string;
  value: boolean | undefined;
  onChange: (next: boolean | undefined) => void;
  labelledBy?: string;
}) {
  const { t } = useTranslation();

  const button = (answer: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={value === answer}
      data-testid={`${id}-${answer ? "yes" : "no"}`}
      onClick={() => onChange(answer)}
      className={
        value === answer
          ? "rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white"
          : "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      }
    >
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      {button(true, t("ui_yes"))}
      {button(false, t("ui_no"))}

      {value !== undefined && (
        /*
         * The way back to unanswered. Without it a mis-tap is permanent, and
         * the applicant's only escape is to assert the opposite — which is a
         * worse answer than none on a document they sign.
         */
        <button
          type="button"
          data-testid={`${id}-clear`}
          onClick={() => onChange(undefined)}
          className="rounded-lg px-2 py-2 text-xs font-medium text-slate-500 underline hover:text-slate-700"
        >
          {t("intake_clear_answer")}
        </button>
      )}
    </div>
  );
}

/** The error line under a field, announced and linked to its input. */
function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;

  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-700">
      {message}
    </p>
  );
}

interface QuestionFieldProps<TState> {
  question: IntakeQuestion<TState>;
  state: TState;
  onChange: (next: TState) => void;
  /** Show validation errors only once the applicant has tried to move on. */
  showErrors: boolean;
}

/**
 * Render one question of any kind.
 *
 * Text-like answers are held in local state while they are being typed and
 * committed on blur, so normalisation — trimming, uppercasing a state code,
 * putting the punctuation back in a phone number — never fights the cursor.
 */
export function QuestionField<TState>({
  question,
  state,
  onChange,
  showErrors,
}: QuestionFieldProps<TState>) {
  const { t } = useTranslation();

  const stored = question.read(state);
  const [draft, setDraft] = useState<string | null>(null);

  const promptId = `${question.id}-prompt`;
  const errorId = `${question.id}-error`;
  const helpId = `${question.id}-help`;

  const messageKey = showErrors ? (question.validate?.(stored) ?? null) : null;
  const missing =
    showErrors && question.required && !isAnswered(stored)
      ? "validation_required_missing"
      : null;
  const error = messageKey ?? missing;

  const commit = (value: AnswerValue) => {
    onChange(question.write(state, value));
  };

  const describedBy =
    [question.helpKey ? helpId : null, error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const help = question.helpKey ? (
    <p id={helpId} className="mt-1 text-xs text-slate-500">
      {t(question.helpKey)}
    </p>
  ) : null;

  if (question.kind === "yes_no") {
    return (
      <fieldset
        data-testid={`question-${question.id}`}
        className="rounded-lg border border-slate-200 bg-slate-50 p-4"
        aria-required={question.required}
      >
        <legend id={promptId} className="px-1 text-sm font-medium text-slate-800">
          {t(question.promptKey)}
          {question.required && <RequiredMark />}
        </legend>

        {help}

        <TriStateAnswer
          id={question.id}
          value={typeof stored === "boolean" ? stored : undefined}
          onChange={(next) => commit(next)}
          labelledBy={promptId}
        />

        <FieldError id={errorId} message={error ? t(error) : null} />
      </fieldset>
    );
  }

  if (question.kind === "choice") {
    return (
      <label className="block" data-testid={`question-${question.id}`}>
        <span className="text-sm font-medium text-slate-700">
          <FieldLabelText
            labelKey={question.promptKey}
            isRequired={question.required === true}
          />
        </span>

        {help}

        <select
          value={stored === undefined ? "" : String(stored)}
          aria-required={question.required}
          aria-describedby={describedBy}
          data-testid={`input-${question.id}`}
          onChange={(event) => commit(event.target.value || undefined)}
          className={INPUT_CLASS}
        >
          <option value="">{t("opt_select")}</option>

          {question.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label ?? t(option.labelKey)}
            </option>
          ))}
        </select>

        <FieldError id={errorId} message={error ? t(error) : null} />
      </label>
    );
  }

  const numeric = question.kind === "money" || question.kind === "integer";
  const inputType =
    question.kind === "date"
      ? "date"
      : question.kind === "email"
        ? "email"
        : question.kind === "tel"
          ? "tel"
          : numeric
            ? "number"
            : "text";

  const shown = draft ?? (stored === undefined ? "" : String(stored));

  return (
    <label className="block" data-testid={`question-${question.id}`}>
      <span className="text-sm font-medium text-slate-700">
        <FieldLabelText
          labelKey={question.promptKey}
          isRequired={question.required === true}
        />
      </span>

      {help}

      <input
        type={inputType}
        inputMode={numeric ? "decimal" : undefined}
        min={numeric ? 0 : undefined}
        value={shown}
        aria-required={question.required}
        aria-describedby={describedBy}
        data-testid={`input-${question.id}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const raw = draft;

          setDraft(null);

          if (raw === null) return;

          if (numeric) {
            commit(raw.trim() === "" ? undefined : Number(raw));
            return;
          }

          commit(question.normalize ? question.normalize(raw) : raw);
        }}
        className={INPUT_CLASS}
      />

      <FieldError id={errorId} message={error ? t(error) : null} />
    </label>
  );
}
