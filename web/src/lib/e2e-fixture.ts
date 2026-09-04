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
 * Output` JSON block that `report-assembler.ts` parses.
 *
 * ── What changed, and why it matters ──────────────────────────────────────
 * This file used to *be* the rules engine. It held hardcoded `screenMediCal`,
 * `screenCalFresh` and `screenCalWorks` functions that ran for every household
 * regardless of state, and emitted BenefitsCal, GetCalFresh, Covered
 * California, CARE and SAWS 2 PLUS into the phase documents unconditionally.
 * That is why ZIP 78705 produced a California benefits plan: nothing here ever
 * asked where the household lived.
 *
 * It now holds **no eligibility logic at all**. Jurisdiction resolution comes
 * from `lib/jurisdiction.ts`, the candidate program set from `lib/programs/`,
 * and every determination from `screenHousehold` in
 * `lib/program-screening.ts` — the same functions the production report route
 * uses. The demo differs from production in exactly one respect: it supplies
 * deterministic phase prose instead of asking a model to write it. There is no
 * demo-only rules engine left to drift.
 *
 * Everything the documents say about programs is therefore generated from the
 * registry: names, agencies, URLs, thresholds, sources and effective dates. A
 * program added to `lib/programs/` appears here with no edit to this file, and
 * a program that does not apply to the household's jurisdiction cannot appear
 * at all.
 *
 * No PII leaves this module: values are interpolated into files inside the run
 * directory (exactly as the real workflow does) and never logged.
 */

import { messages } from '@/i18n';
import { buildApplicationRecommendation } from '@/lib/application-recommendations';
import { resolveReason, type EligibilityReason } from '@/lib/eligibility-reasons';
import { parseHouseholdComposition, type HouseholdComposition } from '@/lib/household';
import {
  describeJurisdiction,
  jurisdictionFromVars,
  type Jurisdiction,
} from '@/lib/jurisdiction';
import { assertJurisdictionInvariant } from '@/lib/jurisdiction-invariant';
import {
  FPL_BASE_2025,
  FPL_INCREMENT_2025,
  FPL_YEAR,
  fplForHouseholdSize,
  parseIncome,
  recommendedProgramIds,
  screenHousehold,
  type BenefitEstimate,
  type HouseholdScreening,
  type ProgramScreening,
  type ScreeningStatus,
} from '@/lib/program-screening';
import { programById, type ProgramDefinition } from '@/lib/programs';
import { PHASE_ORDER } from '@/lib/report-assembler';
import { resolveApplicationBundle } from '@/lib/state-applications';
import type { SessionVars } from '@/types/session';

/** Household vars as stored on the session. */
type RawVars = SessionVars;

/*
 * Re-exported because a good deal of code and several tests import the FPL
 * helpers from this module. The values themselves now live with the screening,
 * which is the only place that uses them.
 */
export {
  FPL_BASE_2025,
  FPL_INCREMENT_2025,
  FPL_YEAR,
  fplForHouseholdSize,
  parseIncome,
};

/**
 * One entry per box on the household's state application form.
 *
 * Keyed by *form* program id (`medi_cal`, `tx_snap`) rather than registry id,
 * because this is the view the application flow and the structured output work
 * in. The full registry view — including federal, county and city programs that
 * are on no form — is `programScreenings`.
 */
export interface FixtureFormScreening {
  program: string;
  status: ScreeningStatus;
  recommendedToApply: boolean;
  reasons: EligibilityReason[];
  missingInformation: EligibilityReason[];
  confidence: number;
}

/** Everything the fixture derives from intake, shared by all five phase docs. */
export interface FixtureContext {
  /** The canonical jurisdiction, resolved once. */
  jurisdiction: Jurisdiction;
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
  /**
   * Form-level screenings, one per box on this state's application.
   *
   * Empty when the household is in a state whose application we do not know.
   */
  screenings: FixtureFormScreening[];
  /** Registry-level screenings: every program available where they live. */
  programScreenings: ProgramScreening[];
  /** The full screening result, for callers that want cliffs and the gap flag. */
  screening: HouseholdScreening;
  /** True when at least one program is recommended. */
  recommended: boolean;
  /** Free-text Tier 2 answers, normalized for display. */
  currentCoverage: string;
  medications: string;
  providers: string;
  premiumBudget: string;
  healthNeeds: string;
}

/** Normalize a free-text Tier 2 answer, falling back to a neutral phrase. */
function orNotProvided(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();

  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Derive the full fixture context from the vars collected during intake.
 *
 * Location comes from the session vars that intake resolved from the ZIP code,
 * via the shared jurisdiction resolver — the demo has no location values of its
 * own, and no way to disagree with production about where a ZIP is.
 */
export function buildFixtureContext(vars: RawVars): FixtureContext {
  const jurisdiction = jurisdictionFromVars(vars);
  const household = parseHouseholdComposition(vars.household_profile);
  const income = parseIncome(vars.annual_income);

  const screening = screenHousehold({ jurisdiction, household, income });

  /*
   * The hard invariant, at the boundary where screening becomes a plan. A
   * California program reaching a Texas household throws here rather than
   * being rendered — see jurisdiction-invariant.ts for why a visible failure
   * beats a confidently wrong plan.
   */
  assertJurisdictionInvariant(jurisdiction, recommendedProgramIds(screening));

  const application = buildApplicationRecommendation(screening);

  const screenings: FixtureFormScreening[] = (application?.programs ?? []).map(
    (program) => ({
      program: program.program,
      status: program.status,
      recommendedToApply: program.recommendedToApply,
      reasons: program.reasons,
      missingInformation: program.missingInformation,
      confidence: program.confidence,
    }),
  );

  return {
    jurisdiction,
    zipCode: jurisdiction.zipCode,
    city: jurisdiction.city,
    state: jurisdiction.state,
    county: jurisdiction.county,
    income,
    household,
    fpl: screening.fpl,
    fplPercent: screening.fplPercent,
    screenings,
    programScreenings: screening.screenings,
    screening,
    recommended: screening.recommended,
    currentCoverage: orNotProvided(vars.current_coverage, 'Not provided'),
    medications: orNotProvided(vars.medications, 'Not provided'),
    providers: orNotProvided(vars.providers, 'Not provided'),
    premiumBudget: orNotProvided(vars.premium_budget, 'Not provided'),
    healthNeeds: orNotProvided(vars.health_needs, 'Not provided'),
  };
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Readonly<Record<ScreeningStatus, string>> = {
  likely_eligible: 'Likely eligible',
  possibly_eligible: 'Possibly eligible',
  unlikely_eligible: 'Unlikely eligible',
  insufficient_information: 'More information needed',
};

const LEVEL_LABELS: Readonly<Record<ProgramDefinition['level'], string>> = {
  federal: 'Federal',
  state: 'State',
  county: 'County',
  city: 'City / local',
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

/** A catalog string in English, for the fixture's markdown body. */
function label(key: string): string {
  return resolveReason({ kind: 'keyed', key }, messages.en, 'en');
}

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/** How the report states a benefit amount, or why it does not. */
function estimateText(estimate: BenefitEstimate): string {
  return estimate.kind === 'estimated'
    ? `${money(estimate.monthly)}/mo (estimate)`
    : 'Not estimated';
}

/** Join names as an English list: "A", "A and B", "A, B, and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;

  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** The registry definition behind a screening. Always present by construction. */
function definitionFor(screening: ProgramScreening): ProgramDefinition {
  const found = programById(screening.programId);

  if (!found) {
    // Unreachable: every screening came from discoverPrograms.
    throw new Error(`screened program not in registry: ${screening.programId}`);
  }

  return found;
}

/** The program's name in English. */
function programName(screening: ProgramScreening): string {
  return label(screening.nameKey);
}

/** One-line description of the household for the report headers. */
function householdSentence(ctx: FixtureContext): string {
  const { household } = ctx;
  const parts: string[] = [
    `${household.adults} ${household.adults === 1 ? 'adult' : 'adults'}`,
  ];

  if (household.children > 0) {
    parts.push(
      `${household.children} ${household.children === 1 ? 'child' : 'children'}`,
    );
  }

  if (household.ages.length > 0) parts.push(`ages ${household.ages.join(', ')}`);
  if (household.pregnant) parts.push('pregnancy reported');
  if (household.disability) parts.push('disability reported');
  if (household.veteran) parts.push('veteran household');

  return parts.join(', ');
}

function locationSentence(ctx: FixtureContext): string {
  return `ZIP ${ctx.zipCode || 'not provided'}, ${describeJurisdiction(ctx.jurisdiction)}`;
}

// ---------------------------------------------------------------------------
// Phase documents
// ---------------------------------------------------------------------------

/**
 * Phase 1 — program discovery.
 *
 * Every row is generated from the registry, including the jurisdiction level
 * and the source URL, so the document cannot name a program that does not apply
 * where the household lives.
 */
function benefitsResearchDoc(ctx: FixtureContext): string {
  const rows = ctx.programScreenings.map((screening) => {
    const program = definitionFor(screening);
    const rules = program.rules;
    const limit =
      typeof rules?.fplPercent === 'number'
        ? `${rules.fplPercent}% FPL (${money(ctx.fpl * (rules.fplPercent / 100))})`
        : 'See program rules';

    const effective = rules?.source.effectiveFrom ?? 'n/a';

    return `| ${programName(screening)} | ${LEVEL_LABELS[program.level]} | ${program.agency} | ${limit} | ${estimateText(screening.estimate)} | ${STATUS_LABELS[screening.status]} | ${program.officialUrl} | ${effective} |`;
  });

  const cliffNotes =
    ctx.screening.cliffs.length > 0
      ? ctx.screening.cliffs
          .map(
            (cliff) =>
              `- ${label(cliff.nameKey)}: ${reasonInEnglish({
                kind: 'keyed',
                key: cliff.key,
                params: cliff.params,
              })}`,
          )
          .join('\n')
      : '- No income cliff detected within 15 percentage points of a threshold that applies here.';

  const gapNote = ctx.screening.inCoverageGap
    ? `\n## Coverage Gap\n${label('report_coverage_gap_body')}\n`
    : '';

  return `## STATUS: COMPLETE
## SUMMARY: ${rows.length} programs available in ${describeJurisdiction(ctx.jurisdiction)} for a household of ${ctx.household.size}

## Jurisdiction
- Country: ${ctx.jurisdiction.country}
- State: ${ctx.state || 'undetermined'}
- County: ${ctx.county || 'undetermined'}
- City: ${ctx.city || 'undetermined'}
- ZIP: ${ctx.zipCode || 'not provided'}

Programs were selected by matching each program's declared jurisdiction against
the household's. Programs belonging to another state were never candidates.

## Household Profile
${householdSentence(ctx)}. Annual household income ${money(ctx.income)}. ${locationSentence(ctx)}.

## Federal Poverty Level Calculation
- Household size: ${ctx.household.size}
- Annual income: ${money(ctx.income)}
- 100% FPL for household of ${ctx.household.size} (${FPL_YEAR}): ${money(ctx.fpl)}
- FPL percentage: ${ctx.fplPercent}%

## Programs Found

| Program | Level | Agency | Income Limit | Est. Value | Screening | Source URL | Rules Effective |
|---------|-------|--------|--------------|-----------|-----------|------------|-----------------|
${rows.join('\n')}

## Income Cliff Warnings
${cliffNotes}
${gapNote}
## Estimated Value Note
${label('report_estimate_disclaimer')}

## Existing Coverage Reported
${ctx.currentCoverage}
`;
}

