//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What the guide says about information we never collect.
 *
 * Two cases that look alike and are not:
 *
 * - Race and ethnicity: the printed form states answering is optional, so a
 *   blank is a complete answer. The guide must mention the boxes without
 *   implying the applicant has work to do.
 * - Q6a's per-person contact blocks: the form asks for them, and only when the
 *   household said their details differ. That is real work, and the guide must
 *   say so — and must stay silent when the answer was Yes, because then the
 *   blocks are meant to be empty.
 */

import { describe, expect, it } from 'vitest';

import { assessDraftCompletion } from '@/lib/draft-completion';
import { buildCompletionGuide, draftReferenceFrom } from '@/lib/completion-guide';
import { messages } from '@/i18n';
import { SUPPORTED_LOCALES, documentLanguageFor, type Locale } from '@/lib/locale';
import { writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

function application(
  sameContact?: boolean,
): Saws2PlusApplicationData {
  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
  };

  if (sameContact === undefined) return base;

  return {
    ...base,
    questionnaire: writePath(
      base.questionnaire,
      'circumstances.everyoneHasSameContactInformation',
      sameContact,
    ),
  };
}

const idsOf = (app: Saws2PlusApplicationData) =>
  assessDraftCompletion(app).manualItems.map((item) => item.id);

// ---------------------------------------------------------------------------
// Q6a
// ---------------------------------------------------------------------------

describe('Q6a per-person contact blocks', () => {
  it('are listed when the household said their details differ', () => {
    expect(idsOf(application(false))).toContain('uncollected.member_contact');
  });

  it('are not listed when everyone shares contact information', () => {
    // Answering Yes means the printed blocks are meant to stay empty. Telling
    // the applicant to fill them would be telling them to contradict the form.
    expect(idsOf(application(true))).not.toContain(
      'uncollected.member_contact',
    );
  });

  it('are not listed while the question is unanswered', () => {
    // Unanswered is not No: the county has not been told either way, so the
    // blocks are not yet known to be needed.
    expect(idsOf(application(undefined))).not.toContain(
      'uncollected.member_contact',
    );
  });

  it('stop being listed if we ever start collecting the details', () => {
    const app = application(false);

    // A guide entry for a field that got filled is worse than no entry: it
    // sends the applicant looking for work that is already done.
    const withContact: Saws2PlusApplicationData = {
      ...app,
      householdMembers: [
        {
          id: 'member-1',
          firstName: 'Ana',
          middleName: '',
          lastName: 'Delgado',
          dateOfBirth: '1992-02-02',
          relationshipToApplicant: 'sibling',
          adultDetails: { applyingFor: [] },
          contact: {
            homePhone: '5595550100',
            mailingAddressSameAsHome: true,
          },
        } as unknown as Saws2PlusApplicationData['householdMembers'][number],
      ],
    };

    expect(idsOf(withContact)).not.toContain('uncollected.member_contact');
  });

  it('counts as outstanding work, not as an optional extra', () => {
    const completion = assessDraftCompletion(application(false));
    const item = completion.manualItems.find(
      (candidate) => candidate.id === 'uncollected.member_contact',
    );

    expect(item?.reason).toBe('not_collected');
    expect(completion.readyForSignature).toBe(false);
  });

  it('points at the right page and quotes the printed question', () => {
    const item = assessDraftCompletion(application(false)).manualItems.find(
      (candidate) => candidate.id === 'uncollected.member_contact',
    );

    // Printed page 3 is PDF page 9.
    expect(item?.page).toBe(9);
    expect(item?.printedPage).toBe('PAGE 3 OF 17');
    expect(item?.printedLabelKey).toBe('same_contact_information');
  });
});

// ---------------------------------------------------------------------------
// Race and ethnic origin
// ---------------------------------------------------------------------------

