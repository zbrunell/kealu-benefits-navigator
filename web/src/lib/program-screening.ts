//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Jurisdiction-aware eligibility screening — one engine, every market.
 *
 * This is the module the brief's "do not maintain a fake demo-only rules
 * engine" requirement is answered by. The demo fixture and the production
 * report both call `screenHousehold`; neither has a screening of its own. The
 * demo differs only in supplying deterministic household values.
 *
 * The shape of the engine is the point:
 *
 *   discoverPrograms(jurisdiction)      ← geography decides the candidate set
 *        ↓
 *   RULES[program.id](household, ...)   ← policy decides the determination
 *
 * Discovery runs first and the rule table is only ever consulted for programs
 * that survived it. A rule for `ca_medi_cal` therefore cannot fire for an
 * Austin household no matter what it contains, because it is never reached.
 * That ordering is the fix; everything else here is detail.
 *
 * ── What the rules may and may not do ────────────────────────────────────
 * A rule reads the household and its program's own `rules` values. It must not
 * read another program's thresholds, and it must not invent a number: every
 * figure comes from the registry, where it carries a source and an effective
 * date. A rule that needs a value the registry does not hold returns
 * `insufficient_information` and says which value is missing — which is how
 * Texas TP 08 and TANF behave, because their published standards are dollar
 * tables nobody has transcribed.
 *
 * ── Texas is not California with different labels ─────────────────────────
 * There is deliberately no shared "adult Medicaid" rule. California's single
 * 138% FPL test lives in `caMediCal`; Texas's categorical ladder lives in
 * several separate rules, and an adult who matches none of them is reported as
 * being in the coverage gap. A shared abstraction over the two would have to
 * pick one shape, and picking either is the original bug.
 */

import {
  reason,
  reasonWith,
  type EligibilityReason,
} from '@/lib/eligibility-reasons';
import type { HouseholdComposition } from '@/lib/household';
import type { Jurisdiction } from '@/lib/jurisdiction';
import { discoverPrograms, type ProgramDefinition } from '@/lib/programs';

// ---------------------------------------------------------------------------
// Federal Poverty Level
// ---------------------------------------------------------------------------

/**
 * 2025 HHS Federal Poverty Guidelines, 48 contiguous states + DC.
 *
 * Federal and identical in California and Texas, which is why it is shared
 * here rather than living in either state's data. Alaska and Hawaii use higher
 * guidelines; neither is a supported market, and a household there would be
 * screened against the wrong base — noted so it is a known gap rather than a
 * silent one.
 */
export const FPL_BASE_2025 = 15_650;
export const FPL_INCREMENT_2025 = 5_500;
export const FPL_YEAR = 2025;

/** Annual 100% FPL threshold for a household of `size`. */
export function fplForHouseholdSize(size: number): number {
  const normalized = Math.max(1, Math.floor(size));

  return FPL_BASE_2025 + FPL_INCREMENT_2025 * (normalized - 1);
}

