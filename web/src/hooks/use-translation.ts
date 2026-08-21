//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * useTranslation — convenience hook for translating strings in client components.
 *
 * Returns a bound `t(key)` function that looks up the key in the current
 * locale's message catalog.  Falls back to the key itself when missing so
 * the UI always renders something meaningful.
 *
 * Usage:
 *   const { t } = useTranslation();
 *   <button>{t('chat_send')}</button>
 */

import { useLanguage } from '@/contexts/language-context';
import {
  interpolate,
  t as tFn,
  tPlural,
  translateQuestion,
  translateQuestionHelp,
} from '@/i18n';
import type { Messages } from '@/i18n';

export function useTranslation() {
  const { msgs, locale } = useLanguage();

  return {
    /** Translate a message key to the current locale's string. */
    t: (key: keyof Messages | string): string => tFn(msgs, key),
    /**
     * Translate a key that comes from data, with an explicit fallback.
     *
     * `t` throws on an unknown key, which is right for keys written in the
     * source: a typo should fail loudly. It is wrong for a key derived from
     * workflow output, where an unrecognised phase id is a data condition
     * rather than a bug — and where throwing would blank the report.
     */
    tOr: (key: string, fallback: string): string =>
      (msgs as unknown as Record<string, string>)[key] ?? fallback,
    /** Translate a key and substitute `{name}` placeholders. */
    tv: (
      key: keyof Messages | string,
      vars: Record<string, string | number>,
    ): string => interpolate(tFn(msgs, key), vars),
    /** Translate a count-dependent sentence, choosing the plural form. */
    tn: (
      baseKey: string,
      count: number,
      vars?: Record<string, string | number>,
    ): string => tPlural(msgs, locale, baseKey, count, vars),
    /** Translate a planned question's wording. */
    tq: (question: {
      promptKey: string;
      prompt: string;
      promptVars?: Record<string, string | number>;
    }): string =>
      translateQuestion(msgs, question),
    /** Translate a planned question's clarifying sentence, if it has one. */
    tqHelp: (question: { helpKey?: string; help?: string }): string | undefined =>
      translateQuestionHelp(msgs, question),
    locale,
  };
}