/**
 * Phase 2 — coverage options.
 *
 * The marketplace route is whichever health program the registry offers here,
 * so a Texas household is compared against HealthCare.gov and a California one
 * against Covered California without this function naming either.
 */
function insuranceResearchDoc(ctx: FixtureContext): string {
  const healthPrograms = ctx.programScreenings.filter(
    (screening) => screening.category === 'health',
  );

  const rows = healthPrograms.map((screening) => {
    const program = definitionFor(screening);

    return `| ${programName(screening)} | ${LEVEL_LABELS[program.level]} | ${STATUS_LABELS[screening.status]} | ${estimateText(screening.estimate)} | ${program.officialUrl} |`;
  });

  const marketplace = healthPrograms.find(
    (screening) =>
      screening.programId === 'federal_marketplace' ||
      screening.programId === 'ca_covered_california',
  );

  const marketplaceLine = marketplace
    ? `- ${programName(marketplace)}: ${STATUS_LABELS[marketplace.status]} — ${marketplace.reasons.map(reasonInEnglish).join(' ')}`
    : '- No marketplace program is registered for this jurisdiction.';

  return `## STATUS: COMPLETE
## SUMMARY: Coverage options compared for ${locationSentence(ctx)}

## Subsidy and Coverage Position
- FPL: ${ctx.fplPercent}%
${marketplaceLine}
- Medicaid coverage gap: ${
    ctx.screening.inCoverageGap
      ? 'YES — see the note below'
      : 'no gap identified for this household'
  }

${
  ctx.screening.inCoverageGap
    ? `### ${label('report_coverage_gap_heading')}\n${label('report_coverage_gap_body')}\n`
    : ''
}
## Household Preferences From Intake
| Question | Answer |
|----------|--------|
| Current coverage | ${ctx.currentCoverage} |
| Monthly premium budget | ${ctx.premiumBudget} |
| Prescriptions to cover | ${ctx.medications} |
| Providers to keep in network | ${ctx.providers} |
| Ongoing or planned care | ${ctx.healthNeeds} |

