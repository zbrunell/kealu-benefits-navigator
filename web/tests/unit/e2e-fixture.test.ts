//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Unit tests for the deterministic demo/E2E workflow fixture.
 *
 * The contract under test: fixture output must be derived from the intake vars
 * and must satisfy the real report-assembler parser, so the demo exercises
 * production assembly rather than a bespoke payload.
 */
import { describe, it, expect } from 'vitest';

import {
  buildFixtureContext,
  buildFixturePhaseDocuments,
  fplForHouseholdSize,
} from '@/lib/e2e-fixture';
import { assembleReport, PHASE_ORDER } from '@/lib/report-assembler';

import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

/** Write the fixture documents to a temp run dir and assemble via real code. */
async function assembleFromFixture(vars: Record<string, string>) {
  const base = await mkdtemp(path.join(tmpdir(), 'e2e-fixture-'));
  const runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await mkdir(path.join(base, runId), { recursive: true });

  const docs = buildFixturePhaseDocuments(vars);
  for (const [phase, content] of Object.entries(docs)) {
    await writeFile(path.join(base, runId, `${phase}.md`), content, 'utf8');
  }

  return assembleReport(runId, base);
}

const LOW_INCOME_FAMILY = {
  zip_code: '90001',
  annual_income: '32000',
  household_profile: 'Two adults, ages 32 and 30, and two children, ages 4 and 8.',
  current_coverage: 'No',
  medications: 'Metformin',
  providers: 'Dr. Nguyen at Alta Med',
  premium_budget: '$150',
  health_needs: 'Type 2 diabetes management',
};

// ---------------------------------------------------------------------------
// FPL math
// ---------------------------------------------------------------------------

describe('fplForHouseholdSize', () => {
  it('matches the 2025 HHS guideline for households of 1 through 4', () => {
    expect(fplForHouseholdSize(1)).toBe(15_650);
    expect(fplForHouseholdSize(2)).toBe(21_150);
    expect(fplForHouseholdSize(3)).toBe(26_650);
    expect(fplForHouseholdSize(4)).toBe(32_150);
  });

  it('clamps sizes below 1', () => {
    expect(fplForHouseholdSize(0)).toBe(15_650);
  });
});

// ---------------------------------------------------------------------------
// Screening consistency with intake
// ---------------------------------------------------------------------------

describe('buildFixtureContext', () => {
  it('derives state, county, and FPL percentage from the intake answers', () => {
    const ctx = buildFixtureContext(LOW_INCOME_FAMILY);

    expect(ctx.state).toBe('CA');
    expect(ctx.county).toBe('Los Angeles');
    expect(ctx.household.size).toBe(4);
    expect(ctx.fpl).toBe(32_150);
    expect(ctx.fplPercent).toBe(100);
  });

  it('recommends Medi-Cal and CalFresh for a household under 130% FPL', () => {
    const ctx = buildFixtureContext(LOW_INCOME_FAMILY);
    const byProgram = Object.fromEntries(
      ctx.screenings.map((screening) => [screening.program, screening]),
    );

    expect(byProgram.medi_cal.status).toBe('likely_eligible');
    expect(byProgram.calfresh.status).toBe('likely_eligible');
    expect(ctx.recommended).toBe(true);
  });

  it('marks CalWORKs unlikely when no child or pregnancy is present', () => {
    const ctx = buildFixtureContext({
      zip_code: '95814',
      annual_income: '15000',
      household_profile: 'just me, 41',
    });
    const calworks = ctx.screenings.find((s) => s.program === 'calworks');

    expect(calworks?.status).toBe('unlikely_eligible');
    expect(calworks?.recommendedToApply).toBe(false);
  });

  it('marks Medi-Cal and CalFresh unlikely for a high-income household', () => {
    const ctx = buildFixtureContext({
      zip_code: '94301',
      annual_income: '250000',
      household_profile: 'Two adults, ages 45 and 44',
    });

    expect(ctx.screenings.every((s) => !s.recommendedToApply)).toBe(true);
    expect(ctx.recommended).toBe(false);
  });

  it('recommends children-only Medi-Cal between 138% and 266% FPL', () => {
    const ctx = buildFixtureContext({
      zip_code: '90001',
      annual_income: '70000',
      household_profile: 'Two adults, ages 35 and 34, and two children, ages 6 and 9',
    });
    const mediCal = ctx.screenings.find((s) => s.program === 'medi_cal');

    expect(ctx.fplPercent).toBeGreaterThan(138);
    expect(mediCal?.status).toBe('possibly_eligible');
    expect(mediCal?.recommendedToApply).toBe(true);
  });

  it('is deterministic for identical intake', () => {
    expect(buildFixtureContext(LOW_INCOME_FAMILY)).toEqual(
      buildFixtureContext(LOW_INCOME_FAMILY),
    );
  });

  /*
   * Single source of truth: the location intake derived from the ZIP wins. The
   * fixture must not re-derive or override it with a value of its own.
   */
  it('uses the session-derived city, state, and county when present', () => {
    const ctx = buildFixtureContext({
      ...LOW_INCOME_FAMILY,
      city: 'Davis',
      state: 'CA',
      county: 'Yolo',
    });

    expect(ctx.city).toBe('Davis');
    expect(ctx.county).toBe('Yolo');
    expect(ctx.state).toBe('CA');
  });

  it('falls back to the shared offline resolver when session vars have no location', () => {
    const ctx = buildFixtureContext(LOW_INCOME_FAMILY);

    expect(ctx.city).toBe('Los Angeles');
    expect(ctx.state).toBe('CA');
    expect(ctx.county).toBe('Los Angeles');
  });

  it('derives household size from the shared household parser', () => {
    expect(buildFixtureContext(LOW_INCOME_FAMILY).household.size).toBe(4);
    expect(
      buildFixtureContext({ ...LOW_INCOME_FAMILY, household_profile: 'just me, 41' })
        .household.size,
    ).toBe(1);
  });

  /*
   * Household size feeds the FPL denominator, so the "me and my 6 year old"
   * parsing defect silently changed every eligibility determination. This pins
   * the corrected arithmetic: a household of 2 at $25,000 is 118% of FPL, where
   * a household of 1 would have been 160% and lost Medi-Cal.
   */
  it('applies the corrected household size to the FPL and eligibility screening', () => {
    const ctx = buildFixtureContext({
      zip_code: '90001',
      annual_income: '25000',
      household_profile: 'me and my 6 year old',
    });

    expect(ctx.household.size).toBe(2);
    expect(ctx.household.children).toBe(1);
    expect(ctx.fpl).toBe(21_150);
    expect(ctx.fplPercent).toBe(118);

    const byProgram = Object.fromEntries(
      ctx.screenings.map((screening) => [screening.program, screening]),
    );

    // Within the 138% Medi-Cal limit only because the child is counted.
    expect(byProgram.medi_cal.status).toBe('likely_eligible');
    expect(byProgram.calfresh.status).toBe('likely_eligible');
    // A dependent child exists, so CalWORKs is no longer ruled out outright.
    expect(byProgram.calworks.status).not.toBe('unlikely_eligible');
  });

  it('reports the corrected household size in the phase documents', () => {
    const docs = buildFixturePhaseDocuments({
      zip_code: '90001',
      annual_income: '25000',
      household_profile: 'me and my 6 year old',
    });
    const all = Object.values(docs).join('\n');

    expect(all).toContain('household of 2');
    expect(all).toContain('Household size: 2');
    expect(all).toContain('$21,150');
    // The one remaining "household of 1" is the FPL reference-table base, not
    // this household's size.
    expect(all).not.toContain('Household size: 1');
  });
});

