import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { sessionStore } from '@/lib/session-store';

export async function POST(): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 },
    );
  }

  const sessionId = randomUUID();
  const runId = `mock-${randomUUID()}`;

  sessionStore.create(sessionId);

  sessionStore.update(sessionId, {
    runId,
    runStatus: 'complete',

    vars: {
      state: 'CA',
      county: 'Los Angeles',
      zip_code: '90001',
      annual_income: '42000',
      income_type: 'employed',
      existing_benefits: 'none',
      household_profile: 'Mock California household',
    },

    reportContent: {
      mock: true,
      status: 'complete',
    },
  });

  const response = NextResponse.json({
    runId,
  });

  response.cookies.set('session', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  return response;
}