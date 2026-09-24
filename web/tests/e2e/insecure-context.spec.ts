//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The application flows, in a browser without `crypto.randomUUID`.
 *
 * Browsers expose `crypto.randomUUID()` only in a secure context — HTTPS or
 * localhost. Opened over plain HTTP on a LAN address, or in an older browser,
 * it is undefined, and the application view threw "crypto.randomUUID is not a
 * function" the moment it built its first household row. Every test in the
 * suite runs on localhost, which is secure, so none of them could see it.
 *
 * Removing the function before any page script runs reproduces that browser
 * exactly. Each journey then fails on the first page error it sees, so a
 * regression anywhere on the path shows up, not only the one this was written
 * for.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';

import {
  AUSTIN_TIER_1_ANSWERS,
  CALIFORNIA_TIER_1_ANSWERS,
  answerAllNo,
  completeIntakeAndAwaitReport,
  fillRequiredIdentityFields,
} from './support/app';
import { completeApplicantStep } from './support/texas';
import en from '../../src/i18n/messages/en';

test.describe.configure({ timeout: 300_000 });

/**
 * Open a page that behaves like an insecure context and run a journey on it.
 *
 * The journey races the page's first error. A crashed page otherwise just
 * stops rendering, and the next locator waits out the whole test timeout with a
 * message that says nothing about why.
 */
async function onInsecurePage(
  browser: Browser,
  journey: (page: Page) => Promise<void>,
): Promise<void> {
  const page = await browser.newPage();

  await page.addInitScript(() => {
    // Configurable on Crypto.prototype, so deleting it leaves the object
    // exactly as an insecure context presents it.
    delete (Crypto.prototype as { randomUUID?: unknown }).randomUUID;
  });

  const crashed = new Promise<never>((_, reject) => {
    page.on('pageerror', (error) =>
      reject(new Error(`Uncaught page error: ${error.message}`)),
    );

    /*
     * An error thrown while rendering never reaches `pageerror`: React catches
     * it, reports it through console.error, and unmounts the whole tree, which
     * leaves a blank page. So a console error carrying an Error object counts
     * as a crash too. Plain-string console noise (the browser's own warnings)
     * does not.
     */
    page.on('console', async (message) => {
      if (message.type() !== 'error') return;

      for (const arg of message.args()) {
        const text = await arg
          .evaluate((value) => (value instanceof Error ? value.message : null))
          .catch(() => null);

        if (text) reject(new Error(`Page error: ${text}`));
      }
    });
  });

  try {
    await Promise.race([journey(page), crashed]);
  } finally {
    await page.close();
  }
}

test('the page really has no crypto.randomUUID', async ({ browser }) => {
  await onInsecurePage(browser, async (page) => {
    await page.goto('/');

    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
    expect(await page.evaluate(() => typeof crypto.getRandomValues)).toBe('function');
  });
});

test('California: the SAWS 2 PLUS flow opens and adds a household member', async ({
  browser,
}) => {
  await onInsecurePage(browser, async (page) => {
    await page.goto('/');
    await completeIntakeAndAwaitReport(page, CALIFORNIA_TIER_1_ANSWERS);

    // Building the application from the prefill is where it used to throw.
    await page.getByRole('button', { name: /Continue with|Review SAWS 2 PLUS/ }).click();
    await page.getByRole('button', { name: 'Continue with selected programs' }).click();

    const add = page.getByRole('button', { name: en.household_add_member });

    for (let guard = 0; guard < 10; guard += 1) {
      if (await add.isVisible().catch(() => false)) break;

      await fillRequiredIdentityFields(page);
      await answerAllNo(page);
      await page.getByRole('button', { name: /^Continue( to |$)/ }).first().click();
    }

    await expect(add).toBeVisible();

    const firstNames = page.getByLabel(/^First name\s*\*?$/);
    const before = await firstNames.count();

    await add.click();
    await add.click();

    await expect(firstNames).toHaveCount(before + 2);

    // Each row got its own id: typing into one does not write into another.
    await firstNames.nth(before).fill('Ana');
    await firstNames.nth(before + 1).fill('Luis');
    await expect(firstNames.nth(before)).toHaveValue('Ana');
    await expect(firstNames.nth(before + 1)).toHaveValue('Luis');
  });
});

test('Texas: the H1010 flow reaches the household roster', async ({ browser }) => {
  await onInsecurePage(browser, async (page) => {
    await page.goto('/');
    await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);

    await page
      .getByRole('button', { name: /Continue with|Review your application/ })
      .click();
    await expect(page.getByTestId('program-selection-step')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: en.programs_continue }).click();
    await completeApplicantStep(page, en);

    await page.getByTestId('tx.mail.same-yes').click();
    await page.getByTestId('tx.live.homeless-no').click();
    await page.getByTestId('tx-continue').click();

    await expect(page.getByTestId('tx-roster')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('tx-roster-add').click();
    await expect(page.getByTestId('tx-member-0-remove')).toBeVisible();
  });
});