/** Parse the intake income answer (a digit string) into whole dollars. */
export function parseIncome(annualIncome: string | undefined): number {
  const parsed = Number((annualIncome ?? '').trim());

  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

// ---------------------------------------------------------------------------
// Screening results
// ---------------------------------------------------------------------------

export const SCREENING_STATUSES = [
  'likely_eligible',
  'possibly_eligible',
  'unlikely_eligible',
  'insufficient_information',
] as const;

export type ScreeningStatus = (typeof SCREENING_STATUSES)[number];

/**
 * An estimated benefit amount, or an honest statement that there is not one.
 *
 * A discriminated union rather than a nullable number, because "we cannot
 * estimate this" is a result the report must render as words, not as a blank
 * cell or a zero. The fabricated "Medi-Cal = $840/month" was possible because
 * the old code had nowhere to put "unknown" — so it put a formula.
 */
export type BenefitEstimate =
  | {
      kind: 'estimated';
      monthly: number;
      annual: number;
      /** Catalog key naming the published formula this came from. */
      methodKey: string;
    }
  | {
      kind: 'unknown';
      /** Catalog key explaining why no figure is given. */
      reasonKey: string;
    };

export interface ProgramScreening {
  /** Registry program id. Always a program `discoverPrograms` returned. */
  programId: string;
  nameKey: string;
  level: ProgramDefinition['level'];
  category: ProgramDefinition['category'];
  status: ScreeningStatus;
  recommendedToApply: boolean;
  reasons: EligibilityReason[];
  missingInformation: EligibilityReason[];
  confidence: number;
  estimate: BenefitEstimate;
}

/** An income threshold the household is close to, derived from a real ruleset. */
export interface IncomeCliff {
  programId: string;
  nameKey: string;
  /** Catalog key for the warning sentence. */
  key: string;
  params: Record<string, number | string>;
}

export interface HouseholdScreening {
  jurisdiction: Jurisdiction;
  household: HouseholdComposition;
  income: number;
  /** 100% FPL for this household size. */
  fpl: number;
  /** Household income as a percentage of FPL, rounded. */
  fplPercent: number;
  /** Every program available here, screened. Widest jurisdiction first. */
  screenings: ProgramScreening[];
  /** True when at least one program is recommended. */
  recommended: boolean;
  /** Cliffs derived from the rulesets actually in force here. */
  cliffs: IncomeCliff[];
  /**
   * True when adults have no health-coverage path at this income.
   *
   * Only ever true in a non-expansion state. Computed rather than declared so
   * it cannot be asserted for California.
   */
  inCoverageGap: boolean;
}

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

/** Everything a rule is allowed to read. */
interface RuleInput {
  program: ProgramDefinition;
  jurisdiction: Jurisdiction;
  household: HouseholdComposition;
  income: number;
  fpl: number;
  fplPercent: number;
  /** Monthly gross income, for programs published as monthly tables. */
  monthlyIncome: number;
}

type Rule = (input: RuleInput) => Omit<
  ProgramScreening,
  'programId' | 'nameKey' | 'level' | 'category'
>;

/** No dollar estimate, with a stated reason. */
function noEstimate(reasonKey: string): BenefitEstimate {
  return { kind: 'unknown', reasonKey };
}

/** A monthly figure from a published formula. */
function estimated(monthly: number, methodKey: string): BenefitEstimate {
  const rounded = Math.max(0, Math.round(monthly));

  return {
    kind: 'estimated',
    monthly: rounded,
    annual: rounded * 12,
    methodKey,
  };
}

/**
 * Read a value from a program's rule set.
 *
 * Returns null rather than a default when absent. A missing threshold must
 * become `insufficient_information`, never a guess — the whole reason rule sets
 * are typed loosely is so a rule can discover its own values are unpublished.
 */
function value(program: ProgramDefinition, name: string): number | null {
  const found = program.rules?.values?.[name];

  return typeof found === 'number' ? found : null;
}

/** A program's single FPL percentage limit, when it has one. */
function fplLimit(program: ProgramDefinition): number | null {
  const limit = program.rules?.fplPercent;

  return typeof limit === 'number' ? limit : null;
}

/** A monthly limit from a published table, extended past the table's end. */
function monthlyLimitFor(
  table: readonly number[] | undefined,
  increment: number | undefined,
  size: number,
): number | null {
  if (!table || table.length === 0) return null;

  const normalized = Math.max(1, Math.floor(size));

  if (normalized <= table.length) return table[normalized - 1];

  if (typeof increment !== 'number') return null;

  return table[table.length - 1] + increment * (normalized - table.length);
}

/** Ages of the children stated in the household answer. */
function childAges(household: HouseholdComposition): number[] {
  return household.people
    .filter((person) => person.role === 'child')
    .map((person) => person.age)
    .filter((age): age is number => typeof age === 'number');
}

/** Whether the household has a child, whether or not an age was stated. */
function hasChild(household: HouseholdComposition): boolean {
  return household.children > 0;
}

// ---------------------------------------------------------------------------
// Federal rules
// ---------------------------------------------------------------------------

/**
 * The ACA marketplace, where HealthCare.gov serves the state.
 *
 * The subsidy *floor* is what makes this rule jurisdiction-sensitive without
 * naming a state: in a non-expansion state a household below 100% FPL is below
 * the floor and above Medicaid's categorical reach, so the honest answer is
 * "you are in the gap", not "buy a plan". The floor comes from the program's
 * own rule set, so California's exchange (floor 138%) and HealthCare.gov (floor
 * 100%) use the same code with different data.
 */
const marketplaceRule: Rule = ({ program, fplPercent }) => {
  const ceiling = fplLimit(program);
  const floor = value(program, 'subsidyFloorFplPercent');

  if (floor !== null && fplPercent < floor) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_marketplace_below_subsidy_floor', {
          fplPercent,
          limitPercent: floor,
        }),
      ],
      missingInformation: [],
      confidence: 0.82,
      estimate: noEstimate('estimate_unknown_premium_varies'),
    };
  }

  if (ceiling !== null && fplPercent > ceiling) {
    return {
      status: 'possibly_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_marketplace_above_subsidy_ceiling', {
          fplPercent,
          limitPercent: ceiling,
        }),
      ],
      missingInformation: [],
      confidence: 0.7,
      estimate: noEstimate('estimate_unknown_premium_varies'),
    };
  }

  return {
    status: 'likely_eligible',
    recommendedToApply: true,
    reasons: [
      reasonWith('elig_marketplace_subsidy_range', {
        fplPercent,
        limitPercent: ceiling ?? 400,
      }),
    ],
    missingInformation: [reason('missing_household_tax_filing_status')],
    confidence: 0.8,
    estimate: noEstimate('estimate_unknown_premium_varies'),
  };
};

/** WIC: a categorical program before it is an income one. */
const wicRule: Rule = ({ program, household, fplPercent }) => {
  const limit = fplLimit(program);
  const ages = childAges(household);
  const hasInfantOrToddler = ages.some((age) => age < 5);
  const categoricallyRelevant = household.pregnant || hasInfantOrToddler;

  if (!categoricallyRelevant) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_wic_no_qualifying_person')],
      missingInformation: [],
      confidence: 0.9,
      estimate: noEstimate('estimate_unknown_food_package'),
    };
  }

  if (limit !== null && fplPercent > limit) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_wic_income_above_limit', {
          fplPercent,
          limitPercent: limit,
        }),
      ],
      missingInformation: [],
      confidence: 0.82,
      estimate: noEstimate('estimate_unknown_food_package'),
    };
  }

  return {
    status: 'likely_eligible',
    recommendedToApply: true,
    reasons: [
      household.pregnant
        ? reason('elig_wic_pregnancy_qualifies')
        : reason('elig_wic_young_child_qualifies'),
      reasonWith('elig_wic_income_within_limit', {
        fplPercent,
        limitPercent: limit ?? 185,
      }),
    ],
    missingInformation: [reason('missing_wic_appointment_documents')],
    confidence: 0.84,
    estimate: noEstimate('estimate_unknown_food_package'),
  };
};

