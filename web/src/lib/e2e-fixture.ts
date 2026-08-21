//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Deterministic workflow fixture — the demo/E2E stand-in for the five KVR
 * phases.
 *
 * This module is pure: it takes the household vars collected by the **real**
 * intake conversation and returns the same artifacts the real workflow would
 * leave behind — one Markdown document per phase, written to
 * `.workforce/<runId>/<phase>.md`, including the `## Structured Application
 * Output` JSON block that `report-assembler.ts` parses into SAWS 2 PLUS
 * recommendations.
 *
 * Because the output is derived from intake rather than hard-coded, the report,
 * the application flow, and the generated PDF all stay consistent with whatever
 * the presenter typed: income + derived household size → FPL percentage →
 * per-program eligibility.
 *
 * Location and household size are NOT re-derived here. City, state, and county
 * are read from the session vars that intake already resolved from the ZIP code
 * (lib/location.ts), and household size comes from the shared parser in
 * lib/household.ts — so the demo has no location or household values of its own.
 *
 * No PII leaves this module: values are interpolated into files inside the run
 * directory (exactly as the real workflow does) and never logged.
 */

import { messages } from '@/i18n';
import {
  reason,
  reasonWith,
  resolveReason,
  type EligibilityReason,
} from '@/lib/eligibility-reasons';
import { parseHouseholdComposition, type HouseholdComposition } from '@/lib/household';
import { resolveZipLocationOffline } from '@/lib/location';
import { PHASE_ORDER } from '@/lib/report-assembler';
import type { SessionVars } from '@/types/session';

/** Household vars as stored on the session. */
type RawVars = SessionVars;

// ---------------------------------------------------------------------------
// Federal Poverty Level
// ---------------------------------------------------------------------------

/** 2025 HHS Federal Poverty Guidelines, 48 contiguous states + DC. */
export const FPL_BASE_2025 = 15_650;

/**
 * The guideline year, as a value rather than a literal inside a sentence.
 *
 * It travels to the reader as a parameter, so "2025" appears in the Spanish and
 * Chinese sentences without either catalog having to be edited when the
 * guidelines are updated.
 */
export const FPL_YEAR = 2025;
export const FPL_INCREMENT_2025 = 5_500;

/** Annual 100% FPL threshold for a household of `size`. */
export function fplForHouseholdSize(size: number): number {
  const normalized = Math.max(1, Math.floor(size));
  return FPL_BASE_2025 + FPL_INCREMENT_2025 * (normalized - 1);
}

/** Parse the intake income answer (already normalized to a digit string). */
export function parseIncome(annualIncome: string | undefined): number {
  const parsed = Number((annualIncome ?? '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

// ---------------------------------------------------------------------------
// Program screening
// ---------------------------------------------------------------------------

/** The three programs a SAWS 2 PLUS application covers. */
type FixtureProgram = 'medi_cal' | 'calfresh' | 'calworks';

type FixtureStatus =
  | 'likely_eligible'
  | 'possibly_eligible'
  | 'unlikely_eligible'
  | 'insufficient_information';

interface FixtureProgramScreening {
  program: FixtureProgram;
  status: FixtureStatus;
  recommendedToApply: boolean;
  /*
   * Named sentences, not sentences. The screening decides what is true about
   * the household; the words are chosen where the reader's language is known.
   */
  reasons: EligibilityReason[];
  missingInformation: EligibilityReason[];
  confidence: number;
}

/** Everything the fixture derives from intake, shared by all five phase docs. */
export interface FixtureContext {
  zipCode: string;
  city: string;
  state: string;
  county: string;
  income: number;
  household: HouseholdComposition;
  /** 100% FPL for this household size. */
  fpl: number;
  /** Household income as a percentage of FPL, rounded. */
  fplPercent: number;
  screenings: FixtureProgramScreening[];
  /** True when at least one program is recommended. */
  recommended: boolean;
  /** Free-text Tier 2 answers, normalized for display. */
  currentCoverage: string;
  medications: string;
  providers: string;
  premiumBudget: string;
  healthNeeds: string;
}

const CALFRESH_MISSING: EligibilityReason[] = [
  reason('missing_monthly_rent_or_mortgage'),
  reason('missing_monthly_utilities'),
];

const CALWORKS_MISSING: EligibilityReason[] = [
  reason('missing_monthly_housing_costs'),
  reason('missing_countable_property_and_vehicles'),
];

function screenMediCal(ctx: Omit<FixtureContext, 'screenings' | 'recommended'>): FixtureProgramScreening {
  const { fplPercent, household } = ctx;
  const limit = Math.round(ctx.fpl * 1.38);

  if (fplPercent <= 138) {
    return {
      program: 'medi_cal',
      status: 'likely_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_medi_cal_income_below_magi', {
          income: ctx.income,
          fplPercent,
          limitPercent: 138,
          limitAmount: limit,
          householdSize: household.size,
          fplYear: FPL_YEAR,
        }),
        reason('elig_ca_medicaid_expansion'),
      ],
      missingInformation: [],
      confidence: 0.93,
    };
  }

  if (household.children > 0 && fplPercent <= 266) {
    return {
      program: 'medi_cal',
      status: 'possibly_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_medi_cal_children_within_266', { fplPercent }),
        reasonWith(
          'elig_medi_cal_children_may_qualify',
          { children: household.children },
          household.children,
        ),
      ],
      missingInformation: [reason('missing_child_citizenship_status')],
      confidence: 0.76,
    };
  }

  if (household.pregnant && fplPercent <= 213) {
    return {
      program: 'medi_cal',
      status: 'possibly_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_medi_cal_pregnancy_within_213', { fplPercent }),
      ],
      missingInformation: [reason('missing_expected_due_date')],
      confidence: 0.74,
    };
  }

  return {
    program: 'medi_cal',
    status: 'unlikely_eligible',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_medi_cal_income_above_magi', {
        income: ctx.income,
        fplPercent,
        limitAmount: limit,
      }),
      reason('elig_covered_ca_more_likely'),
    ],
    missingInformation: [],
    confidence: 0.88,
  };
}

