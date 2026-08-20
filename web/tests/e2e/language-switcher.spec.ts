/**
 * E2E tests: Language switcher — top-right visibility and locale switching.
 *
 * Covers the UX requirements added in KEA-1 / KEA-7:
 *   - Language switcher is visible in the top-right area of the page header.
 *   - Switching from English to Spanish changes client-rendered UI text.
 *   - The selected locale is persisted via cookie so the server component
 *     renders in the correct language on subsequent page loads.
 *
 * Selector strategy:
 *   - `header select` — unambiguous: there is exactly one <select> in the
 *     page <header> (the LanguageSwitcher component).
 *   - `button[aria-label]` — locale-sensitive aria-labels change with the
 *     active language catalog, giving us a reliable signal that the client
 *     re-rendered with the new locale.
 *   - `h1` — the page title is server-rendered from the message catalog;
 *     checking it after a reload verifies the cookie round-trip.
 */
import { test, expect } from '@playwright/test';

test.describe('Language switcher (KEA-1 / KEA-7)', () => {
  test('language switcher select is visible inside the page header', async ({ page }) => {
    await page.goto('/');

    // The LanguageSwitcher renders a <select> element with an accessible label.
    // It is placed inside the <header> in page.tsx.
    const languageSelect = page.locator('header select');
    await expect(languageSelect).toBeVisible();

    // The select must have the English aria-label on first load.
    await expect(languageSelect).toHaveAttribute('aria-label', 'Select language');
  });

  test('switcher defaults to English on first load', async ({ page }) => {
    await page.goto('/');

    const languageSelect = page.locator('header select');
    await expect(languageSelect).toBeVisible();
    await expect(languageSelect).toHaveValue('en');
  });

  test('switching to Spanish changes client-rendered UI text to Spanish', async ({ page }) => {
    await page.goto('/');

    const languageSelect = page.locator('header select');
    await expect(languageSelect).toBeVisible();

    // Switch to Spanish.
    await languageSelect.selectOption('es');

    // The chat send button's aria-label is driven by the active message catalog
    // (t('chat_send_aria')): 'Send message' in English → 'Enviar mensaje' in Spanish.
    // Waiting for it confirms that the LanguageProvider has re-rendered the tree
    // with the Spanish catalog.
    await expect(page.locator('button[aria-label="Enviar mensaje"]')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('switcher select reflects the newly chosen locale', async ({ page }) => {
    await page.goto('/');

    const languageSelect = page.locator('header select');
    await languageSelect.selectOption('es');

    // The select's own value should update immediately.
    await expect(languageSelect).toHaveValue('es');
  });

  test('locale persists — server renders Spanish page title after cookie-based reload', async ({
    page,
  }) => {
    await page.goto('/');

    const languageSelect = page.locator('header select');
    await languageSelect.selectOption('es');

    /*
     * Wait on the signal rather than on the clock. LanguageProvider writes the
     * cookie inside setLocale and only then sets state, and the effect that
     * mirrors the locale onto <html lang> runs after that state lands — so a
     * settled lang attribute proves the cookie has been written.
     */
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // Reload: the server component now reads the kbn-locale cookie and
    // renders page_title / page_subtitle / offline_banner in Spanish.
    await page.reload();

    // Page title is server-rendered by page.tsx using t(msgs, 'page_title').
    // Spanish value: 'Navegador de Beneficios'.
    await expect(page.locator('h1')).toContainText('Navegador de Beneficios');

    // The switcher should still show Spanish after reload.
    await expect(page.locator('header select')).toHaveValue('es');
  });

  test('switching back to English restores English server-rendered title', async ({ page }) => {
    await page.goto('/');

    const languageSelect = page.locator('header select');

    // Switch to Spanish and reload so the cookie is written.
    await languageSelect.selectOption('es');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await page.reload();
    await expect(page.locator('h1')).toContainText('Navegador de Beneficios');

    // Switch back to English.
    await page.locator('header select').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();

    // Server should now render the English page title again.
    await expect(page.locator('h1')).toContainText('Benefits Navigator');
  });
});

/**
 * Switching language *after* answers exist.
 *
 * The unit suite proves the pure separation — locale changes wording, never
 * canonical state. This proves it in a real browser, where the failure would
 * actually be visible: a switch that re-mounts the tree and loses what someone
 * has already typed.
 */
test.describe('language switch mid-flow keeps answers', () => {
  test('an answered intake question survives switching to Spanish', async ({
    page,
  }) => {
    await page.goto('/');

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible();

    // Answer the first intake question.
    await input.fill('90001');
    await page.locator('[data-testid="chat-send"]').click();

    // The answer is now part of the conversation.
    await expect(page.locator('[data-testid="chat-messages"]')).toContainText(
      '90001',
    );

    const englishPrompt = await page
      .locator('[data-testid="chat-messages"]')
      .innerText();

    // Switch language with an answer already given.
    await page.locator('header select').selectOption('es');

    // The answer is still there — not reset, not re-asked from scratch.
    await expect(page.locator('[data-testid="chat-messages"]')).toContainText(
      '90001',
    );

    // And the interface really did change language.
    const spanishPrompt = await page
      .locator('[data-testid="chat-messages"]')
      .innerText();

    expect(spanishPrompt).not.toBe(englishPrompt);
  });

  test('switching to Simplified Chinese keeps the answer and changes the UI', async ({
    page,
  }) => {
    await page.goto('/');

    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('90001');
    await page.locator('[data-testid="chat-send"]').click();
    await expect(page.locator('[data-testid="chat-messages"]')).toContainText(
      '90001',
    );

    await page.locator('header select').selectOption('zh-CN');

    await expect(page.locator('[data-testid="chat-messages"]')).toContainText(
      '90001',
    );

    // Simplified Chinese characters are on screen somewhere in the shell.
    await expect(page.locator('body')).toContainText(/[一-鿿]/);
  });

  test('the locale survives a reload with the answer intact', async ({ page }) => {
    await page.goto('/');

    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('90001');
    await page.locator('[data-testid="chat-send"]').click();
    await expect(page.locator('[data-testid="chat-messages"]')).toContainText(
      '90001',
    );

    await page.locator('header select').selectOption('es');
    await page.reload();

    // Both the choice and the session answer come back.
    await expect(page.locator('header select')).toHaveValue('es');
    await expect(page.locator('[data-testid="chat-messages"]')).toContainText(
      '90001',
    );
  });
});
