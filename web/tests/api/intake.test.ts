/**
 * Black-box API route tests for POST /api/intake.
 *
 * Real session-store and intake-flow logic run; only next/headers is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/intake/route';
import { sessionStore } from '@/lib/session-store';
import { __clearLocationCache } from '@/lib/location';
import { ALL_FIELDS } from '@/lib/intake-flow';

let sessionCookies: Record<string, string> = {};
let setCookieCalls: Array<{ name: string; value: string; opts?: unknown }> = [];

/**
 * The CMS county lookup is mocked so ZIP-derived location is hermetic: no
 * network access, and the fallback path is exercised deterministically.
 */
const mockGetCountiesByZip = vi.fn();

vi.mock('@/lib/cms-marketplace', () => ({
  getCountiesByZip: (zip: string) => mockGetCountiesByZip(zip),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) =>
        sessionCookies[name]
          ? { name, value: sessionCookies[name] }
          : undefined,
      set: vi.fn((name: string, value: string, opts?: unknown) => {
        sessionCookies[name] = value;
        setCookieCalls.push({ name, value, opts });
      }),
      delete: vi.fn(),
      has: (name: string) => name in sessionCookies,
    }),
  ),
}));

function makeIntakeRequest(message: string, sessionId?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sessionId) headers.Cookie = `session=${sessionId}`;

  return new Request('http://localhost/api/intake', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message }),
  });
}

function makeEditRequest(
  key: string,
  value: string,
  sessionId?: string,
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sessionId) headers.Cookie = `session=${sessionId}`;

  return new Request('http://localhost/api/intake', {
    method: 'POST',
    headers,
    body: JSON.stringify({ edit: { key, value } }),
  });
}

function makeGetRequest(sessionId?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers.Cookie = `session=${sessionId}`;

  return new Request('http://localhost/api/intake', {
    method: 'GET',
    headers,
  });
}

async function completeTier1(): Promise<string> {
  const zipResponse = await POST(makeIntakeRequest('77001'));
  expect(zipResponse.status).toBe(200);

  const sessionId = sessionCookies.session;
  expect(sessionId).toBeTruthy();

  const incomeResponse = await POST(
    makeIntakeRequest('42000', sessionId),
  );
  expect(incomeResponse.status).toBe(200);

  const householdResponse = await POST(
    makeIntakeRequest(
      'One adult and two children, ages 4 and 9',
      sessionId,
    ),
  );
  expect(householdResponse.status).toBe(200);

  return sessionId;
}

