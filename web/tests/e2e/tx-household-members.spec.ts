//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Adding people to a Texas household, in a real browser.
 *
 * ── Why these tests live here and not in Vitest ────────────────────────────
 * The bug they were written for cannot be reproduced without a real DOM and a
 * real keyboard. A household member's name input accepted **one character at a
 * time**: after each keystroke the input lost focus, so an applicant typing
 * "Maria" got "M" and had to click back into the field five times.
 *
 * Nothing about the value was wrong — state updated correctly every time. What
 * broke was the input's *identity*: it was a new DOM node after every render,
 * so the browser had nothing to keep focus on.
 *
 * That is invisible to a test that sets a value in one shot. `fill()` assigns
 * the whole string and fires one event, and it passed throughout. Only typing
 * character by character — `pressSequentially()` — reproduces it, and only in a
 * browser that actually tracks focus.
 *
 * ── What each test protects ────────────────────────────────────────────────
 * Continuous typing, on every editable person field. Stable identity across
 * edits, adds and removes. And the per-person questions the H1010 asks, which
 * a household of three has to be able to answer differently for each person.
 */
import { test, expect, type Page } from '@playwright/test';

import { AUSTIN_TIER_1_ANSWERS, completeIntakeAndAwaitReport } from './support/app';
import { completeApplicantStep } from './support/texas';
import en from '../../src/i18n/messages/en';

test.describe.configure({ mode: 'serial', timeout: 300_000 });

/** Walk from a fresh report to the household screen. */
async function openHouseholdScreen(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /Continue with|Review your application/ })
    .click();

  await expect(page.getByTestId('program-selection-step')).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: en.programs_continue }).click();
  await completeApplicantStep(page, en);

  // "Where you live" comes before the household screen.
  await page.getByTestId('tx.mail.same-yes').click();
  await page.getByTestId('tx.live.homeless-no').click();
  await page.getByTestId('tx-continue').click();

  await expect(page.getByTestId('tx-roster')).toBeVisible({ timeout: 20_000 });
}

/** Remove every roster row, so a test starts from a known household. */
async function emptyRoster(page: Page): Promise<void> {
  for (let guard = 0; guard < 12; guard += 1) {
    const remove = page.getByTestId('tx-member-0-remove');

    if (!(await remove.isVisible().catch(() => false))) return;

    await remove.click();
  }
}

test.describe('adding people to the household', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    page = await browser.newPage();
    await page.goto('/');
    await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
    await openHouseholdScreen(page);
    await emptyRoster(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('a name can be typed continuously, one keystroke after another', async () => {
    /*
     * The regression test for the one-character bug.
     *
     * `pressSequentially` types like a person: one keydown/keypress/input per
     * character, with no re-focus in between. If the input is remounted on any
     * keystroke the browser drops focus and every later character goes
     * nowhere, so the field ends up holding "M" instead of "María".
     *
     * `fill()` is deliberately not used here — it sets the value in a single
     * assignment and passed the whole time the bug was live.
     */
    await page.getByTestId('tx-roster-add').click();

    const firstName = page.getByTestId('tx-member-0-first-name');

    await firstName.click();
    await firstName.pressSequentially('María Elena', { delay: 15 });

    await expect(firstName).toHaveValue('María Elena');

    // And the field still has focus, which is what the bug destroyed.
    await expect(firstName).toBeFocused();
  });

  test('every editable person field survives continuous typing', async () => {
    const lastName = page.getByTestId('tx-member-0-last-name');

    await lastName.click();
    await lastName.pressSequentially('Rodríguez Salazar', { delay: 15 });

    await expect(lastName).toHaveValue('Rodríguez Salazar');
    await expect(lastName).toBeFocused();

    // The first name is still what it was: nothing was reset by typing here.
    await expect(page.getByTestId('tx-member-0-first-name')).toHaveValue(
      'María Elena',
    );
  });

  test('a second person can be typed into without disturbing the first', async () => {
    await page.getByTestId('tx-roster-add').click();

    const secondFirst = page.getByTestId('tx-member-1-first-name');

    await secondFirst.click();
    await secondFirst.pressSequentially('Diego', { delay: 15 });

    await expect(secondFirst).toHaveValue('Diego');
    await expect(page.getByTestId('tx-member-0-first-name')).toHaveValue(
      'María Elena',
    );
  });

  test('removing a person keeps the other answers with the right people', async () => {
    /*
     * The row a remove button belongs to is addressed by position, so a person
     * identified by their index rather than a stable id would leave the
     * survivors' answers shifted up by one.
     */
    await page.getByTestId('tx-member-0-remove').click();

    await expect(page.getByTestId('tx-member-0-first-name')).toHaveValue(
      'Diego',
    );
    await expect(page.getByTestId('tx-member-1')).toHaveCount(0);
  });
});

