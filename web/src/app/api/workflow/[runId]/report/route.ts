//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { NextResponse } from 'next/server';

/**
 * GET /api/workflow/[runId]/report
 *
 * Assembles and returns the full report for a completed workflow run.
 * Authorizes via session cookie: session.runId must match path runId.
 * Caches the assembled report in session.reportContent to avoid re-reading on refresh.
 * Deletes the run directory after the first successful assembly.
 *
 * Returns application metadata after the completed benefits analysis.
 * PDF generation occurs later in the dedicated application workflow.
 *
 * Both session-store and report-assembler are imported dynamically so that
 * vi.mock() factories in tests are not triggered at module-load time.
 *
 * Response codes:
 * - 200 `{ sections, bottomLine, application }` — report assembled
 * - 403 — session does not own this runId
 * - 422 `{ error, missingPhases }` — run directory missing or incomplete
 */
export async function GET(
  req: Request,
  { params }: { params: { runId: string } },
): Promise<Response> {
  const { runId } = params;

  // Dynamic imports: defers module resolution to handler invocation time.
  const { sessionStore } = await import('@/lib/session-store');
  const {
    assembleReport,
    deleteRunDir,
    getWorkforceBase,
    PHASE_ORDER,
  } = await import('@/lib/report-assembler');

  // Authorize using only the session cookie from this request.
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Return cached report if available.
  if (session.reportContent) {
    return NextResponse.json(session.reportContent, {
      status: 200,
      headers: { 'X-Correlation-Id': runId },
    });
  }

  const workforceBase = getWorkforceBase();

  try {
    const payload = await assembleReport(runId, workforceBase);

    // SAWS 2 PLUS is currently supported only for California households.
    if (session.vars.state?.trim().toUpperCase() === 'CA') {
      payload.application = {
        available: true,
        formId: 'CA_SAWS_2_PLUS',
        formName: 'SAWS 2 PLUS',
        status: 'not_started',
        recommendedPrograms: [],
      };
    }

    // Cache report and mark the workflow complete.
    sessionStore.update(session.sessionId, {
      reportContent: payload,
      runStatus: 'complete',
    });

    // The report is cached, so the run directory is no longer needed.
    await deleteRunDir(runId, workforceBase);

    return NextResponse.json(payload, {
      status: 200,
      headers: { 'X-Correlation-Id': runId },
    });
  } catch (err: unknown) {
    const e = err as { code?: string; missingPhases?: string[] };

    if (e.code === 'RUN_DIR_MISSING') {
      return NextResponse.json(
        {
          error: 'Run directory not found — workflow may not have completed.',
          missingPhases: PHASE_ORDER,
        },
        { status: 422, headers: { 'X-Correlation-Id': runId } },
      );
    }

    if (e.code === 'INCOMPLETE') {
      return NextResponse.json(
        {
          error: 'Workflow incomplete — some phases have not finished.',
          missingPhases: e.missingPhases ?? [],
        },
        { status: 422, headers: { 'X-Correlation-Id': runId } },
      );
    }

    throw err;
  }
}