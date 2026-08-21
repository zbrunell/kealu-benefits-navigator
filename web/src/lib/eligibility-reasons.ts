//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Eligibility explanations as data, so the presentation layer can localize them.
 *
 * The screening decides *what* is true about a household — income is 64% of the
 * Federal Poverty Level, there is no dependent child — and names the sentence
 * that says so. It never writes the sentence. That separation is what makes an
 * explanation translatable at all: an English sentence assembled in the
 * screening has nowhere for Spanish to come from, and every attempt to add it
 * later ends in either a second copy of the eligibility logic or Spanish
 * hard-coded into a component.
 *
 * Two shapes, because there are two producers and only one of them is ours:
 *
 * - `keyed` — our deterministic screening. A catalog key plus the numbers, so
 *   it renders in whatever language the applicant chose.
 * - `text` — a sentence from the external workflow, which writes prose we
 *   cannot key. It is passed through unchanged. The workflow is told the
 *   applicant's language (see the report route's `preferredLanguage`), so this
 *   is not a silent English fallback — but it is also not something this module
 *   can guarantee, and pretending otherwise by wrapping it in a fake key would
 *   hide that.
 */

import { interpolate, pluralCategory, t, type Locale, type Messages } from '@/i18n';

/** An explanation we can render in any language. */
export interface KeyedReason {
  kind: 'keyed';
  /** Catalog key naming the sentence. */
  key: string;
  /** The numbers the sentence needs. Never prose. */
  params?: Record<string, number | string>;
  /**
   * A count that selects the plural form, when the sentence has one.
   *
   * Separate from `params` because it changes which key is used, not only what
   * is substituted into it.
   */
  count?: number;
}

/** A sentence we received already written, from a producer we do not control. */
export interface TextReason {
  kind: 'text';
  text: string;
}

export type EligibilityReason = KeyedReason | TextReason;

/**
 * How each parameter is formatted for display.
 *
 * Declared by parameter name rather than inferred from the value, because
 * `138` is a percentage and `2025` is a year and nothing about the number says
 * which. Keyed by name so one table serves every sentence that uses it — and so
 * adding a differently-formatted parameter is a visible decision.
 *
 * The stored values never change: this is presentation only. `10000` stays
 * `10000` in the data and becomes "$10,000" or "$10 000" on screen.
 */
const PARAM_FORMATS: Record<string, 'currency' | 'percent' | 'integer'> = {
  income: 'currency',
  limitAmount: 'currency',
  grossLimit: 'currency',
  fplPercent: 'percent',
  limitPercent: 'percent',
  householdSize: 'integer',
  children: 'integer',
  // A year is a plain number: "2,025" would be wrong in every locale.
  fplYear: 'integer',
};

/** Whether a year-like parameter should be grouped. Years never are. */
const UNGROUPED_PARAMS = new Set(['fplYear']);

/**
 * The locale used for formatting numbers, which is not always the catalog's.
 *
 * The catalogs are generic — `es`, not `es-ES` or `es-MX` — because the wording
 * does not need to vary by country. Number formatting does. Generic `es`
 * renders $10,000 as "10.000 US$", which is right for Spain and wrong for the
 * applicant this form is for: someone in California, whose utility bills, pay
 * stubs and every other government notice use "$10,000".
 *
 * So formatting is pinned to the regional variant that matches what the reader
 * already sees on paper, while the sentences stay in the generic catalog.
 */
const FORMATTING_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-US',
  'zh-CN': 'zh-CN',
};

/**
 * Format one parameter for a locale.
 *
 * Currency stays USD because the amounts are US dollar figures from a
 * California benefits form; only the grouping and the symbol's placement follow
 * the reader's locale.
 */
export function formatReasonParam(
  name: string,
  value: number | string,
  locale: Locale,
): string {
  if (typeof value === 'string') return value;

  const format = PARAM_FORMATS[name];

  const formattingLocale = FORMATTING_LOCALES[locale];

  if (format === 'currency') {
    return new Intl.NumberFormat(formattingLocale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  }

  if (format === 'percent') {
    /*
     * Divided by 100 because `style: 'percent'` multiplies by it, and the
     * screening works in whole percentage points. Going through Intl rather
     * than appending "%" is what puts the space before the sign in Spanish —
     * "64 %" — and omits it in English.
     */
    return new Intl.NumberFormat(formattingLocale, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(value / 100);
  }

  if (UNGROUPED_PARAMS.has(name)) return String(value);

  return new Intl.NumberFormat(formattingLocale).format(value);
}

/**
 * Render one reason as a sentence in the reader's language.
 *
 * A keyed reason whose key is missing from the catalog falls back to the key
 * itself via `t`, which throws in development and test — the same staged policy
 * the rest of the catalog uses, so a forgotten translation is loud rather than
 * quietly English.
 */
export function resolveReason(
  reason: EligibilityReason,
  msgs: Messages,
  locale: Locale,
): string {
  if (reason.kind === 'text') return reason.text;

  const key =
    reason.count === undefined
      ? reason.key
      : `${reason.key}_${pluralCategory(locale, reason.count)}`;

  const formatted: Record<string, string> = {};

  for (const [name, value] of Object.entries(reason.params ?? {})) {
    formatted[name] = formatReasonParam(name, value, locale);
  }

  return interpolate(t(msgs, key), formatted);
}

/** Render a list of reasons. */
export function resolveReasons(
  reasons: readonly EligibilityReason[],
  msgs: Messages,
  locale: Locale,
): string[] {
  return reasons.map((reason) => resolveReason(reason, msgs, locale));
}

/** Shorthand for the screening: a keyed reason with no numbers. */
export function reason(key: string): KeyedReason {
  return { kind: 'keyed', key };
}

/** Shorthand for the screening: a keyed reason with numbers. */
export function reasonWith(
  key: string,
  params: Record<string, number | string>,
  count?: number,
): KeyedReason {
  return count === undefined
    ? { kind: 'keyed', key, params }
    : { kind: 'keyed', key, params, count };
}
