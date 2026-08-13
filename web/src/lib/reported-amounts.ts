//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Reported amounts versus normalized amounts.
 *
 * Eligibility maths wants one monthly number. The printed form wants the fact
 * the applicant actually stated: "$300 every two weeks", not "$650 monthly".
 * Those are different claims, and only one of them is something the applicant
 * signed their name under.
 *
 * So the two are stored separately and never substituted for one another:
 *
 *   reportedAmount + reportedFrequency  → what the applicant said, printed
 *   monthlyEquivalent(...)              → derived, used for budgets only
 *
 * The normalization here is deliberately not written to any PDF field. Writing
 * a converted number beside the word "Monthly" would put an assertion on a
 * signed government form that the applicant never made — and if the county
 * later compares it against pay stubs, the mismatch is the applicant's problem,
 * not ours.
 */

import type { PayFrequency } from '@/types/saws-questionnaire';

/**
 * How the printed form names each frequency.
 *
 * These strings go into the form's "How often?" columns, so they are the
 * applicant's own words rather than an internal enum leaking onto paper.
 */
export const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: 'Weekly',
  every_two_weeks: 'Every two weeks',
  twice_a_month: 'Twice a month',
  monthly: 'Monthly',
  irregular: 'Irregular',
};

/**
 * Average number of pay periods in a month.
 *
 * Weekly and biweekly pay do not divide evenly into months — 52 weeks over 12
 * months is 4.333 periods, and some months contain a third biweekly paycheck.
 * That is exactly why the monthly figure is an estimate for internal use and
 * never a reported fact.
 */
const PERIODS_PER_MONTH: Record<PayFrequency, number | null> = {
  weekly: 52 / 12,
  every_two_weeks: 26 / 12,
  twice_a_month: 2,
  monthly: 1,
  // An irregular amount has no meaningful monthly multiple.
  irregular: null,
};

/**
 * Monthly equivalent of a reported amount, for internal budgeting only.
 *
 * Returns undefined when the conversion would be a guess: an unknown frequency,
 * an irregular one, or a missing amount. A caller that needs a number must
 * handle that rather than receive a fabricated one.
 */
export function monthlyEquivalent(
  amount: number | undefined,
  frequency: PayFrequency | undefined,
): number | undefined {
  if (amount === undefined || !Number.isFinite(amount)) return undefined;
  if (frequency === undefined) return undefined;

  const periods = PERIODS_PER_MONTH[frequency];
  if (periods === null) return undefined;

  return Math.round(amount * periods * 100) / 100;
}

/** A record carrying a reported amount, its frequency, and a legacy monthly value. */
export interface ReportedAmountFields {
  reportedAmount?: number;
  reportedFrequency?: PayFrequency;
  /**
   * Legacy monthly figure, from before amount and frequency were collected
   * separately. The questionnaire labelled this field "Monthly amount", so a
   * value here *was* reported as a monthly amount and may be printed as one.
   */
  amountMonthly?: number;
}

export interface PrintableAmount {
  /** The amount to print in the form's "How much?" column. */
  amount?: number;
  /** The words to print in the form's "How often?" column. */
  frequency?: string;
}

/**
 * What to print for an amount, preferring the applicant's reported facts.
 *
 * Falls back to the legacy monthly figure only when no reported pair exists,
 * and never invents a frequency: an amount with no known frequency prints the
 * amount and leaves the frequency column blank for the applicant to complete.
 */
export function printableAmount(
  record: ReportedAmountFields,
): PrintableAmount {
  if (record.reportedAmount !== undefined) {
    return {
      amount: record.reportedAmount,
      frequency: record.reportedFrequency
        ? FREQUENCY_LABELS[record.reportedFrequency]
        : undefined,
    };
  }

  if (record.amountMonthly !== undefined) {
    return { amount: record.amountMonthly, frequency: FREQUENCY_LABELS.monthly };
  }

  return {};
}

/**
 * Monthly value for internal calculations, from whichever fields exist.
 *
 * Used by budgeting and readiness, never by the PDF adapter.
 */
export function monthlyForBudget(
  record: ReportedAmountFields,
): number | undefined {
  const derived = monthlyEquivalent(
    record.reportedAmount,
    record.reportedFrequency,
  );

  return derived ?? record.amountMonthly;
}
