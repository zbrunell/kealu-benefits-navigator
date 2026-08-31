//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { readFile, stat } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import type { Saws2PlusApplicationData } from '@/types/application';
import { applicationForState } from '@/lib/state-applications';

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

  /*
   * The filename names the form, not the state we happen to support best.
   * "partially-prefilled-SAWS-2-PLUS-draft.pdf" was hardcoded, so a Texas
   * household downloading their H1010 worksheet got a file named after
   * California's form — or, for the worksheet branch, a name that said nothing
   * at all. It still names no applicant: a file in a downloads folder should
   * not announce whose benefits application it is.
   */
  const formType = session.draftFormType ?? 'official';
  const definition = applicationForState(session.vars.state);
  const slug = definition
    ? definition.formCode.trim().toLowerCase().replace(/\s+/g, '-')
    : '';

  const filename = slug
    ? formType === 'official'
      ? `partially-prefilled-${slug}-draft.pdf`
      : `${slug}-worksheet-draft.pdf`
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

/*
 * The authoritative check. The applicant step runs the same rules, but that is
 * a courtesy to whoever is typing — this route is reachable with any JSON, and
 * a malformed value that got past the UI must not reach the PDF.
 */
const { findApplicationFieldProblems } = await import('@/lib/field-validation');
const fieldProblems = findApplicationFieldProblems(applicationData);

if (fieldProblems.length > 0) {
  return NextResponse.json(
    {
      /*
       * Both an `errorKey` and an `error`. The key is what the UI renders, in
       * the applicant's language; the English text stays for logs and for any
       * client that does not know the key. The route itself has no locale — it
       * is not the place to choose words.
       */
      errorKey: 'api_error_field_problems',
      error: 'The application contains values that cannot be written to the form.',
      fieldProblems,
    },
    { status: 422, headers: { 'X-Correlation-Id': runId } },
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

/*
 * Whether we hold a machine-fillable form for this household's state.
 *
 * Asked of the registry rather than compared against 'CA'. The literal was
 * correct — SAWS 2 PLUS is California's form — but it stated the fact in the
 * one place that would not be updated when a second state gained a generated
 * form, and it gave the same 422 for "we do not fill forms in your state" as
 * for "you are not in California", which are different things to tell someone.
 */
const state = session.vars.state?.trim().toUpperCase();
const definition = applicationForState(state);

if (!definition || definition.delivery !== 'generated') {
  return NextResponse.json(
    {
      error: definition
        ? `We do not generate a filled application for ${definition.state}. Apply through ${definition.officialUrl}.`
        : 'No supported application form for this location.',
      // The client uses this to route to the manual guide instead of retrying.
      delivery: definition?.delivery ?? null,
    },
    {
      status: 422,
    },
  );
}

/*
 * The applicant's own choice, in priority order: what the session already
 * recorded, then the cookie their language picker wrote. `Accept-Language` is
 * never consulted — it describes the browser, not the person.
 */
const { localeFromCookieHeader, normalizeLocale } = await import('@/lib/locale');

const locale = session.locale
  ? normalizeLocale(session.locale)
  : localeFromCookieHeader(rawCookie);

const result = await generateDraft(
  runId,
  session.vars,
  JSON.stringify(session.reportContent),
  applicationData,
  getDraftsBase(),
  locale,
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
    draftReviewPath: result.reviewPath ?? null,
    draftApplicationData: applicationData,
    draftGeneratedAt: new Date().toISOString(),
    // Pin it, so the guide is written in the language the PDF was filled in
    // even if the applicant switches afterwards.
    locale,
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