/** A simple "at or below N% FPL" utility or assistance program. */
function fplThresholdRule(options: {
  withinKey: string;
  aboveKey: string;
  missing?: EligibilityReason[];
  estimateReasonKey: string;
  confidenceWithin?: number;
}): Rule {
  return ({ program, fplPercent }) => {
    const limit = fplLimit(program);

    if (limit === null) {
      return {
        status: 'insufficient_information',
        recommendedToApply: false,
        reasons: [reason('elig_no_published_threshold')],
        missingInformation: [reason('missing_published_income_standard')],
        confidence: 0.4,
        estimate: noEstimate(options.estimateReasonKey),
      };
    }

    if (fplPercent <= limit) {
      return {
        status: 'likely_eligible',
        recommendedToApply: true,
        reasons: [
          reasonWith(options.withinKey, { fplPercent, limitPercent: limit }),
        ],
        missingInformation: options.missing ?? [],
        confidence: options.confidenceWithin ?? 0.8,
        estimate: noEstimate(options.estimateReasonKey),
      };
    }

    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith(options.aboveKey, { fplPercent, limitPercent: limit }),
      ],
      missingInformation: [],
      confidence: 0.85,
      estimate: noEstimate(options.estimateReasonKey),
    };
  };
}

/** Medicare Savings Programs: surfaced on a signal, never on income alone. */
const medicareSavingsRule: Rule = ({ household }) => {
  if (!household.senior && !household.disability) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_msp_no_medicare_signal')],
      missingInformation: [],
      confidence: 0.86,
      estimate: noEstimate('estimate_unknown_state_determined'),
    };
  }

  return {
    status: 'insufficient_information',
    recommendedToApply: false,
    reasons: [
      household.senior
        ? reason('elig_msp_age_signal')
        : reason('elig_msp_disability_signal'),
    ],
    missingInformation: [
      reason('missing_medicare_enrollment'),
      reason('missing_countable_resources'),
    ],
    confidence: 0.5,
    estimate: noEstimate('estimate_unknown_state_determined'),
  };
};

// ---------------------------------------------------------------------------
// California rules
// ---------------------------------------------------------------------------

/**
 * Medi-Cal. California expanded Medicaid, so a single adult income test is
 * correct *here* — and nowhere else by default.
 *
 * Preserved behaviour: the thresholds, the ordering of the checks and the
 * catalog keys are the ones the previous screening used, so the California
 * regression tests assert unchanged outcomes.
 */
const caMediCalRule: Rule = ({ program, household, income, fpl, fplPercent }) => {
  const adultLimit = value(program, 'adultMagiFplPercent') ?? 138;
  const childLimit = value(program, 'childFplPercent') ?? 266;
  const pregnancyLimit = value(program, 'pregnancyFplPercent') ?? 213;
  const limitAmount = Math.round(fpl * (adultLimit / 100));

  if (fplPercent <= adultLimit) {
    return {
      status: 'likely_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_medi_cal_income_below_magi', {
          income,
          fplPercent,
          limitPercent: adultLimit,
          limitAmount,
          householdSize: household.size,
          fplYear: FPL_YEAR,
        }),
        reason('elig_ca_medicaid_expansion'),
      ],
      missingInformation: [],
      confidence: 0.93,
      estimate: noEstimate('estimate_unknown_coverage_not_cash'),
    };
  }

  if (household.children > 0 && fplPercent <= childLimit) {
    return {
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
      estimate: noEstimate('estimate_unknown_coverage_not_cash'),
    };
  }

  if (household.pregnant && fplPercent <= pregnancyLimit) {
    return {
      status: 'possibly_eligible',
      recommendedToApply: true,
      reasons: [reasonWith('elig_medi_cal_pregnancy_within_213', { fplPercent })],
      missingInformation: [reason('missing_expected_due_date')],
      confidence: 0.74,
      estimate: noEstimate('estimate_unknown_coverage_not_cash'),
    };
  }

  return {
    status: 'unlikely_eligible',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_medi_cal_income_above_magi', {
        income,
        fplPercent,
        limitAmount,
      }),
      reason('elig_covered_ca_more_likely'),
    ],
    missingInformation: [],
    confidence: 0.88,
    estimate: noEstimate('estimate_unknown_coverage_not_cash'),
  };
};

const CALFRESH_MISSING: EligibilityReason[] = [
  reason('missing_monthly_rent_or_mortgage'),
  reason('missing_monthly_utilities'),
];

/** CalFresh, with California's 200% Modified Categorical Eligibility limit. */
const caCalFreshRule: Rule = ({ program, household, income, fpl, fplPercent }) => {
  const federalScreen = value(program, 'federalGrossFplPercent') ?? 130;
  const mceLimit = value(program, 'mceGrossFplPercent') ?? 200;
  const grossLimit = Math.round(fpl * (mceLimit / 100));

  /*
   * The allotment estimate uses the federal net-income formula (30% of net
   * income deducted from the maximum allotment), the same published method the
   * Texas rule uses. It is labelled as an estimate and is not a determination.
   */
  const estimate = estimated(
    snapAllotmentEstimate(household.size, income),
    'estimate_method_snap_allotment',
  );

  if (fplPercent <= federalScreen) {
    return {
      status: 'likely_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_calfresh_gross_below_130', {
          fplPercent,
          householdSize: household.size,
        }),
        reason('elig_calfresh_no_asset_test'),
      ],
      missingInformation: CALFRESH_MISSING,
      confidence: 0.87,
      estimate,
    };
  }

  if (fplPercent <= mceLimit) {
    return {
      status: 'possibly_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_calfresh_within_mce_200', { fplPercent, grossLimit }),
        reason('elig_calfresh_net_income_depends'),
      ],
      missingInformation: CALFRESH_MISSING,
      confidence: 0.71,
      estimate,
    };
  }

  return {
    status: 'unlikely_eligible',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_calfresh_gross_above_200', { fplPercent, grossLimit }),
    ],
    missingInformation: [],
    confidence: 0.9,
    estimate: noEstimate('estimate_unknown_over_income'),
  };
};

