//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The Austin households from the brief, end to end through the real pipeline.
 *
 * These go through `buildFixturePhaseDocuments` and then the production
 * `assembleReport` parser — the same path a demo run takes and the same
 * assembly a production run uses. So a passing test here means the demo and the
 * report agree, not merely that a screening function returned the right shape.
 *
 * The canonical scenario is the one the brief specifies: ZIP 78705, two adults,
 * no children, not pregnant, $20,000 a year. Its most important assertion is a
 * negative one — no California program, no California form, no California
 * portal — and its most important positive one is that Texas Medicaid is
 * *correctly* refused for these adults rather than granted on a 138% FPL test
 * that does not exist in Texas.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildFixtureContext,
  buildFixturePhaseDocuments,
} from '@/lib/e2e-fixture';
import { assembleReport } from '@/lib/report-assembler';
import { detectJurisdictionLeaks } from '@/lib/jurisdiction-invariant';
import { messages } from '@/i18n';
import { resolveReasons } from '@/lib/eligibility-reasons';
import type { ProgramScreening } from '@/lib/program-screening';

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * The canonical Austin demo household, exactly as the brief specifies it.
 *
 * Two adults, no children, not pregnant, $20,000 a year. At a household size of
 * 2 the 2025 FPL is $21,150, so this household is at 95% of poverty — below the
 * marketplace subsidy floor and, in Texas, in the coverage gap.
 */
const AUSTIN_ADULTS_ONLY = {
  zip_code: '78705',
  annual_income: '20000',
  household_profile: 'Two adults, ages 34 and 31.',
  current_coverage: 'No',
  medications: 'None',
  providers: 'None',
  premium_budget: 'As low as possible',
  health_needs: 'None',
};

/** The same household with a school-age child, to exercise CHIP and TANF. */
const AUSTIN_WITH_CHILD = {
  ...AUSTIN_ADULTS_ONLY,
  annual_income: '32000',
  household_profile: 'Two adults, ages 34 and 31, and one child, age 8.',
};

/** A pregnant Austin household, for pregnancy programs and WIC. */
const AUSTIN_PREGNANT = {
  ...AUSTIN_ADULTS_ONLY,
  annual_income: '24000',
  household_profile: 'Two adults, ages 29 and 30, and one of us is pregnant.',
};

/** An Austin household with a toddler, for the 1–5 Medicaid age band. */
const AUSTIN_WITH_TODDLER = {
  ...AUSTIN_ADULTS_ONLY,
  annual_income: '30000',
  household_profile: 'Two adults, ages 34 and 31, and one child, age 3.',
};

/** The California control: a Los Angeles household that must be unaffected. */
const LOS_ANGELES_FAMILY = {
  zip_code: '90001',
  annual_income: '32000',
  household_profile: 'Two adults, ages 32 and 30, and two children, ages 4 and 8.',
  current_coverage: 'No',
  medications: 'Metformin',
  providers: 'Dr. Nguyen at Alta Med',
  premium_budget: '$150',
  health_needs: 'Type 2 diabetes management',
};

