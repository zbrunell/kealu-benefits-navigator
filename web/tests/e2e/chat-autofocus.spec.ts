//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * E2E: the message box takes the cursor whenever a question is waiting.
 *
 * From product testing: after each answer the applicant had to click back
 * into the box before typing the next one. The box was focused from the
 * request's `finally`, while it was still disabled, which the browser ignores.
 * This test never clicks the box: it types with the keyboard alone.
 */
import { test, expect } from '@playwright/test';

import { TIER_1_ANSWERS, assistantMessages, chatInput } from './support/app';

test('each question can be answered by typing, without clicking the box', async ({ page }) => {
  await page.goto('/');

  for (const value of TIER_1_ANSWERS) {
    await expect(chatInput(page)).toBeEnabled();
    await expect(chatInput(page)).toBeFocused();

    const before = await assistantMessages(page).count();

    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
    await assistantMessages(page).nth(before).waitFor({ state: 'visible' });
  }

  await expect(chatInput(page)).toBeFocused();
});
