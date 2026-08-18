import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    /*
     * Pin the browser locale. The app detects its language from
     * navigator.language, and the accessible names the suite addresses controls
     * by come from the message catalogue — so an en-US machine and an es-MX
     * machine would otherwise run different tests. The language-switcher spec
     * asserts the translated names explicitly instead.
     */
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      /*
       * Put the fixture directory first on PATH so the app resolves the
       * deterministic `kvr` fixture instead of whatever the developer has
       * installed.
       *
       * The directory holds `mock-kvr` plus a `kvr` symlink to it, and the
       * symlink is the part that matters: kvr-checker resolves the binary with
       * `which kvr`, so a fixture named only `mock-kvr` was never found. The
       * suite silently fell through to the real binary — or to none — and the
       * app rendered "Workflow engine offline", which is why no run could be
       * started.
       */
      PATH: `${process.cwd()}/tests/e2e/fixtures:${process.env.PATH}`,
      NODE_ENV: 'test',
    },
  },
});
