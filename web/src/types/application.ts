//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import type { Saws2PlusProgram } from '@/lib/report-assembler';

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
  relationshipToApplicant: string;
}

export interface Saws2PlusApplicationData {
  selectedPrograms: Saws2PlusProgram[];
  applicant: ApplicantInformation;
  householdMembers: HouseholdMember[];
}

export const EMPTY_ADDRESS: ApplicationAddress = {
  street: '',
  apartment: '',
  city: '',
  state: 'CA',
  zipCode: '',
};

export const EMPTY_APPLICATION_DATA: Saws2PlusApplicationData = {
  selectedPrograms: [],
  applicant: {
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    email: '',
    preferredLanguage: 'English',
    homeAddress: { ...EMPTY_ADDRESS },
    mailingAddressSameAsHome: true,
    mailingAddress: { ...EMPTY_ADDRESS },
  },
  householdMembers: [],
};