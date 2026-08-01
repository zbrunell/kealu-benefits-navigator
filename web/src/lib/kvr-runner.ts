//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import type { ChildProcess } from 'child_process';
import type { HouseholdVars, PhaseEvent } from '@/types/session';
import { resolveKvr } from '@/lib/kvr-checker';

/** Idle timeout: 30 minutes with no subprocess output or phase event. */
export const IDLE_TIMEOUT_MS = 1_800_000;

/** Delay before SIGTERM when last SSE controller disconnects. */
export const SIGTERM_DELAY_MS = 60_000;

/** Generic error shown to users. Internal failure details stay server-side. */
export const GENERIC_WORKFLOW_ERROR =
  "We couldn't complete your benefits search. Please try again later.";

export type RunnerFailureCode =
  | 'UPSTREAM_RATE_LIMIT'
  | 'UPSTREAM_SPEND_LIMIT'
  | 'UPSTREAM_AUTH'
  | 'UPSTREAM_UNAVAILABLE'
  | 'PROCESS_EXIT_NONZERO'
  | 'PROCESS_SIGNAL'
  | 'IDLE_TIMEOUT'
  | 'UNKNOWN_RUNNER_FAILURE';

export type PublicWorkflowErrorCode =
  | 'BN-1001'
  | 'BN-1002'
  | 'BN-1003'
  | 'BN-1004'
  | 'BN-2001'
  | 'BN-2002'
  | 'BN-3001'
  | 'BN-9000';

export const PUBLIC_ERROR_CODES: Record<
  RunnerFailureCode,
  PublicWorkflowErrorCode
> = {
  UPSTREAM_RATE_LIMIT: 'BN-1001',
  UPSTREAM_SPEND_LIMIT: 'BN-1002',
  UPSTREAM_AUTH: 'BN-1003',
  UPSTREAM_UNAVAILABLE: 'BN-1004',
  PROCESS_EXIT_NONZERO: 'BN-2001',
  PROCESS_SIGNAL: 'BN-2002',
  IDLE_TIMEOUT: 'BN-3001',
  UNKNOWN_RUNNER_FAILURE: 'BN-9000',
};

/** Canonical phase names in workflow order. */
export const PHASE_NAMES: string[] = [
  'benefits-research',
  'insurance-research',
  'evidence-verification',
  'eligibility-validation',
  'action-plan',
];

/** ReadableStream controller type alias. */
type StreamController = ReadableStreamDefaultController<Uint8Array>;

interface ActiveRun {
  history: string[];
  proc: ChildProcess;
  runId: string;
  sessionId: string;
  startedAt: number;
  lastEventAt: number;
  controllers: Set<StreamController>;
  idleTimer: ReturnType<typeof setInterval>;
  orphanTimer?: ReturnType<typeof setTimeout>;
  /** Rolling subprocess tails used only for private failure classification. */
  stdoutTail: string;
  stderrTail: string;
}

interface RunnerRegistry {
  activeRuns: Map<string, ActiveRun>;
  sessionRunMap: Map<string, string>;
}

const globalForKvrRunner = globalThis as unknown as {
  __benefitsNavigatorKvrRunner?: RunnerRegistry;
};

const runnerRegistry =
  globalForKvrRunner.__benefitsNavigatorKvrRunner ?? {
    activeRuns: new Map<string, ActiveRun>(),
    sessionRunMap: new Map<string, string>(),
  };

globalForKvrRunner.__benefitsNavigatorKvrRunner = runnerRegistry;

export const activeRuns = runnerRegistry.activeRuns;
const sessionRunMap = runnerRegistry.sessionRunMap;

export function formatSseEvent(event: PhaseEvent, id: string): string {
  return `id: ${id}\nevent: phase\ndata: ${JSON.stringify(event)}\n\n`;
}

function classifyRunnerFailure(
  output: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): RunnerFailureCode {
  const normalized = output.toLowerCase();

  if (
    normalized.includes('monthly spend limit') ||
    normalized.includes("org's monthly spend limit") ||
    normalized.includes('organization spend limit') ||
    normalized.includes('insufficient_quota') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('credit balance') ||
    normalized.includes('billing limit') ||
    normalized.includes('resource exhausted')
  ) {
    return 'UPSTREAM_SPEND_LIMIT';
  }

  if (
    normalized.includes('rate_limit') ||
    normalized.includes('rate limit') ||
    normalized.includes('api_error_status":429') ||
    normalized.includes('status 429')
  ) {
    return 'UPSTREAM_RATE_LIMIT';
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('invalid api key') ||
    normalized.includes('authentication_error') ||
    normalized.includes('status 401') ||
    normalized.includes('status 403')
  ) {
    return 'UPSTREAM_AUTH';
  }

  if (
    normalized.includes('service unavailable') ||
    normalized.includes('overloaded') ||
    normalized.includes('status 502') ||
    normalized.includes('status 503') ||
    normalized.includes('status 504')
  ) {
    return 'UPSTREAM_UNAVAILABLE';
  }

  if (signal) return 'PROCESS_SIGNAL';
  if (exitCode !== null && exitCode !== 0) return 'PROCESS_EXIT_NONZERO';
  return 'UNKNOWN_RUNNER_FAILURE';
}