/** The California program vocabulary the brief says must never appear. */
const FORBIDDEN_IN_TEXAS = [
  'Medi-Cal',
  'CalFresh',
  'CalWORKs',
  'SAWS 2 PLUS',
  'BenefitsCal',
  'GetCalFresh',
  'Covered California',
  'California CARE',
  'California LifeLine',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write the fixture documents to a temp run dir and assemble via real code. */
async function assembleFromFixture(vars: Record<string, string>) {
  const base = await mkdtemp(path.join(tmpdir(), 'austin-fixture-'));
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  await mkdir(path.join(base, runId), { recursive: true });

  const docs = buildFixturePhaseDocuments(vars);

  for (const [phase, content] of Object.entries(docs)) {
    await writeFile(path.join(base, runId, `${phase}.md`), content, 'utf8');
  }

  return assembleReport(runId, base);
}

/** Every phase document concatenated, for whole-output sweeps. */
function allText(vars: Record<string, string>): string {
  return Object.values(buildFixturePhaseDocuments(vars)).join('\n\n');
}

function screeningFor(
  screenings: readonly ProgramScreening[],
  programId: string,
): ProgramScreening {
  const found = screenings.find((s) => s.programId === programId);

  expect(found, `${programId} was not screened`).toBeDefined();

  return found!;
}

/** Reasons rendered in English, for assertions about what the user is told. */
function reasonsFor(screening: ProgramScreening): string {
  return resolveReasons(screening.reasons, messages.en, 'en').join(' ');
}

// ---------------------------------------------------------------------------
// The canonical Austin household
// ---------------------------------------------------------------------------

describe('Austin adult-only household — ZIP 78705, 2 adults, $20,000', () => {
  const ctx = buildFixtureContext(AUSTIN_ADULTS_ONLY);

  it('resolves to Austin, Travis County, Texas', () => {
    expect(ctx.state).toBe('TX');
    expect(ctx.county).toBe('Travis');
    expect(ctx.city).toBe('Austin');
    expect(ctx.zipCode).toBe('78705');
    expect(ctx.jurisdiction.country).toBe('US');
  });

  it('computes the household and FPL position', () => {
    expect(ctx.household.size).toBe(2);
    expect(ctx.household.adults).toBe(2);
    expect(ctx.household.children).toBe(0);
    expect(ctx.household.pregnant).toBe(false);
    expect(ctx.fpl).toBe(21_150);
    expect(ctx.fplPercent).toBe(95);
  });

  it('evaluates Texas SNAP against the HHSC dollar table', () => {
    const snap = screeningFor(ctx.programScreenings, 'tx_snap');

    // $20,000/yr = $1,667/mo, under the $2,292 gross limit for a household of 2.
    expect(snap.status).toBe('likely_eligible');
    expect(snap.recommendedToApply).toBe(true);
    expect(reasonsFor(snap)).toContain('$2,292');
  });

  it('evaluates every Texas Medicaid category, and refuses them correctly', () => {
    /*
     * The heart of the fix. Two non-pregnant adults with no children match no
     * Texas Medicaid category, so none may be recommended — however low the
     * income. A 138% FPL adult test would have recommended all of them.
     */
    for (const id of [
      'tx_medicaid_child',
      'tx_medicaid_pregnancy',
      'tx_medicaid_parent',
      'tx_chip',
      'tx_chip_perinatal',
    ]) {
      const screening = screeningFor(ctx.programScreenings, id);

      expect(screening.recommendedToApply, id).toBe(false);
    }
  });

  it('does not apply a 138% FPL adult Medicaid rule', () => {
    const text = allText(AUSTIN_ADULTS_ONLY);

    // 95% FPL would pass a 138% test. Nothing may claim it did.
    expect(text).not.toMatch(/138%\s*FPL/);
    expect(text).not.toContain('expanded Medicaid');
  });

  it('names the coverage gap rather than implying coverage exists', () => {
    expect(ctx.screening.inCoverageGap).toBe(true);

    const marketplace = screeningFor(ctx.programScreenings, 'federal_marketplace');

    expect(marketplace.recommendedToApply).toBe(false);
    expect(reasonsFor(marketplace)).toContain('coverage gap');

    expect(allText(AUSTIN_ADULTS_ONLY)).toContain(
      'Texas did not expand Medicaid',
    );
  });

  it('evaluates TANF and refuses it on household composition, not income', () => {
    const tanf = screeningFor(ctx.programScreenings, 'tx_tanf');

    expect(tanf.status).toBe('unlikely_eligible');
    expect(tanf.recommendedToApply).toBe(false);
    expect(reasonsFor(tanf)).toContain('Low income on its own does not qualify');
  });

  it('recommends Central Health MAP — the Travis County coverage-gap answer', () => {
    const map = screeningFor(ctx.programScreenings, 'travis_central_health_map');

    expect(map.status).toBe('likely_eligible');
    expect(map.recommendedToApply).toBe(true);

    const reasons = reasonsFor(map);

    // It must be presented as local network access, not as insurance.
    expect(reasons).toContain('not health insurance');
    expect(reasons).toContain('regardless of immigration status');
  });

  it('recommends the City of Austin utility discount', () => {
    const cap = screeningFor(ctx.programScreenings, 'austin_energy_cap');

    expect(cap.recommendedToApply).toBe(true);
  });

  it('recommends WIC to nobody in this household', () => {
    const wic = screeningFor(ctx.programScreenings, 'tx_wic');

    expect(wic.recommendedToApply).toBe(false);
  });

  it('produces NO California program, form, portal or agency', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);
    const text = payload.sections.map((s) => s.content).join('\n');

    for (const forbidden of FORBIDDEN_IN_TEXAS) {
      expect(text, forbidden).not.toContain(forbidden);
    }

    expect(text).not.toContain('benefitscal.com');
    expect(text).not.toContain('getcalfresh.org');
    expect(text).not.toContain('coveredca.com');
    expect(text).not.toContain('cpuc.ca.gov');
    expect(text).not.toContain('cdss.ca.gov');
  });

  it('passes the terminology leak detector across every phase', () => {
    expect(detectJurisdictionLeaks(allText(AUSTIN_ADULTS_ONLY), 'TX')).toEqual([]);
  });

  it('routes the application to Texas Form H1010 and Your Texas Benefits', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);

    expect(payload.application.recommendations).toHaveLength(1);
    expect(payload.application.recommendations[0].formId).toBe('TX_H1010');

    const text = payload.sections.map((s) => s.content).join('\n');

    expect(text).toContain('yourtexasbenefits.com');
  });

  it('carries exactly the four Texas form programs through the real parser', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);
    const programs = payload.application.recommendations[0].programs.map(
      (p) => p.program,
    );

    expect(programs.sort()).toEqual(
      ['tx_chip', 'tx_medicaid', 'tx_snap', 'tx_tanf'].sort(),
    );
  });

  it('recommends SNAP through the form and MAP separately', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);

    expect(payload.application.recommendedPrograms).toContain('tx_snap');

    const text = payload.sections.map((s) => s.content).join('\n');

    // MAP is not on H1010, so it must be named as its own application.
    expect(text).toContain('centralhealth.net');
    expect(text).toMatch(/separate application/i);
  });

  it('names the correct Texas and local agencies, and no invented ones', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);
    const text = payload.sections.map((s) => s.content).join('\n');

    expect(text).toContain('Texas Health and Human Services Commission');
    expect(text).toContain('Central Health (Travis County Healthcare District)');
    expect(text).toContain('Austin Energy');

    // The old output invented a county social-services department for Texas.
    expect(text).not.toMatch(/Travis County Department of Social Services/);
    expect(text).not.toMatch(/County Department of Social Services/);
  });

  it('separates what blocks submission from what is verified later', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);
    const text = payload.sections.map((s) => s.content).join('\n');

    expect(text).toContain('What you need to submit an application');
    expect(text).toContain('What you will likely be asked to verify');
    expect(text).toContain('What may be requested, depending on your household');

    // The contradiction the brief called out must be gone.
    expect(text).not.toContain('No additional documentation is required to start');
  });

  it('never invents a dollar value for health coverage', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);
    const text = payload.sections.map((s) => s.content).join('\n');

    // The specific fabrication the brief named.
    expect(text).not.toContain('$840');

    for (const id of ['travis_central_health_map', 'tx_medicaid_child']) {
      const screening = screeningFor(ctx.programScreenings, id);

      expect(screening.estimate.kind, id).toBe('unknown');
    }
  });

  it('estimates SNAP from a named published formula', () => {
    const snap = screeningFor(ctx.programScreenings, 'tx_snap');

    expect(snap.estimate.kind).toBe('estimated');

    if (snap.estimate.kind === 'estimated') {
      expect(snap.estimate.monthly).toBeGreaterThan(0);
      expect(snap.estimate.methodKey).toBe('estimate_method_snap_allotment');
    }
  });

  it('emits no Medicaid income cliff, because Texas Medicaid has none', () => {
    const cliffPrograms = ctx.screening.cliffs.map((c) => c.programId);

    expect(cliffPrograms).not.toContain('tx_medicaid_child');
    expect(cliffPrograms).not.toContain('tx_medicaid_parent');
  });

  it('produces a report the real assembler accepts', async () => {
    const payload = await assembleFromFixture(AUSTIN_ADULTS_ONLY);

    expect(payload.sections).toHaveLength(5);
    expect(payload.bottomLine.length).toBeGreaterThan(0);
    expect(payload.application.available).toBe(false); // set by the route, not here
  });
});

