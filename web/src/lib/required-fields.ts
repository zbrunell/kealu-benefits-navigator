//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Which primary-applicant answers the flow will not continue without.
 *
 * One declaration, read by both the validator and the renderer. The asterisk on
 * screen and the check that blocks Continue are the same fact, so they must not
 * be two lists that can disagree — a field showing an asterisk while Continue
 * still works, or worse the reverse, is how a form loses someone's trust.
 *
 * Requiredness here is *semantic*: a field is listed because our eligibility
 * logic or the draft cannot be right without it, not because the printed form
 * has a box for it. The official form has many boxes it treats as optional, and
 * `RACE/ETHNICITY` says so in print — those must not become required merely
 * because they exist.
 */

import type {
  ApplicantInformation,
  Saws2PlusApplicationData,
} from '@/types/application';

/** A field an applicant must answer, and the catalog key naming it. */
export interface RequiredField {
  /** Stable id, also the key used to look up a validation message. */
  id: string;
  /** Catalog key for the visible label. */
  labelKey: string;
  /** Whether this applicant's data supplies it. */
  isSatisfied: (applicant: ApplicantInformation) => boolean;
}

const hasText = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * The required primary-applicant fields.
 *
 * Each entry carries its reason. "The form has this box" is not a reason.
 */
export const REQUIRED_APPLICANT_FIELDS: readonly RequiredField[] = [
  {
    // Identifies the applicant on every page of the draft.
    id: 'firstName',
    labelKey: 'field_first_name',
    isSatisfied: (a) => hasText(a.firstName),
  },
  {
    id: 'lastName',
    labelKey: 'field_last_name',
    isSatisfied: (a) => hasText(a.lastName),
  },
  {
    // Age drives nearly every eligibility rule: child vs adult, the 65-or-older
    // resource questions, CalFresh student rules.
    id: 'dateOfBirth',
    labelKey: 'field_date_of_birth',
    isSatisfied: (a) => hasText(a.dateOfBirth),
  },
  {
    // Residence decides which county processes the application and which
    // programs exist at all.
    id: 'street',
    labelKey: 'field_street_address',
    isSatisfied: (a) => hasText(a.homeAddress?.street),
  },
  {
    id: 'city',
    labelKey: 'field_city',
    isSatisfied: (a) => hasText(a.homeAddress?.city),
  },
  {
    id: 'zipCode',
    labelKey: 'field_zip_code',
    isSatisfied: (a) => hasText(a.homeAddress?.zipCode),
  },
  {
    /*
     * Marital status determines who belongs in the assistance unit and whose
     * income counts. Without it, household composition — and therefore the
     * income test — cannot be worked out.
     */
    id: 'maritalStatus',
    labelKey: 'field_marital_status',
    isSatisfied: (a) => Boolean(a.householdDetails?.maritalStatus),
  },
  {
    /*
     * Citizenship gates Medi-Cal scope and CalFresh eligibility. A TriState, so
     * an explicit No is a complete answer and only `undefined` is missing —
     * truthiness here would treat "No" as unanswered.
     */
    id: 'citizenOrNational',
    labelKey: 'applicant_citizen_question',
    isSatisfied: (a) =>
      typeof a.householdDetails?.citizenOrNational === 'boolean',
  },
];

/** Ids of the required fields, for a quick membership test in a renderer. */
export const REQUIRED_APPLICANT_FIELD_IDS: ReadonlySet<string> = new Set(
  REQUIRED_APPLICANT_FIELDS.map((field) => field.id),
);

/**
 * Fields that stay optional, with the reason.
 *
 * Recorded rather than merely omitted, so that "should this be required?" has a
 * written answer and a test can assert the answer has not drifted.
 */
export const DELIBERATELY_OPTIONAL_FIELDS: Readonly<
  Record<string, string>
> = {
  // The form prints "OTHER NAMES"; a maiden or former name affects nothing we
  // compute, and demanding one from someone who has never changed their name is
  // a dead end.
  otherNames: 'Affects no eligibility rule.',
  middleName: 'Not every name has one.',
  apartment: 'Not every address has one.',
  // The form itself states race and ethnicity are optional and do not affect
  // eligibility or benefit amount, so we do not ask at all — the guide points
  // the applicant at the printed boxes instead.
  raceEthnicity: 'The printed form states it is optional; we do not collect it.',
  // A mandatory interview makes a phone useful, but the form does not require
  // one, and a household without a phone must still be able to apply.
  phone: 'The form does not require it; a household may have no phone.',
  alternatePhone: 'A second phone is by definition additional.',
  email: 'Not everyone has one, and the printed box says optional.',
  preferredLanguage: 'Defaulted from the interface language.',
  sex: 'Not used by any eligibility rule we run.',
};

/** Which required fields this applicant has not supplied. */
export function missingRequiredApplicantFields(
  applicant: ApplicantInformation,
): RequiredField[] {
  return REQUIRED_APPLICANT_FIELDS.filter(
    (field) => !field.isSatisfied(applicant),
  );
}

/** Whether every required primary-applicant answer is present. */
export function hasEveryRequiredApplicantAnswer(
  applicant: ApplicantInformation,
): boolean {
  return missingRequiredApplicantFields(applicant).length === 0;
}

/**
 * Whether a representative's details are required.
 *
 * Only once the applicant has said they want one. Asking for a name and address
 * before that would be demanding information about a person who does not exist.
 */
export function representativeDetailsRequired(
  application: Saws2PlusApplicationData,
): boolean {
  return (
    application.questionnaire.circumstances.authorizedRepresentative.answer ===
    true
  );
}

/**
 * The representative fields required once one is being named.
 *
 * A name only. Appendix C prints an address, organization and phone, and we
 * collect all of them, but the county can act on a named representative without
 * a suite number — so requiring the rest would block a draft over detail the
 * printed form marks "if applicable".
 */
export const REQUIRED_REPRESENTATIVE_FIELD_IDS: readonly string[] = ['name'];