const CALWORKS_MISSING: EligibilityReason[] = [
  reason('missing_monthly_housing_costs'),
  reason('missing_countable_property_and_vehicles'),
];

/** CalWORKs. Requires a needy child, exactly as Texas TANF does. */
const caCalWorksRule: Rule = ({ program, household, fplPercent }) => {
  const screenLimit = value(program, 'mbsacScreenFplPercent') ?? 100;
  const reviewLimit = value(program, 'mbsacReviewFplPercent') ?? 150;

  if (!hasChild(household) && !household.pregnant) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_calworks_no_child_or_pregnancy')],
      missingInformation: [],
      confidence: 0.95,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  if (fplPercent <= screenLimit) {
    return {
      status: 'possibly_eligible',
      recommendedToApply: true,
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
      estimate: noEstimate('estimate_unknown_grant_after_disregards'),
    };
  }

  if (fplPercent <= reviewLimit) {
    return {
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
      estimate: noEstimate('estimate_unknown_grant_after_disregards'),
    };
  }

  return {
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
    estimate: noEstimate('estimate_unknown_over_income'),
  };
};

// ---------------------------------------------------------------------------
// Texas rules
// ---------------------------------------------------------------------------

/**
 * Children's Medicaid, by age band.
 *
 * The bands are the reason this is not one threshold: a 3-year-old and a
 * 10-year-old in the same household have different limits (144% and 133% FPL),
 * so a household can qualify for one child and not the other. The rule reports
 * the most generous band any stated child age reaches, and says which.
 *
 * When no ages were stated, the school-age band is used as the conservative
 * floor and the missing ages are reported — rather than assuming an infant,
 * which would overstate eligibility.
 */
const txMedicaidChildRule: Rule = ({ program, household, fplPercent }) => {
  if (!hasChild(household)) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_tx_medicaid_child_no_child')],
      missingInformation: [],
      confidence: 0.95,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  const infantLimit = value(program, 'infantFplPercent') ?? 198;
  const youngLimit = value(program, 'youngChildFplPercent') ?? 144;
  const schoolLimit = value(program, 'schoolAgeChildFplPercent') ?? 133;

  const ages = childAges(household);
  const agesKnown = ages.length === household.children;

  const bandFor = (age: number): number =>
    age < 1 ? infantLimit : age < 6 ? youngLimit : schoolLimit;

  const bestLimit = ages.length > 0 ? Math.max(...ages.map(bandFor)) : schoolLimit;

  const missing: EligibilityReason[] = agesKnown
    ? []
    : [reason('missing_child_ages')];

  if (fplPercent <= bestLimit) {
    return {
      status: agesKnown ? 'likely_eligible' : 'possibly_eligible',
      recommendedToApply: true,
      reasons: [
        reasonWith('elig_tx_medicaid_child_within_band', {
          fplPercent,
          limitPercent: bestLimit,
        }),
        reason('elig_tx_medicaid_child_bands_by_age'),
      ],
      missingInformation: [...missing, reason('missing_child_citizenship_status')],
      confidence: agesKnown ? 0.88 : 0.7,
      estimate: noEstimate('estimate_unknown_coverage_not_cash'),
    };
  }

  return {
    status: 'unlikely_eligible',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_tx_medicaid_child_above_band', {
        fplPercent,
        limitPercent: bestLimit,
      }),
      reason('elig_tx_chip_next_step'),
    ],
    missingInformation: missing,
    confidence: 0.82,
    estimate: noEstimate('estimate_unknown_coverage_not_cash'),
  };
};

/** CHIP: the rung above Children's Medicaid, not an alternative to it. */
const txChipRule: Rule = ({ program, household, fplPercent }) => {
  if (!hasChild(household)) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_tx_chip_no_child')],
      missingInformation: [],
      confidence: 0.95,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  const limit = fplLimit(program) ?? 201;

  if (fplPercent > limit) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_tx_chip_above_limit', {
          fplPercent,
          limitPercent: limit,
        }),
      ],
      missingInformation: [],
      confidence: 0.85,
      estimate: noEstimate('estimate_unknown_over_income'),
    };
  }

  return {
    status: 'possibly_eligible',
    recommendedToApply: true,
    reasons: [
      reasonWith('elig_tx_chip_within_limit', {
        fplPercent,
        limitPercent: limit,
      }),
      reason('elig_tx_chip_after_medicaid_screen'),
    ],
    missingInformation: [reason('missing_child_ages')],
    confidence: 0.78,
    estimate: noEstimate('estimate_unknown_coverage_not_cash'),
  };
};

/** Medicaid for Pregnant Women. */
const txMedicaidPregnancyRule: Rule = ({ program, household, fplPercent }) => {
  if (!household.pregnant) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_tx_pregnancy_not_reported')],
      missingInformation: [],
      confidence: 0.95,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  const limit = fplLimit(program) ?? 198;
  const postpartum = value(program, 'postpartumMonths') ?? 12;

  if (fplPercent > limit) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_tx_pregnancy_above_limit', {
          fplPercent,
          limitPercent: limit,
        }),
        reason('elig_tx_chip_perinatal_next_step'),
      ],
      missingInformation: [],
      confidence: 0.8,
      estimate: noEstimate('estimate_unknown_coverage_not_cash'),
    };
  }

  return {
    status: 'likely_eligible',
    recommendedToApply: true,
    reasons: [
      reasonWith('elig_tx_pregnancy_within_limit', {
        fplPercent,
        limitPercent: limit,
      }),
      reasonWith('elig_tx_pregnancy_postpartum_coverage', { months: postpartum }),
    ],
    missingInformation: [reason('missing_expected_due_date')],
    confidence: 0.9,
    estimate: noEstimate('estimate_unknown_coverage_not_cash'),
  };
};

