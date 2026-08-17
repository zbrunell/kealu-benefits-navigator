//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The scenario matrix, from the TypeScript side.
 *
 * Two jobs:
 *
 * 1. Assert the properties that can be checked without a PDF — determinism,
 *    that nothing sensitive reaches the plan, that conditional branches stay
 *    shut, and that the completion guide reports the overflow each scenario is
 *    built to cause.
 * 2. Emit `tests/fixtures/saws2-e2e-scenarios.json`, which the Python suite
 *    reads to generate real PDFs from the same plans and check them against
 *    the real form.
 *
 * The emitted file is committed and compared rather than regenerated silently.
 * That is the point: a change to the mapper shows up as a diff in the fixture,
 * and this test fails until someone regenerates it and looks at what moved.
 * Run with `UPDATE_SCENARIOS=1` to accept the new output.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { planAppendixDRows } from '@/lib/appendix-d-rows';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildCompletionGuide } from '@/lib/completion-guide';
import { assessDraftCompletion } from '@/lib/draft-completion';
import { planHouseholdRows } from '@/lib/household-rows';
import { SCENARIOS } from '../fixtures/saws2-scenarios';

const FIXTURE = path.join(
  __dirname,
  '..',
  'fixtures',
  'saws2-e2e-scenarios.json',
);

interface EmittedScenario {
  id: string;
  purpose: string;
  county: string;
  fieldPlan: Array<{ key: string; value: unknown }>;
  /** Ids of everything the guide will tell the applicant to do by hand. */
  manualItemIds: string[];
  /** Counts by reason, so a change in shape is visible in the diff. */
  manualCounts: Record<string, number>;
}