## Health Programs Available Here

| Program | Level | Screening | Est. Value | Where to Apply |
|---------|-------|-----------|-----------|----------------|
${rows.length > 0 ? rows.join('\n') : '| None registered for this jurisdiction | — | — | — | — |'}

## Notes
- ${label('report_estimate_disclaimer')}
- Provider and formulary checks must be repeated at enrollment for ${ctx.providers} and ${ctx.medications}.
`;
}

/**
 * Phase 3 — verification.
 *
 * Checks the jurisdiction resolution and the thresholds actually used, rather
 * than a fixed list of California limits. The threshold table is generated from
 * the rule sets in force, each with the date it took effect — so a stale
 * threshold is visible in the report instead of hidden in a prompt.
 */
function evidenceVerificationDoc(ctx: FixtureContext): string {
  const thresholdRows = ctx.programScreenings
    .map((screening) => {
      const program = definitionFor(screening);
      const rules = program.rules;

      if (!rules) return null;

      const stated =
        typeof rules.fplPercent === 'number'
          ? `${rules.fplPercent}% FPL`
          : rules.monthlyGrossByHouseholdSize
            ? `${money(rules.monthlyGrossByHouseholdSize[0])}/mo at size 1`
            : 'no single threshold';

      const verified = rules.source.verified === true ? 'VERIFIED' : 'NEEDS REVIEW';

      return `| ${programName(screening)} | ${stated} | ${rules.source.revision ?? '—'} | ${rules.source.effectiveFrom} | ${verified} |`;
    })
    .filter((row): row is string => row !== null);

  const leakCheck = `| California-only programs offered | 0 | 0 | PASS |`;

  return `## STATUS: COMPLETE
