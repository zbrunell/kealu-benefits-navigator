//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Texas support: a manual application, and a guide that stands on its own.
 *
 * The question these answer is not "does a Texas draft get produced" — none
 * does, deliberately — but "does a Texas household reach the end of the journey
 * with something useful?" Before this, the report route gated on
 * `state === "CA"` and a Texas household reached the report and stopped.
 *
 * Nothing here asserts anything about Form H1010's internals. The form has not
 * been inspected; if these tests referred to its fields they would be asserting
 * a guess.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildManualApplicationGuide } from '@/lib/manual-application-guide';
import {
  applicationForForm,
  applicationForState,
  hasGeneratedApplication,
  isSaws2PlusProgram,
  programBelongsToForm,
  supportedApplicationStates,
} from '@/lib/state-applications';
import { messages } from '@/i18n';
import { reason, reasonWith } from '@/lib/eligibility-reasons';
import { writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';
import {
  extractStructuredApplicationOutput,
  type ProgramRecommendation,
} from '@/lib/report-assembler';

// ---------------------------------------------------------------------------
// State routing
// ---------------------------------------------------------------------------

describe('state routing', () => {
  it('routes California to a generated application', () => {
    const definition = applicationForState('CA');

    expect(definition?.formId).toBe('CA_SAWS_2_PLUS');
    expect(definition?.delivery).toBe('generated');
    expect(hasGeneratedApplication('CA')).toBe(true);
  });

  it('routes Texas to a manual application', () => {
    const definition = applicationForState('TX');

    expect(definition?.formId).toBe('TX_H1010');
    expect(definition?.formCode).toBe('H1010');
    expect(definition?.delivery).toBe('manual');

    // The distinction that matters: manual is not "unsupported".
    expect(definition).not.toBeNull();
    expect(hasGeneratedApplication('TX')).toBe(false);
  });

  it('accepts lower case and padded state codes', () => {
    expect(applicationForState(' tx ')?.formId).toBe('TX_H1010');
    expect(applicationForState('ca')?.formId).toBe('CA_SAWS_2_PLUS');
  });

  it('returns nothing for a state we do not support yet', () => {
    for (const state of ['NY', 'IL', 'PA', '', undefined, null]) {
      expect(applicationForState(state), String(state)).toBeNull();
    }
  });

  it('supports exactly the two states we have verified', () => {
    expect(supportedApplicationStates().sort()).toEqual(['CA', 'TX']);
  });
});

// ---------------------------------------------------------------------------
// Programme membership
// ---------------------------------------------------------------------------

describe('programme membership', () => {
  it('puts the Texas programmes on the Texas form', () => {
    for (const program of ['tx_medicaid', 'tx_chip', 'tx_snap', 'tx_tanf']) {
      expect(programBelongsToForm('TX_H1010', program), program).toBe(true);
      expect(programBelongsToForm('CA_SAWS_2_PLUS', program), program).toBe(
        false,
      );
    }
  });

  it('keeps the California programmes on the California form', () => {
    for (const program of ['medi_cal', 'calfresh', 'calworks']) {
      expect(programBelongsToForm('CA_SAWS_2_PLUS', program), program).toBe(
        true,
      );
      expect(programBelongsToForm('TX_H1010', program), program).toBe(false);
    }
  });

  it('keeps the SAWS narrowing honest about what it covers', () => {
    // The SAWS components handle three programmes; the guard says so.
    expect(isSaws2PlusProgram('calfresh')).toBe(true);
    expect(isSaws2PlusProgram('tx_snap')).toBe(false);
  });

  it('recognises both forms and rejects an unknown one', () => {
    expect(applicationForForm('TX_H1010')?.state).toBe('TX');
    expect(applicationForForm('CA_SAWS_2_PLUS')?.state).toBe('CA');
    expect(applicationForForm('NY_LDSS_4826')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Representative households
// ---------------------------------------------------------------------------

interface HouseholdOptions {
  members?: number;
  income?: boolean;
  skipOptional?: boolean;
}

function household(options: HouseholdOptions = {}): Saws2PlusApplicationData {
  const { members = 0, income = false, skipOptional = false } = options;

  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Dana',
      middleName: skipOptional ? '' : 'Ray',
      lastName: 'Okafor',
      dateOfBirth: '1990-04-02',
      phone: skipOptional ? '' : '5125550100',
      email: skipOptional ? '' : 'dana@example.com',
      homeAddress: {
        ...EMPTY_APPLICATION_DATA.applicant.homeAddress,
        street: '900 Elm Street',
        apartment: skipOptional ? '' : 'Apt 4',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
      },
    },
    householdMembers: Array.from({ length: members }, (_, index) => ({
      id: `member-${index + 1}`,
      firstName: `Child${index + 1}`,
      middleName: '',
      lastName: 'Okafor',
      dateOfBirth: '2018-03-02',
      relationshipToApplicant: 'child',
    })) as Saws2PlusApplicationData['householdMembers'],
  };

  if (!income) return base;

  return {
    ...base,
    questionnaire: writePath(base.questionnaire, 'income.earned.answer', true),
  };
}

const TX_RECOMMENDATIONS: ProgramRecommendation[] = [
  {
    program: 'tx_snap',
    status: 'likely_eligible',
    recommendedToApply: true,
    reasons: [reasonWith('elig_calfresh_gross_below_130', { fplPercent: 64, householdSize: 1 })],
    missingInformation: [reason('missing_monthly_rent_or_mortgage')],
    confidence: 0.87,
  },
  {
    program: 'tx_medicaid',
    status: 'possibly_eligible',
    recommendedToApply: true,
    reasons: [reason('elig_ca_medicaid_expansion')],
    missingInformation: [],
    confidence: 0.7,
  },
];

const guideFor = (options: HouseholdOptions = {}) =>
  buildManualApplicationGuide(
    applicationForState('TX')!,
    TX_RECOMMENDATIONS,
    household(options),
  );

describe('the Texas guide, across representative households', () => {
  const cases: Array<[string, HouseholdOptions]> = [
    ['a single adult', {}],
    ['an adult with one child', { members: 1 }],
    ['a multi-person household', { members: 3 }],
    ['a household with income', { income: true }],
    ['a household that skipped optional answers', { skipOptional: true }],
  ];

  for (const [name, options] of cases) {
    it(`${name} gets a usable guide`, () => {
      const guide = guideFor(options);

      // The four things the applicant needs: what, why, where, and next steps.
      expect(guide.formCode).toBe('H1010');
      expect(guide.programs.length).toBeGreaterThan(0);
      expect(guide.officialUrl).toMatch(/^https:\/\//);
      expect(guide.steps.length).toBeGreaterThan(0);

      // Every programme says why, in resolvable keys.
      for (const program of guide.programs) {
        expect(program.reasons.length, program.program).toBeGreaterThan(0);
      }
    });
  }

  it('carries only the answers the applicant actually gave', () => {
    const complete = guideFor();
    const skipped = guideFor({ skipOptional: true });

    const labels = (guide: ReturnType<typeof guideFor>) =>
      guide.carriedAnswers.map((answer) => answer.labelKey);

    expect(labels(complete)).toContain('field_email');
    expect(labels(complete)).toContain('field_apartment');

    /*
     * A skipped optional answer produces no row rather than an empty one: a
     * checklist that lists everything and marks most of it blank is harder to
     * use than one that lists what you have.
     */
    expect(labels(skipped)).not.toContain('field_email');
    expect(labels(skipped)).not.toContain('field_apartment');

    // What they did give is still carried.
    expect(labels(skipped)).toContain('field_first_name');
    expect(labels(skipped)).toContain('field_zip_code');
  });

  it('counts the household, including the applicant', () => {
    const size = (options: HouseholdOptions) =>
      guideFor(options).carriedAnswers.find(
        (answer) => answer.labelKey === 'field_household_size',
      )?.value;

    expect(size({})).toBe('1');
    expect(size({ members: 1 })).toBe('2');
    expect(size({ members: 3 })).toBe('4');
  });

  it('never invents a value for something the applicant left blank', () => {
    for (const answer of guideFor({ skipOptional: true }).carriedAnswers) {
      expect(answer.value.trim(), answer.labelKey).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// Missing data fails safely
// ---------------------------------------------------------------------------

describe('missing information becomes a manual item, not a silence', () => {
  it('always names what we never collect', () => {
    const keys = guideFor().notCollected.map((item) => item.key);

    expect(keys).toContain('manual_missing_ssn');
    expect(keys).toContain('manual_missing_signature');
    expect(keys).toContain('manual_missing_immigration_documents');
  });

  it('asks for income detail only when income was reported', () => {
    expect(guideFor({ income: true }).notCollected.map((i) => i.key)).toContain(
      'manual_missing_income_detail',
    );

    // Nothing to elaborate on when the household reported no income.
    expect(guideFor().notCollected.map((i) => i.key)).not.toContain(
      'manual_missing_income_detail',
    );
  });

  it('passes the screening’s own missing-information through', () => {
    const snap = guideFor().programs.find((p) => p.program === 'tx_snap');

    expect(snap?.missingInformation.length).toBe(1);
  });

  it('resolves every key it emits', () => {
    const guide = guideFor({ income: true, members: 2 });
    const catalog = messages.en as unknown as Record<string, string>;

    const keys = [
      guide.formNameKey,
      guide.howToApplyKey,
      ...guide.steps.map((step) => step.key),
      ...guide.notCollected.map((item) => item.key),
      ...guide.programs.map((program) => program.nameKey),
      ...guide.carriedAnswers.map((answer) => answer.labelKey),
      ...guide.channels.map((channel) => `manual_channel_${channel}`),
    ];

    for (const key of keys) {
      expect(catalog[key], key).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Parsing a Texas application
// ---------------------------------------------------------------------------

describe('the structured-output parser accepts Texas', () => {
  /** A well-formed application block for a form, as the workflow emits it. */
  function block(formId: string, programs: string[]) {
    return {
      schemaVersion: 1,
      applications: [
        {
          formId,
          recommended: true,
          programs: programs.map((program) => ({
            program,
            status: 'likely_eligible',
            recommendedToApply: true,
            reasons: [{ key: 'elig_calfresh_no_asset_test' }],
            missingInformation: [],
            confidence: 0.8,
          })),
        },
      ],
    };
  }

  const parse = (payload: unknown) =>
    extractStructuredApplicationOutput(
      `## Structured Application Output\n\n\`\`\`json\n${JSON.stringify(
        payload,
      )}\n\`\`\`\n`,
    );

  it('parses a complete Texas application', () => {
    /*
     * The bug this pins: both the programme guard and the completeness check
     * compared against California's three programmes by name, so a perfectly
     * well-formed Texas application was dropped without a trace.
     */
    const parsed = parse(
      block('TX_H1010', ['tx_medicaid', 'tx_chip', 'tx_snap', 'tx_tanf']),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.formId).toBe('TX_H1010');
    expect(parsed[0]?.programs).toHaveLength(4);
  });

  it('still parses a complete California application', () => {
    const parsed = parse(
      block('CA_SAWS_2_PLUS', ['medi_cal', 'calfresh', 'calworks']),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.programs).toHaveLength(3);
  });

  it('rejects an application missing one of its form’s programmes', () => {
    expect(parse(block('TX_H1010', ['tx_snap', 'tx_tanf']))).toEqual([]);
    expect(parse(block('CA_SAWS_2_PLUS', ['medi_cal']))).toEqual([]);
  });

  it('rejects a programme belonging to another state’s form', () => {
    // Four programmes, right count, wrong form — the strictness the
    // registry-driven check buys over counting by name.
    expect(
      parse(block('TX_H1010', ['tx_medicaid', 'tx_chip', 'tx_snap', 'calfresh'])),
    ).toEqual([]);
  });

  it('rejects an unknown form', () => {
    expect(parse(block('NY_LDSS_4826', ['tx_snap']))).toEqual([]);
  });

  it('collects recommended programmes from whichever form is present', () => {
    /*
     * The fifth California assumption: the assembly layer derived
     * `recommendedPrograms` by looking for CA_SAWS_2_PLUS by name, so a Texas
     * household's recommended programmes came back empty however well the
     * screening had done its job.
     *
     * Asserted against the assembler's own derivation rather than the parser,
     * since that is where the name was hard-coded.
     */
    const source = readFileSync(
      path.resolve(__dirname, '../../src/lib/report-assembler.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const derivation = source.slice(source.indexOf('const recommendedPrograms'));

    expect(derivation).not.toContain('CA_SAWS_2_PLUS');
    expect(derivation).toContain('applicationRecommendations.flatMap');
  });
});

// ---------------------------------------------------------------------------
// The availability gate
// ---------------------------------------------------------------------------

describe('the report offers an application by state, not by name', () => {
  const raw = readFileSync(
    path.resolve(__dirname, '../../src/app/api/workflow/[runId]/report/route.ts'),
    'utf8',
  );

  /*
   * Comments blanked before matching. The helper's own doc comment describes
   * the `state === "CA"` check it replaced, and a naive search finds that
   * explanation and reports the regression it is documenting.
   */
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');

  it('no longer decides availability by naming California', () => {
    /*
     * The regression this replaces: two copies of `state === "CA"`, one on the
     * cached path and one on the fresh path, each also hard-coding the form id
     * and name. A Texas household reached the report and stopped there.
     */
    expect(source).not.toMatch(/=== ["']CA["']/);
    expect(source).not.toContain('formId: "CA_SAWS_2_PLUS"');
    expect(source).toContain('applicationForState');
  });

  it('decides it once, for both the cached and fresh paths', () => {
    const calls = source.match(/applicationSummaryFor\(/g) ?? [];

    // One definition, two call sites.
    expect(calls.length).toBe(3);
  });

  it('gives a manual application no prefill', () => {
    // Prefill exists to fill a form; there is no form being filled.
    expect(source).toMatch(/delivery === "generated" \? prefill : null/);
  });
});

// ---------------------------------------------------------------------------
// The two kinds stay distinct
// ---------------------------------------------------------------------------

describe('generated and manual stay separate kinds', () => {
  it('drops a recommendation for a programme on another state’s form', () => {
    const guide = buildManualApplicationGuide(
      applicationForState('TX')!,
      [
        ...TX_RECOMMENDATIONS,
        {
          program: 'calfresh',
          status: 'likely_eligible',
          recommendedToApply: true,
          reasons: [reason('elig_calfresh_no_asset_test')],
          missingInformation: [],
          confidence: 0.9,
        },
      ],
      household(),
    );

    /*
     * A CalFresh recommendation on a Texas guide would send the applicant to
     * the wrong agency, so it is dropped rather than listed.
     */
    expect(guide.programs.map((p) => p.program)).not.toContain('calfresh');
    expect(guide.programs.map((p) => p.program)).toContain('tx_snap');
  });

  it('does not describe the Texas form as fillable anywhere', () => {
    const definition = applicationForState('TX')!;

    // No prefill, no field map, no page references: the form is uninspected.
    expect(definition.delivery).toBe('manual');
    expect(Object.keys(definition)).not.toContain('fields');
    expect(Object.keys(definition)).not.toContain('template');
  });

  it('keeps California generated, unchanged', () => {
    const definition = applicationForState('CA')!;

    expect(definition.delivery).toBe('generated');
    expect(definition.programs).toEqual(['medi_cal', 'calfresh', 'calworks']);
    expect(definition.formCode).toBe('SAWS 2 PLUS');
  });
});
