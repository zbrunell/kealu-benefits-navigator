//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * California programs.
 *
 * These are the programs the navigator has always supported; what is new is
 * that they now *say* they are Californian instead of being the implicit
 * default. Every entry is `state: 'CA'`, so `appliesTo()` keeps them out of
 * Texas without any code needing to recognise that "CalFresh" is a California
 * name.
 *
 * The thresholds are the ones the existing screening already used, moved here
 * so they carry a source and an effective date. Moving them changed no numbers:
 * the California regression tests assert the same outcomes as before.
 */

import type { ProgramDefinition } from '@/lib/programs/types';

export const CALIFORNIA_PROGRAMS: readonly ProgramDefinition[] = [
  {
    id: 'ca_medi_cal',
    nameKey: 'program_medi_cal',
    summaryKey: 'program_ca_medi_cal_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'CA',
    agency: 'California Department of Health Care Services',
    officialUrl: 'https://benefitscal.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '1-800-300-1506',
    /*
     * California expanded Medicaid under the ACA, so a single adult income test
     * at 138% FPL is genuinely the rule here. That is exactly why it must not be
     * a shared default: the same line is wrong in Texas, and the only thing
     * that ever made it look universal was living in a function called
     * `screenMediCal` that ran for every household.
     */
    rules: {
      program: 'ca_medi_cal',
      fplPercent: 138,
      values: {
        adultMagiFplPercent: 138,
        childFplPercent: 266,
        pregnancyFplPercent: 213,
      },
      source: {
        url: 'https://www.dhcs.ca.gov/services/medi-cal/eligibility/Pages/Medi-Cal-Eligibility-Overview.aspx',
        effectiveFrom: '2025-01-01',
        verified: false,
        verificationNote:
          'Carried forward from the previous screening implementation. The 138/266/213% figures were not re-verified against DHCS during the jurisdiction refactor.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'ca_calfresh',
    nameKey: 'program_calfresh',
    summaryKey: 'program_ca_calfresh_summary',
    level: 'state',
    category: 'food',
    country: 'US',
    state: 'CA',
    agency: 'California Department of Social Services',
    officialUrl: 'https://www.getcalfresh.org/',
    channels: ['portal', 'phone', 'in_person'],
    phone: '1-877-847-3663',
    rules: {
      program: 'ca_calfresh',
      fplPercent: 200,
      values: { federalGrossFplPercent: 130, mceGrossFplPercent: 200 },
      source: {
        url: 'https://www.cdss.ca.gov/calfresh',
        effectiveFrom: '2025-10-01',
        verified: false,
        verificationNote:
          'California applies Modified Categorical Eligibility at 200% FPL gross. Carried forward from the previous implementation; not re-verified.',
      },
    },
    hasComputableValue: true,
  },
  {
    id: 'ca_calworks',
    nameKey: 'program_calworks',
    summaryKey: 'program_ca_calworks_summary',
    level: 'state',
    category: 'cash',
    country: 'US',
    state: 'CA',
    agency: 'California Department of Social Services',
    officialUrl: 'https://www.cdss.ca.gov/calworks',
    channels: ['portal', 'in_person', 'mail'],
    phone: '1-877-410-8827',
    rules: {
      program: 'ca_calworks',
      values: { mbsacScreenFplPercent: 100, mbsacReviewFplPercent: 150 },
      source: {
        url: 'https://www.cdss.ca.gov/calworks',
        effectiveFrom: '2025-10-01',
        verified: false,
        verificationNote:
          'The MBSAC test is a dollar standard by household size, not an FPL percentage. The 100%/150% bands are the previous implementation’s screening approximation and should be replaced with the published MBSAC table.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'ca_covered_california',
    nameKey: 'program_covered_california',
    summaryKey: 'program_ca_covered_california_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'CA',
    agency: 'Covered California',
    officialUrl: 'https://www.coveredca.com/',
    channels: ['portal', 'phone'],
    phone: '1-800-300-1506',
    /*
     * California's own exchange, which is why the federal marketplace program
     * excludes CA. A California household sees this; a Texas household sees
     * HealthCare.gov. One concept, two jurisdictions, no shared portal string.
     */
    rules: {
      program: 'ca_covered_california',
      fplPercent: 400,
      values: { subsidyFloorFplPercent: 138 },
      source: {
        url: 'https://www.coveredca.com/income-limits/',
        effectiveFrom: '2026-01-01',
        verified: false,
        verificationNote:
          'Subsidy floor is 138% FPL in California because Medi-Cal covers below that. Confirm the current premium-assistance bands.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'ca_care',
    nameKey: 'program_ca_care',
    summaryKey: 'program_ca_care_summary',
    level: 'state',
    category: 'utilities',
    country: 'US',
    state: 'CA',
    agency: 'California Public Utilities Commission',
    officialUrl: 'https://www.cpuc.ca.gov/care/',
    channels: ['portal', 'phone'],
    rules: {
      program: 'ca_care',
      fplPercent: 200,
      source: {
        url: 'https://www.cpuc.ca.gov/care/',
        effectiveFrom: '2025-06-01',
        verified: false,
        verificationNote:
          'CARE income limits are published per household size by the CPUC. Carried forward as a 200% FPL approximation; not re-verified.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'ca_lifeline',
    nameKey: 'program_ca_lifeline',
    summaryKey: 'program_ca_lifeline_summary',
    level: 'state',
    category: 'utilities',
    country: 'US',
    state: 'CA',
    agency: 'California Public Utilities Commission',
    officialUrl: 'https://www.californialifeline.com/',
    channels: ['portal', 'phone'],
    rules: {
      program: 'ca_lifeline',
      fplPercent: 200,
      source: {
        url: 'https://www.californialifeline.com/en/eligibility_requirements',
        effectiveFrom: '2025-06-01',
        verified: false,
        verificationNote:
          'Carried forward from the previous implementation; not re-verified.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'ca_wic',
    nameKey: 'program_ca_wic',
    summaryKey: 'program_ca_wic_summary',
    level: 'state',
    category: 'food',
    country: 'US',
    state: 'CA',
    agency: 'California Department of Public Health WIC Program',
    officialUrl: 'https://www.myfamily.wic.ca.gov/',
    channels: ['portal', 'phone', 'in_person'],
    phone: '1-888-942-9675',
    rules: {
      program: 'ca_wic',
      fplPercent: 185,
      source: {
        url: 'https://www.cdph.ca.gov/Programs/CFH/DWICSN/Pages/Income-Guidelines.aspx',
        effectiveFrom: '2025-07-01',
        verified: false,
        verificationNote:
          'CDPH publishes a WIC income guideline table by household size. Confirm the current effective year.',
      },
    },
    hasComputableValue: false,
  },
];