function screenCalFresh(ctx: Omit<FixtureContext, 'screenings' | 'recommended'>): FixtureProgramScreening {
  const { fplPercent } = ctx;
  const grossLimit = Math.round(ctx.fpl * 2.0);

  if (fplPercent <= 130) {
    return {
      program: 'calfresh',
      status: 'likely_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_calfresh_gross_below_130', {
          fplPercent,
          householdSize: ctx.household.size,
        }),
        reason('elig_calfresh_no_asset_test'),
      ],
      missingInformation: CALFRESH_MISSING,
      confidence: 0.87,
    };
  }

  if (fplPercent <= 200) {
    return {
      program: 'calfresh',
      status: 'possibly_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_calfresh_within_mce_200', {
          fplPercent,
          grossLimit,
        }),
        reason('elig_calfresh_net_income_depends'),
      ],
      missingInformation: CALFRESH_MISSING,
      confidence: 0.71,
    };
  }

  return {
    program: 'calfresh',
    status: 'unlikely_eligible',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_calfresh_gross_above_200', { fplPercent, grossLimit }),
    ],
    missingInformation: [],
    confidence: 0.9,
  };
}

function screenCalWorks(ctx: Omit<FixtureContext, 'screenings' | 'recommended'>): FixtureProgramScreening {
  const { household, fplPercent } = ctx;

  if (household.children === 0 && !household.pregnant) {
    return {
      program: 'calworks',
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_calworks_no_child_or_pregnancy')],
      missingInformation: [],
      confidence: 0.95,
    };
  }

  if (fplPercent <= 100) {
    return {
      program: 'calworks',
      status: 'possibly_eligible',
      recommendedToApply: true,
      /*
       * Two sentences rather than one with a swappable middle. The English
       * original spliced either "a pregnancy" or "N dependent children" into
       * the same sentence, which only reads correctly because English puts
       * them in the same place; Spanish agreement and Chinese measure words do
       * not survive that kind of substitution.
       */
      reasons: [
        household.pregnant && household.children === 0
          ? reasonWith('elig_calworks_pregnancy_within_mbsac', { fplPercent })
          : reasonWith(
              'elig_calworks_children_within_mbsac',
              { children: household.children, fplPercent },
              household.children,
            ),
      ],
      missingInformation: CALWORKS_MISSING,
      confidence: 0.66,
    };
  }

  if (fplPercent <= 150) {
    return {
      program: 'calworks',
      status: 'insufficient_information',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_calworks_near_mbsac', {
          fplPercent,
          householdSize: household.size,
        }),
      ],
      missingInformation: CALWORKS_MISSING,
      confidence: 0.55,
    };
  }

  return {
    program: 'calworks',
    status: 'unlikely_eligible',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_calworks_above_mbsac', {
        fplPercent,
        householdSize: household.size,
      }),
    ],
    missingInformation: [],
    confidence: 0.86,
  };
}