test.describe('the per-person questions H1010 asks', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    page = await browser.newPage();
    await page.goto('/');
    await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
    await openHouseholdScreen(page);
    await emptyRoster(page);

    // One adult and one child, so the age-dependent questions are exercised
    // in both directions on the same screen.
    await page.getByTestId('tx-roster-add').click();
    await page.getByTestId('tx-member-0-first-name').fill('Diego');
    await page.getByTestId('tx-member-0-last-name').fill('Rivera');
    await page.getByTestId('tx-member-0-dob').fill('1989-07-02');

    await page.getByTestId('tx-roster-add').click();
    await page.getByTestId('tx-member-1-first-name').fill('Ana');
    await page.getByTestId('tx-member-1-last-name').fill('Rivera');
    await page.getByTestId('tx-member-1-dob').fill('2015-11-30');
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('each person is addressed by name once they have one', async () => {
    /*
     * "About Diego", not "Household Member 1". The applicant knows who lives
     * with them, and their own questions should use the name they just typed.
     */
    await expect(page.getByTestId('tx-member-0')).toContainText('About Diego');
    await expect(page.getByTestId('tx-member-1')).toContainText('About Ana');

    // And the questions inside use it too.
    await expect(page.getByTestId('tx-member-1')).toContainText(
      'Which benefits is Ana applying for?',
    );
    await expect(page.getByTestId('tx-member-1')).toContainText(
      'Does Ana plan to keep living in Texas?',
    );
  });

  test('each person can be applying for different benefits', async () => {
    await page.getByTestId('tx-member-0-program-tx_tanf').check();
    await page.getByTestId('tx-member-1-program-tx_chip').check();

    await expect(
      page.getByTestId('tx-member-0-program-tx_tanf'),
    ).toBeChecked();
    await expect(
      page.getByTestId('tx-member-1-program-tx_chip'),
    ).toBeChecked();

    // And nobody is opted into anything they were not chosen for.
    await expect(
      page.getByTestId('tx-member-0-program-tx_chip'),
    ).not.toBeChecked();
    await expect(
      page.getByTestId('tx-member-1-program-tx_tanf'),
    ).not.toBeChecked();
  });

  test('each program says what it helps with, without promising anything', async () => {
    const packet = page.getByTestId('tx-member-1-programs');

    await expect(packet).toContainText('Helps pay for groceries.');
    await expect(packet).toContainText(
      'Low-cost health coverage for children',
    );
  });

  test('marital status is asked of the adult and not of the child', async () => {
    /*
     * H1010 prints the circles in every person block, but a nine-year-old's
     * marital status is not a question anyone expects answered — so it is not
     * shown rather than shown and left blank.
     */
    await expect(page.getByTestId('tx-member-0-marital-status')).toBeVisible();
    await expect(page.getByTestId('tx-member-1-marital-status')).toHaveCount(0);

    await page
      .getByTestId('tx-member-0-marital-status')
      .selectOption('married');

    await expect(page.getByTestId('tx-member-0-marital-status')).toHaveValue(
      'married',
    );
  });

  test('full-time study is asked only of someone in school', async () => {
    await expect(page.getByTestId('tx-member-1-full-time-yes')).toHaveCount(0);

    await page.getByTestId('tx-member-1-school-yes').click();
    await expect(page.getByTestId('tx-member-1-full-time-yes')).toBeVisible();

    await page.getByTestId('tx-member-1-full-time-yes').click();

    // Answering No to school takes the follow-up away again.
    await page.getByTestId('tx-member-1-school-no').click();
    await expect(page.getByTestId('tx-member-1-full-time-yes')).toHaveCount(0);
  });

  test('residency answers persist, including an explicit no', async () => {
    await page.getByTestId('tx-member-0-lives-in-texas-yes').click();
    await page.getByTestId('tx-member-0-stays-in-texas-no').click();

    await expect(
      page.getByTestId('tx-member-0-lives-in-texas-yes'),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByTestId('tx-member-0-stays-in-texas-no'),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('answers survive editing a name, which does not change who they are', async () => {
    /*
     * Person identity has to be stable across edits. If a row were keyed on
     * its name, renaming would remount it and drop every answer stored
     * against it.
     */
    const firstName = page.getByTestId('tx-member-0-first-name');

    await firstName.click();
    await firstName.press('End');
    await firstName.pressSequentially(' Alberto', { delay: 15 });

    await expect(firstName).toHaveValue('Diego Alberto');
    await expect(page.getByTestId('tx-member-0-marital-status')).toHaveValue(
      'married',
    );
    await expect(
      page.getByTestId('tx-member-0-program-tx_tanf'),
    ).toBeChecked();

    // And the questions follow the new name.
    await expect(page.getByTestId('tx-member-0')).toContainText(
      'About Diego Alberto',
    );
  });

  test('every question sits above its own control and is labelled', async () => {
    /*
     * The layout requirement, asserted where it can be: each field's label
     * points at the control it names, and the control sits below the label
     * rather than beside it.
     */
    for (const field of [
      'first-name',
      'last-name',
      'dob',
      'relationship',
      'sex',
      'marital-status',
    ]) {
      const control = page.getByTestId(`tx-member-0-${field}`);
      const id = await control.getAttribute('id');

      expect(id, `${field} has no id for its label to point at`).toBeTruthy();

      const label = page.locator(`label[for="${id}"]`);

      await expect(label).toHaveCount(1);

      const labelBox = await label.boundingBox();
      const controlBox = await control.boundingBox();

      expect(labelBox).not.toBeNull();
      expect(controlBox).not.toBeNull();

      // Above, not beside: the label's bottom is at or above the control's top.
      expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(
        controlBox!.y + 1,
      );
    }
  });

  test('the yes/no questions are reachable and answerable by keyboard', async () => {
    const yes = page.getByTestId('tx-member-1-lives-in-texas-yes');

    await yes.focus();
    await expect(yes).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(yes).toHaveAttribute('aria-pressed', 'true');

    // The group carries the question as its accessible name.
    await expect(
      page.getByRole('group', { name: 'Does Ana live in Texas?' }),
    ).toBeVisible();
  });

  test('the name fields are wide enough to read on a phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });

    const firstName = page.getByTestId('tx-member-0-first-name');
    const box = await firstName.boundingBox();

    expect(box).not.toBeNull();
    /*
     * Most of the viewport, not a half-width column. The two-column pair
     * collapses below `sm`, which is what stops a name field from being the
     * 150px sliver it was when the grid stayed two-up on a phone.
     */
    expect(box!.width / 390).toBeGreaterThan(0.55);

    await page.setViewportSize({ width: 1280, height: 900 });
  });
});

test.describe('the progress bar', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    page = await browser.newPage();
    await page.goto('/');
    await completeIntakeAndAwaitReport(page, AUSTIN_TIER_1_ANSWERS);
    await openHouseholdScreen(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('reports progress with accessible semantics', async () => {
    const bar = page.getByRole('progressbar', { name: 'Progress' });

    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');

    const value = Number(await bar.getAttribute('aria-valuenow'));

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(100);

    // The shown percentage and the announced one are the same number.
    await expect(page.getByTestId('tx-progress-value')).toHaveText(
      `${value}%`,
    );
  });

  test('the filled portion matches the reported percentage', async () => {
    /*
     * Polled rather than measured once. The fill animates its width over
     * 300ms, so a bounding box read straight after the value changed catches
     * the transition part-way and measures the animation instead of the
     * answer. Retrying until the two agree asserts the end state, which is
     * the thing that matters, without hard-coding a wait.
     */
    const bar = page.getByRole('progressbar', { name: 'Progress' });

    await expect(async () => {
      const value = Number(await bar.getAttribute('aria-valuenow'));
      const track = await bar.boundingBox();
      const fill = await page.getByTestId('tx-progress-fill').boundingBox();

      expect(track).not.toBeNull();
      expect(fill).not.toBeNull();

      // Compared in pixels: the fill is styled as a percentage, so the
      // browser rounds it to a device pixel.
      const expected = (track!.width * value) / 100;

      expect(Math.abs(fill!.width - expected)).toBeLessThan(2);
    }).toPass({ timeout: 5_000 });
  });

  test('never moves backward when a conditional question disappears', async () => {
    /*
     * The regression this exists for. Answering "yes, someone has a job" opens
     * the jobs table; answering "no" again closes it, which removes questions
     * from *both* the numerator and the denominator and can lower the ratio.
     * Nothing the applicant did was undone, so a smaller number reads as lost
     * work.
     */
    const bar = page.getByRole('progressbar', { name: 'Progress' });
    const readings: number[] = [];

    async function record() {
      readings.push(Number(await bar.getAttribute('aria-valuenow')));
    }

    await record();

    await page.getByTestId('tx.household.food_together-yes').click();
    await record();

    await page.getByTestId('tx.household.pregnant-yes').click();
    await record();

    // And take an answer back, which is what used to make it retreat.
    await page.getByTestId('tx.household.pregnant-no').click();
    await record();

    await page.getByTestId('tx.household.food_together-clear').click();
    await record();

    for (let index = 1; index < readings.length; index += 1) {
      expect(
        readings[index],
        `progress went ${readings[index - 1]}% → ${readings[index]}%`,
      ).toBeGreaterThanOrEqual(readings[index - 1]);
    }
  });

  test('adding a person does not throw progress away', async () => {
    const bar = page.getByRole('progressbar', { name: 'Progress' });
    const before = Number(await bar.getAttribute('aria-valuenow'));

    await page.getByTestId('tx-roster-add').click();
    await page.getByTestId('tx-member-0-first-name').fill('Luis');

    expect(
      Number(await bar.getAttribute('aria-valuenow')),
    ).toBeGreaterThanOrEqual(before);
  });
});
