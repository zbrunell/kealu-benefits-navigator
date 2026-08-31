//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What a benefit program is, and where it is valid.
 *
 * The central claim of this module: **a program declares its own jurisdiction,
 * and discovery is a filter, not a judgment.** Before this existed, "which
 * programs apply to this household" was answered by a hardcoded list in the
 * demo fixture and by prose in an LLM prompt. Neither could be asked whether
 * Medi-Cal is available in Austin, because neither held that fact — the answer
 * lived in the program's *name*, and only a reader who knew that "Medi-Cal"
 * sounds Californian could recover it.
 *
 * So every program carries `level` plus the geography that level implies, and
 * `appliesTo()` is a total function over (program, jurisdiction). A Texas
 * household cannot be offered Medi-Cal because the filter runs before any
 * eligibility reasoning and does not consult the program's name at all.
 *
 * Provenance is not decoration. Every threshold this project encodes carries
 * the URL it came from and the date it took effect, because benefit thresholds
 * change annually and a number without a date is indistinguishable from a
 * number someone made up. `EligibilityRuleSet` is where that lives, and the
 * screening reads its values rather than embedding literals.
 */

import {
  cityKey,
  countyKey,
  isResolvedTo,
  type Jurisdiction,
  type JurisdictionLevel,
} from '@/lib/jurisdiction';

/**
 * What a program is *for*, independent of who administers it.
 *
 * Shared across states on purpose: this is the axis a household thinks along
 * ("I need help with food"), and it is what lets the report group Texas SNAP
 * and CalFresh under one heading without pretending they are one program.
 */
export const PROGRAM_CATEGORIES = [
  'health',
  'food',
  'cash',
  'utilities',
  'housing',
  'childcare',
] as const;

export type ProgramCategory = (typeof PROGRAM_CATEGORIES)[number];

/**
 * How an applicant reaches a program.
 *
 * `portal` — an online application system we can link to directly.
 * `phone`, `in_person`, `mail` — the agency's other channels.
 *
 * Distinct from `ApplicationDelivery` in state-applications.ts, which is about
 * whether *we* fill a form. This is about how the agency accepts one.
 */
export type ProgramChannel = 'portal' | 'phone' | 'in_person' | 'mail';

/**
 * Where a policy value came from and when it took effect.
 *
 * Attached to rule sets rather than to programs, because a program outlives any
 * particular year's thresholds. When the FY2027 SNAP figures land, a new
 * `EligibilityRuleSet` replaces the old one and the program definition does not
 * move.
 */
export interface PolicySource {
  /** The authoritative page or document the values were read from. */
  url: string;
  /** How the publisher identifies this edition, verbatim (e.g. "Revision 25-4"). */
  revision?: string;
  /** ISO date the values took effect. */
  effectiveFrom: string;
  /** ISO date the values stop applying, when the publisher states one. */
  effectiveUntil?: string;
  /**
   * True when a human with program expertise has confirmed these figures.
   *
   * Defaults to false and is *reported*, not hidden — see
   * `unverifiedRuleSets()`. A false value does not stop the screening from
   * using the number; it stops us from claiming the number is checked.
   */
  verified?: boolean;
  /** What still needs confirming, when `verified` is false. */
  verificationNote?: string;
}

/**
 * A versioned set of eligibility values for one program.
 *
 * Deliberately loose about *which* values: an income-percentage test, a set of
 * categorical gateways, and a resource limit are not the same shape, and
 * forcing them into one schema is how a Medicaid expansion rule ends up applied
 * to a state that never expanded. The screening function for a program knows
 * which fields it needs; this type guarantees only that whatever it reads is
 * dated and sourced.
 */
export interface EligibilityRuleSet {
  /** The program id these values belong to. */
  program: string;
  source: PolicySource;
  /**
   * Income limit as a percentage of the Federal Poverty Level, when the program
   * has a single FPL test. Absent for programs whose test is not an FPL
   * percentage — Texas Medicaid for parents, for instance, whose limit derives
   * from a 1996 AFDC standard.
   */
  fplPercent?: number;
  /** Monthly gross income limits by household size, when published as a table. */
  monthlyGrossByHouseholdSize?: readonly number[];
  /** Monthly net income limits by household size, when published as a table. */
  monthlyNetByHouseholdSize?: readonly number[];
  /**
   * Monthly income limits for a broad-based categorical-eligibility test.
   *
   * Separate from the gross table because it is a genuinely different test with
   * its own published figures, not a multiple of the gross limit. Texas grants
   * SNAP categorical eligibility at 165% FPL; a household above the 130% gross
   * screen but below this is still eligible, and collapsing the two tables
   * would turn that into a denial.
   */
  monthlyCategoricalByHouseholdSize?: readonly number[];
  /** Added per household member beyond the published gross table. */
  monthlyIncrementPerPerson?: number;
  /** Countable-resource limit in dollars, when the program has one. */
  resourceLimit?: number;
  /** Free-form additional published values this program's rule needs. */
  values?: Readonly<Record<string, number>>;
}

