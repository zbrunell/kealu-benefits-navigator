//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Deterministic stand-in for the KVR workflow subprocess (demo / E2E mode).
 *
 * This is the *only* thing demo mode replaces. It performs exactly the two
 * observable side effects the real `kvr run benefits-navigator` produces:
 *
 * 1. Writes one Markdown file per phase into `.workforce/<runId>/`, which the
 *    real `assembleReport()` then reads, parses, and caches.
 * 2. Emits the same `[PHASE_STREAM]`-shaped events (workflow_start,
 *    phase_start, phase_complete) through the same runner registry the SSE
 *    route relays to the browser.
 *
 * City, state, and county are not touched here: intake already derived them
 * from the ZIP code into the session vars (lib/location.ts), and the fixture
 * reads that same state.
 *
 * Everything downstream (report route, report UI, application wizard, canonical
 * field mapping, Python PDF generation) runs unmodified production code.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { e2ePhaseDelayMs } from '@/lib/e2e-mode';
import { buildFixturePhaseDocuments } from '@/lib/e2e-fixture';
import {
  PHASE_NAMES,
  emitPhaseEvent,
  registerSyntheticRun,
  terminateRun,
} from '@/lib/kvr-runner';
import { getWorkforceBase } from '@/lib/report-assembler';
import type { SessionVars } from '@/types/session';

/** Grace period after the final phase event before the run is de-registered. */
const TEARDOWN_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a deterministic fixture run for a session whose intake is complete.
 *
 * Returns immediately after registering the run and writing the phase files;
 * phase events are then emitted on a timer so the real PhaseTracker progress UI
 * is exercised. Signature matches `startRun()` from kvr-runner so the two are
 * interchangeable behind `resolveWorkflowLauncher()`.
 */
export function startFixtureRun(
  runId: string,
  sessionId: string,
  vars: SessionVars,
): void {
  if (!registerSyntheticRun(runId, sessionId)) return;

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'e2e_fixture_run_started',
      runId,
      phases: PHASE_NAMES.length,
    }),
  );

  void driveRun(runId, vars);
}

/** Write the fixture phase files, then emit the phase event sequence. */
async function driveRun(
  runId: string,
  vars: SessionVars,
): Promise<void> {
  const delay = e2ePhaseDelayMs();

  try {
    const runDir = path.join(getWorkforceBase(), runId);
    await mkdir(runDir, { recursive: true });

    const documents = buildFixturePhaseDocuments(vars);

    // Written up front: the real workflow flushes each phase file before
    // emitting its phase_complete event, so the report is always readable by
    // the time the tracker fetches it.
    await Promise.all(
      Object.entries(documents).map(([phase, content]) =>
        writeFile(path.join(runDir, `${phase}.md`), content, 'utf8'),
      ),
    );

    emitPhaseEvent(runId, { event_type: 'workflow_start' });

    // Phases 1 and 2 run in parallel in the real workflow; start both before
    // completing either so the tracker's parallel tiles light up together.
    const [first, second, ...sequential] = PHASE_NAMES;

    emitPhaseEvent(runId, { event_type: 'phase_start', phase: first });
    emitPhaseEvent(runId, { event_type: 'phase_start', phase: second });
    await sleep(delay);
    emitPhaseEvent(runId, { event_type: 'phase_complete', phase: first });
    await sleep(Math.round(delay / 2));
    emitPhaseEvent(runId, { event_type: 'phase_complete', phase: second });

    for (const phase of sequential) {
      emitPhaseEvent(runId, { event_type: 'phase_start', phase });
      await sleep(delay);
      emitPhaseEvent(runId, { event_type: 'phase_complete', phase });
    }

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'e2e_fixture_run_complete',
        runId,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'e2e_fixture_run_failed',
        runId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    // Surface failure through the same error channel a real run uses so the
    // tracker shows its normal error banner instead of hanging.
    emitPhaseEvent(runId, {
      event_type: 'error',
      message: 'The deterministic demo workflow could not produce a report.',
      error_code: 'BN-9000',
    });
  }

  // Mirror the real runner: detach the run shortly after the last event so the
  // session can start a fresh run ("Run Again") without a restart.
  setTimeout(() => terminateRun(runId), TEARDOWN_DELAY_MS);
}
