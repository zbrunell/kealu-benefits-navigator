//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Email, phone, address and ZIP.
 *
 * These rules are permissive on purpose. Over-validating an address rejects
 * real people — rural routes, unnamed roads, military addresses — and the cost
 * of a wrong rejection is an application never filed. So the cases below check
 * both directions: that obvious mistakes are caught, and that unusual but real
 * values are not.
 */

import { describe, expect, it } from 'vitest';

import {
  checkCity,
  checkEmail,
  checkStreetAddress,
  checkUsPhone,
  checkZipCode,
  digitsOf,
  findApplicationFieldProblems,
  formatUsPhone,
  normalizeUsPhone,
  normalizeWhitespace,
  normalizeZipCode,
} from '@/lib/field-validation';
import { EMPTY_APPLICATION_DATA } from '@/types/application';

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

describe('email', () => {
  it('accepts ordinary addresses', () => {
    for (const value of [
      'john@example.com',
      'john.smith@example.org',
      'j@a.co',
      'first+tag@sub.domain.example.com',
      "o'brien@example.com",
    ]) {
      expect(checkEmail(value), value).toBeNull();
    }
  });

  it('rejects an address with no @', () => {
    expect(checkEmail('johnexample.com')).toBe('field_error_email');
  });

  it('rejects a domain with no dot', () => {
    expect(checkEmail('john@localhost')).toBe('field_error_email');
    expect(checkEmail('john@example')).toBe('field_error_email');
  });

  it('rejects an empty local part', () => {
    expect(checkEmail('@example.com')).toBe('field_error_email');
  });

  it('rejects whitespace inside the address', () => {
    expect(checkEmail('john @example.com')).toBe('field_error_email');
    expect(checkEmail('john@ example.com')).toBe('field_error_email');
  });

  it('rejects a trailing dot with nothing after it', () => {
    expect(checkEmail('john@example.')).toBe('field_error_email');
  });

  it('rejects a dot immediately after the @', () => {
    expect(checkEmail('john@.com')).toBe('field_error_email');
  });

  it('ignores surrounding whitespace rather than failing on it', () => {
    expect(checkEmail('  john@example.com  ')).toBeNull();
  });

  it('treats blank as not-yet-entered', () => {
    expect(checkEmail('')).toBeNull();
    expect(checkEmail('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

describe('US phone', () => {
  it('accepts every shape a person naturally types', () => {
    for (const value of [
      '5125551234',
      '512-555-1234',
      '(512) 555-1234',
      '512 555 1234',
      '512.555.1234',
      ' (512) 555-1234 ',
    ]) {
      expect(checkUsPhone(value), value).toBeNull();
    }
  });

  it('rejects nine digits', () => {
    expect(checkUsPhone('512555123')).toBe('field_error_phone');
  });

  it('rejects eleven digits', () => {
    expect(checkUsPhone('15125551234')).toBe('field_error_phone');
  });

  it('rejects letters, including vanity numbers', () => {
    expect(checkUsPhone('512-LAWYERS')).toBe('field_error_phone');
    expect(checkUsPhone('call me')).toBe('field_error_phone');
  });

  it('treats blank as not-yet-entered', () => {
    expect(checkUsPhone('')).toBeNull();
  });

  it('normalises to ten digits and formats for display', () => {
    expect(normalizeUsPhone('(512) 555-1234')).toBe('5125551234');
    expect(formatUsPhone('5125551234')).toBe('(512) 555-1234');
    expect(formatUsPhone('512-555-1234')).toBe('(512) 555-1234');
  });

  it('leaves a value it cannot normalise alone rather than mangling it', () => {
    expect(normalizeUsPhone('12345')).toBe('12345');
    expect(formatUsPhone('12345')).toBe('12345');
  });

  it('extracts digits', () => {
    expect(digitsOf('(512) 555-1234')).toBe('5125551234');
  });
});

// ---------------------------------------------------------------------------
// Street address
// ---------------------------------------------------------------------------

describe('street address', () => {
  it('accepts a number and a name', () => {
    for (const value of [
      '123 Main St',
      '4500 Speedway',
      '12 W 34th Street',
      '1 Infinite Loop',
      '9430 County Road 12',
      'PO Box 55', // no number first, but both parts present
    ]) {
      expect(checkStreetAddress(value), value).toBeNull();
    }
  });

  it('rejects a street name with no number', () => {
    expect(checkStreetAddress('Main Street')).toBe('field_error_address_number');
    expect(checkStreetAddress('Austin')).toBe('field_error_address_number');
  });

  it('rejects a number with no street', () => {
    expect(checkStreetAddress('123')).toBe('field_error_address_street');
    expect(checkStreetAddress('123 ')).toBe('field_error_address_street');
  });

  it('treats whitespace-only as not-yet-entered', () => {
    expect(checkStreetAddress('   ')).toBeNull();
    expect(checkStreetAddress('')).toBeNull();
  });

  it('does not require a suffix, because real addresses do not always have one', () => {
    expect(checkStreetAddress('4500 Speedway')).toBeNull();
    expect(checkStreetAddress('12 Rural Route 3')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

describe('ZIP code', () => {
  it('accepts five digits', () => {
    expect(checkZipCode('90001')).toBeNull();
  });

  it('accepts ZIP+4 with the hyphen', () => {
    expect(checkZipCode('90001-1234')).toBeNull();
  });

  it('punctuates a nine-digit run rather than rejecting it', () => {
    // The right answer in a slightly wrong shape is not a wrong answer.
    expect(normalizeZipCode('900011234')).toBe('90001-1234');
    expect(checkZipCode('900011234')).toBeNull();
  });

  it('rejects four digits and six digits', () => {
    expect(checkZipCode('9001')).toBe('field_error_zip');
    expect(checkZipCode('900011')).toBe('field_error_zip');
  });

  it('rejects letters', () => {
    expect(checkZipCode('9000A')).toBe('field_error_zip');
  });

  it('treats blank as not-yet-entered', () => {
    expect(checkZipCode('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

describe('whitespace', () => {
  it('trims and collapses runs of spaces', () => {
    expect(normalizeWhitespace('  123   Main    St  ')).toBe('123 Main St');
  });

  it('leaves a single-spaced value untouched', () => {
    expect(normalizeWhitespace('123 Main St')).toBe('123 Main St');
  });
});

describe('city', () => {
  it('accepts names with punctuation and accents', () => {
    for (const value of ['Los Angeles', "Coeur d'Alene", 'San José', '上海']) {
      expect(checkCity(value), value).toBeNull();
    }
  });

  it('rejects a value with no letters at all', () => {
    expect(checkCity('12345')).toBe('field_error_city');
  });
});

// ---------------------------------------------------------------------------
// The authoritative gate
// ---------------------------------------------------------------------------

describe('the application-wide gate', () => {
  const base = {
    ...EMPTY_APPLICATION_DATA,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
      email: 'maria@example.com',
      phone: '(512) 555-1234',
      alternatePhone: '',
      homeAddress: {
        street: '12 Oak Street',
        apartment: '',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
      },
      mailingAddressSameAsHome: true,
    },
    householdMembers: [],
  };

  it('passes a clean application', () => {
    expect(findApplicationFieldProblems(base)).toEqual([]);
  });

  it('names the field and the message key for each problem', () => {
    const problems = findApplicationFieldProblems({
      ...base,
      applicant: {
        ...base.applicant,
        email: 'not-an-email',
        phone: '12345',
        homeAddress: { ...base.applicant.homeAddress, zipCode: '9' },
      },
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        { field: 'applicant.email', messageKey: 'field_error_email' },
        { field: 'applicant.phone', messageKey: 'field_error_phone' },
        { field: 'applicant.homeAddress.zipCode', messageKey: 'field_error_zip' },
      ]),
    );
  });

  it('catches an impossible applicant date of birth', () => {
    const problems = findApplicationFieldProblems({
      ...base,
      applicant: { ...base.applicant, dateOfBirth: '2205-01-01' },
    });

    expect(problems).toContainEqual({
      field: 'applicant.dateOfBirth',
      messageKey: 'dob_error_future',
    });
  });

  it('rejects an under-18 applicant but not an under-18 household member', () => {
    const withMinorMember = {
      ...base,
      applicant: { ...base.applicant, dateOfBirth: '2015-06-01' },
      householdMembers: [
        {
          id: 'm1',
          firstName: 'Sofia',
          middleName: '',
          lastName: 'Delgado',
          dateOfBirth: '2015-06-01',
          relationshipToApplicant: 'child',
        },
      ],
    };

    const problems = findApplicationFieldProblems(withMinorMember);
    const fields = problems.map((problem) => problem.field);

    expect(fields).toContain('applicant.dateOfBirth');
    expect(fields).not.toContain('householdMembers.0.dateOfBirth');
  });

  it('ignores the mailing address while it is the same as home', () => {
    const problems = findApplicationFieldProblems({
      ...base,
      applicant: {
        ...base.applicant,
        mailingAddressSameAsHome: true,
        mailingAddress: { street: '', apartment: '', city: '', state: '', zipCode: '' },
      },
    });

    expect(problems).toEqual([]);
  });

  it('checks the mailing address once it differs', () => {
    const problems = findApplicationFieldProblems({
      ...base,
      applicant: {
        ...base.applicant,
        mailingAddressSameAsHome: false,
        mailingAddress: {
          street: 'Main Street',
          apartment: '',
          city: 'LA',
          state: 'CA',
          zipCode: '90001',
        },
      },
    });

    expect(problems).toContainEqual({
      field: 'applicant.mailingAddress.street',
      messageKey: 'field_error_address_number',
    });
  });
});
