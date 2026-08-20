//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import path from 'path';
import { NextResponse } from 'next/server';

/**
 * GET /api/workflow/[runId]/guide
 *
 * The completion guide for the draft this session generated, as a
 * self-contained HTML page that prints cleanly on US Letter.
 *
 * It is built from `session.draftApplicationData` — the state the PDF was
 * generated from — rather than from anything the client sends, so the guide
 * always describes the draft the applicant is holding. Editing an answer
 * without regenerating leaves both the PDF and its guide unchanged, which is
 * the only way the two can be trusted to match.
 *
 * Query parameters:
 * - audience=associate — the field-location guide for whoever is helping.
 *   Anything else, including omission, gives the applicant guide.
 * - download=1 — force a file download instead of rendering in the browser.
 *
 * Response codes:
 * - 200 text/html — the guide
 * - 403 — session does not own this runId
 * - 404 — no draft has been generated for this session yet
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  const url = new URL(req.url);
  const download = url.searchParams.get('download') === '1';
  const audience =
    url.searchParams.get('audience') === 'associate' ? 'associate' : 'applicant';

  const { sessionStore } = await import('@/lib/session-store');
  const { localeFromCookieHeader } = await import('@/lib/locale');
  const { buildCompletionGuide, draftReferenceFrom } = await import(
    '@/lib/completion-guide'
  );
  const { renderCompletionGuideHtml } = await import(
    '@/lib/completion-guide-html'
  );

  // Authorize: read session exclusively from the request Cookie header.
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const application = session.draftApplicationData;

  if (!application) {
    return NextResponse.json(
      { error: 'No draft has been generated for this run yet.' },
      { status: 404 },
    );
  }

  /*
   * The applicant's own choice, carried on the cookie the language switcher
   * writes — never Accept-Language. Someone who switched to Spanish on a
   * borrowed English laptop gets a Spanish guide.
   */
  const locale = localeFromCookieHeader(req.headers.get('cookie'));

  const guide = buildCompletionGuide({
    application,
    audience,
    locale,
    county: session.vars.county ?? '',
    draft: {
      reference: draftReferenceFrom(runId),
      generatedAt: session.draftGeneratedAt ?? new Date().toISOString(),
      pdfFilename: session.draftPath
        ? path.basename(session.draftPath)
        : undefined,
    },
  });

  const html = renderCompletionGuideHtml(guide);
  const filename = `saws-2-plus-${audience}-guide-${guide.draft.reference}.html`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `${
        download ? 'attachment' : 'inline'
      }; filename="${filename}"`,
      // The guide names the applicant, so it is never cached by a proxy.
      'Cache-Control': 'private, no-store',
      'X-Correlation-Id': runId,
    },
  });
}