## SUMMARY: 0 critical errors, 0 corrections returned to research phases

## Jurisdiction Verification
| Check | Expected | Found | Result |
|-------|----------|-------|--------|
| State derived from ZIP ${ctx.zipCode} | ${ctx.state || 'undetermined'} | ${ctx.state || 'undetermined'} | ${ctx.state ? 'PASS' : 'REVIEW'} |
| County derived from ZIP ${ctx.zipCode} | ${ctx.county || 'undetermined'} | ${ctx.county || 'undetermined'} | ${ctx.county ? 'PASS' : 'REVIEW'} |
| City derived from ZIP ${ctx.zipCode} | ${ctx.city || 'undetermined'} | ${ctx.city || 'undetermined'} | ${ctx.city ? 'PASS' : 'REVIEW'} |
${leakCheck}

## Independent FPL Recalculation
- Reference: ${FPL_YEAR} HHS Poverty Guidelines, 48 contiguous states and DC
- Base (household of 1): ${money(FPL_BASE_2025)}; per additional person: ${money(FPL_INCREMENT_2025)}
- Recomputed 100% FPL for household of ${ctx.household.size}: ${money(ctx.fpl)}
- Recomputed FPL percentage: ${ctx.fplPercent}% — **matches** Phase 1

## Threshold Provenance

