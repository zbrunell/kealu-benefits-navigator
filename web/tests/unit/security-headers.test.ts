//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The Content-Security-Policy must lock down production without breaking dev.
 *
 * This is a regression test for a failure that was invisible from the outside:
 * a dev build served without 'unsafe-eval' still renders, because the markup is
 * server-rendered, but none of its client JavaScript ever runs. No hydration,
 * no event handlers, no effects. The page looks right and does nothing.
 *
 * That is what the whole Playwright suite was hitting — the harness sets
 * NODE_ENV=test, the policy enumerated 'development', and so a dev bundle was
 * served the production CSP.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

interface HeaderEntry {
  key: string;
  value: string;
}

async function loadHeaders(): Promise<HeaderEntry[]> {
  vi.resetModules();

  const { default: config } = await import('../../next.config');
  const groups = await config.headers!();

  return groups[0].headers as HeaderEntry[];
}

/**
 * The CSP next.config.ts produces for a given NODE_ENV.
 *
 * The config reads process.env when headers() runs, so the module is reloaded
 * per case rather than cached with whatever the test runner started under.
 */
async function cspFor(nodeEnv: string | undefined): Promise<string> {
  const env = process.env as Record<string, string | undefined>;
  const original = env.NODE_ENV;

  try {
    env.NODE_ENV = nodeEnv;

    const headers = await loadHeaders();

    return headers.find((h) => h.key === 'Content-Security-Policy')!.value;
  } finally {
    env.NODE_ENV = original;
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('Content-Security-Policy', () => {
  it('withholds unsafe-eval in production', async () => {
    expect(await cspFor('production')).not.toContain("'unsafe-eval'");
  });

  it('allows unsafe-eval in development, which the dev bundler needs', async () => {
    expect(await cspFor('development')).toContain("'unsafe-eval'");
  });

  it('allows unsafe-eval under any non-production NODE_ENV', async () => {
    /*
     * The bug this guards: the harness runs `next dev` with NODE_ENV=test, so a
     * policy keyed on 'development' handed a dev bundle the production CSP and
     * broke every browser test in the suite.
     */
    for (const env of ['test', 'staging', undefined]) {
      expect(await cspFor(env), String(env)).toContain("'unsafe-eval'");
    }
  });

  it('keeps the rest of the policy locked down in every environment', async () => {
    for (const env of ['production', 'development', 'test']) {
      const csp = await cspFor(env);

      expect(csp, env).toContain("default-src 'self'");
      expect(csp, env).toContain("object-src 'none'");
      expect(csp, env).toContain("frame-ancestors 'none'");
      expect(csp, env).toContain("base-uri 'self'");
      expect(csp, env).toContain("connect-src 'self'");
    }
  });

  it('still sets the other hardening headers', async () => {
    const byKey = Object.fromEntries(
      (await loadHeaders()).map((h) => [h.key, h.value]),
    );

    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });
});
