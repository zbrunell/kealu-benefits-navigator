//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * A source sweep for applicant-visible English left in components.
 *
 * This covers the whole SAWS 2 PLUS flow rather than a convenient subset — a
 * sweep that skips the biggest forms gives false confidence, which is worse
 * than no sweep at all.
 *
 * An earlier version of this file passed while `eligibility-step` still had
 * eighteen English questions and `questionnaire-step` had fifty-seven English
 * field labels: its patterns excluded any line containing a bracket, a period
 * or a colon, which is most real code, and it ignored single words, which is
 * what "Yes" is. The detector below is checked against known leaks in
 * `the detector actually detects` so that failure mode cannot recur silently.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
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
  'components/application/required-marker.tsx',
];

/**
 * Words that are interface text even on their own.
 *
 * Without these a bare `Yes` reads as an identifier and slips through, which
 * is exactly what happened before.
 */
const SOLO =
  /^(Yes|No|Apply|Why|Recommended|Optional|Required|Back|Continue|Next|Skip|Submit|Loading|Close|Open|Download|Print|Edit|Remove|Add|Save|Cancel|Total|Other|None|Unknown)$/;

/**
 * Properties whose string value is a protocol or platform constant.
 *
 * `method: "POST"` is not something an applicant reads, and no locale changes
 * it. Listed by name rather than by pattern so that adding one is a deliberate
 * decision.
 */
const TECHNICAL_PROPS =
  /^(method|credentials|mode|cache|redirect|referrerPolicy|integrity|charset)$/;

/** Tailwind utility prefixes — a class list is not prose. */
const TAILWIND = /^(border-|bg-|text-|rounded|flex|grid|mt-|px-|py-|w-|h-|space-|font-|gap-)/;

/**
 * Proper nouns that stay English in every language.
 *
 * Program and portal names are what the applicant will see on the county's own
 * website and on the printed form, so translating them would send someone
 * looking for something that does not exist.
 */
const PROPER_NOUNS = [
  'SAWS 2 PLUS',
  'Medi-Cal',
  'CalFresh',
  'CalWORKs',
  'BenefitsCal',
  'Covered California',
  'Kealu',
  'benefitscal.com',
  'coveredca.com',
];

function isProperNounOnly(text: string): boolean {
  let rest = text;
  for (const noun of PROPER_NOUNS) rest = rest.split(noun).join('');
  return rest.replace(/[\s.,;:—–-]/g, '') === '';
}

/**
 * Does this string look like something an applicant would read?
 *
 * `allowSingleWord` separates two positions. In a display position — a `label`
 * prop, a value in a label map — a lone capitalised word like "Weekly" is
 * display text by definition. In free JSX it could be an identifier, so there
 * a single word must be a known interface word.
 */
export function looksLikeProse(raw: string, allowSingleWord = false): boolean {
  /*
   * Interpolations are dropped first. `${shared} bg-green-700 text-white` is a
   * class list assembled from a constant, and leaving the `${...}` in front
   * defeated the class-list check below, which anchors on a lowercase word.
   */
  const text = raw.replace(/\$\{[^}]*\}/g, ' ').trim();

  if (text.length < 2 || !/[A-Za-z]/.test(text)) return false;
  if (TAILWIND.test(text)) return false;
  if (/^[a-z_$]+$/.test(text)) return false; // identifier
  if (/^[\w-]+$/.test(text) && !SOLO.test(text) && !allowSingleWord) {
    return false; // single bare token in free JSX — probably an identifier
  }
  if (/^https?:|^\/|^\.|@/.test(text)) return false; // url or path
  if (/^[a-z-]+(\s+[a-z0-9:./[\]-]+)+$/.test(text)) return false; // class list
  if (
    /\b(const|let|return|typeof|keyof|extends|undefined|null|true|false|await|async|new|throw|case|function|instanceof)\b/.test(
      text,
    )
  ) {
    return false;
  }
  if (/[=;]|=>|\(\)|\.\w+\(|\w+\.\w+|:\s*(string|number|boolean|undefined)/.test(text)) {
    return false;
  }

  if (text.split(/\s+/).length >= 2) return true;
  if (allowSingleWord) return /^[A-Z]/.test(text);

  return SOLO.test(text);
}

/** Props whose string value is displayed or read aloud. */
const VISIBLE_PROP =
  /\b(label|heading|title|placeholder|aria-label|alt|message|legend|description|prompt|hint)\s*[=:]\s*["']([^"']{2,})["']/g;

export interface Leak {
  line: number;
  kind: string;
  text: string;
}

/**
 * Applicant-visible English in one file.
 *
 * Block comments are blanked rather than skipped line by line, because a
 * continuation line of a comment is indistinguishable from prose on its own.
 */