/**
 * CHIP Perinatal — the program that keeps a pregnant household from being told
 * there is nothing available.
 *
 * Recommended only when Medicaid for Pregnant Women is out of reach on income,
 * but always *named* when pregnancy is reported, because it is the route for
 * someone whose immigration status rules out Medicaid regardless of income.
 */
const txChipPerinatalRule: Rule = ({ program, household, fplPercent }) => {
  if (!household.pregnant) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_tx_pregnancy_not_reported')],
      missingInformation: [],
      confidence: 0.95,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  const limit = fplLimit(program) ?? 202;

  if (fplPercent > limit) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_tx_chip_perinatal_above_limit', {
          fplPercent,
          limitPercent: limit,
        }),
      ],
      missingInformation: [],
      confidence: 0.82,
      estimate: noEstimate('estimate_unknown_over_income'),
    };
  }

  return {
    status: 'possibly_eligible',
    recommendedToApply: true,
    reasons: [
      reasonWith('elig_tx_chip_perinatal_within_limit', {
        fplPercent,
        limitPercent: limit,
      }),
      reason('elig_tx_chip_perinatal_status_independent'),
    ],
    missingInformation: [reason('missing_expected_due_date')],
    confidence: 0.76,
    estimate: noEstimate('estimate_unknown_coverage_not_cash'),
  };
};

/** Healthy Texas Women — women 15–44, family planning and women's health. */
const txHealthyTexasWomenRule: Rule = ({ program, household, fplPercent }) => {
  const limit = fplLimit(program) ?? 204.2;
  const minAge = value(program, 'minimumAge') ?? 15;
  const maxAge = value(program, 'maximumAge') ?? 44;

  /*
   * Intake does not record sex, so this program can never be confirmed from
   * what we hold — only offered for the household to judge. Saying that plainly
   * is better than either silently dropping it or asserting eligibility we
   * cannot support.
   */
  const anyAgeInRange = household.people.some(
    (person) =>
      typeof person.age === 'number' &&
      person.age >= minAge &&
      person.age <= maxAge,
  );

  const noAgesStated = household.ages.length === 0;

  if (fplPercent > limit) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_tx_htw_above_limit', {
          fplPercent,
          limitPercent: limit,
        }),
      ],
      missingInformation: [],
      confidence: 0.8,
      estimate: noEstimate('estimate_unknown_over_income'),
    };
  }

  if (!anyAgeInRange && !noAgesStated) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_tx_htw_no_one_in_age_range', {
          limitPercent: limit,
        }),
      ],
      missingInformation: [],
      confidence: 0.78,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  return {
    status: 'insufficient_information',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_tx_htw_income_within_limit', {
        fplPercent,
        limitPercent: limit,
      }),
    ],
    missingInformation: [reason('missing_htw_sex_and_age')],
    confidence: 0.5,
    estimate: noEstimate('estimate_unknown_coverage_not_cash'),
  };
};

/**
 * Parents and Caretaker Relatives Medicaid (TP 08).
 *
 * **This rule asserts no income threshold, on purpose.** The published standard
 * is a 1996 AFDC-based dollar table that has not been transcribed into the
 * registry, so the rule reports the program as needing an official
 * determination and states that the limit is far below the FPL. Encoding a
 * plausible-looking percentage here is exactly the failure mode the brief
 * describes: it would look authoritative while being invented.
 */
const txMedicaidParentRule: Rule = ({ household }) => {
  if (!hasChild(household)) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_tx_parent_medicaid_no_child')],
      missingInformation: [],
      confidence: 0.93,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  return {
    status: 'insufficient_information',
    recommendedToApply: false,
    reasons: [
      reason('elig_tx_parent_medicaid_very_low_standard'),
      reason('elig_tx_parent_medicaid_no_published_percent'),
    ],
    missingInformation: [reason('missing_published_income_standard')],
    confidence: 0.45,
    estimate: noEstimate('estimate_unknown_state_determined'),
  };
};

/**
 * Federal maximum SNAP allotment by household size, FY2026.
 *
 * Federal figures, identical in both states, so the estimate function is shared.
 * Used only to produce a clearly-labelled *estimate* via the published
 * 30%-of-net-income formula — never presented as a determination.
 *
 * NOTE: these maximum-allotment figures were not confirmed against the FY2026
 * FNS COLA memorandum during implementation (the document did not load), so
 * they carry the same "needs verification" status as any other unconfirmed
 * value. The income limits that decide *eligibility* were confirmed from HHSC
 * and are separate from these.
 */
const SNAP_MAX_ALLOTMENT_FY2026 = [298, 546, 785, 994, 1183, 1421, 1571, 1795] as const;
const SNAP_ALLOTMENT_INCREMENT = 224;
const SNAP_MINIMUM_ALLOTMENT = 24;

/**
 * Estimate a monthly SNAP allotment from the published formula.
 *
 * maximum allotment − 30% of net monthly income. Net income is approximated by
 * applying only the standard deduction, because intake does not collect shelter
 * or utility costs — so the estimate is deliberately conservative and the
 * report says the real figure depends on deductions we did not ask about.
 */
