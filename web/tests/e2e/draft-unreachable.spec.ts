//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Generating the PDF when the server cannot be reached.
 *
 * A stopped or restarting dev server, or a dropped connection, makes `fetch`
 * reject before any response exists. The Texas view used to print the
 * browser's own words for that — "Failed to fetch" — which tells an applicant
 * nothing about what happened or whether their answers are lost.
 *
 * Aborting the draft request reproduces it exactly. The applicant must see a
 * sentence in their language, and a second try must work once the server is
 * back, because nothing they typed was thrown away.
 */
import { test, expect } from '@playwright/test';

import { AUSTIN_TIER_1_ANSWERS, completeIntakeAndAwaitReport } from './support/app';
import { completeApplicantStep, walkToReview } from './support/texas';
import en from '../../src/i18n/messages/en';

test.describe.configure({ timeout: 300_000 });

test('an unreachable server gets a readable message, and retrying works', async ({ page }) => {
  await page.goto('/');
  await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);

  await page
    .getByRole('button', { name: /Continue with|Review your application/ })
    .click();
  await page.getByRole('button', { name: en.programs_continue }).click();
  await completeApplicantStep(page, en);
  await walkToReview(page);

  const draftRoute = /\/api\/workflow\/[^/]+\/draft$/;

  await page.route(draftRoute, (route) =>
    route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue(),
  );
  await page.getByTestId('tx-generate').click();

  const error = page.getByTestId('tx-generate-error');

  await expect(error).toHaveText(en.av_draft_unreachable);
  await expect(error).not.toContainText('Failed to fetch');

  // The server is back; the same answers generate a draft.
  await page.unroute(draftRoute);
  await page.getByTestId('tx-generate').click();

  await expect(page.getByTestId('tx-packet')).toBeVisible({ timeout: 60_000 });
  await expect(error).toHaveCount(0);
});