// ---------------------------------------------------------------------------
// Austin with a child
// ---------------------------------------------------------------------------

describe('Austin household with a school-age child', () => {
  const ctx = buildFixtureContext(AUSTIN_WITH_CHILD);

  it('resolves the same jurisdiction', () => {
    expect(ctx.state).toBe('TX');
    expect(ctx.county).toBe('Travis');
    expect(ctx.city).toBe('Austin');
    expect(ctx.household.children).toBe(1);
  });

  it('evaluates children’s Medicaid on the 6–18 age band', () => {
    // $32,000 for a household of 3 = 120% FPL, under the 133% school-age band.
    expect(ctx.fplPercent).toBe(120);

    const child = screeningFor(ctx.programScreenings, 'tx_medicaid_child');

    expect(child.recommendedToApply).toBe(true);
    expect(reasonsFor(child)).toContain('133%');
  });

  it('explains that the limit changes with the child’s age', () => {
    const child = screeningFor(ctx.programScreenings, 'tx_medicaid_child');

    expect(reasonsFor(child)).toContain('198%');
    expect(reasonsFor(child)).toContain('144%');
  });

  it('evaluates CHIP as the rung above children’s Medicaid', () => {
    const chip = screeningFor(ctx.programScreenings, 'tx_chip');

    expect(chip.recommendedToApply).toBe(true);
    expect(reasonsFor(chip)).toContain('201%');
  });

  it('evaluates TANF as possible now that a child is present', () => {
    const tanf = screeningFor(ctx.programScreenings, 'tx_tanf');

    // A child makes it worth pursuing, but Texas decides on dollar standards
    // we do not hold — so it is "needs more information", not a promise.
    expect(tanf.status).toBe('insufficient_information');
    expect(reasonsFor(tanf)).toContain('first requirement');
  });

  it('surfaces parent Medicaid without asserting a threshold', () => {
    const parent = screeningFor(ctx.programScreenings, 'tx_medicaid_parent');

    expect(parent.status).toBe('insufficient_information');

    const reasons = reasonsFor(parent);

    expect(reasons).toContain('far below the poverty line');
    // No invented percentage may appear.
    expect(reasons).not.toMatch(/\b\d+%\s*(of poverty|FPL)/);
  });

  it('produces no California program', () => {
    const text = allText(AUSTIN_WITH_CHILD);

    for (const forbidden of FORBIDDEN_IN_TEXAS) {
      expect(text, forbidden).not.toContain(forbidden);
    }

    expect(detectJurisdictionLeaks(text, 'TX')).toEqual([]);
  });
});

