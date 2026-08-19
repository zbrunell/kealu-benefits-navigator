//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The localization contract, enforced rather than described.
 *
 * Three separate failure modes get their own tests here, because they look
 * identical from the outside and have different causes:
 *
 *   absent       — the key is not in the catalog at all
 *   untranslated — the key is there, holding the English string
 *   leaked       — no key exists; English is hard-coded at the call site
 *
 * The third is the one that survives type checking, which is why the intake
 * definitions carry keys instead of sentences.
 */

import { describe, expect, it } from 'vitest';

import { messages, missingKeys, t } from '@/i18n';
import type { Locale } from '@/i18n';
import {
  ALL_FIELDS,
  TIER_1_FIELDS,
  TIER_2_FIELDS,
  parseIntakeAnswer,
} from '@/lib/intake-flow';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  documentLanguageFor,
  hasOfficialTranslatedForm,
  isSupportedLocale,
  localeFromCookieHeader,
  normalizeLocale,
} from '@/lib/locale';

const TRANSLATED: Locale[] = ['es', 'zh-CN'];

/** Keys whose value is legitimately identical across languages. */
const IDENTICAL_BY_DESIGN = new Set([
  // A language is always named in itself, so the picker is readable to the
  // person who needs it.
  'lang_en',
  'lang_es',
  'lang_zh_CN',
  // A ZIP code example is digits.
  'intake_zip_code_placeholder',
  // "Error" is the Spanish word for error. Translating it to something else
  // to satisfy this test would make the Spanish worse, not better.
  'phase_status_error',
  'phase_error_aria',
]);

// ── Catalog completeness ─────────────────────────────────────────────────────

describe('catalog completeness', () => {
  it.each(TRANSLATED)('%s defines every English key', (locale) => {
    expect(missingKeys(locale).absent).toEqual([]);
  });

  it.each(TRANSLATED)('%s actually translates what it defines', (locale) => {
    const untranslated = missingKeys(locale).untranslated.filter(
      (key) => !IDENTICAL_BY_DESIGN.has(key),
    );

    expect(untranslated).toEqual([]);
  });

  it('has no empty strings in any catalog', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const empty = Object.entries(messages[locale])
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key);

      expect(empty, `${locale} has empty values`).toEqual([]);
    }
  });

  it('carries the same key set in every locale, in both directions', () => {
    const english = Object.keys(messages.en).sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(messages[locale]).sort()).toEqual(english);
    }
  });
});

// ── No English leaking into a translated experience ──────────────────────────

describe('no untranslated English leaks', () => {
  /**
   * Words that mean the user is reading English where they asked for another
   * language. Deliberately common function words rather than nouns — program
   * names like "CalFresh" and "Medi-Cal" are proper nouns and stay.
   */
  const ENGLISH_TELLS = [
    ' the ',
    ' your ',
    ' please ',
    ' you can ',
    ' household ',
    ' income ',
    ' enter a ',
  ];

  it.each(TRANSLATED)('%s contains no English sentence fragments', (locale) => {
    const offenders: string[] = [];

    for (const [key, value] of Object.entries(messages[locale])) {
      if (IDENTICAL_BY_DESIGN.has(key)) continue;

      const haystack = ` ${value.toLowerCase()} `;

      if (ENGLISH_TELLS.some((tell) => haystack.includes(tell))) {
        offenders.push(key);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps official program names untranslated, as proper nouns', () => {
    // "CalFresh" is what is printed on the county's own Spanish form; calling
    // it something else would send an applicant asking for a program by a
    // name no caseworker uses.
    for (const locale of TRANSLATED) {
      const joined = Object.values(messages[locale]).join(' ');

      if (joined.includes('CalFresh') || joined.includes('Medi-Cal')) {
        expect(joined).not.toMatch(/Comida Fresca|新鲜食品/);
      }
    }
  });
});

// ── Intake definitions are language-neutral ──────────────────────────────────

describe('intake field definitions', () => {
  it('exposes one definition per question, not one per language', () => {
    expect(ALL_FIELDS).toHaveLength(TIER_1_FIELDS.length + TIER_2_FIELDS.length);
    expect(new Set(ALL_FIELDS.map((f) => f.key)).size).toBe(ALL_FIELDS.length);
  });

  it.each(SUPPORTED_LOCALES)('resolves every field in %s', (locale) => {
    for (const field of ALL_FIELDS) {
      expect(t(messages[locale], field.labelKey)).toBeTruthy();
      expect(t(messages[locale], field.rationaleKey)).toBeTruthy();
      expect(t(messages[locale], field.promptKey)).toBeTruthy();

      if (field.placeholderKey) {
        expect(t(messages[locale], field.placeholderKey)).toBeTruthy();
      }
    }
  });

  it('resolves each field to different words in different languages', () => {
    for (const field of ALL_FIELDS) {
      const english = t(messages.en, field.promptKey);
      const spanish = t(messages.es, field.promptKey);
      const chinese = t(messages['zh-CN'], field.promptKey);

      expect(spanish).not.toBe(english);
      expect(chinese).not.toBe(english);
      expect(chinese).not.toBe(spanish);
    }
  });
});

// ── Parsing is language-independent ──────────────────────────────────────────

describe('canonical parsing does not depend on language', () => {
  it('returns a message key, never a sentence, when rejecting', () => {
    const rejected = parseIntakeAnswer('zip_code', 'not a zip');

    expect(rejected.errorKey).toBe('intake_error_zip');
    expect(rejected.value).toBeUndefined();
  });

  it('resolves every parser error key in every language', () => {
    const keys = [
      parseIntakeAnswer('zip_code', 'nope').errorKey,
      parseIntakeAnswer('annual_income', 'lots').errorKey,
      parseIntakeAnswer('medications', '   ').errorKey,
    ].filter(Boolean) as string[];

    expect(keys.length).toBeGreaterThan(0);

    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) {
        expect(t(messages[locale], key)).not.toBe(key);
      }
    }
  });

  it('stores the same canonical value whatever the display language', () => {
    // The ZIP a Spanish speaker types is the ZIP an English speaker types.
    expect(parseIntakeAnswer('zip_code', '90210-1234').value).toBe('90210');
    expect(parseIntakeAnswer('annual_income', '$42,000').value).toBe('42000');
  });
});