/** Normalize a free-text Tier 2 answer, falling back to a neutral phrase. */
function orNotProvided(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Derive the full fixture context from the vars collected during intake.
 *
 * Location comes from the session vars that intake resolved from the ZIP code.
 * The offline resolver is consulted only as a backstop for a session whose vars
 * predate derivation — it is the same function intake uses, so the demo never
 * has location values of its own.
 */
export function buildFixtureContext(vars: RawVars): FixtureContext {
  const zipCode = (vars.zip_code ?? '').trim();
  const fallback = resolveZipLocationOffline(zipCode);

  const city = (vars.city ?? '').trim() || fallback.city;
  const state = (vars.state ?? '').trim() || fallback.state;
  const county = (vars.county ?? '').trim() || fallback.county;

  const household = parseHouseholdComposition(vars.household_profile);
  const income = parseIncome(vars.annual_income);
  const fpl = fplForHouseholdSize(household.size);
  const fplPercent = Math.round((income / fpl) * 100);

  const base = {
    zipCode,
    city,
    state,
    county,
    income,
    household,
    fpl,
    fplPercent,
    currentCoverage: orNotProvided(vars.current_coverage, 'Not provided'),
    medications: orNotProvided(vars.medications, 'Not provided'),
    providers: orNotProvided(vars.providers, 'Not provided'),
    premiumBudget: orNotProvided(vars.premium_budget, 'Not provided'),
    healthNeeds: orNotProvided(vars.health_needs, 'Not provided'),
  };

  const screenings = [
    screenMediCal(base),
    screenCalFresh(base),
    screenCalWorks(base),
  ];

  return {
    ...base,
    screenings,
    recommended: screenings.some((screening) => screening.recommendedToApply),
  };
}

// ---------------------------------------------------------------------------
// Phase documents
// ---------------------------------------------------------------------------

const STATUS_LABELS: Readonly<Record<FixtureStatus, string>> = {
  likely_eligible: 'Likely eligible',
  possibly_eligible: 'Possibly eligible',
  unlikely_eligible: 'Unlikely eligible',
  insufficient_information: 'More information needed',
};

const PROGRAM_LABELS: Readonly<Record<FixtureProgram, string>> = {
  medi_cal: 'Medi-Cal',
  calfresh: 'CalFresh',
  calworks: 'CalWORKs',
};

/**
 * A reason as English prose, for the fixture's markdown body.
 *
 * The body simulates what the external workflow writes, and that is prose in
 * the applicant's language — which for this fixture is English. The structured
 * reasons in the JSON block are what the UI actually localizes; this only keeps
 * the surrounding narrative readable, and it reads the same catalog so the two
 * cannot describe the household differently.
 */
function reasonInEnglish(item: EligibilityReason): string {
  return resolveReason(item, messages.en, 'en');
}

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/** Join names as an English list: "A", "A and B", "A, B, and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** One-line description of the household for the report headers. */
function householdSentence(ctx: FixtureContext): string {
  const { household } = ctx;
  const parts: string[] = [
    `${household.adults} ${household.adults === 1 ? 'adult' : 'adults'}`,
  ];
  if (household.children > 0) {
    parts.push(`${household.children} ${household.children === 1 ? 'child' : 'children'}`);
  }
  if (household.ages.length > 0) {
    parts.push(`ages ${household.ages.join(', ')}`);
  }
  if (household.pregnant) parts.push('pregnancy reported');
  if (household.disability) parts.push('disability reported');
  if (household.veteran) parts.push('veteran household');

  return parts.join(', ');
}

function locationSentence(ctx: FixtureContext): string {
  const city = ctx.city ? `${ctx.city}, ` : '';
  const county = ctx.county ? `${ctx.county} County, ` : '';
  return `ZIP ${ctx.zipCode || 'not provided'}, ${city}${county}${ctx.state || 'state undetermined'}`;
}

function benefitsResearchDoc(ctx: FixtureContext): string {
  const wicEligible =
    ctx.household.pregnant || ctx.household.ages.some((age) => age < 5);

  const rows: string[] = [
    `| Medi-Cal | CA DHCS / ${ctx.county || 'county'} social services | MAGI adults ≤138% FPL; children ≤266% FPL | ${money(ctx.fpl * 1.38)} | ${money(ctx.household.size * 420)}/mo | https://www.coveredca.com/medi-cal/ | Year-round |`,
    `| CalFresh (SNAP) | CDSS / ${ctx.county || 'county'} social services | Gross income ≤200% FPL (CA MCE) | ${money(ctx.fpl * 2)} | ${money(Math.max(23, ctx.household.size * 180 - Math.max(0, ctx.income - ctx.fpl) / 40))}/mo | https://www.getcalfresh.org/ | Year-round |`,
  ];

  if (ctx.household.children > 0 || ctx.household.pregnant) {
    rows.push(
      `| CalWORKs | CDSS / ${ctx.county || 'county'} social services | Needy child in the home; income below MBSAC | ${money(ctx.fpl * 1.0)} | ${money(700 + ctx.household.children * 130)}/mo | https://www.cdss.ca.gov/calworks | Year-round |`,
    );
  }

  if (wicEligible) {
    rows.push(
      `| WIC | CDPH | Pregnant, postpartum, or child under 5; ≤185% FPL | ${money(ctx.fpl * 1.85)} | $75/mo | https://www.phfewic.org/ | Year-round |`,
    );
  }

  rows.push(
    `| LIHEAP / HEAP | CSD | Income ≤60% state median income | ${money(ctx.fpl * 1.5)} | $95/mo | https://www.csd.ca.gov/Pages/LIHEAP-Program.aspx | Seasonal |`,
    `| CARE utility discount | CPUC / local utility | Income ≤200% FPL | ${money(ctx.fpl * 2)} | $42/mo | https://www.cpuc.ca.gov/care/ | Year-round |`,
    `| California LifeLine | CPUC | Income ≤200% FPL or program participation | ${money(ctx.fpl * 2)} | $19/mo | https://www.californialifeline.com/ | Year-round |`,
  );

  const cliffNotes: string[] = [];
  if (ctx.fplPercent <= 138 && ctx.fplPercent >= 110) {
    cliffNotes.push(
      `- Medi-Cal: household income is within ${138 - ctx.fplPercent} percentage points of the 138% FPL limit (${money(ctx.fpl * 1.38)}). A raise above that amount moves the adults to Covered California.`,
    );
  }
  if (ctx.fplPercent <= 200 && ctx.fplPercent >= 170) {
    cliffNotes.push(
      `- CalFresh: household income is within ${200 - ctx.fplPercent} percentage points of the 200% FPL gross-income limit (${money(ctx.fpl * 2)}).`,
    );
  }
  if (cliffNotes.length === 0) {
    cliffNotes.push('- No income cliff detected within 10% of a program threshold.');
  }

  return `## STATUS: COMPLETE
## SUMMARY: ${rows.length} programs identified for a household of ${ctx.household.size} in ${ctx.state || 'the reported ZIP code'}

## Household Profile
${householdSentence(ctx)}. Annual household income ${money(ctx.income)}. ${locationSentence(ctx)}.

## Federal Poverty Level Calculation
- Household size: ${ctx.household.size}
- Annual income: ${money(ctx.income)}
- 100% FPL for household of ${ctx.household.size} (2025): ${money(ctx.fpl)}
- FPL percentage: ${ctx.fplPercent}%

## Programs Found

| Program | Agency | Eligibility Summary | Income Limit | Est. Monthly Value | Source URL | Enrollment Window |
|---------|--------|---------------------|--------------|--------------------|------------|-------------------|
${rows.join('\n')}

## Income Cliff Warnings
${cliffNotes.join('\n')}

## Existing Coverage Reported
${ctx.currentCoverage}
`;
}

function insuranceResearchDoc(ctx: FixtureContext): string {
  const mediCalPath = ctx.fplPercent <= 138;
  const aptcEligible = ctx.fplPercent > 138 && ctx.fplPercent <= 400;
  const monthlyIncome = ctx.income / 12;

  const planRows = mediCalPath
    ? `| Medi-Cal (MAGI) | Medi-Cal managed care | $0 | $0 | $0 | $0–1 generic | ${ctx.county || 'County'} plan network |
| Covered California Silver 70 (comparison) | Silver | ${money(Math.max(0, monthlyIncome * 0.02))} | $5,400 | $45 | $15 tier 1 | PPO/HMO by region |`
    : `| Covered California Silver 70 | Silver | ${money(Math.max(0, monthlyIncome * (aptcEligible ? 0.06 : 0.14)))} | $5,400 | $45 | $15 tier 1 | PPO/HMO by region |
| Covered California Silver 87 (CSR) | Silver CSR | ${money(Math.max(0, monthlyIncome * (aptcEligible ? 0.04 : 0.14)))} | $1,300 | $15 | $5 tier 1 | HMO |
| Covered California Bronze 60 HDHP | Bronze | ${money(Math.max(0, monthlyIncome * (aptcEligible ? 0.02 : 0.09)))} | $7,050 | Deductible first | Deductible first | PPO |`;

  return `## STATUS: COMPLETE
## SUMMARY: Coverage options compared for ${locationSentence(ctx)}

## Subsidy Eligibility
- FPL: ${ctx.fplPercent}%
- Medi-Cal (≤138% FPL): ${mediCalPath ? 'eligible — no premium' : 'over income'}
- Advance Premium Tax Credit (138–400% FPL): ${aptcEligible ? 'eligible' : 'not eligible at this income'}
- Cost-Sharing Reduction (≤250% FPL, Silver): ${ctx.fplPercent <= 250 ? 'eligible' : 'not eligible'}
- Medicaid coverage gap: none — California expanded Medicaid

## Household Preferences From Intake
| Question | Answer |
|----------|--------|
| Current coverage | ${ctx.currentCoverage} |
| Monthly premium budget | ${ctx.premiumBudget} |
| Prescriptions to cover | ${ctx.medications} |
| Providers to keep in network | ${ctx.providers} |
| Ongoing or planned care | ${ctx.healthNeeds} |

## Plan Comparison

| Plan | Metal Tier | Est. Monthly Premium | Deductible | PCP Copay | Generic Rx | Network |
|------|-----------|----------------------|-----------|-----------|------------|---------|
${planRows}

## Notes
- Premiums are modeled from household income and region and are not a binding quote.
- Provider and formulary checks must be repeated at enrollment for ${ctx.providers} and ${ctx.medications}.
`;
}

function evidenceVerificationDoc(ctx: FixtureContext): string {
  return `## STATUS: COMPLETE
## SUMMARY: 0 critical errors, 0 corrections returned to research phases

## Independent FPL Recalculation
- Reference: 2025 HHS Poverty Guidelines, 48 contiguous states and DC
- Base (household of 1): ${money(FPL_BASE_2025)}; per additional person: ${money(FPL_INCREMENT_2025)}
- Recomputed 100% FPL for household of ${ctx.household.size}: ${money(ctx.fpl)}
- Recomputed FPL percentage: ${ctx.fplPercent}% — **matches** Phase 1

## Threshold Verification
| Check | Expected | Found | Result |
|-------|----------|-------|--------|
| Medi-Cal MAGI adult limit | 138% FPL (${money(ctx.fpl * 1.38)}) | 138% FPL | PASS |
| Medi-Cal children limit | 266% FPL (${money(ctx.fpl * 2.66)}) | 266% FPL | PASS |
| CalFresh gross limit (CA MCE) | 200% FPL (${money(ctx.fpl * 2)}) | 200% FPL | PASS |
| California Medicaid expansion | Expanded | Expanded | PASS |
| State derived from ZIP ${ctx.zipCode} | ${ctx.state || 'undetermined'} | ${ctx.state || 'undetermined'} | ${ctx.state ? 'PASS' : 'REVIEW'} |

## Cross-Phase Consistency
- Household size used in Phase 1 and Phase 2 is identical (${ctx.household.size}).
- Income used for FPL, CalFresh, and premium modeling is identical (${money(ctx.income)}).
- No program was reported with an income limit below the household's stated income while also marked eligible.

## Feedback Loop
No critical errors found. Phases 1 and 2 were not re-executed.
`;
}

function eligibilityValidationDoc(ctx: FixtureContext): string {
  const rows = ctx.screenings.map(
    (screening) =>
      `| ${PROGRAM_LABELS[screening.program]} | ${STATUS_LABELS[screening.status]} | ${Math.round(screening.confidence * 100)}% | ${screening.missingInformation.length > 0 ? screening.missingInformation.map(reasonInEnglish).join('; ') : 'None'} |`,
  );

  const details = ctx.screenings
    .map((screening) => {
      const reasons = screening.reasons
        .map((item) => `- ${reasonInEnglish(item)}`)
        .join('\n');
      return `### ${PROGRAM_LABELS[screening.program]} — ${STATUS_LABELS[screening.status]}\n${reasons}`;
    })
    .join('\n\n');

  return `## STATUS: COMPLETE
## SUMMARY: ${ctx.screenings.filter((s) => s.recommendedToApply).length} of ${ctx.screenings.length} SAWS 2 PLUS programs recommended

## Determination Summary

| Program | Determination | Confidence | Information Still Needed |
|---------|---------------|-----------|--------------------------|
${rows.join('\n')}

${details}

## Coverage Gaps
${
  ctx.fplPercent > 138 && ctx.fplPercent <= 200
    ? '- Adults fall between the Medi-Cal limit and comfortable marketplace affordability. Silver CSR plans are the least expensive path to comprehensive coverage.'
    : '- No coverage gap identified: an affordable comprehensive option exists at this income level.'
}

## Interaction Effects
- Approval for ${ctx.fplPercent <= 138 ? 'Medi-Cal' : 'CalFresh'} establishes categorical eligibility for the CARE utility discount and California LifeLine.
- A single SAWS 2 PLUS application covers Medi-Cal, CalFresh, and CalWORKs, so applying for one does not require a separate form for the others.
`;
}

function actionPlanDoc(ctx: FixtureContext): string {
  const applyList = ctx.screenings.filter((screening) => screening.recommendedToApply);

  const bottomLine =
    applyList.length > 0
      ? `Your household should apply for ${listNames(
          applyList.map((screening) => PROGRAM_LABELS[screening.program]),
        )} using one SAWS 2 PLUS application${
          ctx.county ? ` filed with ${ctx.county} County` : ''
        }. At ${ctx.fplPercent}% of the Federal Poverty Level for a household of ${ctx.household.size}, ${
          applyList.some((s) => s.missingInformation.length > 0)
            ? `the remaining determination depends on ${listNames(
                applyList
                  .flatMap((s) => s.missingInformation)
                  .slice(0, 2)
                  .map((item) => reasonInEnglish(item).toLowerCase()),
              )}.`
            : 'no additional information is needed to submit.'
        }`
      : `Based on a household income of ${money(ctx.income)} (${ctx.fplPercent}% of the Federal Poverty Level for a household of ${ctx.household.size}), no SAWS 2 PLUS program is recommended right now. Covered California with premium tax credits is the stronger path, and you can still review and file the application if your income changes.`;

  const steps = applyList.map(
    (screening, index) =>
      `${index + 1}. **Apply for ${PROGRAM_LABELS[screening.program]}** — SAWS 2 PLUS, ${
        ctx.county ? `${ctx.county} County` : 'your county'
      } social services. ${
        screening.missingInformation.length > 0
          ? `Have ready: ${screening.missingInformation
              .map(reasonInEnglish)
              .join(', ')}.`
          : 'No additional documentation is required to start.'
      }`,
  );

  if (steps.length === 0) {
    steps.push(
      '1. **Compare Covered California plans** during open enrollment and apply for premium tax credits at https://www.coveredca.com/.',
    );
  }

  steps.push(
    `${steps.length + 1}. **Apply for the CARE utility discount** at your utility's website once a benefits approval letter arrives.`,
    `${steps.length + 2}. **Report changes** in income or household size within 10 days of the change to avoid an overpayment.`,
  );

  const structured = {
    schemaVersion: 1,
    applications: [
      {
        formId: 'CA_SAWS_2_PLUS',
        recommended: ctx.recommended,
        programs: ctx.screenings.map((screening) => ({
          program: screening.program,
          status: screening.status,
          recommendedToApply: screening.recommendedToApply,
          reasons: screening.reasons,
          missingInformation: screening.missingInformation,
          confidence: screening.confidence,
        })),
      },
    ],
  };

  const annualValue = applyList.reduce(
    (total, screening) =>
      total + (screening.program === 'medi_cal' ? ctx.household.size * 5_040 : 0) +
      (screening.program === 'calfresh' ? ctx.household.size * 2_160 : 0) +
      (screening.program === 'calworks' ? 8_400 + ctx.household.children * 1_560 : 0),
    0,
  );

  /*
   * Section order mirrors the Action Plan template in
   * workflows/benefits-navigator.yaml — including the sections that follow
   * `## Structured Application Output` — so the document the fixture writes is
   * shaped like the one a real phase-5 agent writes.
   */
  return `## STATUS: COMPLETE
## SUMMARY: ${applyList.length} application${applyList.length === 1 ? '' : 's'} recommended for a household of ${ctx.household.size}

## Bottom Line
${bottomLine}

## Prioritized Steps
${steps.join('\n')}

## Document Checklist

| Document | Needed For | Specific Details | How to Obtain |
|----------|-----------|------------------|---------------|
| Photo identification | All programs | Primary applicant | DMV or existing ID |
| Proof of residency | All programs | Lease, utility bill, or official mail showing ZIP ${ctx.zipCode || 'your ZIP code'} | Landlord or utility account |
| Proof of income | All programs | Last 30 days of pay stubs for every working member | Employer or payroll portal |
| Citizenship or immigration documents | Per person applying | Required only for those requesting benefits | USCIS or existing records |
| Housing and utility bills | CalFresh, CalWORKs | Most recent rent or mortgage statement and utility bills | Landlord or utility account |

## Application Directory

| Program | Apply Online | Phone | Office |
|---------|--------------|-------|--------|
| Medi-Cal | https://benefitscal.com/ | 1-800-300-1506 | ${ctx.county ? `${ctx.county} County Department of Social Services` : 'County social services office'} |
| CalFresh | https://www.getcalfresh.org/ | 1-877-847-3663 | ${ctx.county ? `${ctx.county} County Department of Social Services` : 'County social services office'} |
| CalWORKs | https://benefitscal.com/ | 1-877-410-8827 | ${ctx.county ? `${ctx.county} County Department of Social Services` : 'County social services office'} |

Form: SAWS 2 PLUS (Application for CalFresh, Cash Aid, and/or Medi-Cal/Health Care Programs).

## Structured Application Output
\`\`\`json
${JSON.stringify(structured, null, 2)}
\`\`\`

## Income Cliff Warnings
- Medi-Cal for adults ends above ${money(ctx.fpl * 1.38)} per year (138% FPL) for a household of ${ctx.household.size}.
- CalFresh ends above ${money(ctx.fpl * 2)} per year (200% FPL) for a household of ${ctx.household.size}.

## Contingency Plans
- If Medi-Cal is denied, request a Covered California special enrollment period within 60 days of the denial notice.
- If CalFresh is denied for excess income, reapply after any reduction in hours or wages.
- Expedited CalFresh service is available within 3 days for households with very low income and resources.

## Estimated Value Summary

| Program | Monthly Value | Annual Value |
|---------|---------------|--------------|
${
  applyList.length > 0
    ? applyList
        .map(
          (screening) =>
            `| ${PROGRAM_LABELS[screening.program]} | ${money(
              (screening.program === 'medi_cal'
                ? ctx.household.size * 5_040
                : screening.program === 'calfresh'
                  ? ctx.household.size * 2_160
                  : 8_400 + ctx.household.children * 1_560) / 12,
            )} | ${money(
              screening.program === 'medi_cal'
                ? ctx.household.size * 5_040
                : screening.program === 'calfresh'
                  ? ctx.household.size * 2_160
                  : 8_400 + ctx.household.children * 1_560,
            )} |`,
        )
        .join('\n')
    : '| None recommended at this income | $0 | $0 |'
}

**TOTAL ESTIMATED ANNUAL VALUE: ${money(annualValue)}**
`;
}

/**
 * Build the Markdown document for every workflow phase.
 *
 * Keys match `PHASE_ORDER` from report-assembler, which is what
 * `assembleReport()` reads from `.workforce/<runId>/<phase>.md`.
 */
export function buildFixturePhaseDocuments(vars: RawVars): Record<string, string> {
  const ctx = buildFixtureContext(vars);

  const docs: Record<string, string> = {
    'benefits-research': benefitsResearchDoc(ctx),
    'insurance-research': insuranceResearchDoc(ctx),
    'evidence-verification': evidenceVerificationDoc(ctx),
    'eligibility-validation': eligibilityValidationDoc(ctx),
    'action-plan': actionPlanDoc(ctx),
  };

  // Guard against PHASE_ORDER drifting away from the fixture.
  for (const phase of PHASE_ORDER) {
    if (!(phase in docs)) {
      docs[phase] = '_Phase completed without written output._';
    }
  }

  return docs;
}
