//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * How the browser tests address the application.
 *
 * One module so the suite has a single place to update when the UI moves, and
 * so the choice of locator is made deliberately per element rather than by
 * whichever selector happened to be to hand.
 *
 * The order of preference is accessible role and name first, then visible text,
 * then a test id. Interactive controls all carry accessible names already —
 * addressing them by role is both more resilient and an implicit assertion that
 * the control is reachable by assistive technology. Test ids are reserved for
 * the structural things that have no role of their own: a conversation turn, a
 * phase tile, a report section.
 *
 * Accessible names come from the message catalogue, so the suite pins the
 * browser locale to en-US in playwright.config.ts. A test that needs another
 * locale asserts the translated name explicitly.
 */

import type { Locator, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Intake conversation
// ---------------------------------------------------------------------------

/** The message box. Accessible name comes from `chat_input_aria`. */
export function chatInput(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Your message' });
}

/** Submit button. Accessible name comes from `chat_send_aria`. */
export function sendButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Send message' });
}

/** "Skip remaining questions" — only rendered once skipping is offered. */
export function skipButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Skip remaining questions' });
}

/** "Run Analysis" — rendered once every intake field has an answer. */
export function runAnalysisButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Run Analysis' });
}

/** The conversation log. */
export function chatMessages(page: Page): Locator {
  return page.getByTestId('chat-messages');
}

export function assistantMessages(page: Page): Locator {
  return page.getByTestId('assistant-message');
}

export function userMessages(page: Page): Locator {
  return page.getByTestId('user-message');
}

// ---------------------------------------------------------------------------
// Progress and errors
// ---------------------------------------------------------------------------

export function phaseTracker(page: Page): Locator {
  return page.getByTestId('phase-tracker');
}

export function phaseTile(page: Page, phase: string): Locator {
  return page.getByTestId(`phase-tile-${phase}`);
}

/** The error banner. It is a live region, so `role=alert` identifies it. */
export function errorBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: /.+/ });
}

export function retryButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Try Again' });
}

export function editInfoButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Edit my information' });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function reportView(page: Page): Locator {
  return page.getByTestId('report-view');
}

export function bottomLine(page: Page): Locator {
  return page.getByTestId('bottom-line');
}

export function reportSection(page: Page, phaseName: string): Locator {
  return page.getByTestId(`section-${phaseName}`);
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

/**
 * Answer one intake question and wait for the assistant to reply.
 *
 * Waiting on the assistant-message count rather than a timeout is what keeps
 * the intake helpers from racing the server: the next question cannot be
 * answered until the previous reply has rendered.
 */
export async function answer(page: Page, text: string): Promise<void> {
  const before = await assistantMessages(page).count();

  await chatInput(page).fill(text);
  await sendButton(page).click();

  await page
    .locator('[data-testid="assistant-message"]')
    .nth(before)
    .waitFor({ state: 'visible' });
}

/**
 * The Tier 1 answers, in the order the intake asks for them.
 *
 * Intake is one field at a time and validates each: the ZIP field rejects
 * anything but five digits ("Enter a valid 5-digit ZIP code"), and income
 * rejects anything it cannot parse as a number. An earlier version of the suite
 * sent a single sentence carrying every fact — "ZIP 77001, income $42k, single
 * parent 2 kids ages 4 and 9" — which the current intake refuses outright, so
 * every journey stalled on question one.
 *
 * 77001 is Houston: the report fixtures are Texas-specific, and the report
 * assertions depend on it.
 */
export const TIER_1_ANSWERS: readonly string[] = [
  '77001',
  '42000',
  'Single parent with 2 kids ages 4 and 9',
];

/**
 * Answer the three Tier 1 questions and stop.
 *
 * Callers that want the skip offer or the Run Analysis button handle those
 * themselves — several specs assert on exactly those transitions.
 */
export async function answerTier1(
  page: Page,
  answers: readonly string[] = TIER_1_ANSWERS,
): Promise<void> {
  await chatInput(page).waitFor({ state: 'visible' });

  for (const value of answers) {
    await answer(page, value);
  }
}

/**
 * Complete intake. The run starts on its own.
 *
 * This is the behaviour the product actually has: when the last required answer
 * lands, `/api/intake` replies `ready` and ChatInterface immediately POSTs to
 * `/api/workflow/start`. The "Run Analysis" button is *not* on this path — it
 * exists only for re-running after the applicant edits an answer or stops a
 * run, which is exactly what its own comment in chat-interface.tsx says.
 *
 * The suite used to complete intake and then wait for that button, so every
 * journey timed out looking for a control the product deliberately does not
 * show at that moment.
 *
 * Resolves once the phase tracker is up, which is the first observable sign the
 * run began.
 */
export async function completeIntakeAndRun(
  page: Page,
  answers: readonly string[] = TIER_1_ANSWERS,
): Promise<void> {
  await answerTier1(page, answers);

  const skip = skipButton(page);

  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }

  await phaseTracker(page).waitFor({ state: 'visible' });
}

