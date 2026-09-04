//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Texas programs: statewide, Travis County, and the City of Austin.
 *
 * The single most important fact encoded in this file is a *negative* one:
 * **Texas did not adopt ACA Medicaid expansion.** There is no "adults under
 * 138% FPL get Medicaid" rule to write. Texas Medicaid is a set of categorical
 * programs — children by age band, pregnancy, parents and caretaker relatives,
 * former foster youth, aged/blind/disabled — and an adult who fits none of them
 * is not covered at any income. Below 100% FPL they are also below the
 * marketplace subsidy floor. That is the coverage gap, and it is the honest
 * answer for the canonical Austin demo household.
 *
 * Which is why each Medicaid category is its own program record with its own
 * threshold, rather than one `tx_medicaid` entry with one number. A single entry
 * could only carry one limit, and any limit chosen would be wrong for most
 * households — which is exactly how a 138% adult rule gets applied to a state
 * that never expanded.
 *
 * The county and city entries are the reason this project models four
 * jurisdiction levels rather than two. For an uninsured Austin adult in the
 * coverage gap, the program that actually helps is Central Health MAP — a
 * Travis County program invisible to any system that only knows about states.
 * A local benefits counselor would lead with it. So must we.
 *
 * ── Provenance ────────────────────────────────────────────────────────────
 * SNAP income limits, deductions and the categorical-eligibility threshold are
 * from the Texas Works Handbook C-120, Revision 25-4, effective 1 Oct 2025.
 * Medical program FPL percentages are from Texas Works Handbook C-130,
 * Revision 26-2, effective 1 Apr 2026. Both were read directly from
 * hhs.texas.gov during implementation. Anything not read from an official
 * source carries `verified: false` and a note saying what is missing.
 */

import type { ProgramDefinition } from '@/lib/programs/types';

/** Cities inside Austin Energy / Austin Water's service area, for city programs. */
const AUSTIN_UTILITY_CITIES = ['Austin'] as const;

/**
 * Texas Works Handbook C-120, Revision 25-4 — effective 1 October 2025.
 *
 * Read from
 * https://fhb.hhs.texas.gov/handbooks/texas-works-handbook/c-120-supplemental-nutrition-assistance-program
 * Tables are indexed by household size starting at 1.
 */
const TX_SNAP_SOURCE = {
  url: 'https://fhb.hhs.texas.gov/handbooks/texas-works-handbook/c-120-supplemental-nutrition-assistance-program',
  revision: 'Revision 25-4',
  effectiveFrom: '2025-10-01',
  verified: true,
} as const;

/** 130% FPL gross monthly income limit, household sizes 1–10. */
const TX_SNAP_GROSS_130 = [
  1696, 2292, 2888, 3483, 4079, 4675, 5271, 5867, 6463, 7059,
] as const;

/** 100% FPL net monthly income limit, household sizes 1–10. */
const TX_SNAP_NET_100 = [
  1305, 1763, 2221, 2680, 3138, 3596, 4055, 4513, 4972, 5431,
] as const;

/** 165% FPL categorical-eligibility monthly limit, household sizes 1–10. */
const TX_SNAP_CATEGORICAL_165 = [
  2152, 2908, 3664, 4420, 5176, 5932, 6688, 7444, 8200, 8960,
] as const;

/**
 * Texas Works Handbook C-130, Revision 26-2 — effective 1 April 2026.
 *
 * Read from
 * https://fhb.hhs.texas.gov/handbooks/texas-works-handbook/c-130-medical-programs
 */
const TX_MEDICAL_SOURCE = {
  url: 'https://fhb.hhs.texas.gov/handbooks/texas-works-handbook/c-130-medical-programs',
  revision: 'Revision 26-2',
  effectiveFrom: '2026-04-01',
  verified: true,
} as const;

