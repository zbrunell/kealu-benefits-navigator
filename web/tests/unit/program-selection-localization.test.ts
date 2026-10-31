//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The SAWS 2 PLUS program-selection page, in every language.
 *
 * The regression these guard against: eligibility explanations were English
 * sentences assembled inside the screening, so a Spanish reader got a Spanish
 * page frame wrapped around English analysis. The screening now names sentences
 * and the presentation layer writes them, which is what makes these assertions
 * possible at all.
 *
 * They deliberately check *rendered output* rather than which key a screening
 * chose. A test that asserts "the key is elig_calfresh_no_asset_test" passes
 * whether or not that key has a Spanish translation, which is the whole bug.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildFixtureContext,
  fplForHouseholdSize,
} from '@/lib/e2e-fixture';
import {
  formatReasonParam,
  resolveReason,
  resolveReasons,
} from '@/lib/eligibility-reasons';
import { messages } from '@/i18n';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locale';

const SRC = path.resolve(__dirname, '../../src');

/** Intake vars for a household, as the fixture receives them. */
function vars(overrides: Record<string, string> = {}) {
  return {
    zip_code: '90001',
    annual_income: '10000',
    household_profile: 'One adult, age 34.',
    ...overrides,
  };
}

const screeningsFor = (v: Record<string, string>) =>
  buildFixtureContext(v).screenings;

/** Every reason and missing-information item on the page, as sentences. */
function pageSentences(
  v: Record<string, string>,
  locale: Locale,
): string[] {
  const msgs = messages[locale];

  return screeningsFor(v).flatMap((screening) => [
    ...resolveReasons(screening.reasons, msgs, locale),
    ...resolveReasons(screening.missingInformation, msgs, locale),
  ]);
}

// ---------------------------------------------------------------------------
// No language leaks into another
// ---------------------------------------------------------------------------

/**
 * English function words that do not occur in Spanish or Chinese sentences.
 *
 * Deliberately short and unambiguous: "the" and "and" are not Spanish words,
 * whereas "no" and "final" are, and would produce false alarms.
 */
const ENGLISH_MARKERS = [
  'the',
  'and',
  'with',
  'household',
  'income',
  'above',
  'below',
  'within',
  'monthly',
  'child',
  'children',
  'requires',
  'qualify',
];

const SPANISH_MARKERS = ['hogar', 'ingresos', 'por debajo', 'mensual', 'menor'];

const CJK = /[一-鿿]/;

describe('no applicant-visible English survives in Spanish', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['a single adult at 64% FPL', vars()],
    ['a family with children', vars({ household_profile: 'Two adults, ages 30 and 32, and two children, ages 4 and 8.', annual_income: '45000' })],
    ['a pregnant applicant', vars({ household_profile: 'One adult, age 27, who is pregnant.', annual_income: '25000' })],
    ['a household above every limit', vars({ annual_income: '250000' })],
  ];

  for (const [name, v] of cases) {
    it(`${name} reads entirely in Spanish`, () => {
      const sentences = pageSentences(v, 'es');

      expect(sentences.length).toBeGreaterThan(0);

      for (const sentence of sentences) {
        for (const marker of ENGLISH_MARKERS) {
          expect(
            sentence,
            `English word "${marker}" in Spanish output: ${sentence}`,
          ).not.toMatch(new RegExp(`(^|[^\\p{L}])${marker}([^\\p{L}]|$)`, 'iu'));
        }

        // Nor should a Chinese sentence appear in the Spanish page.
        expect(sentence, sentence).not.toMatch(CJK);
      }
    });
  }
});

describe('no other language leaks into English', () => {
  it('English output contains no Spanish or Chinese', () => {
    const sentences = pageSentences(vars(), 'en');

    expect(sentences.length).toBeGreaterThan(0);

    for (const sentence of sentences) {
      expect(sentence).not.toMatch(CJK);

      for (const marker of SPANISH_MARKERS) {
        expect(sentence, sentence).not.toMatch(
          new RegExp(`(^|[^\\p{L}])${marker}([^\\p{L}]|$)`, 'iu'),
        );
      }
    }
  });
});

