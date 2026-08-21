//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Coverage for the SAWS 2 PLUS application flow:
 *
 * - newly added UI questions persist into normalized application state and reach
 *   the canonical field plan,
 * - the UI never asks for a Social Security Number and never fabricates one,
 * - the structured application output is still produced internally but is no
 *   longer rendered in the Action Plan,
 * - the post-generation guide offers the download, the manual-completion steps,
 *   and safe submission instructions.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import { messages } from '@/i18n';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { assembleReport } from '@/lib/report-assembler';
import { buildFixturePhaseDocuments } from '@/lib/e2e-fixture';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';

const SRC = path.resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function planFor(overrides: Partial<Saws2PlusApplicationData>) {
  return buildApplicationFieldPlan({ ...EMPTY_APPLICATION_DATA, ...overrides });
}

function valueOf(plan: ReturnType<typeof buildApplicationFieldPlan>, key: string) {
  return plan.find((field) => field.key === key)?.value;
}

// ---------------------------------------------------------------------------
// New UI answers reach the field plan
// ---------------------------------------------------------------------------

describe('newly collected page-1 answers reach the SAWS field plan', () => {
  it('carries other names and the alternate phone', () => {
    const plan = planFor({
      applicant: {
        ...EMPTY_APPLICATION_DATA.applicant,
        firstName: 'Maria',
        lastName: 'Delgado',
        otherNames: 'Maria Ruiz',
        phone: '323-555-0142',
        alternatePhone: '323-555-9911',
      },
    });

    expect(valueOf(plan, 'applicant.other_names')).toBe('Maria Ruiz');
    expect(valueOf(plan, 'applicant.alternate_phone')).toBe('323-555-9911');
  });

  it('carries the "Other" program request and its description', () => {
    const plan = planFor({
      otherProgramRequested: true,
      otherProgramDescription: 'General Relief',
    });

    expect(valueOf(plan, 'programs.other')).toBe(true);
    expect(valueOf(plan, 'programs.other_description')).toBe('General Relief');
  });

  it('omits the "Other" program entirely when it was not requested', () => {
    const plan = planFor({ otherProgramRequested: undefined });

    expect(valueOf(plan, 'programs.other')).toBeUndefined();
    expect(valueOf(plan, 'programs.other_description')).toBeUndefined();
  });

  it('omits unanswered optional fields rather than sending empty values', () => {
    const plan = planFor({});

    expect(valueOf(plan, 'applicant.other_names')).toBeUndefined();
    expect(valueOf(plan, 'applicant.alternate_phone')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Privacy boundary
// ---------------------------------------------------------------------------

describe('privacy boundary', () => {
  const files = sourceFiles(SRC);

  /**
   * The invariant is that no form control *collects* an SSN — not that the
   * string never appears. Explanatory copy ("Social Security numbers are
   * intentionally not collected") and the manual-completion guide are expected
   * to mention it, as is the mapper's blocklist.
   */
  it('no UI control is bound to a Social Security Number', () => {
    const offenders: Array<{ file: string; line: string }> = [];

    const SSN_BINDING = [
      /name\s*=\s*["'{]\s*[^"'}]*\bssn\b/i,
      /id\s*=\s*["'{]\s*[^"'}]*\bssn\b/i,
      /(?:value|checked|defaultValue)\s*=\s*\{[^}]*(?:\bssn\b|socialsecurity)/i,
      /autoComplete\s*=\s*["'][^"']*\bssn\b/i,
      /on(?:Change|Input)\s*=\s*\{[^}]*(?:\bssn\b|socialsecurity)/i,
      /placeholder\s*=\s*["'][^"']*social security/i,
      /aria-label\s*=\s*["'][^"']*social security/i,
    ];

    for (const file of files) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (SSN_BINDING.some((pattern) => pattern.test(line))) {
          offenders.push({ file: path.relative(SRC, file), line: line.trim() });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * Only these files may mention Social Security Numbers, and only for the
   * documented reason. Anywhere else, a mention would suggest we started
   * collecting them — so a new file appearing here is a deliberate review gate
   * rather than a silent change.
   */
  it('only the documented files mention Social Security Numbers', () => {
    const ALLOWED: Record<string, string> = {
      'lib/application-mapper.ts':
        'blocklist of sensitive semantic keys that may never be prefilled',
      'components/application/applicant-step.tsx':
        'copy telling the user SSN and signature fields are intentionally not collected',
      'components/application/household-step.tsx':
        'copy telling the user SSNs are intentionally not collected',
      'components/application/draft-completion-guide.tsx':
        'post-generation instruction to write SSNs on the printed form by hand',
      'lib/saws2-question-planner.ts':
        'names Social Security as an example of an unearned-income source; it never asks for a number',
      'lib/saws2-readiness.ts':
        'states the 42 CFR 435.910 SSN requirement as a manual-completion item the applicant writes by hand; it never collects or stores one',
      'lib/saws2-schema.ts':
        'declares Q6c SSN as manual-only with no path, no canonical key and no PDF destination — the declaration is what forbids collection',
      'types/saws-questionnaire.ts':
        'documents that Appendix A item 2 (the employee SSN) has deliberately no field in the model, which is what makes it unstorable',
      'lib/printed-labels.ts':
        'quotes the form’s own printed SSN column headings, in English and in verified Spanish, so the guide can tell a reader what to look for; it holds no SSN value',
      'lib/saws2-inventory.ts':
        'classifies printed question Q6c as manual_ssn so readiness can report it as the applicant’s own step; it holds no SSN value',
      'lib/draft-completion.ts':
        'locates each printed SSN blank this draft leaves for a person to fill and names whose it is; it never carries a number, which is the reason the box was left blank',
      'lib/completion-guide.ts':
        'section heading and standing explanation for the SSN blanks the guide lists; it reads locations from draft-completion and never a value',
      'lib/completion-guide-html.ts':
        'closing note on the printed guide restating that Kealu never writes an SSN onto a form; it renders text it is given and holds none of its own',
      'i18n/messages/en.ts': 'manual-completion instruction shown after generation',
      'i18n/messages/es.ts': 'Spanish translation of the same instruction',
      'i18n/messages/zh-CN.ts': 'Chinese translation of the same instruction',
    };

    const mentions = files
      .filter((file) => /\bssn\b|social security|seguro social/i.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
      .sort();

    for (const file of mentions) {
      expect(ALLOWED, `${file} mentions SSNs but is not on the reviewed list`).toHaveProperty(
        file,
      );
    }
  });

  it('the application data model has no SSN or signature field', () => {
    const model = readFileSync(path.join(SRC, 'types/application.ts'), 'utf8');

    expect(/\bssn\b/i.test(model)).toBe(false);
    expect(/socialSecurity/i.test(model)).toBe(false);
    expect(/signature/i.test(model)).toBe(false);
  });

  it('the field plan never contains an SSN or signature key', () => {
    const plan = planFor({
      applicant: {
        ...EMPTY_APPLICATION_DATA.applicant,
        firstName: 'Maria',
        lastName: 'Delgado',
        otherNames: 'Maria Ruiz',
      },
      otherProgramRequested: true,
      otherProgramDescription: 'General Relief',
      householdMembers: [
        {
          id: 'm1',
          firstName: 'Luis',
          middleName: '',
          lastName: 'Delgado',
          dateOfBirth: '1995-09-02',
          relationshipToApplicant: 'Spouse',
        },
      ],
    });

    for (const field of plan) {
      expect(field.key).not.toMatch(/ssn|social_security|signature|signed/i);
    }
  });

  it('keeps the sensitive-key guard in the mapper', () => {
    const mapperSource = readFileSync(
      path.join(SRC, 'lib/application-mapper.ts'),
      'utf8',
    );

    expect(mapperSource).toContain('Sensitive application field cannot be prefilled');

    // The guard must still cover both SSN and signature spellings.
    for (const marker of ['ssn', 'social_security', 'signature', 'signed']) {
      expect(mapperSource).toContain(`"${marker}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Structured output stays internal
// ---------------------------------------------------------------------------

describe('structured application output', () => {
  async function assembleFixtureReport() {
    const base = await mkdtemp(path.join(tmpdir(), 'saws-coverage-'));
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await mkdir(path.join(base, runId), { recursive: true });

    const docs = buildFixturePhaseDocuments({
      zip_code: '90001',
      annual_income: '32000',
      household_profile: 'me and my 6 year old',
    });

    for (const [phase, content] of Object.entries(docs)) {
      await writeFile(path.join(base, runId, `${phase}.md`), content, 'utf8');
    }

    return assembleReport(runId, base);
  }

  it('is still generated internally by the workflow output', () => {
    const docs = buildFixturePhaseDocuments({
      zip_code: '90001',
      annual_income: '32000',
      household_profile: 'me and my 6 year old',
    });

    expect(docs['action-plan']).toContain('## Structured Application Output');
    expect(docs['action-plan']).toContain('"schemaVersion": 1');
  });

  it('still produces SAWS recommendations after assembly', async () => {
    const payload = await assembleFixtureReport();
    const saws = payload.application.recommendations.find(
      (application) => application.formId === 'CA_SAWS_2_PLUS',
    );

    expect(saws).toBeDefined();
    expect(saws?.programs).toHaveLength(3);
  });

  it('is no longer shown in the user-facing Action Plan', async () => {
    const payload = await assembleFixtureReport();
    const actionPlan = payload.sections.find(
      (section) => section.phaseName === 'action-plan',
    );

    expect(actionPlan).toBeDefined();
    expect(actionPlan?.content).not.toContain('Structured Application Output');
    expect(actionPlan?.content).not.toContain('schemaVersion');
    expect(actionPlan?.content).not.toContain('```json');
  });

  it('leaves the rest of the Action Plan intact', async () => {
    const payload = await assembleFixtureReport();
    const actionPlan = payload.sections.find(
      (section) => section.phaseName === 'action-plan',
    );

    expect(actionPlan?.content).toContain('## Bottom Line');
    expect(actionPlan?.content).toContain('## Document Checklist');
    // A section that follows the stripped block must survive.
    expect(actionPlan?.content).toContain('## Income Cliff Warnings');
    expect(payload.bottomLine.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Post-generation experience
// ---------------------------------------------------------------------------

describe('post-generation completion guide', () => {
  const guide = readFileSync(
    path.join(SRC, 'components/application/draft-completion-guide.tsx'),
    'utf8',
  );

  it('offers the PDF download', () => {
    expect(guide).toContain('data-testid="draft-download"');
    /*
     * The label lives in the catalog now, so this asserts the component asks
     * for it and that English still reads the same. Grepping the component for
     * "Download draft" would fail the moment the string was translated, which
     * is the opposite of what this test is protecting.
     */
    expect(guide).toContain('dcg_download_draft');
    expect(messages.en.dcg_download_draft).toBe('Download draft');
    expect(guide).toContain('?download=1');
  });

  it('shows manual-completion instructions for SSNs and signatures', () => {
    expect(guide).toContain('data-testid="manual-completion-guide"');
    /*
     * The steps are catalog keys now, so the component is checked for the keys
     * and the English catalog for the wording. Grepping the component for the
     * English sentence would fail as soon as it was translated — the opposite
     * of what this test protects.
     */
    expect(guide).toContain('dcg_step_ssn_title');
    expect(guide).toContain('dcg_step_sign_title');
    expect(guide).toContain('dcg_step_review_title');
    expect(messages.en.dcg_step_ssn_detail).toMatch(/Social Security Number/);
    expect(messages.en.dcg_step_sign_title).toMatch(/Sign and date/);
    expect(messages.en.dcg_step_review_title).toMatch(/[Rr]eview every prefilled answer/);
  });

  it('shows submission instructions without inventing a destination', () => {
    expect(guide).toContain('data-testid="submission-instructions"');
    expect(guide).toContain('benefitscal.com');

    // No fabricated street address, phone number, or fax number.
    expect(guide).not.toMatch(/\b\d{3}-\d{3}-\d{4}\b/);
    expect(guide).not.toMatch(/\bfax:\s*\+?\d/i);
    expect(guide).not.toMatch(/\b\d{2,5}\s+[A-Z][a-z]+\s+(Street|St\.|Ave|Avenue|Blvd)\b/);
  });

  it('explains how to find the county office when the county is unknown', () => {
    // Guessing an address is worse than saying we do not know one, so the
    // unresolved-county branch has to exist and has to say so.
    expect(guide).toContain('dcg_county_unknown');
    expect(messages.en.dcg_county_unknown).toMatch(
      /could not determine your county/i,
    );

    // And the resolved branch names the county rather than concatenating it.
    expect(guide).toContain('dcg_county_known');
    expect(messages.en.dcg_county_known).toMatch(/\{county\}/);
  });

  it('offers the printable guide beside the draft', () => {
    expect(guide).toContain('data-testid="completion-guide-download"');
    expect(guide).toContain('dcg_open_guide');
    expect(messages.en.dcg_open_guide).toBe('Open guide');
    expect(guide).toContain('dcg_download_guide');
    expect(messages.en.dcg_download_guide).toBe('Download guide');
    expect(guide).toContain('dcg_helper_guide');
    expect(messages.en.dcg_helper_guide).toBe('Version for someone helping you');
  });

  it('uses real links, so every action is keyboard reachable', () => {
    /*
     * Anchors rather than click handlers on a div: an <a href> is focusable,
     * activates on Enter, and offers "open in new tab" — none of which a
     * div-with-onClick gives someone navigating by keyboard.
     */
    // Located by catalog key, since the visible label is translated.
    for (const action of [
      'dcg_open_guide',
      'dcg_download_guide',
      'dcg_helper_guide',
    ]) {
      const before = guide.slice(0, guide.indexOf(action));

      expect(before.lastIndexOf('<a'), action).toBeGreaterThan(
        before.lastIndexOf('<button'),
      );
    }
  });

  it('tells the user the guide can be printed and kept beside the form', () => {
    /*
     * This used to assert a separate paragraph explaining the browser's Print
     * command and US Letter paper. That paragraph was the clutter: the action
     * row already offers Open and Download, so the one thing the applicant
     * could not work out for themselves is that printing it and keeping it
     * beside the application is what it is for. The intro now says that, and
     * says it once.
     */
    expect(guide).toContain('dcg_guide_intro');
    expect(messages.en.dcg_guide_intro).toMatch(/print/i);
    expect(messages.en.dcg_guide_intro).toMatch(/beside the application/i);
  });

  it('offers exactly two actions on the guide, named plainly', () => {
    expect(messages.en.dcg_open_guide).toBe('Open guide');
    expect(messages.en.dcg_download_guide).toBe('Download guide');

    // "Open printable guide" duplicated in the label what the intro explains.
    for (const locale of ['en', 'es', 'zh-CN'] as const) {
      const catalog = messages[locale] as unknown as Record<string, string>;

      expect(catalog.dcg_open_guide, locale).not.toMatch(
        /printable|imprimir|可打印/i,
      );
    }
  });

  it('shows the reference that pairs a guide with its draft', () => {
    // The reference is interpolated into one sentence rather than wrapped in
    // prose, so a translator can put it where their language needs it.
    expect(guide).toContain('dcg_draft_reference');
    // Split on the translated string, so the reference keeps its monospace
    // styling without pinning English word order into the component.
    expect(guide.replace(/\s+/g, ' ')).toContain('split( "{reference}", )');
    expect(guide).toContain('{draftReference}');
    expect(messages.en.dcg_draft_reference).toMatch(/\{reference\}/);
    expect(messages.en.dcg_draft_reference).toMatch(
      /which guide goes with which draft/i,
    );
  });

  it('is wired into the application view after generation', () => {
    const view = readFileSync(
      path.join(SRC, 'components/application-view.tsx'),
      'utf8',
    );

    expect(view).toContain('DraftCompletionGuide');
    expect(view).toContain('draftUrl={draftUrl}');
    expect(view).toContain('guideUrl={guideUrl}');
    expect(view).toContain('draftReference={draftReference}');
  });
});