describe('race and ethnic origin', () => {
  it('is always listed, because we never ask', () => {
    for (const sameContact of [undefined, true, false]) {
      expect(idsOf(application(sameContact))).toContain(
        'uncollected.race_ethnicity',
      );
    }
  });

  it('does not count against a draft being ready to sign', () => {
    const completion = assessDraftCompletion(application(true));
    const item = completion.manualItems.find(
      (candidate) => candidate.id === 'uncollected.race_ethnicity',
    );

    expect(item?.reason).toBe('optional_not_collected');

    // The form says a blank here is complete, so this item alone must not make
    // the draft look unfinished.
    expect(
      completion.manualItems
        .filter((i) => i.reason === 'optional_not_collected')
        .every((i) => i.id === 'uncollected.race_ethnicity'),
    ).toBe(true);
  });

  it('points at page 2 and quotes the printed section', () => {
    const item = assessDraftCompletion(application(true)).manualItems.find(
      (candidate) => candidate.id === 'uncollected.race_ethnicity',
    );

    // Printed page 2 is PDF page 8.
    expect(item?.page).toBe(8);
    expect(item?.printedPage).toBe('PAGE 2 OF 17');
    expect(item?.printedSectionKey).toBe('race_ethnicity');
    expect(item?.printedLabelKey).toBe('race_ethnic_origin');
  });

  it('never claims the applicant must answer it', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = messages[locale] as unknown as Record<string, string>;
      const instruction = catalog.instr_uncollected_race_ethnicity;

      expect(instruction, locale).toBeTruthy();

      // The form states it is optional, so our prose must not say otherwise.
      expect(instruction, locale).not.toMatch(
        /\b(must|required|obligatorio|necesario|必须|必填)\b/i,
      );
    }
  });

  it('says in every language that it may be left blank', () => {
    const blankWording: Record<Locale, RegExp> = {
      en: /leave it blank/i,
      es: /dejarlo en blanco/i,
      'zh-CN': /留空/,
    };

    for (const locale of SUPPORTED_LOCALES) {
      const catalog = messages[locale] as unknown as Record<string, string>;

      expect(
        catalog.instr_uncollected_race_ethnicity,
        locale,
      ).toMatch(blankWording[locale]);
    }
  });
});

// ---------------------------------------------------------------------------
// Interface language vs document language
// ---------------------------------------------------------------------------

describe('the guide separates our prose from the form’s words', () => {
  function guideText(locale: Locale, sameContact: boolean) {
    const guide = buildCompletionGuide({
      application: application(sameContact),
      audience: 'applicant',
      locale,
      county: 'Fresno',
      draft: {
        reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
        generatedAt: '2026-08-17T22:51:00.000Z',
      },
    });

    return JSON.stringify(guide);
  }

  it('quotes the Spanish form for a Spanish reader', () => {
    expect(documentLanguageFor('es')).toBe('es');

    const text = guideText('es', false);

    expect(text).toContain('RAZA/ORIGEN ÉTNICO');
    // Our own explanation is Spanish too.
    expect(text).toContain('No preguntamos sobre raza ni etnia');
  });

  it('quotes the English form for a Simplified Chinese reader', () => {
    // zh-CN has no official translated form, so the document stays English.
    expect(documentLanguageFor('zh-CN')).toBe('en');

    const text = guideText('zh-CN', false);

    expect(text).toContain('RACE/ETHNIC ORIGIN');
    expect(text).not.toContain('RAZA/ORIGEN ÉTNICO');
    // …while the prose around it is Simplified Chinese.
    expect(text).toContain('我们不询问种族或族裔');
  });

  it('quotes English for an English reader', () => {
    const text = guideText('en', false);

    expect(text).toContain('RACE/ETHNIC ORIGIN');
    expect(text).toContain('We do not ask about race or ethnicity');
  });

  it('quotes the Spanish 6a question for a Spanish reader', () => {
    const text = guideText('es', false);

    expect(text).toContain('la misma información para contacto');
  });
});