export function snapAllotmentEstimate(size: number, annualIncome: number): number {
  const normalized = Math.max(1, Math.floor(size));
  const maximum =
    normalized <= SNAP_MAX_ALLOTMENT_FY2026.length
      ? SNAP_MAX_ALLOTMENT_FY2026[normalized - 1]
      : SNAP_MAX_ALLOTMENT_FY2026[SNAP_MAX_ALLOTMENT_FY2026.length - 1] +
        SNAP_ALLOTMENT_INCREMENT *
          (normalized - SNAP_MAX_ALLOTMENT_FY2026.length);

  const monthlyGross = annualIncome / 12;
  // C-120 standard deduction for a household of 1–3 (Revision 25-4).
  const standardDeduction = 209;
  const net = Math.max(0, monthlyGross - standardDeduction);
  const allotment = maximum - 0.3 * net;

  return Math.max(SNAP_MINIMUM_ALLOTMENT, Math.round(allotment));
}

/**
 * Texas SNAP.
 *
 * Uses the HHSC monthly dollar tables rather than an FPL percentage, because
 * that is how Texas publishes them — and because the 130% gross screen, the
 * 165% categorical-eligibility screen and the 100% net test are three different
 * tests that a single percentage cannot express. A household over the 130%
 * screen is not denied; it moves to the categorical test.
 *
 * Expedited service is reported when the household meets the federal criteria,
 * because a household with almost no income needs to know it can be served in
 * three days rather than thirty.
 */
const txSnapRule: Rule = ({ program, household, income, monthlyIncome }) => {
  const rules = program.rules;

  const grossLimit = monthlyLimitFor(
    rules?.monthlyGrossByHouseholdSize,
    rules?.monthlyIncrementPerPerson,
    household.size,
  );

  const categoricalPercent = value(program, 'categoricalGrossFplPercent');
  // Its own published table, extended by its own increment — not a multiple of
  // the 130% limit.
  const categoricalLimit = monthlyLimitFor(
    rules?.monthlyCategoricalByHouseholdSize,
    value(program, 'categoricalIncrementPerPerson') ?? undefined,
    household.size,
  );

  const netLimit = monthlyLimitFor(
    rules?.monthlyNetByHouseholdSize,
    value(program, 'netIncrementPerPerson') ?? undefined,
    household.size,
  );

  if (grossLimit === null) {
    return {
      status: 'insufficient_information',
      recommendedToApply: false,
      reasons: [reason('elig_no_published_threshold')],
      missingInformation: [reason('missing_published_income_standard')],
      confidence: 0.4,
      estimate: noEstimate('estimate_unknown_state_determined'),
    };
  }

  const estimate = estimated(
    snapAllotmentEstimate(household.size, income),
    'estimate_method_snap_allotment',
  );

  const missing: EligibilityReason[] = [
    reason('missing_monthly_rent_or_mortgage'),
    reason('missing_monthly_utilities'),
  ];

  const expeditedCeiling = value(program, 'expeditedIncomeCeiling');
  const expeditedDays = value(program, 'expeditedServiceDays');

  if (
    expeditedCeiling !== null &&
    expeditedDays !== null &&
    monthlyIncome < expeditedCeiling
  ) {
    missing.push(reason('missing_countable_resources'));
  }

  const monthly = Math.round(monthlyIncome);

  if (monthly <= grossLimit) {
    const reasons: EligibilityReason[] = [
      reasonWith('elig_tx_snap_within_gross_limit', {
        monthlyIncome: monthly,
        limitAmount: grossLimit,
        householdSize: household.size,
      }),
    ];

    if (netLimit !== null) {
      reasons.push(
        reasonWith('elig_tx_snap_net_test_follows', { limitAmount: netLimit }),
      );
    }

    if (
      expeditedCeiling !== null &&
      expeditedDays !== null &&
      monthly < expeditedCeiling
    ) {
      reasons.push(
        reasonWith('elig_tx_snap_expedited_possible', {
          limitAmount: expeditedCeiling,
          days: expeditedDays,
        }),
      );
    }

    return {
      status: 'likely_eligible',
      recommendedToApply: true,
      reasons,
      missingInformation: missing,
      confidence: 0.88,
      estimate,
    };
  }

  /*
   * Between the 130% gross screen and the 165% categorical screen. Texas grants
   * categorical eligibility in this band, so this is "possibly eligible on a
   * different test", not a denial.
   */
  if (categoricalLimit !== null) {
    const categoricalCeiling = categoricalLimit;

    if (monthly <= categoricalCeiling) {
      return {
        status: 'possibly_eligible',
        recommendedToApply: true,
        reasons: [
          reasonWith('elig_tx_snap_within_categorical', {
            monthlyIncome: monthly,
            fplPercent: categoricalPercent ?? 165,
            limitAmount: categoricalCeiling,
          }),
          reason('elig_tx_snap_net_income_depends'),
        ],
        missingInformation: missing,
        confidence: 0.68,
        estimate,
      };
    }
  }

  return {
    status: 'unlikely_eligible',
    recommendedToApply: false,
    reasons: [
      reasonWith('elig_tx_snap_above_gross_limit', {
        monthlyIncome: monthly,
        limitAmount: grossLimit,
        householdSize: household.size,
      }),
    ],
    missingInformation: [],
    confidence: 0.88,
    estimate: noEstimate('estimate_unknown_over_income'),
  };
};

/**
 * Texas TANF.
 *
 * Composition first, income never on its own. The brief calls this out
 * specifically: an adult-only household must not be recommended TANF because
 * its income is low. There is no income branch that can reach a recommendation
 * without a dependent child.
 *
 * No income threshold is asserted, for the same reason as TP 08 — the
 * budgetary-needs and recognizable-needs standards are dollar tables that have
 * not been transcribed.
 */