describe('POST /api/intake', () => {
  beforeEach(() => {
    sessionCookies = {};
    setCookieCalls = [];
  });

  it('creates a new session when the cookie is absent', async () => {
    const response = await POST(makeIntakeRequest('77001'));

    expect(response.status).toBe(200);
    expect(
      setCookieCalls.some((cookie) => cookie.name === 'session'),
    ).toBe(true);
  });

  it('creates a session but rejects an invalid first answer', async () => {
    const response = await POST(makeIntakeRequest('Hello'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.type).toBe('question');
    expect(body.field.key).toBe('zip_code');
    // A key, not a sentence: the route has no locale, so the client translates.
    expect(body.errorKey).toBe('intake_error_zip');
    expect(
      setCookieCalls.some((cookie) => cookie.name === 'session'),
    ).toBe(true);
  });

  it('accepts a valid ZIP and advances to annual income', async () => {
    const response = await POST(makeIntakeRequest('77001'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.type).toBe('question');
    expect(body.field.key).toBe('annual_income');
    expect(body.step).toEqual({ current: 2, total: 8 });
  });

  it('returns ready after all eight intake questions are answered', async () => {
    await POST(makeIntakeRequest('77001'));
    const sessionId = sessionCookies.session;

    await POST(makeIntakeRequest('42000', sessionId));
    await POST(
      makeIntakeRequest(
        'One adult and two children, ages 4 and 9',
        sessionId,
      ),
    );
    await POST(makeIntakeRequest('No', sessionId));
    await POST(makeIntakeRequest('None', sessionId));
    await POST(makeIntakeRequest('None', sessionId));
    await POST(makeIntakeRequest('As low as possible', sessionId));

    const response = await POST(makeIntakeRequest('No', sessionId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.type).toBe('ready');
  });

  it('skip returns ready after Tier 1 is complete', async () => {
    const sessionId = await completeTier1();

    const response = await POST(makeIntakeRequest('skip', sessionId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.type).toBe('ready');
  });

  it('is idempotent when the same message is posted twice', async () => {
    const first = await POST(makeIntakeRequest('77001'));
    expect(first.status).toBe(200);

    const sessionId = sessionCookies.session;
    const second = await POST(makeIntakeRequest('77001', sessionId));

    expect(second.status).toBe(200);
  });

  it('does not echo annual income in a conversational response', async () => {
    await POST(makeIntakeRequest('77001'));
    const sessionId = sessionCookies.session;

    const response = await POST(makeIntakeRequest('42000', sessionId));
    const bodyString = JSON.stringify(await response.json());

    expect(bodyString).not.toContain('42000');
    expect(bodyString).not.toContain('42,000');
  });

  it('does not echo medications in a conversational response', async () => {
    const sessionId = await completeTier1();
    await POST(makeIntakeRequest('No', sessionId));

    const response = await POST(
      makeIntakeRequest('Metformin 500mg twice daily', sessionId),
    );
    const bodyString = JSON.stringify(await response.json());

    expect(bodyString).not.toContain('Metformin');
  });

  it('returns a structured validation response for an invalid answer', async () => {
    const response = await POST(makeIntakeRequest('Hello'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.type).toBe('question');
    expect(body.field).toBeDefined();
    expect(typeof body.field.key).toBe('string');
    expect(typeof body.field.promptKey).toBe('string');
    expect(typeof body.errorKey).toBe('string');
  });
});

describe('intake progress, answers, edit, and resume', () => {
  beforeEach(() => {
    sessionCookies = {};
    setCookieCalls = [];
  });

  it('reports the correct step after each accepted answer', async () => {
    const firstResponse = await POST(makeIntakeRequest('77001'));
    const firstBody = await firstResponse.json();

    expect(firstBody.field.key).toBe('annual_income');
    expect(firstBody.step).toEqual({ current: 2, total: 8 });

    const sessionId = sessionCookies.session;
    const secondResponse = await POST(
      makeIntakeRequest('42000', sessionId),
    );
    const secondBody = await secondResponse.json();

    expect(secondBody.field.key).toBe('household_profile');
    expect(secondBody.step).toEqual({ current: 3, total: 8 });
  });

  it('advances into Tier 2 after all Tier 1 fields are answered', async () => {
    const sessionId = await completeTier1();
    const snapshot = await (
      await GET(makeGetRequest(sessionId))
    ).json();

    expect(snapshot.next).not.toBeNull();
    expect(snapshot.next.tier).toBe(2);
    expect(snapshot.next.key).toBe('current_coverage');
    expect(snapshot.step).toEqual({ current: 4, total: 8 });
  });

  it('continues through all eight fields', async () => {
    const sessionId = await completeTier1();

    const response = await POST(
      makeIntakeRequest('I have employer coverage', sessionId),
    );
    const body = await response.json();

    expect(body.type).toBe('question');
    expect(body.field.tier).toBe(2);
    expect(body.field.key).toBe('medications');
    expect(body.step).toEqual({ current: 5, total: 8 });
  });

  it('GET returns answers, the next question, and progress', async () => {
    const sessionId = await completeTier1();
    const snapshot = await (
      await GET(makeGetRequest(sessionId))
    ).json();

    expect(
      snapshot.answers.map((answer: { key: string }) => answer.key),
    ).toEqual(['zip_code', 'annual_income', 'household_profile']);

    expect(
      snapshot.answers.find(
        (answer: { key: string }) => answer.key === 'zip_code',
      ),
    ).toMatchObject({
      key: 'zip_code',
      labelKey: 'intake_zip_code_label',
      value: '77001',
      tier: 1,
    });

    expect(
      snapshot.answers.find(
        (answer: { key: string }) => answer.key === 'annual_income',
      ).value,
    ).toBe('42000');
  });

  it('GET without a session returns an empty snapshot', async () => {
    const snapshot = await (await GET(makeGetRequest())).json();

    expect(snapshot).toEqual({ answers: [], next: null, step: null });
  });

  it('edits ZIP and persists the new value', async () => {
    const sessionId = await completeTier1();

    const edited = await (
      await POST(makeEditRequest('zip_code', '90210', sessionId))
    ).json();

    expect(
      edited.answers.find(
        (answer: { key: string }) => answer.key === 'zip_code',
      ).value,
    ).toBe('90210');

    const snapshot = await (
      await GET(makeGetRequest(sessionId))
    ).json();
    expect(
      snapshot.answers.find(
        (answer: { key: string }) => answer.key === 'zip_code',
      ).value,
    ).toBe('90210');
  });

  it('normalizes yearly income on edit', async () => {
    const sessionId = await completeTier1();

    const edited = await (
      await POST(
        makeEditRequest('annual_income', '$42,000', sessionId),
      )
    ).json();

    expect(
      edited.answers.find(
        (answer: { key: string }) => answer.key === 'annual_income',
      ).value,
    ).toBe('42000');
  });

  it('rejects monthly income when editing annual income', async () => {
    const sessionId = await completeTier1();

    const response = await POST(
      makeEditRequest('annual_income', '$3,000/month', sessionId),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.errorKey).toBe('intake_error_income_not_a_number');
  });

  it('stores a Tier 2 edit verbatim', async () => {
    const sessionId = await completeTier1();

    const edited = await (
      await POST(
        makeEditRequest(
          'medications',
          'Lisinopril 10mg daily',
          sessionId,
        ),
      )
    ).json();

    expect(
      edited.answers.find(
        (answer: { key: string }) => answer.key === 'medications',
      ).value,
    ).toBe('Lisinopril 10mg daily');
  });

  it('returns PII only through the owning session snapshot', async () => {
    const sessionId = await completeTier1();

    const snapshotBody = JSON.stringify(
      await (await GET(makeGetRequest(sessionId))).json(),
    );
    expect(snapshotBody).toContain('42000');

    const messageBody = JSON.stringify(
      await (
        await POST(
          makeIntakeRequest('I have employer coverage', sessionId),
        )
      ).json(),
    );
    expect(messageBody).not.toContain('42000');
    expect(messageBody).not.toContain('77001');
  });

  it('restores progress and pending-field behavior after reload', async () => {
    const sessionId = await completeTier1();
    await POST(
      makeIntakeRequest('I have employer coverage', sessionId),
    );

    const snapshot = await (
      await GET(makeGetRequest(sessionId))
    ).json();

    expect(
      snapshot.answers.map((answer: { key: string }) => answer.key),
    ).toEqual([
      'zip_code',
      'annual_income',
      'household_profile',
      'current_coverage',
    ]);
    expect(snapshot.next.key).toBe('medications');
    expect(snapshot.step).toEqual({ current: 5, total: 8 });

    await POST(
      makeIntakeRequest('Metformin 500mg twice daily', sessionId),
    );
    const after = await (
      await GET(makeGetRequest(sessionId))
    ).json();

    expect(
      after.answers.find(
        (answer: { key: string }) => answer.key === 'medications',
      ).value,
    ).toBe('Metformin 500mg twice daily');
    expect(after.step).toEqual({ current: 6, total: 8 });
  });
});

// ---------------------------------------------------------------------------
// ZIP-derived location
// ---------------------------------------------------------------------------

describe('location derived from the ZIP code', () => {
  beforeEach(() => {
    sessionCookies = {};
    setCookieCalls = [];
    mockGetCountiesByZip.mockReset();
    mockGetCountiesByZip.mockRejectedValue(new Error('CMS unavailable in tests'));
    __clearLocationCache();
  });

  function varsFor(sessionId: string) {
    return sessionStore.get(sessionId)?.vars ?? {};
  }

  it('never asks the user for city, state, or county', () => {
    const askedKeys = ALL_FIELDS.map((field) => field.key as string);

    expect(askedKeys).not.toContain('city');
    expect(askedKeys).not.toContain('state');
    expect(askedKeys).not.toContain('county');
  });

  it('derives city, state, and county from an accepted ZIP answer', async () => {
    const response = await POST(makeIntakeRequest('90001'));
    expect(response.status).toBe(200);

    const vars = varsFor(sessionCookies.session);

    expect(vars.zip_code).toBe('90001');
    expect(vars.city).toBe('Los Angeles');
    expect(vars.state).toBe('CA');
    expect(vars.county).toBe('Los Angeles');
  });

  it('stores the derived location in the same session vars used downstream', async () => {
    await POST(makeIntakeRequest('94102'));
    const sessionId = sessionCookies.session;

    await POST(makeIntakeRequest('26000', sessionId));
    await POST(
      makeIntakeRequest('Single parent with 2 kids ages 4 and 9', sessionId),
    );

    // Still present after later answers overwrite other vars.
    const vars = varsFor(sessionId);
    expect(vars.city).toBe('San Francisco');
    expect(vars.county).toBe('San Francisco');
    expect(vars.state).toBe('CA');
  });

  it('re-derives the location when the ZIP is corrected', async () => {
    await POST(makeIntakeRequest('90001'));
    const sessionId = sessionCookies.session;
    expect(varsFor(sessionId).county).toBe('Los Angeles');

    const response = await POST(makeEditRequest('zip_code', '95814', sessionId));
    expect(response.status).toBe(200);

    const vars = varsFor(sessionId);
    expect(vars.zip_code).toBe('95814');
    expect(vars.city).toBe('Sacramento');
    expect(vars.county).toBe('Sacramento');
  });

  it('clears the derived location when the ZIP is cleared', async () => {
    await POST(makeIntakeRequest('90001'));
    const sessionId = sessionCookies.session;

    await POST(makeEditRequest('zip_code', '', sessionId));

    const vars = varsFor(sessionId);
    expect(vars.zip_code).toBeUndefined();
    expect(vars.city).toBe('');
    expect(vars.state).toBe('');
    expect(vars.county).toBe('');
  });

  it('leaves the location blank when the ZIP cannot be resolved', async () => {
    await POST(makeIntakeRequest('00000'));
    const sessionId = sessionCookies.session;

    const vars = varsFor(sessionId);
    expect(vars.zip_code).toBe('00000');
    expect(vars.city).toBe('');
    expect(vars.state).toBe('');
    expect(vars.county).toBe('');
  });

  it('resolves state without a county guess for a ZIP outside the exact table', async () => {
    await POST(makeIntakeRequest('77001'));
    const sessionId = sessionCookies.session;

    const vars = varsFor(sessionId);
    expect(vars.state).toBe('TX');
    expect(vars.county).toBe('');
    expect(vars.city).toBe('');
  });

  it('uses the CMS county when the ZIP is not in the exact table', async () => {
    mockGetCountiesByZip.mockReset();
    mockGetCountiesByZip.mockResolvedValue([
      { fips: '06107', name: 'Tulare County', state: 'CA' },
    ]);

    await POST(makeIntakeRequest('93247'));
    const sessionId = sessionCookies.session;

    const vars = varsFor(sessionId);
    expect(vars.state).toBe('CA');
    expect(vars.county).toBe('Tulare');
  });

  it('does not surface derived location as an intake answer', async () => {
    await POST(makeIntakeRequest('90001'));
    const sessionId = sessionCookies.session;

    const snapshot = await (await GET(makeGetRequest(sessionId))).json();
    const keys = snapshot.answers.map((answer: { key: string }) => answer.key);

    expect(keys).toEqual(['zip_code']);
  });
});
