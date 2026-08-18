//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              /*
               * Next.js's dev bundler compiles modules with eval(), so a dev
               * build without 'unsafe-eval' serves a page whose client
               * JavaScript never runs: no hydration, no event handlers, no
               * effects. The page still renders — it is server-rendered — which
               * is what made this hard to see.
               *
               * The condition is on production rather than on development
               * because the intent is "lock down production", and every other
               * NODE_ENV is a build that needs eval. Enumerating 'development'
               * meant NODE_ENV=test — which the Playwright harness sets — got
               * the production CSP against a dev bundle, and silently broke
               * every browser test in the suite.
               */
              "script-src 'self' 'unsafe-inline'" +
                (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"),
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self'",
              "font-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
