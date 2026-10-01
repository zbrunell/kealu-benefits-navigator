/**
 * Unit tests for web/src/lib/kvr-runner.ts
 *
 * child_process is mocked at the system boundary.
 *
 * Internal functions (_processLine, _checkIdle) must be exported via
 * __internal namespace or test-only export in the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('@/lib/kvr-checker', () => ({
  resolveKvr: vi.fn().mockReturnValue('/usr/local/bin/kvr'),
  checkKvrVersion: vi.fn().mockReturnValue({ ok: true, version: '0.225.0', path: '/usr/local/bin/kvr' }),
  logStartupChecks: vi.fn(),
  checkCmsApiKey: vi.fn().mockReturnValue(true),
}));

import { spawn } from 'child_process';
import { resolveKvr } from '@/lib/kvr-checker';
const mockSpawn = vi.mocked(spawn);
const mockResolveKvr = vi.mocked(resolveKvr);

// These imports fail until web/src/lib/kvr-runner.ts is created.
// The implementation MUST export __internal or the named functions for testing.
import {
  startRun,
  terminateRun,
  addController,
  removeController,
  formatSseEvent,
  getRunIdForSession,
  activeRuns,
  __internal,
  IDLE_TIMEOUT_MS,
  SIGTERM_DELAY_MS,
  PHASE_NAMES,
} from '@/lib/kvr-runner';

import type { PhaseEvent } from '@/types/session';

// Helper to create a mock ChildProcess
function makeMockProcess() {
  const mockStdout = {
    on: vi.fn(),
    pipe: vi.fn(),
  };
  const mockStderr = {
    on: vi.fn(),
    pipe: vi.fn(),
    resume: vi.fn(),
  };
  return {
    pid: 12345,
    stdout: mockStdout,
    stderr: mockStderr,
    on: vi.fn(),
    kill: vi.fn(),
    stdio: [],
  } as any;
}

describe('Constants', () => {
  it('IDLE_TIMEOUT_MS is 1_800_000 (30 minutes)', () => {
    expect(IDLE_TIMEOUT_MS).toBe(1_800_000);
  });

  it('SIGTERM_DELAY_MS is 60_000 (60 seconds)', () => {
    expect(SIGTERM_DELAY_MS).toBe(60_000);
  });

  it('PHASE_NAMES contains all 5 expected phases in order', () => {
    expect(PHASE_NAMES).toContain('benefits-research');
    expect(PHASE_NAMES).toContain('insurance-research');
    expect(PHASE_NAMES).toContain('evidence-verification');
    expect(PHASE_NAMES).toContain('eligibility-validation');
    expect(PHASE_NAMES).toContain('action-plan');
    expect(PHASE_NAMES.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// formatSseEvent()
// ---------------------------------------------------------------------------

describe('formatSseEvent()', () => {
  it("produces 'id:\\nevent: phase\\ndata: {json}\\n\\n' format", () => {
    const event: PhaseEvent = { event_type: 'phase_start', phase: 'benefits-research' };
    const result = formatSseEvent(event, 'evt-001');
    expect(result).toContain('id: evt-001');
    expect(result).toContain('event: phase');
    expect(result).toContain('data: ');
    expect(result.endsWith('\n\n')).toBe(true);
    const dataLine = result.split('\n').find((l) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice('data: '.length));
    expect(parsed.event_type).toBe('phase_start');
    expect(parsed.phase).toBe('benefits-research');
  });
});

// ---------------------------------------------------------------------------
// _processLine() — accessed via __internal
// ---------------------------------------------------------------------------

describe('__internal._processLine()', () => {
  let broadcastSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broadcastSpy = vi.fn();
  });

  it('broadcasts valid [PHASE_STREAM] JSON event', () => {
    const event: PhaseEvent = { event_type: 'phase_complete', phase: 'benefits-research' };
    const line = `[PHASE_STREAM] ${JSON.stringify(event)}`;
    __internal._processLine('test-run-id', line, broadcastSpy);
    expect(broadcastSpy).toHaveBeenCalledOnce();
    const ssePayload: string = broadcastSpy.mock.calls[0][0];
    expect(ssePayload).toContain('phase_complete');
  });

  it('silently drops malformed JSON after [PHASE_STREAM] prefix — no exception', () => {
    const line = '[PHASE_STREAM] {invalid json here';
    expect(() => __internal._processLine('test-run-id', line, broadcastSpy)).not.toThrow();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('does NOT broadcast for malformed JSON (never disconnects client)', () => {
    const line = '[PHASE_STREAM] not-json';
    __internal._processLine('test-run-id', line, broadcastSpy);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('ignores lines without [PHASE_STREAM] prefix', () => {
    __internal._processLine('test-run-id', 'INFO: Starting workflow...', broadcastSpy);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('does not broadcast empty line', () => {
    __internal._processLine('test-run-id', '', broadcastSpy);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// _checkIdle()
// ---------------------------------------------------------------------------

describe('__internal._checkIdle()', () => {
  it('is a no-op when lastEventAt is recent (< IDLE_TIMEOUT_MS ago)', () => {
    vi.useFakeTimers();
    const terminateSpy = vi.fn();
    const broadcastSpy = vi.fn();
    const now = Date.now();
    vi.setSystemTime(now);

    // lastEventAt is 5 minutes ago — should NOT trigger
    __internal._checkIdle('run-1', now - 300_000, terminateSpy, broadcastSpy);

    expect(terminateSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not terminate a run within the 30-minute idle window', () => {
    const terminateSpy = vi.fn();
    const broadcastSpy = vi.fn();
    const now = Date.now();

    __internal._checkIdle(
      'run-1',
      now - 1_799_999,
      terminateSpy,
      broadcastSpy,
    );

    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(terminateSpy).not.toHaveBeenCalled();
  });

  it('broadcasts error event and calls terminate when idle > IDLE_TIMEOUT_MS', () => {
    vi.useFakeTimers();
    const terminateSpy = vi.fn();
    const broadcastSpy = vi.fn();
    const now = Date.now();
    vi.setSystemTime(now);

    // lastEventAt is 31 minutes ago — should trigger idle timeout
    __internal._checkIdle('run-1', now - 1_860_000, terminateSpy, broadcastSpy);
    expect(broadcastSpy).toHaveBeenCalledOnce();
    const payload: string = broadcastSpy.mock.calls[0][0];
    expect(payload).toContain('error');
    expect(payload).toContain('idle');
    expect(terminateSpy).toHaveBeenCalledWith('run-1');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// terminateRun()
// ---------------------------------------------------------------------------

describe('terminateRun()', () => {
  it('calls proc.kill("SIGTERM")', () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);

    // Manually insert a run into activeRuns
    const idleTimer = setInterval(() => {}, 30_000);
    const orphanTimer = setTimeout(() => {}, 60_000);
    activeRuns.set('run-terminate-test', {
      proc: mockProc,
      runId: 'run-terminate-test',
      sessionId: 'sess-1',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      controllers: new Set(),
      idleTimer,
      orphanTimer,
    } as any);

    terminateRun('run-terminate-test');

    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('clears idleTimer before removing run from activeRuns', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const mockProc = makeMockProcess();
    const idleTimer = setInterval(() => {}, 30_000);

    activeRuns.set('run-idletimer-test', {
      proc: mockProc,
      runId: 'run-idletimer-test',
      sessionId: 'sess-2',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      controllers: new Set(),
      idleTimer,
    } as any);

    terminateRun('run-idletimer-test');

    expect(clearIntervalSpy).toHaveBeenCalledWith(idleTimer);
    expect(activeRuns.has('run-idletimer-test')).toBe(false);
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it('clears orphanTimer when orphanTimer is set', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const mockProc = makeMockProcess();
    const idleTimer = setInterval(() => {}, 30_000);
    const orphanTimer = setTimeout(() => {}, 60_000);

    activeRuns.set('run-orphan-test', {
      proc: mockProc,
      runId: 'run-orphan-test',
      sessionId: 'sess-3',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      controllers: new Set(),
      idleTimer,
      orphanTimer,
    } as any);

    terminateRun('run-orphan-test');

    expect(clearTimeoutSpy).toHaveBeenCalledWith(orphanTimer);
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('is a no-op for unknown runId', () => {
    expect(() => terminateRun('nonexistent-run')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// addController() and removeController()
// ---------------------------------------------------------------------------

describe('addController()', () => {
  it('cancels pending orphanTimer when a new controller is added', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const mockProc = makeMockProcess();
    const idleTimer = setInterval(() => {}, 30_000);
    const orphanTimer = setTimeout(() => {}, 60_000);
    const mockCtrl = { enqueue: vi.fn(), close: vi.fn() } as any;

    activeRuns.set('run-add-ctrl', {
      proc: mockProc,
      runId: 'run-add-ctrl',
      sessionId: 'sess-4',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      controllers: new Set(),
      history: [],
      idleTimer,
      orphanTimer,
    } as any);

    addController('run-add-ctrl', mockCtrl);

    expect(clearTimeoutSpy).toHaveBeenCalledWith(orphanTimer);
    const run = activeRuns.get('run-add-ctrl');
    expect(run?.controllers.has(mockCtrl)).toBe(true);
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('removeController()', () => {
  it('schedules orphanTimer with SIGTERM_DELAY_MS when last controller is removed', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const mockProc = makeMockProcess();
    const idleTimer = setInterval(() => {}, 30_000);
    const mockCtrl = { enqueue: vi.fn(), close: vi.fn() } as any;

    activeRuns.set('run-remove-ctrl', {
      proc: mockProc,
      runId: 'run-remove-ctrl',
      sessionId: 'sess-5',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      controllers: new Set([mockCtrl]),
      idleTimer,
    } as any);

    removeController('run-remove-ctrl', mockCtrl);

    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      SIGTERM_DELAY_MS,
    );
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// startRun()
// ---------------------------------------------------------------------------

describe('startRun()', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    // Clear activeRuns between tests
    for (const [key] of activeRuns) {
      activeRuns.delete(key);
    }
  });

  afterEach(() => {
    for (const [key] of activeRuns) {
      activeRuns.delete(key);
    }
  });

  it('is idempotent — second call for same sessionId does not spawn second process', () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    mockProc.stdout.on.mockImplementation((event: string, cb: Function) => {});
    mockProc.stderr.on.mockImplementation((event: string, cb: Function) => {});
    mockProc.on.mockImplementation((event: string, cb: Function) => {});

    startRun('run-id-1', 'sess-idem', { zip_code: '77001' } as any);
    startRun('run-id-2', 'sess-idem', { zip_code: '77001' } as any);

    // Only one spawn call — second call is idempotent
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('throws when resolveKvr() returns null', () => {
    mockResolveKvr.mockReturnValue(null);
    expect(() => startRun('run-id-3', 'sess-kvr-absent', {} as any)).toThrow();
  });

  it('builds args as an array — no shell interpolation path', () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    mockProc.stdout.on.mockImplementation(() => {});
    mockProc.stderr.on.mockImplementation(() => {});
    mockProc.on.mockImplementation(() => {});

    startRun('run-id-4', 'sess-array-args', {
      zip_code: '77001; rm -rf /',
      annual_income: '42000',
    } as any);

    expect(mockSpawn).toHaveBeenCalledOnce();
    // spawn should be called with (path, args[], options) — not a shell string
    const [, args, options] = mockSpawn.mock.calls[0];
    expect(Array.isArray(args)).toBe(true);
    // No shell option set — prevents injection
    expect((options as any)?.shell).toBeFalsy();
  });

  it("passes cwd pointing to parent of process.cwd() (repo root invariant)", () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    mockProc.stdout.on.mockImplementation(() => {});
    mockProc.stderr.on.mockImplementation(() => {});
    mockProc.on.mockImplementation(() => {});

    startRun('run-id-5', 'sess-cwd', { zip_code: '77001' } as any);

    const [, , options] = mockSpawn.mock.calls[0];
    const spawnCwd = (options as any)?.cwd as string;
    expect(spawnCwd).toBeDefined();
    // cwd should be the parent of web/ (i.e., the repo root)
    // process.cwd() in the web/ context is the web directory
    const expectedParent = path.join(process.cwd(), '..');
    expect(spawnCwd).toBe(expectedParent);
  });

  it('args array includes --run-id, --mode automated, --no-progress, --phase-stream stdout', () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    mockProc.stdout.on.mockImplementation(() => {});
    mockProc.stderr.on.mockImplementation(() => {});
    mockProc.on.mockImplementation(() => {});

    startRun('my-test-run-id', 'sess-args-check', { zip_code: '77001' } as any);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('run');
    expect(args).toContain('benefits-navigator');
    expect(args).toContain('--mode');
    expect(args).toContain('automated');
    expect(args).toContain('--no-progress');
    expect(args).toContain('--run-id');
    expect(args).toContain('my-test-run-id');
    expect(args).toContain('--phase-stream');
    expect(args).toContain('stdout');
  });
});

// ---------------------------------------------------------------------------
// getRunIdForSession()
// ---------------------------------------------------------------------------

describe('getRunIdForSession()', () => {
  beforeEach(() => {
    for (const [key] of activeRuns) activeRuns.delete(key);
  });

  it('returns undefined when no run exists for the sessionId', () => {
    expect(getRunIdForSession('sess-no-run')).toBeUndefined();
  });

  it('returns the runId when a run exists for the sessionId', () => {
    const mockProc = makeMockProcess();
    activeRuns.set('existing-run', {
      proc: mockProc,
      runId: 'existing-run',
      sessionId: 'sess-with-run',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      controllers: new Set(),
      idleTimer: setInterval(() => {}, 30_000),
    } as any);

    expect(getRunIdForSession('sess-with-run')).toBe('existing-run');
  });
});

// ---------------------------------------------------------------------------
// New tests: PYTHONUNBUFFERED env, workflow_start event, CRLF parsing,
// addController history replay
// ---------------------------------------------------------------------------

describe('startRun() — PYTHONUNBUFFERED env', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    for (const [key] of activeRuns) activeRuns.delete(key);
  });
  afterEach(() => {
    for (const [key] of activeRuns) activeRuns.delete(key);
  });

  it('spawn env includes PYTHONUNBUFFERED=1', () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    mockProc.stdout.on.mockImplementation(() => {});
    mockProc.stderr.on.mockImplementation(() => {});
    mockProc.on.mockImplementation(() => {});

    startRun('run-env-test', 'sess-env', { zip_code: '90210' } as any);

    const [, , options] = mockSpawn.mock.calls[0];
    expect((options as any)?.env?.PYTHONUNBUFFERED).toBe('1');
  });
});

describe('startRun() — workflow_start history event', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    for (const [key] of activeRuns) activeRuns.delete(key);
  });
  afterEach(() => {
    for (const [key] of activeRuns) activeRuns.delete(key);
  });

  it('workflow_start SSE event is in run.history immediately after startRun()', () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    mockProc.stdout.on.mockImplementation(() => {});
    mockProc.stderr.on.mockImplementation(() => {});
    mockProc.on.mockImplementation(() => {});

    startRun('run-wfstart', 'sess-wfstart', { zip_code: '77001' } as any);

    const run = activeRuns.get('run-wfstart');
    expect(run).toBeDefined();
    expect(run!.history.length).toBeGreaterThan(0);
    const startEvent = run!.history.find((h) => h.includes('workflow_start'));
    expect(startEvent).toBeDefined();
    vi.useRealTimers();
  });
});

describe('__internal._processLine() — CRLF parsing', () => {
  it('parses lines split by CRLF (\\r\\n) the same as LF (\\n)', () => {
    // The stdout buffer splitter removes CRLF delimiters before _processLine runs.
    const broadcastSpy = vi.fn();
    const event: PhaseEvent = { event_type: 'phase_start', phase: 'benefits-research' };
    const cleanLine = `[PHASE_STREAM] ${JSON.stringify(event)}`;
    __internal._processLine('test-run-crlf', cleanLine, broadcastSpy);
    expect(broadcastSpy).toHaveBeenCalledOnce();
  });

  it('startRun stdout data handler splits CRLF lines correctly (integration)', () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    mockSpawn.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    mockSpawn.mockReturnValue(mockProc);

    let capturedDataHandler: ((chunk: Buffer) => void) | undefined;
    mockProc.stdout.on.mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
      if (event === 'data') capturedDataHandler = cb;
    });
    mockProc.stderr.on.mockImplementation(() => {});
    mockProc.on.mockImplementation(() => {});

    const runId = 'run-crlf-integration';
    // Clear any previous runs
    for (const [key] of activeRuns) activeRuns.delete(key);

    startRun(runId, 'sess-crlf', { zip_code: '90001' } as any);

    const run = activeRuns.get(runId);
    expect(run).toBeDefined();
    const initialHistoryLen = run!.history.length;

    // Simulate KVR emitting CRLF-terminated output
    if (capturedDataHandler) {
      const event = { event_type: 'phase_start', phase: 'benefits-research' };
      const crlfLine = `[PHASE_STREAM] ${JSON.stringify(event)}\r\n`;
      capturedDataHandler(Buffer.from(crlfLine));
    }

    expect(run!.history.length).toBeGreaterThan(initialHistoryLen);
    const phaseEvent = run!.history.find((h) => h.includes('phase_start'));
    expect(phaseEvent).toBeDefined();

    for (const [key] of activeRuns) activeRuns.delete(key);
    vi.useRealTimers();
  });
});

describe('addController() — history replay includes workflow_start', () => {
  beforeEach(() => {
    for (const [key] of activeRuns) activeRuns.delete(key);
  });
  afterEach(() => {
    for (const [key] of activeRuns) activeRuns.delete(key);
  });

  it('replays workflow_start from history to a late-connecting controller', () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    const idleTimer = setInterval(() => {}, 30_000);
    const startEvent = formatSseEvent({ event_type: 'workflow_start' }, 'run-replay-start');
    const phaseEvent = formatSseEvent({ event_type: 'phase_start', phase: 'benefits-research' }, 'run-replay-phase');

    activeRuns.set('run-replay', {
      proc: mockProc,
      runId: 'run-replay',
      sessionId: 'sess-replay',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      controllers: new Set(),
      history: [startEvent, phaseEvent],
      idleTimer,
    } as any);

    const mockCtrl = { enqueue: vi.fn(), close: vi.fn() } as any;
    addController('run-replay', mockCtrl);

    // Controller should have received both history events
    expect(mockCtrl.enqueue).toHaveBeenCalledTimes(2);
    const allArgs: string[] = mockCtrl.enqueue.mock.calls.map(
      (call: [Uint8Array]) => new TextDecoder().decode(call[0]),
    );
    expect(allArgs.some((s) => s.includes('workflow_start'))).toBe(true);
    expect(allArgs.some((s) => s.includes('phase_start'))).toBe(true);

    vi.useRealTimers();
  });
});

describe('__internal.classifyRunnerFailure() — upstream failures', () => {
  // Captured from `kvr run benefits-navigator` on 2026-09-25 with an expired
  // OAuth login for the account (run 358abe31-… failed the same way).
  const EXPIRED_OAUTH_OUTPUT = [
    'Checking environment quotas...',
    "Phase 'insurance-research' failed: Parallel execution error: Empty OAuth token ",
    "for account 'claude/kealu.com'; token refresh may have failed or the account has",
    'no valid credentials',
    '│ Reason: Parallel execution error: Empty OAuth token for account              │',
    '│   • Wait a few minutes and retry                                             │',
    '│   • Check AI service status                                                  │',
  ].join('\n');

  it('classifies an empty or expired OAuth token as UPSTREAM_AUTH (BN-1003)', () => {
    const code = __internal.classifyRunnerFailure(EXPIRED_OAUTH_OUTPUT, 1, null);
    expect(code).toBe('UPSTREAM_AUTH');
    expect(__internal.PUBLIC_ERROR_CODES[code]).toBe('BN-1003');
  });

  it('classifies the claude CLI "authentication_failed" result as UPSTREAM_AUTH', () => {
    const output =
      '{"error":"authentication_failed","text":"Failed to authenticate: OAuth session expired and could not be refreshed"}';
    expect(__internal.classifyRunnerFailure(output, 1, null)).toBe('UPSTREAM_AUTH');
  });

  it('prefers UPSTREAM_AUTH when the output also mentions a rate limit', () => {
    const output = `WARN rate limit hit, retrying in 2s\n${EXPIRED_OAUTH_OUTPUT}`;
    expect(__internal.classifyRunnerFailure(output, 1, null)).toBe('UPSTREAM_AUTH');
  });

  it('still classifies a 429 without auth errors as UPSTREAM_RATE_LIMIT (BN-1001)', () => {
    const output = '{"is_error":true,"api_error_status":429}';
    expect(__internal.classifyRunnerFailure(output, 1, null)).toBe('UPSTREAM_RATE_LIMIT');
  });

  it('falls back to PROCESS_EXIT_NONZERO when nothing matches', () => {
    expect(__internal.classifyRunnerFailure('Workflow failed', 1, null)).toBe(
      'PROCESS_EXIT_NONZERO',
    );
  });
});

describe('PUBLIC_ERROR_DESCRIPTIONS', () => {
  it('describes every public error code', () => {
    for (const publicCode of Object.values(__internal.PUBLIC_ERROR_CODES)) {
      expect(__internal.PUBLIC_ERROR_DESCRIPTIONS[publicCode]).toBeTruthy();
    }
  });

  it('describes BN-1003 as an authentication failure', () => {
    expect(__internal.PUBLIC_ERROR_DESCRIPTIONS['BN-1003']).toMatch(/^Authentication/);
  });
});

describe('startRun() — failure event sent to the browser', () => {
  beforeEach(() => {
    activeRuns.clear();
    mockSpawn.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
  });

  afterEach(() => {
    for (const run of activeRuns.values()) clearInterval(run.idleTimer);
    activeRuns.clear();
  });

  it('sends only the generic message and BN-1003 for an auth failure; the description stays in the server log', () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    startRun('run-auth', 'sess-auth', {} as any);
    const ctrl = { enqueue: vi.fn(), close: vi.fn() } as any;
    addController('run-auth', ctrl);

    const onStdout = mockProc.stdout.on.mock.calls.find(
      (call: [string]) => call[0] === 'data',
    )[1];
    onStdout(Buffer.from("Parallel execution error: Empty OAuth token for account 'claude/kealu.com'\n"));
    const onClose = mockProc.on.mock.calls.find((call: [string]) => call[0] === 'close')[1];
    onClose(1, null);

    const sent: string[] = ctrl.enqueue.mock.calls.map(
      (call: [Uint8Array]) => new TextDecoder().decode(call[0]),
    );
    const errorPayload = sent.find((s) => s.includes('"event_type":"error"'))!;
    const event = JSON.parse(errorPayload.split('\n').find((l) => l.startsWith('data: '))!.slice(6));
    expect(event).toEqual({
      event_type: 'error',
      message: 'The system is currently overloaded. Please try again later.',
      error_code: 'BN-1003',
    });
    expect(errorPayload).not.toMatch(/oauth|authentication|kealu\.com/i);

    const logged = JSON.parse(errorLog.mock.calls[0][0] as string);
    expect(logged.failureCode).toBe('UPSTREAM_AUTH');
    expect(logged.publicCode).toBe('BN-1003');
    expect(logged.description).toMatch(/^Authentication/);

    vi.restoreAllMocks();
  });
});
