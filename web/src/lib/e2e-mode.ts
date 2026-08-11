//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Demo / end-to-end mode flag.
 *
 * When `E2E_MODE=1` the expensive, non-deterministic KVR workflow boundary is
 * replaced by a deterministic fixture runner (see `e2e-workflow-runner.ts`).
 * Everything else — intake, validation, session state, SSE relay, report
 * assembly, the SAWS 2 PLUS application flow, and PDF draft generation — runs
 * the real production code path.
 *
 * Gating rules:
 * - Read **server-side only**. The value is never prefixed with `NEXT_PUBLIC_`,
 *   so Next.js never inlines it into a client bundle and no browser request can
 *   turn it on.
 * - The flag is the single switch: nothing else (cookies, query strings,
 *   headers, request bodies) may enable fixture behavior.
 * - Must not be set in a production deployment. `logE2EModeWarning()` emits a
 *   loud structured warning on server start so an accidentally-enabled
 *   environment is obvious in the logs.
 */
export function isE2EMode(): boolean {
  return process.env.E2E_MODE === '1';
}

/**
 * Milliseconds each simulated phase runs before completing.
 *
 * Kept deliberately non-zero so the real PhaseTracker progress UI is visible
 * during a demo. Override with `E2E_PHASE_DELAY_MS` (0 for instant).
 */
export function e2ePhaseDelayMs(): number {
  const raw = process.env.E2E_PHASE_DELAY_MS;
  if (raw === undefined) return 700;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 700;

  return Math.min(parsed, 10_000);
}

/** Log a startup warning when demo mode is active. Called from instrumentation. */
export function logE2EModeWarning(): void {
  if (!isE2EMode()) return;

  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'e2e_mode_enabled',
      message:
        'E2E_MODE=1 — the AI/KVR workflow is replaced by deterministic fixtures. Never enable this in production.',
      phaseDelayMs: e2ePhaseDelayMs(),
    }),
  );
}
