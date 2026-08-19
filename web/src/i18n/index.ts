/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */

/**
 * i18n module — message catalogs, type utilities, and lookup function.
 *
 * Design: catalogs are plain `as const` objects so the compiler enforces
 * key parity between locales (es.ts is typed as `typeof en`).  The `t()`
 * function is a thin key-lookup — callers do any string interpolation
 * they need after the call.
 */

import en from './messages/en';
import es from './messages/es';
import zhCN from './messages/zh-CN';

/** Shape of a message catalog — derived from the English catalog, the source of truth. */
export type Messages = {
  [K in keyof typeof en]: string;
};

/** Supported locale codes. Kept in sync with SUPPORTED_LOCALES in language-context.tsx. */
export type Locale = 'en' | 'es' | 'zh-CN';

/** Map of every supported locale to its catalog. */
export const messages: Record<Locale, Messages> = { en, es, 'zh-CN': zhCN };

/**
 * Look up a translation by key in the given catalog.
 *
 * Fallback policy, deliberately staged rather than uniform:
 *
 *   development — throw. A missing key is a bug, and the loudest place to
 *                 learn about it is the first render, not a bug report from
 *                 someone reading half a sentence in Spanish.
 *   test        — throw, for the same reason; `missing-translations.test.ts`
 *                 additionally sweeps every key in every locale up front.
 *   production  — fall back to the English string, and only then to the key.
 *                 English is wrong for a Spanish reader, but it is a real
 *                 sentence; `intake_zip_code_prompt` is not, and a raw key on
 *                 screen tells an applicant nothing about their benefits.
 *
 * The English fallback is what stops a single missing key from turning the
 * page into a mixture of a language and a symbol table. It is a floor, not a
 * licence: `missingKeys()` exists so that floor is never quietly relied on.
 *
 * @param msgs  The catalog for the current locale (pass `messages[locale]`).
 * @param key   A key from Messages, or any arbitrary string.
 */
export function t(msgs: Messages, key: keyof Messages | string): string {
  const found = (msgs as Record<string, string>)[key];

  if (found !== undefined) return found;

  if (process.env.NODE_ENV !== 'production') {
    throw new Error(
      `Missing translation for "${String(key)}". Add it to every catalog in `
      + 'src/i18n/messages/ — en.ts, es.ts, and zh-CN.ts.',
    );
  }

  return (en as Record<string, string>)[key] ?? String(key);
}

/**
 * Keys present in English but absent — or left as the English string — in
 * `locale`.
 *
 * Used by the localization tests. Identical-to-English is reported because
 * that is what an untranslated placeholder looks like once someone has copied
 * en.ts over es.ts to make the compiler stop complaining.
 */
export function missingKeys(locale: Locale): {
  absent: string[];
  untranslated: string[];
} {
  const catalog = messages[locale] as Record<string, string>;
  const source = en as Record<string, string>;

  const absent: string[] = [];
  const untranslated: string[] = [];

  for (const key of Object.keys(source)) {
    const value = catalog[key];

    if (value === undefined || value === '') {
      absent.push(key);
    } else if (locale !== 'en' && value === source[key]) {
      untranslated.push(key);
    }
  }

  return { absent, untranslated };
}

/**
 * Resolve a planned question's wording for `msgs`.
 *
 * Falls back to the English source text carried on the question itself rather
 * than throwing, because a question with no answer on screen is worse than a
 * question in the wrong language. That fallback is a floor, not a plan:
 * `localization.test.ts` asserts every askable question has an entry in every
 * catalog, so reaching it means a test is already failing.
 */
export function translateQuestion(
  msgs: Messages,
  question: { promptKey: string; prompt: string },
): string {
  return (msgs as Record<string, string>)[question.promptKey] ?? question.prompt;
}

/** As `translateQuestion`, for the optional clarifying sentence. */
export function translateQuestionHelp(
  msgs: Messages,
  question: { helpKey?: string; help?: string },
): string | undefined {
  if (!question.helpKey) return question.help;

  return (msgs as Record<string, string>)[question.helpKey] ?? question.help;
}

