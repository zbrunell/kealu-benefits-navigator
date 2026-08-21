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
