//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * A source sweep for applicant-visible English left in components.
 *
 * This deliberately covers the whole SAWS 2 PLUS flow rather than a convenient
 * subset — a sweep that skips the biggest forms gives false confidence, which is
 * worse than no sweep. If a new component joins the flow it must be added here.
 *
 * The sweep reads source rather than rendered output because that is what
 * catches a string *before* someone has to notice it on screen. Rendered
 * coverage lives in the per-locale guide tests and the language-switch tests.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../../src');

/** Every component an applicant passes through in the SAWS 2 PLUS flow. */
const FLOW_COMPONENTS = [
  'components/app-shell.tsx',
  'components/report-view.tsx',
  'components/application-view.tsx',
  'components/MarketplacePlans.tsx',
  'components/application/applicant-step.tsx',
  'components/application/eligibility-step.tsx',
  'components/application/household-step.tsx',
  'components/application/program-selection-step.tsx',
  'components/application/questionnaire-step.tsx',
  'components/application/draft-completion-guide.tsx',
];

/**
 * A line that is prose sitting inside JSX.
 *
 * Intentionally narrow: a line that is only words, starting with a capital,
 * with no braces, tags or operators. That is the shape a translated string can
 * no longer have, because it would be `{t("key")}`.
 */
const PROSE = /^\s{2,}([A-Z][A-Za-z][^<>{}=;:]{6,})\s*$/;

/**
 * Proper nouns that stay English in every language.
 *
 * Program and portal names are what the applicant will see on the county's own
 * website and on the form, so translating them would send someone looking for
 * something that does not exist. A line made only of these is not a leak.
 */
const PROPER_NOUNS = [
  'SAWS 2 PLUS',
  'Medi-Cal',
  'CalFresh',
  'CalWORKs',
  'BenefitsCal',
  'Covered California',
  'Kealu',
];

/** Tokens that mean the line is code, not prose. */
const CODE = /[?[\]().]|=>|\?\?|\|\||&&/;

function isProperNounOnly(text: string): boolean {
  let rest = text;

  for (const noun of PROPER_NOUNS) rest = rest.split(noun).join('');

  return rest.trim() === '';
}

/** Attributes whose value is read out or shown on hover. */
const VISIBLE_ATTR = /\b(placeholder|aria-label|title|alt)\s*=\s*"([^"]{3,})"/g;

/**
 * Offending lines in one component.
 *
 * Block comments are tracked rather than pattern-matched, because their
 * continuation lines are indistinguishable from prose on their own.
 */
function offendersIn(relative: string): string[] {
  const source = readFileSync(path.join(SRC, relative), 'utf8');
  const found: string[] = [];
  let inBlockComment = false;

  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(VISIBLE_ATTR)) {
      found.push(`L${index + 1} ${match[1]}="${match[2]}"`);
    }

    const opens = line.includes('/*');
    const closes = line.includes('*/');

    if (inBlockComment) {
      if (closes) inBlockComment = false;
      return;
    }

    if (opens && !closes) {
      inBlockComment = true;
      return;
    }

    if (opens || line.trimStart().startsWith('//')) return;
    if (/^\s*(import|export|type|interface)/.test(line)) return;
    if (/\bextends\b|\bkeyof\b|\breturn\b/.test(line)) return;
    if (CODE.test(line)) return;

    const prose = PROSE.exec(line);

    if (!prose) return;

    const text = prose[1].trim();

    if (text.split(/\s+/).length < 2) return;
    if (isProperNounOnly(text)) return;

    found.push(`L${index + 1} prose: ${text}`);
  });

  return found;
}

describe('the flow carries no applicant-visible English literals', () => {
  it.each(FLOW_COMPONENTS)('%s', (relative) => {
    const offenders = offendersIn(relative);

    expect(
      offenders,
      `${relative} has hard-coded applicant-visible text:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('covers every component in the application directory', () => {
    // A new step must be added to FLOW_COMPONENTS, not quietly skipped.
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const present = readdirSync(path.join(SRC, 'components/application'))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `components/application/${name}`);

    const uncovered = present.filter((file) => !FLOW_COMPONENTS.includes(file));

    expect(
      uncovered,
      `these components are not swept:\n  ${uncovered.join('\n  ')}`,
    ).toEqual([]);
  });
});

/**
 * A sweep that cannot fail is worse than no sweep, so the detector is checked
 * against samples rather than trusted because the suite is green.
 */
describe('the detector actually detects', () => {
  const detect = (line: string): boolean => {
    if (/^\s*(import|export|type|interface)/.test(line)) return false;
    if (/\bextends\b|\bkeyof\b|\breturn\b/.test(line)) return false;
    if (CODE.test(line)) return false;

    const prose = PROSE.exec(line);
    if (!prose) return false;

    const text = prose[1].trim();
    if (text.split(/\s+/).length < 2) return false;

    return !isProperNounOnly(text);
  };

  it.each([
    '          Enter your date of birth',
    '        Household members',
    '      Continue to the next step',
  ])('flags %s', (line) => {
    expect(detect(line)).toBe(true);
  });

  it.each([
    '          {t("field_first_name")}',
    '          SAWS 2 PLUS',
    '          Medi-Cal',
    '  const label = FIELD_LABELS[key];',
    '        <span>text</span>',
  ])('does not flag %s', (line) => {
    expect(detect(line)).toBe(false);
  });
});
