//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Jurisdiction routing: the tests that would have caught the original bug.
 *
 * The failure being pinned down: ZIP 78705 (Austin, Travis County, Texas)
 * produced Medi-Cal, CalFresh, CalWORKs, SAWS 2 PLUS, BenefitsCal, Covered
 * California and California CARE. Every layer contributed — location resolution
 * never produced a city or county for Austin, the demo fixture ran California
 * screening functions unconditionally, and the report route defaulted an
 * unresolved state to "CA".
 *
 * These tests are structural wherever possible. The leak-detector tests at the
 * end are explicitly a last line of defense and are labelled as such: passing
 * them proves nothing about whether program resolution is correct, which is why
 * they come after the tests that do.
 */

import { describe, expect, it } from 'vitest';

import {
  countyKey,
  describeJurisdiction,
  isResolvedTo,
  jurisdictionFromVars,
  makeJurisdiction,
  resolveJurisdictionOffline,
  resolvedLevel,
  UNRESOLVED_JURISDICTION,
} from '@/lib/jurisdiction';
import {
  ALL_PROGRAMS,
  appliesTo,
  discoverPrograms,
  programById,
  programsForState,
  programState,
  registeredStates,
  registryProblems,
  unverifiedRuleSets,
} from '@/lib/programs';
import {
  checkJurisdictionInvariant,
  assertJurisdictionInvariant,
  detectJurisdictionLeaks,
  statesWithTerminology,
} from '@/lib/jurisdiction-invariant';
import { resolveZipLocationOffline } from '@/lib/location';
import {
  applicationForState,
  resolveApplicationBundle,
} from '@/lib/state-applications';

// ---------------------------------------------------------------------------
// Canonical jurisdictions used throughout
// ---------------------------------------------------------------------------

const AUSTIN = makeJurisdiction({
  state: 'TX',
  county: 'Travis',
  city: 'Austin',
  zipCode: '78705',
});

const LOS_ANGELES = makeJurisdiction({
  state: 'CA',
  county: 'Los Angeles',
  city: 'Los Angeles',
  zipCode: '90001',
});

const HOUSTON = makeJurisdiction({
  state: 'TX',
  county: 'Harris',
  city: 'Houston',
  zipCode: '77002',
});

const MANOR = makeJurisdiction({
  state: 'TX',
  county: 'Travis',
  city: 'Manor',
  zipCode: '78653',
});

/** Every California-only program the registry holds, by id. */
const CALIFORNIA_PROGRAM_IDS = programsForState('CA').map((p) => p.id);

/** Every Texas-only program the registry holds, by id. */
const TEXAS_PROGRAM_IDS = programsForState('TX').map((p) => p.id);

// ---------------------------------------------------------------------------
// 1. ZIP → city → county → state
// ---------------------------------------------------------------------------

