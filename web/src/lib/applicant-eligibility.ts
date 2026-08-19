//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Who may file a SAWS 2 PLUS for themselves.
 *
 * The question this module answers is narrow: is there an age below which the
 * *primary applicant* — the person applying on their own behalf — must be
 * turned away? It says nothing about household members, who may be any age.
 *
 * California requires the self-applying primary applicant to be 18. That is a
 * product decision, recorded here as the rule it is, and it is worth writing
 * down what it is *not*: it is not MPP § 40-109.1, which saws2-readiness.ts
 * cites for the right to apply and which points the other way — "any person has
 * the right to apply; an applicant who appears ineligible must still be allowed
 * to apply". The printed form leans the same way, with Q6n asking about
 * Cal-Learn, which exists for parenting teenagers.
 *
 * So the rule below turns away some people the form has questions for:
 * emancipated minors, minor parents, unaccompanied youth. Where that matters,
 * they remain enterable as household members, and a household member of any age
 * is unaffected by this rule. If the policy is revisited, this is the single
 * place to revisit it.
 *
 * `unknown` is a distinct outcome from "the minimum is zero": it records that
 * the product has been given no authority for a state, which is what an
 * unsupported state gets, and it never blocks anyone. Adding a state means
 * adding a rule with its source, not editing a number.
 */

import { ageOnDate, dateOfBirthErrorKey } from '@/lib/date-of-birth';

/** A two-letter state code as the application stores it. */
export type StateCode = string;

/**
 * What a jurisdiction says about the minimum age to apply for oneself.
 *
 * `none` is a finding — an authority was read and imposes no minimum.
 * `unknown` is the absence of one, and is never used to block a person: the
 * product refusing an application it has no rule for would be inventing the
 * rule it lacks.
 */
export type ApplicantAgeRule =
  | { kind: 'none'; source: string }
  | { kind: 'minimum'; years: number; source: string }
  | { kind: 'unknown' };

/**
 * Per-state rules, keyed by the code the application stores.
 *
 * California is the only state this SAWS 2 PLUS flow supports; the report route
 * refuses draft generation for anywhere else.
 */
const RULES: Readonly<Record<string, ApplicantAgeRule>> = {
  CA: {
    kind: 'minimum',
    years: 18,
    source:
      'Kealu product rule: the self-applying primary applicant must be 18. ' +
      'Household members of any age are unaffected.',
  },
};

/** The rule for a state, or `unknown` where the product has no authority. */
export function applicantAgeRule(state: StateCode | undefined): ApplicantAgeRule {
  const code = (state ?? '').trim().toUpperCase();

  return RULES[code] ?? { kind: 'unknown' };
}

/** States this module can speak for. */
export function statesWithApplicantAgeRule(): string[] {
  return Object.keys(RULES).sort();
}

export interface ApplicantAgeCheck {
  ok: boolean;
  /** Set only when a jurisdiction's stated minimum is not met. */
  minimumYears?: number;
  /** The authority the decision rests on, when there is one. */
  source?: string;
}

/**
 * Whether the primary applicant is old enough to apply for themselves.
 *
 * Passes when the jurisdiction sets no minimum, when none is known, and when
 * the date of birth is absent or unusable — an age rule is not the place to
 * report a malformed date, which `checkDateOfBirth` already does.
 */
export function checkApplicantAge(
  dateOfBirth: string,
  state: StateCode | undefined,
  today: Date = new Date(),
): ApplicantAgeCheck {
  const rule = applicantAgeRule(state);

  if (rule.kind !== 'minimum') return { ok: true };

  const age = ageOnDate(dateOfBirth, today);

  if (age === null) return { ok: true };

  return age >= rule.years
    ? { ok: true, source: rule.source }
    : { ok: false, minimumYears: rule.years, source: rule.source };
}

/**
 * Message key for the primary applicant's date of birth, or null when it is
 * usable.
 *
 * Answers in one call the only question the UI actually has — "may this person
 * apply with this date of birth?" — so a component cannot check the date and
 * forget to check the age. Lives here rather than in date-of-birth.ts because
 * only the applicant has an age rule, and because the dependency runs this way:
 * the age rule needs to compute an age, not the reverse.
 */
export function applicantDateOfBirthErrorKey(
  value: string,
  state: StateCode | undefined,
  today: Date = new Date(),
): string | null {
  const dateProblem = dateOfBirthErrorKey(value, today);

  if (dateProblem) return dateProblem;

  return checkApplicantAge(value, state, today).ok
    ? null
    : 'dob_error_too_young';
}
