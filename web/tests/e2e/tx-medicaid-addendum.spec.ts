/**
 * Texas's Medicaid / CHIP addendum, from the screens to the printed form.
 *
 * A two-adult Austin household applying for food benefits and Medicaid: the
 * addendum's screens appear, ask only what applies, open their follow-ups from
 * their own answers, and the answers reach HHSC's form and the review sheet.
 *
 * Runs in the `applications` project (demo mode), so it exercises the real
 * intake, field plan and PDF generation with the analysis stubbed.
 */
import { test, expect, type Page } from '@playwright/test';

import { AUSTIN_TIER_1_ANSWERS, completeIntakeAndAwaitReport } from './support/app';
import {
  answerYesNo,
  completeApplicantStep,
  completeScreen,
  fillQuestion,
  questionIsVisible,
  visibleSections,
} from './support/texas';
import en from '../../src/i18n/messages/en';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

let page: Page;

/** Every section shown on the way to review, in order. */
const seen: string[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);

  page = await browser.newPage();

  await page.goto('/');
  await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
});

test.afterAll(async () => {
  await page?.close();
});

/** Tick a programme on the selection screen by the name it shows. */
async function tick(name: string): Promise<void> {
  const box = page
    .locator('label')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .getByRole('checkbox');

  if (!(await box.isChecked())) await box.check();
}

/** The answers this household gives on each addendum screen. */
async function answerAddendum(sections: readonly string[]): Promise<void> {
  if (sections.includes('tx-tax-0')) {
    await answerYesNo(page, 'tx.tax.0.plans_to_file', true);
    await answerYesNo(page, 'tx.tax.0.files_jointly', true);
    await answerYesNo(page, 'tx.tax.0.fears_harm', false);
    await answerYesNo(page, 'tx.tax.0.claims_dependents', true);
    await fillQuestion(page, 'tx.tax.0.dependent_names', 'Teo Ramirez');
    await answerYesNo(page, 'tx.tax.0.claimed_as_dependent', false);
    await answerYesNo(page, 'tx.tax.1.plans_to_file', false);
    await answerYesNo(page, 'tx.tax.1.claims_dependents', false);
    await answerYesNo(page, 'tx.tax.1.claimed_as_dependent', false);
  }

  if (sections.includes('tx-deductions')) {
    await answerYesNo(page, 'tx.deductions.any', false);
  }

  if (sections.includes('tx-job-coverage')) {
    await answerYesNo(page, 'tx.coverage.job_offers', true);
    await answerYesNo(page, 'tx.coverage.lost', false);

    await page.getByTestId('record-list-tx-employer-coverage-add').click();
    await fillQuestion(page, 'tx-employer-coverage-0-employerName', 'H-E-B Grocery');

    // Item 13 opens the plan questions; before it, they are not asked.
    expect(
      await questionIsVisible(page, 'tx-employer-coverage-0-lowestCostPremium'),
    ).toBe(false);

    await answerYesNo(page, 'tx-employer-coverage-0-eligibleNowOrSoon', true);
    await fillQuestion(page, 'tx-employer-coverage-0-lowestCostPremium', '120');
  }

  if (sections.includes('tx-health-people')) {
    // Nobody said they were ever in foster care, so the narrower question is
    // not asked at all.
    expect(await questionIsVisible(page, 'tx.health.foster_care_at_18')).toBe(false);

    await answerYesNo(page, 'tx.health.american_indian', true);
    await page.getByTestId('record-list-tx-tribal-members-add').click();

    // Item 3's follow-up hangs off a No, as HHSC prints it.
    await answerYesNo(page, 'tx-tribal-members-0-hasReceivedIndianHealthService', true);
    expect(
      await questionIsVisible(page, 'tx-tribal-members-0-eligibleForIndianHealthService'),
    ).toBe(false);

    await answerYesNo(page, 'tx-tribal-members-0-hasReceivedIndianHealthService', false);
    await answerYesNo(page, 'tx-tribal-members-0-eligibleForIndianHealthService', true);

    await answerYesNo(page, 'tx-tribal-members-0-hasExcludableTribalIncome', true);
    await fillQuestion(page, 'tx-tribal-members-0-tribalIncomeAmount', '1200');
    await fillQuestion(page, 'tx-tribal-members-0-tribalIncomeFrequency', 'Yearly');
  }

  if (sections.includes('tx-htw')) {
    await answerYesNo(page, 'tx.htw.confidential', false);
    await answerYesNo(page, 'tx.htw.declines', false);
  }

  if (sections.includes('tx-health-final')) {
    await answerYesNo(page, 'tx.final.incarcerated', false);
    await fillQuestion(page, 'tx.final.renewal_years', 'five');
    await answerYesNo(page, 'tx.assister.has', false);
  }
}

test.describe('the Medicaid / CHIP addendum', () => {
  test('appears for a household applying for Medicaid, asking only what applies', async () => {
    await page
      .getByRole('button', { name: /Continue with|Review your application/ })
      .click();
    await expect(page.getByTestId('program-selection-step')).toBeVisible({
      timeout: 30_000,
    });

    await tick(en.program_tx_snap);
    await tick(en.program_tx_medicaid);
    await page.getByRole('button', { name: en.programs_continue }).click();

    await completeApplicantStep(page, en);

    for (let guard = 0; guard < 25; guard += 1) {
      if (await page.getByTestId('tx-generate').isVisible().catch(() => false)) break;

      const sections = await visibleSections(page);

      await answerAddendum(sections);
      seen.push(...(await completeScreen(page)));
    }

    await expect(page.getByTestId('tx-generate')).toBeVisible();

    // Section 1, a block for the applicant and one for the other adult.
    expect(seen).toContain('tx-tax-0');
    expect(seen).toContain('tx-tax-1');
    expect(seen).not.toContain('tx-tax-2');

    // The rest of the addendum's screens.
    for (const section of [
      'tx-deductions',
      'tx-job-coverage',
      'tx-health-people',
      'tx-health-final',
      'tx-assister',
    ]) {
      expect(seen).toContain(section);
    }

    // Two adults: no child, so no questions about children.
    expect(seen).not.toContain('tx-health-children');
  });

  test('reaches HHSC’s form and the review sheet', async () => {
    await page.getByTestId('tx-generate').click();

    const ready = page.getByTestId('tx-draft-ready');

    await expect(ready).toBeVisible({ timeout: 90_000 });

    const href = await page.getByTestId('tx-draft-download').getAttribute('href');
    const pdf = await page.request.get(`${href}`);

    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    const guideHref = await page.getByTestId('tx-review-open').getAttribute('href');
    const sheet = await (await page.request.get(`${guideHref}`)).text();

    expect(sheet).toContain('Medicaid Addendum, Section 1');
    expect(sheet).toContain('Teo Ramirez');
    expect(sheet).toContain('H-E-B Grocery');
    expect(sheet).toContain('Appendix B');
    expect(sheet).toContain('Yearly');
  });
});
