//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Which physical form a Texas applicant receives, proved in a browser.
 *
 * The regression is specific and was live: `h1010_official` pinned its base
 * document to `TX-H1010-EN-2026-08.pdf`, and `generate_form` took no locale at
 * all — so the entire document-language layer, its `LanguageMatch` values and
 * its tests were reachable only from other tests. A Spanish applicant's
 * answers went onto the English layout.
 *
 * Unit and Python tests now pin the asset choice by digest. What only a browser
 * can show is that a person walking the ordinary flow ends up holding the right
 * one, described in words they can read.
 *
 * ── The three cases, and why they are different ────────────────────────────
 * * **H1010** — Texas publishes two real PDFs. Spanish must get the Spanish
 *   one. This is the requirement's sharp edge.
 * * **H1049 / H3037** — one officially bilingual PDF each, served from both an
 *   English and a Spanish catalog link. Both locales get the same asset, and it
 *   must be presented as *bilingual*, never as an English fallback. Those two
 *   messages are opposites and the wrong one is a lie.
 * * **Neither** must leak an internal name. No `BI`, `EN`, `ES`, or
 *   `TX-H1049-BI-2001-12.pdf` on any screen a person reads.
 *
 * Serial and one report per language: reaching a report means walking intake, a
 * workflow run and an SSE stream.
 */
import { test, expect, type Page } from '@playwright/test';

import { AUSTIN_TIER_1_ANSWERS, completeIntakeAndAwaitReport } from './support/app';
import {
  completeApplicantStep,
  walkToReview,
  type ApplicantLabels,
} from './support/texas';
import en from '../../src/i18n/messages/en';
import es from '../../src/i18n/messages/es';

test.describe.configure({ mode: 'serial', timeout: 300_000 });

/**
 * Internal vocabulary that must never appear on an applicant's screen.
 *
 * The language codes are checked as standalone words: "ES" inside "ESTE" is
 * ordinary Spanish, and a naive substring check would fail on the Spanish
 * interface for no reason.
 */
const INTERNAL_LEAKS: readonly RegExp[] = [
  /TX-H1010-(EN|ES)-2026-08\.pdf/,
  /TX-H1049-BI-2001-12\.pdf/,
  /TX-H3037-BI-2003-04\.pdf/,
  /\bTX_H1010\b/,
  /\bTX_H1049\b/,
  /\bTX_H3037\b/,
  /\b-?BI-?\b/,
  /\blanguage_match\b/,
  /\bsource_filename\b/,
];

/**
 * The answers that put all three forms in the packet.
 *
 * Self-employment makes H1049 applicable; a pregnancy plus a health programme
 * makes H3037 applicable. Both are `NEEDS_CONFIRMATION` rather than required —
 * see `formmap/forms/tx_catalog.py` — which is itself part of what the cards
 * must render correctly.
 */
const PACKET_ANSWERS = {
  'tx.household.pregnant': true,
  'tx.money.has_job': false,
  'tx.money.self_employed': true,
  'tx.money.other_income': false,
} as const;

/**
 * Programmes to select, by their catalogue key.
 *
 * Ticked explicitly rather than left to the screening's recommendation: H3037
 * only applies when a health programme is selected, so a spec that relied on
 * whatever the screening happened to suggest for this household would pass or
 * fail on a change to the eligibility rules rather than to form delivery.
 */
const PROGRAM_KEYS = ['program_tx_snap', 'program_tx_medicaid'] as const;

/** The catalogue strings this walkthrough addresses controls by. */
type FlowLabels = ApplicantLabels & {
  programs_continue: string;
  program_tx_snap: string;
  program_tx_medicaid: string;
};