// ---------------------------------------------------------------------------
// Phase documents / real assembler round-trip
// ---------------------------------------------------------------------------

describe('buildFixturePhaseDocuments', () => {
  it('produces a document for every phase in PHASE_ORDER', () => {
    const docs = buildFixturePhaseDocuments(LOW_INCOME_FAMILY);
    for (const phase of PHASE_ORDER) {
      expect(docs[phase]).toBeTruthy();
    }
  });

  it('is byte-identical across calls with the same intake', () => {
    expect(buildFixturePhaseDocuments(LOW_INCOME_FAMILY)).toEqual(
      buildFixturePhaseDocuments(LOW_INCOME_FAMILY),
    );
  });

  it('echoes the intake answers into the report content', () => {
    const docs = buildFixturePhaseDocuments(LOW_INCOME_FAMILY);
    const all = Object.values(docs).join('\n');

    expect(all).toContain('90001');
    expect(all).toContain('Los Angeles');
    expect(all).toContain('$32,000');
    expect(all).toContain('Metformin');
    expect(all).toContain('Dr. Nguyen at Alta Med');
  });

  it('reports the ZIP-derived city in the report content', () => {
    const docs = buildFixturePhaseDocuments({
      zip_code: '94102',
      annual_income: '26000',
      household_profile: 'Single parent with 2 kids ages 4 and 9',
      city: 'San Francisco',
      state: 'CA',
      county: 'San Francisco',
    });
    const all = Object.values(docs).join('\n');

    expect(all).toContain('San Francisco');
    expect(all).toContain('household of 3');
  });

  it('round-trips through the real assembleReport() into SAWS recommendations', async () => {
    const payload = await assembleFromFixture(LOW_INCOME_FAMILY);

    expect(payload.sections).toHaveLength(PHASE_ORDER.length);
    expect(payload.bottomLine.length).toBeGreaterThan(0);

    const saws = payload.application.recommendations.find(
      (application) => application.formId === 'CA_SAWS_2_PLUS',
    );

    expect(saws).toBeDefined();
    expect(saws?.recommended).toBe(true);
    expect(saws?.programs).toHaveLength(3);
    expect(payload.application.recommendedPrograms).toContain('medi_cal');
    expect(payload.application.recommendedPrograms).toContain('calfresh');
  });

  it('round-trips a high-income household as a valid, non-recommended application', async () => {
    const payload = await assembleFromFixture({
      zip_code: '94301',
      annual_income: '250000',
      household_profile: 'Two adults, ages 45 and 44',
    });

    const saws = payload.application.recommendations.find(
      (application) => application.formId === 'CA_SAWS_2_PLUS',
    );

    // Still a structurally valid recommendation set — the parser fails closed,
    // so this proves the fixture never emits internally inconsistent output.
    expect(saws).toBeDefined();
    expect(saws?.recommended).toBe(false);
    expect(payload.application.recommendedPrograms).toEqual([]);
  });

  it('round-trips a single-adult household through the real assembler', async () => {
    const payload = await assembleFromFixture({
      zip_code: '95814',
      annual_income: '15000',
      household_profile: 'just me, 41',
    });

    const saws = payload.application.recommendations.find(
      (application) => application.formId === 'CA_SAWS_2_PLUS',
    );

    expect(saws?.programs).toHaveLength(3);
    expect(payload.application.recommendedPrograms).toContain('medi_cal');
  });
});
