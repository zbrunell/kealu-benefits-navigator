//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What counts as a date of birth, in one place.
 *
 * A date of birth reaches the printed form, drives which household table a
 * person is listed in, and decides whether a household qualifies for the
 * elderly/disabled medical deduction. A typo — a year typed as 2205, or a
 * birthday next month — therefore does not merely look wrong on screen; it
 * changes what the county is told and what the applicant is offered.
 *
 * The bounds are computed from a reference date rather than written down as a
 * calendar year, so nothing here expires. `today` is injectable everywhere for
 * the same reason a clock is injectable anywhere: a test that depends on when
 * it runs is a test that fails on a Tuesday in January.
 */

/**
 * Oldest date of birth accepted, in years before the reference date.
 *
 * Not a claim about human longevity — it is the point past which a date is far
 * likelier to be a typo than a person. The oldest verified human lived 122
 * years, so 120 leaves a boundary that rejects mistakes without rejecting
 * anyone plausibly alive.
 */
export const MAX_AGE_YEARS = 120;

/** Why a date of birth was rejected. */
export type DateOfBirthProblem =
  | 'malformed'
  | 'in_future'
  | 'implausibly_old';

export interface DateOfBirthCheck {
  ok: boolean;
  problem?: DateOfBirthProblem;
}

/**
 * Midnight UTC for a `YYYY-MM-DD` string, or null when it is not one.
 *
 * Parsed by hand rather than with `new Date(string)`, which accepts things no
 * date input produces ("2024", "March") and silently rolls impossible days
 * forward — `new Date('2023-02-30')` is the 2nd of March. Rolling a date the
 * applicant did not type into one they did not mean is exactly the failure this
 * module exists to prevent, and it is why 29 February in a common year is
 * rejected here rather than quietly becoming 1 March.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) return null;

  const [, year, month, day] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

  if (Number.isNaN(parsed.getTime())) return null;

  // Reject any date the calendar rolled: 2023-02-30, 2024-13-01, 2023-02-29.
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return parsed;
}

/** Midnight UTC on the reference day, so comparisons ignore time of day. */
function startOfUtcDay(today: Date): Date {
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
}

/**
 * The earliest date of birth accepted.
 *
 * Exactly `MAX_AGE_YEARS` before the reference day, and inclusive: someone
 * whose 120th birthday is today is accepted, someone a day older is not.
 *
 * A reference day of 29 February has no counterpart 120 years earlier — 1905
 * was not a leap year — and `Date.UTC` resolves that to 1 March, which is the
 * next real day and so the correct inclusive bound.
 */
export function earliestDateOfBirth(today: Date = new Date()): Date {
  const day = startOfUtcDay(today);

  return new Date(
    Date.UTC(
      day.getUTCFullYear() - MAX_AGE_YEARS,
      day.getUTCMonth(),
      day.getUTCDate(),
    ),
  );
}

/** The latest date of birth accepted: the reference day itself. */
export function latestDateOfBirth(today: Date = new Date()): Date {
  return startOfUtcDay(today);
}

/** `YYYY-MM-DD`, for an input's `min`/`max`. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The bounds a date input should carry.
 *
 * The attributes are a convenience that makes a bad entry harder to make; they
 * are not the check. A user can paste, a browser can ignore them, and an API
 * client never sees them — `checkDateOfBirth` is the rule.
 */
export function dateOfBirthBounds(today: Date = new Date()): {
  min: string;
  max: string;
} {
  return {
    min: toIsoDate(earliestDateOfBirth(today)),
    max: toIsoDate(latestDateOfBirth(today)),
  };
}

/**
 * Whether a date of birth is one a person could have.
 *
 * An empty value is *not* a problem here: "not entered yet" is a different
 * state from "entered wrongly", and the questionnaire's own required-field
 * handling owns the first. Callers that need a value present check for one.
 */
export function checkDateOfBirth(
  value: string,
  today: Date = new Date(),
): DateOfBirthCheck {
  if (!value.trim()) return { ok: true };

  const parsed = parseIsoDate(value);

  if (!parsed) return { ok: false, problem: 'malformed' };

  if (parsed.getTime() > latestDateOfBirth(today).getTime()) {
    return { ok: false, problem: 'in_future' };
  }

  if (parsed.getTime() < earliestDateOfBirth(today).getTime()) {
    return { ok: false, problem: 'implausibly_old' };
  }

  return { ok: true };
}

/**
 * Whole years between a date of birth and the reference day.
 *
 * Returns null for anything `checkDateOfBirth` rejects, so a caller cannot
 * accidentally compute an age from a date that is not one.
 */
export function ageOnDate(value: string, today: Date = new Date()): number | null {
  if (!checkDateOfBirth(value, today).ok) return null;

  const born = parseIsoDate(value);

  if (!born) return null;

  const day = startOfUtcDay(today);
  let age = day.getUTCFullYear() - born.getUTCFullYear();

  const beforeBirthday =
    day.getUTCMonth() < born.getUTCMonth() ||
    (day.getUTCMonth() === born.getUTCMonth() &&
      day.getUTCDate() < born.getUTCDate());

  if (beforeBirthday) age -= 1;

  return age;
}

/**
 * Message key for a plain date-of-birth problem, or null when there is none.
 *
 * A key rather than a sentence: the domain stays language-free, and every
 * locale renders the same finding from the same catalogue.
 */
export function dateOfBirthErrorKey(
  value: string,
  today: Date = new Date(),
): string | null {
  const check = checkDateOfBirth(value, today);

  if (check.ok) return null;

  switch (check.problem) {
    case 'in_future':
      return 'dob_error_future';
    case 'implausibly_old':
      return 'dob_error_too_old';
    default:
      return 'dob_error_malformed';
  }
}
