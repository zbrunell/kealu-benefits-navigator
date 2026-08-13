//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Regression coverage for the intake → application-data → field-plan pipeline.
 *
 * The reported defect: an intake answer of "me and my one year old" produced a
 * household of 1, so the child never became an application member and every
 * page-4 child field in the generated PDF stayed blank. The age was spelled as
 * an English word, which the parser could not see.
 *
 * These tests follow one household answer through every stage that runs in
 * TypeScript. The final stage — canonical plan to actual AcroForm values — is
 * asserted in tests/test_saws2_plus_coverage.py, which inspects the generated
 * PDF programmatically.
 */
import { describe, it, expect } from 'vitest';

import { buildInitialApplicationData, membersMissingAge } from '@/lib/application-data';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  buildHouseholdMemberPrefill,
  parseHouseholdComposition,
} from '@/lib/household';
import type { ApplicationPrefill, Saws2PlusApplicationData } from '@/types/application';

/** Deterministic ids so assertions do not depend on crypto.randomUUID(). */
function idFactory() {
  let n = 0;
  return () => `member-${++n}`;
}

/** Build the prefill the report route produces for a household answer. */
function prefillFor(householdProfile: string): ApplicationPrefill {
  const composition = parseHouseholdComposition(householdProfile);

  return {
    zipCode: '90001',
    city: 'Los Angeles',
    state: 'CA',
    county: 'Los Angeles',
    preferredLanguage: 'English',
    householdProfile,
    householdSize: composition.size,
    householdMembers: buildHouseholdMemberPrefill(composition),
    annualHouseholdIncome: 32000,
    incomeType: '',
    existingBenefits: '',
  };
}

function planKeys(application: Saws2PlusApplicationData) {
  return new Map(
    buildApplicationFieldPlan(application, { county: 'Los Angeles' }).map((field) => [
      field.key,
      field.value,
    ]),
  );
}

const REPORTED_ANSWER = 'me and my one year old';

// ---------------------------------------------------------------------------
// Stage 1 — parsing
// ---------------------------------------------------------------------------