/**
 * Complete intake and wait for the finished report.
 *
 * The fixture run completes in a couple of seconds, but the timeout is generous
 * because the first run in a session also pays for the dev server compiling the
 * SSE and report routes.
 */
export async function completeIntakeAndAwaitReport(
  page: Page,
  answers: readonly string[] = TIER_1_ANSWERS,
): Promise<void> {
  await completeIntakeAndRun(page, answers);
  await reportView(page).waitFor({ state: 'visible', timeout: 90_000 });
}

// ---------------------------------------------------------------------------
// The SAWS 2 PLUS application flow
// ---------------------------------------------------------------------------

/**
 * A California ZIP, because the SAWS 2 PLUS flow is California-only.
 *
 * The report route makes the application available only when the session's
 * state resolves to CA *and* the report carries a CA_SAWS_2_PLUS
 * recommendation. Only the E2E_MODE fixture emits that recommendation, which is
 * why the SAWS 2 PLUS spec runs against its own server — see the `saws2`
 * project in playwright.config.ts.
 */
export const CALIFORNIA_TIER_1_ANSWERS: readonly string[] = [
  '90001',
  '42000',
  'Single parent with 2 kids ages 4 and 9',
];

/** Answer every unanswered Yes/No group on the current step with "No". */
export async function answerAllNo(page: Page): Promise<void> {
  const noButtons = page.getByRole('button', { name: 'No', exact: true });

  for (let index = 0, count = await noButtons.count(); index < count; index += 1) {
    const button = noButtons.nth(index);

    // aria-pressed is how the tri-state control reports its own answer.
    if ((await button.getAttribute('aria-pressed')) === 'true') continue;

    await button.click().catch(() => undefined);
  }
}

/** Fill any still-empty required field on the applicant or household step. */
export async function fillRequiredIdentityFields(page: Page): Promise<void> {
  const textFields: Array<[string, string]> = [
    ['First name', 'Maria'],
    ['Last name', 'Delgado'],
    ['Date of birth', '1990-01-01'],
    ['Street address', '12 Oak Street'],
    ['City', 'Los Angeles'],
    ['ZIP code', '90001'],
  ];

  for (const [label, value] of textFields) {
    const fields = page.getByLabel(label, { exact: true });

    for (let index = 0, count = await fields.count(); index < count; index += 1) {
      const field = fields.nth(index);
      const current = await field.inputValue().catch(() => 'skip');

      if (current !== '') continue;

      // Household members are people in their own right, not copies of the
      // applicant, so give each one its own name and a child's date of birth.
      const memberValue =
        index === 0
          ? value
          : label === 'First name'
            ? `Child${index}`
            : label === 'Date of birth'
              ? '2018-03-02'
              : value;

      await field.fill(memberValue).catch(() => undefined);
    }
  }

  /*
   * Not an exact match: the <select> sits inside its <label>, so its accessible
   * name is the label text with every option's text run onto the end —
   * "Relationship to applicantSelect relationshipSpouseChild…". Worth fixing in
   * the markup one day, since a screen reader announces the whole option list
   * as the field's name; a substring match is the honest way to address it
   * meanwhile.
   */
  const relationships = page.getByLabel('Relationship to applicant');

  for (let index = 0, count = await relationships.count(); index < count; index += 1) {
    const select = relationships.nth(index);

    if ((await select.inputValue().catch(() => 'skip')) !== '') continue;

    await select.selectOption('child').catch(() => undefined);
  }
}