describe('ZIP resolution reaches city and county for Austin', () => {
  it('resolves 78705 to Austin, Travis County, Texas', () => {
    const location = resolveZipLocationOffline('78705');

    expect(location.city).toBe('Austin');
    expect(location.county).toBe('Travis');
    expect(location.state).toBe('TX');
    expect(location.source).toBe('table');
  });

  it('resolves every Austin ZIP in the demo range to Travis County', () => {
    // The ZIPs the brief names, minus the Williamson-County side of the city,
    // which is deliberately unlisted rather than guessed.
    for (const zip of ['78701', '78702', '78704', '78705', '78741', '78745', '78759']) {
      const location = resolveZipLocationOffline(zip);

      expect(location, zip).toMatchObject({
        city: 'Austin',
        county: 'Travis',
        state: 'TX',
      });
    }
  });

  it('builds a canonical jurisdiction from a ZIP alone', () => {
    const jurisdiction = resolveJurisdictionOffline('78705');

    expect(jurisdiction).toEqual({
      country: 'US',
      state: 'TX',
      county: 'Travis',
      city: 'Austin',
      zipCode: '78705',
    });

    expect(resolvedLevel(jurisdiction)).toBe('city');
    expect(isResolvedTo(jurisdiction, 'county')).toBe(true);
  });

  it('still resolves California ZIPs, unchanged', () => {
    expect(resolveJurisdictionOffline('90001')).toMatchObject({
      state: 'CA',
      county: 'Los Angeles',
      city: 'Los Angeles',
    });

    expect(resolveJurisdictionOffline('94110')).toMatchObject({
      state: 'CA',
      county: 'San Francisco',
      city: 'San Francisco',
    });
  });

  it('leaves a county-straddling Austin ZIP unresolved rather than guessing', () => {
    /*
     * 78717 and 78750 span Travis and Williamson. Assigning them to Travis
     * would hand the household Travis County programs it may not qualify for,
     * so they resolve to state only and county programs are withheld.
     */
    for (const zip of ['78717', '78750']) {
      const jurisdiction = resolveJurisdictionOffline(zip);

      expect(jurisdiction.state, zip).toBe('TX');
      expect(jurisdiction.county, zip).toBe('');
      expect(isResolvedTo(jurisdiction, 'county'), zip).toBe(false);
    }
  });

  it('normalizes county names so "Travis County" and "travis" are one place', () => {
    expect(countyKey('Travis County')).toBe('travis');
    expect(countyKey('  travis  ')).toBe('travis');

    expect(
      makeJurisdiction({ state: 'tx', county: 'Travis County', city: 'Austin' }),
    ).toMatchObject({ state: 'TX', county: 'Travis' });
  });

  it('reads a session’s vars without re-deriving over them', () => {
    // Intake resolved a county; the tables must not override it.
    const jurisdiction = jurisdictionFromVars({
      zip_code: '78717',
      state: 'TX',
      county: 'Williamson',
      city: 'Austin',
    });

    expect(jurisdiction.county).toBe('Williamson');
  });

  it('describes an unresolved location without inventing one', () => {
    expect(describeJurisdiction(UNRESOLVED_JURISDICTION)).toBe(
      'location unresolved',
    );
    expect(describeJurisdiction(AUSTIN)).toBe('Austin, Travis County, TX');
  });
});

// ---------------------------------------------------------------------------
// 2. The registry is structurally sound
// ---------------------------------------------------------------------------

