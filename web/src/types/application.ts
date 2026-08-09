//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import type { Saws2PlusProgram } from "@/lib/report-assembler";

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
  dateOfBirth: string;
  phone: string;
  email: string;
  preferredLanguage: string;
  homeAddress: ApplicationAddress;
  mailingAddressSameAsHome: boolean;
  mailingAddress: ApplicationAddress;
}

export interface HouseholdMember {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  age?: number;
  relationshipToApplicant: string;
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

  homeless?: boolean;

  deafOrHardOfHearing?: boolean;
}

export interface Saws2PlusApplicationData {
  selectedPrograms: Saws2PlusProgram[];
  applicant: ApplicantInformation;
  householdMembers: HouseholdMember[];
  annualHouseholdIncome?: number;
  incomeType: string;
  existingBenefits: string;
  preferences: ApplicationPreferences;

  expeditedService: ExpeditedServiceInformation;

  pregnancy: PregnancyInformation;

  personalEmergency: PersonalEmergencyInformation;
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

  applicant: {
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    preferredLanguage: "English",
    homeAddress: { ...EMPTY_ADDRESS },
    mailingAddressSameAsHome: true,
    mailingAddress: { ...EMPTY_ADDRESS },
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

personalEmergency: {
  hasEmergency: undefined,
  pregnancy: undefined,
  immediateMedicalNeed: undefined,
  childAbuse: undefined,
  domesticAbuse: undefined,
  elderAbuse: undefined,
  otherEmergency: undefined,
}
};
