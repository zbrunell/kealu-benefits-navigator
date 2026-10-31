//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * POST an application to the draft route, and read what comes back.
 *
 * Shared by the California and Texas views, which each used to call `fetch`
 * and `response.json()` directly. Two failures escaped that as raw browser
 * text on the applicant's screen:
 *
 * - The server could not be reached — it was stopped, restarting, or the
 *   connection dropped. `fetch` rejects with a TypeError whose message is the
 *   browser's own ("Failed to fetch" in Chrome, "Load failed" in Safari).
 * - The server answered with something other than JSON, such as a proxy's
 *   HTML error page. `response.json()` rejects with "Unexpected token '<'".
 *
 * Both now become a {@link DraftRequestError} carrying a message key, so the
 * view shows a sentence in the applicant's language instead.
 */

import type { Messages } from '@/i18n';

/** The draft route's JSON body, for success and for its error responses. */
export interface DraftResponseBody {
  draftUrl?: string;
  guideUrl?: string;
  draftReference?: string;
  packet?: unknown;
  error?: string;
  errorKey?: string;
  fieldProblems?: Array<{ field: string; messageKey: string }>;
}

/** A draft request that failed before the route's own answer could be read. */
export class DraftRequestError extends Error {
  constructor(
    readonly messageKey: keyof Messages,
    options?: { cause?: unknown },
  ) {
    super(messageKey, options);
    this.name = 'DraftRequestError';
  }
}

export async function requestDraft(
  runId: string,
  applicationData: unknown,
): Promise<{ response: Response; result: DraftResponseBody }> {
  let response: Response;

  try {
    response = await fetch(`/api/workflow/${runId}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationData }),
    });
  } catch (cause) {
    throw new DraftRequestError('av_draft_unreachable', { cause });
  }

  try {
    return { response, result: (await response.json()) as DraftResponseBody };
  } catch (cause) {
    throw new DraftRequestError('av_draft_failed', { cause });
  }
}