/**
 * Walk the SAWS 2 PLUS steps from the report to the generated draft.
 *
 * Each step is answered the same way — fill what is required, answer every
 * gateway "No" — and then that step's own forward control is pressed.
 * Answering No throughout keeps the draft to the base form, which is what makes
 * the assertions about SSNs and signatures meaningful: no conditional section
 * is in play to explain a blank away.
 *
 * The order the controls are tried in matters. The questionnaire step renders
 * two "Continue"s: one that commits a single answer, and "Finish and review",
 * which moves on with whatever is answered so far. Taking the first match in
 * DOM order picks the per-question one and walks all seventy questions,
 * stalling on the first that is not a Yes/No. Reviewing with questions
 * outstanding is a supported path and the one this test wants, because it is
 * also what exercises the draft's remaining-action reporting.
 */
export async function completeSaws2Application(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Continue with|Review SAWS 2 PLUS/ }).click();
  await page.getByRole('button', { name: 'Continue with selected programs' }).click();

  for (let guard = 0; guard < 20; guard += 1) {
    await fillRequiredIdentityFields(page);
    await answerAllNo(page);

    /*
     * isVisible() before isEnabled(), and the order is load-bearing:
     * isEnabled() waits for the element to exist, so asking it about a control
     * that is not on this step blocks for the full expect timeout. Twenty steps
     * of that outruns any test timeout, which is exactly how this stalled on
     * step one. isVisible() answers immediately.
     */
    const generate = page.getByRole('button', { name: 'Generate application' });

    if (await generate.isVisible().catch(() => false)) {
      await generate.click();
      return;
    }

    /*
     * Most specific first; see the note above. The bare "Continue" comes last
     * and excludes the questionnaire's per-question button, which carries the
     * same label — the household step's forward control is also just
     * "Continue", so the label alone cannot tell them apart.
     */
    const candidates = [
      page.getByRole('button', { name: /^(Finish and review|Continue to review)$/ }),
      page.getByRole('button', { name: /^Continue to |^Continue with / }),
      page
        .getByRole('button', { name: 'Continue', exact: true })
        .and(page.locator(':not([data-testid="question-continue"])')),
    ];

    let advanced = false;

    for (const candidate of candidates) {
      const control = candidate.first();

      if (!(await control.isVisible().catch(() => false))) continue;
      if (!(await control.isEnabled().catch(() => false))) continue;

      await control.click();
      advanced = true;
      break;
    }

    if (!advanced) {
      const labels = await page.getByRole('button').allTextContents();

      throw new Error(
        `SAWS 2 PLUS flow stalled on step ${guard}. Buttons: ${labels
          .map((label) => label.trim())
          .filter(Boolean)
          .join(' | ')}`,
      );
    }
  }

  throw new Error('SAWS 2 PLUS flow did not reach the generate step');
}

/**
 * Answer the questionnaire until the planner has nothing left to ask.
 *
 * Gateways get "No", which keeps conditional sections shut so the interview
 * stays a manageable length, and free-text questions get a value. Skipping is
 * deliberately not used: a skipped question is blank, not answered, so it would
 * leave progress short of 100% — which is the very thing this drives to.
 *
 * Stops when the step reports every question answered.
 */
export async function answerEveryQuestion(page: Page): Promise<void> {
  const progress = page.getByTestId('questionnaire-progress-label');

  await progress.waitFor({ state: 'visible' });

  for (let guard = 0; guard < 250; guard += 1) {
    if ((await progress.textContent())?.includes('All questions answered')) {
      return;
    }

    const no = page.getByRole('button', { name: 'No', exact: true }).first();

    if (await no.isVisible().catch(() => false)) {
      await no.click();
      continue;
    }

    const input = page.getByTestId('question-input').first();

    if (await input.isVisible().catch(() => false)) {
      const type = await input.getAttribute('type');

      await input.fill(type === 'date' ? '2024-01-01' : type === 'number' ? '100' : 'Answered');
      await page.getByTestId('question-continue').click();
      continue;
    }

    // A records question: the applicant added nothing, which is a complete
    // answer once its gateway said No.
    const next = page.getByRole('button', { name: 'Next question' });

    if (await next.isVisible().catch(() => false)) {
      await next.click();
      continue;
    }

    throw new Error(
      `The questionnaire offered no way to answer: ${await progress.textContent()}`,
    );
  }

  throw new Error('The questionnaire did not reach "All questions answered"');
}