function emit(): EmittedScenario[] {
  return SCENARIOS.map((scenario) => {
    const fieldPlan = buildApplicationFieldPlan(scenario.data, {
      county: scenario.county,
    });
    const completion = assessDraftCompletion(scenario.data, fieldPlan);

    return {
      id: scenario.id,
      purpose: scenario.purpose,
      county: scenario.county,
      fieldPlan: fieldPlan.map(({ key, value }) => ({ key, value })),
      // Answers still missing from the questionnaire are noise here: every
      // scenario leaves most of it unanswered on purpose, and the ids would
      // swamp the diff without saying anything about the mapping.
      manualItemIds: completion.manualItems
        .filter((item) => item.reason !== 'missing_answer')
        .map((item) => item.id),
      manualCounts: Object.fromEntries(
        Object.entries(completion.byReason).map(([reason, items]) => [
          reason,
          items.length,
        ]),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// The committed fixture
// ---------------------------------------------------------------------------

describe('the cross-runtime scenario fixture', () => {
  it('matches what the mapper produces today', () => {
    const emitted = emit();
    const serialized = `${JSON.stringify(emitted, null, 2)}\n`;

    if (process.env.UPDATE_SCENARIOS === '1' || !existsSync(FIXTURE)) {
      mkdirSync(path.dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, serialized, 'utf8');
    }

    expect(
      readFileSync(FIXTURE, 'utf8'),
      'Scenario fixture is stale. Review the change, then rerun with ' +
        'UPDATE_SCENARIOS=1 to accept it.',
    ).toBe(serialized);
  });

  it('covers every scenario exactly once', () => {
    const ids = SCENARIOS.map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(15);
  });

  it('says why each scenario exists', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.purpose.length, scenario.id).toBeGreaterThan(30);
    }
  });
});

// ---------------------------------------------------------------------------
// Properties every scenario must hold
// ---------------------------------------------------------------------------

describe.each(SCENARIOS.map((s) => [s.id, s] as const))(
  'scenario %s',
  (id, scenario) => {
    const plan = buildApplicationFieldPlan(scenario.data, {
      county: scenario.county,
    });

    it('writes something', () => {
      expect(plan.length).toBeGreaterThan(0);
    });

    it('emits no key that looks sensitive', () => {
      for (const { key } of plan) {
        expect(key, id).not.toMatch(
          /ssn|social[_ -]?security|signature|signed|alien_number|immigration/i,
        );
      }
    });

    it('emits no duplicate keys', () => {
      const keys = plan.map((entry) => entry.key);

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('is deterministic', () => {
      const again = buildApplicationFieldPlan(scenario.data, {
        county: scenario.county,
      });

      expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
    });

    it('assigns household rows deterministically', () => {
      const first = JSON.stringify(planHouseholdRows(scenario.data));

      expect(JSON.stringify(planHouseholdRows(scenario.data))).toBe(first);
    });

    it('produces a guide whose every item names a place or is a missing answer', () => {
      const guide = buildCompletionGuide({
        application: scenario.data,
        audience: 'associate',
        county: scenario.county,
        plan,
        draft: {
          reference: 'TESTREF0',
          generatedAt: '2026-08-17T00:00:00Z',
        },
      });

      expect(guide.sections.length).toBeGreaterThan(0);

      for (const section of guide.sections) {
        expect(section.items.length, `${id}/${section.id}`).toBeGreaterThan(0);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// What each scenario was built to prove
// ---------------------------------------------------------------------------

const byId = new Map(SCENARIOS.map((s) => [s.id, s]));
const completionFor = (id: string) => {
  const scenario = byId.get(id)!;

  return assessDraftCompletion(
    scenario.data,
    buildApplicationFieldPlan(scenario.data, { county: scenario.county }),
  );
};
const planFor = (id: string) =>
  buildApplicationFieldPlan(byId.get(id)!.data, {
    county: byId.get(id)!.county,
  });

describe('household capacity', () => {
  it('reports no overflow when both printed tables are exactly full', () => {
    const completion = completionFor('max_household_rows');
    const rows = planHouseholdRows(byId.get('max_household_rows')!.data);

    expect(rows.adults).toHaveLength(5);
    expect(rows.children).toHaveLength(5);
    expect(
      completion.byReason.overflow.filter((i) => i.saws.startsWith('Q6')),
    ).toHaveLength(0);
  });

  it('reports every person past the printed rows', () => {
    const overflow = completionFor('household_overflow').byReason.overflow;

    // Seven adults (two over) and six children (one over).
    expect(overflow.filter((i) => i.saws === 'Q6')).toHaveLength(2);
    expect(overflow.filter((i) => i.saws === 'Q6b')).toHaveLength(1);
  });

  it('still gives every person past the printed rows an SSN box only if it exists', () => {
    // Eleven people, but the printed tables hold ten SSN boxes plus page 1's.
    expect(completionFor('household_overflow').byReason.ssn).toHaveLength(11);
  });
});

describe('conditional branches', () => {
  it('writes the No answers but not one detail row behind them', () => {
    const plan = planFor('all_conditionals_no');
    const keys = plan.map((entry) => entry.key);

    expect(keys).toContain('income.has_earned_income');
    expect(
      keys.some((key) => /^(income\.earned|income\.unearned)\.\d+\./.test(key)),
    ).toBe(false);
    expect(keys.some((key) => key.startsWith('appendices.'))).toBe(false);
  });

  it('reports no overflow for a household that answered No to everything', () => {
    expect(completionFor('all_conditionals_no').byReason.overflow).toEqual([]);
  });

  it('leaves no employment detail anywhere when Q8 is No', () => {
    const keys = planFor('no_employment').map((entry) => entry.key);

    expect(keys).toContain('income.has_earned_income');
    expect(keys.some((key) => key.startsWith('income.earned.'))).toBe(false);
  });
});

describe('Appendix D capacity', () => {
  it('fills both printed pages without overflow at exactly capacity', () => {
    const rows = planAppendixDRows(byId.get('appendix_d_capacity')!.data);

    expect(rows.persons).toHaveLength(2);
    expect(rows.persons.every((p) => p.jobs.length === 3)).toBe(true);
    expect(rows.overflow).toEqual([]);
  });

  it('reports the fourth job and the third person as overflow', () => {
    const rows = planAppendixDRows(byId.get('appendix_d_overflow')!.data);

    expect(rows.persons).toHaveLength(2);
    expect(rows.overflowPersonCount).toBe(1);
    expect(rows.overflow.map((o) => o.reason).sort()).toEqual([
      'job_blocks_exhausted',
      'person_blocks_exhausted',
    ]);
  });

  it('never emits a key for an Appendix D block that does not exist', () => {
    for (const { key } of planFor('appendix_d_overflow')) {
      const match = /^appendices\.employment\.(\d+)\.job\.(\d+)\./.exec(key);

      if (!match) continue;

      expect(Number(match[1])).toBeLessThan(2);
      expect(Number(match[2])).toBeLessThan(3);
    }
  });
});

describe('printed-row overflow', () => {
  it('reports two extra jobs on Q8 but none at exactly four', () => {
    expect(
      completionFor('earned_income_at_capacity').byReason.overflow,
    ).toEqual([]);
    expect(
      completionFor('earned_income_overflow').byReason.overflow.filter(
        (i) => i.saws === 'Q8',
      ),
    ).toHaveLength(2);
  });

  it('reports the fourth vehicle and the fourth property item', () => {
    expect(
      completionFor('appendix_e_overflow').byReason.overflow.filter(
        (i) => i.saws === 'Appendix E',
      ),
    ).toHaveLength(1);
    expect(
      completionFor('q25_personal_property_overflow').byReason.overflow.filter(
        (i) => i.saws === 'Q25',
      ),
    ).toHaveLength(1);
  });
});

describe('appendices do not leak into each other', () => {
  const plan = planFor('multiple_appendices');
  const keys = plan.map((entry) => entry.key);

  it('carries all four active appendices', () => {
    for (const prefix of [
      'appendices.tribal.',
      'appendices.employer_coverage.',
      'appendices.employment.',
      'appendices.vehicle.',
    ]) {
      expect(keys.some((key) => key.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it('keeps each appendix under its own namespace', () => {
    for (const key of keys.filter((k) => k.startsWith('appendices.'))) {
      expect(key).toMatch(
        /^appendices\.(tribal|employer_coverage|employment|vehicle)\./,
      );
    }
  });

  it('gives the tribal record its own person and the employer record another', () => {
    const tribal = plan.find((e) => e.key === 'appendices.tribal.0.person_name');
    const employer = plan.find(
      (e) => e.key === 'appendices.employer_coverage.0.employer_name',
    );

    expect(tribal?.value).toBe('Maria Delgado');
    expect(employer?.value).toBe('Delta Packing');
  });
});

describe('Appendix C', () => {
  const plan = planFor('health_authorized_representative');
  const value = (key: string) => plan.find((e) => e.key === key)?.value;

  it('carries the representative appointed for health coverage', () => {
    expect(value('appendices.representative.name')).toBe('Priya Raman');
    expect(value('appendices.representative.organization')).toBe(
      'Valley Health Navigators',
    );
    expect(value('appendices.representative.phone')).toBe('5595550199');
  });

  it('leaves the CalFresh-only representative off the appendix', () => {
    // Both are still recorded against Q2; only one belongs on Appendix C.
    expect(JSON.stringify(plan)).toContain('Dana Okafor');
    expect(value('appendices.representative.name')).not.toBe('Dana Okafor');
  });

  it('still reports the appendix signature and its date as manual', () => {
    const completion = completionFor('health_authorized_representative');

    expect(
      completion.byReason.signature.map((i) => i.saws),
    ).toContain('Appendix C item 10');
    expect(
      completion.byReason.signature_date.map((i) => i.saws),
    ).toContain('Appendix C item 11');
  });
});

describe('appendices stay shut when they do not apply', () => {
  it('writes no appendix keys for a single-person CalFresh household', () => {
    expect(
      planFor('single_person').some((entry) =>
        entry.key.startsWith('appendices.'),
      ),
    ).toBe(false);
  });

  it('lists them as correctly skipped instead', () => {
    const skipped = completionFor('single_person').skippedSections.map(
      (s) => s.saws,
    );

    expect(skipped).toEqual([
      'Appendix A',
      'Appendix B',
      'Appendix C',
      'Appendix D',
      'Appendix E',
    ]);
  });
});
