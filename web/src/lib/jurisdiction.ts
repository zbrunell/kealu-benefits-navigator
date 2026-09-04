//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The canonical jurisdiction — resolved once, then passed, never rediscovered.
 *
 * A household's location was previously a set of loose strings on the session
 * (`state`, `county`, `city`, `zip_code`) that every consumer re-read and
 * re-interpreted for itself. That is what let California leak into Texas: the
 * screening never actually consulted the state, because there was no single
 * value that *meant* "where this household lives" and could be made a
 * precondition of anything.
 *
 * A `Jurisdiction` is that value. It is resolved from the ZIP at the one place
 * location enters the system (lib/location.ts, during intake) and then travels
 * through program discovery, screening, the invariant check, application
 * routing and the action plan. Nothing downstream re-derives it.
 *
 * Why a nested ladder rather than a flat record: benefit programs are
 * administered at four levels, and a program is valid at a level *and every
 * level below it*. Central Health MAP is a Travis County program, so it is
 * offered in Austin and in Manor, but not in Houston. Making the levels
 * explicit is what turns "is this program allowed here?" into a total function
 * (see `programs/`) rather than a judgment call the model is asked to make.
 *
 * Unresolved levels are empty strings, never guesses. An empty county is not
 * "probably the big one" — it means county programs cannot be offered, which is
 * the correct and conservative outcome. See `isResolvedTo`.
 */

import {
  normalizeZip,
  resolveZipLocation,
  resolveZipLocationOffline,
  type ResolvedLocation,
} from '@/lib/location';

/**
 * The four levels a benefit program can be administered at.
 *
 * Ordered from widest to narrowest. The order is meaningful: `JURISDICTION_LEVELS`
 * is indexed to compare specificity, and the report presents programs widest
 * first so a household reads federal entitlements before local top-ups.
 */
export const JURISDICTION_LEVELS = [
  'federal',
  'state',
  'county',
  'city',
] as const;

export type JurisdictionLevel = (typeof JURISDICTION_LEVELS)[number];

/**
 * Where a household lives, canonically.
 *
 * `country` exists so the federal level is a real value rather than an implicit
 * "everything else". Every program declares a country, and a household outside
 * the US matches no US federal program instead of matching all of them.
 */
export interface Jurisdiction {
  /** ISO 3166-1 alpha-2. Always "US" today; present so "federal" means something. */
  country: string;
  /** Two-letter USPS state code, uppercase. "" when unresolved. */
  state: string;
  /** County name without the " County" suffix. "" when unresolved or ambiguous. */
  county: string;
  /** USPS city name. "" when unresolved. */
  city: string;
  /** Five-digit ZIP. "" when not a valid five-digit ZIP. */
  zipCode: string;
}

/** A jurisdiction that resolved to nothing. Matches federal US programs only. */
export const UNRESOLVED_JURISDICTION: Jurisdiction = {
  country: 'US',
  state: '',
  county: '',
  city: '',
  zipCode: '',
};

/**
 * Normalize the free-form casing and suffixes that reach us from CMS, session
 * vars written by older builds, and hand-authored fixtures.
 *
 * Comparison is done on these normalized forms throughout, so "travis",
 * "Travis", and "Travis County" are one jurisdiction rather than three.
 */
function normalizeName(value: string | undefined | null): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/** Canonical county key: lowercase, no " County" suffix. */
export function countyKey(value: string | undefined | null): string {
  return normalizeName(value)
    .replace(/\s+County$/i, '')
    .toLowerCase();
}

/** Canonical city key: lowercase. */
export function cityKey(value: string | undefined | null): string {
  return normalizeName(value).toLowerCase();
}

/** Canonical state key: uppercase two-letter code. */
export function stateKey(value: string | undefined | null): string {
  return normalizeName(value).toUpperCase();
}

/**
 * Build a jurisdiction from its parts, normalizing as it goes.
 *
 * The single constructor: nothing else in the codebase should assemble a
 * `Jurisdiction` literal, so normalization cannot be skipped by accident.
 */
export function makeJurisdiction(parts: {
  country?: string;
  state?: string;
  county?: string;
  city?: string;
  zipCode?: string;
}): Jurisdiction {
  return {
    country: stateKey(parts.country) || 'US',
    state: stateKey(parts.state),
    county: normalizeName(parts.county).replace(/\s+County$/i, ''),
    city: normalizeName(parts.city),
    zipCode: normalizeZip(parts.zipCode),
  };
}

