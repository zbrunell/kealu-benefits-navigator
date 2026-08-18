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
