/**
 * E2E: an Austin household fills Form H1010 and downloads it.
 *
 * The production gate for the Texas application, and the counterpart to
 * `saws2-application.spec.ts`. Unit tests prove the question set is consistent
 * and the mapping suite proves where each answer lands on the page. What only a
 * browser can show is that the two meet: that a person can start at a Texas
 * report, work through Texas screens, and end up holding a document with their
 * own answers on it.
 *
 * ── What each test is protecting ───────────────────────────────────────────
 * The screens are generated from a configuration, so the failure modes are not
 * "a button is missing" but "a gate opened the wrong thing" and "a household
 * was asked a question that leads nowhere". Every test here is about branching,
 * requiredness, or the document at the end.
 *
 * Serial, and one report for the whole file: reaching a report means walking
 * intake, a workflow run and an SSE stream, and paying that per test would make
 * the file slow enough to be skipped.
 */
import { test, expect } from '@playwright/test';

import {
  AUSTIN_TIER_1_ANSWERS,
  CALIFORNIA_ONLY_TERMS,
  completeIntakeAndAwaitReport,
} from './support/app';
import {
  answerYesNo,
  backFlow,
  backToPrograms,
  completeApplicantStep,
  continueFlow,
  fillQuestion,
  questionIsVisible,
  walkToReview,
} from './support/texas';
import en from '../../src/i18n/messages/en';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

let page: import('@playwright/test').Page;

/** Start the Texas application from the report, at the programmes screen. */
async function openApplication(): Promise<void> {
  await page
    .getByRole('button', { name: /Continue with|Review your application/ })
    .click();

  await expect(page.getByTestId('program-selection-step')).toBeVisible({
    timeout: 30_000,
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);

  page = await browser.newPage();

  await page.goto('/');
  await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
});

test.afterAll(async () => {
  await page?.close();
});

