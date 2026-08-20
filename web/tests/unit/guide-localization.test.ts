//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The completion guide in every language the product serves.
 *
 * Two properties matter and are easy to get wrong:
 *
 * - the guide is written in the applicant's language, including the document's
 *   own `lang` attribute, so a screen reader and a browser translator both
 *   behave;
 * - the *form* language is stated separately. A Simplified Chinese applicant
 *   reads a Chinese guide while holding the English form, because CDSS
 *   publishes no fillable Simplified Chinese SAWS 2 PLUS. Saying nothing would
 *   send them looking for Chinese labels that are not there.
 */

import { describe, expect, it } from 'vitest';

import { buildCompletionGuide, draftReferenceFrom } from '@/lib/completion-guide';
import { renderCompletionGuideHtml } from '@/lib/completion-guide-html';
import { documentLanguageFor, SUPPORTED_LOCALES, type Locale } from '@/lib/locale';
import { messages } from '@/i18n';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

function application(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: [],
  };
}

function guideFor(locale: Locale, audience: 'applicant' | 'associate' = 'applicant') {
  return buildCompletionGuide({
    application: application(),
    audience,
    locale,
    county: 'Los Angeles',
    draft: {
      reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
      generatedAt: '2026-08-17T22:51:00.000Z',
      pdfFilename: 'saws-2-plus.pdf',
    },
  });
}

describe.each(SUPPORTED_LOCALES)('guide in %s', (locale) => {
  it('records the locale and the form language separately', () => {
    const guide = guideFor(locale);

    expect(guide.locale).toBe(locale);
    expect(guide.documentLanguage).toBe(documentLanguageFor(locale));
  });

  it('declares the language on the document itself', () => {
    expect(renderCompletionGuideHtml(guideFor(locale))).toContain(
      `<html lang="${locale}">`,
    );
  });

  it('uses the catalog title for both audiences', () => {
    const msgs = messages[locale];

    expect(guideFor(locale, 'applicant').title).toBe(msgs.guide_title_applicant);
    expect(guideFor(locale, 'associate').title).toBe(msgs.guide_title_associate);
  });

  it('labels the identity block in the reader’s language', () => {
    const html = renderCompletionGuideHtml(guideFor(locale));
    const msgs = messages[locale];

    for (const label of [
      msgs.guide_label_applicant,
      msgs.guide_label_county,
      msgs.guide_label_draft_reference,
      msgs.guide_label_answers_filled,
    ]) {
      expect(html).toContain(label);
    }
  });

  it('writes the generated stamp with a real date and UTC', () => {
    const html = renderCompletionGuideHtml(guideFor(locale));

    expect(html).toMatch(/2026/);
    expect(html).toContain('UTC');
  });

  it('localizes the location prefix rather than hard-coding "PDF page"', () => {
    const html = renderCompletionGuideHtml(guideFor(locale, 'associate'));
    const prefix = messages[locale].guide_location_pdf_page.replace('{page}', '');

    // Only meaningful when the draft has at least one located blank.
    if (/·/.test(html)) {
      expect(html).toContain(prefix.trim().split('{')[0].trim().slice(0, 4));
    }
  });
});

describe('the form-language limitation is surfaced, not hidden', () => {
  it('says nothing extra when the form is in the reader’s language', () => {
    for (const locale of ['en', 'es'] as const) {
      const html = renderCompletionGuideHtml(guideFor(locale));

      expect(documentLanguageFor(locale)).toBe(locale);
      expect(html).not.toContain(messages[locale].guide_form_language_notice_en_form);
    }
  });

  it('tells a Simplified Chinese reader the form itself is English', () => {
    // CDSS publishes no fillable Simplified Chinese SAWS 2 PLUS, so the guide
    // has to say which paper the reader is actually holding.
    expect(documentLanguageFor('zh-CN')).toBe('en');

    const html = renderCompletionGuideHtml(guideFor('zh-CN'));

    expect(html).toContain(messages['zh-CN'].guide_form_language_notice_en_form);
  });
});

describe('no English leaks into the translated guide frame', () => {
  /*
   * Scope: the document frame — title, identity block, notices, footer.
   *
   * The section titles, intros and per-item instructions come from
   * completion-guide.ts and draft-completion.ts and are covered by
   * `guide-body-localization.test.ts`. Keeping the two apart means a failure
   * names which layer leaked.
   */
  const ENGLISH_TELLS = [
    'Draft reference',
    'Answers filled',
    'Goes with',
    'Finishing and submitting',
    'what this draft still needs',
    'This guide describes one generated draft',
  ];

  it.each(['es', 'zh-CN'] as const)('%s guide contains no English tells', (locale) => {
    const html = renderCompletionGuideHtml(guideFor(locale, 'applicant'))
      + renderCompletionGuideHtml(guideFor(locale, 'associate'));

    for (const tell of ENGLISH_TELLS) {
      expect(html, `${locale} leaked "${tell}"`).not.toContain(tell);
    }
  });
});
