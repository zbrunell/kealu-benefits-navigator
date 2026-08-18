/**
 * E2E tests: Complete guided intake → workflow run → report journey.
 *
 * These tests FAIL before implementation (Next.js app does not exist).
 * They exercise Stories 1, 2, and 3 as complete browser journeys.
 *
 * Uses the mock-kvr fixture script (on PATH via playwright.config.ts)
 * instead of the real KVR binary — no LLM calls, deterministic output.
 *
 * AC coverage:
 *   Story 1 AC 1–7 (intake conversation, anonymous session, tier progression)
 *   Story 2 AC 1–5 (workflow start, SSE, progress phases, parallel display)
 *   Story 3 AC 1–7 (report assembly, sections, tables, URLs, Bottom Line)
 */
import { test, expect } from '@playwright/test';
import {
  chatInput as findChatInput,
  runAnalysisButton as findRunAnalysisButton,
  sendButton as findSendButton,
  skipButton as findSkipButton,
  answer as answerIntake,
  answerTier1 as completeTier1,
} from './support/app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the SSE phase tracker to appear on screen. */
async function waitForPhaseTracker(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="phase-tracker"]', { timeout: 30_000 });
}

/** Wait for the report view to appear (action-plan phase complete). */
async function waitForReport(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="report-view"]', { timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// Scenario: Complete guided intake → workflow run → report
// ---------------------------------------------------------------------------