// ── Locale resolution ────────────────────────────────────────────────────────

describe('locale resolution', () => {
  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['es_419', 'es'],
    ['zh-CN', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });

  it.each(['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO'])(
    'does not answer %s with Simplified Chinese',
    (input) => {
      // We do not render Traditional. Promising it would be worse than
      // falling back to a language we actually produce.
      expect(normalizeLocale(input)).toBe('en');
    },
  );

  it.each([null, undefined, '', '   ', 'klingon'])(
    'falls back to English for %s',
    (input) => {
      expect(normalizeLocale(input)).toBe(DEFAULT_LOCALE);
    },
  );

  it('reads the applicant’s choice from the cookie', () => {
    expect(localeFromCookieHeader('kbn-locale=es')).toBe('es');
    expect(localeFromCookieHeader('a=1; kbn-locale=zh-CN; b=2')).toBe('zh-CN');
  });

  it('does not consult Accept-Language', () => {
    // A borrowed English laptop must not override a chosen language.
    expect(localeFromCookieHeader('other=es-MX')).toBe('en');
  });

  it('recognizes exactly the supported locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true);
    }

    for (const other of ['zh', 'zh-TW', 'fr', '', null, 7]) {
      expect(isSupportedLocale(other)).toBe(false);
    }
  });
});

// ── Which paper each locale actually receives ────────────────────────────────

describe('official form availability', () => {
  it('gives Spanish the official Spanish form', () => {
    expect(documentLanguageFor('es')).toBe('es');
    expect(hasOfficialTranslatedForm('es')).toBe(true);
  });

  it('does not pretend Simplified Chinese has one', () => {
    expect(documentLanguageFor('zh-CN')).toBe('en');
    expect(hasOfficialTranslatedForm('zh-CN')).toBe(false);
  });

  it('explains the Chinese limitation in every language', () => {
    // Including English — an associate helping the applicant reads this too.
    for (const locale of SUPPORTED_LOCALES) {
      const explanation = t(
        messages[locale],
        'form_limitation_zh_hant_not_fillable',
      );

      expect(explanation).not.toBe('form_limitation_zh_hant_not_fillable');
      expect(explanation.length).toBeGreaterThan(40);
    }
  });

  it('agrees with the Python template registry on normalization', () => {
    /*
     * `form_templates.py` performs the same mapping for the generator. If the
     * two ever disagree, the UI promises one form and the PDF delivers
     * another. The Python side asserts the identical table.
     */
    const shared: Array<[string, string]> = [
      ['en', 'en'],
      ['en-US', 'en'],
      ['es', 'es'],
      ['es-MX', 'es'],
      ['zh-CN', 'zh-CN'],
      ['zh', 'zh-CN'],
      ['zh-Hans', 'zh-CN'],
      ['zh-Hant', 'en'],
      ['zh-TW', 'en'],
      ['zh-HK', 'en'],
    ];

    for (const [input, expected] of shared) {
      expect(normalizeLocale(input)).toBe(expected);
    }
  });
});