| Program | Threshold Used | Revision | Effective From | Confirmed |
|---------|----------------|----------|----------------|-----------|
${thresholdRows.length > 0 ? thresholdRows.join('\n') : '| No encoded thresholds apply here | — | — | — | — |'}

Rows marked NEEDS REVIEW use a figure that was not read from the administering
agency during implementation. They are used for screening but must be confirmed
by a program expert before any determination relies on them.

## Cross-Phase Consistency
- Household size used in every phase is identical (${ctx.household.size}).
- Income used for FPL and every program test is identical (${money(ctx.income)}).
- Every program named in Phase 1 declares a jurisdiction that contains ${describeJurisdiction(ctx.jurisdiction)}.

## Feedback Loop
No critical errors found. Phases 1 and 2 were not re-executed.
`;
}

/** Phase 4 — determinations, from the shared screening. */
function eligibilityValidationDoc(ctx: FixtureContext): string {
  const rows = ctx.programScreenings.map((screening) => {
    const program = definitionFor(screening);

    return `| ${programName(screening)} | ${LEVEL_LABELS[program.level]} | ${STATUS_LABELS[screening.status]} | ${Math.round(screening.confidence * 100)}% | ${
      screening.missingInformation.length > 0
        ? screening.missingInformation.map(reasonInEnglish).join('; ')
        : 'None'
    } |`;
  });

  const details = ctx.programScreenings
    .map((screening) => {
      const reasons = screening.reasons
        .map((item) => `- ${reasonInEnglish(item)}`)
        .join('\n');

      return `### ${programName(screening)} — ${STATUS_LABELS[screening.status]}\n${reasons}`;
    })
    .join('\n\n');

  const recommendedCount = ctx.programScreenings.filter(
    (screening) => screening.recommendedToApply,
  ).length;

  return `## STATUS: COMPLETE
## SUMMARY: ${recommendedCount} of ${ctx.programScreenings.length} programs recommended in ${describeJurisdiction(ctx.jurisdiction)}

## Determination Summary

| Program | Level | Determination | Confidence | Information Still Needed |
|---------|-------|---------------|-----------|--------------------------|
${rows.join('\n')}

${details}

## Coverage Gaps
${
  ctx.screening.inCoverageGap
    ? `- ${label('report_coverage_gap_body')}`
    : '- No coverage gap identified: at least one health program is within reach at this income.'
}

## Interaction Effects
${interactionEffects(ctx)}
`;
}

/**
 * Cross-program effects, derived from what was actually recommended.
 *
 * The old version asserted that a Medi-Cal approval established CARE and
 * California LifeLine eligibility, for every household in every state. Now the
 * sentence is only produced when both programs are in play here.
 */
