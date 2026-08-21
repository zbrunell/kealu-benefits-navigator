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
 *
 * The input is located by role with a locale-specific accessible name, so it is
 * re-resolved after each switch instead of being captured once.
 */
test.describe('language switch mid-flow keeps answers', () => {
  const INPUT_NAME = {
    en: 'Your message',
    es: 'Su mensaje',
    'zh-CN': '您的消息',
  } as const;

  async function answerZip(page: import('@playwright/test').Page) {
    const input = page.getByRole('textbox', { name: INPUT_NAME.en });
    await expect(input).toBeVisible();
    await input.fill('90001');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByTestId('chat-messages')).toContainText('90001');
  }

  test('an answered intake question survives switching to Spanish', async ({
    page,
  }) => {
    await page.goto('/');
    await answerZip(page);

    await page.locator('header select').selectOption('es');

    // The answer is still in the conversation — not reset, not re-asked.
    await expect(page.getByTestId('chat-messages')).toContainText('90001');

    // And the interface really did change language: the input's accessible
    // name now comes from the Spanish catalog.
    await expect(
      page.getByRole('textbox', { name: INPUT_NAME.es }),
    ).toBeVisible();
  });

  test('switching to Simplified Chinese keeps the answer and changes the UI', async ({
    page,
  }) => {
    await page.goto('/');
    await answerZip(page);

    await page.locator('header select').selectOption('zh-CN');

    await expect(page.getByTestId('chat-messages')).toContainText('90001');
    await expect(
      page.getByRole('textbox', { name: INPUT_NAME['zh-CN'] }),
    ).toBeVisible();
  });

  test('the answer and the chosen language both survive a reload', async ({
    page,
  }) => {
    await page.goto('/');
    await answerZip(page);

    await page.locator('header select').selectOption('es');
    await page.reload();

    await expect(page.locator('header select')).toHaveValue('es');
    await expect(page.getByTestId('chat-messages')).toContainText('90001');
  });

  test('switching back to English keeps the answer', async ({ page }) => {
    await page.goto('/');
    await answerZip(page);

    await page.locator('header select').selectOption('es');
    await expect(page.getByTestId('chat-messages')).toContainText('90001');

    await page.locator('header select').selectOption('en');

    await expect(page.getByTestId('chat-messages')).toContainText('90001');
    await expect(
      page.getByRole('textbox', { name: INPUT_NAME.en }),
    ).toBeVisible();
  });
});
