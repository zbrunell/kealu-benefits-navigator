//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The jurisdiction invariant, and a terminology leak detector behind it.
 *
 * Two mechanisms, and the difference between them matters:
 *
 * 1. `assertJurisdictionInvariant` is a **structural** check at the
 *    program-selection / action-plan boundary. It re-derives what
 *    `discoverPrograms` would allow and rejects anything else. It cannot be
 *    fooled by naming, because it does not read names — it reads declared
 *    jurisdiction. This is a real guarantee.
 *
 * 2. `detectJurisdictionLeaks` scans *rendered text* for another state's
 *    program vocabulary. This is a **last line of defense only**, modelled on
 *    the existing English-leak sweeps. It exists because one producer in this
 *    pipeline is an LLM writing prose we do not control, and prose is the one
 *    artifact the structural check cannot reach.
 *
 * The second must never be mistaken for the first. A string blocklist cannot
 * enumerate every way a model might name a California program, and passing it
 * proves nothing about whether program resolution was correct. If a leak is ever
 * caught by the detector, the fix belongs in the registry or the screening — the
 * detector is how we find out we have a bug, not how we prevent one.
 */

import { discoverPrograms, programById, programState } from '@/lib/programs';
import { describeJurisdiction, type Jurisdiction } from '@/lib/jurisdiction';

/** One program that should not have survived to this point. */
export interface JurisdictionViolation {
  programId: string;
  /** The state the program belongs to, or "federal". */
  belongsTo: string;
  reason: string;
}

export interface JurisdictionCheck {
  ok: boolean;
  jurisdiction: string;
  violations: readonly JurisdictionViolation[];
}

/**
 * Check a set of program ids against a household's jurisdiction.
 *
 * Returns the result rather than throwing, so callers can log every violation.
 * `assertJurisdictionInvariant` is the throwing wrapper.
 */
export function checkJurisdictionInvariant(
  jurisdiction: Jurisdiction,
  programIds: readonly string[],
): JurisdictionCheck {
  const allowed = new Map(
    discoverPrograms(jurisdiction).map((program) => [program.id, program]),
  );

  const violations: JurisdictionViolation[] = [];

  for (const id of programIds) {
    if (allowed.has(id)) continue;

    /*
     * Two distinguishable failures, because they mean different things. An id
     * the registry has never heard of is a typo or a stale constant. An id that
     * exists but belongs elsewhere is a genuine jurisdiction leak.
     */
    const known = programById(id);

    if (!known) {
      violations.push({
        programId: id,
        belongsTo: 'unknown',
        reason: 'not in the program registry',
      });
      continue;
    }

    const state = programState(known);

    violations.push({
      programId: id,
      belongsTo: state || 'federal',
      reason: state
        ? `${state} ${known.level} program offered in ${describeJurisdiction(jurisdiction)}`
        : `federal program excluded in ${describeJurisdiction(jurisdiction)}`,
    });
  }

  return {
    ok: violations.length === 0,
    jurisdiction: describeJurisdiction(jurisdiction),
    violations,
  };
}

/**
 * Fail loudly when a program escaped its jurisdiction.
 *
 * Placed at the boundary where recommendations become an action plan. A throw is
 * correct here: the alternative is handing an Austin household a plan telling
 * them to apply for Medi-Cal, and a visibly broken run is better than a
 * confidently wrong one.
 */
export function assertJurisdictionInvariant(
  jurisdiction: Jurisdiction,
  programIds: readonly string[],
): void {
  const check = checkJurisdictionInvariant(jurisdiction, programIds);

  if (check.ok) return;

  const detail = check.violations
    .map((violation) => `${violation.programId} (${violation.reason})`)
    .join('; ');

  throw new Error(
    `Jurisdiction invariant violated for ${check.jurisdiction}: ${detail}`,
  );
}

// ---------------------------------------------------------------------------
// Terminology leak detection — last line of defense
// ---------------------------------------------------------------------------