function outputIndicatesFailure(output: string): boolean {
  const normalized = output.toLowerCase();

  // Only treat explicit, structured, unrecovered error markers as fatal.
  // Generic mentions such as "rate limit" or "retrying" may describe a
  // transient condition that KVR successfully recovered from.
  return (
    normalized.includes('"is_error":true') ||
    normalized.includes('"is_error": true') ||
    normalized.includes('"fatal":true') ||
    normalized.includes('"fatal": true') ||
    normalized.includes('"status":"failed"') ||
    normalized.includes('"status": "failed"') ||
    normalized.includes('"event_type":"error"') ||
    normalized.includes('"event_type": "error"')
  );
}

function sanitizeFailureOutput(output: string): string {
  return output
    .replace(
      /(api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s",]+/gi,
      '$1=[REDACTED]',
    )
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .slice(-4_000);
}

function _processLine(
  runId: string,
  line: string,
  broadcast: (payload: string) => void,
): void {
  if (!line || !line.startsWith('[PHASE_STREAM] ')) return;

  const jsonStr = line.slice('[PHASE_STREAM] '.length);

  try {
    const event: PhaseEvent = JSON.parse(jsonStr);
    const id = `${runId}-${Date.now()}`;
    broadcast(formatSseEvent(event, id));
  } catch {
    // Malformed JSON — silently drop to avoid disconnecting clients.
  }
}

function _checkIdle(
  runId: string,
  lastEventAt: number,
  terminate: (runId: string) => void,
  broadcast: (payload: string) => void,
): void {
  const elapsed = Date.now() - lastEventAt;

  if (elapsed >= IDLE_TIMEOUT_MS) {
    const failureCode: RunnerFailureCode = 'IDLE_TIMEOUT';
    const publicCode = PUBLIC_ERROR_CODES[failureCode];

    const errorEvent = {
      event_type: 'error',
      message: GENERIC_WORKFLOW_ERROR,
      error_code: publicCode,
    } as PhaseEvent;

    broadcast(formatSseEvent(errorEvent, `${runId}-idle`));

    console.error(
      JSON.stringify({
        level: 'error',
        event: 'workflow_runner_failed',
        runId,
        failureCode,
        publicCode,
        reason: 'idle_timeout',
        elapsedMs: elapsed,
      }),
    );

    terminate(runId);
  }
}

function broadcastToRun(runId: string, payload: string): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  run.history.push(payload);

  const encoder = new TextEncoder();

  for (const ctrl of run.controllers) {
    try {
      ctrl.enqueue(encoder.encode(payload));
    } catch {
      // Controller closed — ignore.
    }
  }

  run.lastEventAt = Date.now();
}

function cleanupRun(runId: string, closeControllers: boolean): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  clearInterval(run.idleTimer);

  if (run.orphanTimer !== undefined) {
    clearTimeout(run.orphanTimer);
  }

  if (closeControllers) {
    for (const ctrl of run.controllers) {
      try {
        ctrl.close();
      } catch {
        // Controller already closed — ignore.
      }
    }
  }

  run.controllers.clear();
  sessionRunMap.delete(run.sessionId);
  activeRuns.delete(runId);
}

