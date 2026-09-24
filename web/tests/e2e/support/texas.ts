//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Driving the Texas H1010 flow in a browser.
 *
 * The controls are addressed by the ids the *configuration* declares —
 * `tx.money.has_job` becomes `tx.money.has_job-yes` — so a spec names the
 * question rather than a position on a screen. A question that is renamed
 * breaks the driver loudly instead of the spec silently clicking the wrong
 * button.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** The Yes button of a tri-state question. */
export function yesButton(page: Page, questionId: string): Locator {
  return page.getByTestId(`${questionId}-yes`);
}

export function noButton(page: Page, questionId: string): Locator {
  return page.getByTestId(`${questionId}-no`);
}

/** Answer a tri-state question, or clear it back to unanswered. */
export async function answerYesNo(
  page: Page,
  questionId: string,
  value: boolean | null,
): Promise<void> {
  if (value === null) {
    await page.getByTestId(`${questionId}-clear`).click();
    return;
  }

  await (value ? yesButton(page, questionId) : noButton(page, questionId)).click();
}

/** Type into a text, money or choice question. */
export async function fillQuestion(
  page: Page,
  questionId: string,
  value: string,
): Promise<void> {
  const input = page.getByTestId(`input-${questionId}`);
  const tag = await input.evaluate((node) => node.tagName.toLowerCase());

  if (tag === 'select') {
    await input.selectOption(value);
    return;
  }

  await input.fill(value);
  // Values are normalised on blur, which is also when they are committed.
  await input.blur();
}

/** Whether a question is on the screen at all. */
export async function questionIsVisible(
  page: Page,
  questionId: string,
): Promise<boolean> {
  return page.getByTestId(`question-${questionId}`).isVisible();
}

export async function continueFlow(page: Page): Promise<void> {
  await page.getByTestId('tx-continue').click();
}

export async function backFlow(page: Page): Promise<void> {
  await page.getByTestId('tx-back').click();
}

/**
 * Walk back until the programmes screen, whichever Back button is on screen.
 *
 * The configured screens share one Back button; the applicant step is a
 * hand-written component with its own. A loop that only knew about `tx-back`
 * stalled the moment it reached the applicant step, which is one screen short
 * of where a spec that wants to change programmes needs to be.
 */
export async function backToPrograms(page: Page): Promise<void> {
  for (let guard = 0; guard < 16; guard += 1) {
    if (
      await page
        .getByTestId('program-selection-step')
        .isVisible()
        .catch(() => false)
    ) {
      return;
    }

    const configured = page.getByTestId('tx-back');

    if (await configured.isVisible().catch(() => false)) {
      await configured.click();
      continue;
    }

    const applicant = page.getByRole('button', {
      name: 'Back to program selection',
      exact: true,
    });

    if (await applicant.isVisible().catch(() => false)) {
      await applicant.click();
      continue;
    }

    throw new Error('no Back button on the current Texas screen');
  }

  throw new Error('never reached the programmes screen');
}

/** The section headings currently on screen, by configured id. */
export async function visibleSections(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="tx-section-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        (node.getAttribute('data-testid') ?? '').replace('tx-section-', ''),
      ),
    );
}

/**
 * The answers every walkthrough gives, keyed by the screen they belong to.
 *
 * Only the required ones. A walkthrough that answered everything would never
 * exercise the difference between "No" and "not answered", which is the
 * distinction the whole flow is built to preserve.
 */
export const REQUIRED_ANSWERS: Readonly<Record<string, boolean>> = {
  'tx.mail.same': true,
  'tx.live.homeless': false,
  'tx.household.food_together': true,
  'tx.household.pregnant': false,
  'tx.money.has_job': false,
  'tx.money.other_income': false,
  'tx.bills.has_household': false,
  'tx.urgent.income_and_resources': false,
  'tx.urgent.less_than_housing': false,
  'tx.urgent.farm_worker': false,
  'tx.helper.has': false,
};

/**
 * Answer every required question on the current screen and continue.
 *
 * Returns the sections that were on it, so a spec can assert which screens a
 * household is shown without hard-coding the order.
 */
export interface WalkOptions {
  answers?: Readonly<Record<string, boolean>>;
  /**
   * What to do with roster rows intake already found.
   *
   * `name` finishes them, which is what the flow asks for. `clear` removes
   * them, for a spec that needs a household of one — intake's household count
   * arrives before anyone types a name, so a row is usually already there.
   */
  roster?: 'name' | 'clear' | 'leave';
}

export async function completeScreen(
  page: Page,
  options: WalkOptions = {},
): Promise<string[]> {
  const sections = await visibleSections(page);
  const answers = { ...REQUIRED_ANSWERS, ...options.answers };

  if (options.roster === 'clear') {
    await emptyRoster(page);
  } else if (options.roster !== 'leave') {
    await nameEveryHouseholdMember(page);
  }

  for (const [questionId, value] of Object.entries(answers)) {
    const control = yesButton(page, questionId);

    if (!(await control.isVisible().catch(() => false))) continue;

    await answerYesNo(page, questionId, value);
  }

  await continueFlow(page);

  return sections;
}

