//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The authorized representative, end to end.
 *
 * The form has two of them and they are not interchangeable: section 2 on
 * page 2 names someone for the CalFresh case, and Appendix C names someone for
 * the health-insurance part. A representative appointed for one has no business
 * in the other's block, and these tests pin both directions.
 */

import { describe, expect, it } from 'vitest';

import { assessDraftCompletion } from '@/lib/draft-completion';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildCompletionGuide, draftReferenceFrom } from '@/lib/completion-guide';
import { messages } from '@/i18n';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import {
  REQUIRED_REPRESENTATIVE_FIELD_IDS,
  representativeDetailsRequired,
} from '@/lib/required-fields';
import {
  getRequiredApplicationQuestions,
  writePath,
} from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

interface RepOverrides {
  name?: string;
  organization?: string;
  phone?: string;
  street?: string;
  apartment?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  forCalFresh?: boolean;
  forHealthCoverage?: boolean;
}

function representative(overrides: RepOverrides = {}) {
  return {
    id: 'rep-1',
    name: 'Priya Raman',
    organization: 'Valley Health Navigators',
    phone: '5595550199',
    street: '44 Cedar Avenue',
    apartment: 'Suite 3',
    city: 'Fresno',
    state: 'CA',
    zipCode: '93702',
    forCalFresh: false,
    forHealthCoverage: true,
    ...overrides,
  };
}

function application(
  answer?: boolean,
  entries: ReturnType<typeof representative>[] = [],
): Saws2PlusApplicationData {
  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
  };

  if (answer === undefined) return base;

  let questionnaire = writePath(
    base.questionnaire,
    'circumstances.authorizedRepresentative.answer',
    answer,
  );

  if (entries.length > 0) {
    questionnaire = writePath(
      questionnaire,
      'circumstances.authorizedRepresentative.entries',
      entries,
    );
  }

  return { ...base, questionnaire };
}

const planOf = (app: Saws2PlusApplicationData) =>
  Object.fromEntries(
    buildApplicationFieldPlan(app, {}).map((entry) => [entry.key, entry.value]),
  );

// ---------------------------------------------------------------------------
// No representative
// ---------------------------------------------------------------------------

describe('no authorized representative', () => {
  it('emits no representative keys when the applicant says No', () => {
    const plan = planOf(application(false));

    for (const key of Object.keys(plan)) {
      expect(key).not.toMatch(/authorized_representative\.\d/);
      expect(key).not.toMatch(/^appendices\.representative/);
    }
  });

  it('still records the No, so the printed box is ticked', () => {
    // An explicit No is an answer; leaving both boxes blank would lose it.
    expect(planOf(application(false))['household.authorized_representative']).toBe(
      false,
    );
  });

  it('asks for no representative details', () => {
    expect(representativeDetailsRequired(application(false))).toBe(false);

    const ids = getRequiredApplicationQuestions(application(false)).outstanding.map(
      (question) => question.id,
    );

    expect(
      ids.filter((id) => id.includes('authorized_representative.0')),
    ).toEqual([]);
  });

  it('leaves Appendix C out of the guide entirely', () => {
    const ids = assessDraftCompletion(application(false)).manualItems.map(
      (item) => item.id,
    );

    expect(ids).not.toContain('signature.appendix_c');
  });
});

// ---------------------------------------------------------------------------
// Complete representative
// ---------------------------------------------------------------------------

