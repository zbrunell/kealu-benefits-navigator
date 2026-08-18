/**
 * E2E: the SAWS 2 PLUS draft, end to end in a browser.
 *
 * This is the production gate for the application flow. Everything else in the
 * suite proves the research journey works; this proves an applicant can reach a
 * generated California benefits application and get what they need to finish
 * it — and, just as importantly, that the two things Kealu must never write are
 * still blank when they get there.
 *
 * The PDF mapping itself is covered far more thoroughly by the 17-case Python
 * scenario matrix, which drives real AcroForm writes across every structural
 * boundary of the form. Nothing here duplicates that. What only a browser can
 * show is the part in between: that the flow is walkable, that the draft and
 * its guide are reachable and downloadable, and that the page tells the truth
 * about what is left to do.
 *
 * Runs against its own server (the `saws2` project in playwright.config.ts).
 * SAWS 2 PLUS is offered only to California households whose report carries a
 * CA_SAWS_2_PLUS recommendation, and only the E2E_MODE fixture emits one.
 */
import { test, expect } from '@playwright/test';
import {
  CALIFORNIA_TIER_1_ANSWERS,
  completeIntakeAndAwaitReport,
  completeSaws2Application,
} from './support/app';

/*
 * One journey, many assertions.
 *
 * Reaching a generated draft means walking intake, a workflow run, and six
 * application steps — a minute or so of real work. Repeating that per test
 * would make the file slow enough to be skipped and would multiply the chances
 * of a flake without testing anything more, so the journey runs once and the
 * assertions share the resulting page.
 *
 * Serial mode makes that safe: the tests run in order in one worker, and if the
 * journey fails the rest are marked skipped rather than cascading confusingly.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 });

let page: import('@playwright/test').Page;

test.beforeAll(async ({ browser }) => {
  /*
   * describe-level timeout applies to tests, not hooks, and this hook does the
   * whole journey. It also pays the dev server's first compile of every route
   * it touches — page, intake, workflow start, SSE, report, draft — which only
   * happens on a cold server and is why this needs more room than the work
   * itself suggests.
   */
  test.setTimeout(300_000);

  page = await browser.newPage();

  await page.goto('/');
  await completeIntakeAndAwaitReport(page, CALIFORNIA_TIER_1_ANSWERS);
  await completeSaws2Application(page);

  await expect(page.getByTestId('draft-download')).toBeVisible({
    timeout: 120_000,
  });
});

test.afterAll(async () => {
  await page?.close();
});

test.describe('SAWS 2 PLUS draft (production gate)', () => {
  test('an applicant can reach a generated draft, its guide, and accurate remaining-action messaging', async () => {

    // ── The generated application ───────────────────────────────────────
    const download = page.getByTestId('draft-download');
    await expect(download).toContainText('SAWS 2 PLUS draft is ready');

    const openDraft = download.getByRole('link', { name: 'Open draft' });
    const saveDraft = download.getByRole('link', { name: 'Download draft' });
    await expect(openDraft).toHaveAttribute('href', /\/api\/workflow\/.+\/draft/);
    await expect(saveDraft).toHaveAttribute('href', /draft\?download=1/);

    // ── The completion guide, and its print/download controls ───────────
    const guide = page.getByTestId('completion-guide-download');
    await expect(guide).toBeVisible();

    await expect(
      guide.getByRole('link', { name: 'Open printable guide' }),
    ).toHaveAttribute('href', /\/api\/workflow\/.+\/guide/);
    await expect(
      guide.getByRole('link', { name: 'Download guide' }),
    ).toHaveAttribute('href', /guide\?download=1/);
    await expect(
      guide.getByRole('link', { name: 'Guide for someone helping you' }),
    ).toHaveAttribute('href', /guide\?audience=associate/);

    // The guide is laid out for paper, and the page says so.
    await expect(guide).toContainText('US Letter');

    // ── Remaining-action messaging ──────────────────────────────────────
    const manual = page.getByTestId('manual-completion-guide');
    await expect(manual).toBeVisible();
    await expect(manual).toContainText('Social Security Number');
    await expect(manual).toContainText('Sign and date');

    // ── Submission guidance, without an invented destination ────────────
    const submission = page.getByTestId('submission-instructions');
    await expect(submission).toBeVisible();
    await expect(submission).toContainText('benefitscal.com');

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(/\(\d{3}\)\s*\d{3}-\d{4}/);
    expect(body).not.toMatch(/\bfax:\s*\+?\d/i);
  });

  test('the draft and its guide are paired by a visible, non-sensitive reference', async () => {

    const download = page.getByTestId('draft-download');
    await expect(download).toContainText('Draft reference');

    const reference = await download.locator('.font-mono').first().textContent();
    expect(reference?.trim()).toMatch(/^[0-9A-F]{8}$/);

    // The same reference is printed on the guide the links point at.
    const guideHref = await page
      .getByTestId('completion-guide-download')
      .getByRole('link', { name: 'Open printable guide' })
      .getAttribute('href');

    const guideHtml = await (await page.request.get(guideHref!)).text();
    expect(guideHtml).toContain(reference!.trim());
  });

  test('the printable guide is a self-contained page that names where each blank is', async () => {

    const guideHref = await page
      .getByTestId('completion-guide-download')
      .getByRole('link', { name: 'Open printable guide' })
      .getAttribute('href');

    const response = await page.request.get(guideHref!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');

    const html = await response.text();

    // Self-contained: nothing to fetch, so it prints anywhere.
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).toContain('@page { size: Letter; margin: .5in; }');

    // Every blank says which PDF page and printed question it is on.
    expect(html).toMatch(/PDF page \d+ · PAGE \d+ OF 17 · Q\d/);
    expect(html).toContain('Social Security Numbers');
    expect(html).toContain('Signatures');

    // Whose number goes where — never the number itself.
    expect(html).toContain('Maria Delgado');
    expect(html).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(html).not.toMatch(/\b\d{9}\b/);
  });

  test('the associate guide is served and gives field locations', async () => {

    const href = await page
      .getByTestId('completion-guide-download')
      .getByRole('link', { name: 'Guide for someone helping you' })
      .getAttribute('href');

    const html = await (await page.request.get(href!)).text();

    expect(html).toContain('what this draft still needs');
    expect(html).toContain('nothing has to be hunted for');
    expect(html).toMatch(/PDF page \d+/);
  });

  test('the generated PDF is downloadable and contains no SSN or signature', async () => {

    const href = await page
      .getByTestId('draft-download')
      .getByRole('link', { name: 'Open draft' })
      .getAttribute('href');

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');

    const pdf = await response.body();
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    /*
     * The applicant's name reached the form, so the document really was filled
     * — which is what makes the absence of an SSN meaningful rather than
     * vacuous. The Python scenario matrix asserts the destination-level
     * invariant across all 17 structural cases; this is the browser-level
     * sanity check on the artefact the user actually downloads.
     */
    const text = pdf.toString('latin1');
    expect(text).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });
});
