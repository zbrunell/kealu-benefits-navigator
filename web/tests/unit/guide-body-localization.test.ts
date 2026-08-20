//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The guide's *body* — section headings, lead sentences, and the review,
 * attachment and submission items.
 *
 * Kept apart from `guide-localization.test.ts`, which covers the document
 * frame, so a failure says which layer leaked rather than just "the guide is
 * wrong".
 *
 * The per-blank instructions inside each reason section come from
 * `draft-completion.ts` and are asserted separately; a comment at the bottom of
 * this file records that boundary rather than letting the sweep silently imply
 * more coverage than it has.
 */

import { describe, expect, it } from 'vitest';

import { buildCompletionGuide, draftReferenceFrom } from '@/lib/completion-guide';
import { messages } from '@/i18n';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locale';
import { writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

/** A household that triggers every optional attachment and submission item. */
function application(): Saws2PlusApplicationData {
  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: [],
  };

  let q = base.questionnaire;
  for (const path of [
    'income.earned.answer',
    'income.unearned.answer',
    'expenses.medical.answer',
    'resources.vehicles.answer',
  ]) {
    q = writePath(q, path, true);
  }

  return { ...base, questionnaire: q };
}

function guideFor(locale: Locale, county = 'Los Angeles') {
  return buildCompletionGuide({
    application: application(),
    audience: 'applicant',
    locale,
    county,
    draft: {
      reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
      generatedAt: '2026-08-17T22:51:00.000Z',
    },
  });
}

describe.each(SUPPORTED_LOCALES)('guide body in %s', (locale) => {
  const msgs = messages[locale];

  it('uses the catalog for the review section', () => {
    const review = guideFor(locale).sections.find((s) => s.id === 'review');

    expect(review?.title).toBe(msgs.guide_review_title);
    expect(review?.intro).toBe(msgs.guide_review_intro);
    expect(review?.items[0].title).toBe(msgs.guide_review_check_title);
  });

  it('interpolates the filled-answer count into a whole sentence', () => {
    const review = guideFor(locale).sections.find((s) => s.id === 'review');
    const detail = review?.items[0].detail ?? '';

    // The number appears, and no placeholder survived.
    expect(detail).toMatch(/\d/);
    expect(detail).not.toContain('{count}');
  });

  it('uses the catalog for the attachment section and its items', () => {
    const attach = guideFor(locale).sections.find((s) => s.id === 'attachments');

    expect(attach?.title).toBe(msgs.guide_attach_title);
    expect(attach?.intro).toBe(msgs.guide_attach_intro);

    const titles = attach?.items.map((i) => i.title) ?? [];
    for (const expected of [
      msgs.guide_attach_identity_title,
      msgs.guide_attach_earned_title,
      msgs.guide_attach_unearned_title,
      msgs.guide_attach_housing_title,
      msgs.guide_attach_medical_title,
      msgs.guide_attach_vehicle_title,
    ]) {
      expect(titles).toContain(expected);
    }
  });

  it('names the county in the submission section without a stray placeholder', () => {
    const submit = guideFor(locale).sections.find((s) => s.id === 'submission');

    expect(submit?.title).toBe(msgs.guide_submit_title);
    expect(submit?.intro).toContain('Los Angeles');
    expect(submit?.intro).not.toContain('{county}');
  });

  it('falls back to the unknown-county wording when the ZIP resolves nothing', () => {
    const submit = guideFor(locale, '').sections.find((s) => s.id === 'submission');

    expect(submit?.intro).toBe(msgs.guide_submit_intro_unknown);
  });

  it('keeps program names and URLs as proper nouns', () => {
    const submit = guideFor(locale).sections.find((s) => s.id === 'submission');
    const text = (submit?.items ?? []).map((i) => `${i.title} ${i.detail}`).join(' ');

    // Official names are not translated; a localized guide still says CalFresh.
    expect(text).toContain('BenefitsCal');
    expect(text).toContain('CalFresh');
    expect(text).toMatch(/https?:\/\//);
    expect(text).not.toContain('{url}');
  });

  it('translates every reason heading it renders', () => {
    for (const section of guideFor(locale).sections) {
      if (['review', 'attachments', 'submission'].includes(section.id)) continue;

      expect(section.title).toBe(
        (msgs as Record<string, string>)[`guide_section_${section.id}_title`],
      );
      expect(section.intro).toBe(
        (msgs as Record<string, string>)[`guide_section_${section.id}_intro`],
      );
    }
  });
});

describe('no English structure leaks into a translated body', () => {
  /**
   * Headings and lead sentences only.
   *
   * The per-blank instructions are still English — they come from
   * draft-completion.ts, which has no catalog yet — so this sweep deliberately
   * checks the strings this layer owns and does not pretend to check theirs.
   */
  const TELLS = [
    'Review',
    'Documents to attach',
    'Where to submit',
    'Start here, before filling',
    'Social Security Numbers',
    'Signatures',
    'Still missing from the application',
    'Proof of identity',
    'Online, through BenefitsCal',
  ];

  it.each(['es', 'zh-CN'] as const)('%s body has no English headings', (locale) => {
    const guide = guideFor(locale);
    const structural = guide.sections
      .map((s) => `${s.title} | ${s.intro ?? ''} | ${s.items.map((i) => i.title).join(' | ')}`)
      .join(' || ');

    for (const tell of TELLS) {
      expect(structural, `${locale} leaked "${tell}"`).not.toContain(tell);
    }
  });
});
