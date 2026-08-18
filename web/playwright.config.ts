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
      testIgnore: /saws2-application\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000' },
    },
    /*
     * The SAWS 2 PLUS flow needs the other workflow fixture.
     *
     * `mock-kvr` produces a Texas household, which the report specs assert on,
     * and emits no CA_SAWS_2_PLUS recommendation — so the application is never
     * offered. The in-process E2E_MODE fixture is California-oriented and does
     * emit one. The two cannot run on the same server, so this project gets
     * its own.
     */
    {
      name: 'saws2',
      testMatch: /saws2-application\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3101' },
    },
  ],
  webServer: [
    {
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
         * symlink is the part that matters: kvr-checker resolves the binary
         * with `which kvr`, so a fixture named only `mock-kvr` was never found.
         * The suite silently fell through to the real binary — or to none — and
         * the app rendered "Workflow engine offline", which is why no run could
         * be started.
         */
        PATH: `${process.cwd()}/tests/e2e/fixtures:${process.env.PATH}`,
        NODE_ENV: 'test',
      },
    },
    {
      // The SAWS 2 PLUS server; see the `saws2` project above.
      command: 'npx next dev -p 3101',
      url: 'http://localhost:3101',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        E2E_MODE: '1',
        // No point animating the progress bar for a machine.
        E2E_PHASE_DELAY_MS: '0',
        NODE_ENV: 'test',
        // Its own build directory; sharing one with the other dev server makes
        // both hang serving half-built routes.
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
});