/**
 * Program vocabulary that belongs to exactly one state.
 *
 * Only terms that are unambiguously one state's. "SNAP" is federal and appears
 * in both; "CalFresh" is California's name for it and appears in neither
 * Texas's output nor any other state's. Word-boundary matched so "CARE" does
 * not fire on "caregiver" — the reason the entries are regular expressions
 * rather than substrings.
 */
const STATE_TERMINOLOGY: Readonly<Record<string, readonly RegExp[]>> = {
  CA: [
    /*
     * Hyphenated in any case, or camel-cased exactly. NOT `/Medi-?Cal/i`,
     * which also matches the ordinary word "Medical" — and so fired on Travis
     * County's "Medical Access Program", reporting a California leak inside
     * the most important Austin program in the registry.
     */
    /\bMedi-Cal\b/i,
    /\bMediCal\b/,
    /\bCalFresh\b/i,
    /\bCalWORKs\b/i,
    /\bSAWS\s*2(\s*PLUS)?\b/i,
    /\bBenefitsCal\b/i,
    /\bGetCalFresh\b/i,
    /\bCovered\s+California\b/i,
    /\bCalifornia\s+LifeLine\b/i,
    /\bCPUC\b/,
    /\bCDSS\b/,
    /\bDHCS\b/,
    // "CARE" only as the California utility discount, not the English word.
    /\bCARE\s+(?:utility\s+)?(?:discount|program|rate|enrollment)\b/i,
    /\bCalifornia\s+CARE\b/i,
  ],
  TX: [
    /\bYour\s*Texas\s*Benefits\b/i,
    /\bTexas\s+Works\b/i,
    /\bHHSC\b/,
    /\bH1010\b/i,
    /\bHealthy\s+Texas\s+Women\b/i,
    /\bCHIP\s+Perinatal\b/i,
    /\bCentral\s+Health\b/i,
    /\bAustin\s+Energy\b/i,
    /\bCommUnityCare\b/i,
    /\bCEAP\b/,
    /\bTDHCA\b/,
  ],
};

/** One offending term found in rendered output. */
export interface TerminologyLeak {
  /** The state the term belongs to. */
  state: string;
  /** The matched text, verbatim. */
  match: string;
  /** A short window around the match, for the failure message. */
  context: string;
}

/**
 * Scan text for program vocabulary belonging to a state other than this one.
 *
 * `state` is the household's state. Terms belonging to it are expected and
 * ignored; terms belonging to any other registered state are leaks.
 *
 * A household whose state never resolved is not scanned: with no jurisdiction
 * there is no "other state", and flagging every term would be noise.
 */
export function detectJurisdictionLeaks(
  text: string,
  state: string,
): readonly TerminologyLeak[] {
  const code = state.trim().toUpperCase();

  if (code.length === 0) return [];

  const leaks: TerminologyLeak[] = [];

  for (const [owner, patterns] of Object.entries(STATE_TERMINOLOGY)) {
    if (owner === code) continue;

    for (const pattern of patterns) {
      // Fresh global regex per scan so lastIndex never carries between calls.
      const global = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, '')}g`);

      let match: RegExpExecArray | null;

      while ((match = global.exec(text)) !== null) {
        const start = Math.max(0, match.index - 40);
        const end = Math.min(text.length, match.index + match[0].length + 40);

        leaks.push({
          state: owner,
          match: match[0],
          context: text.slice(start, end).replace(/\s+/g, ' ').trim(),
        });

        // Zero-length matches cannot happen with these patterns, but guard
        // against an infinite loop if one is ever added.
        if (match[0].length === 0) global.lastIndex += 1;
      }
    }
  }

  return leaks;
}

/** Every state whose terminology the detector knows. For tests. */
export function statesWithTerminology(): readonly string[] {
  return Object.keys(STATE_TERMINOLOGY).sort();
}
