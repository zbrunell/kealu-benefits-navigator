//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Reported facts must never be replaced by internal normalizations.
 *
 * The form asks "HOW MUCH?" and "HOW OFTEN?". Writing a converted monthly
 * number beside the word "Monthly" would put a claim on a signed government
 * form that the applicant never made, and a county comparing it against pay
 * stubs would find a mismatch the applicant has to answer for.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  FREQUENCY_LABELS,
  monthlyEquivalent,
  monthlyForBudget,
  printableAmount,
} from '@/lib/reported-amounts';
import { writePath } from '@/lib/saws2-question-planner';
import {
  EMPTY_APPLICATION_DATA,
  type Saws2PlusApplicationData,
} from '@/types/application';
import type { PayFrequency } from '@/types/saws-questionnaire';

function withUnearned(
  entry: Record<string, unknown>,
): Saws2PlusApplicationData {
  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: [],
  };

  let questionnaire = writePath(
    base.questionnaire,
    'income.unearned.answer',
    true,
  );
  questionnaire = writePath(questionnaire, 'income.unearned.entries', [
    { id: 'r1', memberId: 'applicant', source: 'Unemployment', ...entry },
  ]);

  return { ...base, questionnaire };
}

/** The canonical entries the mapper produced for the first unearned record. */
function planned(entry: Record<string, unknown>): Record<string, unknown> {
  const plan = buildApplicationFieldPlan(withUnearned(entry), {});
  const out: Record<string, unknown> = {};

  for (const field of plan) {
    if (field.key.startsWith('income.unearned.0.')) {
      out[field.key.replace('income.unearned.0.', '')] = field.value;
    }
  }

  return out;
}

const FREQUENCIES: PayFrequency[] = [
  'weekly',
  'every_two_weeks',
  'twice_a_month',
  'monthly',
  'irregular',
];

describe('printed frequency wording', () => {
  it.each(FREQUENCIES)('%s has printable wording', (frequency) => {
    expect(FREQUENCY_LABELS[frequency]).toBeTruthy();
  });

  it('does not rename a frequency the applicant chose', () => {
    expect(FREQUENCY_LABELS.weekly).toBe('Weekly');
    expect(FREQUENCY_LABELS.every_two_weeks).toBe('Every two weeks');
    expect(FREQUENCY_LABELS.twice_a_month).toBe('Twice a month');
    expect(FREQUENCY_LABELS.monthly).toBe('Monthly');
  });
});

describe('reported values reach the form unchanged', () => {
  it.each([
    ['weekly', 200, 'Weekly'],
    ['every_two_weeks', 300, 'Every two weeks'],
    ['twice_a_month', 400, 'Twice a month'],
    ['monthly', 650, 'Monthly'],
  ] as Array<[PayFrequency, number, string]>)(
    '%s $%d prints as reported',
    (frequency, amount, label) => {
      const fields = planned({
        reportedAmount: amount,
        reportedFrequency: frequency,
      });

      expect(fields.reported_amount).toBe(amount);
      expect(fields.reported_frequency).toBe(label);
    },
  );

  it('never substitutes the monthly equivalent for the reported amount', () => {
    // $300 every two weeks is $650/month. The form must show 300, not 650.
    const fields = planned({
      reportedAmount: 300,
      reportedFrequency: 'every_two_weeks',
    });

    expect(fields.reported_amount).toBe(300);
    expect(fields.reported_frequency).toBe('Every two weeks');
    expect(fields.reported_amount).not.toBe(fields.amount_monthly);
  });

  it('keeps the monthly equivalent available for budgeting', () => {
    const fields = planned({
      reportedAmount: 300,
      reportedFrequency: 'every_two_weeks',
    });

    expect(fields.amount_monthly).toBe(650);
  });

  it('treats a one-time or irregular payment as irregular, not monthly', () => {
    const fields = planned({
      reportedAmount: 1200,
      reportedFrequency: 'irregular',
    });

    expect(fields.reported_amount).toBe(1200);
    expect(fields.reported_frequency).toBe('Irregular');
    // An irregular amount has no meaningful monthly multiple, so none is claimed.
    expect(fields.amount_monthly).toBeUndefined();
  });

  it('leaves the frequency blank when the applicant did not state one', () => {
    const fields = planned({ reportedAmount: 500 });

    expect(fields.reported_amount).toBe(500);
    expect(fields.reported_frequency).toBeUndefined();
  });

  it('still prints a legacy monthly figure as monthly', () => {
    // The questionnaire labelled this field "Monthly amount", so a value here
    // genuinely was reported as monthly.
    const fields = planned({ amountMonthly: 800 });

    expect(fields.reported_amount).toBe(800);
    expect(fields.reported_frequency).toBe('Monthly');
    expect(fields.amount_monthly).toBe(800);
  });

  it('prefers the reported pair over a stale legacy monthly figure', () => {
    const fields = planned({
      reportedAmount: 150,
      reportedFrequency: 'weekly',
      amountMonthly: 9999,
    });

    expect(fields.reported_amount).toBe(150);
    expect(fields.reported_frequency).toBe('Weekly');
  });

  it('emits nothing when no amount was given', () => {
    const fields = planned({});

    expect(fields.reported_amount).toBeUndefined();
    expect(fields.reported_frequency).toBeUndefined();
    expect(fields.amount_monthly).toBeUndefined();
  });
});