describe('program registry', () => {
  it('has no structural problems', () => {
    expect(registryProblems()).toEqual([]);
  });

  it('covers both supported markets', () => {
    expect(registeredStates()).toEqual(['CA', 'TX']);
  });

  it('gives every program a declared jurisdiction level', () => {
    for (const program of ALL_PROGRAMS) {
      expect(
        ['federal', 'state', 'county', 'city'],
        program.id,
      ).toContain(program.level);
    }
  });

  it('gives every encoded threshold a source URL and effective date', () => {
    for (const program of ALL_PROGRAMS) {
      if (!program.rules) continue;

      expect(program.rules.source.url, program.id).toMatch(/^https:\/\//);
      expect(program.rules.source.effectiveFrom, program.id).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });

  it('reports which rule sets a human still has to confirm', () => {
    const unverified = unverifiedRuleSets();

    // This is expected to be non-empty — it is the audit list, not a failure.
    expect(unverified.length).toBeGreaterThan(0);

    for (const entry of unverified) {
      expect(entry.note, entry.program).not.toBe('No verification note.');
    }
  });

  it('marks the Texas SNAP and medical thresholds as read from HHSC', () => {
    // The two rule sets that were read from the administering agency directly.
    expect(programById('tx_snap')?.rules?.source.verified).toBe(true);
    expect(programById('tx_snap')?.rules?.source.revision).toBe('Revision 25-4');
    expect(programById('tx_chip')?.rules?.source.verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Discovery is a hard jurisdiction filter
// ---------------------------------------------------------------------------

describe('program discovery honours jurisdiction', () => {
  it('offers Austin federal, Texas, Travis County and Austin programs', () => {
    const ids = discoverPrograms(AUSTIN).map((p) => p.id);

    // State
    expect(ids).toContain('tx_snap');
    expect(ids).toContain('tx_medicaid_child');
    expect(ids).toContain('tx_tanf');
    // County
    expect(ids).toContain('travis_central_health_map');
    // City
    expect(ids).toContain('austin_energy_cap');
    // Federal
    expect(ids).toContain('federal_marketplace');
  });

  it('offers Los Angeles federal and California programs', () => {
    const ids = discoverPrograms(LOS_ANGELES).map((p) => p.id);

    expect(ids).toContain('ca_medi_cal');
    expect(ids).toContain('ca_calfresh');
    expect(ids).toContain('ca_calworks');
    expect(ids).toContain('ca_covered_california');
    expect(ids).toContain('federal_wic');
  });

  it('keeps every California program out of Austin', () => {
    const ids = discoverPrograms(AUSTIN).map((p) => p.id);

    for (const californiaId of CALIFORNIA_PROGRAM_IDS) {
      expect(ids, californiaId).not.toContain(californiaId);
    }
  });

  it('keeps every Texas program out of Los Angeles', () => {
    const ids = discoverPrograms(LOS_ANGELES).map((p) => p.id);

    for (const texasId of TEXAS_PROGRAM_IDS) {
      expect(ids, texasId).not.toContain(texasId);
    }
  });

  it('keeps a Travis County program out of the rest of Texas', () => {
    const ids = discoverPrograms(HOUSTON).map((p) => p.id);

    expect(ids).toContain('tx_snap');
    expect(ids).not.toContain('travis_central_health_map');
    expect(ids).not.toContain('austin_energy_cap');
  });

  it('keeps a City of Austin program out of another Travis County city', () => {
    const ids = discoverPrograms(MANOR).map((p) => p.id);

    // Manor is in Travis County, so the county program applies...
    expect(ids).toContain('travis_central_health_map');
    // ...but the City of Austin utility discount does not.
    expect(ids).not.toContain('austin_energy_cap');
  });

  it('withholds county and city programs when the ZIP was ambiguous', () => {
    const stateOnly = resolveJurisdictionOffline('78717');
    const ids = discoverPrograms(stateOnly).map((p) => p.id);

    expect(ids).toContain('tx_snap');
    expect(ids).not.toContain('travis_central_health_map');
    expect(ids).not.toContain('austin_energy_cap');
  });

  it('offers only federal programs when nothing resolved', () => {
    const programs = discoverPrograms(UNRESOLVED_JURISDICTION);

    expect(programs.length).toBeGreaterThan(0);
    expect(programs.every((p) => p.level === 'federal')).toBe(true);
  });

  it('routes the marketplace to the state’s own exchange', () => {
    const austinIds = discoverPrograms(AUSTIN).map((p) => p.id);
    const laIds = discoverPrograms(LOS_ANGELES).map((p) => p.id);

    // Texas uses HealthCare.gov; California runs its own exchange, so the
    // federal marketplace program excludes CA rather than duplicating itself.
    expect(austinIds).toContain('federal_marketplace');
    expect(austinIds).not.toContain('ca_covered_california');

    expect(laIds).toContain('ca_covered_california');
    expect(laIds).not.toContain('federal_marketplace');
  });

  it('presents programs widest-jurisdiction first', () => {
    const levels = discoverPrograms(AUSTIN).map((p) => p.level);
    const rank = { federal: 0, state: 1, county: 2, city: 3 } as const;

    for (let i = 1; i < levels.length; i += 1) {
      expect(rank[levels[i]]).toBeGreaterThanOrEqual(rank[levels[i - 1]]);
    }
  });

  it('is generic: no program is offered outside its declared state', () => {
    /*
     * The cross-jurisdiction property, stated once over the whole registry
     * rather than per state — so a third state added later is covered without
     * a new test.
     */
    const jurisdictions = [AUSTIN, LOS_ANGELES, HOUSTON, MANOR];

    for (const jurisdiction of jurisdictions) {
      for (const program of discoverPrograms(jurisdiction)) {
        const owner = programState(program);

        if (owner === '') continue; // federal

        expect(owner, `${program.id} in ${describeJurisdiction(jurisdiction)}`).toBe(
          jurisdiction.state,
        );
      }
    }
  });

  it('appliesTo agrees with discovery for every program and jurisdiction', () => {
    for (const jurisdiction of [AUSTIN, LOS_ANGELES, HOUSTON, MANOR]) {
      const discovered = new Set(discoverPrograms(jurisdiction).map((p) => p.id));

      for (const program of ALL_PROGRAMS) {
        expect(
          appliesTo(program, jurisdiction),
          `${program.id} / ${describeJurisdiction(jurisdiction)}`,
        ).toBe(discovered.has(program.id));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Application routing
// ---------------------------------------------------------------------------

describe('application routing follows jurisdiction', () => {
  it('routes an Austin household to Texas Form H1010, not SAWS 2 PLUS', () => {
    const definition = applicationForState('TX');

    expect(definition?.formId).toBe('TX_H1010');
    expect(definition?.officialUrl).toBe('https://www.yourtexasbenefits.com/');
    /*
     * `generated`: the mapping layer holds H1010's fields and the Texas intake
     * collects the answers behind them. What Texas still does not have is
     * HHSC's own PDF — the document we produce is a prefilled worksheet, and
     * that distinction is carried on the generated document rather than by
     * calling the whole route manual.
     */
    expect(definition?.delivery).toBe('generated');
  });

  it('still routes California to SAWS 2 PLUS with a generated draft', () => {
    const definition = applicationForState('CA');

    expect(definition?.formId).toBe('CA_SAWS_2_PLUS');
    expect(definition?.delivery).toBe('generated');
  });

  it('offers no form at all when the state never resolved', () => {
    expect(applicationForState('')).toBeNull();
    expect(applicationForState(undefined)).toBeNull();
  });

  it('puts Texas programs on the Texas form and local ones on their own', () => {
    const bundle = resolveApplicationBundle({
      state: 'TX',
      programIds: [
        'tx_snap',
        'tx_medicaid_child',
        'travis_central_health_map',
        'austin_energy_cap',
      ],
    });

    expect(bundle.definition?.formId).toBe('TX_H1010');
    expect(bundle.formPrograms).toContain('tx_snap');
    expect(bundle.formPrograms).toContain('tx_medicaid');

    /*
     * The two local programs have their own applications. Forcing them onto the
     * state form would send the applicant to YourTexasBenefits for a Central
     * Health programme that portal knows nothing about.
     */
    expect(bundle.separateApplications).toContain('travis_central_health_map');
    expect(bundle.separateApplications).toContain('austin_energy_cap');
  });

  it('collapses the Texas Medicaid categories onto one form destination', () => {
    const bundle = resolveApplicationBundle({
      state: 'TX',
      programIds: [
        'tx_medicaid_child',
        'tx_medicaid_pregnancy',
        'tx_medicaid_parent',
      ],
    });

    // Form H1010 has one healthcare section, so three categories, one box.
    expect(bundle.formPrograms).toEqual(['tx_medicaid']);
  });

  it('never ticks a Texas box for a California program', () => {
    const bundle = resolveApplicationBundle({
      state: 'TX',
      programIds: ['ca_calfresh', 'ca_medi_cal'],
    });

    expect(bundle.formPrograms).toEqual([]);
    expect(bundle.separateApplications).toEqual(['ca_calfresh', 'ca_medi_cal']);
  });
});

// ---------------------------------------------------------------------------
// 5. The hard invariant
// ---------------------------------------------------------------------------

describe('jurisdiction invariant', () => {
  it('passes for programs discovered in the household’s own jurisdiction', () => {
    const ids = discoverPrograms(AUSTIN).map((p) => p.id);

    expect(checkJurisdictionInvariant(AUSTIN, ids).ok).toBe(true);
    expect(() => assertJurisdictionInvariant(AUSTIN, ids)).not.toThrow();
  });

  it('rejects a California program offered to a Texas household', () => {
    const check = checkJurisdictionInvariant(AUSTIN, ['tx_snap', 'ca_medi_cal']);

    expect(check.ok).toBe(false);
    expect(check.violations).toHaveLength(1);
    expect(check.violations[0]).toMatchObject({
      programId: 'ca_medi_cal',
      belongsTo: 'CA',
    });
  });

  it('rejects a Texas program offered to a California household', () => {
    const check = checkJurisdictionInvariant(LOS_ANGELES, ['tx_snap']);

    expect(check.ok).toBe(false);
    expect(check.violations[0]).toMatchObject({ belongsTo: 'TX' });
  });

  it('rejects a Travis County program offered in Houston', () => {
    const check = checkJurisdictionInvariant(HOUSTON, [
      'travis_central_health_map',
    ]);

    expect(check.ok).toBe(false);
  });

  it('distinguishes an unknown id from a jurisdiction leak', () => {
    const check = checkJurisdictionInvariant(AUSTIN, ['not_a_real_program']);

    expect(check.violations[0]).toMatchObject({ belongsTo: 'unknown' });
  });

  it('throws with the offending program named', () => {
    expect(() =>
      assertJurisdictionInvariant(AUSTIN, ['ca_calfresh']),
    ).toThrow(/ca_calfresh/);
  });

  it('holds generically for every registry program in the wrong state', () => {
    for (const id of CALIFORNIA_PROGRAM_IDS) {
      expect(checkJurisdictionInvariant(AUSTIN, [id]).ok, id).toBe(false);
    }

    for (const id of TEXAS_PROGRAM_IDS) {
      expect(checkJurisdictionInvariant(LOS_ANGELES, [id]).ok, id).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Terminology leak detection — LAST LINE OF DEFENSE ONLY
// ---------------------------------------------------------------------------

describe('terminology leak detector (defense in depth, not the real fix)', () => {
  it('knows the vocabulary of both supported states', () => {
    expect(statesWithTerminology()).toEqual(['CA', 'TX']);
  });

  it('flags every California term the brief named, in Texas output', () => {
    const terms = [
      'Medi-Cal',
      'CalFresh',
      'CalWORKs',
      'SAWS 2 PLUS',
      'BenefitsCal',
      'Covered California',
    ];

    for (const term of terms) {
      const leaks = detectJurisdictionLeaks(
        `Your household should apply for ${term} this week.`,
        'TX',
      );

      expect(leaks.length, term).toBeGreaterThan(0);
      expect(leaks[0].state, term).toBe('CA');
    }
  });

  it('does not fire on the ordinary word "Medical"', () => {
    /*
     * Regression: the CA pattern was `/Medi-?Cal/i`, which also matches
     * "Medical". It therefore reported a California leak inside Travis
     * County's "Medical Access Program" — the single most important Austin
     * program in the registry. A detector that flags correct output is worse
     * than no detector, because the fix is to silence it.
     */
    expect(
      detectJurisdictionLeaks(
        'Central Health runs the Medical Access Program. Medical bills and medical records are covered by this medical program.',
        'TX',
      ),
    ).toEqual([]);

    // The real name still trips it, hyphenated or camel-cased.
    expect(detectJurisdictionLeaks('Apply for Medi-Cal.', 'TX')).toHaveLength(1);
    expect(detectJurisdictionLeaks('Apply for MediCal.', 'TX')).toHaveLength(1);
  });

  it('flags California CARE without firing on the English word "care"', () => {
    expect(
      detectJurisdictionLeaks('Apply for the CARE utility discount.', 'TX'),
    ).toHaveLength(1);

    // The ordinary English word must not trip the detector.
    expect(
      detectJurisdictionLeaks(
        'Your caregiver can attend. We care about getting this right, and health care is covered.',
        'TX',
      ),
    ).toEqual([]);
  });

  it('flags Texas terminology appearing in California output', () => {
    const leaks = detectJurisdictionLeaks(
      'Apply through Your Texas Benefits using Form H1010.',
      'CA',
    );

    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.every((leak) => leak.state === 'TX')).toBe(true);
  });

  it('permits a state’s own vocabulary', () => {
    expect(
      detectJurisdictionLeaks(
        'Apply for CalFresh and Medi-Cal through BenefitsCal using SAWS 2 PLUS.',
        'CA',
      ),
    ).toEqual([]);

    expect(
      detectJurisdictionLeaks(
        'Apply for SNAP through Your Texas Benefits. Central Health MAP covers Travis County. Austin Energy offers a discount.',
        'TX',
      ),
    ).toEqual([]);
  });

  it('stays silent when the state never resolved', () => {
    // With no jurisdiction there is no "other state", so flagging every term
    // would be noise rather than a finding.
    expect(detectJurisdictionLeaks('Apply for CalFresh.', '')).toEqual([]);
  });

  it('reports enough context to locate the leak', () => {
    const leaks = detectJurisdictionLeaks(
      'Step 3: submit the CalFresh application to your county office.',
      'TX',
    );

    expect(leaks[0].match).toBe('CalFresh');
    expect(leaks[0].context).toContain('submit the CalFresh application');
  });
});
