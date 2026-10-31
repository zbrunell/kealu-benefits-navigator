//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * How far through the questions the applicant is.
 *
 * ── Why this is not "page 4 of 11" ─────────────────────────────────────────
 * The Texas flow's screens are conditional: a healthcare-only household never
 * sees the SNAP expedited screen, and a household with no job never sees the
 * jobs table. A page counter over a list that changes length tells someone
 * they are 36% done and then, one answer later, 45% done without their having
 * answered anything — or worse, moves them backward.
 *
 * So progress is measured in *questions that apply to this household*, after
 * conditional logic: `answered / asked` from the intake model, which is the
 * same pair the review screen shows. Answering a question can still change the
 * denominator — saying "yes, someone has a job" opens the jobs table and adds
 * real work — and that is honest: there genuinely is more to do.
 *
 * ── What must never happen ─────────────────────────────────────────────────
 * Progress must not move **backward** because a question disappeared. Closing
 * a gate removes answered questions from the denominator *and* the numerator,
 * and the ratio can fall: answer three of four questions behind a gate, then
 * shut the gate, and 75% becomes 50%. Nothing the applicant did was undone, so
 * showing a smaller number reads as lost work.
 *
 * `highWaterMark` is therefore held by the caller across renders and this
 * component never displays less than it. It is a floor on the *displayed*
 * percentage only — the underlying counts stay truthful, and the bar reaches
 * 100% exactly when the questions are done.
 */

import { useTranslation } from '@/hooks/use-translation';

export interface IntakeProgressProps {
  /** Questions this household has answered, after conditional logic. */
  answered: number;

  /** Questions this household is actually asked. */
  asked: number;

  /**
   * The highest percentage shown so far, so the bar cannot retreat.
   *
   * Owned by the caller because it has to survive re-renders and screen
   * changes; a ref inside this component would reset whenever the flow
   * unmounted it.
   */
  highWaterMark?: number;

  testId?: string;
}

/** The percentage to display: truthful, and never lower than it has been. */
export function progressPercent(
  answered: number,
  asked: number,
  highWaterMark = 0,
): number {
  if (asked <= 0) return Math.max(0, Math.min(100, Math.round(highWaterMark)));

  const raw = Math.round((Math.min(answered, asked) / asked) * 100);

  return Math.max(0, Math.min(100, Math.max(raw, Math.round(highWaterMark))));
}

export default function IntakeProgress({
  answered,
  asked,
  highWaterMark = 0,
  testId = 'intake-progress',
}: IntakeProgressProps) {
  const { t, tv } = useTranslation();
  const percent = progressPercent(answered, asked, highWaterMark);

  return (
    <div data-testid={testId} className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-slate-600">
          {t('intake_progress_label')}
        </span>

        <span
          data-testid={`${testId}-value`}
          className="text-xs font-semibold tabular-nums text-slate-700"
        >
          {tv('intake_progress_percent', { percent: String(percent) })}
        </span>
      </div>

      {/*
        `progressbar` with the value on it, so a screen reader announces "64
        percent" rather than reading a decorative div. `aria-valuetext` carries
        the same localized string the sighted reader sees, because a bare "64"
        in a Spanish interface would be announced with English framing.

        The visible label is associated by `aria-label` rather than
        `aria-labelledby` on purpose: the label element is text, not a control,
        and pointing at it would make the announcement depend on where that
        text happens to sit in the DOM.
      */}
      <div
        role="progressbar"
        aria-label={t('intake_progress_label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={tv('intake_progress_percent', {
          percent: String(percent),
        })}
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      >
        {/*
          green-600 on slate-200 rather than a lighter green: the fill has to
          be distinguishable from the track for someone with low vision, and
          the pair clears 3:1 for non-text contrast.

          `transition-[width]` and not `transition-all`, so the bar animates
          its length without also animating colour on a re-render. 300ms is
          short enough to read as a response to the click that caused it.
        */}
        <div
          data-testid={`${testId}-fill`}
          style={{ width: `${percent}%` }}
          className="h-full rounded-full bg-green-600 transition-[width] duration-300 ease-out motion-reduce:transition-none"
        />
      </div>
    </div>
  );
}
