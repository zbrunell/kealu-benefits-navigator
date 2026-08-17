//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { readFile, stat } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import type { Saws2PlusApplicationData } from '@/types/application';

/**
 * GET /api/workflow/[runId]/draft
 *
 * View or download the pre-filled benefit application draft PDF for a completed run.
 * Authorizes via session cookie: session.runId must match path runId and
 * session.draftPath must be set.
 *
 * Query parameters:
 * - download=1 — forces attachment download
 * - omitted — displays the PDF inline for browser preview
 *
 * Security: the absolute draftPath is verified to be within getDraftsBase() to
 * prevent path traversal attacks.
 *
 * Response codes:
 * - 200 application/pdf — PDF streamed with correct Content-Disposition
 * - 403 — session does not own this runId
 * - 404 — no draft was generated, or file no longer on disk
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const download = new URL(req.url).searchParams.get('download') === '1';

  // Dynamic imports: defers module resolution to handler invocation time
  const { sessionStore } = await import('@/lib/session-store');
  const { getDraftsBase } = await import('@/lib/report-assembler');

  // Authorize: read session exclusively from the request Cookie header
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;


  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Verify the draft was generated for this session
  if (!session.draftPath) {
    return NextResponse.json(
      { error: 'No draft available for this run.' },
      { status: 404 },
    );
  }

  // Path traversal guard: draftPath must be inside .workforce-drafts/
  const draftsBase = getDraftsBase();
  const resolvedDraft = path.resolve(session.draftPath);
  const resolvedBase = path.resolve(draftsBase);
  if (!resolvedDraft.startsWith(resolvedBase + path.sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Verify file still exists on disk
  try {
    await stat(resolvedDraft);
  } catch {
    return NextResponse.json(
      { error: 'Draft file not found on disk.' },
      { status: 404 },
    );
  }

  // Read and stream the PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await readFile(resolvedDraft);
  } catch {
    return NextResponse.json(
      { error: 'Failed to read draft file.' },
      { status: 404 },
    );
  }

  // Determine filename from form type
  const formType = session.draftFormType ?? 'official';

  const filename =
  formType === 'official'
    ? 'partially-prefilled-SAWS-2-PLUS-draft.pdf'
    : 'benefits-preparation-worksheet-draft.pdf';

    return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Content-Length': String(pdfBuffer.length),
      'Cache-Control': 'private, no-store',
      'X-Correlation-Id': runId,
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const { sessionStore } = await import('@/lib/session-store');
  const { getDraftsBase } = await import('@/lib/report-assembler');
  const { generateDraft } = await import('@/lib/draft-generator');

const rawCookie = req.headers.get('cookie') ?? '';

const sessionCookieMatch = rawCookie.match(
  /(?:^|;\s*)session=([^;]+)/,
);

const cookieValue = sessionCookieMatch?.[1];

const session = cookieValue
  ? sessionStore.get(cookieValue)
  : null;

if (!session || session.runId !== runId) {
  return NextResponse.json(
    { error: 'Forbidden' },
    { status: 403 },
  );
}

let body: {
  applicationData?: Saws2PlusApplicationData;
};

try {
  body = await req.json();
} catch {
  return NextResponse.json(
    {
      error: 'Request body must be valid JSON.',
    },
    {
      status: 400,
    },
  );
}

const applicationData = body.applicationData;

if (
  !applicationData
  || typeof applicationData !== 'object'
) {
  return NextResponse.json(
    {
      error: 'applicationData is required.',
    },
    {
      status: 400,
    },
  );
}

if (!session.reportContent) {
  return NextResponse.json(
    {
      error:
        'No completed workflow report found for this session.',
    },
    {
      status: 409,
    },
  );
}

const state = session.vars.state
  ?.trim()
  .toUpperCase();

if (state !== 'CA') {
  return NextResponse.json(
    {
      error:
        'SAWS 2 PLUS draft generation is only available for California.',
    },
    {
      status: 422,
    },
  );
}

const result = await generateDraft(
  runId,
  session.vars,
  JSON.stringify(session.reportContent),
  applicationData,
  getDraftsBase(),
);

if (!result) {
  return NextResponse.json(
    {
      error:
        'Failed to generate application draft.',
    },
    {
      status: 500,
      headers: {
        'X-Correlation-Id': runId,
      },
    },
  );
}

/*
 * Record what this draft was generated from, so the completion guide can
 * describe the PDF the applicant actually downloaded rather than whatever the
 * client holds by the time they ask for the guide.
 */
sessionStore.update(
  session.sessionId,
  {
    draftPath: result.path,
    draftFormType: result.formType,
    draftApplicationData: applicationData,
    draftGeneratedAt: new Date().toISOString(),
  },
);

const { draftReferenceFrom } = await import('@/lib/completion-guide');

return NextResponse.json(
  {
    success: true,
    runId,
    formType: result.formType,
    draftUrl:
      `/api/workflow/${runId}/draft`,
    // The guide for this draft, and the reference printed on both.
    guideUrl:
      `/api/workflow/${runId}/guide`,
    draftReference: draftReferenceFrom(runId),
  },
  {
    status: 201,
    headers: {
      'X-Correlation-Id': runId,
      },
    },
  );
}
