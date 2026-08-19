//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The locale, as a value the server can act on.
 *
 * `language-context.tsx` owns the locale for the browser. This module owns it
 * everywhere else — route handlers, the draft generator, the completion guide
 * — because those run without React context and must not guess.
 *
 * The rule the whole flow depends on: the locale is whatever the applicant
 * chose, carried forward. It is never re-derived from `Accept-Language` at
 * generation time. Someone who switched to Spanish on a borrowed English
 * laptop gets Spanish, and gets it on the PDF too.
 *
 * Kept deliberately in step with `src/benefits_navigator/form_templates.py`,
 * which performs the same normalization for the Python side. A test asserts
 * the two agree.
 */

/** Locales this product supports end to end. */
export const SUPPORTED_LOCALES = ['en', 'es', 'zh-CN'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** The locale used when nothing else is known. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie and localStorage key holding the applicant's choice. */
export const LOCALE_STORAGE_KEY = 'kbn-locale';

/** Whether `value` is one of the locales we serve. */
export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string'
    && (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Reduce any locale tag to one we support.
 *
 * Traditional Chinese tags (`zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`) deliberately
 * do *not* collapse into `zh-CN`. This product renders Simplified Chinese;
 * answering a Traditional request with Simplified would be promising a script
 * we do not produce. They fall back to English, which is at least honest.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;

  const lower = value.trim().replace(/_/g, '-').toLowerCase();

  if (lower.startsWith('es')) return 'es';

  if (lower.startsWith('zh')) {
    const traditional = ['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'];

    if (traditional.some((t) => lower.startsWith(t))) return DEFAULT_LOCALE;

    return 'zh-CN';
  }

  return DEFAULT_LOCALE;
}

/**
 * Read the applicant's locale from a request's Cookie header.
 *
 * The cookie is written by `language-context.tsx` whenever the applicant picks
 * a language, so it reflects a choice rather than a browser default.
 * `Accept-Language` is intentionally not consulted: it is the machine's
 * opinion, not the applicant's.
 */
export function localeFromCookieHeader(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const match = header.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_STORAGE_KEY}=([^;]+)`),
  );

  return match ? normalizeLocale(decodeURIComponent(match[1])) : DEFAULT_LOCALE;
}

/**
 * The language of the paper form an applicant in `locale` actually receives.
 *
 * Spanish has an official fillable CDSS translation. Simplified Chinese does
 * not — see `form_templates.py` — so its applicants get the English form with
 * a Simplified Chinese interface and guide, and every surface says so.
 */
export function documentLanguageFor(locale: Locale): Locale {
  return locale === 'es' ? 'es' : 'en';
}

/** Whether `locale` receives the official state form in its own language. */
export function hasOfficialTranslatedForm(locale: Locale): boolean {
  return documentLanguageFor(locale) === locale;
}
