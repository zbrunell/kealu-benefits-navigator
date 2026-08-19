//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import type { Saws2PlusProgram } from "@/lib/report-assembler";
import {
  emptyQuestionnaire,
  type Saws2PlusQuestionnaire,
} from "@/types/saws-questionnaire";


export type MaritalStatus =
  | "single"
  | "married"
  | "separated"
  | "divorced"
  | "widowed";

export type PersonSex = "male" | "female";

export interface PersonApplicationDetails {
  applyingFor: Saws2PlusProgram[];

  sex?: PersonSex;
  citizenOrNational?: boolean;

  fullTimeStudent?: boolean;
  disabled?: boolean;
}

export interface AdultApplicationDetails extends PersonApplicationDetails {
  maritalStatus?: MaritalStatus;
}

export interface ChildApplicationDetails extends PersonApplicationDetails {
  placeOfBirth: string;
  immunizationsUpToDate?: boolean;

  parentStatus: {
    notInHome?: boolean;
    unemployed?: boolean;
    disabled?: boolean;
    deceased?: boolean;
    none?: boolean;
  };
}

export interface ApplicationAddress {
  street: string;
  apartment: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface ApplicantInformation {
  firstName: string;
  middleName: string;
  lastName: string;

  /** Maiden name, nicknames, or any other name the applicant has used. */
  otherNames: string;

  dateOfBirth: string;
  phone: string;

  /** Work, alternate, or message phone (the second phone box on page 1). */
  alternatePhone: string;

  email: string;
  preferredLanguage: string;
  homeAddress: ApplicationAddress;
  mailingAddressSameAsHome: boolean;
  mailingAddress: ApplicationAddress;
  householdDetails: AdultApplicationDetails;
}

/**
 * Q6a per-member contact information.
 *
 * Q6a asks "Does everyone listed in question 6 have the same contact
 * information?" and, when the answer is No, gives two printed blocks for the
 * people whose details differ. So this is deliberately optional per member:
 * absent means "same as the applicant", which is what Yes means, and the
 * printed block stays blank rather than repeating the applicant's own details
 * in every row.
 */
export interface MemberContactInformation {
  homePhone: string;
  /** The form's "WORK/ALTERNATE/MESSAGE PHONE" column. */
  alternatePhone: string;
  email: string;
  homeAddress: ApplicationAddress;
  mailingAddressSameAsHome: boolean;
  mailingAddress: ApplicationAddress;
}

export function emptyMemberContactInformation(): MemberContactInformation {
  return {
    homePhone: '',
    alternatePhone: '',
    email: '',
    homeAddress: { ...EMPTY_ADDRESS },
    mailingAddressSameAsHome: true,
    mailingAddress: { ...EMPTY_ADDRESS },
  };
}

export interface HouseholdMember {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  age?: number;
  relationshipToApplicant: string;
  /**
   * Set only when this member's contact details differ from the applicant's
   * (Q6a answered No). Absent means "same as the applicant".
   */
  contact?: MemberContactInformation;
  adultDetails?: AdultApplicationDetails;
  childDetails?: ChildApplicationDetails;
}

export interface HouseholdMemberPrefill {
  age?: number;
  dateOfBirth?: string;
}

export interface ApplicationPrefill {
  zipCode: string;
  state: string;
  county: string;
  city: string;
  preferredLanguage: string;

  /**
   * Original intake answer describing household composition.
   * Retained until household facts are collected structurally.
   */
  householdProfile: string;

  householdSize?: number;
  householdMembers: HouseholdMemberPrefill[];

  annualHouseholdIncome?: number;
  incomeType: string;
  existingBenefits: string;

}

export interface ExpeditedServiceInformation {
  grossIncomeUnder150AndResourcesUnder100?: boolean;

  incomeAndResourcesLessThanHousingCosts?: boolean;

  migrantOrSeasonalFarmWorker?: boolean;

  evictionNotice?: boolean;

  utilitiesShutOffOrNotice?: boolean;

  foodRunsOutWithinThreeDays?: boolean;

  needsEssentialClothing?: boolean;

  needsTransportationForEmergencyNeeds?: boolean;
}

export interface PersonalEmergencyInformation {
  hasEmergency?: boolean;

  pregnancy?: boolean;

  immediateMedicalNeed?: boolean;

  childAbuse?: boolean;

  domesticAbuse?: boolean;

  elderAbuse?: boolean;

  otherEmergency?: boolean;
}

export interface PregnancyInformation {
  anyonePregnant?: boolean;

  presumptiveEligibilityCard?: boolean;
}

export interface ApplicationPreferences {
  emailApplicationInformation?: boolean;

  emailCaseMessages?: boolean;

  needsDisabilityApplicationHelp?: boolean;
  /**
   * Q4 interview preference. Two independent printed checkboxes — neither is a
   * Yes/No pair, so `false` and `undefined` both leave the box unticked.
   */
  prefersInPersonInterview?: boolean;
  needsDisabilityInterviewArrangements?: boolean;