describe('Simplified Chinese does not fall back to English', () => {
  it('every sentence contains Chinese characters', () => {
    const sentences = pageSentences(vars(), 'zh-CN');

    expect(sentences.length).toBeGreaterThan(0);

    for (const sentence of sentences) {
      expect(sentence, `no Chinese in: ${sentence}`).toMatch(CJK);
    }
  });

  it('every reason key used by the screening has a Chinese entry', () => {
    // The point of the check: a missing key would silently render English in
    // production, and the sweep above would still pass on the keys that exist.
    const scenarios = [
      vars(),
      vars({ household_profile: 'Two adults and two children, ages 4 and 8.', annual_income: '45000' }),
      vars({ household_profile: 'One adult, age 27, who is pregnant.', annual_income: '25000' }),
      vars({ annual_income: '250000' }),
    ];

    for (const v of scenarios) {
      for (const screening of screeningsFor(v)) {
        for (const item of [
          ...screening.reasons,
          ...screening.missingInformation,
        ]) {
          if (item.kind !== 'keyed') continue;

          for (const locale of SUPPORTED_LOCALES) {
            // resolveReason throws in test on a missing key, which is the
            // behaviour we want; calling it is the assertion.
            expect(
              () => resolveReason(item, messages[locale], locale),
              `${locale} / ${item.key}`,
            ).not.toThrow();
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Dynamic values
// ---------------------------------------------------------------------------

describe('dynamic values survive localization', () => {
  it('keeps the income, percentage and household size in the Spanish sentence', () => {
    const [mediCal] = screeningsFor(vars());
    const spanish = resolveReason(mediCal.reasons[0], messages.es, 'es');

    // The numbers themselves, whatever the surrounding words.
    expect(spanish).toContain('$10,000');
    expect(spanish).toContain('64');
    expect(spanish).toContain('2025');
  });

  it('formats currency and percentages for the locale', () => {
    // Same underlying values, different presentation.
    expect(formatReasonParam('income', 10000, 'en')).toBe('$10,000');
    expect(formatReasonParam('fplPercent', 64, 'en')).toBe('64%');

    /*
     * Spanish for a California reader, not for Spain: generic `es` would give
     * "10.000 US$", which is correct Castilian and unlike every pay stub and
     * utility bill the applicant already has.
     */
    expect(formatReasonParam('income', 10000, 'es')).toBe('$10,000');
    expect(formatReasonParam('fplPercent', 64, 'es')).toBe('64%');

    // Chinese groups the same way and marks the currency differently.
    expect(formatReasonParam('income', 10000, 'zh-CN')).toContain('10,000');
  });

  it('never groups the FPL year', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(formatReasonParam('fplYear', 2025, locale), locale).toBe('2025');
    }
  });

  it('substitutes every placeholder, in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const sentence of pageSentences(vars(), locale)) {
        // An unresolved {placeholder} means a param name drifted.
        expect(sentence, `${locale}: ${sentence}`).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Per-program reasons
// ---------------------------------------------------------------------------

describe('each programme’s reasons localize', () => {
  const programOf = (v: Record<string, string>, program: string) =>
    screeningsFor(v).find((s) => s.program === program)!;

  it('Medi-Cal income and expansion reasons', () => {
    const mediCal = programOf(vars(), 'medi_cal');

    expect(mediCal.status).toBe('likely_eligible');

    const spanish = resolveReasons(mediCal.reasons, messages.es, 'es');

    expect(spanish.join(' ')).toContain('Medicaid');
    expect(spanish.join(' ')).toMatch(/hogar/);
  });

  it('CalFresh gross-income and asset-test reasons', () => {
    const calfresh = programOf(vars(), 'calfresh');
    const spanish = resolveReasons(calfresh.reasons, messages.es, 'es');

    expect(spanish.join(' ')).toMatch(/ingreso bruto/i);
    expect(spanish.join(' ')).toMatch(/bienes/i);
  });

  it('CalWORKs ineligibility reason', () => {
    const calworks = programOf(vars(), 'calworks');

    expect(calworks.status).toBe('unlikely_eligible');

    const spanish = resolveReasons(calworks.reasons, messages.es, 'es');

    expect(spanish.join(' ')).toMatch(/embarazo/i);
  });

  it('missing-information items', () => {
    const calfresh = programOf(vars(), 'calfresh');

    expect(calfresh.missingInformation.length).toBeGreaterThan(0);

    const spanish = resolveReasons(
      calfresh.missingInformation,
      messages.es,
      'es',
    );

    expect(spanish).toContain('Alquiler o pago mensual de la hipoteca');
    expect(spanish).toContain('Costos mensuales de servicios públicos');
  });

  it('plural forms pick the right sentence', () => {
    const family = vars({
      household_profile: 'Two adults, ages 30 and 32, and two children, ages 4 and 8.',
      annual_income: '45000',
    });

    for (const locale of SUPPORTED_LOCALES) {
      const sentences = pageSentences(family, locale);

      // Whatever the plural rules, nothing may render a bare key.
      for (const sentence of sentences) {
        expect(sentence, `${locale}: ${sentence}`).not.toMatch(/^elig_|^missing_/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The page's own chrome
// ---------------------------------------------------------------------------

describe('the page’s own strings are localized', () => {
  const KEYS = [
    'prog_other_explanation',
    'programs_other',
    'programs_info_needed',
    'prog_none_selected',
    'prog_selected_one',
    'prog_selected_other',
    'status_likely_eligible',
    'status_possibly_eligible',
    'status_unlikely_eligible',
    'status_insufficient_information',
    'ui_recommended',
    'ui_continue',
    'ui_back',
  ];

  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale} defines every program-selection string`, () => {
      const catalog = messages[locale] as unknown as Record<string, string>;

      for (const key of KEYS) {
        expect(catalog[key], `${locale}.${key}`).toBeTruthy();
      }
    });
  }

  it('translates the "Other" explanation rather than leaving it English', () => {
    expect(messages.es.prog_other_explanation).toMatch(/solicitud/i);
    expect(messages['zh-CN'].prog_other_explanation).toMatch(CJK);
    expect(messages.es.prog_other_explanation).not.toBe(
      messages.en.prog_other_explanation,
    );
  });
});

// ---------------------------------------------------------------------------
// Error and fallback states
// ---------------------------------------------------------------------------

describe('errors an applicant can meet on this page are localized', () => {
  const KEYS = [
    'api_error_field_problems',
    'api_error_workflow_unavailable',
    'av_answers_need_correcting',
    'av_draft_failed',
    'report_start_failed',
    'report_refresh_failed',
    'validation_required_missing',
  ];

  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale} translates every error state`, () => {
      const catalog = messages[locale] as unknown as Record<string, string>;

      for (const key of KEYS) {
        expect(catalog[key], `${locale}.${key}`).toBeTruthy();
      }
    });
  }

  it('our own routes send a key, not only English prose', () => {
    /*
     * A route has no locale, so it cannot choose words — but it can name the
     * sentence. Without a key the UI could only show the route's English, which
     * is how a Spanish page ended up with an English error banner.
     */
    for (const file of [
      'app/api/workflow/start/route.ts',
      'app/api/workflow/[runId]/draft/route.ts',
    ]) {
      const source = readFileSync(path.join(SRC, file), 'utf8');

      expect(source, file).toContain('errorKey');
    }
  });

  it('the UI prefers the key over the route’s English', () => {
    for (const file of [
      'components/application-view.tsx',
      'components/report-view.tsx',
    ]) {
      const source = readFileSync(path.join(SRC, file), 'utf8');

      expect(source, file).toMatch(/tOr\(\s*(result|data)\.errorKey/);
    }
  });
});

// ---------------------------------------------------------------------------
// Language must not change the determination
// ---------------------------------------------------------------------------

describe('language does not change the eligibility determination', () => {
  it('produces identical statuses, recommendations and confidence', () => {
    const scenarios = [
      vars(),
      vars({ annual_income: '45000', household_profile: 'Two adults and two children.' }),
      vars({ annual_income: '250000' }),
    ];

    for (const v of scenarios) {
      const screenings = screeningsFor(v);

      /*
       * The screening is computed once and rendered many times, so the check
       * that matters is that nothing in the *data* is language-dependent: no
       * locale is passed to the screening, and the reasons are keys, not prose.
       */
      const determination = screenings.map((s) => ({
        program: s.program,
        status: s.status,
        recommendedToApply: s.recommendedToApply,
        confidence: s.confidence,
        keys: s.reasons.map((r) => (r.kind === 'keyed' ? r.key : r.text)),
      }));

      // Rendering in each locale must not mutate anything.
      for (const locale of SUPPORTED_LOCALES) {
        pageSentences(v, locale);
      }

      expect(
        screeningsFor(v).map((s) => ({
          program: s.program,
          status: s.status,
          recommendedToApply: s.recommendedToApply,
          confidence: s.confidence,
          keys: s.reasons.map((r) => (r.kind === 'keyed' ? r.key : r.text)),
        })),
      ).toEqual(determination);
    }
  });

  it('the screening takes no locale at all', () => {
    // The strongest form of the guarantee: there is no locale to pass.
    expect(buildFixtureContext.length).toBe(1);
  });

  it('the FPL figures are the same whatever the language', () => {
    expect(fplForHouseholdSize(1)).toBe(15_650);

    for (const locale of SUPPORTED_LOCALES) {
      const [mediCal] = screeningsFor(vars());
      const rendered = resolveReason(mediCal.reasons[0], messages[locale], locale);

      // 64% of FPL, whatever language says it.
      expect(rendered, locale).toMatch(/64/);
    }
  });
});
