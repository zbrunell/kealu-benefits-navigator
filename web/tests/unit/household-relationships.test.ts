//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Which relationships a household member can plausibly have.
 *
 * The point is not tidiness. A misclick that marks a nine-year-old as the
 * applicant's spouse puts a child in the adult table, asserts a marriage on a
 * document signed under penalty of perjury, and changes which programs the
 * household is screened for.
 */

import { describe, expect, it } from 'vitest';

import {
  HOUSEHOLD_RELATIONSHIPS,
  MINIMUM_SPOUSE_AGE,
  allowedRelationships,
  allowedRelationshipsForDateOfBirth,
  isRelationshipAllowed,
  relationshipAfterAgeChange,
} from '@/lib/household-relationships';

const TODAY = new Date(Date.UTC(2026, 7, 18));

describe('which relationships are offered', () => {
  it('withholds spouse below the minimum age', () => {
    expect(allowedRelationships(15)).not.toContain('spouse');
    expect(allowedRelationships(0)).not.toContain('spouse');
  });

  it('offers spouse at the minimum age and above', () => {
    expect(allowedRelationships(MINIMUM_SPOUSE_AGE)).toContain('spouse');
    expect(allowedRelationships(16)).toContain('spouse');
    expect(allowedRelationships(40)).toContain('spouse');
  });

  it('withholds nothing else at any age', () => {
    const forChild = allowedRelationships(9);

    for (const relationship of HOUSEHOLD_RELATIONSHIPS) {
      if (relationship === 'spouse') continue;
      expect(forChild, relationship).toContain(relationship);
    }
  });

  it('offers everything when the age is unknown', () => {
    // Hiding options from someone who has not entered a birth date yet would be
    // worse than showing them.
    expect(allowedRelationships(null)).toEqual(HOUSEHOLD_RELATIONSHIPS);
    expect(allowedRelationships(undefined)).toEqual(HOUSEHOLD_RELATIONSHIPS);
  });
});

describe('from a date of birth', () => {
  it('withholds spouse for someone who turns 16 tomorrow', () => {
    expect(
      allowedRelationshipsForDateOfBirth('2010-08-19', TODAY),
    ).not.toContain('spouse');
  });

  it('offers spouse on the sixteenth birthday itself', () => {
    expect(allowedRelationshipsForDateOfBirth('2010-08-18', TODAY)).toContain(
      'spouse',
    );
  });

  it('offers everything for a date it cannot read', () => {
    expect(allowedRelationshipsForDateOfBirth('2205-01-01', TODAY)).toEqual(
      HOUSEHOLD_RELATIONSHIPS,
    );
  });
});

describe('a stored relationship after the age changes', () => {
  it('keeps spouse when the new date still allows it', () => {
    expect(relationshipAfterAgeChange('spouse', '1990-01-01', TODAY)).toBe(
      'spouse',
    );
  });

  it('clears spouse when the new date makes it impossible', () => {
    /*
     * The regression this guards: the select stops offering spouse, so the
     * value becomes invisible — and an invisible value is still printed on the
     * form.
     */
    expect(relationshipAfterAgeChange('spouse', '2017-01-01', TODAY)).toBe('');
  });

  it('leaves every other relationship alone', () => {
    expect(relationshipAfterAgeChange('child', '2017-01-01', TODAY)).toBe('child');
    expect(relationshipAfterAgeChange('', '2017-01-01', TODAY)).toBe('');
  });

  it('agrees with isRelationshipAllowed', () => {
    expect(isRelationshipAllowed('spouse', 15)).toBe(false);
    expect(isRelationshipAllowed('spouse', 16)).toBe(true);
    expect(isRelationshipAllowed('child', 9)).toBe(true);
    // An unset relationship is not an invalid one.
    expect(isRelationshipAllowed('', 9)).toBe(true);
  });
});
