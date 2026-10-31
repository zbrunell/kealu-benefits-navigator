//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Spanish, all the way from intake to program selection.
 *
 * The regression this exists for: the page frame translated and the eligibility
 * analysis did not, so a Spanish reader met a Spanish heading above English
 * sentences about their own income. Unit tests cover the resolver; this proves
 * it in the browser, where the failure was visible.
 *
 * It also covers the locale surviving the journey — intake, the workflow run,
 * the report, program selection — because a cookie that is read on one route
 * and forgotten on the next produces exactly the same symptom.
 */

import { test, expect } from '@playwright/test';

import { CALIFORNIA_TIER_1_ANSWERS, completeIntakeAndAwaitReport } from './support/app';
import es from '../../src/i18n/messages/es';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

/** English function words that do not occur in Spanish sentences. */
const ENGLISH_MARKERS = [
  'Household income',
  'Gross household income',
  'expanded Medicaid',
  'asset test',
  'dependent child',
  'Monthly rent',
  'Monthly utility',
  'Federal Poverty Level',
  'requires a needy child',
];

test('the eligibility analysis is Spanish from intake through program selection', async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.goto('/');

  /*
   * Intake is driven in English, then the language is switched.
   *
   * Not because switching first would fail the product — it would not — but
   * because the shared intake driver addresses the chat controls by their
   * English accessible names, so it cannot type into a Spanish page. Making
   * that driver locale-aware is worth doing and is a change to shared
   * fixtures rather than to this regression.
   *
   * Switching here still covers the regression and the persistence question:
   * the report, program selection and everything after it must be Spanish, and
   * the locale must survive the navigation between them.
   */
  await completeIntakeAndAwaitReport(page, CALIFORNIA_TIER_1_ANSWERS);

  await page.locator('header select').selectOption('es');

  await expect(page.getByTestId('report-view')).toBeVisible({
    timeout: 120_000,
  });

  /*
   * Scoped to the recommendation section, not the whole report.
   *
   * The five phase sections above it are prose the workflow writes, and under
   * E2E_MODE the fixture stands in for the workflow and writes English. In
   * production the workflow is handed `preferredLanguage` and answers in the
   * applicant's language, which is not something this suite can exercise. The
   * eligibility analysis below is ours, and it is what leaked English.
   */
  const report = page.getByTestId('saws-recommendation');
  await expect(report).toBeVisible();

  const reportText = (await report.innerText()).replace(/\s+/g, ' ');

  for (const marker of ENGLISH_MARKERS) {
    expect(
      reportText,
      `English eligibility text on the Spanish report: ${marker}`,
    ).not.toContain(marker);
  }

  // Spanish is still selected after the whole workflow, not just at the start.
  await expect(page.locator('header select')).toHaveValue('es');

  // On to program selection.
  await page
    .getByRole('button', { name: /Continuar con|Revisar la solicitud/ })
    .click();

  const programs = page.getByText(es.programs_info_needed, { exact: false });

  // The missing-information heading is the one this page always shows when a
  // programme needs more detail; its presence in Spanish means the section
  // around it rendered from the catalog.
  await expect(programs.first()).toBeVisible();

  const pageText = (
    await page.getByTestId('program-selection-step').innerText()
  ).replace(/\s+/g, ' ');

  for (const marker of ENGLISH_MARKERS) {
    expect(
      pageText,
      `English eligibility text on the Spanish program-selection page: ${marker}`,
    ).not.toContain(marker);
  }

  // And the Spanish sentences are actually there, not merely the English gone.
  expect(pageText).toContain('hogar');
});