describe('stage 1: household parsing', () => {
  it('creates the applicant and a 1-year-old child for the reported answer', () => {
    const composition = parseHouseholdComposition(REPORTED_ANSWER);

    expect(composition.size).toBe(2);
    expect(composition.adults).toBe(1);
    expect(composition.children).toBe(1);
    expect(composition.ages).toEqual([1]);
    expect(composition.people).toEqual([
      { role: 'applicant' },
      { role: 'child', age: 1 },
    ]);
  });

  /**
   * The fix must be semantic, not phrase-specific: every one of these means
   * "the applicant plus one child aged N".
   */
  const EQUIVALENT: Array<[string, number]> = [
    ['me and my one year old', 1],
    ['me and my 1 year old', 1],
    ['me and my one-year-old', 1],
    ['my one year old and me', 1],
    ['I live with my 1 year old', 1],
    ['Me And My One Year Old', 1],
    ['me and my two year old daughter', 2],
    ['my 3-year-old son and I', 3],
    ['just me and my 4 yo', 4],
    ['me and my five yrs old', 5],
    ['I have a 6 year old child', 6],
    ['single parent with a 7 year old', 7],
  ];

  for (const [profile, age] of EQUIVALENT) {
    it(`reads ${JSON.stringify(profile)} as one adult plus a child aged ${age}`, () => {
      const composition = parseHouseholdComposition(profile);

      expect(composition.size).toBe(2);
      expect(composition.adults).toBe(1);
      expect(composition.children).toBe(1);
      expect(composition.ages).toEqual([age]);
    });
  }

  it('reads a shared age across a multiple birth', () => {
    const composition = parseHouseholdComposition('just me and my three year old twins');

    expect(composition.size).toBe(3);
    expect(composition.children).toBe(2);
    // Both twins are three, not just the first one.
    expect(composition.ages).toEqual([3, 3]);
  });

  it('handles plural children with individual ages', () => {
    const composition = parseHouseholdComposition('me and my two kids, ages 4 and 8');

    expect(composition.size).toBe(3);
    expect(composition.ages).toEqual([4, 8]);
  });

  /**
   * "my baby and me" identifies a person but no age. The person must survive;
   * the missing age becomes a follow-up question rather than a dropped member.
   */
  it('keeps a child whose age was not stated', () => {
    for (const profile of ['my baby and me', 'me and my newborn', 'me and my kid']) {
      const composition = parseHouseholdComposition(profile);

      expect(composition.size, profile).toBe(2);
      expect(composition.children, profile).toBe(1);
      expect(composition.ages, profile).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Stage 2 — prefill and application data
// ---------------------------------------------------------------------------

describe('stage 2: the child survives into Saws2PlusApplicationData', () => {
  it('creates one member row carrying the age from intake', () => {
    const application = buildInitialApplicationData(
      prefillFor(REPORTED_ANSWER),
      idFactory(),
    );

    expect(application.householdMembers).toHaveLength(1);
    expect(application.householdMembers[0].age).toBe(1);
    expect(application.householdMembers[0].id).toBe('member-1');
  });

  it('does not invent a name, date of birth, or form answer for the child', () => {
    const [child] = buildInitialApplicationData(
      prefillFor(REPORTED_ANSWER),
      idFactory(),
    ).householdMembers;

    expect(child.firstName).toBe('');
    expect(child.lastName).toBe('');
    expect(child.dateOfBirth).toBe('');
    expect(child.relationshipToApplicant).toBe('');
    expect(child.childDetails?.citizenOrNational).toBeUndefined();
    expect(child.childDetails?.immunizationsUpToDate).toBeUndefined();
    expect(child.childDetails?.applyingFor).toEqual([]);
  });

  it('keeps an age-less member and reports it as needing follow-up', () => {
    const application = buildInitialApplicationData(
      prefillFor('my baby and me'),
      idFactory(),
    );

    expect(application.householdMembers).toHaveLength(1);
    expect(membersMissingAge(application)).toHaveLength(1);
  });

  it('reports nothing outstanding when every age is known', () => {
    const application = buildInitialApplicationData(
      prefillFor(REPORTED_ANSWER),
      idFactory(),
    );

    expect(membersMissingAge(application)).toHaveLength(0);
  });

  it('carries the ZIP-derived location onto the applicant address', () => {
    const application = buildInitialApplicationData(
      prefillFor(REPORTED_ANSWER),
      idFactory(),
    );

    expect(application.applicant.homeAddress.city).toBe('Los Angeles');
    expect(application.applicant.homeAddress.state).toBe('CA');
    expect(application.applicant.homeAddress.zipCode).toBe('90001');
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — canonical field plan
// ---------------------------------------------------------------------------

describe('stage 3: applicant and child answers reach the field plan', () => {
  /** A household completed the way the UI would complete it. */
  function completedApplication(): Saws2PlusApplicationData {
    const application = buildInitialApplicationData(
      prefillFor(REPORTED_ANSWER),
      idFactory(),
    );

    return {
      ...application,
      selectedPrograms: ['medi_cal', 'calfresh'],
      applicant: {
        ...application.applicant,
        firstName: 'Maria',
        middleName: 'E',
        lastName: 'Delgado',
        otherNames: 'Maria Ruiz',
        dateOfBirth: '1993-04-12',
        phone: '323-555-0142',
        alternatePhone: '323-555-9911',
        email: 'maria@example.com',
        homeAddress: {
          ...application.applicant.homeAddress,
          street: '1420 E 41st St',
          apartment: '3',
        },
        householdDetails: {
          applyingFor: ['medi_cal', 'calfresh'],
          sex: 'female',
          citizenOrNational: true,
          fullTimeStudent: false,
          disabled: false,
          maritalStatus: 'married',
        },
      },
      householdMembers: [
        {
          ...application.householdMembers[0],
          firstName: 'Sofia',
          lastName: 'Delgado',
          dateOfBirth: '2024-06-15',
          relationshipToApplicant: 'Daughter',
          childDetails: {
            applyingFor: ['medi_cal'],
            sex: 'female',
            placeOfBirth: 'Los Angeles, CA',
            citizenOrNational: true,
            fullTimeStudent: false,
            disabled: false,
            immunizationsUpToDate: true,
            parentStatus: {
              notInHome: false,
              unemployed: false,
              disabled: false,
              deceased: false,
              none: true,
            },
          },
        },
      ],
    };
  }

  it('includes every known applicant field', () => {
    const keys = planKeys(completedApplication());

    expect(keys.get('applicant.first_name')).toBe('Maria');
    expect(keys.get('applicant.middle_name')).toBe('E');
    expect(keys.get('applicant.last_name')).toBe('Delgado');
    expect(keys.get('applicant.other_names')).toBe('Maria Ruiz');
    expect(keys.get('applicant.date_of_birth')).toBe('1993-04-12');
    expect(keys.get('applicant.phone')).toBe('323-555-0142');
    expect(keys.get('applicant.alternate_phone')).toBe('323-555-9911');
    expect(keys.get('applicant.email')).toBe('maria@example.com');
    expect(keys.get('applicant.home_address.street')).toBe('1420 E 41st St');
    expect(keys.get('applicant.home_address.city')).toBe('Los Angeles');
    expect(keys.get('applicant.home_address.county')).toBe('Los Angeles');
    expect(keys.get('applicant.home_address.zip_code')).toBe('90001');
    expect(keys.get('applicant.household.sex')).toBe('female');
    expect(keys.get('applicant.household.citizen_or_national')).toBe(true);
    expect(keys.get('applicant.household.marital_status')).toBe('married');
  });

  it('includes every known child field, in the first member row', () => {
    const keys = planKeys(completedApplication());

    expect(keys.get('household.members.0.first_name')).toBe('Sofia');
    expect(keys.get('household.members.0.last_name')).toBe('Delgado');
    expect(keys.get('household.members.0.date_of_birth')).toBe('2024-06-15');
    expect(keys.get('household.members.0.relationship_to_applicant')).toBe('Daughter');
    expect(keys.get('household.members.0.age')).toBe(1);
    expect(keys.get('household.members.0.child.sex')).toBe('female');
    expect(keys.get('household.members.0.child.place_of_birth')).toBe('Los Angeles, CA');
    expect(keys.get('household.members.0.child.citizen_or_national')).toBe(true);
    expect(keys.get('household.members.0.child.immunizations_up_to_date')).toBe(true);
    expect(keys.get('household.members.0.child.parent_status.none')).toBe(true);
    expect(keys.get('household.members.0.applying_for.medi_cal')).toBe(true);
  });

  it('derives the household size from the applicant plus the child', () => {
    expect(planKeys(completedApplication()).get('household.size')).toBe(2);
  });

  it('never emits an SSN or signature key', () => {
    for (const key of planKeys(completedApplication()).keys()) {
      expect(key).not.toMatch(/ssn|social_security|signature|signed/i);
    }
  });

  /**
   * Before the fix the plan contained no `household.members.*` keys at all for
   * this answer, which is exactly why the page-4 child table came out blank.
   */
  it('produces child row keys for the reported answer, not an empty household', () => {
    const keys = planKeys(completedApplication());
    const memberKeys = [...keys.keys()].filter((key) =>
      key.startsWith('household.members.'),
    );

    expect(memberKeys.length).toBeGreaterThan(5);
  });
});
