//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionStore, SESSION_TTL_MS } from '@/lib/session-store';
import {
  parseIntakeAnswer,
  isTier1Complete,
  getNextQuestion,
  isIdempotentSubmission,
  buildAnswers,
  getFieldStep,
  ALL_FIELDS,
  TOTAL_STEPS,
} from '@/lib/intake-flow';
import type { IntakeFieldKey } from '@/lib/intake-flow';
import type { Session } from '@/types/session';
import { randomUUID } from 'crypto';

const COOKIE_NAME = 'session';
const COOKIE_MAX_AGE_SEC = SESSION_TTL_MS / 1000;

/** Resolve the session id from the request cookie (raw header or cookie store). */
async function resolveCookieValue(req: Request): Promise<string | undefined> {
  const cookieStore = await cookies();
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  return sessionCookieMatch?.[1] ?? cookieStore.get(COOKIE_NAME)?.value;
}

/**
 * Serialize the next question + step counter for a session, recording the pending
 * field key so the next free-text answer can be stored by key.
 *
 * `includeAnswers` is false for the conversational message flow so that collected
 * PII (income, medications, …) is never echoed in the question/ready response —
 * the answers snapshot is delivered only via GET and the explicit edit action,
 * which return the user's own data back to their own session.
 */
function serialize(session: Session, includeAnswers: boolean, error?: string): object {
  const nextField = getNextQuestion(session.vars, session.currentTier, session.skipIntake);
  // Persist which field we're now waiting on (drives raw-answer storage for Tier 2).
  sessionStore.update(session.sessionId, { pendingField: nextField?.key });

  const base =
    nextField === null
      ? { type: 'ready' as const }
      : {
          type: 'question' as const,
          field: {
            key: nextField.key,
            label: nextField.label,
            rationale: nextField.rationale,
            prompt: nextField.prompt,
            tier: nextField.tier,
            inputMode: nextField.inputMode,
            placeholder: nextField.placeholder,
          },
          step: { current: getFieldStep(nextField.key), total: TOTAL_STEPS },
        };

  const response = error ? { ...base, error } : base;
  return includeAnswers ? { ...response, answers: buildAnswers(session.vars) } : response;
}

/**
 * GET /api/intake
 * Returns the answers collected so far for the current session plus the next
 * question and step counter. Used by the client to populate the editable
 * "Your answers" panel (including after a page reload / resumed session).
 *
 * Answers are returned ONLY to the owning session — this is the user's own
 * typed data, surfaced back to them for review/edit.
 */
export async function GET(req: Request): Promise<Response> {
  const cookieValue = await resolveCookieValue(req);
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  if (!session) {
    return NextResponse.json({ answers: [], next: null, step: null });
  }

  const nextField = getNextQuestion(session.vars, session.currentTier, session.skipIntake);

  sessionStore.update(session.sessionId, {
    pendingField: nextField?.key,
  });

  return NextResponse.json({
    answers: buildAnswers(session.vars),
    next: nextField
      ? {
          key: nextField.key,
          label: nextField.label,
          rationale: nextField.rationale,
          prompt: nextField.prompt,
          tier: nextField.tier,
          inputMode: nextField.inputMode,
          placeholder: nextField.placeholder,
        }
      : null,
    step: nextField ? { current: getFieldStep(nextField.key), total: TOTAL_STEPS } : null,
  });
}

/**
 * POST /api/intake
 *
 * Two modes:
 * - `{ message }` — a free-text answer to the current question. Extracts/stores
 *   structured vars and returns the next question or `{ type: 'ready' }`.
 * - `{ edit: { key, value } }` — correct a previously-answered field directly.
 *   Stores the value (re-normalizing ZIP/income), recomputes tier completeness,
 *   and returns the refreshed answers + next question.
 *
 * Response always includes `answers` (this session's own data) and, for
 * questions, a `step` counter. PII vars are never returned to other sessions.
 */
