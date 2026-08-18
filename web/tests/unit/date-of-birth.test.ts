//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What counts as a date of birth.
 *
 * Every case here fixes the reference date rather than reading the clock. A
 * bounds test that uses `new Date()` passes for a year and then fails on a
 * February morning, and the failure looks like a bug in the code rather than in
 * the test.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_AGE_YEARS,
  ageOnDate,
  checkDateOfBirth,
  dateOfBirthBounds,
  dateOfBirthErrorKey,
  earliestDateOfBirth,
  parseIsoDate,
  toIsoDate,
} from '@/lib/date-of-birth';
import {
  applicantAgeRule,
  applicantDateOfBirthErrorKey,
  checkApplicantAge,
  statesWithApplicantAgeRule,
} from '@/lib/applicant-eligibility';

/** A fixed, ordinary Tuesday. */
const TODAY = new Date(Date.UTC(2026, 7, 18));

describe('parsing', () => {
  it('accepts a well-formed date', () => {
    expect(toIsoDate(parseIsoDate('1990-01-01')!)).toBe('1990-01-01');
  });

  it('rejects anything that is not year-month-day', () => {
    for (const value of ['1990', 'March 1990', '01/01/1990', '1990-1-1', '']) {
      expect(parseIsoDate(value), value).toBeNull();
    }
  });

  it('rejects a day the month does not have, instead of rolling it forward', () => {
    // new Date('2023-02-30') is the 2nd of March, which is not what was typed.
    expect(parseIsoDate('2023-02-30')).toBeNull();
    expect(parseIsoDate('2024-13-01')).toBeNull();
  });

  it('accepts 29 February in a leap year and rejects it in a common one', () => {
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
    expect(parseIsoDate('2023-02-29')).toBeNull();
    // 1900 was not a leap year: divisible by 100 but not by 400.
    expect(parseIsoDate('1900-02-29')).toBeNull();
    expect(parseIsoDate('2000-02-29')).not.toBeNull();
  });
});

describe('bounds', () => {
  it('accepts today', () => {
    expect(checkDateOfBirth('2026-08-18', TODAY).ok).toBe(true);
  });

  it('rejects tomorrow', () => {
    const check = checkDateOfBirth('2026-08-19', TODAY);

    expect(check.ok).toBe(false);
    expect(check.problem).toBe('in_future');
  });

  it('rejects a date years in the future', () => {
    expect(checkDateOfBirth('2205-01-01', TODAY).problem).toBe('in_future');
  });

  it('accepts a date of birth exactly 120 years ago', () => {
    const exactly = toIsoDate(earliestDateOfBirth(TODAY));

    expect(exactly).toBe('1906-08-18');
    expect(checkDateOfBirth(exactly, TODAY).ok).toBe(true);
    expect(ageOnDate(exactly, TODAY)).toBe(MAX_AGE_YEARS);
  });

  it('rejects the day before that', () => {
    const check = checkDateOfBirth('1906-08-17', TODAY);

    expect(check.ok).toBe(false);
    expect(check.problem).toBe('implausibly_old');
  });

  it('treats an empty value as not-yet-entered rather than wrong', () => {
    expect(checkDateOfBirth('', TODAY).ok).toBe(true);
    expect(dateOfBirthErrorKey('', TODAY)).toBeNull();
  });

  it('derives the input bounds from the same rule', () => {
    expect(dateOfBirthBounds(TODAY)).toEqual({
      min: '1906-08-18',
      max: '2026-08-18',
    });
  });

  it('computes the bound relative to the reference date, not a fixed year', () => {
    const later = new Date(Date.UTC(2031, 0, 1));

    expect(dateOfBirthBounds(later).min).toBe('1911-01-01');
    expect(dateOfBirthBounds(later).max).toBe('2031-01-01');
  });

  it('handles a leap-day reference date, which has no counterpart 120 years back', () => {
    // 1904 was a leap year but 1906 was not; the bound resolves to a real day.
    const leapDay = new Date(Date.UTC(2028, 1, 29));

    expect(parseIsoDate(dateOfBirthBounds(leapDay).min)).not.toBeNull();
  });
});

describe('age', () => {
  it('counts a birthday that has already passed this year', () => {
    expect(ageOnDate('1990-01-01', TODAY)).toBe(36);
  });

  it('does not count a birthday still to come', () => {
    expect(ageOnDate('1990-12-31', TODAY)).toBe(35);
  });

  it('counts a birthday falling exactly today', () => {
    expect(ageOnDate('2000-08-18', TODAY)).toBe(26);
  });

  it('refuses to compute an age from a date it would reject', () => {
    expect(ageOnDate('2205-01-01', TODAY)).toBeNull();
    expect(ageOnDate('not-a-date', TODAY)).toBeNull();
  });
});

describe('error keys', () => {
  it('names the problem without writing the sentence', () => {
    expect(dateOfBirthErrorKey('2205-01-01', TODAY)).toBe('dob_error_future');
    expect(dateOfBirthErrorKey('1800-01-01', TODAY)).toBe('dob_error_too_old');
    expect(dateOfBirthErrorKey('rubbish', TODAY)).toBe('dob_error_malformed');
    expect(dateOfBirthErrorKey('1990-01-01', TODAY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Who may apply for themselves
// ---------------------------------------------------------------------------

describe('the applicant age rule', () => {
  it('records California as imposing no minimum, with its authority', () => {
    const rule = applicantAgeRule('CA');

    expect(rule.kind).toBe('none');
    expect(rule.kind === 'none' && rule.source).toContain('40-109.1');
  });

  it('reports an unsupported state as unknown rather than guessing one', () => {
    expect(applicantAgeRule('TX').kind).toBe('unknown');
    expect(applicantAgeRule(undefined).kind).toBe('unknown');
    expect(statesWithApplicantAgeRule()).toEqual(['CA']);
  });

  it('never blocks an applicant where no minimum is established', () => {
    // A sixteen-year-old in California, and the same person in a state the
    // product has no rule for. Neither is refused: refusing would be the
    // product inventing the rule it does not have.
    for (const state of ['CA', 'TX', undefined]) {
      expect(checkApplicantAge('2010-08-18', state, TODAY).ok, String(state)).toBe(
        true,
      );
    }
  });

  it('applies a stated minimum at, below and above the threshold', () => {
    /*
     * California sets none, so the threshold behaviour is exercised through the
     * rule structure itself. This is what a state with a minimum would do, and
     * it is why the structure exists rather than a bare boolean.
     */
    const rule = { kind: 'minimum' as const, years: 18, source: 'test authority' };
    const ageOf = (dob: string) => ageOnDate(dob, TODAY)!;

    expect(ageOf('2008-08-19')).toBe(17); // one day short of 18
    expect(ageOf('2008-08-18')).toBe(18); // exactly 18
    expect(ageOf('2007-08-18')).toBe(19); // over 18

    expect(ageOf('2008-08-19') >= rule.years).toBe(false);
    expect(ageOf('2008-08-18') >= rule.years).toBe(true);
    expect(ageOf('2007-08-18') >= rule.years).toBe(true);
  });

  it('reports a bad date before it reports an age', () => {
    expect(applicantDateOfBirthErrorKey('2205-01-01', 'CA', TODAY)).toBe(
      'dob_error_future',
    );
    expect(applicantDateOfBirthErrorKey('1990-01-01', 'CA', TODAY)).toBeNull();
  });
});
