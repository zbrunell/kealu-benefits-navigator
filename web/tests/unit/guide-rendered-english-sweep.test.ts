//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * A sweep of the guide's *rendered* HTML for English an applicant can read.
 *
 * The other guide tests check that each piece resolves the right catalog key.
 * That is the stronger assertion for structure, but it cannot catch a key whose
 * value is still English — the key would be correct and the page would still be
 * in the wrong language. This renders the whole page instead and reads it.
 *
 * The Spanish page is the one worth sweeping this way. Its document language is
 * Spanish, so *everything* on it — interface text and the quotations of the
 * form — should be Spanish, which makes any English sentence a finding. The
 * Simplified Chinese page deliberately quotes the English form, because that is
 * the document the applicant is holding, so English there is correct and the
 * sweep would only produce noise.
 */

import { describe, expect, it } from 'vitest';

import { buildCompletionGuide, draftReferenceFrom } from '@/lib/completion-guide';
import { renderCompletionGuideHtml } from '@/lib/completion-guide-html';
import { writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

/** A household that reaches as many guide sections as possible. */
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

function spanishGuideHtml(): string {
  return renderCompletionGuideHtml(
    buildCompletionGuide({
      application: application(),
      audience: 'applicant',
      locale: 'es',
      county: 'Los Angeles',
      draft: {
        reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
        generatedAt: '2026-08-17T22:51:00.000Z',
      },
    }),
  );
}

/**
 * Words that are English but correct on a Spanish page.
 *
 * Proper nouns, and the handful of English terms the Spanish form itself
 * prints. Listed by name so that adding one is a decision rather than a
 * loosening of the sweep.
 */
const ALLOWED_ENGLISH = [
  'SAWS',
  'PLUS',
  'CalFresh',
  'CalWORKs',
  'Medi-Cal',
  'BenefitsCal',
  'Covered California',
  'Kealu',
  'benefitscal.com',
  'coveredca.com',
  'Maria',
  'Delgado',
  'Los Angeles',
  'Presumptive Eligibility',
  'APPENDIX',
  'Appendix',
];

/**
 * English function words. A Spanish sentence does not contain these, so one of
 * them outside a tag is a sentence that was never translated.
 */
const ENGLISH_MARKERS = [
  'the',
  'your',
  'you',
  'and',
  'with',
  'from',
  'this',
  'that',
  'have',
  'which',
  'their',
  'about',
  'these',
  'before',
  'after',
  'write',
  'sign',
  'enter',
];

/** Visible text only: tags, script, style and attributes are not read. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('the rendered Spanish guide is Spanish', () => {
  const text = visibleText(spanishGuideHtml());

  it('renders a page with real content to sweep', () => {
    // Guard: a sweep over an empty string passes trivially.
    expect(text.length).toBeGreaterThan(2000);
    expect(text).toMatch(/[áéíóúñ¿¡]/);
  });

  it.each(ENGLISH_MARKERS)('contains no English word "%s"', (marker) => {
    let remaining = text;
    for (const allowed of ALLOWED_ENGLISH) {
      remaining = remaining.split(allowed).join(' ');
    }

    const hits = remaining.match(
      new RegExp(`(^|[^\\p{L}])${marker}([^\\p{L}]|$)`, 'giu'),
    );

    // Report surrounding words, or a failure says nothing about where to look.
    const context = (hits ?? []).map((h) => {
      const at = remaining.toLowerCase().indexOf(h.toLowerCase());
      return remaining.slice(Math.max(0, at - 60), at + 60);
    });

    expect(context, `untranslated English near: ${context.join(' | ')}`).toEqual(
      [],
    );
  });
});
