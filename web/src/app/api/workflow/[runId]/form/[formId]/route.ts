//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import path from 'path';
import { NextResponse } from 'next/server';

/**
 * GET /api/workflow/[runId]/form/[formId]
 *
 * The blank official document for one form in this session's packet, in the
 * language the packet resolved for this applicant.
 *
 * ── Why this route exists ──────────────────────────────────────────────────
 * We hold HHSC's own verified PDFs — the English and Spanish H1010, and the
 * bilingual H1049 and H3037 — and until now there was no way for an applicant
 * to get one. That mattered most for the forms we cannot prefill: a household
 * told "you may be asked for Form H1049" was left to find it on a catalog that
 * is an Angular application and cannot be linked to directly.
 *
 * It also makes the language requirement real rather than notional. A Spanish
 * applicant receives `TX-H1010-ES-2026-08.pdf`, saved as
 * `Texas-H1010-Application-Spanish.pdf`, through the ordinary interface.
 *
 * ── Which file, decided where ──────────────────────────────────────────────
 * Not here. The route serves the asset the **session's stored packet** names,
 * and that packet was resolved by the Python document layer at generation time
 * from what each document declares it prints. This handler never looks at the
 * locale, never pattern-matches a filename, and cannot: `formId` selects an
 * entry, and the entry names its own file.
 *
 * That is what stops the bug this replaced from reappearing here. A route that
 * built a filename from the locale would hand a Spanish applicant the English
 * H1049 — the Spanish H1049 is a file named `-BI-`, because it is one bilingual
 * document — or a 404.
 *
 * ── Security ───────────────────────────────────────────────────────────────
 * Two independent guards, because the path is derived from a URL segment:
 *
 * 1. `formId` is matched against the session's own packet. A form not in this
 *    household's packet is a 404, so the parameter is an allowlist lookup
 *    rather than a filename.
 * 2. The resolved path is verified to sit directly inside the bundled forms
 *    directory. Belt and braces: even if a manifest entry were somehow
 *    malformed, `../` cannot escape.
 *
 * The documents are public agency forms and carry no applicant data, so the
 * session check here is about not answering for runs the caller does not own
 * rather than about protecting the bytes.
 *
 * Query parameters:
 * - download=1 — force a download instead of rendering inline.
 *
 * Response codes:
 * - 200 application/pdf
 * - 403 — session does not own this runId
 * - 404 — no packet, form not in this household's packet, or file missing
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string; formId: string }> },
): Promise<Response> {
  const { runId, formId } = await params;
  const download = new URL(req.url).searchParams.get('download') === '1';

  const { sessionStore } = await import('@/lib/session-store');
  const { officialDownloadName } = await import('@/lib/document-labels');

  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const packet = session.draftPacket ?? [];

  // Guard 1: the parameter is an allowlist lookup, not a filename.
  const entry = packet.find((candidate) => candidate.form_id === formId);

  if (!entry?.document) {
    return NextResponse.json(
      { error: 'No official document for that form in this packet.' },
      { status: 404 },
    );
  }

  const { readFile } = await import('fs/promises');

  const formsDir = path.resolve(
    process.cwd(),
    '..',
    'src',
    'benefits_navigator',
    'forms',
  );

  const resolved = path.resolve(formsDir, entry.document.source_filename);

  // Guard 2: the file must sit directly in the forms directory.
  if (path.dirname(resolved) !== formsDir) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let pdf: Buffer;

  try {
    pdf = await readFile(resolved);
  } catch {
    return NextResponse.json(
      { error: 'Official document not found on disk.' },
      { status: 404 },
    );
  }

  /*
   * The name the applicant sees, from the manifest — never the canonical
   * storage name. `Texas-H1049-Bilingual.pdf`, not
   * `TX-H1049-BI-2001-12.pdf`.
   */
  const filename = officialDownloadName(entry);

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${
        download ? 'attachment' : 'inline'
      }; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      /*
       * A blank government form carries no applicant data, so unlike the draft
       * this may be cached — but privately, since the URL is scoped to a run.
       */
      'Cache-Control': 'private, max-age=3600',
      'X-Correlation-Id': runId,
    },
  });
}