/**
 * Walk from the "where you live" screen to the review screen.
 *
 * Collects the section ids of every screen shown, which is how a spec asserts
 * that a gateway removed one.
 */
export async function walkToReview(
  page: Page,
  options: WalkOptions = {},
): Promise<string[]> {
  const seen: string[] = [];

  for (let guard = 0; guard < 12; guard += 1) {
    if (await page.getByTestId('tx-generate').isVisible().catch(() => false)) {
      return seen;
    }

    seen.push(...(await completeScreen(page, options)));
  }

  throw new Error('the Texas flow did not reach its review screen');
}

/** Remove every roster row, for a household of one. */
export async function emptyRoster(page: Page): Promise<void> {
  const roster = page.getByTestId('tx-roster');

  if (!(await roster.isVisible().catch(() => false))) return;

  for (let guard = 0; guard < 12; guard += 1) {
    const remove = page.getByTestId('tx-member-0-remove');

    if (!(await remove.isVisible().catch(() => false))) return;

    await remove.click();
  }
}

/**
 * Give every roster row on screen the details the flow will not continue
 * without.
 *
 * Only fills what is blank, so a spec that has typed a name of its own keeps
 * it.
 */
export async function nameEveryHouseholdMember(page: Page): Promise<void> {
  const roster = page.getByTestId('tx-roster');

  if (!(await roster.isVisible().catch(() => false))) return;

  const rows = await page.locator('[data-testid^="tx-member-"][data-testid$="-first-name"]').count();

  for (let index = 0; index < rows; index += 1) {
    const fields: Array<[string, string]> = [
      [`tx-member-${index}-first-name`, `Persona${index + 1}`],
      [`tx-member-${index}-last-name`, 'Ramirez'],
      [`tx-member-${index}-dob`, '1989-07-19'],
    ];

    for (const [testId, value] of fields) {
      const field = page.getByTestId(testId);

      if ((await field.inputValue()) !== '') continue;

      await field.fill(value);
    }

    const relationship = page.getByTestId(`tx-member-${index}-relationship`);

    if ((await relationship.inputValue()) === '') {
      await relationship.selectOption('spouse');
    }
  }
}

/** Fill the applicant step's required fields and continue. */
/**
 * The applicant step's labels, in one locale.
 *
 * Read from the message catalogue rather than written out, because this step is
 * a hand-written component addressed by accessible name — so a driver holding
 * its own copy of "First name" would pass while the interface said something
 * else, and could not drive the step in Spanish at all.
 *
 * That was the blocker for a genuine end-to-end Spanish flow: the driver was
 * English-only, so a Spanish spec had to switch language *after* this screen
 * and could never prove the whole journey.
 */
export interface ApplicantLabels {
  field_first_name: string;
  field_last_name: string;
  field_date_of_birth: string;
  field_street_address: string;
  field_city: string;
  field_zip_code: string;
  field_marital_status: string;
  applicant_citizen_question: string;
  ui_yes: string;
  /*
   * The Texas flow overrides the applicant step's continue label to
   * `intake_continue`, so this is the key the button actually renders — not
   * `applicant_continue`, which is California's. Naming the wrong one waits
   * forever for a button that says something else.
   */
  intake_continue: string;
}

/** Escape a catalogue string for use inside a regular expression. */
function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function completeApplicantStep(
  page: Page,
  labels: ApplicantLabels,
): Promise<void> {
  const values: Array<[string, string]> = [
    [labels.field_first_name, 'Marisol'],
    [labels.field_last_name, 'Ramirez'],
    [labels.field_date_of_birth, '1991-03-14'],
    [labels.field_street_address, '2100 Nueces Street'],
    [labels.field_city, 'Austin'],
    [labels.field_zip_code, '78705'],
  ];

  for (const [label, value] of values) {
    // The asterisk is part of the rendered label text; see support/app.ts.
    const field = page
      .getByLabel(new RegExp(`^${literal(label)}\\s*\\*?$`))
      .first();

    await field.fill(value);
  }

  /*
   * Addressed by role and accessible name. The asterisk beside a required
   * label is `aria-hidden`, so the accessible name is the bare label — which
   * is what a screen reader announces and what a test should therefore look
   * for.
   */
  await page
    .getByRole('combobox', { name: labels.field_marital_status, exact: true })
    .selectOption('single');

  // Citizenship is a tri-state, so it is a button rather than a field.
  await page
    .getByRole('group', {
      name: new RegExp(literal(labels.applicant_citizen_question)),
    })
    .getByRole('button', { name: labels.ui_yes, exact: true })
    .click();

  await page
    .getByRole('button', { name: labels.intake_continue, exact: true })
    .click();

  await expect(page.getByTestId('tx-application')).toBeVisible({
    timeout: 20_000,
  });
}