export async function POST(req: Request): Promise<Response> {
  const cookieStore = await cookies();
  const cookieValue = await resolveCookieValue(req);

  let session = cookieValue ? sessionStore.get(cookieValue) : null;
  let newSessionId: string | undefined;

  if (!session) {
    newSessionId = randomUUID();
    session = sessionStore.create(newSessionId);
    cookieStore.set(COOKIE_NAME, newSessionId, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE_SEC,
      path: '/',
    });
  }

  const sessionId = session.sessionId;

  // Parse request body — either a message or an edit instruction.
  let message = '';
  let edit: { key?: string; value?: string } | undefined;
  try {
    const body = (await req.json()) as {
      message?: string;
      edit?: { key?: string; value?: string };
    };
    message = String(body.message ?? '').trim();
    edit = body.edit;
  } catch {
    // Empty or malformed body — treat as empty message
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  // Correct an existing answer without appending to the chat history.
  if (edit && typeof edit.key === 'string' && ALL_FIELDS.some((f) => f.key === edit!.key)) {
    const key = edit.key as IntakeFieldKey;
    const value = String(edit.value ?? '').trim();
    const newVars = { ...session.vars } as Record<string, string | undefined>;

    if (value === '') {
      delete newVars[key];
    } else {
      const parsed = parseIntakeAnswer(key, value);
      if (parsed.error || parsed.value === undefined) {
        return withCookie(
          NextResponse.json(
            {
              ...serialize(session, true, parsed.error ?? 'Please enter a valid answer.'),
              editedField: key,
            },
            { status: 422 },
          ),
          newSessionId,
        );
      }
      newVars[key] = parsed.value;
    }

    // Recompute tier reachability: clearing a required field drops back to Tier 1.
    const currentTier = isTier1Complete(newVars) ? Math.max(session.currentTier, 2) : 1;
    sessionStore.update(sessionId, { vars: newVars, currentTier });
    session = sessionStore.get(sessionId)!;

    // Edit is an explicit "review my data" action — return the refreshed snapshot.
    return withCookie(NextResponse.json(serialize(session, true)), newSessionId);
  }

  // ── Message mode ──────────────────────────────────────────────────────────
  if (!message) {
    return withCookie(
      NextResponse.json(serialize(session, false, 'Please enter an answer.'), { status: 422 }),
      newSessionId,
    );
  }
  // Idempotency: identical message re-POST (e.g., browser back button) is a no-op
  // so that history does not accumulate duplicate entries.
  if (!isIdempotentSubmission(session.messages, message)) {
    sessionStore.update(sessionId, {
      messages: [
        ...session.messages,
        { role: 'user', content: message, timestamp: Date.now() },
      ],
    });
    session = sessionStore.get(sessionId)!;

    if (message.toLowerCase() === 'skip') {
      // Skip signal: exact "skip" string only (sent by the "Skip remaining" button).
      sessionStore.update(sessionId, { skipIntake: true });
      session = sessionStore.get(sessionId)!;
    } else {
      const pending = session.pendingField as IntakeFieldKey | undefined;

      if (!pending) {
        return withCookie(
          NextResponse.json(serialize(session, false, 'There is no question waiting for an answer. Please refresh and try again.'), {
            status: 409,
          }),
          newSessionId,
        );
      }

      const parsed = parseIntakeAnswer(pending, message);
      if (parsed.error || parsed.value === undefined) {
        return withCookie(
          NextResponse.json(
            serialize(session, false, parsed.error ?? 'Please enter a valid answer.'),
            { status: 422 },
          ),
          newSessionId,
        );
      }

      const updatedVars = {
        ...session.vars,
        [pending]: parsed.value,
      };
      sessionStore.update(sessionId, { vars: updatedVars });
      session = sessionStore.get(sessionId)!;

      // Advance to Tier 2 once all Tier 1 fields are present so the optional
      // questions become reachable (getNextQuestion gates Tier 2 on currentTier).
      if (isTier1Complete(session.vars) && session.currentTier < 2) {
        sessionStore.update(sessionId, { currentTier: 2 });
        session = sessionStore.get(sessionId)!;
      }
    }
  }

  if (!message) {
    return withCookie(
      NextResponse.json(serialize(session, false, 'Please enter an answer.'), { status: 422 }),
      newSessionId,
    );
  }

  // Conversational flow — no PII echoed (answers fetched separately via GET).
  return withCookie(NextResponse.json(serialize(session, false)), newSessionId);
}

/** Attach the Set-Cookie header for a freshly-created session. */
function withCookie(res: NextResponse, newSessionId?: string): NextResponse {
  if (newSessionId) {
    res.headers.set(
      'Set-Cookie',
      `${COOKIE_NAME}=${newSessionId}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SEC}; Path=/`,
    );
  }
  return res;
}