describe('Austin household with a toddler', () => {
  const ctx = buildFixtureContext(AUSTIN_WITH_TODDLER);

  it('uses the 1–5 age band, which is more generous than 6–18', () => {
    // $30,000 for a household of 3 = 113% FPL: inside 144%, and the reason
    // must quote the band that actually applied.
    const child = screeningFor(ctx.programScreenings, 'tx_medicaid_child');

    expect(child.recommendedToApply).toBe(true);
    expect(reasonsFor(child)).toContain('144%');
  });

  it('recommends WIC for a child under five', () => {
    const wic = screeningFor(ctx.programScreenings, 'tx_wic');

    expect(wic.recommendedToApply).toBe(true);
    expect(reasonsFor(wic)).toContain('under five');
  });
});

// ---------------------------------------------------------------------------
// Austin, pregnant
// ---------------------------------------------------------------------------

describe('Austin pregnant household', () => {
  const ctx = buildFixtureContext(AUSTIN_PREGNANT);

  it('detects the pregnancy from the intake answer', () => {
    expect(ctx.household.pregnant).toBe(true);
    expect(ctx.state).toBe('TX');
  });

  it('recommends Medicaid for Pregnant Women at 198% FPL', () => {
    const pregnancy = screeningFor(ctx.programScreenings, 'tx_medicaid_pregnancy');

    expect(pregnancy.status).toBe('likely_eligible');
    expect(pregnancy.recommendedToApply).toBe(true);
    expect(reasonsFor(pregnancy)).toContain('198%');
  });

  it('states the twelve months of postpartum coverage', () => {
    const pregnancy = screeningFor(ctx.programScreenings, 'tx_medicaid_pregnancy');

    expect(reasonsFor(pregnancy)).toContain('12 months after the birth');
  });

  it('also surfaces CHIP Perinatal as the status-independent route', () => {
    const perinatal = screeningFor(ctx.programScreenings, 'tx_chip_perinatal');

    expect(perinatal.recommendedToApply).toBe(true);
    expect(reasonsFor(perinatal)).toContain('regardless of immigration status');
  });

  it('recommends WIC on the pregnancy', () => {
    const wic = screeningFor(ctx.programScreenings, 'tx_wic');

    expect(wic.recommendedToApply).toBe(true);
    expect(reasonsFor(wic)).toContain('pregnancy');
  });

  it('does not put a pregnant household in the coverage gap', () => {
    expect(ctx.screening.inCoverageGap).toBe(false);
  });

  it('produces no California program', () => {
    expect(detectJurisdictionLeaks(allText(AUSTIN_PREGNANT), 'TX')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// California regression — must be untouched
// ---------------------------------------------------------------------------

describe('California regression', () => {
  const ctx = buildFixtureContext(LOS_ANGELES_FAMILY);

  it('still resolves a Los Angeles ZIP to California', () => {
    expect(ctx.state).toBe('CA');
    expect(ctx.county).toBe('Los Angeles');
    expect(ctx.city).toBe('Los Angeles');
  });

  it('still recommends Medi-Cal on income alone, because California expanded', () => {
    const mediCal = screeningFor(ctx.programScreenings, 'ca_medi_cal');

    expect(mediCal.status).toBe('likely_eligible');
    expect(mediCal.recommendedToApply).toBe(true);
    expect(reasonsFor(mediCal)).toContain('California expanded Medicaid');
  });

  it('still recommends CalFresh', () => {
    const calFresh = screeningFor(ctx.programScreenings, 'ca_calfresh');

    expect(calFresh.recommendedToApply).toBe(true);
  });

  it('still evaluates CalWORKs, which this household with children reaches', () => {
    const calWorks = screeningFor(ctx.programScreenings, 'ca_calworks');

    expect(calWorks.status).toBe('possibly_eligible');
    expect(calWorks.recommendedToApply).toBe(true);
  });

  it('still routes to SAWS 2 PLUS with all three California programs', async () => {
    const payload = await assembleFromFixture(LOS_ANGELES_FAMILY);

    expect(payload.application.recommendations).toHaveLength(1);
    expect(payload.application.recommendations[0].formId).toBe('CA_SAWS_2_PLUS');

    const programs = payload.application.recommendations[0].programs.map(
      (p) => p.program,
    );

    expect(programs.sort()).toEqual(['calfresh', 'calworks', 'medi_cal']);
  });

  it('still names BenefitsCal and the California agencies', async () => {
    const payload = await assembleFromFixture(LOS_ANGELES_FAMILY);
    const text = payload.sections.map((s) => s.content).join('\n');

    expect(text).toContain('benefitscal.com');
    expect(text).toContain('California Department of Health Care Services');
  });

  it('does not put a California household in the coverage gap', () => {
    expect(ctx.screening.inCoverageGap).toBe(false);
  });

  it('produces NO Texas program, form, portal or agency', () => {
    const text = allText(LOS_ANGELES_FAMILY);

    for (const forbidden of [
      'Your Texas Benefits',
      'H1010',
      'Healthy Texas Women',
      'CHIP Perinatal',
      'Central Health',
      'Austin Energy',
      'yourtexasbenefits.com',
      'centralhealth.net',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }

    expect(detectJurisdictionLeaks(text, 'CA')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Texas outside Travis County
// ---------------------------------------------------------------------------

describe('Houston household — Texas, but not Austin', () => {
  const HOUSTON_FAMILY = {
    ...AUSTIN_ADULTS_ONLY,
    zip_code: '77002',
    household_profile: 'Two adults, ages 40 and 38.',
  };

  const ctx = buildFixtureContext(HOUSTON_FAMILY);

  it('resolves to Harris County, Texas', () => {
    expect(ctx.state).toBe('TX');
    expect(ctx.county).toBe('Harris');
    expect(ctx.city).toBe('Houston');
  });

  it('still gets Texas statewide programs', () => {
    expect(screeningFor(ctx.programScreenings, 'tx_snap').recommendedToApply).toBe(
      true,
    );
  });

  it('does not get Travis County or City of Austin programs', () => {
    const ids = ctx.programScreenings.map((s) => s.programId);

    expect(ids).not.toContain('travis_central_health_map');
    expect(ids).not.toContain('austin_energy_cap');
  });

  it('does not name Austin or Central Health anywhere', () => {
    const text = allText(HOUSTON_FAMILY);

    expect(text).not.toContain('Central Health');
    expect(text).not.toContain('Austin Energy');
    expect(text).not.toContain('centralhealth.net');
  });

  it('produces no California program', () => {
    expect(detectJurisdictionLeaks(allText(HOUSTON_FAMILY), 'TX')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unresolved location
// ---------------------------------------------------------------------------

describe('unresolved location', () => {
  const UNKNOWN = {
    ...AUSTIN_ADULTS_ONLY,
    zip_code: '00000',
  };

  it('offers federal programs only, and no state form', () => {
    const ctx = buildFixtureContext(UNKNOWN);

    expect(ctx.state).toBe('');
    expect(ctx.programScreenings.every((s) => s.level === 'federal')).toBe(true);
    // No state application can be offered when the state is unknown.
    expect(ctx.screenings).toEqual([]);
  });

  it('never falls back to California', () => {
    const text = allText(UNKNOWN);

    for (const forbidden of FORBIDDEN_IN_TEXAS) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
