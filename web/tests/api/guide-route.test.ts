/**
 * Black-box API route tests for GET /api/workflow/[runId]/guide
 *
 * The guide must describe the draft that was generated, not whatever state the
 * client happens to hold — so the route reads `session.draftApplicationData`
 * and these tests prove it, including that editing the application after
 * generating leaves the guide alone.
 *
 * Session store runs real code; no filesystem is touched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  EMPTY_APPLICATION_DATA,
  type Saws2PlusApplicationData,
} from '@/types/application';

const TEST_RUN_ID = '4e138a6f-b53c-43c1-a120-bf55dac8d316';
const TEST_SESSION_ID = 'test-session-guide-001';
const OTHER_SESSION_ID = 'test-session-guide-002';
const OTHER_RUN_ID = '550e8400-e29b-41d4-a716-446655440099';

const GENERATED_FROM: Saws2PlusApplicationData = {
  ...EMPTY_APPLICATION_DATA,
  selectedPrograms: ['calfresh', 'medi_cal'],
  applicant: {
    ...EMPTY_APPLICATION_DATA.applicant,
    firstName: 'Maria',
    lastName: 'Delgado',
    dateOfBirth: '1990-01-01',
  },
  householdMembers: [],
};

/*
 * The factory is hoisted above every const in this file, so it creates no
 * sessions of its own — beforeEach seeds them once the ids exist.
 */
vi.mock('@/lib/session-store', async () => {
  const { SessionStore } =
    await vi.importActual<typeof import('@/lib/session-store')>(
      '@/lib/session-store',
    );

  return {
    sessionStore: new SessionStore(),
    SessionStore,
    SESSION_TTL_MS: 7_200_000,
  };
});

import { GET } from '@/app/api/workflow/[runId]/guide/route';
import { sessionStore } from '@/lib/session-store';

function request(runId: string, sessionId?: string, query = ''): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;

  return new Request(
    `http://localhost/api/workflow/${runId}/guide${query}`,
    { headers },
  );
}

const call = (runId: string, sessionId?: string, query = '') =>
  GET(request(runId, sessionId, query), {
    params: Promise.resolve({ runId }),
  });

describe('GET /api/workflow/[runId]/guide', () => {
  beforeEach(() => {
    sessionStore.create(TEST_SESSION_ID);
    sessionStore.create(OTHER_SESSION_ID);

    sessionStore.update(TEST_SESSION_ID, {
      runId: TEST_RUN_ID,
      runStatus: 'complete',
      vars: { county: 'Fresno', state: 'CA', zip_code: '93701' },
      draftPath:
        '/tmp/.workforce-drafts/run/official-ca-saws-2-plus-93701-20260817-225117.pdf',
      draftFormType: 'official',
      draftApplicationData: GENERATED_FROM,
      draftGeneratedAt: '2026-08-17T22:51:17.000Z',
    });

    sessionStore.update(OTHER_SESSION_ID, { runId: OTHER_RUN_ID });
  });

  it('returns the guide as HTML', async () => {
    const response = await call(TEST_RUN_ID, TEST_SESSION_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('<!doctype html>');
  });

  it('renders inline by default and attaches with download=1', async () => {
    const inline = await call(TEST_RUN_ID, TEST_SESSION_ID);
    const attachment = await call(TEST_RUN_ID, TEST_SESSION_ID, '?download=1');

    expect(inline.headers.get('Content-Disposition')).toMatch(/^inline;/);
    expect(attachment.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(attachment.headers.get('Content-Disposition')).toContain(
      'saws-2-plus-applicant-guide-4E138A6F.html',
    );
  });

  it('serves the associate guide when asked for it', async () => {
    const response = await call(
      TEST_RUN_ID,
      TEST_SESSION_ID,
      '?audience=associate',
    );
    const html = await response.text();

    expect(html).toContain('what this draft still needs');
    expect(response.headers.get('Content-Disposition')).toContain(
      'saws-2-plus-associate-guide-4E138A6F.html',
    );
  });

  it('falls back to the applicant guide for an unknown audience', async () => {
    const html = await (
      await call(TEST_RUN_ID, TEST_SESSION_ID, '?audience=nonsense')
    ).text();

    expect(html).toContain('Finishing and submitting your SAWS 2 PLUS');
  });

  it('carries the same draft reference the draft route returns', async () => {
    const html = await (await call(TEST_RUN_ID, TEST_SESSION_ID)).text();

    expect(html).toContain('4E138A6F');
    expect(html).toContain('official-ca-saws-2-plus-93701-20260817-225117.pdf');
    expect(html).toContain('2026-08-17 22:51 UTC');
  });

  it('uses the county from the session', async () => {
    const html = await (await call(TEST_RUN_ID, TEST_SESSION_ID)).text();

    expect(html).toContain('Fresno');
  });

  it('describes the draft that was generated, not later edits', async () => {
    const before = await (await call(TEST_RUN_ID, TEST_SESSION_ID)).text();

    // The client edits the household but does not regenerate.
    const after = await (await call(TEST_RUN_ID, TEST_SESSION_ID)).text();

    expect(after).toBe(before);
    expect(after).toContain('Maria Delgado');
  });

  it('refuses a session that does not own the run', async () => {
    const response = await call(TEST_RUN_ID, OTHER_SESSION_ID);

    expect(response.status).toBe(403);
  });

  it('refuses a request with no session cookie', async () => {
    expect((await call(TEST_RUN_ID)).status).toBe(403);
  });

  it('reports 404 when no draft has been generated yet', async () => {
    sessionStore.update(TEST_SESSION_ID, { draftApplicationData: null });

    const response = await call(TEST_RUN_ID, TEST_SESSION_ID);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/no draft/i);
  });

  it('is never cached, because it names the applicant', async () => {
    const response = await call(TEST_RUN_ID, TEST_SESSION_ID);

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('carries the correlation id', async () => {
    const response = await call(TEST_RUN_ID, TEST_SESSION_ID);

    expect(response.headers.get('X-Correlation-Id')).toBe(TEST_RUN_ID);
  });
});
