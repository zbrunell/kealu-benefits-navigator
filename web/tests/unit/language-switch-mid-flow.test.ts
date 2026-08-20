//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Switching language after answers already exist.
 *
 * The property under test is a separation: the locale governs *wording*, and
 * nothing else. Application state is canonical — booleans, member ids, enum
 * values, programs — so changing language must re-render the same answers in
 * different words and never touch the answers themselves.
 *
 * This is the failure that would be easy to ship and hard to notice: a switch
 * that resets progress, or that stores "Sí" where the branching logic looks for
 * `true`. Everything here therefore asserts state identity across the switch,
 * not just that the words changed.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildCompletionGuide, draftReferenceFrom } from '@/lib/completion-guide';
import { messages, t, translateQuestion } from '@/i18n';
import { documentLanguageFor, type Locale } from '@/lib/locale';
import {
  getRequiredApplicationQuestions,
  readPath,
  writePath,
} from '@/lib/saws2-question-planner';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

const SWITCHES: Array<[Locale, Locale]> = [
  ['en', 'es'],
  ['en', 'zh-CN'],
  ['es', 'en'],
];

function member(id: string, first: string, dob: string): HouseholdMember {
  return {
    id,
    firstName: first,
    middleName: '',
    lastName: 'Delgado',
    dateOfBirth: dob,
    relationshipToApplicant: 'Spouse',
  };
}

/** A part-answered application: identity, household, programs, questionnaire. */
function partlyAnswered(): Saws2PlusApplicationData {
  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-03-04',
      phone: '323-555-0142',
      email: 'maria@example.com',
      householdDetails: {
        applyingFor: ['calfresh', 'medi_cal'],
        sex: 'female',
        citizenOrNational: true,
        fullTimeStudent: false,
        disabled: false,
        maritalStatus: 'married',
      },
    },
    householdMembers: [
      member('m1', 'Luis', '1991-09-02'),
      member('m2', 'Sofia', '2021-06-15'),
    ],
  };

  let q = base.questionnaire;
  // A Yes with detail, an explicit No, and an untouched question.
  q = writePath(q, 'income.earned.answer', true);
  q = writePath(q, 'income.earned.entries', [
    { id: 'e1', memberId: 'applicant', employerName: 'Acme Diner' },
  ]);
  q = writePath(q, 'health.currentCoverage.answer', false);
  q = writePath(q, 'circumstances.buysAndPreparesFoodTogether', true);

  return { ...base, questionnaire: q };
}

/**
 * Switching locale is a UI-only act: it changes which catalog renders, never
 * the application object. Modelling it as "same data, different catalog" is
 * exactly what the product does, and what these tests hold it to.
 */
function render(data: Saws2PlusApplicationData, locale: Locale) {
  const plan = getRequiredApplicationQuestions(data);

  return {
    locale,
    outstandingIds: plan.outstanding.map((q) => q.id),
    firstPrompt: plan.outstanding[0]
      ? translateQuestion(messages[locale], plan.outstanding[0])
      : '',
    answeredCount: plan.answeredCount,
    totalCount: plan.totalCount,
    fieldPlan: buildApplicationFieldPlan(data, {}),
  };
}

describe.each(SWITCHES)('switching %s → %s', (from, to) => {
  const data = partlyAnswered();
  const before = render(data, from);
  const after = render(data, to);

  it('keeps every applicant answer', () => {
    expect(data.applicant.firstName).toBe('Maria');
    expect(data.applicant.dateOfBirth).toBe('1990-03-04');
    expect(data.applicant.phone).toBe('323-555-0142');
    expect(data.applicant.email).toBe('maria@example.com');
  });

  it('keeps household members, in order, with their ids', () => {
    expect(data.householdMembers.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(data.householdMembers.map((m) => m.firstName)).toEqual([
      'Luis',
      'Sofia',
    ]);
  });

  it('keeps the selected programs', () => {
    expect(data.selectedPrograms).toEqual(['calfresh', 'medi_cal']);
  });

  it('keeps questionnaire answers as canonical values, not translated words', () => {
    expect(readPath(data.questionnaire, 'income.earned.answer')).toBe(true);
    // The explicit No is still `false` — never "No" or "Sí".
    expect(readPath(data.questionnaire, 'health.currentCoverage.answer')).toBe(
      false,
    );
    expect(
      readPath(data.questionnaire, 'circumstances.buysAndPreparesFoodTogether'),
    ).toBe(true);
  });

  it('keeps enum answers canonical', () => {
    expect(data.applicant.householdDetails.maritalStatus).toBe('married');
    expect(data.applicant.householdDetails.sex).toBe('female');
  });

  it('keeps progress identical', () => {
    expect(after.answeredCount).toBe(before.answeredCount);
    expect(after.totalCount).toBe(before.totalCount);
  });

  it('asks exactly the same questions, in the same order', () => {
    expect(after.outstandingIds).toEqual(before.outstandingIds);
  });

  it('produces an identical canonical field plan', () => {
    // The bridge to the PDF is language-independent by construction.
    expect(after.fieldPlan).toEqual(before.fieldPlan);
  });

  it('re-words the question the applicant is looking at', () => {
    expect(after.firstPrompt).not.toBe('');

    if (from !== to) {
      expect(after.firstPrompt).not.toBe(before.firstPrompt);
    }
  });

  it('re-words the UI furniture', () => {
    const key = 'qstep_skip_for_now';

    expect(t(messages[to], key)).not.toBe(t(messages[from], key));
  });
});

describe('a guide generated after the switch uses the new language', () => {
  it.each(SWITCHES)('%s → %s', (from, to) => {
    const data = partlyAnswered();

    const guideBefore = buildCompletionGuide({
      application: data,
      audience: 'applicant',
      locale: from,
      county: 'Los Angeles',
      draft: {
        reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
        generatedAt: '2026-08-19T10:00:00.000Z',
      },
    });

    const guideAfter = buildCompletionGuide({
      application: data,
      audience: 'applicant',
      locale: to,
      county: 'Los Angeles',
      draft: {
        reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
        generatedAt: '2026-08-19T10:00:00.000Z',
      },
    });

    expect(guideAfter.locale).toBe(to);
    expect(guideAfter.title).toBe(messages[to].guide_title_applicant);
    expect(guideAfter.title).not.toBe(guideBefore.title);

    // Same draft, same structure — only the words moved.
    expect(guideAfter.sections.map((s) => s.id)).toEqual(
      guideBefore.sections.map((s) => s.id),
    );
    expect(guideAfter.filledFieldCount).toBe(guideBefore.filledFieldCount);
  });
});

describe('the paper form follows the document policy, not the interface', () => {
  it('gives Spanish applicants the Spanish form', () => {
    expect(documentLanguageFor('es')).toBe('es');
  });

  it('keeps the English form for Simplified Chinese, and says so', () => {
    /*
     * CDSS publishes no fillable Simplified Chinese SAWS 2 PLUS, so switching
     * the interface to Chinese must not silently change which paper is
     * generated. The guide carries the notice instead.
     */
    expect(documentLanguageFor('zh-CN')).toBe('en');

    const guide = buildCompletionGuide({
      application: partlyAnswered(),
      audience: 'applicant',
      locale: 'zh-CN',
      county: 'Los Angeles',
      draft: {
        reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
        generatedAt: '2026-08-19T10:00:00.000Z',
      },
    });

    expect(guide.documentLanguage).toBe('en');
    expect(guide.locale).toBe('zh-CN');
  });

  it('switching interface language never changes the English document choice', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      expect(documentLanguageFor(locale)).toBe('en');
    }
  });
});
