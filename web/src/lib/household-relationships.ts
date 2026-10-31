//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Which relationships a household member can plausibly have to the applicant.
 *
 * The list the form offers is the same for everyone, but not every option is
 * possible for every person: a nine-year-old is not anyone's spouse. Offering
 * the choice invites a misclick that would put a child in the adult table,
 * assert a marriage on a document signed under penalty of perjury, and change
 * which programs the household is screened for.
 *
 * The rule lives here rather than in the select, so the same answer is
 * available to whatever needs it — the form, a validator, an importer — and so
 * a stored value can be re-checked when a date of birth changes. A rule that
 * exists only as a rendering condition cannot clean up after itself.
 */

import { ageOnDate } from '@/lib/date-of-birth';

export const HOUSEHOLD_RELATIONSHIPS = [
  'spouse',
  'child',
  'parent',
  'sibling',
  'grandparent',
  'grandchild',
  'unrelated',
  'other',
] as const;

export type HouseholdRelationship = (typeof HOUSEHOLD_RELATIONSHIPS)[number];

/**
 * How each relationship is written on screen.
 *
 * Catalog keys, not prose: these are rendered into a <select> the applicant
 * reads, so the words come from their language's catalog. Held here rather than
 * in a component because two flows now offer the same list, and two copies of
 * it would drift the moment one gained an option.
 */
export const RELATIONSHIP_LABEL_KEYS: Readonly<
  Record<HouseholdRelationship, string>
> = {
  spouse: 'rel_spouse',
  child: 'rel_child',
  parent: 'rel_parent',
  sibling: 'rel_sibling',
  grandparent: 'rel_grandparent',
  grandchild: 'rel_grandchild',
  unrelated: 'rel_unrelated',
  other: 'rel_other',
};

/**
 * Youngest age at which "spouse" is offered.
 *
 * California's Family Code sets no floor on the age at which a minor may marry
 * with a court order, so this is not a claim about who may legally be married.
 * It is the age below which the product treats "spouse" as certainly a
 * mis-selection: 16 is the lowest age at which any US state issues a licence
 * with parental or judicial consent, so below it the option is noise that can
 * only produce a wrong answer.
 */
export const MINIMUM_SPOUSE_AGE = 16;

/**
 * Relationships offered for a person of this age.
 *
 * An unknown age offers everything: the product does not know enough to rule
 * anything out, and hiding options from someone who has not entered a birth
 * date yet would be worse than showing them.
 */
export function allowedRelationships(
  age: number | null | undefined,
): readonly HouseholdRelationship[] {
  if (age === null || age === undefined) return HOUSEHOLD_RELATIONSHIPS;

  return HOUSEHOLD_RELATIONSHIPS.filter(
    (relationship) => relationship !== 'spouse' || age >= MINIMUM_SPOUSE_AGE,
  );
}

/** Relationships offered for a member with this date of birth. */
export function allowedRelationshipsForDateOfBirth(
  dateOfBirth: string,
  today: Date = new Date(),
): readonly HouseholdRelationship[] {
  return allowedRelationships(ageOnDate(dateOfBirth, today));
}

/** Whether a stored relationship is still possible at this age. */
export function isRelationshipAllowed(
  relationship: string,
  age: number | null | undefined,
): boolean {
  if (!relationship) return true;

  return (allowedRelationships(age) as readonly string[]).includes(relationship);
}

/**
 * The relationship to keep after an age change.
 *
 * Returns '' when the stored value has become impossible, so the caller clears
 * it rather than carrying a hidden spouse on a nine-year-old. Editing a birth
 * date must not leave an answer behind that the form would still print.
 */
export function relationshipAfterAgeChange(
  relationship: string,
  dateOfBirth: string,
  today: Date = new Date(),
): string {
  const age = ageOnDate(dateOfBirth, today);

  return isRelationshipAllowed(relationship, age) ? relationship : '';
}