describe('a representative with complete information', () => {
  const app = application(true, [representative()]);

  it('carries every part of the address into the plan', () => {
    const plan = planOf(app);

    expect(plan['household.authorized_representative.0.name']).toBe(
      'Priya Raman',
    );
    expect(plan['household.authorized_representative.0.address.street']).toBe(
      '44 Cedar Avenue',
    );
    expect(plan['household.authorized_representative.0.address.apartment']).toBe(
      'Suite 3',
    );
    expect(plan['household.authorized_representative.0.address.city']).toBe(
      'Fresno',
    );
    expect(plan['household.authorized_representative.0.address.state']).toBe(
      'CA',
    );
    expect(plan['household.authorized_representative.0.address.zip_code']).toBe(
      '93702',
    );
  });

  it('reaches Appendix C because it is the health-coverage representative', () => {
    const plan = planOf(app);

    expect(plan['appendices.representative.name']).toBe('Priya Raman');
    expect(plan['appendices.representative.city']).toBe('Fresno');
    expect(plan['appendices.representative.zip_code']).toBe('93702');
    expect(plan['appendices.representative.organization']).toBe(
      'Valley Health Navigators',
    );
  });

  it('does not reach Appendix C when named only for CalFresh', () => {
    const calfreshOnly = application(true, [
      representative({ forCalFresh: true, forHealthCoverage: false }),
    ]);

    const plan = planOf(calfreshOnly);

    // The printed page says it is for the health-insurance part.
    expect(plan['appendices.representative.name']).toBeUndefined();
    expect(plan['household.authorized_representative.0.name']).toBe(
      'Priya Raman',
    );
  });

  it('asks nothing further once the name is present', () => {
    const ids = getRequiredApplicationQuestions(app).outstanding.map((q) => q.id);

    expect(
      ids.filter((id) => id.endsWith('authorized_representative.0.name')),
    ).toEqual([]);
  });

  it('lists the Appendix C signature and date as manual work', () => {
    const ids = assessDraftCompletion(app).manualItems.map((item) => item.id);

    // The representative signs Appendix C themselves; we never prefill a
    // signature, so the guide has to name it.
    expect(ids).toContain('signature.appendix_c');
    expect(ids).toContain('signature.appendix_c_date');
  });
});

// ---------------------------------------------------------------------------
// Incomplete representative
// ---------------------------------------------------------------------------

describe('a representative with incomplete information', () => {
  it('asks for the name when it is missing', () => {
    const app = application(true, [representative({ name: '' })]);
    const questions = getRequiredApplicationQuestions(app).outstanding;
    const asked = questions.find((question) =>
      question.id.endsWith('authorized_representative.0.name'),
    );

    expect(asked).toBeDefined();
  });

  it('asks for the name in the applicant’s language, not by key', () => {
    const app = application(true, [representative({ name: '' })]);
    const asked = getRequiredApplicationQuestions(app).outstanding.find(
      (question) =>
        question.id.endsWith('authorized_representative.0.name'),
    )!;

    for (const locale of SUPPORTED_LOCALES) {
      const catalog = messages[locale] as unknown as Record<string, string>;
      const template = catalog[asked.promptKey];

      expect(template, `${locale}.${asked.promptKey}`).toBeTruthy();

      // The prompt must not surface a catalog key to the applicant.
      expect(template).not.toContain('qfield_');
    }
  });

  it('does not demand the boxes the form marks "if applicable"', () => {
    const app = application(true, [
      representative({ organization: '', apartment: '', phone: '' }),
    ]);

    const ids = getRequiredApplicationQuestions(app).outstanding.map((q) => q.id);

    for (const field of ['organization', 'apartment', 'phone']) {
      expect(
        ids.filter((id) => id.endsWith(`authorized_representative.0.${field}`)),
        field,
      ).toEqual([]);
    }

    expect(REQUIRED_REPRESENTATIVE_FIELD_IDS).toEqual(['name']);
  });

  it('writes the parts it has and leaves the rest blank', () => {
    const plan = planOf(
      application(true, [representative({ apartment: '', city: '' })]),
    );

    expect(plan['appendices.representative.address']).toBe('44 Cedar Avenue');

    // A part left blank emits nothing rather than an empty value, so the box
    // stays untouched — and, critically, the parts that *are* known do not
    // shift up into the wrong boxes.
    expect(plan['appendices.representative.apartment']).toBeUndefined();
    expect(plan['appendices.representative.city']).toBeUndefined();
    expect(plan['appendices.representative.state']).toBe('CA');
    expect(plan['appendices.representative.zip_code']).toBe('93702');
  });
});

// ---------------------------------------------------------------------------
// The guide
// ---------------------------------------------------------------------------

describe('the guide describes the representative’s own work', () => {
  it('names the Appendix C signature in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const guide = buildCompletionGuide({
        application: application(true, [representative()]),
        audience: 'applicant',
        locale,
        county: 'Fresno',
        draft: {
          reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
          generatedAt: '2026-08-17T22:51:00.000Z',
        },
      });

      const text = JSON.stringify(guide);

      // Located by page reference, which is language-independent.
      expect(text, locale).toContain('APPENDIX C');
    }
  });
});
