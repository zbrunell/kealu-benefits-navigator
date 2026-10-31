//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The program registry, and the one function allowed to answer "which programs
 * apply here".
 *
 * Adding a jurisdiction means adding a data file and one line to `REGISTRIES`.
 * No function in this directory branches on a state code, and nothing outside
 * it may filter programs by geography — that is the property that makes a third
 * state cheap and makes a leak impossible to reintroduce quietly.
 */

import { CALIFORNIA_PROGRAMS } from '@/lib/programs/ca';
import { FEDERAL_PROGRAMS } from '@/lib/programs/federal';
import { TEXAS_PROGRAMS } from '@/lib/programs/tx';
import {
  appliesTo,
  type ProgramCategory,
  type ProgramDefinition,
} from '@/lib/programs/types';
import { JURISDICTION_LEVELS } from '@/lib/jurisdiction';
import type { Jurisdiction } from '@/lib/jurisdiction';

export * from '@/lib/programs/types';
export { STATE_BASED_EXCHANGE_STATES } from '@/lib/programs/federal';

/**
 * Every program this project knows about.
 *
 * Order within the array is not meaningful — `discoverPrograms` sorts by
 * jurisdiction level so the report reads federal-first regardless of how the
 * files are concatenated.
 */
const REGISTRIES: readonly (readonly ProgramDefinition[])[] = [
  FEDERAL_PROGRAMS,
  CALIFORNIA_PROGRAMS,
  TEXAS_PROGRAMS,
];

export const ALL_PROGRAMS: readonly ProgramDefinition[] = REGISTRIES.flat();

/** Program ids, for exhaustiveness checks in tests. */
export const ALL_PROGRAM_IDS: readonly string[] = ALL_PROGRAMS.map(
  (program) => program.id,
);

const BY_ID = new Map(ALL_PROGRAMS.map((program) => [program.id, program]));

/** A program by id, or null when the id is not in the registry. */
export function programById(id: string): ProgramDefinition | null {
  return BY_ID.get(id) ?? null;
}

/** Sort key placing federal first and city last. */
function levelRank(program: ProgramDefinition): number {
  return JURISDICTION_LEVELS.indexOf(program.level);
}

/**
 * Every program available where this household lives.
 *
 * **This is the jurisdiction gate.** It runs before eligibility reasoning, and
 * eligibility reasoning is only ever handed its output. A program that is not
 * returned here cannot be recommended, cannot appear in an action plan, and
 * cannot reach a form — not because a later stage filters it again, but because
 * no later stage ever sees it.
 *
 * Sorted widest-level first, then by id for stability, so the same jurisdiction
 * always produces the same order and snapshots do not churn.
 */
export function discoverPrograms(
  jurisdiction: Jurisdiction,
): readonly ProgramDefinition[] {
  return ALL_PROGRAMS.filter((program) => appliesTo(program, jurisdiction)).sort(
    (a, b) => levelRank(a) - levelRank(b) || a.id.localeCompare(b.id),
  );
}

/** Programs available here, in one category. */
export function discoverProgramsByCategory(
  jurisdiction: Jurisdiction,
  category: ProgramCategory,
): readonly ProgramDefinition[] {
  return discoverPrograms(jurisdiction).filter(
    (program) => program.category === category,
  );
}

/**
 * Programs that exist for a state but are not available in this jurisdiction.
 *
 * Diagnostics for the leak tests: it makes "California programs the registry
 * holds" enumerable, so a test can assert that none of them survived discovery
 * for a Texas household without hardcoding a list of California names.
 */
export function programsForState(state: string): readonly ProgramDefinition[] {
  const code = state.trim().toUpperCase();

  return ALL_PROGRAMS.filter(
    (program) => program.level !== 'federal' && program.state === code,
  );
}

/** Every state that has at least one program in the registry. */
export function registeredStates(): readonly string[] {
  return Array.from(
    new Set(
      ALL_PROGRAMS.filter((program) => program.level !== 'federal').map(
        (program) => program.state ?? '',
      ),
    ),
  )
    .filter((state) => state.length > 0)
    .sort();
}

/**
 * Rule sets whose figures no human has confirmed.
 *
 * Surfaced as a function rather than a comment so it can be asserted on and
 * reported. The brief asks which policy values still need expert verification;
 * this is that answer, computed from the data instead of maintained by hand.
 */
export function unverifiedRuleSets(): ReadonlyArray<{
  program: string;
  url: string;
  effectiveFrom: string;
  note: string;
}> {
  return ALL_PROGRAMS.filter(
    (program) => program.rules && program.rules.source.verified !== true,
  ).map((program) => ({
    program: program.id,
    url: program.rules!.source.url,
    effectiveFrom: program.rules!.source.effectiveFrom,
    note: program.rules!.source.verificationNote ?? 'No verification note.',
  }));
}

/**
 * Structural checks the registry must satisfy.
 *
 * Returned rather than thrown so a test can report every problem at once. These
 * are the invariants that keep `appliesTo` meaningful: a county program with no
 * county silently matches nothing, and a duplicate id makes `programById`
 * ambiguous.
 */
export function registryProblems(): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const program of ALL_PROGRAMS) {
    if (seen.has(program.id)) problems.push(`duplicate program id: ${program.id}`);

    seen.add(program.id);

    if (!JURISDICTION_LEVELS.includes(program.level)) {
      problems.push(`${program.id}: unknown level ${program.level}`);
    }

    if (program.level === 'federal') {
      if (program.state) {
        problems.push(`${program.id}: federal program declares a state`);
      }
    } else if (!program.state) {
      problems.push(`${program.id}: ${program.level} program declares no state`);
    }

    if (program.level === 'county' && !program.county) {
      problems.push(`${program.id}: county program declares no county`);
    }

    if (program.level === 'city' && (program.cities ?? []).length === 0) {
      problems.push(`${program.id}: city program declares no cities`);
    }

    if (program.rules && program.rules.program !== program.id) {
      problems.push(
        `${program.id}: rule set is labelled ${program.rules.program}`,
      );
    }

    if (!/^https:\/\//.test(program.officialUrl)) {
      problems.push(`${program.id}: officialUrl is not https`);
    }
  }

  return problems;
}
