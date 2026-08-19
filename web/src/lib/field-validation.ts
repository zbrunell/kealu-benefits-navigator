//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What counts as a usable email address, phone number, street address and ZIP.
 *
 * One module because these rules are needed in four places — the applicant
 * step, the questionnaire's record editor, the draft API before anything
 * reaches Python, and the tests — and four copies of "what is a phone number"
 * drift the moment one of them is corrected.
 *
 * Two conventions carried over from date-of-birth.ts:
 *
 *   Checks return a **message key**, never a sentence, so the domain holds no
 *   English and every locale renders the same finding.
 *
 *   Normalising and checking are separate. Normalising is safe to run while
 *   someone is typing; checking is not, because an address is invalid for most
 *   of the time it takes to type one.
 *
 * The rules are deliberately permissive. Over-validating an address rejects
 * real people — rural routes, unnamed roads, military addresses — and the cost
 * of a wrong rejection here is an application never filed.
 */

import { applicantDateOfBirthErrorKey } from '@/lib/applicant-eligibility';
import { dateOfBirthErrorKey } from '@/lib/date-of-birth';
import type { Saws2PlusApplicationData } from '@/types/application';

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

/**
 * Trim, and collapse runs of whitespace to single spaces.
 *
 * Safe for addresses and free text. Deliberately *not* applied to names: a
 * double space in a name may be wrong, but it is the applicant's to decide, and
 * silently editing what someone typed into a legal document is worse than an
 * untidy space.
 */
export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Every digit in the value, in order. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * A US phone number as ten digits, or the input unchanged if it is not one.
 *
 * Storing the digits keeps one representation in the model; `formatUsPhone`
 * puts the punctuation back for display and for the printed form.
 */
export function normalizeUsPhone(value: string): string {
  const digits = digitsOf(value);

  return digits.length === 10 ? digits : value.trim();
}

/** Ten digits as `(512) 555-1234`; anything else is returned unchanged. */
export function formatUsPhone(value: string): string {
  const digits = digitsOf(value);

  if (digits.length !== 10) return value;

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * A ZIP as `12345` or `12345-6789`.
 *
 * A nine-digit run is punctuated rather than rejected: someone typing their
 * ZIP+4 without the hyphen has given the right answer in a slightly wrong
 * shape, and correcting the shape is not changing their answer.
 */
export function normalizeZipCode(value: string): string {
  const digits = digitsOf(value);

  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;

  return digits.length === 5 ? digits : value.trim();
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/**
 * Whether an email address is plausibly one.
 *
 * Structure only — no mailbox is contacted, and none of the exotica RFC 5322
 * permits is rejected beyond what the shape below requires. The rules are the
 * ones that catch real typos: a missing `@`, a bare hostname with no dot, a
 * space left in the middle by a phone keyboard.
 *
 * `john@localhost` is rejected on purpose. It is a valid address on a machine
 * and never the one a benefits applicant meant to type.
 */
export function checkEmail(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  if (/\s/.test(trimmed)) return 'field_error_email';

  const at = trimmed.lastIndexOf('@');

  // Something before the @, and an @ at all.
  if (at <= 0) return 'field_error_email';

  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf('.');

  // A dot in the domain, a hostname before it, and a suffix after it.
  if (dot <= 0 || dot === domain.length - 1) return 'field_error_email';

  return null;
}

/**
 * Whether a US phone number has exactly ten digits.
 *
 * Punctuation is ignored, so every shape a person naturally types is accepted:
 * `5125551234`, `512-555-1234`, `(512) 555-1234`, `512 555 1234`. Letters are
 * not — a vanity number cannot be dialled from a printed form without being
 * translated first, and translating it would be guessing.
 */
export function checkUsPhone(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  if (/[A-Za-z]/.test(trimmed)) return 'field_error_phone';

  return digitsOf(trimmed).length === 10 ? null : 'field_error_phone';
}

/**
 * Whether a street address has both a number and a name.
 *
 * That is the whole rule. No suffix is required, because "4500 Speedway" and
 * "12 Rural Route 3" are real addresses; no format is imposed, because the
 * variety of real addresses exceeds any pattern worth writing.
 *
 * What it does catch is the two ways the field is actually filled in wrongly:
 * a street name with no number, and a number with no street.
 */
export function checkStreetAddress(value: string): string | null {
  const normalized = normalizeWhitespace(value);

  if (!normalized) return null;

  const hasNumber = /\d/.test(normalized);

  // Whatever is left once every number and separator is removed.
  const nameRemainder = normalized.replace(/[\d\s.,#-]+/g, '');

  if (!hasNumber) return 'field_error_address_number';
  if (!nameRemainder) return 'field_error_address_street';

  return null;
}

/** Whether a ZIP is five digits, or five plus four. */
export function checkZipCode(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  return /^\d{5}(-\d{4})?$/.test(normalizeZipCode(trimmed))
    ? null
    : 'field_error_zip';
}

/** Whether a city is present and not merely punctuation. */
export function checkCity(value: string): string | null {
  const normalized = normalizeWhitespace(value);

  if (!normalized) return null;

  return /[A-Za-zÀ-ɏ一-鿿]/.test(normalized)
    ? null
    : 'field_error_city';
}

// ---------------------------------------------------------------------------
// The authoritative gate
// ---------------------------------------------------------------------------

/** One rejected value, named well enough to fix. */
export interface FieldProblem {
  /** Dotted path into the application, e.g. `applicant.homeAddress.zipCode`. */
  field: string;
  /** Message key; the caller renders it in the reader's language. */
  messageKey: string;
}

/**
 * Every impossible value in an application.
 *
 * This is the check that matters. The UI's version is a courtesy that catches
 * mistakes early and can be bypassed by anyone posting JSON; this one runs on
 * the server before a draft is generated, so a malformed phone number cannot
 * reach the PDF by going around the form.
 *
 * Blank is not a problem here. "Not answered yet" is the questionnaire's
 * business, and the completion guide's — this function only objects to values
 * that are present and cannot be true.
 */
export function findApplicationFieldProblems(
  application: Pick<Saws2PlusApplicationData, 'applicant' | 'householdMembers'>,
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const add = (field: string, messageKey: string | null) => {
    if (messageKey) problems.push({ field, messageKey });
  };

  const { applicant } = application;

  add(
    'applicant.dateOfBirth',
    applicantDateOfBirthErrorKey(applicant.dateOfBirth, applicant.homeAddress.state),
  );

  // Household members may be any age; only the date itself has to be possible.
  for (const [index, member] of application.householdMembers.entries()) {
    add(`householdMembers.${index}.dateOfBirth`, dateOfBirthErrorKey(member.dateOfBirth));
  }

  add('applicant.email', checkEmail(applicant.email));
  add('applicant.phone', checkUsPhone(applicant.phone));
  add('applicant.alternatePhone', checkUsPhone(applicant.alternatePhone));
  add('applicant.homeAddress.street', checkStreetAddress(applicant.homeAddress.street));
  add('applicant.homeAddress.city', checkCity(applicant.homeAddress.city));
  add('applicant.homeAddress.zipCode', checkZipCode(applicant.homeAddress.zipCode));

  // The mailing address only exists as an answer when it differs from home.
  if (!applicant.mailingAddressSameAsHome) {
    add('applicant.mailingAddress.street', checkStreetAddress(applicant.mailingAddress.street));
    add('applicant.mailingAddress.city', checkCity(applicant.mailingAddress.city));
    add('applicant.mailingAddress.zipCode', checkZipCode(applicant.mailingAddress.zipCode));
  }

  return problems;
}