/**
 * A benefit program, with the geography that decides where it is offered.
 *
 * The geography fields are read according to `level` and are otherwise
 * meaningless — a `state`-level program's `county` is not consulted. They are
 * separate fields rather than a discriminated union because the flat shape is
 * what the data files read like a table, and a table is what a program registry
 * should be.
 */
export interface ProgramDefinition {
  /**
   * Stable id, prefixed by its jurisdiction.
   *
   * Prefixed because the programs are genuinely different things: `tx_snap` and
   * `ca_calfresh` are both SNAP, administered separately with different tests.
   * An unprefixed `snap` would invite exactly the "one program, many states"
   * assumption this module exists to prevent.
   */
  id: string;
  /** Catalog key for the program's name, as the administering agency calls it. */
  nameKey: string;
  level: JurisdictionLevel;
  category: ProgramCategory;
  /** ISO country. Always "US" today. */
  country: string;
  /** Two-letter state code. Required for state/county/city programs, "" for federal. */
  state?: string;
  /** County name without suffix. Required for county programs. */
  county?: string;
  /**
   * Cities this program covers, for a `city`-level program.
   *
   * A list rather than a single city because a municipal utility's service area
   * routinely covers more than the city proper.
   */
  cities?: readonly string[];
  /**
   * States a `federal` program is *not* available in.
   *
   * Federal programs are near-universal but not quite: the ACA marketplace runs
   * through HealthCare.gov in Texas and through a state exchange in California,
   * so the federal marketplace program excludes the state-exchange states rather
   * than pretending HealthCare.gov serves them.
   */
  excludedStates?: readonly string[];
  /** The agency that administers it, as it names itself. Never translated. */
  agency: string;
  /** Where to apply. */
  officialUrl: string;
  /** Channels the agency offers, most-recommended first. */
  channels: readonly ProgramChannel[];
  /** Published phone number, when the agency lists one. */
  phone?: string;
  /** Versioned, sourced eligibility values. */
  rules?: EligibilityRuleSet;
  /**
   * Catalog key describing what the program does, for the report.
   *
   * A key rather than a sentence so the description is translatable, the same
   * discipline eligibility-reasons.ts applies to explanations.
   */
  summaryKey: string;
  /**
   * Whether a benefit amount can be computed from a published formula.
   *
   * False means the report says "unknown until official determination" rather
   * than inventing a figure. This is a per-program fact — SNAP has a published
   * allotment formula, Medicaid has no per-household dollar value at all — and
   * making it explicit is what stopped the fabricated "Medi-Cal = $840/month".
   */
  hasComputableValue: boolean;
}

/**
 * Whether a program is offered where this household lives.
 *
 * The hard filter. Runs before any eligibility reasoning, consults only
 * declared geography, and is the only function permitted to answer this
 * question.
 *
 * An unresolved level fails closed: a household whose county never resolved
 * matches no county program. That is a real loss of coverage for the applicant,
 * and it is still the right answer — offering a Travis County program to
 * someone who might live in Williamson County sends them to an office that will
 * turn them away.
 */
export function appliesTo(
  program: ProgramDefinition,
  jurisdiction: Jurisdiction,
): boolean {
  if (program.country !== jurisdiction.country) return false;

  switch (program.level) {
    case 'federal': {
      const excluded = program.excludedStates ?? [];

      /*
       * An excluded state only excludes once the state is known. An unresolved
       * state keeps the federal program: federal entitlements are the one thing
       * we can offer a household whose ZIP told us nothing.
       */
      if (jurisdiction.state && excluded.includes(jurisdiction.state)) {
        return false;
      }

      return true;
    }

    case 'state':
      return (
        isResolvedTo(jurisdiction, 'state') && program.state === jurisdiction.state
      );

    case 'county':
      return (
        isResolvedTo(jurisdiction, 'county') &&
        program.state === jurisdiction.state &&
        countyKey(program.county) === countyKey(jurisdiction.county)
      );

    case 'city': {
      if (!isResolvedTo(jurisdiction, 'city')) return false;
      if (program.state !== jurisdiction.state) return false;

      /*
       * County is checked when the program declares one, so a city program is
       * not offered to a same-named city in another county. Texas has more than
       * one Manor.
       */
      if (
        program.county &&
        countyKey(program.county) !== countyKey(jurisdiction.county)
      ) {
        return false;
      }

      const cities = (program.cities ?? []).map(cityKey);

      return cities.includes(cityKey(jurisdiction.city));
    }
  }
}

/**
 * The state a program belongs to, or "" for a federal one.
 *
 * Used by the leak invariant, which needs to answer "is this a California-only
 * program?" without knowing anything about the program but its declaration.
 */
export function programState(program: ProgramDefinition): string {
  return program.level === 'federal' ? '' : (program.state ?? '');
}