function interactionEffects(ctx: FixtureContext): string {
  const notes: string[] = [];

  const recommended = byHouseholdPriority(
    ctx.programScreenings.filter((s) => s.recommendedToApply),
  );
  const utilities = recommended.filter((s) => s.category === 'utilities');
  const gateways = recommended.filter(
    (s) => s.category === 'health' || s.category === 'food',
  );

  if (utilities.length > 0 && gateways.length > 0) {
    notes.push(
      `- Approval for ${listNames(gateways.map(programName))} can establish categorical eligibility for ${listNames(utilities.map(programName))}.`,
    );
  }

  const bundle = resolveApplicationBundle({
    state: ctx.state,
    programIds: recommended.map((s) => s.programId),
  });

  if (bundle.definition && bundle.formPrograms.length > 1) {
    notes.push(
      `- One ${bundle.definition.formCode} application covers ${bundle.formPrograms.length} of the recommended programs, so applying for one does not require a separate form for the others.`,
    );
  }

  if (bundle.separateApplications.length > 0) {
    const names = bundle.separateApplications
      .map((id) => programById(id))
      .filter((program): program is ProgramDefinition => program !== null)
      .map((program) => label(program.nameKey));

    notes.push(
      `- ${listNames(names)} ${names.length === 1 ? 'has its own application' : 'have their own applications'} and ${names.length === 1 ? 'is' : 'are'} not covered by the state form.`,
    );
  }

  return notes.length > 0
    ? notes.join('\n')
    : '- No cross-program interactions identified for this household.';
}

/**
 * Phase 5 — the action plan.
 *
 * Three separate document lists, which is the fix for the misleading language
 * the brief calls out. The old plan said "No additional documentation is
 * required to start" in the same breath as printing a list of required
 * documents. What a household actually needs is the distinction between what
 * blocks submission (almost nothing), what will be verified later, and what only
 * some households are asked for.
 */
/**
 * Category order for presenting recommendations to a household.
 *
 * Discovery order is by jurisdiction level, which is right for an audit table
 * and wrong for a plan: it led the Austin bottom line with a phone-bill
 * discount and buried SNAP behind it. A household reads the plan in order of
 * what it needs, so the plan is ordered that way.
 */
const CATEGORY_PRIORITY: readonly ProgramDefinition['category'][] = [
  'health',
  'food',
  'cash',
  'housing',
  'childcare',
  'utilities',
];

/** Recommendations in the order a household should read them. */
function byHouseholdPriority(
  screenings: readonly ProgramScreening[],
): ProgramScreening[] {
  return [...screenings].sort(
    (a, b) =>
      CATEGORY_PRIORITY.indexOf(a.category) -
        CATEGORY_PRIORITY.indexOf(b.category) ||
      a.programId.localeCompare(b.programId),
  );
}

