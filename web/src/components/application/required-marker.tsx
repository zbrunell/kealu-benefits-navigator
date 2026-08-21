//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useTranslation } from "@/hooks/use-translation";

/**
 * The asterisk on a required field's label, and the legend that explains it.
 *
 * Two separate signals, deliberately:
 *
 * - The asterisk is `aria-hidden`, because a screen reader announcing
 *   "asterisk" after every label is noise.
 * - The required state itself travels on the input, via `required` and
 *   `aria-required`, which assistive technology already knows how to announce
 *   in the user's language.
 *
 * So the visual mark and the accessible state say the same thing by different
 * routes, rather than the mark standing in for the state.
 */

/** The `*` shown after a required field's label. */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-red-600">
      *
    </span>
  );
}

/**
 * A field label that shows an asterisk when the field is required.
 *
 * `isRequired` comes from the requiredness metadata, never from a judgement
 * made here — the mark and the check that blocks Continue must not be able to
 * disagree.
 */
export function FieldLabelText({
  labelKey,
  isRequired,
}: {
  labelKey: string;
  isRequired: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      {t(labelKey)}
      {isRequired && <RequiredMark />}
    </>
  );
}

/**
 * "* Required" — the legend explaining what the asterisks mean.
 *
 * Placed near the top of a form rather than beside each field, so the
 * explanation is given once.
 */
export function RequiredLegend() {
  const { t } = useTranslation();

  return (
    <p className="mt-1 text-xs text-slate-500">{t("required_legend")}</p>
  );
}

/**
 * The Continue button's classes.
 *
 * One definition, because "grey until the required answers are in" is a single
 * rule and three copies of it drift. Grey rather than a faded version of the
 * active colour: a washed-out green still reads as the primary action, which is
 * the opposite of what an unfinished form should signal.
 *
 * The button is never `disabled`. It stays clickable so that pressing it can
 * explain why nothing happened — a disabled button cannot be focused, so
 * someone navigating by keyboard reaches the end of the form and is told
 * nothing at all.
 */
export function continueButtonClass(isComplete: boolean): string {
  const shared = "rounded-lg px-4 py-2 text-sm font-medium";

  return isComplete
    ? `${shared} bg-green-700 text-white hover:bg-green-800`
    : `${shared} cursor-not-allowed bg-slate-300 text-slate-600`;
}

/**
 * Why Continue did nothing.
 *
 * In a live region so it is announced when it appears rather than only being
 * visible, and rendered only after an attempt — telling someone what they have
 * not filled in yet, before they have tried to move on, is scolding them for
 * not having finished typing.
 *
 * `fields` is optional. Naming what is outstanding saves a hunt through a long
 * form; a step whose requirement is "answer all of these" has nothing useful to
 * list and passes nothing.
 */
export function RequiredMissingNotice({
  show,
  testId,
  fields,
}: {
  show: boolean;
  testId: string;
  fields?: string[];
}) {
  const { t, tv } = useTranslation();

  return (
    <div aria-live="polite">
      {show && (
        <div
          data-testid={testId}
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm font-medium text-red-900">
            {t("validation_required_missing")}
          </p>

          {fields && fields.length > 0 && (
            <p className="mt-1 text-sm text-red-800">
              {tv("validation_still_needed", { fields: fields.join(", ") })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
