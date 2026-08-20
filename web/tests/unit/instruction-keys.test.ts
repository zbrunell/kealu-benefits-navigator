//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The completion assessor names sentences; it does not write them.
 *
 * `draft-completion.ts` decides *what* a blank needs. The words are chosen at
 * the presentation boundary, in `completion-guide.ts`, from the catalog. These
 * tests hold that separation: every instruction key and value-type key the
 * assessor can emit must exist in all three catalogs, and no consumer may
 * recover meaning by reading the English prose.
 */

import { describe, expect, it } from 'vitest';

import { buildCompletionGuide, draftReferenceFrom } from '@/lib/completion-guide';
import { assessDraftCompletion } from '@/lib/draft-completion';
import { messages } from '@/i18n';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locale';
import { writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

/** Every key declared by the unions, read from the source so none is missed. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = readFileSync(
  path.resolve(__dirname, '../../src/lib/draft-completion.ts'),
  'utf8',
);

function unionMembers(name: string): string[] {
  const start = SOURCE.indexOf(`export type ${name} =`);
  expect(start, `${name} must be declared`).toBeGreaterThan(-1);

  const end = SOURCE.indexOf(';', start);

  return [...SOURCE.slice(start, end).matchAll(/'([a-z0-9_]+)'/g)].map(
    (m) => m[1],
  );
}

const INSTRUCTION_KEYS = unionMembers('InstructionKey');
const VALUE_TYPE_KEYS = unionMembers('ValueTypeKey');

describe('the key unions are real and non-trivial', () => {
  it('declares every instruction sentence', () => {
    expect(INSTRUCTION_KEYS.length).toBeGreaterThanOrEqual(19);
  });

  it('declares every value type', () => {
    expect(VALUE_TYPE_KEYS.length).toBeGreaterThanOrEqual(12);
  });
});

describe.each(SUPPORTED_LOCALES)('%s catalog covers every key', (locale) => {
  const catalog = messages[locale] as Record<string, string>;

  it.each(INSTRUCTION_KEYS)('has %s', (key) => {
    expect(catalog[key], `${locale} is missing ${key}`).toBeTruthy();
  });

  it.each(VALUE_TYPE_KEYS)('has %s', (key) => {
    expect(catalog[key], `${locale} is missing ${key}`).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The assessor emits keys, not prose
// ---------------------------------------------------------------------------

/** A draft that reaches SSN, signature, deferred and missing-answer items. */
function application(): Saws2PlusApplicationData {
  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-03-04',
    },
    householdMembers: [
      {
        id: 'm1',
        firstName: 'Luis',
        middleName: '',
        lastName: 'Delgado',
        dateOfBirth: '1991-09-02',
        relationshipToApplicant: 'Spouse',
      },
    ],
  };

  return {
    ...base,
    questionnaire: writePath(base.questionnaire, 'health.taxFiler', false),
  };
}

describe('every emitted item carries resolvable keys', () => {
  const completion = assessDraftCompletion(application());
  const items = Object.values(completion.byReason).flat();

  it('produces items to check', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('gives every item both keys', () => {
    for (const item of items) {
      expect(item.instructionKey, item.id).toBeTruthy();
      expect(item.valueTypeKey, item.id).toBeTruthy();
    }
  });

  it('only uses keys the unions declare', () => {
    for (const item of items) {
      expect(INSTRUCTION_KEYS, item.id).toContain(item.instructionKey);
      expect(VALUE_TYPE_KEYS, item.id).toContain(item.valueTypeKey);
    }
  });

  it('leaves no placeholder unsubstituted in any locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const guide = buildCompletionGuide({
        application: application(),
        audience: 'applicant',
        locale,
        county: 'Los Angeles',
        draft: {
          reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
          generatedAt: '2026-08-19T10:00:00.000Z',
        },
      });

      for (const section of guide.sections) {
        for (const item of section.items) {
          expect(item.title, `${locale} ${section.id}`).not.toMatch(/\{[a-z]+\}/);
          expect(item.detail, `${locale} ${section.id}`).not.toMatch(/\{[a-z]+\}/);
        }
      }
    }
  });
});

describe('the guide renders instructions in the reader’s language', () => {
  function detailsFor(locale: Locale): string {
    const guide = buildCompletionGuide({
      application: application(),
      audience: 'applicant',
      locale,
      county: 'Los Angeles',
      draft: {
        reference: draftReferenceFrom('9f3a21c0-0000-0000-0000-000000000000'),
        generatedAt: '2026-08-19T10:00:00.000Z',
      },
    });

    return guide.sections
      .flatMap((s) => s.items.map((i) => `${i.title} ${i.detail}`))
      .join(' || ');
  }

  it('does not reuse the English instruction prose in Spanish', () => {
    const es = detailsFor('es');

    // Sentences the assessor still carries in English on the item itself.
    expect(es).not.toContain('Left blank on purpose');
    expect(es).not.toContain('Handwritten signature');
    expect(es).not.toContain('Social Security Number');
  });

  it('does not reuse the English instruction prose in Simplified Chinese', () => {
    const zh = detailsFor('zh-CN');

    expect(zh).not.toContain('Left blank on purpose');
    expect(zh).not.toContain('Handwritten signature');
    expect(zh).not.toContain('penalty of perjury');
  });

  it('still produces the English wording for English readers', () => {
    expect(detailsFor('en')).toContain('Left blank on purpose');
  });
});

describe('no consumer recovers meaning from the English prose', () => {
  it('never parses item.instruction', () => {
    for (const file of ['completion-guide.ts', 'saws2-readiness.ts']) {
      const src = readFileSync(
        path.resolve(__dirname, '../../src/lib', file),
        'utf8',
      );

      // Reading the field to render it is fine; branching on its text is not.
      expect(src, file).not.toMatch(/\.instruction\s*\.(includes|match|startsWith|indexOf)/);
      expect(src, file).not.toMatch(/\.valueType\s*\.(includes|match|startsWith|indexOf)/);
    }
  });
});
