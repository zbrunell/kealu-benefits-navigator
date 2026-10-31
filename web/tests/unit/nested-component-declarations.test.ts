//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * No component may be declared inside another component.
 *
 * The bug this exists for cost an applicant the ability to type. Texas's
 * `Frame` and `Navigation` were declared inside `TexasApplicationView`, so
 * every render produced new function identities; React saw a different element
 * type, unmounted the subtree and mounted a fresh one, and every input inside
 * became a new DOM node. Focus had nothing to survive on, so a household
 * member's name field accepted one character at a time.
 *
 * ── Why a static check and not only a browser test ─────────────────────────
 * `tests/e2e/tx-household-members.spec.ts` proves the symptom is gone by
 * typing continuously in a real browser, which is the only way to reproduce
 * it. But that covers one field on one screen. The defect is a *shape*, it can
 * be reintroduced anywhere, and its symptom — losing focus mid-word — is one
 * nobody notices while clicking through a page they already know.
 *
 * So this reads the source. It is a lint rule the project does not have
 * (`react/no-unstable-nested-components` is not in the enabled config), scoped
 * to the components an applicant fills a form in.
 *
 * ── What counts as a violation ─────────────────────────────────────────────
 * A `function` whose name starts with a capital letter, or a `const` assigned
 * an arrow function whose name starts with a capital letter, declared at an
 * indentation deeper than module scope. Component names are capitalised by
 * convention and JSX requires it, so the capital is what distinguishes a
 * component from a helper — `function missingOnScreen()` nested inside a
 * component is ordinary and fine, because it returns data rather than
 * elements.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');

/** Directories whose components an applicant types into. */
const FLOW_DIRECTORIES = [
  'components',
  'components/application',
  'components/intake',
  'components/texas',
];

function tsxFilesIn(relative: string): string[] {
  const directory = path.join(SRC, relative);

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => path.join(relative, entry.name));
}

/** Lines declaring a capitalised function or arrow function, when indented. */
function nestedComponentsIn(source: string): string[] {
  const found: string[] = [];
  let inBlockComment = false;

  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();

    // Comments describe; they do not declare.
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }

    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      return;
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    const indent = line.length - line.trimStart().length;

    if (indent === 0) return;

    const declaration =
      /^(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*[(<]/.exec(trimmed) ??
      /^(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?=>/.exec(
        trimmed,
      );

    if (declaration) {
      found.push(`L${index + 1}: ${trimmed.slice(0, 72)}`);
    }
  });

  return found;
}

describe('no component is declared inside another component', () => {
  const files = FLOW_DIRECTORIES.flatMap(tsxFilesIn);

  it('finds the flow components to check', () => {
    // A sweep that silently checks nothing is worse than no sweep.
    expect(files.length).toBeGreaterThan(8);
    expect(files).toContain('components/texas/texas-application-view.tsx');
  });

  for (const relative of files) {
    it(`${relative} declares its components at module scope`, () => {
      const source = readFileSync(path.join(SRC, relative), 'utf8');

      expect(
        nestedComponentsIn(source),
        `${relative} declares a component inside another component. React `
          + 'treats each render\'s copy as a different element type, so the '
          + 'whole subtree is remounted and every input inside it loses focus '
          + '— the one-character-at-a-time bug. Move it to module scope and '
          + 'pass what it needs as props.',
      ).toEqual([]);
    });
  }
});

describe('the detector actually detects', () => {
  it('flags a nested function component', () => {
    expect(
      nestedComponentsIn(
        ['export default function View() {', '  function Frame() {', '    return null;', '  }', '}'].join(
          '\n',
        ),
      ),
    ).toHaveLength(1);
  });

  it('flags a nested arrow component', () => {
    expect(
      nestedComponentsIn(
        ['function View() {', '  const Row = () => <li />;', '}'].join('\n'),
      ),
    ).toHaveLength(1);
  });

  it('flags a typed nested arrow component', () => {
    expect(
      nestedComponentsIn(
        ['function View() {', '  const Row: FC<Props> = (props) => <li />;', '}'].join('\n'),
      ),
    ).toHaveLength(1);
  });

  it('does not flag a module-scope component', () => {
    expect(
      nestedComponentsIn(['function Frame() {', '  return null;', '}'].join('\n')),
    ).toEqual([]);
  });

  it('does not flag a nested helper that returns data', () => {
    expect(
      nestedComponentsIn(
        ['function View() {', '  function missingOnScreen() {', '    return [];', '  }', '}'].join(
          '\n',
        ),
      ),
    ).toEqual([]);
  });

  it('does not flag a nested lowercase callback', () => {
    expect(
      nestedComponentsIn(['function View() {', '  const update = (n) => n + 1;', '}'].join('\n')),
    ).toEqual([]);
  });

  it('does not flag a component named in a comment', () => {
    expect(
      nestedComponentsIn(
        [
          'function View() {',
          '  /* function Frame() was moved to module scope */',
          '  // const Row = () => <li />;',
          '}',
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});
