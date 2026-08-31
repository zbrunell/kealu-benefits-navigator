//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Federal programs — available in every state unless they say otherwise.
 *
 * "Federal" here means the eligibility rules are set federally, not that the
 * application route is the same everywhere. WIC is a federal program delivered
 * by state agencies with state-specific application channels; the state
 * registries carry those routes. What lives here is the part that does not vary.
 *
 * The marketplace entry is the interesting one, and the reason
 * `excludedStates` exists: the ACA marketplace is federal policy, but the
 * *portal* is HealthCare.gov only in states without their own exchange.
 * California runs Covered California. Sending an Austin household to
 * HealthCare.gov and a Los Angeles household to Covered California is one
 * program with two doors, and the exclusion list is how that is said without
 * duplicating the program.
 */

import type { ProgramDefinition } from '@/lib/programs/types';

/**
 * States and territories running their own ACA exchange rather than
 * HealthCare.gov.
 *
 * Listed so the federal marketplace program excludes them; each such state's
 * registry supplies its own exchange as a state-level program. Accurate as of
 * plan year 2026 — a state moving on or off HealthCare.gov is a change to this
 * list and nothing else.
 */
export const STATE_BASED_EXCHANGE_STATES = [
  'CA', 'CO', 'CT', 'DC', 'GA', 'ID', 'KY', 'ME', 'MD', 'MA',
  'MN', 'NV', 'NJ', 'NM', 'NY', 'PA', 'RI', 'VA', 'VT', 'WA',
] as const;

export const FEDERAL_PROGRAMS: readonly ProgramDefinition[] = [
  {
    id: 'federal_marketplace',
    nameKey: 'program_federal_marketplace',
    summaryKey: 'program_federal_marketplace_summary',
    level: 'federal',
    category: 'health',
    country: 'US',
    excludedStates: [...STATE_BASED_EXCHANGE_STATES],
    agency: 'HealthCare.gov (Centers for Medicare & Medicaid Services)',
    officialUrl: 'https://www.healthcare.gov/',
    channels: ['portal', 'phone'],
    phone: '1-800-318-2596',
    /*
     * The premium tax credit range. The lower bound matters far more in a
     * non-expansion state than an expansion one: in Texas an adult below 100%
     * FPL with no other category is in the coverage gap — too poor for
     * marketplace subsidies, ineligible for Medicaid. Encoding 100 as a real
     * value is what lets the screening say that plainly instead of implying
     * marketplace coverage is always available.
     */
    rules: {
      program: 'federal_marketplace',
      fplPercent: 400,
      values: { subsidyFloorFplPercent: 100 },
      source: {
        url: 'https://www.healthcare.gov/lower-costs/',
        effectiveFrom: '2026-01-01',
        verified: false,
        verificationNote:
          'The 400% FPL subsidy cliff was suspended through plan year 2025 by the American Rescue Plan and Inflation Reduction Act. Whether it applies in 2026 depends on legislation after this was written — confirm before relying on the upper bound.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'federal_wic',
    nameKey: 'program_federal_wic',
    summaryKey: 'program_federal_wic_summary',
    level: 'federal',
    category: 'food',
    country: 'US',
    agency: 'USDA Food and Nutrition Service',
    officialUrl: 'https://www.fns.usda.gov/wic',
    channels: ['phone', 'in_person'],
    rules: {
      program: 'federal_wic',
      fplPercent: 185,
      source: {
        url: 'https://www.fns.usda.gov/wic/eligibility',
        effectiveFrom: '2025-07-01',
        verified: false,
        verificationNote:
          'WIC income eligibility is 185% FPL federally; states may use adjunctive eligibility. Confirm the state agency income year in force.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'federal_liheap',
    nameKey: 'program_federal_liheap',
    summaryKey: 'program_federal_liheap_summary',
    level: 'federal',
    category: 'utilities',
    country: 'US',
    agency: 'HHS Administration for Children and Families',
    officialUrl:
      'https://www.acf.hhs.gov/ocs/low-income-home-energy-assistance-program-liheap',
    channels: ['phone', 'in_person'],
    /*
     * No rule set. LIHEAP's income test is set per state within a federal
     * ceiling (the greater of 150% FPL or 60% of state median income), so there
     * is no federal number to encode. The state entries carry the real limits;
     * this entry exists so the category is discoverable everywhere.
     */
    hasComputableValue: false,
  },
  {
    id: 'federal_lifeline',
    nameKey: 'program_federal_lifeline',
    summaryKey: 'program_federal_lifeline_summary',
    level: 'federal',
    category: 'utilities',
    country: 'US',
    agency: 'Universal Service Administrative Company (FCC Lifeline)',
    officialUrl: 'https://www.lifelinesupport.org/',
    channels: ['portal', 'phone'],
    rules: {
      program: 'federal_lifeline',
      fplPercent: 135,
      source: {
        url: 'https://www.lifelinesupport.org/do-i-qualify/',
        effectiveFrom: '2025-01-01',
        verified: false,
        verificationNote:
          'Lifeline qualifies at 135% FPL or via program participation (SNAP, Medicaid, SSI, FPHA, Veterans Pension). Confirm the current federal income guideline table.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'federal_medicare_savings',
    nameKey: 'program_federal_medicare_savings',
    summaryKey: 'program_federal_medicare_savings_summary',
    level: 'federal',
    category: 'health',
    country: 'US',
    agency: 'Centers for Medicare & Medicaid Services',
    officialUrl: 'https://www.medicare.gov/basics/costs/help/medicare-savings-programs',
    channels: ['phone', 'portal'],
    phone: '1-800-633-4227',
    /*
     * Medicare Savings Programs are federally defined but state-administered,
     * and the QMB/SLMB/QI tiers each have their own limit. No single FPL number
     * describes them, so none is encoded; the screening surfaces the program
     * when a household reports Medicare and leaves the tier to the state.
     */
    hasComputableValue: false,
  },
];
