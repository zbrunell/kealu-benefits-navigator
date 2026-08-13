//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Build the initial SAWS 2 PLUS application state from the report prefill.
 *
 * This conversion used to live inside ApplicationView's `useState` initializer,
 * where nothing could test it. It is the seam where intake data becomes
 * application data, so it is the step that decides whether a household member
 * identified during intake survives into the form — extracted here so that
 * "intake found a child" and "the child reaches the PDF" can be asserted
 * directly.
 *
 * Nothing is invented: only values the prefill actually carries are copied.
 * Names, dates of birth, and every government-form answer (citizenship,
 * disability, program participation) stay blank for the applicant to complete.
 */

import {
  EMPTY_APPLICATION_DATA,
  type ApplicationPrefill,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

/** Generate a stable row id. Injectable so tests are deterministic. */
export type IdFactory = () => string;

const defaultIdFactory: IdFactory = () => crypto.randomUUID();

/**
 * Convert one prefilled household member into an application row.
 *
 * Both adult and child detail groups are initialized because the household
 * wizard decides which questions to render from the date of birth or age. An
 * age carried over from intake is preserved; a member whose age intake could not
 * determine still gets a row, so the person is never silently dropped — the
 * missing age is simply asked for in the household step.
 */
function toHouseholdMember(
  member: { age?: number; dateOfBirth?: string },
  id: string,
): HouseholdMember {
  return {
    id,
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: member.dateOfBirth ?? '',
    age: member.age,
    relationshipToApplicant: '',

    adultDetails: {
      applyingFor: [],
      sex: undefined,
      citizenOrNational: undefined,
      fullTimeStudent: undefined,
      disabled: undefined,
      maritalStatus: undefined,
    },

    childDetails: {
      applyingFor: [],
      sex: undefined,
      citizenOrNational: undefined,
      fullTimeStudent: undefined,
      disabled: undefined,
      placeOfBirth: '',
      immunizationsUpToDate: undefined,

      parentStatus: {
        notInHome: undefined,
        unemployed: undefined,
        disabled: undefined,
        deceased: undefined,
        none: undefined,
      },
    },
  };
}

/**
 * Seed application state from the report prefill.
 *
 * @param prefill Report prefill derived from intake, or null when unavailable.
 * @param idFactory Row-id generator; overridden in tests for determinism.
 */
export function buildInitialApplicationData(
  prefill: ApplicationPrefill | null,
  idFactory: IdFactory = defaultIdFactory,
): Saws2PlusApplicationData {
  const householdMembers = (prefill?.householdMembers ?? []).map((member) =>
    toHouseholdMember(member, idFactory()),
  );

  return {
    ...EMPTY_APPLICATION_DATA,

    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,

      preferredLanguage:
        prefill?.preferredLanguage ||
        EMPTY_APPLICATION_DATA.applicant.preferredLanguage,

      homeAddress: {
        ...EMPTY_APPLICATION_DATA.applicant.homeAddress,
        city: prefill?.city ?? '',
        state: prefill?.state || 'CA',
        zipCode: prefill?.zipCode ?? '',
      },

      mailingAddress: {
        ...EMPTY_APPLICATION_DATA.applicant.mailingAddress,
        city: prefill?.city ?? '',
        state: prefill?.state || 'CA',
        zipCode: prefill?.zipCode ?? '',
      },
    },

    householdMembers,

    annualHouseholdIncome: prefill?.annualHouseholdIncome,
    incomeType: prefill?.incomeType ?? '',
    existingBenefits: prefill?.existingBenefits ?? '',
  };
}

/**
 * Household members whose age or date of birth is still unknown.
 *
 * Intake sometimes identifies that a person exists without stating their age
 * ("my baby and me"). Those rows are kept and surfaced here so the household
 * step can ask, rather than the person being dropped.
 */
export function membersMissingAge(
  application: Saws2PlusApplicationData,
): HouseholdMember[] {
  return application.householdMembers.filter(
    (member) => member.age === undefined && !member.dateOfBirth.trim(),
  );
}