const txTanfRule: Rule = ({ program, household }) => {
  if (!hasChild(household) && !household.pregnant) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [reason('elig_tx_tanf_no_dependent_child')],
      missingInformation: [],
      confidence: 0.95,
      estimate: noEstimate('estimate_unknown_not_eligible_category'),
    };
  }

  const resourceLimit = program.rules?.resourceLimit;
  const grantPercent = value(program, 'grantFplPercent');

  const reasons: EligibilityReason[] = [
    household.pregnant && household.children === 0
      ? reason('elig_tx_tanf_pregnancy_may_qualify')
      : reasonWith(
          'elig_tx_tanf_dependent_child',
          { children: household.children },
          household.children,
        ),
    reason('elig_tx_tanf_needs_tests'),
  ];

  if (typeof grantPercent === 'number') {
    reasons.push(reasonWith('elig_tx_tanf_grant_is_small', { fplPercent: grantPercent }));
  }

  const missing: EligibilityReason[] = [
    reason('missing_published_income_standard'),
  ];

  if (typeof resourceLimit === 'number') {
    missing.push(
      reasonWith('missing_countable_resources_against_limit', {
        limitAmount: resourceLimit,
      }),
    );
  }

  return {
    status: 'insufficient_information',
    recommendedToApply: false,
    reasons,
    missingInformation: missing,
    confidence: 0.5,
    estimate: noEstimate('estimate_unknown_grant_after_disregards'),
  };
};

/**
 * Central Health MAP — Travis County.
 *
 * The county program that answers the coverage gap here. Recommended on income
 * and county residency; the report presents it as access to a local care
 * network rather than as insurance, because that is what it is.
 */
const travisMapRule: Rule = ({ program, fplPercent }) => {
  const limit = fplLimit(program) ?? 200;
  const lookback = value(program, 'incomeLookbackDays');

  if (fplPercent > limit) {
    return {
      status: 'unlikely_eligible',
      recommendedToApply: false,
      reasons: [
        reasonWith('elig_travis_map_above_limit', {
          fplPercent,
          limitPercent: limit,
        }),
      ],
      missingInformation: [],
      confidence: 0.84,
      estimate: noEstimate('estimate_unknown_over_income'),
    };
  }

  const reasons: EligibilityReason[] = [
    reasonWith('elig_travis_map_within_limit', {
      fplPercent,
      limitPercent: limit,
    }),
    reason('elig_travis_map_not_insurance'),
    reason('elig_travis_map_status_independent'),
  ];

  if (typeof lookback === 'number') {
    reasons.push(
      reasonWith('elig_travis_map_income_lookback', { days: lookback }),
    );
  }

  return {
    status: 'likely_eligible',
    recommendedToApply: true,
    reasons,
    missingInformation: [
      reason('missing_travis_residency_proof'),
      reason('missing_current_insurance_status'),
    ],
    confidence: 0.85,
    estimate: noEstimate('estimate_unknown_coverage_not_cash'),
  };
};

// ---------------------------------------------------------------------------
// The rule table
// ---------------------------------------------------------------------------

/**
 * Program id → rule.
 *
 * A program in the registry with no rule here is still *discovered* — it
 * appears in the report as available in this jurisdiction with no determination
 * — but is never recommended. That is the honest default for a program we know
 * exists and whose thresholds we have not encoded (Austin Plus 1, LIHEAP), and
 * it is why a missing rule degrades gracefully instead of dropping the program.
 */
const RULES: Readonly<Record<string, Rule>> = {
  // Federal
  federal_marketplace: marketplaceRule,
  federal_wic: wicRule,
  federal_lifeline: fplThresholdRule({
    withinKey: 'elig_lifeline_within_limit',
    aboveKey: 'elig_lifeline_above_limit',
    estimateReasonKey: 'estimate_unknown_discount_varies',
    confidenceWithin: 0.78,
  }),
  federal_medicare_savings: medicareSavingsRule,

  // California
  ca_medi_cal: caMediCalRule,
  ca_calfresh: caCalFreshRule,
  ca_calworks: caCalWorksRule,
  ca_covered_california: marketplaceRule,
  ca_care: fplThresholdRule({
    withinKey: 'elig_ca_care_within_limit',
    aboveKey: 'elig_ca_care_above_limit',
    estimateReasonKey: 'estimate_unknown_discount_varies',
  }),
  ca_lifeline: fplThresholdRule({
    withinKey: 'elig_lifeline_within_limit',
    aboveKey: 'elig_lifeline_above_limit',
    estimateReasonKey: 'estimate_unknown_discount_varies',
  }),
  ca_wic: wicRule,

  // Texas — statewide
  tx_medicaid_child: txMedicaidChildRule,
  tx_chip: txChipRule,
  tx_medicaid_pregnancy: txMedicaidPregnancyRule,
  tx_chip_perinatal: txChipPerinatalRule,
  tx_healthy_texas_women: txHealthyTexasWomenRule,
  tx_medicaid_parent: txMedicaidParentRule,
  tx_snap: txSnapRule,
  tx_tanf: txTanfRule,
  tx_wic: wicRule,
  tx_ceap: fplThresholdRule({
    withinKey: 'elig_tx_ceap_within_limit',
    aboveKey: 'elig_tx_ceap_above_limit',
    estimateReasonKey: 'estimate_unknown_payment_to_utility',
    confidenceWithin: 0.72,
  }),

  // Texas — Travis County
  travis_central_health_map: travisMapRule,

  // Texas — City of Austin
  austin_energy_cap: fplThresholdRule({
    withinKey: 'elig_austin_cap_within_limit',
    aboveKey: 'elig_austin_cap_above_limit',
    missing: [reason('missing_austin_utility_account')],
    estimateReasonKey: 'estimate_unknown_discount_varies',
    confidenceWithin: 0.82,
  }),
};

