//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Deterministic assignment of household people to SAWS 2 PLUS table rows.
 *
 * The printed form has two fixed tables:
 *
 * - Q6 "HOUSEHOLD'S INFORMATION: ADULTS" — five rows on page 3.
 * - Q6 "HOUSEHOLD'S INFORMATION: CHILDREN" — five rows on page 4.
 *
 * Which person occupies which printed row is a semantic decision, so it is made
 * here, once, in the same place that knows the household. It used to be an
 * emergent property of two loops in the Python PDF adapter, where three separate
 * accidents could move a person into the wrong row:
 *
 * 1. The adapter discovered members by probing `household.members.N.first_name`
 *    and stopping at the first index that was absent. Blank values never reach
 *    the adapter, so a member whose name had not been entered yet truncated the
 *    list and silently deleted every later member from the form.
 * 2. It classified adult vs child from the date of birth alone. Intake often
 *    knows an age but no date of birth ("me and my one year old"), and an
 *    unparseable date produced `None`, which fell through to the adult branch —
 *    putting a child in the adult table.
 * 3. It appended the applicant only when a name was already known, so an
 *    unnamed applicant surrendered row 1 and every other adult shifted up.
 *
 * The strategy below is stated explicitly instead:
 *
 * 1. The primary applicant always takes the first row of their table, named or
 *    not. Nobody can displace them.
 * 2. Other household members follow in stable application-array order.
 * 3. Adults and children are numbered independently, so adding or removing a
 *    child cannot move an adult, and vice versa.
 *
 * Ordering therefore depends only on the household array's own order and each
 * person's own age — never on which fields happen to be filled in, and never on
 * object iteration order.
 */

import type {
  HouseholdMember,
  Saws2PlusApplicationData,
} from '@/types/application';

/** Age at which the SAWS 2 PLUS form lists a person in the adult table. */
export const ADULT_TABLE_AGE = 18;

/** Which printed household table a person belongs in. */
export type HouseholdTable = 'adult' | 'child';

export interface HouseholdRowAssignment {
  /**
   * Canonical prefix for this person's identity fields. The applicant uses the
   * `applicant` namespace; members use their array index.
   */
  prefix: string;
  /**
   * Canonical prefix for this person's table-specific detail fields. The
   * applicant keeps a single `applicant.household` namespace for both tables;
   * members split into `.adult` / `.child` sub-namespaces.
   */
  detailsPrefix: string;
  /** Index in `application.householdMembers`, or null for the applicant. */
  memberIndex: number | null;
  isApplicant: boolean;
  table: HouseholdTable;
  /** Zero-based row within that table, in printed top-to-bottom order. */
  row: number;
  /**
   * How the adult/child decision was reached. Recorded so a misplacement can be
   * diagnosed from the assignment rather than re-derived.
   */
  basis: 'date_of_birth' | 'age' | 'unknown_age_defaults_to_adult';
}

export interface HouseholdRowPlan {
  adults: HouseholdRowAssignment[];
  children: HouseholdRowAssignment[];
  /** Every assignment, applicant first, then members in application order. */
  all: HouseholdRowAssignment[];
}

/**
 * Age in whole years, or undefined when the date cannot be read.
 *
 * `today` is injectable so tests never depend on the wall clock.
 */
export function ageFromDateOfBirth(
  dateOfBirth: string | undefined,
  today: Date = new Date(),
): number | undefined {
  const trimmed = (dateOfBirth ?? '').trim();
  if (!trimmed) return undefined;

  const born = new Date(trimmed);
  if (Number.isNaN(born.getTime())) return undefined;

  let age = today.getFullYear() - born.getFullYear();
  const beforeBirthday =
    today.getMonth() < born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() < born.getDate());

  if (beforeBirthday) age -= 1;

  return age;
}

interface Classification {
  table: HouseholdTable;
  basis: HouseholdRowAssignment['basis'];
}

/**
 * Decide which table a person belongs in.
 *
 * A date of birth is authoritative. Otherwise a stated age is used, which is
 * what keeps an intake-derived child ("my one year old") out of the adult table
 * before anyone has typed a birth date.
 *
 * When neither is known the person still gets a row — dropping someone from the
 * household would be a worse error than listing them on the wrong page, and the
 * planner separately asks for the missing date of birth. The adult table is the
 * fallback because the child table also carries child-only questions that would
 * be meaningless for an adult.
 */
function classify(
  dateOfBirth: string | undefined,
  statedAge: number | undefined,
  today: Date,
): Classification {
  const fromDob = ageFromDateOfBirth(dateOfBirth, today);

  if (fromDob !== undefined) {
    return {
      table: fromDob < ADULT_TABLE_AGE ? 'child' : 'adult',
      basis: 'date_of_birth',
    };
  }

  if (statedAge !== undefined) {
    return {
      table: statedAge < ADULT_TABLE_AGE ? 'child' : 'adult',
      basis: 'age',
    };
  }

  return { table: 'adult', basis: 'unknown_age_defaults_to_adult' };
}

/** Table membership for one household member, without assigning a row. */
export function tableForMember(
  member: HouseholdMember,
  today: Date = new Date(),
): HouseholdTable {
  return classify(member.dateOfBirth, member.age, today).table;
}

/**
 * Assign every person in the household to a printed row.
 *
 * Pure: same household, same plan. No dependence on iteration order of any
 * object, on which optional fields are populated, or on filtered-array indices.
 */
export function planHouseholdRows(
  application: Saws2PlusApplicationData,
  today: Date = new Date(),
): HouseholdRowPlan {
  const adults: HouseholdRowAssignment[] = [];
  const children: HouseholdRowAssignment[] = [];

  const place = (assignment: Omit<HouseholdRowAssignment, 'row'>) => {
    const table = assignment.table === 'adult' ? adults : children;
    const placed: HouseholdRowAssignment = { ...assignment, row: table.length };

    table.push(placed);

    return placed;
  };

  // 1. The applicant, always first in their table — even with no name yet.
  const applicant = classify(
    application.applicant.dateOfBirth,
    undefined,
    today,
  );

  const applicantAssignment = place({
    prefix: 'applicant',
    detailsPrefix: 'applicant.household',
    memberIndex: null,
    isApplicant: true,
    table: applicant.table,
    basis: applicant.basis,
  });

  // 2. Other members, in stable application order, numbered per table.
  const memberAssignments = application.householdMembers.map(
    (member, memberIndex) => {
      const { table, basis } = classify(member.dateOfBirth, member.age, today);

      return place({
        prefix: `household.members.${memberIndex}`,
        detailsPrefix: `household.members.${memberIndex}.${table}`,
        memberIndex,
        isApplicant: false,
        table,
        basis,
      });
    },
  );

  return {
    adults,
    children,
    all: [applicantAssignment, ...memberAssignments],
  };
}