export function startRun(
  runId: string,
  sessionId: string,
  vars: Partial<HouseholdVars> & { annual_income?: string },
): void {
  if (sessionRunMap.has(sessionId)) return;

  const kvrPath = resolveKvr();
  if (!kvrPath) throw new Error('kvr binary not found on PATH');

  const varArgs: string[] = [];

  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      varArgs.push('--var', `${key}=${String(value)}`);
    }
  }

  const args = [
    'run',
    'benefits-navigator',
    '--mode',
    'automated',
    '--no-progress',
    '--run-id',
    runId,
    '--phase-stream',
    'stdout',
    ...varArgs,
  ];

  const cwd = path.join(process.cwd(), '..');

  const proc = spawn(kvrPath, args, {
    cwd,
    shell: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'kvr_spawned',
      runId,
      pid: proc.pid,
    }),
  );

  const idleTimer = setInterval(() => {
    const activeRun = activeRuns.get(runId);

    if (activeRun) {
      _checkIdle(runId, activeRun.lastEventAt, terminateRun, (payload) =>
        broadcastToRun(runId, payload),
      );
    }
  }, 30_000);

  const run: ActiveRun = {
    proc,
    runId,
    sessionId,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    controllers: new Set(),
    history: [],
    idleTimer,
    stdoutTail: '',
    stderrTail: '',
  };

  activeRuns.set(runId, run);
  sessionRunMap.set(sessionId, runId);

  broadcastToRun(
    runId,
    formatSseEvent({ event_type: 'workflow_start' }, `${runId}-start`),
  );

  let buffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    const activeRun = activeRuns.get(runId);
    if (!activeRun) return;

    const decoded = chunk.toString();

    activeRun.lastEventAt = Date.now();
    activeRun.stdoutTail = `${activeRun.stdoutTail}${decoded}`.slice(
      -32_768,
    );

    buffer += decoded;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      _processLine(runId, line, (payload) =>
        broadcastToRun(runId, payload),
      );
    }
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const activeRun = activeRuns.get(runId);
    if (!activeRun) return;

    const decoded = chunk.toString();

    activeRun.lastEventAt = Date.now();
    activeRun.stderrTail = `${activeRun.stderrTail}${decoded}`.slice(
      -32_768,
    );

    console.log(
      JSON.stringify({
        level: 'debug',
        event: 'kvr_stderr_activity',
        runId,
        bytes: chunk.length,
      }),
    );
  });

  proc.on('close', (code, signal) => {
    const activeRun = activeRuns.get(runId);
    if (!activeRun) return;

    if (buffer.trim()) {
      _processLine(runId, buffer, (payload) =>
        broadcastToRun(runId, payload),
      );
      buffer = '';
    }

    const combinedOutput =
      `${activeRun.stdoutTail}\n${activeRun.stderrTail}`;

    // A zero exit code means KVR completed successfully, even if its logs contain
    // earlier transient warnings such as rate-limit retries. Structured fatal
    // markers are only consulted when the process did not exit cleanly.
    const failed =
      code !== 0 ||
      signal !== null ||
      (code === null && outputIndicatesFailure(combinedOutput));

    if (failed) {
      const failureCode = classifyRunnerFailure(
        combinedOutput,
        code,
        signal,
      );
      const publicCode = PUBLIC_ERROR_CODES[failureCode];

      console.error(
        JSON.stringify({
          level: 'error',
          event: 'workflow_runner_failed',
          runId,
          failureCode,
          publicCode,
          exitCode: code,
          signal,
          diagnosticTail: sanitizeFailureOutput(combinedOutput),
        }),
      );

      broadcastToRun(
        runId,
        formatSseEvent(
          {
            event_type: 'error',
            message: GENERIC_WORKFLOW_ERROR,
            error_code: publicCode,
          } as PhaseEvent,
          randomUUID(),
        ),
      );

      cleanupRun(runId, true);
      return;
    }

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'kvr_closed',
        runId,
        code,
        signal,
      }),
    );

    setTimeout(() => terminateRun(runId), 2_000);
  });
}

export function terminateRun(runId: string): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  clearInterval(run.idleTimer);

  if (run.orphanTimer !== undefined) {
    clearTimeout(run.orphanTimer);
  }

  try {
    run.proc.kill('SIGTERM');
  } catch {
    // Ignore if already dead.
  }

  sessionRunMap.delete(run.sessionId);
  activeRuns.delete(runId);
}

export function addController(
  runId: string,
  ctrl: StreamController,
): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  if (run.orphanTimer !== undefined) {
    clearTimeout(run.orphanTimer);
    run.orphanTimer = undefined;
  }

  run.controllers.add(ctrl);

  const encoder = new TextEncoder();

  for (const payload of run.history) {
    try {
      ctrl.enqueue(encoder.encode(payload));
    } catch {
      // Controller closed — ignore.
    }
  }
}

export function removeController(
  runId: string,
  ctrl: StreamController,
): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  run.controllers.delete(ctrl);

  if (run.controllers.size === 0) {
    run.orphanTimer = setTimeout(
      () => terminateRun(runId),
      SIGTERM_DELAY_MS,
    );
  }
}

export function getRunIdForSession(
  sessionId: string,
): string | undefined {
  const cached = sessionRunMap.get(sessionId);
  if (cached) return cached;

  for (const [runId, run] of activeRuns) {
    if (run.sessionId === sessionId) return runId;
  }

  return undefined;
}

export const __internal = {
  _processLine,
  _checkIdle,
  classifyRunnerFailure,
  outputIndicatesFailure,
  sanitizeFailureOutput,
  PUBLIC_ERROR_CODES,
};
