// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING

/**
 * Unit tests for web/src/i18n/index.ts  (the t() function and messages catalog)
 * and the useTranslation hook's underlying lookup logic.
 *
 * `useTranslation()` is a React hook; testing it requires a React environment.
 * Instead we test `t()` directly — the hook is a thin wrapper that calls t()
 * with the current locale's catalog, so testing t() with both catalogs covers
 * the same logical surface.
 */

import { describe, it, expect } from 'vitest';
import { t, messages } from '@/i18n';
import type { Messages } from '@/i18n';

// ── Catalog completeness ──────────────────────────────────────────────────────

describe('messages catalog completeness', () => {
  const enKeys = Object.keys(messages.en) as (keyof Messages)[];

  it('English catalog has at least 40 keys', () => {
    expect(enKeys.length).toBeGreaterThanOrEqual(40);
  });

  /*
   * Every supported locale, not just Spanish. Simplified Chinese was not
   * checked here at all, so a key added to English and Spanish could reach
   * production missing from Chinese and fall back to showing the raw key.
   */
  const LOCALES = ['es', 'zh-CN'] as const;

  it.each(LOCALES)('%s catalog has exactly the same keys as English', (locale) => {
    const keys = new Set(Object.keys(messages[locale]));

    for (const key of enKeys) {
      expect(keys.has(key), `Missing ${locale} key: "${key}"`).toBe(true);
    }

    expect(Object.keys(messages[locale])).toHaveLength(enKeys.length);
  });

  it('no catalog value is empty string', () => {
    for (const locale of ['en', ...LOCALES] as const) {
      for (const [key, val] of Object.entries(messages[locale])) {
        expect(val.length, `${locale} key "${key}" is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('translates every validation message into every locale', () => {
    /*
     * Named explicitly rather than inferred: these are the strings a user sees
     * at the moment they have made a mistake, which is the worst moment to be
     * shown a raw key or somebody else's language.
     */
    const VALIDATION_KEYS = [
      'dob_error_future',
      'dob_error_too_old',
      'dob_error_malformed',
      'dob_error_too_young',
      'field_error_email',
      'field_error_phone',
      'field_error_address_number',
      'field_error_address_street',
      'field_error_zip',
      'field_error_city',
      'answer_error_required',
      'answer_error_amount',
      'answer_error_date',
      'answer_error_required_to_file',
    ] as const;

    for (const locale of ['en', ...LOCALES] as const) {
      for (const key of VALIDATION_KEYS) {
        const value = (messages[locale] as Record<string, string>)[key];

        expect(value, `${locale} is missing ${key}`).toBeTruthy();
        // A locale that merely copied the English is not a translation.
        if (locale !== 'en') {
          expect(
            value,
            `${locale} ${key} is identical to English`,
          ).not.toBe((messages.en as Record<string, string>)[key]);
        }
      }
    }
  });
});

// ── t() — English lookups ─────────────────────────────────────────────────────

describe('t() with English catalog', () => {
  it('returns the correct English string for "error_try_again"', () => {
    expect(t(messages.en, 'error_try_again')).toBe('Try Again');
  });

  it('returns the correct English string for "error_edit_info"', () => {
    expect(t(messages.en, 'error_edit_info')).toBe('Edit my information');
  });

  it('returns "Send" for "chat_send"', () => {
    expect(t(messages.en, 'chat_send')).toBe('Send');
  });

  it('returns "Run Analysis" for "chat_run_analysis"', () => {
    expect(t(messages.en, 'chat_run_analysis')).toBe('Run Analysis');
  });

  it('returns "Bottom Line" for "report_bottom_line"', () => {
    expect(t(messages.en, 'report_bottom_line')).toBe('Bottom Line');
  });

  it('returns "Complete" for "phase_status_complete"', () => {
    expect(t(messages.en, 'phase_status_complete')).toBe('Complete');
  });
});

// ── t() — Spanish lookups ─────────────────────────────────────────────────────

describe('t() with Spanish catalog', () => {
  it('returns the Spanish string for "error_try_again"', () => {
    expect(t(messages.es, 'error_try_again')).toBe('Intentar de nuevo');
  });

  it('returns the Spanish string for "error_edit_info"', () => {
    expect(t(messages.es, 'error_edit_info')).toBe('Editar mi información');
  });

  it('returns "Enviar" for "chat_send"', () => {
    expect(t(messages.es, 'chat_send')).toBe('Enviar');
  });

  it('returns "Ejecutar análisis" for "chat_run_analysis"', () => {
    expect(t(messages.es, 'chat_run_analysis')).toBe('Ejecutar análisis');
  });

  it('returns "Conclusión" for "report_bottom_line"', () => {
    expect(t(messages.es, 'report_bottom_line')).toBe('Conclusión');
  });

  it('returns "Completo" for "phase_status_complete"', () => {
    expect(t(messages.es, 'phase_status_complete')).toBe('Completo');
  });
});

// ── t() — fallback and robustness ─────────────────────────────────────────────

describe('t() fallback behaviour', () => {
  it('returns the key string itself when key is missing from catalog', () => {
    expect(t(messages.en, 'totally_nonexistent_key')).toBe('totally_nonexistent_key');
  });

  it('returns the key for a Spanish missing-key as well', () => {
    expect(t(messages.es, 'missing_in_both')).toBe('missing_in_both');
  });

  it('never throws for any key/catalog combination', () => {
    const edgeCases = ['', ' ', 'undefined', 'null', '0'];
    for (const key of edgeCases) {
      expect(() => t(messages.en, key)).not.toThrow();
      expect(() => t(messages.es, key)).not.toThrow();
    }
  });

  it('returns a string (never undefined or null) for any input', () => {
    expect(typeof t(messages.en, 'chat_send')).toBe('string');
    expect(typeof t(messages.en, '__missing__')).toBe('string');
  });
});

// ── Locale-to-catalog mapping ─────────────────────────────────────────────────

describe('messages map', () => {
  it('maps "en" to English catalog', () => {
    expect(t(messages.en, 'lang_en')).toBe('English');
  });

  it('maps "es" to Spanish catalog', () => {
    // "Español" appears in both catalogs — it's always shown in the language itself
    expect(t(messages.es, 'lang_es')).toBe('Español');
  });

it('has exactly three locale entries', () => {
  expect(Object.keys(messages)).toEqual(['en', 'es', 'zh-CN']);
});
});
