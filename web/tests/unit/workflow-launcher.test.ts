//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Unit tests for the workflow-launcher boundary and its E2E_MODE gate.
 *
 * Production behavior must be identical when E2E_MODE is unset: the resolved
 * launcher delegates to startRun() and still requires the kvr binary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/kvr-runner', () => ({
  startRun: vi.fn(),
}));

vi.mock('@/lib/e2e-workflow-runner', () => ({
  startFixtureRun: vi.fn(),
}));

import { resolveWorkflowLauncher } from '@/lib/workflow-launcher';
import { isE2EMode, e2ePhaseDelayMs } from '@/lib/e2e-mode';
import { startRun } from '@/lib/kvr-runner';
import { startFixtureRun } from '@/lib/e2e-workflow-runner';

const originalE2EMode = process.env.E2E_MODE;
const originalDelay = process.env.E2E_PHASE_DELAY_MS;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.E2E_MODE;
  delete process.env.E2E_PHASE_DELAY_MS;
});

afterEach(() => {
  if (originalE2EMode === undefined) delete process.env.E2E_MODE;
  else process.env.E2E_MODE = originalE2EMode;

  if (originalDelay === undefined) delete process.env.E2E_PHASE_DELAY_MS;
  else process.env.E2E_PHASE_DELAY_MS = originalDelay;
});

describe('isE2EMode', () => {
  it('is false when E2E_MODE is unset', () => {
    expect(isE2EMode()).toBe(false);
  });

  it('is true only for the exact value "1"', () => {
    process.env.E2E_MODE = '1';
    expect(isE2EMode()).toBe(true);

    for (const value of ['0', 'true', 'yes', '', 'TRUE', '1 ']) {
      process.env.E2E_MODE = value;
      expect(isE2EMode()).toBe(false);
    }
  });
});

describe('e2ePhaseDelayMs', () => {
  it('defaults to 700ms', () => {
    expect(e2ePhaseDelayMs()).toBe(700);
  });

  it('honors a numeric override, including 0', () => {
    process.env.E2E_PHASE_DELAY_MS = '0';
    expect(e2ePhaseDelayMs()).toBe(0);

    process.env.E2E_PHASE_DELAY_MS = '250';
    expect(e2ePhaseDelayMs()).toBe(250);
  });

  it('falls back to the default for junk and clamps large values', () => {
    process.env.E2E_PHASE_DELAY_MS = 'soon';
    expect(e2ePhaseDelayMs()).toBe(700);

    process.env.E2E_PHASE_DELAY_MS = '-5';
    expect(e2ePhaseDelayMs()).toBe(700);

    process.env.E2E_PHASE_DELAY_MS = '999999';
    expect(e2ePhaseDelayMs()).toBe(10_000);
  });
});

describe('resolveWorkflowLauncher', () => {
  const vars = { zip_code: '90001', annual_income: '32000', household_profile: 'just me, 41' };

  it('returns the real KVR launcher when E2E_MODE is unset', async () => {
    const launcher = await resolveWorkflowLauncher();

    expect(launcher.kind).toBe('kvr');
    expect(launcher.requiresKvr).toBe(true);

    launcher.launch('run-1', 'session-1', vars);

    expect(startRun).toHaveBeenCalledWith('run-1', 'session-1', vars);
    expect(startFixtureRun).not.toHaveBeenCalled();
  });

  it('returns the fixture launcher when E2E_MODE=1', async () => {
    process.env.E2E_MODE = '1';
    const launcher = await resolveWorkflowLauncher();

    expect(launcher.kind).toBe('e2e-fixture');
    expect(launcher.requiresKvr).toBe(false);

    launcher.launch('run-2', 'session-2', vars);

    expect(startFixtureRun).toHaveBeenCalledWith('run-2', 'session-2', vars);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('does not use the fixture launcher for a truthy-but-not-"1" value', async () => {
    process.env.E2E_MODE = 'true';
    const launcher = await resolveWorkflowLauncher();

    expect(launcher.kind).toBe('kvr');
    expect(launcher.requiresKvr).toBe(true);
  });
});
