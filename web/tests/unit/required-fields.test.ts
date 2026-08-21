//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Requiredness as a semantic fact, not a visual one.
 *
 * The asterisk on screen and the check that blocks Continue read the same
 * declaration, so these tests treat that declaration as the subject: if a field
 * is required, it must both be enforced and be marked, and if it is optional it
 * must be neither.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DELIBERATELY_OPTIONAL_FIELDS,
  REQUIRED_APPLICANT_FIELDS,
  REQUIRED_APPLICANT_FIELD_IDS,
  REQUIRED_REPRESENTATIVE_FIELD_IDS,
  hasEveryRequiredApplicantAnswer,
  missingRequiredApplicantFields,
  representativeDetailsRequired,
} from '@/lib/required-fields';
import { messages } from '@/i18n';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { EMPTY_APPLICATION_DATA } from '@/types/application';
import { writePath } from '@/lib/saws2-question-planner';
import type { ApplicantInformation } from '@/types/application';

const SRC = path.resolve(__dirname, '../../src');

/** An applicant with every required answer supplied. */
function completeApplicant(): ApplicantInformation {
  return {
    ...EMPTY_APPLICATION_DATA.applicant,
    firstName: 'Maria',
    lastName: 'Delgado',
    dateOfBirth: '1990-01-01',
    homeAddress: {
      ...EMPTY_APPLICATION_DATA.applicant.homeAddress,
      street: '12 Oak Street',
      city: 'Fresno',
      state: 'CA',
      zipCode: '93701',
    },
    householdDetails: {
      ...EMPTY_APPLICATION_DATA.applicant.householdDetails,
      maritalStatus: 'single',
      citizenOrNational: true,
    },
  };
}

describe('marital status is required', () => {
  it('is missing from an applicant who has not chosen one', () => {
    const applicant = completeApplicant();

    applicant.householdDetails = {
      ...applicant.householdDetails,
      maritalStatus: undefined,
    };

    expect(
      missingRequiredApplicantFields(applicant).map((f) => f.id),
    ).toContain('maritalStatus');
    expect(hasEveryRequiredApplicantAnswer(applicant)).toBe(false);
  });

  it('is satisfied once one is chosen', () => {
    expect(hasEveryRequiredApplicantAnswer(completeApplicant())).toBe(true);
  });

  it('is satisfied by every marital status, not only "married"', () => {
    for (const status of [
      'single',
      'married',
      'separated',
      'divorced',
      'widowed',
    ] as const) {
      const applicant = completeApplicant();

      applicant.householdDetails = {
        ...applicant.householdDetails,
        maritalStatus: status,
      };

      expect(hasEveryRequiredApplicantAnswer(applicant), status).toBe(true);
    }
  });
});

describe('citizenship is required and tri-state', () => {
  it('treats an explicit No as answered', () => {
    const applicant = completeApplicant();

    applicant.householdDetails = {
      ...applicant.householdDetails,
      citizenOrNational: false,
    };

    // Truthiness here would read "No" as unanswered and block a lawful
    // non-citizen applicant from continuing.
    expect(hasEveryRequiredApplicantAnswer(applicant)).toBe(true);
  });

  it('treats undefined as unanswered', () => {
    const applicant = completeApplicant();

    applicant.householdDetails = {
      ...applicant.householdDetails,
      citizenOrNational: undefined,
    };

    expect(hasEveryRequiredApplicantAnswer(applicant)).toBe(false);
  });
});

describe('optional fields stay optional', () => {
  it('a maiden or former name is not required', () => {
    expect(REQUIRED_APPLICANT_FIELD_IDS.has('otherNames')).toBe(false);
    expect(DELIBERATELY_OPTIONAL_FIELDS).toHaveProperty('otherNames');
  });

  it('race and ethnicity is not required, and not collected', () => {
    expect(REQUIRED_APPLICANT_FIELD_IDS.has('raceEthnicity')).toBe(false);
    expect(DELIBERATELY_OPTIONAL_FIELDS.raceEthnicity).toMatch(/optional/i);
  });

  it('an applicant with no middle name, other names or email is complete', () => {
    const applicant = completeApplicant();

    applicant.middleName = '';
    applicant.otherNames = '';
    applicant.email = '';

    expect(hasEveryRequiredApplicantAnswer(applicant)).toBe(true);
  });

  it('every optional field carries a written reason', () => {
    for (const [field, reason] of Object.entries(
      DELIBERATELY_OPTIONAL_FIELDS,
    )) {
      expect(reason.length, field).toBeGreaterThan(10);
      expect(REQUIRED_APPLICANT_FIELD_IDS.has(field), field).toBe(false);
    }
  });
});

