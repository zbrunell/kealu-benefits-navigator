//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Draft generator — spawns the Python `generate_draft_helper` subprocess to
 * produce a pre-filled benefit application PDF.
 *
 * The Python executable is resolved via `resolvePythonExec()` before spawning.
 * No user PII crosses the log boundary; only runId, form_type, exit_code, and
 * elapsed_ms are logged.
 */

import { spawn } from 'child_process';
import { DEFAULT_LOCALE, type Locale } from '@/lib/locale';
import { existsSync } from 'fs';
import path from 'path';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { resolveKvr } from '@/lib/kvr-checker';
import type { Saws2PlusApplicationData } from '@/types/application';
import type { SessionVars } from '@/types/session';

/** Result of a successful draft generation. */
export interface DraftResult {
  /** Absolute filesystem path to the generated PDF. */
  path: string;

  /** "official" for a real state AcroForm PDF; "worksheet" for the fallback. */
  formType: 'official' | 'worksheet';
}

/**
 * Locate the Python executable used to spawn the draft helper.
 *
 * Resolution order:
 * 1. `KVR_PYTHON` explicit override.
 * 2. Currently active virtual environment.
 * 3. Project-local `.venv`.
 * 4. Python alongside the resolved KVR executable.
 * 5. null — generation is skipped and a structured warning is logged.
 */
export function resolvePythonExec(): string | null {
  // 1. Explicit operator override.
  const envPython = process.env.KVR_PYTHON;

  if (envPython && existsSync(envPython)) {
    return envPython;
  }

  // 2. Active virtual environment.
  const virtualEnv = process.env.VIRTUAL_ENV;

  if (virtualEnv) {
    const candidates = [
      path.join(virtualEnv, 'bin', 'python'),
      path.join(virtualEnv, 'bin', 'python3'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  // 3. Project-local virtual environment.
  //
  // In normal Next.js development, process.cwd() is `web/`, so the Python
  // project root is one directory above it.
  const projectVenvCandidates = [
    path.resolve(process.cwd(), '..', '.venv', 'bin', 'python'),
    path.resolve(process.cwd(), '..', '.venv', 'bin', 'python3'),
    path.resolve(process.cwd(), '.venv', 'bin', 'python'),
    path.resolve(process.cwd(), '.venv', 'bin', 'python3'),
  ];

  for (const candidate of projectVenvCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // 4. Python alongside KVR, if KVR itself is installed in a venv.
  const kvrPath = resolveKvr();

  if (kvrPath) {
    const binDir = path.dirname(kvrPath);

    const candidates = [
      path.join(binDir, 'python'),
      path.join(binDir, 'python3'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  console.log(
    JSON.stringify({
      level: 'warn',
      event: 'python_exec_not_found',
      reason:
        'no configured, virtualenv, project-local, or KVR-adjacent Python executable found',
    }),
  );

  return null;
}

/**
 * Spawn the Python draft helper to generate a pre-filled benefit application PDF.
 *
 * Returns a DraftResult on success, or null on any failure.
 *
 * @param runId Workflow run UUID, used only for structured logs.
 * @param vars Household variables such as state, county, and ZIP code.
 * @param workflowOutput Concatenated workflow output.
 * @param applicationData Structured application state.
 * @param draftsBase Base directory for generated drafts.
 * @param locale The language the applicant chose. Decides which official
 *   CDSS form edition is filled — see `form_templates.py`.
 */
export async function generateDraft(
  runId: string,
  vars: SessionVars,
  workflowOutput: string,
  applicationData: Saws2PlusApplicationData,
  draftsBase: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<DraftResult | null> {
  const pythonExec = resolvePythonExec();

  if (!pythonExec) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'draft_generation_skipped',
        runId,
        reason: 'python exec not found',
      }),
    );

    return null;
  }

  const outputDir = path.join(draftsBase, runId);

  const applicationFieldPlan = buildApplicationFieldPlan(applicationData, {
    county: vars.county,
  });

  const stdinPayload = JSON.stringify({
    args: {
      ...vars,
      application_data: applicationData,
      application_field_plan: applicationFieldPlan,
      // Spread last so a stray `locale` in vars can never outrank the
      // applicant's actual selection.
      locale,
    },
    workflow_output: workflowOutput,
    output_dir: outputDir,
  });

  /*
   * Force the subprocess to import Python modules from this repository
   * instead of an editable installation pointing at another KVR worktree.
   *
   * Normally process.cwd() is `web/`.
   */
  const repoRoot = path.resolve(process.cwd(), '..');
  const localPythonSrc = path.join(repoRoot, 'src');

  const pythonPath = process.env.PYTHONPATH
    ? `${localPythonSrc}${path.delimiter}${process.env.PYTHONPATH}`
    : localPythonSrc;

  const startMs = Date.now();

  return new Promise<DraftResult | null>((resolve) => {
    const controller = new AbortController();

    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, 30_000);

    let stdout = '';
    let stderr = '';

    const child = spawn(
      pythonExec,
      ['-m', 'benefits_navigator.generate_draft_helper'],
      {
        signal: controller.signal,
        shell: false,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: pythonPath,
        },
      },
    );

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdin?.write(stdinPayload);
    child.stdin?.end();

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);

      console.log(
        JSON.stringify({
          level: 'warn',
          event: 'draft_generation_failed',
          runId,
          reason: 'spawn error',
          error: err.message,
        }),
      );

      resolve(null);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);

      const elapsedMs = Date.now() - startMs;

      if (code !== 0) {
        const snippet = stderr.slice(0, 512).replace(/\n/g, ' ');

        console.log(
          JSON.stringify({
            level: 'warn',
            event: 'draft_generation_failed',
            runId,
            exit_code: code,
            elapsed_ms: elapsedMs,
            stderr_snippet: snippet,
          }),
        );

        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as {
          path?: string;
          form_type?: string;
          error?: string;
        };

        if (result.error || !result.path || !result.form_type) {
          console.log(
            JSON.stringify({
              level: 'warn',
              event: 'draft_generation_failed',
              runId,
              reason:
                result.error ??
                'missing path or form_type in output',
              elapsed_ms: elapsedMs,
            }),
          );

          resolve(null);
          return;
        }

        if (
          result.form_type !== 'official' &&
          result.form_type !== 'worksheet'
        ) {
          console.log(
            JSON.stringify({
              level: 'warn',
              event: 'draft_generation_failed',
              runId,
              reason: `unexpected form_type: ${result.form_type}`,
              elapsed_ms: elapsedMs,
            }),
          );

          resolve(null);
          return;
        }

        const formType = result.form_type;

        console.log(
          JSON.stringify({
            level: 'info',
            event: 'draft_generation_complete',
            runId,
            form_type: formType,
            elapsed_ms: elapsedMs,
            success: true,
          }),
        );

        resolve({
          path: result.path,
          formType,
        });
      } catch {
        console.log(
          JSON.stringify({
            level: 'warn',
            event: 'draft_generation_failed',
            runId,
            reason: 'JSON parse failure',
            elapsed_ms: elapsedMs,
          }),
        );

        resolve(null);
      }
    });
  });
}