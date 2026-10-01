//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * E2E: changing an answer already given in the chat.
 *
 * From product testing: the way back to earlier answers was a small link in
 * the panel's corner that people missed, a saved change gave no sign it had
 * gone through, and the edit box did not reliably take the cursor.
 */
import { test, expect } from '@playwright/test';

import {
  answerTier1,
  assistantMessages,
  chatInput,
} from './support/app';
import en from '../../src/i18n/messages/en';

test('an earlier answer can be found, changed, and confirmed as saved', async ({ page }) => {
  await page.goto('/');
  await answerTier1(page);

  // The way in is a labelled button, with a hint beside it.
  await expect(page.getByText(en.chat_edit_answers_hint)).toBeVisible();

  const toggle = page.getByRole('button', { name: en.chat_edit_answers });

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(
    page.getByRole('button', { name: en.chat_hide_answers }),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Edit ZIP Code' }).click();

  // The box has the cursor, after the existing text, without a click.
  const box = page.getByRole('textbox', { name: 'New answer for ZIP Code' });

  await expect(box).toBeFocused();
  expect(
    await box.evaluate(
      (node: HTMLInputElement) => node.selectionStart === node.value.length,
    ),
  ).toBe(true);

  const before = await assistantMessages(page).count();

  await page.keyboard.press('Backspace');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');

  // Confirmed on the row, and in the conversation.
  const row = page.getByTestId('chat-answer-zip_code');

  await expect(row).toContainText('77002');
  await expect(row.getByRole('status')).toHaveText(`✓${en.chat_saved}`);
  await expect(assistantMessages(page).nth(before)).toHaveText(
    '✓ Answer updated. ZIP Code is now: 77002',
  );

  // And the conversation can carry on from where it was.
  await expect(chatInput(page)).toBeEnabled();
});

test('a rejected edit keeps the box open and says why', async ({ page }) => {
  await page.goto('/');
  await answerTier1(page);

  await page.getByRole('button', { name: en.chat_edit_answers }).click();
  await page.getByRole('button', { name: 'Edit ZIP Code' }).click();

  const box = page.getByRole('textbox', { name: 'New answer for ZIP Code' });

  await box.fill('123');
  await page.getByRole('button', { name: en.chat_save, exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: /ZIP/ })).toBeVisible();
  await expect(box).toBeVisible();
  await expect(
    page.getByTestId('chat-answer-zip_code').getByRole('status'),
  ).toHaveCount(0);
});
