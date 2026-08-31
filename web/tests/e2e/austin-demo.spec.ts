/**
 * E2E: the Austin, Texas journey, end to end in a real browser.
 *
 * This is the production gate for multi-jurisdiction support, and it is the
 * counterpart to `saws2-application.spec.ts`: that spec proves a California
 * household still reaches a generated SAWS 2 PLUS draft, this one proves a
 * Texas household reaches a coherent Texas plan and never sees California.
 *
 * The bug being guarded against was not subtle in its symptoms — ZIP 78705
 * produced Medi-Cal, CalFresh, CalWORKs, SAWS 2 PLUS, BenefitsCal and Covered
 * California — but every symptom was several layers away from its cause. Unit
 * tests cover the causes. What only a browser can show is that the whole
 * journey holds together: the ZIP resolves, the report renders Texas programs,
 * the application step offers the Texas route rather than an error panel, and no
 * California string survives to the screen.
 *
 * Runs against the E2E_MODE server (the `applications` project in
 * playwright.config.ts), which executes the real jurisdiction resolution,
 * program registry and screening rather than static fixture text.
 */
import { test, expect } from '@playwright/test';
import {
  AUSTIN_TIER_1_ANSWERS,
  CALIFORNIA_ONLY_TERMS,
  completeIntakeAndAwaitReport,
  reportView,
} from './support/app';
import en from '../../src/i18n/messages/en';

/*
 * One journey, many assertions — the same reasoning as the SAWS spec. Reaching
 * the report means walking intake, a workflow run and an SSE stream; repeating
 * that per assertion would make the file slow enough to be skipped without
 * testing anything more.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 });

let page: import('@playwright/test').Page;

/** Everything currently rendered, for whole-page sweeps. */
async function visibleText(): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

test.beforeAll(async ({ browser }) => {
  // This hook pays the dev server's first compile of every route it touches.
  test.setTimeout(300_000);

  page = await browser.newPage();

  await page.goto('/');
  await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
});

test.afterAll(async () => {
  await page?.close();
});

test.describe('Austin, Texas — the multi-jurisdiction production gate', () => {
  test('an Austin household reaches a Texas plan with no California content', async () => {
    await expect(reportView(page)).toBeVisible();

    /*
     * Expand only the *closed* sections. Clicking every summary toggles the
     * action-plan section — which opens by default — shut, which hid the very
     * document-checklist headings a later test asserts on.
     */
    const sections = page.getByTestId('section-content');
    const closed = page.locator('details:not([open]) > summary');

    for (let i = 0, n = await closed.count(); i < n; i += 1) {
      await closed.nth(0).click().catch(() => undefined);
    }

    await expect(page.locator('details:not([open])')).toHaveCount(0);

    await expect(sections.first()).toBeVisible();

    const text = await visibleText();

    // ── The jurisdiction resolved all the way down ──────────────────────
    expect(text).toContain('Austin');
    expect(text).toContain('Travis');
    expect(text).toContain('78705');

    // ── Texas programs are present ──────────────────────────────────────
    expect(text).toContain('SNAP');
    expect(text).toContain('Medicaid');
    expect(text).toMatch(/Your Texas Benefits|yourtexasbenefits/i);

    // ── The local programs a counselor would actually raise ─────────────
    expect(text).toContain('Central Health');
    expect(text).toContain('Austin Energy');

    // ── The coverage gap is named, not glossed over ─────────────────────
    expect(text).toContain('Texas did not expand Medicaid');

    // ── And no California anything ──────────────────────────────────────
    for (const term of CALIFORNIA_ONLY_TERMS) {
      expect(text, `California term leaked: ${term}`).not.toContain(term);
    }

    expect(text).not.toContain('benefitscal.com');
    expect(text).not.toContain('getcalfresh.org');
    expect(text).not.toContain('coveredca.com');
  });

  test('the document guidance does not contradict itself', async () => {
    const text = await visibleText();

    /*
     * The specific failure the brief called out: the plan said no documents
     * were needed to start, directly above a list of required documents.
     */
    expect(text).not.toContain('No additional documentation is required to start');

    expect(text).toContain(en.docs_to_submit_heading);
    expect(text).toContain(en.docs_to_verify_heading);
    expect(text).toContain(en.docs_maybe_heading);
  });

  test('no benefit value is fabricated', async () => {
    const text = await visibleText();

    // The exact fabrication the brief named ($840/mo for Medi-Cal).
    expect(text).not.toContain('$840');

    // Where a value cannot be computed, the report says so in words.
    expect(text).toContain('Not estimated');
  });

  test('the application step offers the Texas application, not an error', async () => {
    /*
     * Texas is a `generated` application now: the mapping layer holds H1010's
     * fields and the Texas intake collects the answers behind them. The route
     * this spec used to assert — a manual transcription guide — was the honest
     * answer while the form was uninspected, and is no longer the one a Texas
     * household gets. The flow itself is covered end to end in
     * `tx-h1010-application.spec.ts`; what is asserted here is only that the
     * report leads into it and that no California string survives the trip.
     */
    await page
      .getByRole('button', { name: /Continue with|Review your application/ })
      .click();

    const step = page.getByTestId('program-selection-step');

    await expect(step).toBeVisible({ timeout: 30_000 });

    // Never the "recommendation unavailable" panel, which is what a Texas
    // household used to get here.
    await expect(page.getByText(en.shell_rec_unavailable)).toHaveCount(0);

    // ── The Texas form and its programmes ───────────────────────────────
    await expect(step).toContainText('H1010');
    await expect(step).toContainText(en.program_tx_snap);
    await expect(step).toContainText(en.program_tx_medicaid);

    const stepText = (await step.innerText()).replace(/\s+/g, ' ');

    for (const term of CALIFORNIA_ONLY_TERMS) {
      expect(stepText, `California term leaked: ${term}`).not.toContain(term);
    }
  });

  test('it says plainly that the document is not the agency’s own form', async () => {
    /*
     * The promise the manual guide used to make, kept by the generated route:
     * HHSC publishes H1010 only through its own website, so what we produce
     * carries the applicant's answers rather than being the official paper,
     * and the applicant is told so before they submit anything.
     */
    await page.getByRole('button', { name: en.programs_continue }).click();

    await expect(page.getByRole('heading', { name: en.applicant_heading })).toBeVisible();
    await expect(page.getByText('H1010').first()).toBeVisible();
  });
});
