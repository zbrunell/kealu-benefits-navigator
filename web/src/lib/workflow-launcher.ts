//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Workflow launcher resolution — the single boundary where the expensive
 * AI/KVR workflow can be substituted.
 *
 * Callers ask for a launcher instead of calling `startRun()` directly. In normal
 * operation they get the real KVR subprocess runner. With `E2E_MODE=1` they get
 * the deterministic fixture runner, which produces the same phase files and the
 * same SSE event stream without any LLM calls.
 *
 * Keeping the decision here means no route or component needs an `E2E_MODE`
 * check of its own, and demo mode cannot leak into any other behavior.
 */

import { isE2EMode } from '@/lib/e2e-mode';
import { startRun } from '@/lib/kvr-runner';
import type { SessionVars } from '@/types/session';

/** Household vars as stored on the session. */
type LaunchVars = SessionVars;

export interface WorkflowLauncher {
  /** Identifies which implementation was selected; used for logging only. */
  readonly kind: 'kvr' | 'e2e-fixture';

  /**
   * True when the launcher needs the real `kvr` binary on PATH. Callers use this
   * to decide whether an unavailable binary is a fatal condition.
   */
  readonly requiresKvr: boolean;

  /** Start a workflow run for a session whose Tier 1 intake is complete. */
  launch(runId: string, sessionId: string, vars: LaunchVars): void;
}

const kvrLauncher: WorkflowLauncher = {
  kind: 'kvr',
  requiresKvr: true,
  launch(runId, sessionId, vars) {
    startRun(runId, sessionId, vars);
  },
};

/**
 * Resolve the workflow launcher for this process.
 *
 * The fixture module is imported dynamically so that it is never pulled into
 * the module graph when demo mode is off.
 */
export async function resolveWorkflowLauncher(): Promise<WorkflowLauncher> {
  if (!isE2EMode()) return kvrLauncher;

  const { startFixtureRun } = await import('@/lib/e2e-workflow-runner');

  return {
    kind: 'e2e-fixture',
    requiresKvr: false,
    launch(runId, sessionId, vars) {
      startFixtureRun(runId, sessionId, vars);
    },
  };
}