describe('representative details are required only once one is wanted', () => {
  it('are not required before the gateway is answered', () => {
    expect(representativeDetailsRequired(EMPTY_APPLICATION_DATA)).toBe(false);
  });

  it('are not required when the applicant says No', () => {
    const application = {
      ...EMPTY_APPLICATION_DATA,
      questionnaire: writePath(
        EMPTY_APPLICATION_DATA.questionnaire,
        'circumstances.authorizedRepresentative.answer',
        false,
      ),
    };

    expect(representativeDetailsRequired(application)).toBe(false);
  });

  it('are required once the applicant says Yes', () => {
    const application = {
      ...EMPTY_APPLICATION_DATA,
      questionnaire: writePath(
        EMPTY_APPLICATION_DATA.questionnaire,
        'circumstances.authorizedRepresentative.answer',
        true,
      ),
    };

    expect(representativeDetailsRequired(application)).toBe(true);
  });

  it('require a name, but not the boxes the form marks "if applicable"', () => {
    expect(REQUIRED_REPRESENTATIVE_FIELD_IDS).toContain('name');
    expect(REQUIRED_REPRESENTATIVE_FIELD_IDS).not.toContain('organization');
    expect(REQUIRED_REPRESENTATIVE_FIELD_IDS).not.toContain('apartment');
  });
});

describe('the asterisk and the gate cannot disagree', () => {
  const source = readFileSync(
    path.join(SRC, 'components/application/applicant-step.tsx'),
    'utf8',
  );

  it('marks every required field, and only those', () => {
    for (const field of REQUIRED_APPLICANT_FIELDS) {
      expect(
        source,
        `${field.id} is required but carries no asterisk`,
      ).toContain(`isRequired("${field.id}")`);
    }
  });

  it('reads requiredness from the metadata rather than a second list', () => {
    // The chain of Boolean(...) checks this replaced is how marital status came
    // to be enforced nowhere and marked nowhere.
    expect(source).toContain('hasEveryRequiredApplicantAnswer');
    expect(source).not.toMatch(/Boolean\(applicant\.firstName\.trim\(\)\)/);
  });

  it('does not mark an optional field', () => {
    for (const field of Object.keys(DELIBERATELY_OPTIONAL_FIELDS)) {
      expect(source, field).not.toContain(`isRequired("${field}")`);
    }
  });

  it('blocks Continue without discarding what was entered', () => {
    // The handler shows what is missing; nothing in it resets state.
    expect(source).toContain('setShowMissing(true)');
    expect(source).toContain('applicant-required-missing');
    expect(source).not.toMatch(/onChange\((["'])firstName\1,\s*""\)/);
  });

  it('keeps the button reachable so the reason can be announced', () => {
    // A disabled button cannot be focused, so the explanation never arrives.
    expect(source).toContain('aria-disabled={!isValid}');
    expect(source).toContain('aria-live="polite"');
  });
});

describe('required semantics do not change with language', () => {
  it('the required field list is language-independent', () => {
    // Requiredness is a property of the data, not of the catalog. Nothing in
    // the module may consult a locale.
    const source = readFileSync(
      path.join(SRC, 'lib/required-fields.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/\blocale\b/);
    expect(source).not.toMatch(/messages|useTranslation/);
  });

  it('every required field label resolves in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = messages[locale] as unknown as Record<string, string>;

      for (const field of REQUIRED_APPLICANT_FIELDS) {
        expect(
          catalog[field.labelKey],
          `${locale}.${field.labelKey}`,
        ).toBeTruthy();
      }
    }
  });

  it('the legend and validation messages are translated everywhere', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = messages[locale] as unknown as Record<string, string>;

      for (const key of [
        'required_legend',
        'validation_required_missing',
        'validation_still_needed',
      ]) {
        expect(catalog[key], `${locale}.${key}`).toBeTruthy();
      }

      // The legend must actually carry the asterisk it explains.
      expect(catalog.required_legend, locale).toContain('*');
      expect(catalog.validation_still_needed, locale).toContain('{fields}');
    }
  });
});