describe('monthlyEquivalent', () => {
  it('converts weekly using 52 weeks over 12 months', () => {
    expect(monthlyEquivalent(100, 'weekly')).toBeCloseTo(433.33, 2);
  });

  it('converts biweekly using 26 periods over 12 months', () => {
    expect(monthlyEquivalent(300, 'every_two_weeks')).toBe(650);
  });

  it('converts twice-a-month as exactly two periods', () => {
    expect(monthlyEquivalent(400, 'twice_a_month')).toBe(800);
  });

  it('leaves a monthly amount alone', () => {
    expect(monthlyEquivalent(650, 'monthly')).toBe(650);
  });

  it('refuses to convert an irregular amount', () => {
    expect(monthlyEquivalent(1000, 'irregular')).toBeUndefined();
  });

  it('refuses to convert without a frequency', () => {
    expect(monthlyEquivalent(1000, undefined)).toBeUndefined();
  });

  it('refuses to convert a missing amount', () => {
    expect(monthlyEquivalent(undefined, 'weekly')).toBeUndefined();
  });

  it('handles a reported zero as a real amount', () => {
    // 0 is an answer, not a missing value.
    expect(monthlyEquivalent(0, 'weekly')).toBe(0);
    expect(printableAmount({ reportedAmount: 0, reportedFrequency: 'weekly' })).toEqual(
      { amount: 0, frequency: 'Weekly' },
    );
    expect(monthlyForBudget({ reportedAmount: 0, reportedFrequency: 'weekly' })).toBe(
      0,
    );
  });
});

describe('the derived monthly figure never reaches the printed columns', () => {
  it('is emitted under a distinct canonical key', () => {
    const fields = planned({
      reportedAmount: 300,
      reportedFrequency: 'every_two_weeks',
    });

    // Three separate facts, three separate keys.
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        'reported_amount',
        'reported_frequency',
        'amount_monthly',
      ]),
    );
  });

  it('is not read by the PDF adapter for the how-much column', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');

    const adapter = readFileSync(
      path.resolve(
        __dirname,
        '../../../src/benefits_navigator/pdf_generator.py',
      ),
      'utf8',
    );

    // The Q7 writer loop, not the SAFE_FIELDS declaration that mentions the
    // same tuple name earlier in the file.
    const start = adapter.indexOf(
      'for row_index, row in enumerate(self.PAGE_8_UNEARNED_ROWS):',
    );
    // Searched from `start`: the same heading also appears above the table
    // declaration much earlier in the file.
    const end = adapter.indexOf('Page 10 — Q9 Other Income', start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const unearnedBlock = adapter.slice(start, end);

    expect(unearnedBlock).toContain('reported_amount');
    expect(unearnedBlock).toContain('reported_frequency');
    // The budgeting figure must not be written to the form.
    expect(unearnedBlock).not.toMatch(/set_field\([^)]*amount_monthly/);
  });
});