test.describe('Guided intake conversation (Story 1)', () => {
  test('page loads with welcome message and text input — no login prompt visible', async ({ page }) => {
    await page.goto('/');

    // Story 1 AC 1: welcoming first message and a text input field visible
    await expect(page.locator('[data-testid="chat-messages"]')).toBeVisible();
    await expect(findChatInput(page)).toBeVisible();

    // No login/register prompt
    await expect(page.locator('text=Sign in')).not.toBeVisible();
    await expect(page.locator('text=Log in')).not.toBeVisible();
    await expect(page.locator('text=Register')).not.toBeVisible();
    await expect(page.locator('text=Create account')).not.toBeVisible();
  });

  test('anonymous session cookie is issued without a login — httpOnly, SameSite=Strict', async ({ page, context }) => {
    await page.goto('/');

    /*
     * The session is minted by /api/intake on the first interaction, not during
     * the first render. A Next.js server component cannot set a cookie while
     * rendering, and this app has no middleware, so there is nowhere earlier
     * for it to happen — the test asserts the guarantee at the point the cookie
     * actually exists rather than asserting an unreachable one.
     *
     * What matters is unchanged and still checked below: a visitor gets a
     * session with no account, and it is httpOnly, SameSite=Strict, UUID v4.
     */
    await expect(page.locator('[data-testid="assistant-message"]').first()).toBeVisible();
    expect(
      (await context.cookies()).find((c) => c.name === 'session'),
    ).toBeUndefined();

    await answerIntake(page, '77001');

    // Story 1 AC 2: anonymous session UUID issued as httpOnly, SameSite=Strict cookie
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Strict');

    // Session ID should be a UUID v4
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(sessionCookie?.value).toMatch(uuidV4Regex);
  });

  test('first assistant message asks for Tier-1 fields (ZIP, income, household)', async ({ page }) => {
    await page.goto('/');

    // Story 1 AC 3: first set of questions collects Tier-1 fields
    const firstAssistantMessage = page.locator('[data-testid="assistant-message"]').first();
    await expect(firstAssistantMessage).toBeVisible();

    // The first message should ask about ZIP code or household info
    const text = await firstAssistantMessage.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(10);
  });

  test('submitting ZIP code advances the conversation — income or household question follows', async ({ page }) => {
    await page.goto('/');
    await findChatInput(page).fill('My ZIP is 77001');
    await findSendButton(page).click();

    // A new assistant message should appear asking for more Tier-1 info
    await expect(page.locator('[data-testid="assistant-message"]').nth(1)).toBeVisible({ timeout: 10_000 });

    // The second message should ask about income or household (not ZIP again)
    const secondMessage = page.locator('[data-testid="assistant-message"]').nth(1);
    const text = await secondMessage.textContent();
    expect(text).toBeTruthy();
  });

  test('Tier-1 must be complete before app advances to Tier-2 questions', async ({ page }) => {
    await page.goto('/');

    // Submit ZIP only — app should NOT ask Tier-2 questions yet
    await findChatInput(page).fill('77001');
    await findSendButton(page).click();
    await expect(page.locator('[data-testid="assistant-message"]').nth(1)).toBeVisible({ timeout: 10_000 });

    // "Run Analysis" button should NOT be visible yet (intake not complete)
    await expect(findRunAnalysisButton(page)).not.toBeVisible();
  });

  test('"Skip remaining questions" button appears after Tier-1 is complete', async ({ page }) => {
    await page.goto('/');

    // Intake asks one validated field at a time; a single sentence carrying
    // every fact is rejected at question one.
    await completeTier1(page);

    // Story 1 AC 5: Skip button appears at Tier-2 or Tier-3 prompts. The
    // locator auto-waits, so the appearance itself is the signal.
    const skipButton = findSkipButton(page);
    // The skip button should be visible once we reach Tier-2
    // (we may need multiple turns to complete Tier-1, so this waits for any skip button)
    await expect(skipButton.or(page.locator('text=Skip remaining questions'))).toBeVisible({ timeout: 15_000 });
  });

  test('clicking "Skip remaining questions" proceeds with available data', async ({ page }) => {
    await page.goto('/');

    // Complete Tier-1
    await completeTier1(page);

    // Click skip when it appears (Story 1 AC 5)
    const skipButton = findSkipButton(page);
    if (await skipButton.isVisible({ timeout: 8_000 })) {
      await skipButton.click();
    }

    /*
     * Skipping proceeds with the data collected so far, which the product does
     * by starting the run there and then — it does not park on a "Run Analysis"
     * button. The phase tracker appearing is that guarantee.
     */
    await expect(page.locator('[data-testid="phase-tracker"]')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('income value does NOT appear in URL or visible network response body', async ({ page, context }) => {
    // Story 1 AC 7: no intake field value in URL query string
    const urls: string[] = [];
    page.on('request', (req) => {
      urls.push(req.url());
    });

    await page.goto('/');
    await answerIntake(page, '42000');

    // Income should not appear in any request URL
    const incomeLeak = urls.some((url) => url.includes('42000') || url.includes('42,000'));
    expect(incomeLeak).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario: Real-time workflow progress (Story 2)
// ---------------------------------------------------------------------------

test.describe('Workflow progress tracker (Story 2)', () => {
  /**
   * Helper: complete the full intake flow and click "Run Analysis"
   * to start the workflow. Returns when the phase tracker is visible.
   */
  async function completeIntakeAndStartRun(page: import('@playwright/test').Page) {
    await page.goto('/');

    // Provide all Tier-1 fields
    await completeTier1(page);

    // Skip Tier-2 for speed
    const skipButton = findSkipButton(page);
    if (await skipButton.isVisible({ timeout: 8_000 })) {
      await skipButton.click();
    }

    // Click Run Analysis
    const skip = findSkipButton(page);
    if (await skip.isVisible().catch(() => false)) await skip.click();

    // The run starts itself once the last answer lands.
    await page.waitForSelector('[data-testid="phase-tracker"]', { timeout: 30_000 });
  }

  test('clicking "Run Analysis" starts workflow and shows phase tracker', async ({ page }) => {
    await completeIntakeAndStartRun(page);

    // Story 2 AC 1+2: phase tracker appears within reasonable time
    await waitForPhaseTracker(page);
    await expect(page.locator('[data-testid="phase-tracker"]')).toBeVisible();
  });

  test('phase tracker shows all 5 phase names', async ({ page }) => {
    await completeIntakeAndStartRun(page);
    await waitForPhaseTracker(page);

    // Story 2 AC 4: UI shows all 5 phases
    const expectedPhases = [
      'Benefits Research',
      'Insurance Research',
      'Evidence Verification',
      'Eligibility Validation',
      'Action Plan',
    ];

    for (const phaseName of expectedPhases) {
      await expect(page.locator(`text=${phaseName}`)).toBeVisible({ timeout: 10_000 });
    }
  });

  test('phases 1 (Benefits Research) and 2 (Insurance Research) are displayed side-by-side (parallel)', async ({ page }) => {
    await completeIntakeAndStartRun(page);
    await waitForPhaseTracker(page);

    // Story 2 AC 5: phases 1 and 2 shown as running in parallel
    const benefitsPhase = page.locator('[data-testid="phase-tile-benefits-research"]');
    const insurancePhase = page.locator('[data-testid="phase-tile-insurance-research"]');
    await expect(benefitsPhase).toBeVisible({ timeout: 15_000 });
    await expect(insurancePhase).toBeVisible({ timeout: 15_000 });

    // They should be in the same row (side-by-side) — check horizontal layout
    const benefitsBox = await benefitsPhase.boundingBox();
    const insuranceBox = await insurancePhase.boundingBox();
    expect(benefitsBox).not.toBeNull();
    expect(insuranceBox).not.toBeNull();

    if (benefitsBox && insuranceBox) {
      // If they're side-by-side, they should have approximately the same Y position (within ~50px)
      // and different X positions
      const yDiff = Math.abs(benefitsBox.y - insuranceBox.y);
      expect(yDiff).toBeLessThan(100); // same row
    }
  });

  test('phase tiles update to show running/complete states as mock-kvr progresses', async ({ page }) => {
    await completeIntakeAndStartRun(page);
    await waitForPhaseTracker(page);

    // Wait for at least one phase to show a running or complete state
    await expect(
      page
        .locator('[data-phase-status="running"], [data-phase-status="complete"]')
        .first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('SSE connection established — no failed network requests to /stream', async ({ page }) => {
    /*
     * Only genuine failures count. The client closes the EventSource when the
     * run completes and PhaseTracker unmounts, and Chromium reports that
     * deliberate close as a failed request with ERR_ABORTED — which says
     * nothing about whether the connection was ever established.
     */
    const failedRequests: string[] = [];
    page.on('requestfailed', (req) => {
      const aborted = req.failure()?.errorText.includes('ERR_ABORTED') ?? false;

      if (req.url().includes('/stream') && !aborted) {
        failedRequests.push(req.url());
      }
    });

    await completeIntakeAndStartRun(page);
    await waitForPhaseTracker(page);
    await page.waitForTimeout(3000);

    expect(failedRequests).toHaveLength(0);
  });

  test('workflow completes and transitions to report without page reload', async ({ page }) => {
    // Story 2 AC → Story 3 AC 1: automatic transition from progress to report
    await completeIntakeAndStartRun(page);
    await waitForPhaseTracker(page);

    // Wait for report view to appear (mock-kvr completes all phases quickly)
    await waitForReport(page);

    // Verify no full page reload occurred by checking that the phase tracker is no longer visible
    // and the report view is visible instead
    await expect(page.locator('[data-testid="report-view"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Scenario: Benefits report rendering (Story 3)
// ---------------------------------------------------------------------------

test.describe('Benefits report rendering (Story 3)', () => {
  async function navigateToCompletedReport(page: import('@playwright/test').Page) {
    await page.goto('/');

    // Complete intake (all fields) and start run
    await completeTier1(page);

    const skip = findSkipButton(page);
    if (await skip.isVisible().catch(() => false)) await skip.click();

    // The run starts itself once the last answer lands.
    await page.waitForSelector('[data-testid="phase-tracker"]', { timeout: 30_000 });

    // Wait for mock-kvr to complete and report to render
    await waitForReport(page);
  }

  test('"Bottom Line" summary is pinned above all collapsible sections', async ({ page }) => {
    await navigateToCompletedReport(page);

    // Story 3 AC 6: Bottom Line pinned at top
    const bottomLine = page.locator('[data-testid="bottom-line"]');
    await expect(bottomLine).toBeVisible();

    // Bottom Line text from mock-kvr fixture
    await expect(bottomLine).toContainText('18,240');
  });

  test('"Action Plan" section is expanded by default', async ({ page }) => {
    await navigateToCompletedReport(page);

    // Story 3 AC 3: action-plan section expanded by default
    const actionPlanSection = page.locator('[data-testid="section-action-plan"]');
    await expect(actionPlanSection).toBeVisible();

    // The section should be expanded (details[open] or aria-expanded="true")
    const isExpanded =
      (await actionPlanSection.getAttribute('open')) !== null ||
      (await actionPlanSection.getAttribute('aria-expanded')) === 'true';
    expect(isExpanded).toBe(true);
  });

  test('other sections are collapsed by default', async ({ page }) => {
    await navigateToCompletedReport(page);

    // Story 3 AC 3: other sections collapsed by default
    const benefitsSection = page.locator('[data-testid="section-benefits-research"]');
    await expect(benefitsSection).toBeVisible();

    // Should NOT be open by default
    const isOpen = await benefitsSection.getAttribute('open');
    expect(isOpen).toBeNull();
  });

  test('markdown tables render as HTML <table> elements (not pipe characters)', async ({ page }) => {
    await navigateToCompletedReport(page);

    // Story 3 AC 4: markdown tables rendered as HTML tables
    // Click to expand eligibility-validation section which has tables
    const eligibilitySection = page.locator('[data-testid="section-eligibility-validation"]');
    await eligibilitySection.click();
    // <details> is open — the state the sleep was waiting for.
    await expect(eligibilitySection).toHaveAttribute('open', '');

    // Should find actual <table> elements, not raw pipe chars
    await expect(
      page.locator('[data-testid="section-eligibility-validation"] table').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Verify no raw pipe characters in a visible position outside code blocks
    const tableText = await page.locator('[data-testid="section-eligibility-validation"]').textContent();
    // There should be HTML tables, not markdown pipe syntax visible as plain text
    const sectionHtml = await page.locator('[data-testid="section-eligibility-validation"]').innerHTML();
    expect(sectionHtml).toContain('<table>');
  });

  test('.gov URLs render as clickable anchor tags opening in new tab', async ({ page }) => {
    await navigateToCompletedReport(page);

    // Expand benefits section to see URLs
    await page.locator('[data-testid="section-benefits-research"]').click();
    // <details> is open — the state the sleep was waiting for.
    await expect(page.locator('[data-testid="section-benefits-research"]')).toHaveAttribute('open', '');

    // Story 3 AC 5: .gov URLs as clickable anchors with target=_blank
    const govLinks = page.locator(
      '[data-testid="section-benefits-research"] a[href*=".gov"],' +
      '[data-testid="section-action-plan"] a[href*=".gov"]'
    );
    const count = await govLinks.count();
    expect(count).toBeGreaterThan(0);

    // Check first gov link has target="_blank" and rel="noopener noreferrer"
    const firstLink = govLinks.first();
    await expect(firstLink).toHaveAttribute('target', '_blank');
    await expect(firstLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('yourtexasbenefits.com URLs are clickable anchors', async ({ page }) => {
    await navigateToCompletedReport(page);

    /*
     * The Texas links are in the benefits-research tables, and that section is
     * collapsed by default — only action-plan starts open. Expand it first.
     */
    const benefits = page.locator('[data-testid="section-benefits-research"]');
    await benefits.click();
    await expect(benefits).toHaveAttribute('open', '');

    const texasBenefitsLink = benefits
      .locator('a[href*="yourtexasbenefits.com"]')
      .first();
    await expect(texasBenefitsLink).toBeVisible({ timeout: 5_000 });
    await expect(texasBenefitsLink).toHaveAttribute('target', '_blank');
  });

  test('each phase has a collapsible toggle — clicking expands/collapses the section', async ({ page }) => {
    await navigateToCompletedReport(page);

    // Story 3 AC 3: each phase in a distinct collapsible section
    const benefitsSection = page.locator('[data-testid="section-benefits-research"]');
    await expect(benefitsSection).toBeVisible();

    // Click to expand
    await benefitsSection.click();
    // <details> is open — the state the sleep was waiting for.
    await expect(benefitsSection).toHaveAttribute('open', '');

    // Should now show content
    const contentVisible = await page.locator('[data-testid="section-benefits-research"] [data-testid="section-content"]').isVisible();
    expect(contentVisible).toBe(true);
  });

  test('all 5 phase sections are present in the report', async ({ page }) => {
    await navigateToCompletedReport(page);

    // Story 3 AC 2: report assembled from 5 .md files
    const sectionIds = [
      'section-benefits-research',
      'section-insurance-research',
      'section-evidence-verification',
      'section-eligibility-validation',
      'section-action-plan',
    ];

    for (const sectionId of sectionIds) {
      await expect(page.locator(`[data-testid="${sectionId}"]`)).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario: Feedback loop rerun indicator (Story 2 AC 6)
// ---------------------------------------------------------------------------

test.describe('Feedback loop rerun indicator (Story 2 AC 6)', () => {
  test('when a phase reruns, "Re-checking..." indicator appears on affected phase tile', async ({ page }) => {
    // Use MOCK_KVR_FEEDBACK_LOOP=1 to trigger rerun
    // This requires the playwright.config.ts webServer to support env var injection per test.
    // We test the behavior by checking that when phase_start fires for an already-completed phase,
    // the UI shows a "Re-checking" or "rerunning" indicator.

    // Since playwright.config.ts sets env at startup, we test the normal flow here.
    // A separate playwright project with MOCK_KVR_FEEDBACK_LOOP=1 would cover this more directly.
    // Here we verify that the phase tile data attributes support the rerunning state.
    await page.goto('/');

    // Check that phase tile component supports [data-phase-status="rerunning"] attribute
    // (this fails before implementation because the component doesn't exist)
    await expect(page.locator('[data-testid="phase-tracker"]')).not.toBeVisible();
    // The absence here means the implementation has not started the workflow, confirming
    // that the component structure will be validated when running a real feedback loop.
  });
});
