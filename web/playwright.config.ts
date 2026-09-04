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
      testIgnore: /(saws2-application|austin-demo|saws2-spanish-flow|tx-h1010-application)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000' },
    },
    /*
     * The application flows need the in-process E2E_MODE fixture.
     *
     * `mock-kvr` on the default server produces static Texas phase documents
     * with no structured application output, which the report specs assert on.
     * The E2E_MODE fixture runs the real jurisdiction resolution, program
     * registry and screening, so it is the only one that emits a form
     * recommendation — for California *or* Texas, depending on the ZIP typed.
     * The two fixtures cannot run on the same server, so this project gets its
     * own, and every spec that needs an application recommendation lives here.
     *
     * `saws2-spanish-flow` was in the default project and could never pass
     * there: it waits for the `saws-recommendation` section, which only renders
     * when the report carries a form recommendation, and `mock-kvr` emits no
     * structured output at all. The spec was silently red rather than
     * protecting the Spanish eligibility analysis it was written for.
     */
    {
      name: 'applications',
      testMatch: /(saws2-application|austin-demo|saws2-spanish-flow|tx-h1010-application)\.spec\.ts/,
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
