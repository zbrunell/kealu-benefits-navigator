//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The Texas scenario matrix, from the TypeScript side.
 *
 * Same contract as `saws2-e2e-scenarios.test.ts`, for the other jurisdiction:
 * assert what can be checked without a PDF, then emit
 * `tests/fixtures/tx-h1010-scenarios.json` for pytest to generate real H1010
 * worksheets from.
 *
 * The emitted file is committed and compared rather than regenerated silently.
 * A change to the mapper shows up as a diff, and this test fails until someone
 * regenerates it and looks at what moved. Run with `UPDATE_SCENARIOS=1` to
 * accept the new output.
 *
 * The assertions here are deliberately about the *canonical plan*, not about
 * H1010. What lands in which box is asserted in Python, against the definition
 * that owns the boxes; duplicating it here would give two places to update and
 * one of them would rot.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { applicationForState } from '@/lib/state-applications';
import { TEXAS_SCENARIOS } from '../fixtures/tx-h1010-scenarios';

const FIXTURE = path.join(
  __dirname,
  '..',
  'fixtures',
  'tx-h1010-scenarios.json',
);

interface EmittedScenario {
  id: string;
  purpose: string;
  county: string;
  /** The form the registry routes this household's state to. */
  formId: string;
  fieldPlan: Array<{ key: string; value: unknown }>;
}

function emit(): EmittedScenario[] {
  return TEXAS_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    purpose: scenario.purpose,
    county: scenario.county,
    formId: applicationForState('TX')?.formId ?? '',
    fieldPlan: buildApplicationFieldPlan(scenario.data, {
      county: scenario.county,
    }).map(({ key, value }) => ({ key, value })),
  }));
}

describe('the Texas cross-runtime scenario fixture', () => {
  it('matches what the mapper produces today', () => {
    const emitted = emit();
    const serialized = `${JSON.stringify(emitted, null, 2)}\n`;

    if (process.env.UPDATE_SCENARIOS === '1' || !existsSync(FIXTURE)) {
      mkdirSync(path.dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, serialized, 'utf8');
    }

    expect(
      readFileSync(FIXTURE, 'utf8'),
      'Texas scenario fixture is stale. Review the change, then rerun with ' +
        'UPDATE_SCENARIOS=1 to accept it.',
    ).toBe(serialized);
  });

  it('covers every scenario exactly once', () => {
    const ids = TEXAS_SCENARIOS.map((scenario) => scenario.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says why each scenario exists', () => {
    for (const scenario of TEXAS_SCENARIOS) {
      expect(scenario.purpose.length, scenario.id).toBeGreaterThan(20);
    }
  });

  it('routes every scenario to the Texas form, never to California', () => {
    for (const scenario of emit()) {
      expect(scenario.formId, scenario.id).toBe('TX_H1010');
    }
  });
});

describe.each(TEXAS_SCENARIOS.map((s) => [s.id, s] as const))(
  'scenario %s',
  (id, scenario) => {
    const plan = buildApplicationFieldPlan(scenario.data, {
      county: scenario.county,
    });

    it('asks for Texas programmes, and never a California one', () => {
      const programs = plan
        .filter((field) => field.key.startsWith('programs.'))
        .map((field) => field.key);

      expect(programs.length, id).toBeGreaterThan(0);

      for (const key of programs) {
        expect(key, id).toMatch(/^programs\.tx_/);
      }
    });

    it('emits no key that looks sensitive', () => {
      for (const field of plan) {
        expect(field.key, id).not.toMatch(
          /ssn|social_security|signature|alien_number|account_number/i,
        );
      }
    });

    it('emits no duplicate keys', () => {
      const keys = plan.map((field) => field.key);

      expect(new Set(keys).size, id).toBe(keys.length);
    });

    it('is deterministic', () => {
      const again = buildApplicationFieldPlan(scenario.data, {
        county: scenario.county,
      });

      expect(again).toEqual(plan);
    });

    it('states presence for every household member it emits', () => {
      /*
       * The marker H1010's people table is gated on. A member whose details
       * are half-typed still exists, and a table that discovers rows by
       * probing for a non-empty name would drop everyone after them.
       */
      const memberIndexes = new Set(
        plan
          .map((field) =>
            /^household\.members\.(\d+)\./.exec(field.key)?.[1],
          )
          .filter((index): index is string => index !== undefined),
      );

      for (const index of memberIndexes) {
        expect(
          plan.some(
            (field) =>
              field.key === `household.members.${index}.present` &&
              field.value === true,
          ),
          `${id}: member ${index} has no presence marker`,
        ).toBe(true);
      }

      expect(memberIndexes.size, id).toBe(
        scenario.data.householdMembers.length,
      );
    });
  },
);
