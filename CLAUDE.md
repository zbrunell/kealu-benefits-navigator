@AGENTS.md

# Working notes

Lessons from real failures in this repo. Each entry says what broke, why, and
what to do instead.

## Browser code

### Never call `crypto.randomUUID()` in client code — use `createClientId()`

`crypto.randomUUID()` exists only in a **secure context** (HTTPS or
`localhost`). Opening the dev server over plain HTTP on a LAN address (e.g.
`http://192.168.x.x:3000`) or in an older browser leaves it undefined.
Building the application from the report threw `crypto.randomUUID is not a
function`, React unmounted the whole tree (blank page), and "Add household
member" threw the same error.

- Client code: `createClientId()` from `web/src/lib/client-id.ts` (falls back
  to `crypto.getRandomValues()`, available in every context).
- Server routes may keep Node's `import { randomUUID } from 'crypto'`, which is
  always available.
- Guarded by `web/tests/unit/client-id.test.ts` and
  `web/tests/e2e/insecure-context.spec.ts` (deletes `randomUUID` before the
  page loads and walks the California and Texas flows).
- Every normal e2e run is on `localhost`, which *is* secure, so only that spec
  can see this class of bug.

### Send the draft (PDF) request through `requestDraft()`

Calling `fetch` and `response.json()` directly put the browser's own text on
the applicant's screen: `Failed to fetch` when the server was unreachable, and
`Unexpected token '<'` for an HTML error page. `requestDraft()` in
`web/src/lib/draft-request.ts` turns both into a `DraftRequestError` with a
message key (`av_draft_unreachable`, `av_draft_failed`). Both application
views use it; a new one should too. Guarded by
`web/tests/unit/draft-request.test.ts` and
`web/tests/e2e/draft-unreachable.spec.ts`.

"Failed to fetch" means **no response at all**. Before debugging code, check a
server is actually listening (`lsof -nP -iTCP:3000 -sTCP:LISTEN`).

### Render errors do not reach Playwright's `pageerror`

React catches an error thrown while rendering, logs it with `console.error`,
and unmounts the tree. A test waiting on the next locator then times out
minutes later with no cause. To fail fast, also treat a `console` error whose
argument is an `Error` as a crash — see `onInsecurePage()` in
`insecure-context.spec.ts`.

### Missing Tailwind classes are a stale dev cache, not a layout bug

On 2026-09-25, classes used only in newer files (`gap-5` in the Texas person
card, `bg-slate-300` on a disabled Continue) were absent from the served CSS:
fields touched, and Continue rendered as bare text. Automatic source detection
reports scanned files but no directories, so webpack's persistent cache
(`.next*/cache/webpack`) never noticed new files. `globals.css` now has an
explicit `@source ".."`, which is reported as a directory dependency. A dev
server that is already running still does not rebuild `layout.css` when a
class is added to an existing file, or after a `globals.css` edit (seen again
2026-10-01: an unsized pencil SVG filled its button). If a class seems to do
nothing, check the served stylesheet before changing markup, then restart the
server with `rm -rf .next/cache` (or `.next-e2e/cache`). A one-off
`NEXT_DIST_DIR` that `.gitignore` does not list is also scanned by Tailwind.

## KVR runs

### Look up a failure by its code, then read the server log

A run that fails shows the applicant only the generic message, an
`Error code` (`BN-xxxx`) and an `Error ID` (the KVR run ID). What each code
means is in `PUBLIC_ERROR_DESCRIPTIONS` in `web/src/lib/kvr-runner.ts`; the
cause is in the server's `workflow_runner_failed` log line (`failureCode`,
`description`, `diagnosticTail`). Never put the cause in the SSE event.

On 2026-09-24 an expired OAuth login for the `claude/kealu.com` KVR account
failed every run in 0.0s ("Empty OAuth token for account ..."). The classifier
did not know that wording, and it checked rate limits before auth, so the
failure was reported as `UPSTREAM_RATE_LIMIT`. Auth is now checked first and
matches KVR's real messages (`BN-1003`). KVR's own advice for this error ("Wait
a few minutes and retry") is wrong: run `kvr check`, then
`kvr accounts login claude/kealu.com`. Guarded by the
`classifyRunnerFailure()` tests in `web/tests/unit/kvr-runner.test.ts`.

## Running the tests

### Playwright reuses whatever is already on port 3000

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`. If
`npm run dev:demo` (`E2E_MODE=1`) is running on :3000, the `chromium` project
tests against it instead of the mock-kvr server. The report is then the demo
fixture, and `intake-to-report.spec.ts:331` and
`report-rendering.spec.ts:131` fail (they expect `18,240` and
`tdhca.state.tx.us` from `tests/e2e/fixtures/mock-kvr`). These are not code
regressions. Stop the dev server first, or run against fresh servers on spare
ports.

### A dev server with a new `NEXT_DIST_DIR` rewrites `web/tsconfig.json`

`next dev` adds `<distDir>/types/**/*.ts` to `tsconfig.json`'s `include`.
Starting a server with a one-off build directory leaves that edit behind.
Revert it (`git checkout -- web/tsconfig.json`) and delete the directory
afterwards. `.next` and `.next-e2e` are already listed, so the standard config
does not cause this.

### Build or test in a separate directory while `next dev` is running

`next build` writes to `.next`, the dev server's directory. Use
`NEXT_DIST_DIR=.next-build-check npx next build`, then delete it.

### Testing a commit in a git worktree needs the virtualenv

`TestMeasurementToolIsInStep` runs `.venv/bin/python
tools/measure_texas_forms.py --check` from the repository root. A fresh
worktree has no `.venv`, so that one test fails with `FileNotFoundError`.
Symlink the main checkout's `.venv` into the worktree and set
`PYTHONPATH=<worktree>/src`.

### Full verification

```
.venv/bin/python -m pytest -q -m "not integration"       # repo root
cd web && npx tsc --noEmit -p . && npm run lint && npx vitest run
cd web && npx playwright test                            # nothing on :3000/:3101
```

## Open items

- The worksheet review sheet's applicant-facing reason
  (`worksheet_reason_tx_h1010_partial_coverage` in
  `formmap/review_words.py`, English and Spanish, and the four
  `tests/fixtures/h1010-*.review.txt` golden files) still says we "can
  currently fill only its first few pages" of H1010. That stopped being true at
  the cutover (`TX_H1010` now fills 115 fields). It needs new wording, which is
  a product decision.
- The two pregnancy questions (`household.pregnancy.person_name`,
  `household.pregnancy.due_date`) are mapped on H1010 and H3037 but not asked
  by the Texas intake, so those boxes stay blank.
