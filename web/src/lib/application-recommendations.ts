//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * From screened programs to a form's recommendations.
 *
 * Two views of the same household exist on purpose, and this module is the
 * bridge between them:
 *
 * - **Registry view** (`lib/program-screening.ts`) — one entry per program that
 *   actually exists where the household lives, at every jurisdiction level.
 *   Texas Medicaid appears three times here, once per category, because that is
 *   what Texas Medicaid is.
 * - **Form view** (`ApplicationRecommendation`) — one entry per box on the
 *   state's consolidated application. Texas Form H1010 has a single healthcare
 *   section, so the three Medicaid categories collapse into one `tx_medicaid`
 *   recommendation.
 *
 * Neither view can replace the other. The registry view is what the report and
 * the action plan reason over; the form view is what the application flow ticks
 * and what `report-assembler` validates. Collapsing them would either lose the
 * category distinctions Texas policy depends on, or invent boxes the form does
 * not have.
 *
 * The aggregation is deliberately *optimistic on status and conservative on
 * evidence*: a form box is recommended when any program behind it is
 * recommended, and it carries the reasons from every program behind it, so an
 * applicant ticking "healthcare" on H1010 sees why — which category qualified
 * them, and which did not.
 */

import type { EligibilityReason } from '@/lib/eligibility-reasons';
import type {
  HouseholdScreening,
  ProgramScreening,
  ScreeningStatus,
} from '@/lib/program-screening';
import type {
  ApplicationRecommendation,
  ProgramRecommendation,
} from '@/lib/report-assembler';
import {
  applicationForState,
  formProgramFor,
  type BenefitProgramId,
  type StateApplicationDefinition,
} from '@/lib/state-applications';

/**
 * Status precedence, most favourable first.
 *
 * `insufficient_information` outranks `unlikely_eligible` because "we could not
 * tell" must not be overwritten by "no" — a Texas household whose parent
 * Medicaid determination is genuinely unknown should not be told it is
 * ineligible because a sibling category said so.
 */
const STATUS_PRECEDENCE: readonly ScreeningStatus[] = [
  'likely_eligible',
  'possibly_eligible',
  'insufficient_information',
  'unlikely_eligible',
];

function bestStatus(statuses: readonly ScreeningStatus[]): ScreeningStatus {
  for (const candidate of STATUS_PRECEDENCE) {
    if (statuses.includes(candidate)) return candidate;
  }

  return 'insufficient_information';
}

/** Deduplicate reasons, keeping first occurrence order. */
function dedupeReasons(
  reasons: readonly EligibilityReason[],
): EligibilityReason[] {
  const seen = new Set<string>();
  const kept: EligibilityReason[] = [];

  for (const item of reasons) {
    const signature =
      item.kind === 'text'
        ? `text:${item.text}`
        : `keyed:${item.key}:${JSON.stringify(item.params ?? {})}:${item.count ?? ''}`;

    if (seen.has(signature)) continue;

    seen.add(signature);
    kept.push(item);
  }

  return kept;
}

/**
 * Collapse the registry programs behind one form box into a single
 * recommendation.
 *
 * Returns null when nothing in this jurisdiction maps to the box, which happens
 * for a form that covers a program the state registry does not yet describe.
 * The caller supplies a placeholder in that case, because `report-assembler`
 * requires a recommendation for every program the form declares.
 */
function aggregate(
  formProgram: BenefitProgramId,
  behind: readonly ProgramScreening[],
): ProgramRecommendation | null {
  if (behind.length === 0) return null;

  const status = bestStatus(behind.map((entry) => entry.status));
  const recommendedToApply = behind.some((entry) => entry.recommendedToApply);

  /*
   * Confidence follows the entry that set the status, not the maximum across
   * all of them: a confident "no" behind a tentative "maybe" must not lend its
   * confidence to the maybe.
   */
  const deciding = behind.filter((entry) => entry.status === status);
  const confidence = Math.max(...deciding.map((entry) => entry.confidence));

  return {
    program: formProgram,
    status,
    recommendedToApply,
    reasons: dedupeReasons(behind.flatMap((entry) => entry.reasons)),
    /*
     * Missing information only from the programs that are still in play. A
     * document needed by a category the household plainly does not qualify for
     * is noise on the checklist.
     */
    missingInformation: dedupeReasons(
      behind
        .filter((entry) => entry.status !== 'unlikely_eligible')
        .flatMap((entry) => entry.missingInformation),
    ),
    confidence,
  };
}

/** A placeholder for a form box no discovered program maps to. */
function unmapped(formProgram: BenefitProgramId): ProgramRecommendation {
  return {
    program: formProgram,
    status: 'insufficient_information',
    recommendedToApply: false,
    reasons: [{ kind: 'keyed', key: 'elig_program_available_no_rule' }],
    missingInformation: [
      { kind: 'keyed', key: 'missing_published_income_standard' },
    ],
    confidence: 0.3,
  };
}

/**
 * The form-level recommendation for a household's state.
 *
 * Returns null when the household is not in a state whose application we know,
 * which is different from "no programs": the report still shows every
 * discovered program, it just has no consolidated form to offer.
 */
export function buildApplicationRecommendation(
  screening: HouseholdScreening,
): ApplicationRecommendation | null {
  const definition = applicationForState(screening.jurisdiction.state);

  if (!definition) return null;

  const programs = definition.programs.map((formProgram) => {
    const behind = screening.screenings.filter(
      (entry) => formProgramFor(entry.programId) === formProgram,
    );

    return aggregate(formProgram, behind) ?? unmapped(formProgram);
  });

  return {
    formId: definition.formId,
    // Must agree with the individual programs; report-assembler rejects a
    // disagreement rather than trusting either side.
    recommended: programs.some((program) => program.recommendedToApply),
    programs,
  };
}

/**
 * Registry programs recommended here that the state form does not cover.
 *
 * These are the ones with their own agency and their own application — Central
 * Health MAP, the Austin Energy discount, the marketplace. The action plan
 * lists them as separate steps; without this they would silently vanish, which
 * for an Austin household would mean losing the two most useful local programs.
 */
export function separatelyAppliedPrograms(
  screening: HouseholdScreening,
): readonly ProgramScreening[] {
  return screening.screenings.filter(
    (entry) => entry.recommendedToApply && formProgramFor(entry.programId) === null,
  );
}

/** The state form for a screening, or null. Convenience for the fixture. */
export function formForScreening(
  screening: HouseholdScreening,
): StateApplicationDefinition | null {
  return applicationForState(screening.jurisdiction.state);
}