test.describe('Texas H1010 — the application production gate', () => {
  test('the report leads to a Texas application, not a California one', async () => {
    await openApplication();

    const step = page.getByTestId('program-selection-step');

    // The agency's own designation, above the heading.
    await expect(step).toContainText('H1010');

    // Never the "recommendation unavailable" panel, which is what a Texas
    // household used to get here, and never the manual guide.
    await expect(page.getByText(en.shell_rec_unavailable)).toHaveCount(0);
    await expect(page.getByTestId('manual-application')).toHaveCount(0);

    const text = (await step.innerText()).replace(/\s+/g, ' ');

    await expect(step).toContainText(en.program_tx_snap);

    for (const term of CALIFORNIA_ONLY_TERMS) {
      expect(text, `California term leaked: ${term}`).not.toContain(term);
    }
  });

  test('a single adult applying for food benefits reaches the review screen', async () => {
    await page.getByRole('button', { name: en.programs_continue }).click();

    await completeApplicantStep(page, en);

    /*
     * `roster: 'clear'` makes this a household of one. Intake counted two
     * adults for the Austin demo household, so a row arrives already present
     * with no name on it — which is the right product behaviour (the person
     * intake found is not silently dropped) and the wrong shape for this test.
     */
    const seen = await walkToReview(page, { roster: 'clear' });

    // Every configured section was shown, including the SNAP-only screen.
    expect(seen).toContain('tx-mailing');
    expect(seen).toContain('tx-household');
    expect(seen).toContain('tx-money');
    expect(seen).toContain('tx-urgent');
    expect(seen).toContain('tx-helper');

    await expect(page.getByTestId('tx-review')).toBeVisible();
    await expect(page.getByTestId('tx-review-household-size')).toHaveText('1');
  });

  test('the review screen says the document is HHSC’s own form', async () => {
    /*
     * The single most important sentence in the Texas flow, and it has
     * changed. It used to say the document was a worksheet and not the
     * agency's paper, which was true while we could only fill 29 of the
     * intake's answers onto the official form.
     *
     * We now fill every answer H1010 has a box for, so the document *is* the
     * agency's paper — and the sentence that matters is the one about the
     * boxes still left to complete by hand. Claiming otherwise in either
     * direction is the failure this test exists for: a worksheet presented as
     * the official form gets posted to a county office and heard nothing
     * about, and the official form presented as a worksheet gets retyped for
     * no reason.
     */
    const step = page.getByTestId('tx-application');

    await expect(step).toContainText('Texas HHSC’s own Form H1010');
    await expect(step).toContainText('yours to complete by hand');

    // And not the claim it replaced.
    await expect(step).not.toContainText('not the agency’s own paper');
  });

  test('the applicant reaches a generated H1010 and its review sheet', async () => {
    await page.getByTestId('tx-generate').click();

    const ready = page.getByTestId('tx-draft-ready');

    await expect(ready).toBeVisible({ timeout: 60_000 });

    // ── The document ────────────────────────────────────────────────────
    const download = page.getByTestId('tx-draft-download');
    const href = await download.getAttribute('href');

    expect(href).toContain('/draft');

    const pdf = await page.request.get(`${href}`);

    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    /*
     * The download name is language-aware and built from the document the
     * packet resolved, not from the form code alone: an English applicant gets
     * "-English", a Spanish one "-Spanish", and a bilingual form "-Bilingual".
     * See tx-form-language.spec.ts, and lib/document-labels.ts for why the
     * language word comes from the asset rather than the locale.
     *
     * "Prefilled", not "Worksheet". It said Worksheet while the document was
     * ours rather than HHSC's paper; the official H1010 now carries every
     * answer it has a box for, so the filename should not be the one surface
     * still calling it a worksheet.
     */
    expect(pdf.headers()['content-disposition']).toContain(
      'Texas-H1010-Application-English-Prefilled-Draft.pdf',
    );
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    // ── The review sheet, which is this document's completion guide ─────
    const guideHref = await page
      .getByTestId('tx-review-open')
      .getAttribute('href');

    const guide = await page.request.get(`${guideHref}`);

    expect(guide.status()).toBe(200);

    const sheet = await guide.text();

    // What it filled in, from answers given in this browser.
    expect(sheet).toContain('Marisol');
    expect(sheet).toContain('2100 Nueces Street');

    /*
     * And it no longer warns that this is not the official form, because it
     * is. The sheet's opening line now names the document the applicant is
     * holding and the language it is printed in.
     */
    expect(sheet).not.toContain('THIS IS NOT THE OFFICIAL FORM.');
    // Apostrophes are HTML-escaped in the rendered sheet, so this asserts on
    // the part of the sentence that has none.
    expect(sheet).toContain('own form, published in your language');

    /*
     * What the applicant must still do by hand, named rather than implied.
     *
     * This asserted "Not applicable to your household" — a section the
     * worksheet produced because its mailing-address fields sat behind a
     * gateway. HHSC's form prints both address blocks unconditionally, so
     * there is no gateway and no such section, and the guarantee worth
     * asserting instead is the one the sheet gained: every answer the form has
     * no box for, with what to do about it. See h1010_coverage.
     */
    expect(sheet).toContain('the form has no box for it');

    /*
     * One note this household certainly produces: the walkthrough answers
     * "do you buy and prepare food together", SNAP turns on it, and H1010
     * prints no box for it — HHSC establishes it at the interview.
     */
    expect(sheet).toContain('You buy and prepare food together');
    expect(sheet).toContain('ask you this at your interview');

    // What somebody other than the applicant completes.
    expect(sheet).toContain('Left for someone else to complete');
    expect(sheet).toContain('You sign this yourself');

    // And nothing we refuse to place.
    expect(sheet).toContain('We never fill these in.');
  });

  test('an incomplete required answer blocks Continue and names what is missing', async () => {
    // Back to the household screen, and clear an answer it will not go on
    // without. The Continue button stays clickable on purpose: a disabled one
    // cannot be focused, so a keyboard user reaches the end and is told nothing.
    await backFlow(page);

    for (let step = 0; step < 8; step += 1) {
      if (await questionIsVisible(page, 'tx.household.pregnant')) break;

      await backFlow(page);
    }

    await answerYesNo(page, 'tx.household.pregnant', null);
    await continueFlow(page);

    const notice = page.getByTestId('tx-missing');

    await expect(notice).toBeVisible();
    await expect(notice).toContainText(en.tx_q_pregnant);

    // And the screen did not advance.
    await expect(
      page.getByTestId('question-tx.household.pregnant'),
    ).toBeVisible();

    // Answering it lets the flow move on again.
    await answerYesNo(page, 'tx.household.pregnant', false);
    await continueFlow(page);

    await expect(notice).toHaveCount(0);
  });

  test('a shut gateway hides the questions behind it', async () => {
    // Back to the mailing screen.
    for (let step = 0; step < 8; step += 1) {
      if (await questionIsVisible(page, 'tx.mail.same')) break;

      await backFlow(page);
    }

    // Mail comes to the home address, so there is no mailing address to give.
    await answerYesNo(page, 'tx.mail.same', true);

    expect(await questionIsVisible(page, 'tx.mail.street')).toBe(false);

    // Answering No opens the block, and its fields are required.
    await answerYesNo(page, 'tx.mail.same', false);

    expect(await questionIsVisible(page, 'tx.mail.street')).toBe(true);

    await continueFlow(page);
    await expect(page.getByTestId('tx-missing')).toBeVisible();

    await fillQuestion(page, 'tx.mail.street', 'PO Box 4477');
    await fillQuestion(page, 'tx.mail.city', 'Austin');
    await fillQuestion(page, 'tx.mail.state', 'TX');
    await fillQuestion(page, 'tx.mail.zip', '78765');

    await continueFlow(page);

    await expect(page.getByTestId('tx-missing')).toHaveCount(0);
  });

  test('naming someone to apply on your behalf opens their details', async () => {
    for (let step = 0; step < 10; step += 1) {
      if (await questionIsVisible(page, 'tx.helper.has')) break;

      await continueFlow(page);
    }

    await answerYesNo(page, 'tx.helper.has', false);
    await expect(page.getByTestId('record-list-tx-representative')).toHaveCount(
      0,
    );

    await answerYesNo(page, 'tx.helper.has', true);

    const list = page.getByTestId('record-list-tx-representative');

    await expect(list).toBeVisible();

    await list.getByTestId('record-list-tx-representative-add').click();

    // A named helper needs a name; the flow says so rather than filing a blank.
    await continueFlow(page);
    await expect(page.getByTestId('tx-missing')).toBeVisible();

    await fillQuestion(page, 'tx-representative-0-name', 'Ana Villarreal');
    await fillQuestion(
      page,
      'tx-representative-0-organization',
      'Central Texas Food Bank',
    );

    await continueFlow(page);
    await expect(page.getByTestId('tx-generate')).toBeVisible();
  });

  test('a household of several people fills the printed table', async () => {
    for (let step = 0; step < 10; step += 1) {
      if (await page.getByTestId('tx-roster').isVisible().catch(() => false)) {
        break;
      }

      await backFlow(page);
    }

    const roster = page.getByTestId('tx-roster');

    await expect(roster).toBeVisible();

    await roster.getByTestId('tx-roster-add').click();

    await page.getByTestId('tx-member-0-first-name').fill('Diego');
    await page.getByTestId('tx-member-0-last-name').fill('Ramirez');
    await page.getByTestId('tx-member-0-dob').fill('1989-07-19');
    await page
      .getByTestId('tx-member-0-relationship')
      .selectOption('spouse');
    await page.getByTestId('tx-member-0-sex').selectOption('male');
    await page.getByTestId('tx-member-0-citizen-yes').click();

    await continueFlow(page);

    // Household size follows the roster; it is derived, never asked for.
    for (let step = 0; step < 10; step += 1) {
      if (await page.getByTestId('tx-generate').isVisible().catch(() => false)) {
        break;
      }

      await continueFlow(page);
    }

    await expect(page.getByTestId('tx-review-household-size')).toHaveText('2');
  });

  test('a household that is not asking for food benefits skips the SNAP screen', async () => {
    // All the way back to the programmes screen.
    await backToPrograms(page);

    const step = page.getByTestId('program-selection-step');

    await expect(step).toBeVisible();

    // Untick food benefits, leaving healthcare.
    const snap = step
      .locator('label', { hasText: en.program_tx_snap })
      .locator('input[type="checkbox"]');

    if (await snap.isChecked()) await snap.uncheck();

    const medicaid = step
      .locator('label', { hasText: en.program_tx_medicaid })
      .locator('input[type="checkbox"]');

    if (!(await medicaid.isChecked())) await medicaid.check();

    await page.getByRole('button', { name: en.programs_continue }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    const seen = await walkToReview(page);

    /*
     * The expedited screen is Texas's SNAP screen. A healthcare-only household
     * must never be asked whether their food will run out in three days — the
     * answer leads nowhere, and asking it is how a form loses someone's
     * attention before the questions that matter.
     */
    expect(seen).not.toContain('tx-urgent');
    expect(seen).toContain('tx-household');
  });
});