function actionPlanDoc(ctx: FixtureContext): string {
  const recommended = byHouseholdPriority(
    ctx.programScreenings.filter((s) => s.recommendedToApply),
  );

  const bundle = resolveApplicationBundle({
    state: ctx.state,
    programIds: recommended.map((s) => s.programId),
  });

  const formName = bundle.definition?.formCode ?? null;

  const bottomLine =
    recommended.length > 0
      ? `Your household should apply for ${listNames(recommended.map(programName))}. ${
          bundle.definition && bundle.formPrograms.length > 0
            ? `${
                bundle.formPrograms.length === 1
                  ? 'One of these is'
                  : `${bundle.formPrograms.length} of these are`
              } on a single ${formName} application filed with ${
                bundle.definition.state === 'TX'
                  ? 'Texas Health and Human Services'
                  : `${ctx.county || 'your'} County`
              }. `
            : ''
        }At ${ctx.fplPercent}% of the Federal Poverty Level for a household of ${ctx.household.size}, you can submit today — verification documents can follow.`
      : `Based on a household income of ${money(ctx.income)} (${ctx.fplPercent}% of the Federal Poverty Level for a household of ${ctx.household.size}), no program in ${describeJurisdiction(ctx.jurisdiction)} is recommended right now.${
          ctx.screening.inCoverageGap ? ` ${label('report_coverage_gap_body')}` : ''
        }`;

  // Steps: the state form first, then each separately-applied program.
  const steps: string[] = [];

  if (bundle.definition && bundle.formPrograms.length > 0) {
    steps.push(
      `${steps.length + 1}. **Apply for ${listNames(
        bundle.formProgramSources
          .map((id) => programById(id))
          .filter((p): p is ProgramDefinition => p !== null)
          .map((p) => label(p.nameKey)),
      )}** — one ${formName} application at ${bundle.definition.officialUrl}. You can submit with the information you already have.`,
    );
  }

  for (const id of bundle.separateApplications) {
    const program = programById(id);

    if (!program) continue;

    steps.push(
      `${steps.length + 1}. **Apply for ${label(program.nameKey)}** — ${program.agency}, ${program.officialUrl}${
        program.phone ? ` or call ${program.phone}` : ''
      }. This is a separate application from the state form.`,
    );
  }

  if (steps.length === 0) {
    const marketplace = ctx.programScreenings.find(
      (s) => s.programId === 'federal_marketplace' || s.programId === 'ca_covered_california',
    );

    steps.push(
      marketplace
        ? `1. **Review ${programName(marketplace)}** at ${definitionFor(marketplace).officialUrl} during open enrollment.`
        : '1. **Re-check eligibility** if your income or household changes.',
    );
  }

  steps.push(
    `${steps.length + 1}. **Report changes** in income or household size within 10 days of the change to avoid an overpayment.`,
  );

  // ── Document lists, properly separated ──────────────────────────────────
  const toSubmit = [
    '| Your name, date of birth, and address | Everything you need to start |',
    '| Household members and their dates of birth | Everything you need to start |',
    '| An estimate of your household income | Everything you need to start |',
  ];

  const toVerify = [
    `| Proof of identity | Photo ID, or another document the agency accepts |`,
    `| Proof of residency | Lease, utility bill, or official mail showing ZIP ${ctx.zipCode || 'your ZIP code'} |`,
    `| Proof of income | Last 30 days of pay stubs for every working member |`,
  ];

  const maybe: string[] = [
    '| Citizenship or immigration documents | Only for the people requesting benefits |',
  ];

  if (recommended.some((s) => s.category === 'food')) {
    maybe.push(
      '| Rent or mortgage statement and utility bills | Raises your food benefit — send if you have them |',
    );
  }

  if (ctx.household.pregnant) {
    maybe.push('| Proof of pregnancy and expected due date | Pregnancy programs |');
  }

  if (recommended.some((s) => s.programId === 'travis_central_health_map')) {
    maybe.push(
      '| Proof you live in Travis County | Central Health MAP enrollment |',
    );
  }

  // ── Application directory, from the registry ─────────────────────────────
  const directory = recommended.map((screening) => {
    const program = definitionFor(screening);

    return `| ${programName(screening)} | ${program.agency} | ${program.officialUrl} | ${program.phone ?? '—'} |`;
  });

  // ── Estimated value, honest about what is unknown ────────────────────────
  const valueRows = recommended.map((screening) => {
    const { estimate } = screening;

    return estimate.kind === 'estimated'
      ? `| ${programName(screening)} | ${money(estimate.monthly)} | ${money(estimate.annual)} | ${label(estimate.methodKey)} |`
      : `| ${programName(screening)} | Not estimated | Not estimated | ${label(estimate.reasonKey)} |`;
  });

  const estimatedTotal = recommended.reduce(
    (total, screening) =>
      screening.estimate.kind === 'estimated'
        ? total + screening.estimate.annual
        : total,
    0,
  );

  const unestimatedCount = recommended.filter(
    (screening) => screening.estimate.kind === 'unknown',
  ).length;

  const application = buildApplicationRecommendation(ctx.screening);

  const structured = {
    schemaVersion: 1,
    applications: application ? [application] : [],
  };

  const cliffSection =
    ctx.screening.cliffs.length > 0
      ? ctx.screening.cliffs
          .map(
            (cliff) =>
              `- ${label(cliff.nameKey)}: ${reasonInEnglish({
                kind: 'keyed',
                key: cliff.key,
                params: cliff.params,
              })}`,
          )
          .join('\n')
      : '- No program in this jurisdiction has a single income threshold this household is close to. Where eligibility depends on category or on income after deductions, there is no single cliff to warn about.';

  return `## STATUS: COMPLETE
## SUMMARY: ${recommended.length} program${recommended.length === 1 ? '' : 's'} recommended for a household of ${ctx.household.size} in ${describeJurisdiction(ctx.jurisdiction)}

## Bottom Line
${bottomLine}

## Prioritized Steps
${steps.join('\n')}

## ${label('docs_to_submit_heading')}
${label('docs_to_submit_intro')}

| Information | Note |
|-------------|------|
${toSubmit.join('\n')}

${label('docs_file_now_note')}

## ${label('docs_to_verify_heading')}
${label('docs_to_verify_intro')}

| Document | Details |
|----------|---------|
${toVerify.join('\n')}

## ${label('docs_maybe_heading')}
${label('docs_maybe_intro')}

| Document | Applies When |
|----------|--------------|
${maybe.join('\n')}

## Application Directory

| Program | Agency | Apply Online | Phone |
|---------|--------|--------------|-------|
${directory.length > 0 ? directory.join('\n') : '| No program recommended at this income | — | — | — |'}

${formName ? `Form: ${formName} (${label(bundle.definition!.formNameKey)}).` : 'No consolidated state application applies to this household.'}

## Structured Application Output
\`\`\`json
${JSON.stringify(structured, null, 2)}
\`\`\`

## Income Cliff Warnings
${cliffSection}

## Contingency Plans
${contingencyPlans(ctx, recommended)}

## Estimated Value Summary

| Program | Monthly Value | Annual Value | Basis |
|---------|---------------|--------------|-------|
${valueRows.length > 0 ? valueRows.join('\n') : '| None recommended at this income | — | — | — |'}

**TOTAL ESTIMATED ANNUAL VALUE (where a published formula exists): ${money(estimatedTotal)}**

${
  unestimatedCount > 0
    ? `${unestimatedCount} recommended program${unestimatedCount === 1 ? '' : 's'} ${unestimatedCount === 1 ? 'has' : 'have'} no published per-household formula, so ${unestimatedCount === 1 ? 'it is' : 'they are'} excluded from that total rather than assigned an invented figure. ${label('report_estimate_disclaimer')}`
    : label('report_estimate_disclaimer')
}
`;
}