  homeless?: boolean;

  deafOrHardOfHearing?: boolean;
}


export interface ExpeditedServiceInformation {
  grossIncomeUnder150AndResourcesUnder100?: boolean;
  incomeAndResourcesLessThanHousingCosts?: boolean;
  migrantOrSeasonalFarmWorker?: boolean;
  evictionNotice?: boolean;
  utilitiesShutOffOrNotice?: boolean;
  foodRunsOutWithinThreeDays?: boolean;
  needsEssentialClothing?: boolean;
  needsTransportationForEmergencyNeeds?: boolean;
}

export interface PregnancyInformation {
  anyonePregnant?: boolean;
  presumptiveEligibilityCard?: boolean;
}

export interface PersonalEmergencyInformation {
  hasEmergency?: boolean;
  pregnancy?: boolean;
  immediateMedicalNeed?: boolean;
  childAbuse?: boolean;
  domesticAbuse?: boolean;
  elderAbuse?: boolean;
  otherEmergency?: boolean;
}

export interface Saws2PlusApplicationData {
  selectedPrograms: Saws2PlusProgram[];

  /**
   * Page 1 asks "What programs are you applying for?" with an "Other" option
   * and a free-text description beside it.
   */
  otherProgramRequested?: boolean;
  otherProgramDescription: string;
  applicant: ApplicantInformation;
  householdMembers: HouseholdMember[];

  /**
   * Questions the applicant chose to answer later, by planner question id.
   *
   * Recorded rather than inferred. A blank answer is ambiguous — unasked, not
   * applicable, unsupported, or consciously deferred all look identical in the
   * data — and the completion guide has to tell the applicant which of those
   * it is. Only a deliberate "Skip for now" lands here.
   *
   * It lives on the application rather than in the questionnaire flow because
   * the flow is component state: it was lost the moment the applicant navigated
   * away, so nothing downstream ever saw a skip.
   */
  deferredQuestionIds: string[];

  preferences: ApplicationPreferences;
  expeditedService: ExpeditedServiceInformation;
  pregnancy: PregnancyInformation;
  personalEmergency: PersonalEmergencyInformation;

  annualHouseholdIncome?: number;
  incomeType: string;
  existingBenefits: string;

  /**
   * Structured answers to the conditional SAWS 2 PLUS questions.
   *
   * Every gateway here is three-state: undefined means never asked, so an
   * unanswered question is never mistaken for an explicit No.
   */
  questionnaire: Saws2PlusQuestionnaire;
}

export const EMPTY_ADDRESS: ApplicationAddress = {
  street: "",
  apartment: "",
  city: "",
  state: "CA",
  zipCode: "",
};

export const EMPTY_APPLICATION_DATA: Saws2PlusApplicationData = {
  selectedPrograms: [],

  deferredQuestionIds: [],

  otherProgramRequested: undefined,
  otherProgramDescription: "",

  applicant: {
    firstName: "",
    middleName: "",
    lastName: "",
    otherNames: "",
    dateOfBirth: "",
    phone: "",
    alternatePhone: "",
    email: "",
    preferredLanguage: "English",
    homeAddress: { ...EMPTY_ADDRESS },
    mailingAddressSameAsHome: true,
    mailingAddress: { ...EMPTY_ADDRESS },
    householdDetails: {
  applyingFor: [],
  sex: undefined,
  citizenOrNational: undefined,
  fullTimeStudent: undefined,
  disabled: undefined,
  maritalStatus: undefined,
},
  },

  householdMembers: [],
  annualHouseholdIncome: undefined,
  incomeType: "",
  existingBenefits: "",
    preferences: {
    emailApplicationInformation: undefined,
    emailCaseMessages: undefined,
    needsDisabilityApplicationHelp: undefined,
    homeless: undefined,
    deafOrHardOfHearing: undefined,
  },

  expeditedService: {
    grossIncomeUnder150AndResourcesUnder100: undefined,
    incomeAndResourcesLessThanHousingCosts: undefined,
    migrantOrSeasonalFarmWorker: undefined,
    evictionNotice: undefined,
    utilitiesShutOffOrNotice: undefined,
    foodRunsOutWithinThreeDays: undefined,
    needsEssentialClothing: undefined,
    needsTransportationForEmergencyNeeds: undefined,
  },

  pregnancy: {
    anyonePregnant: undefined,
    presumptiveEligibilityCard: undefined,
  },

  questionnaire: emptyQuestionnaire(),

  personalEmergency: {
    hasEmergency: undefined,
    pregnancy: undefined,
    immediateMedicalNeed: undefined,
    childAbuse: undefined,
    domesticAbuse: undefined,
    elderAbuse: undefined,
    otherEmergency: undefined,
  }
}