export const TEXAS_PROGRAMS: readonly ProgramDefinition[] = [
  // ── Statewide: health ────────────────────────────────────────────────────
  {
    id: 'tx_medicaid_child',
    nameKey: 'program_tx_medicaid_child',
    summaryKey: 'program_tx_medicaid_child_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '2-1-1',
    /*
     * Three age bands, three limits — the reason this cannot be one number.
     * Type programs TP 43 (under 1), TP 48 (1–5) and TP 44 (6–18).
     */
    rules: {
      program: 'tx_medicaid_child',
      values: {
        infantFplPercent: 198,
        youngChildFplPercent: 144,
        schoolAgeChildFplPercent: 133,
      },
      source: TX_MEDICAL_SOURCE,
    },
    hasComputableValue: false,
  },
  {
    id: 'tx_chip',
    nameKey: 'program_tx_chip',
    summaryKey: 'program_tx_chip_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '2-1-1',
    /*
     * CHIP sits above Children's Medicaid: a child too well-off for Medicaid
     * but at or below 201% FPL. The screening treats the two as a ladder rather
     * than alternatives, which is how a household with children at 160% FPL
     * gets the right one named.
     */
    rules: {
      program: 'tx_chip',
      fplPercent: 201,
      source: TX_MEDICAL_SOURCE,
    },
    hasComputableValue: false,
  },
  {
    id: 'tx_medicaid_pregnancy',
    nameKey: 'program_tx_medicaid_pregnancy',
    summaryKey: 'program_tx_medicaid_pregnancy_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '2-1-1',
    rules: {
      program: 'tx_medicaid_pregnancy',
      fplPercent: 198,
      values: { postpartumMonths: 12 },
      source: TX_MEDICAL_SOURCE,
    },
    hasComputableValue: false,
  },
  {
    id: 'tx_chip_perinatal',
    nameKey: 'program_tx_chip_perinatal',
    summaryKey: 'program_tx_chip_perinatal_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '2-1-1',
    /*
     * CHIP Perinatal covers the pregnancy itself for someone who cannot get
     * Medicaid for Pregnant Women — including because of immigration status.
     * It is the reason a pregnant Austin household is never told "no options".
     */
    rules: {
      program: 'tx_chip_perinatal',
      fplPercent: 202,
      source: TX_MEDICAL_SOURCE,
    },
    hasComputableValue: false,
  },
  {
    id: 'tx_healthy_texas_women',
    nameKey: 'program_tx_healthy_texas_women',
    summaryKey: 'program_tx_healthy_texas_women_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.healthytexaswomen.org/',
    channels: ['portal', 'phone'],
    phone: '2-1-1',
    rules: {
      program: 'tx_healthy_texas_women',
      fplPercent: 204.2,
      values: { minimumAge: 15, maximumAge: 44 },
      source: TX_MEDICAL_SOURCE,
    },
    hasComputableValue: false,
  },
  {
    id: 'tx_medicaid_parent',
    nameKey: 'program_tx_medicaid_parent',
    summaryKey: 'program_tx_medicaid_parent_summary',
    level: 'state',
    category: 'health',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '2-1-1',
    /*
     * TP 08, Parents and Caretaker Relatives. The limit is not an FPL
     * percentage: it derives from the state's 1996 AFDC payment standard, which
     * in Texas works out to roughly 14–17% FPL — among the lowest in the
     * country. No percentage is encoded here precisely because the published
     * standard is a dollar table and inventing a percentage would be the same
     * mistake as the 138% adult rule.
     *
     * The screening therefore surfaces this program for a household with a
     * dependent child and says the limit is very low and determined by HHSC,
     * rather than asserting a threshold.
     */
    rules: {
      program: 'tx_medicaid_parent',
      source: {
        url: 'https://fhb.hhs.texas.gov/handbooks/texas-works-handbook/a-1340-income-limits',
        effectiveFrom: '2025-10-01',
        verified: false,
        verificationNote:
          'TP 08 uses the 1996 AFDC-based budgetary and recognizable needs standards, published as dollar amounts by household size, not an FPL percentage. The dollar table has not been transcribed — the screening deliberately states no threshold. A program expert should supply the current standards before any numeric claim is made.',
      },
    },
    hasComputableValue: false,
  },

  // ── Statewide: food ──────────────────────────────────────────────────────
  {
    id: 'tx_snap',
    nameKey: 'program_tx_snap',
    summaryKey: 'program_tx_snap_summary',
    level: 'state',
    category: 'food',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '2-1-1',
    rules: {
      program: 'tx_snap',
      monthlyGrossByHouseholdSize: TX_SNAP_GROSS_130,
      monthlyNetByHouseholdSize: TX_SNAP_NET_100,
      monthlyCategoricalByHouseholdSize: TX_SNAP_CATEGORICAL_165,
      monthlyIncrementPerPerson: 596,
      values: {
        /*
         * Texas grants categorical eligibility at 165% FPL, so a household over
         * the 130% gross screen is not finished — it is a different test, not a
         * denial. Encoding both is what keeps the screening from producing a
         * false "over income" for households between the two.
         */
        categoricalGrossFplPercent: 165,
        netIncrementPerPerson: 459,
        categoricalIncrementPerPerson: 757,
        /* C-120 deductions, Revision 25-4. */
        maximumExcessShelterDeduction: 744,
        standardDeductionSmallHousehold: 209,
        /*
         * Expedited service: gross monthly income under $150 with countable
         * resources at or below $100, or shelter costs exceeding income plus
         * resources. 7 CFR 273.2(i). Three calendar days in Texas.
         */
        expeditedIncomeCeiling: 150,
        expeditedResourceCeiling: 100,
        expeditedServiceDays: 3,
      },
      source: TX_SNAP_SOURCE,
    },
    hasComputableValue: true,
  },

  // ── Statewide: cash ─────────────────────────────────────────────────────
  {
    id: 'tx_tanf',
    nameKey: 'program_tx_tanf',
    summaryKey: 'program_tx_tanf_summary',
    level: 'state',
    category: 'cash',
    country: 'US',
    state: 'TX',
    agency: 'Texas Health and Human Services Commission',
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['portal', 'phone', 'in_person', 'mail'],
    phone: '2-1-1',
    /*
     * TANF requires a dependent child (18 or under) or a third-trimester
     * pregnancy. An adult-only household is categorically ineligible however
     * low its income — which is the specific error the brief called out, and it
     * is enforced by household composition in the screening, not by income.
     */
    rules: {
      program: 'tx_tanf',
      resourceLimit: 5000,
      values: { grantFplPercent: 17, minimumMonthlyGrant: 10 },
      source: {
        url: 'https://www.hhs.texas.gov/services/financial/cash/tanf-cash-help',
        effectiveFrom: '2025-10-01',
        verified: false,
        verificationNote:
          'Confirmed from HHSC: dependent child required, $5,000 countable resource limit, grant approximately 17% FPL with a $10 minimum. The budgetary-needs and recognizable-needs dollar tables were not transcribed, so no income threshold is asserted.',
      },
    },
    hasComputableValue: false,
  },

  // ── Statewide: utilities ────────────────────────────────────────────────
  {
    id: 'tx_ceap',
    nameKey: 'program_tx_ceap',
    summaryKey: 'program_tx_ceap_summary',
    level: 'state',
    category: 'utilities',
    country: 'US',
    state: 'TX',
    agency: 'Texas Department of Housing and Community Affairs',
    officialUrl: 'https://www.tdhca.texas.gov/comprehensive-energy-assistance-program',
    channels: ['phone', 'in_person'],
    phone: '2-1-1',
    /*
     * Texas's LIHEAP-funded energy assistance. Deliberately NOT mapped from
     * California CARE: CARE is a percentage discount on a regulated utility
     * bill, CEAP is a payment made to the utility on the household's behalf
     * through a local subrecipient agency. Same category, different mechanism,
     * different application route.
     */
    rules: {
      program: 'tx_ceap',
      fplPercent: 150,
      source: {
        url: 'https://www.tdhca.texas.gov/comprehensive-energy-assistance-program',
        effectiveFrom: '2025-10-01',
        verified: false,
        verificationNote:
          'CEAP income eligibility is set by TDHCA within the federal LIHEAP ceiling and has varied between 150% and 200% FPL by program year. Confirm the current program-year limit before relying on 150%.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'tx_wic',
    nameKey: 'program_tx_wic',
    summaryKey: 'program_tx_wic_summary',
    level: 'state',
    category: 'food',
    country: 'US',
    state: 'TX',
    agency: 'Texas WIC (Department of State Health Services)',
    officialUrl: 'https://texaswic.org/',
    channels: ['portal', 'phone', 'in_person'],
    phone: '1-800-942-3678',
    rules: {
      program: 'tx_wic',
      fplPercent: 185,
      source: {
        url: 'https://texaswic.org/how-apply/how-qualify-wic',
        effectiveFrom: '2025-07-01',
        verified: false,
        verificationNote:
          'Texas WIC publishes an income guideline table by household size at 185% FPL. Confirm the current effective year.',
      },
    },
    hasComputableValue: false,
  },

  // ── Travis County ───────────────────────────────────────────────────────
  {
    id: 'travis_central_health_map',
    nameKey: 'program_travis_central_health_map',
    summaryKey: 'program_travis_central_health_map_summary',
    level: 'county',
    category: 'health',
    country: 'US',
    state: 'TX',
    county: 'Travis',
    agency: 'Central Health (Travis County Healthcare District)',
    officialUrl: 'https://www.centralhealth.net/map/',
    channels: ['portal', 'phone', 'in_person'],
    phone: '512-978-8130',
    /*
     * The program that answers the Texas coverage gap in this county, and the
     * clearest single argument for modelling the county level at all. Uninsured
     * Travis County residents at or below 200% FPL, assessed on the last 30
     * days of income, and — unusually and importantly — open to applicants
     * regardless of immigration status.
     *
     * MAP is not insurance. It is access to a defined local network (CommUnity
     * Care clinics, specialists, pharmacies), so the report must not present it
     * as coverage. `hasComputableValue: false` keeps a dollar figure off it.
     */
    rules: {
      program: 'travis_central_health_map',
      fplPercent: 200,
      values: { incomeLookbackDays: 30 },
      source: {
        url: 'https://www.centralhealth.net/map/',
        effectiveFrom: '2025-01-01',
        verified: false,
        verificationNote:
          'Confirmed from Central Health: Travis County residency, uninsured, at or below 200% FPL, eligibility based on the last 30 days of income, open regardless of immigration status. Confirm the current FPL band and whether MAP and MAP Basic have diverged.',
      },
    },
    hasComputableValue: false,
  },

  // ── City of Austin ──────────────────────────────────────────────────────
  {
    id: 'austin_energy_cap',
    nameKey: 'program_austin_energy_cap',
    summaryKey: 'program_austin_energy_cap_summary',
    level: 'city',
    category: 'utilities',
    country: 'US',
    state: 'TX',
    county: 'Travis',
    cities: [...AUSTIN_UTILITY_CITIES],
    agency: 'Austin Energy / City of Austin Utilities',
    officialUrl:
      'https://austinenergy.com/energy-support/customer-assistance-programs',
    channels: ['portal', 'phone'],
    phone: '512-494-9400',
    /*
     * A city program in the strict sense: it is a City of Austin municipal
     * utility discount, so it reaches Austin customers and not the rest of
     * Travis County. Qualification is by income (200% FPL) *or* by participation
     * in a listed program — SNAP, Medicaid, CHIP, SSI, MAP among them — which
     * makes it the natural second step after any Texas benefit approval.
     */
    rules: {
      program: 'austin_energy_cap',
      fplPercent: 200,
      source: {
        url: 'https://austinenergy.com/energy-support/customer-assistance-programs',
        effectiveFrom: '2025-01-01',
        verified: false,
        verificationNote:
          'Confirmed from City of Austin: automatic enrollment via listed program participation (CEAP, MAP, SSI, Medicaid, VASH, SNAP, CHIP, free/reduced lunch, housing vouchers, Lifeline) or manual enrollment at or below 200% FPL. The per-line discount amounts change with the rate schedule and are deliberately not encoded.',
      },
    },
    hasComputableValue: false,
  },
  {
    id: 'austin_plus1',
    nameKey: 'program_austin_plus1',
    summaryKey: 'program_austin_plus1_summary',
    level: 'city',
    category: 'utilities',
    country: 'US',
    state: 'TX',
    county: 'Travis',
    cities: [...AUSTIN_UTILITY_CITIES],
    agency: 'Austin Energy Plus 1 Program (administered locally)',
    officialUrl: 'https://austinenergy.com/energy-support/plus-1-program',
    channels: ['phone', 'in_person'],
    phone: '2-1-1',
    /*
     * Emergency bill-payment help, distinct from the ongoing CAP discount. No
     * rule set: Plus 1 is need-based and administered by partner agencies
     * against available funds, so there is no threshold to encode and any
     * number here would be invented.
     */
    hasComputableValue: false,
  },
];