export function leaksIn(source: string): Leak[] {
  const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  const lines = blanked
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    /*
     * Entities become a letter before any pattern runs.
     *
     * `&ldquo;` contains a semicolon, and the bare-prose pattern excludes
     * semicolons to skip statements — so `an &ldquo;Other&rdquo; box on page 1.
     * Tell us` never even reached the prose check. That is exactly how it
     * reached production. Decoding here rather than inside looksLikeProse
     * matters: by then the line has already been rejected.
     */
    .map((l) => l.replace(/&[a-z]+;/g, 'x'));
  const found: Leak[] = [];

  const push = (
    line: number,
    kind: string,
    text: string,
    allowSingleWord = false,
  ) => {
    const trimmed = text.trim();
    if (!looksLikeProse(trimmed, allowSingleWord)) return;
    if (isProperNounOnly(trimmed)) return;
    found.push({ line, kind, text: trimmed });
  };

  lines.forEach((line, index) => {
    const at = index + 1;

    for (const m of line.matchAll(VISIBLE_PROP)) {
      push(at, `prop ${m[1]}`, m[2], true);
    }

    // A display map:  status: "Likely eligible",
    for (const m of line.matchAll(/^\s*([\w_]+)\s*:\s*"([^"]{2,})"\s*,?\s*$/g)) {
      if (TECHNICAL_PROPS.test(m[1])) continue;
      if (!TAILWIND.test(m[2])) push(at, 'map value', m[2], true);
    }

    // A label tuple:  ["childAbuse", "Child abuse"]
    for (const m of line.matchAll(/\[\s*"[\w_]+"\s*,\s*"([^"]{2,})"\s*\]/g)) {
      push(at, 'tuple label', m[1], true);
    }

    // JSX text between tags on one line.
    for (const m of line.matchAll(/>([^<>{}]{2,})</g)) push(at, 'jsx text', m[1]);

    /*
      A bare line of JSX prose.

      Single words count here, not only the ones in SOLO: a lone capitalised
      word on its own line inside JSX is text, because an identifier would
      carry an operator, a call or a punctuation mark. `City` reached
      production as a hard-coded label precisely because the single-token
      filter treated it as code.
    */
    const bare = /^\s{4,}([A-Z][^<>{}=;:"'\[\]]*)$/.exec(line);
    if (bare) push(at, 'jsx prose', bare[1], true);

    // A sentence chosen by a ternary.
    for (const m of line.matchAll(/[?:]\s*["'`]([^"'`]{12,})["'`]/g)) {
      push(at, 'ternary text', m[1]);
    }

    // A template literal holding a sentence.
    for (const m of line.matchAll(/`([^`]*[A-Za-z]{3,}\s+[A-Za-z]{3,}[^`]*)`/g)) {
      const cleaned = m[1].replace(/\$\{[^}]*\}/g, '').trim();
      if (/^[A-Z]/.test(cleaned) && !/=["']|rel=|target=/.test(cleaned)) {
        push(at, 'template', cleaned);
      }
    }
  });

  return found;
}

describe('no applicant-visible English is hard-coded in the flow', () => {
  for (const relative of FLOW_COMPONENTS) {
    it(`${relative} routes every applicant-visible string through the catalog`, () => {
      const source = readFileSync(path.join(SRC, relative), 'utf8');
      const leaks = leaksIn(source);

      expect(
        leaks.map((l) => `L${l.line} [${l.kind}] ${l.text}`),
        `${relative} has hard-coded English an applicant can read`,
      ).toEqual([]);
    });
  }

  it('sweeps every component in the application directory', () => {
    const dir = path.join(SRC, 'components/application');
    const present = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `components/application/${f}`);

    // A new step joining the flow without joining this list would leave the
    // sweep quietly incomplete.
    expect(present.filter((f) => !FLOW_COMPONENTS.includes(f))).toEqual([]);
  });
});

describe('the detector actually detects', () => {
  // Regressions of the exact shapes the previous detector let through.
  const REAL_LEAKS: Array<[string, string]> = [
    ['a bare Yes button', '        >\n          Yes\n        </button>'],
    ['a label prop', '  <YesNoQuestion label="Are you currently homeless?" />'],
    ['a display map value', '  likely_eligible: "Likely eligible",'],
    ['a single-word option label', '  { value: "gas", label: "Gas" },'],
    ['a field label map value', '  employerName: "Employer name",'],
    ['a label tuple', '  ["childAbuse", "Child abuse"],'],
    ['an option label', '  { value: "weekly", label: "Weekly" },'],
    ['a ternary sentence', '  {count === 0 ? "No programs selected." : x}'],
    ['a template sentence', '  `Your ZIP code is in ${county} County, so it applies.`'],
    ['jsx text', '  <span>Health coverage only:</span>'],
    ['a lone capitalised label', '              City'],
    [
      'prose containing an HTML entity',
      '                The application has an &ldquo;Other&rdquo; box on page 1.',
    ],
  ];

  for (const [what, sample] of REAL_LEAKS) {
    it(`flags ${what}`, () => {
      expect(leaksIn(sample).length).toBeGreaterThan(0);
    });
  }

  const NOT_LEAKS: Array<[string, string]> = [
    ['a translated string', '          {t("ui_yes")}'],
    ['a catalog key in a map', '  likely_eligible: "status_likely_eligible",'],
    ['a class list', '  className="rounded-lg border border-slate-300 bg-white"'],
    ['a proper noun', '          SAWS 2 PLUS'],
    ['a program name', '          Medi-Cal'],
    ['an import', "import { useTranslation } from '@/hooks/use-translation';"],
    ['a type annotation', '  value: ApplicantInformation[K],'],
    ['a block comment', '/*\n  Household adults map to adult rows.\n*/'],
    ['a line comment', '  // Household adults map to adult rows.'],
    ['an HTTP method', '        method: "POST",'],
    [
      'an interpolated class list',
      '    ? `${shared} bg-green-700 text-white hover:bg-green-800`',
    ],
  ];

  for (const [what, sample] of NOT_LEAKS) {
    it(`does not flag ${what}`, () => {
      expect(leaksIn(sample)).toEqual([]);
    });
  }
});
