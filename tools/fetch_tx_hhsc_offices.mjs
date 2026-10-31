//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Snapshot HHSC's own "Find an office" answer for every Texas county.
 *
 * HHSC publishes no office dataset or API. The official locator at
 * https://www.yourtexasbenefits.com/Screener/FindanOffice answers a county
 * with the benefits office(s) that serve it — including counties with no
 * office of their own (Loving County is served from Pecos). This asks it once
 * per county, about one request a second, through one ordinary browser
 * session, and writes the raw answers to disk. `build_tx_hhsc_offices.py`
 * turns them into the data file the app reads; it never calls HHSC.
 *
 * Run from the repository root (uses the web app's Playwright):
 *
 *   node tools/fetch_tx_hhsc_offices.mjs <output-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(
  path.join(here, '..', 'web', 'node_modules', 'playwright', 'index.mjs')
);

const LOCATOR = 'https://www.yourtexasbenefits.com/Screener/FindanOffice';
const ENDPOINT = '/Screener/FindanOffice/resource/findOffices';
const DELAY_MS = 1000;

const outDir = process.argv[2];

if (!outDir) {
  console.error('usage: node tools/fetch_tx_hhsc_offices.mjs <output-dir>');
  process.exit(2);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(LOCATOR, { waitUntil: 'networkidle', timeout: 60_000 });

// The locator's own county list: the names it accepts, all 254.
const counties = await page.$$eval('#county option', (options) =>
  options
    .filter((option) => option.value)
    .map((option) => option.textContent.trim()),
);

console.log(`${counties.length} counties`);

const answers = {};

async function ask(county) {
  return page.evaluate(
    async ({ endpoint, county }) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body:
          'userInput=' +
          encodeURIComponent(
            JSON.stringify({ isBenefitOffices: 'Y', isCpoOffices: 'N', county }),
          ),
      });

      return { status: response.status, body: await response.text() };
    },
    { endpoint: ENDPOINT, county },
  );
}

for (const county of counties) {
  let result = await ask(county);

  /*
   * The list's label is not always the name the locator matches: "De Witt"
   * comes back empty and "DeWitt" returns the Cuero office. An empty answer
   * is retried once without spaces.
   */
  if (result.status === 200 && county.includes(' ')) {
    if (JSON.parse(result.body).length === 0) {
      await page.waitForTimeout(DELAY_MS);
      result = await ask(county.replace(/\s+/g, ''));
    }
  }

  if (result.status !== 200) {
    console.error(`${county}: HTTP ${result.status}`);
    process.exitCode = 1;
  } else {
    answers[county] = JSON.parse(result.body);
    console.log(`${county}: ${answers[county].length} entries`);
  }

  await page.waitForTimeout(DELAY_MS);
}

await browser.close();

await writeFile(
  path.join(outDir, 'hhsc-find-an-office.json'),
  JSON.stringify(
    { source: LOCATOR, fetchedAt: new Date().toISOString(), answers },
    null,
    1,
  ),
);