/** Build a jurisdiction from a resolved location plus its ZIP. */
export function jurisdictionFromLocation(
  location: ResolvedLocation,
  zipCode: string | undefined,
): Jurisdiction {
  return makeJurisdiction({
    state: location.state,
    county: location.county,
    city: location.city,
    zipCode,
  });
}

/**
 * Resolve a jurisdiction from a ZIP without network access.
 *
 * The synchronous path, for the screening and the demo fixture. Same tables the
 * async path uses, so the two never disagree about a ZIP the table covers.
 */
export function resolveJurisdictionOffline(
  zipCode: string | undefined,
): Jurisdiction {
  return jurisdictionFromLocation(resolveZipLocationOffline(zipCode), zipCode);
}

/** Resolve a jurisdiction from a ZIP, consulting CMS for an unlisted one. */
export async function resolveJurisdiction(
  zipCode: string | undefined,
): Promise<Jurisdiction> {
  const location = await resolveZipLocation(zipCode);

  return jurisdictionFromLocation(location, zipCode);
}

/**
 * The jurisdiction a session is in.
 *
 * Reads the vars intake already derived, and falls back to the offline tables
 * only for a session whose vars predate derivation. It never *re*-derives on
 * top of resolved vars: if intake resolved a county, that is the county, even
 * when the local table would now answer differently.
 */
export function jurisdictionFromVars(
  vars:
    | {
        zip_code?: string;
        state?: string;
        county?: string;
        city?: string;
      }
    | undefined
    | null,
): Jurisdiction {
  const zipCode = (vars?.zip_code ?? '').trim();
  const fallback = resolveZipLocationOffline(zipCode);

  return makeJurisdiction({
    state: (vars?.state ?? '').trim() || fallback.state,
    county: (vars?.county ?? '').trim() || fallback.county,
    city: (vars?.city ?? '').trim() || fallback.city,
    zipCode,
  });
}

/**
 * Whether a jurisdiction is resolved down to at least `level`.
 *
 * The precondition for offering programs at that level. A household whose
 * county never resolved is not offered county programs — the honest outcome,
 * and the reason an ambiguous ZIP is left blank rather than guessed upstream.
 */
export function isResolvedTo(
  jurisdiction: Jurisdiction,
  level: JurisdictionLevel,
): boolean {
  switch (level) {
    case 'federal':
      return jurisdiction.country.length > 0;
    case 'state':
      return jurisdiction.state.length > 0;
    case 'county':
      return jurisdiction.state.length > 0 && jurisdiction.county.length > 0;
    case 'city':
      return jurisdiction.state.length > 0 && jurisdiction.city.length > 0;
  }
}

/** The narrowest level this jurisdiction resolved to. */
export function resolvedLevel(jurisdiction: Jurisdiction): JurisdictionLevel {
  if (isResolvedTo(jurisdiction, 'city')) return 'city';
  if (isResolvedTo(jurisdiction, 'county')) return 'county';
  if (isResolvedTo(jurisdiction, 'state')) return 'state';

  return 'federal';
}

/**
 * A stable human-readable label, widest-last, for logs and report headers.
 *
 * Not localized: it is a place name, and place names are not translated by this
 * project. The catalog keys around it are.
 */
export function describeJurisdiction(jurisdiction: Jurisdiction): string {
  const parts: string[] = [];

  if (jurisdiction.city) parts.push(jurisdiction.city);
  if (jurisdiction.county) parts.push(`${jurisdiction.county} County`);
  if (jurisdiction.state) parts.push(jurisdiction.state);

  if (parts.length === 0) {
    return jurisdiction.zipCode
      ? `ZIP ${jurisdiction.zipCode} (unresolved)`
      : 'location unresolved';
  }

  return parts.join(', ');
}

/** Whether two jurisdictions denote the same place. */
export function sameJurisdiction(a: Jurisdiction, b: Jurisdiction): boolean {
  return (
    a.country === b.country &&
    a.state === b.state &&
    countyKey(a.county) === countyKey(b.county) &&
    cityKey(a.city) === cityKey(b.city) &&
    a.zipCode === b.zipCode
  );
}
