//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Integrity of the canonical form schema.
 *
 * The schema is now the single source of truth for what SAWS 2 PLUS means, so
 * these tests guard the properties that make that safe: ids and paths are
 * unique, manual-only concepts can never gain a destination, and the schema
 * never claims a PDF mapping the Python adapter does not actually have.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  QUESTION_META_FROM_SCHEMA,
  SAWS2_FIELDS,
  SAWS2_FIELD_BY_ID,
  collectedButUnmappedFields,
  verifiedUnmappableFields,
  manualOnlyFields,
  mappedFields,
  type Saws2Field,
} from '@/lib/saws2-schema';
import {
  QUESTION_META,
  QUESTION_SECTIONS,
  requirementForTier,
  sawsQuestionFor,
  tierFor,
} from '@/lib/saws2-question-planner';

const REPO = path.resolve(__dirname, '../../..');
const ADAPTER = path.join(REPO, 'src/benefits_navigator/pdf_generator.py');
const ADAPTER_SOURCE = readFileSync(ADAPTER, 'utf8');

describe('schema integrity', () => {
  it('has a unique id for every entry', () => {
    const ids = SAWS2_FIELDS.map((field) => field.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(SAWS2_FIELD_BY_ID.size).toBe(ids.length);
  });

  it('never binds two entries to the same questionnaire path', () => {
    const paths = SAWS2_FIELDS.map((f) => f.path).filter(Boolean) as string[];

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never binds two entries to the same canonical key', () => {
    const keys = SAWS2_FIELDS.map((f) => f.canonicalKey).filter(
      Boolean,
    ) as string[];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every entry a printed question number', () => {
    for (const field of SAWS2_FIELDS) {
      expect(field.saws, field.id).toMatch(/^(Q\d|Appendix )/);
    }
  });

  it('places every entry in a real section', () => {
    for (const field of SAWS2_FIELDS) {
      expect(QUESTION_SECTIONS, field.id).toContain(field.section);
    }
  });

  it('explains every entry that is not straightforwardly mapped', () => {
    for (const field of SAWS2_FIELDS) {
      if (field.pdf === 'mapped') continue;

      expect(
        field.note ?? field.manualReason,
        `${field.id} is ${field.pdf} but gives no reason`,
      ).toBeTruthy();
    }
  });
});

describe('requirement wording honesty', () => {
  /**
   * Only Q38 may be called "Optional". Its printed preamble reads: "The
   * following services are available. Your answers to the questions will not
   * affect your eligibility." No other question says that, so labelling one
   * optional would tell the applicant something untrue.
   */
  it('marks a question optional only where the form says it does not matter', () => {
    const optional = SAWS2_FIELDS.filter(
      (field) => requirementForTier(field.tier) === 'optional',
    );

    expect(optional.length).toBeGreaterThan(0);

    for (const field of optional) {
      expect(field.saws, `${field.id} is labelled Optional`).toMatch(/^Q38/);
    }
  });

  it('treats the program-integrity questions as completable later, not optional', () => {
    // Q29-Q36 bear on eligibility; the form never says otherwise.
    for (const saws of ['Q29', 'Q30', 'Q31', 'Q32', 'Q33', 'Q34', 'Q35', 'Q36']) {
      const entries = SAWS2_FIELDS.filter((field) => field.saws === saws);

      expect(entries.length, saws).toBeGreaterThan(0);

      for (const entry of entries) {
        expect(requirementForTier(entry.tier), `${entry.id} (${saws})`).toBe(
          'can_complete_later',
        );
      }
    }
  });

  it('does not call Q37 or Q39 optional', () => {
    // Q37 requests a special-need payment and Q39 bears on Medi-Cal third-party
    // recovery. Neither is declared non-impacting on the printed form.
    for (const saws of ['Q37', 'Q39']) {
      for (const entry of SAWS2_FIELDS.filter((f) => f.saws === saws)) {
        expect(requirementForTier(entry.tier), entry.id).not.toBe('optional');
      }
    }
  });
});

describe('manual-only boundary', () => {
  it('covers both SSNs and signatures', () => {
    const reasons = new Set(manualOnlyFields().map((f) => f.manualReason));

    expect(reasons).toEqual(new Set(['ssn', 'signature']));
  });

  it('gives every manual-only entry a reason', () => {
    for (const field of manualOnlyFields()) {
      expect(field.manualReason, field.id).toBeTruthy();
      expect(field.pdf, field.id).toBe('manual');
    }
  });

  it('never gives a manual-only entry a questionnaire path', () => {
    // A path is what makes a question askable and writable. Manual-only
    // concepts must have nowhere to store a value at all.
    for (const field of manualOnlyFields()) {
      expect(field.path, `${field.id} must not be storable`).toBeUndefined();
    }
  });

  it('never gives a manual-only entry a canonical key', () => {
    for (const field of manualOnlyFields()) {
      expect(
        field.canonicalKey,
        `${field.id} must not reach the field plan`,
      ).toBeUndefined();
    }
  });

  it('keeps manual-only entries out of the question metadata', () => {
    // If one leaked in, the planner could ask for it.
    for (const field of manualOnlyFields()) {
      expect(QUESTION_META_FROM_SCHEMA[field.id], field.id).toBeUndefined();
    }
  });

  it('declares an SSN entry so the prohibition is explicit, not accidental', () => {
    const ssn = manualOnlyFields().filter((f) => f.manualReason === 'ssn');

    expect(ssn.length).toBeGreaterThan(0);
    expect(ssn[0].saws).toBe('Q6c');
  });
});

describe('planner derives its metadata from the schema', () => {
  it('reports the schema tier for every entry', () => {
    for (const field of SAWS2_FIELDS) {
      if (field.support !== 'askable') continue;

      expect(tierFor(field.id), field.id).toBe(field.tier);
    }
  });

  it('reports the schema question number for every entry', () => {
    for (const field of SAWS2_FIELDS) {
      if (field.support !== 'askable') continue;

      expect(sawsQuestionFor(field.id), field.id).toBe(field.saws);
    }
  });

  it('exposes exactly the askable schema entries as question metadata', () => {
    // Prefillable concepts come from the applicant/program steps and must never
    // become questions; manual-only concepts must never exist as questions.
    const expected = SAWS2_FIELDS.filter((f) => f.support === 'askable').map(
      (f) => f.id,
    );

    expect(Object.keys(QUESTION_META).sort()).toEqual(expected.sort());
  });

  it('numbers the four health-coverage questions distinctly', () => {
    const numbers = [
      'health.current_coverage',
      'health.employer_coverage',
      'health.coverage_ending',
      'health.retroactive_medical',
    ].map((id) => SAWS2_FIELD_BY_ID.get(id)?.saws);

    expect(numbers).toEqual(['Q22', 'Q22a', 'Q22b', 'Q22c']);
    expect(new Set(numbers).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Cross-runtime agreement with the Python adapter
// ---------------------------------------------------------------------------

/**
 * The PDF destinations live in the Python adapter, where they are verified
 * against the real AcroForm and guarded by the fail-closed SAFE_FIELDS
 * allowlist. The schema records only the *status* of that mapping — so these
 * tests exist to stop the two drifting apart.
 */
describe('schema agrees with the PDF adapter', () => {
  /** Canonical keys the adapter's gateway table writes. */
  const adapterGatewayKeys = new Set([
    /*
     * Paired Yes/No tables: `"canonical.key": (` opening a tuple. The dot is
     * required so the row tables in the same file — keyed by bare item names
     * like "housing" or "rent_or_house_payment" — are not mistaken for keys.
     */
    ...[
      ...ADAPTER_SOURCE.matchAll(
        /^\s{8}"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)": \($/gm,
      ),
    ].map((match) => match[1]),
    /*
     * Single-checkbox table: `"canonical.key": "Check Box…",` on one line.
     * The dot is required — the row tables in the same file are keyed by bare
     * item names ("housing", "food") that are not canonical keys.
     */
    ...[
      ...ADAPTER_SOURCE.matchAll(
        /^\s{8}"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)": "(?:Check Box|BOX)[^"]*",$/gm,
      ),
    ].map((match) => match[1]),
  ]);

  it('found the adapter gateway table', () => {
    expect(adapterGatewayKeys.size).toBeGreaterThan(10);
  });

  it('every gateway the adapter writes is described by the schema', () => {
    const known = new Set(
      SAWS2_FIELDS.map((f) => f.canonicalKey).filter(Boolean),
    );

    for (const key of adapterGatewayKeys) {
      expect(known, `adapter writes ${key}, schema does not describe it`).toContain(
        key,
      );
    }
  });

  it('every gateway the adapter writes is marked mapped in the schema', () => {
    for (const key of adapterGatewayKeys) {
      const field = SAWS2_FIELDS.find((f) => f.canonicalKey === key);

      expect(field?.pdf, `${key} is written but schema says ${field?.pdf}`).toBe(
        'mapped',
      );
    }
  });

  it('never marks a manual-only concept as writable by the adapter', () => {
    for (const field of manualOnlyFields()) {
      expect(field.canonicalKey).toBeUndefined();
    }

    // Belt and braces: no SSN or signature wording in the adapter's gateway keys.
    for (const key of adapterGatewayKeys) {
      expect(key).not.toMatch(/ssn|social_security|signature/i);
    }
  });

  it('records Q27 as having no writable widget rather than as a gap', () => {
    const q27 = SAWS2_FIELD_BY_ID.get('resources.real_property');

    expect(q27?.pdf).toBe('no_widget');
    expect(q27?.note).toMatch(/no gateway checkbox/i);
    // And the adapter must genuinely not write it.
    expect(adapterGatewayKeys).not.toContain('resources.has_real_property');
  });
});

describe('coverage reporting', () => {
  it('splits every entry into exactly one bucket', () => {
    const buckets: Array<Saws2Field[]> = [
      mappedFields(),
      collectedButUnmappedFields(),
      verifiedUnmappableFields(),
      manualOnlyFields(),
    ];

    const counted = new Set(buckets.flat().map((f) => f.id));
    const rest = SAWS2_FIELDS.filter((f) => !counted.has(f.id));

    // Anything left over must be a documented no_widget or unsupported case.
    for (const field of rest) {
      expect(['no_widget', 'unreviewed'], field.id).toContain(field.pdf);
    }

    expect(counted.size + rest.length).toBe(SAWS2_FIELDS.length);
  });

  it('has nothing left that is merely unreviewed', () => {
    /*
     * This bucket means "a destination might exist and nobody has looked". It
     * being empty is the production milestone: every askable concept has now
     * either been mapped or searched for and rejected. A new entry landing here
     * is unfinished work, which is why the assertion is zero rather than a
     * ceiling.
     */
    expect(collectedButUnmappedFields().map((f) => f.id)).toEqual([]);
  });

  it('says why each verified-unmappable entry stays blank', () => {
    const rejected = verifiedUnmappableFields();

    expect(rejected.length).toBeGreaterThan(0);

    for (const field of rejected) {
      expect(field.note, `${field.id} must say why it is unmapped`).toBeTruthy();
      // The reason must be a finding about the form, not a to-do.
      expect(field.note).toMatch(/verified|ambiguous|opposite|no .*checkbox/i);
    }
  });
});