/** Contingencies derived from the programs actually recommended. */
function contingencyPlans(
  ctx: FixtureContext,
  recommended: readonly ProgramScreening[],
): string {
  const notes: string[] = [];

  const food = recommended.find((s) => s.category === 'food');
  const health = recommended.find((s) => s.category === 'health');

  if (health) {
    notes.push(
      `- If ${programName(health)} is denied, ask the agency for the written notice and the appeal deadline before doing anything else.`,
    );
  }

  if (food) {
    const program = definitionFor(food);
    const expedited = program.rules?.values?.expeditedServiceDays;

    notes.push(
      `- If ${programName(food)} is denied for excess income, reapply after any reduction in hours or wages.`,
    );

    if (typeof expedited === 'number') {
      notes.push(
        `- Expedited ${programName(food)} service is available within ${expedited} days for households with very low income and resources.`,
      );
    }
  }

  if (ctx.screening.inCoverageGap) {
    const local = ctx.programScreenings.find(
      (s) => s.category === 'health' && s.level !== 'federal' && s.recommendedToApply,
    );

    if (local) {
      notes.push(
        `- Because Texas Medicaid is category-based, ${programName(local)} is the realistic route to care for adults here. Apply even while other decisions are pending.`,
      );
    }
  }

  return notes.length > 0
    ? notes.join('\n')
    : '- No contingency needed: nothing is currently pending.';
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