/** Walk from a fresh report to a generated packet, in one language. */
async function generatePacket(
  page: Page,
  labels: FlowLabels,
): Promise<void> {
  await page
    .getByRole('button', { name: /Continue with|Review your application|Continuar con|Revise su solicitud/ })
    .click();

  await expect(page.getByTestId('program-selection-step')).toBeVisible({
    timeout: 30_000,
  });

  // Tick the programmes this packet needs, by the name the interface shows.
  for (const key of PROGRAM_KEYS) {
    const box = page
      .locator('label')
      .filter({ has: page.getByRole('heading', { name: labels[key], exact: true }) })
      .getByRole('checkbox');

    if (!(await box.isChecked())) await box.check();
  }

  await page.getByRole('button', { name: labels.programs_continue }).click();

  await completeApplicantStep(page, labels);

  await walkToReview(page, { answers: PACKET_ANSWERS });

  await page.getByTestId('tx-generate').click();

  await expect(page.getByTestId('tx-draft-ready')).toBeVisible({
    timeout: 90_000,
  });

  /*
   * Wait for the packet itself, not just the panel around it.
   *
   * The cards are rendered from the manifest the Python layer returns, and
   * `_packet_manifest` degrades to `[]` rather than failing generation — so a
   * panel can appear with no cards in it. Waiting here means that shows up as
   * "the packet never arrived" instead of as a card assertion timing out in
   * whichever test happens to run first.
   */
  await expect(page.getByTestId('tx-packet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('form-card-h1010')).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * How many pages a PDF has, counted from its own page objects.
 *
 * Enough to tell HHSC's 34-page H1010 from the 5-page Navigator worksheet it
 * replaced, which is the regression worth catching here. Counting `/Type
 * /Page` occurrences rather than parsing the catalog: no PDF library is a
 * dependency of this suite, and the count only has to distinguish 34 from 5.
 */
function pageCountOf(body: Buffer): number {
  return (body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** Every character an applicant can read on the current screen. */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()) ?? '';
}

// ---------------------------------------------------------------------------
// Spanish
// ---------------------------------------------------------------------------

test.describe('a Spanish applicant receives the Spanish H1010', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    page = await browser.newPage();
    await page.goto('/');

    /*
     * Intake in English, then switch — the shared intake chat driver addresses
     * its controls by their English accessible names. Everything this spec is
     * about happens after the report, and the language must survive the
     * navigation to it, which is itself worth covering.
     */
    await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
    await page.locator('header select').selectOption('es');

    await generatePacket(page, es);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('the surrounding interface is Spanish', async () => {
    const panel = page.getByTestId('tx-draft-ready');

    await expect(panel).toContainText(es.tx_draft_ready);
    await expect(panel).toContainText(es.packet_heading);

    // And not the English equivalents of the same strings.
    await expect(panel).not.toContainText(en.tx_draft_ready);
    await expect(panel).not.toContainText(en.packet_heading);
  });

  test('the H1010 card names the document Español', async () => {
    const language = page.getByTestId('form-card-language-h1010');

    await expect(language).toHaveText(es.form_card_language_es);

    /*
     * The requirement's own worked example. "Inglés" here would mean the
     * Spanish applicant is being handed the English H1010 — the exact bug.
     */
    expect(es.form_card_language_es).toBe('Español');
    await expect(language).not.toHaveText(es.form_card_language_en);
  });

  test('the delivered H1010 is HHSC’s Spanish document, prefilled', async () => {
    /*
     * The card's primary action is the applicant's own filled form now, not a
     * blank one — the official H1010 carries every answer it has a box for, so
     * that is what they download.
     *
     * Two things are asserted, because either alone can be satisfied by the
     * wrong document:
     *
     * - the download name says Spanish, and that name is derived from what the
     *   *document* declares it prints rather than from the locale, so it is
     *   evidence the Spanish edition was resolved;
     * - the file is 34 pages, which is HHSC's document. The Navigator
     *   worksheet this replaced was 5, so a regression to it fails here rather
     *   than passing as "a PDF with a Spanish name".
     *
     * Byte-identity with the source asset is deliberately *not* asserted: the
     * whole point is that the applicant's answers are drawn onto it. The
     * digest-level proof that the Spanish source was chosen lives in the
     * Python suite, which can hash the asset before rendering.
     */
    const href = await page
      .getByTestId('form-card-open-h1010')
      .getAttribute('href');

    expect(href).toBeTruthy();

    const response = await page.request.get(`${href}?download=1`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    expect(response.headers()['content-disposition']).toContain('Spanish');
    expect(response.headers()['content-disposition']).not.toContain('English');
    // Never the canonical storage name.
    expect(response.headers()['content-disposition']).not.toContain('TX-H1010');

    const body = await response.body();

    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCountOf(body)).toBe(34);
  });

  test('the prepared draft downloads under a Spanish name', async () => {
    const href = await page
      .getByTestId('tx-draft-download')
      .getAttribute('href');

    const response = await page.request.get(`${href}`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toContain('Spanish');
    // Never the canonical storage name.
    expect(response.headers()['content-disposition']).not.toContain('TX-H1010');
  });

  test('the bilingual forms are named as bilingual, not as a fallback', async () => {
    for (const code of ['h1049', 'h3037']) {
      const language = page.getByTestId(`form-card-language-${code}`);

      await expect(language).toHaveText(es.form_card_language_en_es);

      const note = page.getByTestId(`form-card-bilingual-${code}`);

      await expect(note).toHaveText(es.form_document_officially_bilingual);

      /*
       * The distinction the requirement is explicit about. A Spanish reader
       * holding HHSC's own Spanish text must not be told their language is not
       * published — so the fallback panel must not exist on these cards.
       */
      await expect(
        page.getByTestId(`form-card-fallback-${code}`),
      ).toHaveCount(0);
    }

    const body = await visibleText(page);

    expect(body).not.toContain(es.form_document_language_fallback);
  });

  test('both bilingual forms download the one canonical asset', async () => {
    const sizes: number[] = [];

    for (const [code, expected] of [
      ['h1049', 'Texas-H1049-Bilingual.pdf'],
      ['h3037', 'Texas-H3037-Bilingual.pdf'],
    ] as const) {
      const href = await page
        .getByTestId(`form-card-open-${code}`)
        .getAttribute('href');

      const response = await page.request.get(`${href}?download=1`);

      expect(response.status()).toBe(200);
      expect(response.headers()['content-disposition']).toContain(expected);
      // "Bilingual", never a language it only half is.
      expect(response.headers()['content-disposition']).not.toContain(
        'English',
      );
      expect(response.headers()['content-disposition']).not.toContain(
        'Spanish',
      );

      sizes.push((await response.body()).length);
    }

    expect(sizes).toEqual([32_909, 18_968]);
  });

  test('the H3037 card says where the Spanish stops', async () => {
    // Page 1 is the clinician's and is English only. "English & Spanish" flat
    // would overstate it to the reader who most needs the detail.
    await expect(page.getByTestId('tx-packet')).toContainText(
      es.form_document_bilingual_scope_signature_page_only,
    );
  });

  test('the completion guide explains the form in Spanish', async () => {
    const href = await page.getByTestId('tx-review-open').getAttribute('href');
    const response = await page.request.get(`${href}`);

    expect(response.status()).toBe(200);

    const html = await response.text();

    // The review sheet is the Texas completion guide, and it was English
    // regardless of locale.
    expect(html).toContain('Lo que llenamos por usted');
    expect(html).toContain('Dejado en blanco a propósito');
    expect(html).not.toContain('Filled in for you');

    // And it is announced to a screen reader as Spanish.
    expect(html).toContain('lang="es"');
  });

  test('no internal name, code or filename reaches the screen', async () => {
    const body = await visibleText(page);

    for (const pattern of INTERNAL_LEAKS) {
      expect(body, `${pattern} leaked into the Spanish interface`).not.toMatch(
        pattern,
      );
    }

    // The form's own designation *is* shown — a county office recognises it.
    await expect(page.getByTestId('form-card-code-h1010')).toHaveText('H1010');
  });
});

// ---------------------------------------------------------------------------
// English — the existing flow must not regress
// ---------------------------------------------------------------------------

test.describe('an English applicant receives the English H1010', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    page = await browser.newPage();
    await page.goto('/');

    await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
    await generatePacket(page, en);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('the H1010 card names the document English', async () => {
    await expect(page.getByTestId('form-card-language-h1010')).toHaveText(
      en.form_card_language_en,
    );
  });

  test('the delivered H1010 is HHSC’s English document, prefilled', async () => {
    const href = await page
      .getByTestId('form-card-open-h1010')
      .getAttribute('href');

    const response = await page.request.get(`${href}?download=1`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toContain('English');
    expect(response.headers()['content-disposition']).not.toContain('Spanish');

    const body = await response.body();

    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCountOf(body)).toBe(34);
  });

  test('the bilingual forms are the same asset an English reader gets', async () => {
    for (const [code, expected] of [
      ['h1049', 'Texas-H1049-Bilingual.pdf'],
      ['h3037', 'Texas-H3037-Bilingual.pdf'],
    ] as const) {
      await expect(page.getByTestId(`form-card-language-${code}`)).toHaveText(
        en.form_card_language_en_es,
      );

      const href = await page
        .getByTestId(`form-card-open-${code}`)
        .getAttribute('href');

      const response = await page.request.get(`${href}?download=1`);

      expect(response.status()).toBe(200);
      expect(response.headers()['content-disposition']).toContain(expected);
    }
  });

  test('an English reader is told the bilingual form is bilingual too', async () => {
    // Not a Spanish-only courtesy: "Official bilingual form" is a fact about
    // the document, and an English reader glancing at Spanish text on the page
    // should know why it is there.
    await expect(page.getByTestId('form-card-bilingual-h1049')).toHaveText(
      en.form_document_officially_bilingual,
    );
  });

  test('no internal name, code or filename reaches the screen', async () => {
    const body = await visibleText(page);

    for (const pattern of INTERNAL_LEAKS) {
      expect(body, `${pattern} leaked into the English interface`).not.toMatch(
        pattern,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The Spanish interface, for the questions asked one person at a time
// ---------------------------------------------------------------------------

test.describe('the per-person questions read as Spanish', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    page = await browser.newPage();
    await page.goto('/');
    await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
    await page.locator('header select').selectOption('es');

    await page
      .getByRole('button', {
        name: /Continue with|Review your application|Continuar con|Revise su solicitud/,
      })
      .click();

    await expect(page.getByTestId('program-selection-step')).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: es.programs_continue }).click();
    await completeApplicantStep(page, es);

    await page.getByTestId('tx.mail.same-yes').click();
    await page.getByTestId('tx.live.homeless-no').click();
    await page.getByTestId('tx-continue').click();

    await expect(page.getByTestId('tx-roster')).toBeVisible({
      timeout: 20_000,
    });

    for (let guard = 0; guard < 12; guard += 1) {
      const remove = page.getByTestId('tx-member-0-remove');

      if (!(await remove.isVisible().catch(() => false))) break;

      await remove.click();
    }

    await page.getByTestId('tx-roster-add').click();
    await page.getByTestId('tx-member-0-first-name').fill('Ana');
    await page.getByTestId('tx-member-0-last-name').fill('Rivera');
    await page.getByTestId('tx-member-0-dob').fill('2015-11-30');
    await page.getByTestId('tx-member-0-relationship').selectOption('child');
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('addresses the person by name, in Spanish', async () => {
    const person = page.getByTestId('tx-member-0');

    await expect(person).toContainText('Sobre Ana');
    await expect(person).toContainText('¿Qué beneficios solicita Ana?');
    await expect(person).toContainText('¿Vive Ana en Texas?');
    await expect(person).toContainText('¿Piensa Ana seguir viviendo en Texas?');

    // And never the English equivalents.
    await expect(person).not.toContainText('Which benefits');
    await expect(person).not.toContainText('Does Ana live in Texas?');
  });

  test('describes each program in Spanish', async () => {
    const programs = page.getByTestId('tx-member-0-programs');

    await expect(programs).toContainText('Ayuda a pagar el mandado.');
    await expect(programs).toContainText('Cobertura médica de bajo costo');

    // "Medicaid" and "CHIP" stay as the agency prints them.
    await expect(programs).toContainText('Medicaid');
    await expect(programs).toContainText('CHIP');
  });

  test('the progress bar is Spanish and accessible', async () => {
    const bar = page.getByRole('progressbar', { name: es.intake_progress_label });

    await expect(bar).toBeVisible();

    const value = Number(await bar.getAttribute('aria-valuenow'));

    expect(value).toBeGreaterThan(0);
    await expect(page.getByTestId('tx-progress-value')).toHaveText(`${value}%`);
    await expect(bar).toHaveAttribute('aria-valuetext', `${value}%`);
  });

  test('a per-person program selection reaches the Spanish form', async () => {
    /*
     * The end-to-end version of the per-person model: Ana asks for CHIP, and
     * the document she receives is HHSC's Spanish edition with her CHIP
     * category left for her to mark — named in the Spanish checklist rather
     * than left as an unexplained blank.
     */
    await page.getByTestId('tx-member-0-program-tx_chip').check();

    await walkToReview(page, { answers: PACKET_ANSWERS, roster: 'leave' });
    await page.getByTestId('tx-generate').click();

    await expect(page.getByTestId('tx-draft-ready')).toBeVisible({
      timeout: 90_000,
    });

    const guideHref = await page
      .getByTestId('tx-review-open')
      .getAttribute('href');

    const guide = await page.request.get(`${guideHref}`);

    expect(guide.status()).toBe(200);

    const sheet = await guide.text();

    expect(sheet).toContain('Medicaid o CHIP');
    expect(sheet).toContain('llene el círculo que le corresponde');
  });
});
