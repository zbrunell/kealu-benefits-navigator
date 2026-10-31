//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Who Texas's Medicaid / CHIP addendum asks about, decided once.
 *
 * The intake screens decide which addendum questions to put to a household and
 * the field plan decides which answers to emit. If the two disagreed about who
 * is a child, who is married or whose spouse is in the roster, an applicant
 * could be asked a question whose answer never reaches the form, or have a box
 * filled from a fact they were never asked about. So both read this module.
 *
 * Nothing here decides eligibility. A "possible child" is someone the addendum
 * asks child questions about, and an unknown age counts as possible: asking a
 * question that turns out not to apply costs one tap, while skipping one that
 * did leaves a printed box blank on a Medicaid application.
 */

import { ageOnDate } from '@/lib/date-of-birth';
import { tableForMember } from '@/lib/household-rows';
import type {
  HouseholdMember,
  MaritalStatus,
  PersonSex,
  Saws2PlusApplicationData,
} from '@/types/application';
import {
  emptyMedicaidAddendum,
  type MedicaidAddendumAnswers,
  type TaxReturnAnswers,
} from '@/types/medicaid-addendum';
import { APPLICANT_MEMBER_ID } from '@/types/saws-questionnaire';

type Data = Saws2PlusApplicationData;

/**
 * Whether the household is applying for health coverage at all.
 *
 * The addendum's own first line: "Applying for or renewing Medicaid, CHIP, or
 * Healthy Texas Women? If yes, you must fill out this form." Healthy Texas
 * Women is not a programme the household selects here, so Medicaid and CHIP
 * are the two that bring the addendum in.
 */
export function appliesForHealthCoverage(data: Data): boolean {
  return (
    data.selectedPrograms.includes('tx_medicaid') ||
    data.selectedPrograms.includes('tx_chip')
  );
}

/** The addendum answers, or an empty set for an application that has none. */
export function addendumOf(data: Data): MedicaidAddendumAnswers {
  return data.medicaidAddendum ?? emptyMedicaidAddendum();
}

/** One person's Section 1 answers, empty when they have given none. */
export function taxReturnFor(data: Data, memberId: string): TaxReturnAnswers {
  return addendumOf(data).taxReturns[memberId] ?? {};
}

/** A person the addendum may ask about, applicant first. */
export interface AddendumPerson {
  /** `applicant` for Person 1, otherwise the roster member's id. */
  memberId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  /** Null when neither a date of birth nor an age is known. */
  age: number | null;
  sex?: PersonSex;
  maritalStatus?: MaritalStatus;
  /** Relationship to Person 1; empty for Person 1. */
  relationshipToApplicant: string;
}

function memberSex(member: HouseholdMember): PersonSex | undefined {
  const record =
    tableForMember(member) === 'child' ? member.childDetails : member.adultDetails;

  return record?.sex;
}

function memberAge(member: HouseholdMember, today: Date): number | null {
  const fromBirth = member.dateOfBirth ? ageOnDate(member.dateOfBirth, today) : null;

  return fromBirth ?? member.age ?? null;
}

/**
 * Everyone in the household, in the order the form prints them.
 *
 * Person 1 is the applicant and Persons 2 onward are the roster, which is the
 * order both Section H and the addendum's Section 1 use.
 */
export function addendumPeople(
  data: Data,
  today: Date = new Date(),
): AddendumPerson[] {
  const applicant = data.applicant;

  return [
    {
      memberId: APPLICANT_MEMBER_ID,
      firstName: applicant.firstName,
      middleName: applicant.middleName,
      lastName: applicant.lastName,
      age: applicant.dateOfBirth ? ageOnDate(applicant.dateOfBirth, today) : null,
      sex: applicant.householdDetails?.sex,
      maritalStatus: applicant.householdDetails?.maritalStatus,
      relationshipToApplicant: '',
    },
    ...data.householdMembers.map((member) => ({
      memberId: member.id,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      age: memberAge(member, today),
      sex: memberSex(member),
      maritalStatus: member.adultDetails?.maritalStatus,
      relationshipToApplicant: member.relationshipToApplicant,
    })),
  ];
}

/** A person's name as typed, first and last; empty when neither is. */
export function fullName(person: Pick<AddendumPerson, 'firstName' | 'middleName' | 'lastName'>): string {
  return [person.firstName, person.middleName, person.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** The person with this member id, if they are in the household. */
export function personById(data: Data, memberId: string): AddendumPerson | undefined {
  return addendumPeople(data).find((person) => person.memberId === memberId);
}

/**
 * Someone the addendum's child questions are about: under 19, the CHIP age
 * limit, or of unknown age.
 */
export function isPossibleChild(person: AddendumPerson): boolean {
  return person.age === null || person.age < 19;
}

/**
 * Someone Healthy Texas Women may screen: a woman aged 15 to 44, as the
 * addendum's questions 6 and 7 say. Unknown sex or age counts as possible.
 */
export function isPossibleHtwCandidate(person: AddendumPerson): boolean {
  const ageFits = person.age === null || (person.age >= 15 && person.age <= 44);

  return person.sex !== 'male' && ageFits;
}

export function householdHasPossibleChild(data: Data): boolean {
  return addendumPeople(data).some(isPossibleChild);
}

export function householdHasPossibleHtwCandidate(data: Data): boolean {
  return addendumPeople(data).some(isPossibleHtwCandidate);
}

/**
 * The spouse's name when the roster already says who it is, otherwise empty.
 *
 * Two cases are certain. Person 1's spouse is the roster member recorded as
 * their spouse; and that member's spouse is Person 1. Anyone else's spouse is
 * not in the data, so the addendum asks.
 */
export function rosterSpouseName(data: Data, memberId: string): string {
  const people = addendumPeople(data);

  if (memberId === APPLICANT_MEMBER_ID) {
    const spouse = people.find(
      (person) => person.relationshipToApplicant === 'spouse',
    );

    return spouse ? fullName(spouse) : '';
  }

  const person = people.find((candidate) => candidate.memberId === memberId);

  if (person?.relationshipToApplicant === 'spouse') {
    return fullName(people[0]);
  }

  return '';
}

/** Whether "If married, name of spouse" has to be asked of this person. */
export function needsSpouseName(data: Data, memberId: string): boolean {
  const person = personById(data, memberId);

  return person?.maritalStatus === 'married' && !rosterSpouseName(data, memberId);
}