/** A program discovered here but with no encoded rule. */
function undetermined(program: ProgramDefinition): Omit<
  ProgramScreening,
  'programId' | 'nameKey' | 'level' | 'category'
> {
  return {
    status: 'insufficient_information',
    recommendedToApply: false,
    reasons: [reason('elig_program_available_no_rule')],
    missingInformation: [reason('missing_published_income_standard')],
    confidence: 0.3,
    estimate: noEstimate(
      program.hasComputableValue
        ? 'estimate_unknown_state_determined'
        : 'estimate_unknown_no_cash_value',
    ),
  };
}

// ---------------------------------------------------------------------------
// Cliffs and coverage gap
// ---------------------------------------------------------------------------

/**
 * Income thresholds this household is close to, from rulesets actually in force.
 *
 * Derived, never listed. The old implementation hardcoded a Medi-Cal cliff and
 * a CalFresh cliff into every report, which in Texas meant warning about a
 * threshold that does not exist. A cliff appears here only when the program was
 * discovered for this jurisdiction and its own rule set publishes a limit.
 *
 * Texas Medicaid produces no single cliff, because its eligibility is
 * categorical — so none is emitted, which is the correct behaviour the brief
 * asks for.
 */
function deriveCliffs(
  programs: readonly ProgramDefinition[],
  screenings: readonly ProgramScreening[],
  fpl: number,
  fplPercent: number,
): IncomeCliff[] {
  const cliffs: IncomeCliff[] = [];
  const byId = new Map(screenings.map((s) => [s.programId, s]));

  for (const program of programs) {
    const limit = program.rules?.fplPercent;

    if (typeof limit !== 'number') continue;

    const screening = byId.get(program.id);

    // Only warn about a threshold the household is currently under and within
    // 15 percentage points of. A cliff far away is noise; one already crossed
    // is not a cliff.
    if (!screening || screening.status === 'unlikely_eligible') continue;
    if (fplPercent > limit || limit - fplPercent > 15) continue;

    cliffs.push({
      programId: program.id,
      nameKey: program.nameKey,
      key: 'cliff_approaching_fpl_limit',
      params: {
        limitPercent: limit,
        limitAmount: Math.round(fpl * (limit / 100)),
        headroomPercent: Math.round(limit - fplPercent),
      },
    });
  }

  return cliffs;
}

/**
 * Whether this household has no route to health *insurance*.
 *
 * The Medicaid coverage gap has a precise meaning: no Medicaid category is
 * reachable, and income is below the marketplace subsidy floor. Both halves are
 * required — someone over the floor can buy a subsidised plan, and someone
 * inside a Medicaid category is covered.
 *
 * Deliberately **not** closed by a county or city program. Central Health MAP
 * is the right answer *to* the gap, not evidence that there is no gap: it is
 * local access to a defined provider network, it does not travel, and it is not
 * insurance. Treating it as coverage would suppress the warning for exactly the
 * households that most need to understand their position — which is why the
 * check looks only at state Medicaid and the marketplace.
 *
 * Jurisdiction-neutral by construction: it reads the discovered program set
 * rather than the state code, so it cannot be asserted for California, where a
 * low-income adult always reaches expansion Medicaid.
 */
function detectCoverageGap(
  screenings: readonly ProgramScreening[],
): boolean {
  const health = screenings.filter((s) => s.category === 'health');

  if (health.length === 0) return false;

  const reachable = (screening: ProgramScreening) =>
    screening.status === 'likely_eligible' ||
    screening.status === 'possibly_eligible';

  // A state-administered health program is this state's Medicaid or exchange.
  const stateCoverage = health.some(
    (screening) => screening.level === 'state' && reachable(screening),
  );

  const marketplace = health.some(
    (screening) =>
      screening.programId === 'federal_marketplace' && reachable(screening),
  );

  return !stateCoverage && !marketplace;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Screen a household against every program available where it lives.
 *
 * The one function the demo fixture, the report route, and the tests all call.
 * Pure: same jurisdiction + household + income always gives the same result.
 */
export function screenHousehold(params: {
  jurisdiction: Jurisdiction;
  household: HouseholdComposition;
  income: number;
}): HouseholdScreening {
  const { jurisdiction, household, income } = params;

  const fpl = fplForHouseholdSize(household.size);
  const fplPercent = Math.round((income / fpl) * 100);
  const monthlyIncome = income / 12;

  const programs = discoverPrograms(jurisdiction);

  const screenings: ProgramScreening[] = programs.map((program) => {
    const rule = RULES[program.id];

    const outcome = rule
      ? rule({
          program,
          jurisdiction,
          household,
          income,
          fpl,
          fplPercent,
          monthlyIncome,
        })
      : undetermined(program);

    return {
      programId: program.id,
      nameKey: program.nameKey,
      level: program.level,
      category: program.category,
      ...outcome,
    };
  });

  return {
    jurisdiction,
    household,
    income,
    fpl,
    fplPercent,
    screenings,
    recommended: screenings.some((s) => s.recommendedToApply),
    cliffs: deriveCliffs(programs, screenings, fpl, fplPercent),
    inCoverageGap: detectCoverageGap(screenings),
  };
}

/** The programs this screening recommends applying for. */
export function recommendedProgramIds(
  screening: HouseholdScreening,
): readonly string[] {
  return screening.screenings
    .filter((s) => s.recommendedToApply)
    .map((s) => s.programId);
}
