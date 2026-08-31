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
 * Two sources, chosen by which one exists rather than by which state:
 *
 * - A document rendered through the mapping layer arrives with a **review
 *   sheet** already written beside it, naming what was filled in, what a blank
 *   completes, what the applicant's own answers make inapplicable and why, and
 *   anything too long for its printed box. That is the guide for that document,
 *   already in the language the document was filled in, and computing a second
 *   one in TypeScript could only disagree with it.
 * - California's SAWS 2 PLUS draft is written by the native-field generator and
 *   has no review sheet, so its guide is built here from the readiness model.
 *
 * Either way it describes the draft the applicant is holding, not whatever the
 * client sends: editing an answer without regenerating leaves both the PDF and
 * its guide unchanged, which is the only way the two can be trusted to match.
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

  if (session.draftReviewPath) {
    const { renderReviewSheetHtml } = await import('@/lib/review-sheet-html');
    const { readFile } = await import('fs/promises');
    const { getDraftsBase } = await import('@/lib/report-assembler');

    /*
     * The same path-traversal guard the draft route applies to the PDF. The
     * path is written by this server and never by a client, but the two files
     * are served the same way and should be defended the same way.
     */
    const resolvedReview = path.resolve(session.draftReviewPath);
    const resolvedBase = path.resolve(getDraftsBase());

    if (!resolvedReview.startsWith(resolvedBase + path.sep)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let review: string;

    try {
      review = await readFile(resolvedReview, 'utf8');
    } catch {
      return NextResponse.json(
        { error: 'Review sheet not found on disk.' },
        { status: 404 },
      );
    }

    const reference = draftReferenceFrom(runId);

    return new Response(renderReviewSheetHtml(review, reference), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `${
          download ? 'attachment' : 'inline'
        }; filename="application-review-${reference}.html"`,
        // It names the applicant, so it is never cached by a proxy.
        'Cache-Control': 'private, no-store',
        'X-Correlation-Id': runId,
      },
    });
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
