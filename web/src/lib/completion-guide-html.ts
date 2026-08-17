//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The completion guide as a page that prints well and downloads as one file.
 *
 * Rendered as a standalone HTML document rather than an app route, for three
 * reasons that all matter for a document someone takes to a county office:
 *
 * - It downloads as a single self-contained file. No stylesheet to fetch, no
 *   script, no font — so it still renders correctly on a library computer, an
 *   old phone, or after being emailed to a caseworker.
 * - It has no application chrome to hide. There is no sidebar or navigation in
 *   the file at all, so nothing can leak into the printed page.
 * - Print rules live with the markup they style, and are asserted by tests.
 *
 * Print behaviour is explicit rather than left to the browser: US Letter with
 * half-inch margins, sections that do not split across a page break, and a
 * repeating table header so a long list of blanks stays readable on page two.
 */

import type { CompletionGuide, GuideItem, GuideSection } from '@/lib/completion-guide';

/** Escape for HTML text and attribute contexts. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Turn bare URLs into links.
 *
 * The submission section names two portals. On paper the URL is what matters
 * and is printed as text either way; on screen it should be clickable.
 */
function linkify(value: string): string {
  /*
   * The trailing-punctuation class is the point: these URLs end sentences, and
   * a naive match swallows the full stop into the href — producing a link to
   * "benefitscal.com/." which resolves to the wrong place or nowhere.
   */
  return escapeHtml(value).replace(
    /https?:\/\/[^\s<]*[^\s<.,;:!?)]/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
}

const STYLES = `
  :root { color-scheme: light; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    background: #ffffff;
    color: #0f172a;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
  }

  main { max-width: 46rem; margin: 0 auto; }

  h1 { font-size: 1.55rem; line-height: 1.25; margin: 0 0 .35rem; }
  h2 {
    font-size: 1.05rem;
    margin: 2rem 0 .5rem;
    padding-bottom: .3rem;
    border-bottom: 2px solid #0f172a;
  }

  .lede { margin: 0 0 1.25rem; color: #475569; }

  .identity {
    margin: 0 0 1.5rem;
    padding: .75rem 1rem;
    border: 1px solid #cbd5e1;
    border-radius: .5rem;
    background: #f8fafc;
    font-size: .875rem;
  }
  .identity dl { display: grid; grid-template-columns: auto 1fr; gap: .2rem .75rem; margin: 0; }
  .identity dt { font-weight: 600; color: #475569; }
  .identity dd { margin: 0; }

  .intro { margin: 0 0 .85rem; color: #475569; font-size: .9rem; }

  ol.items { margin: 0; padding: 0; list-style: none; counter-reset: item; }

  li.item {
    counter-increment: item;
    display: grid;
    grid-template-columns: 1.6rem 1fr;
    gap: .6rem;
    padding: .7rem 0;
    border-top: 1px solid #e2e8f0;
  }
  li.item:first-child { border-top: 0; }
  li.item::before {
    content: counter(item);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 999px;
    background: #e2e8f0;
    font-size: .8rem;
    font-weight: 700;
  }

  .item-title { font-weight: 600; }
  .item-detail { margin: .15rem 0 0; }
  .item-meta {
    margin: .3rem 0 0;
    font-size: .8rem;
    color: #475569;
    display: flex;
    flex-wrap: wrap;
    gap: .35rem 1rem;
  }
  .item-meta .where { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .item-meta .who::before { content: "For: "; }

  footer {
    margin-top: 2.5rem;
    padding-top: .75rem;
    border-top: 1px solid #e2e8f0;
    font-size: .8rem;
    color: #475569;
  }

  a { color: #1d4ed8; }

  /* Long values must scroll rather than push the page sideways. */
  .item-meta .where { overflow-wrap: anywhere; }

  @media print {
    @page { size: Letter; margin: .5in; }

    body { padding: 0; font-size: 11.5pt; }
    main { max-width: none; }

    /*
     * A heading never ends a page, and one item never splits across two — but
     * a whole section may break, because forbidding that pushed every long
     * list onto a fresh sheet and turned a 6-page guide into 17 with half of
     * them blank. Someone printing this at a library pays for those pages.
     */
    h2 { break-after: avoid-page; }
    .intro { break-after: avoid-page; }
    li.item { break-inside: avoid; }

    a { color: inherit; text-decoration: none; }
    .no-print { display: none !important; }
  }
`;

function renderItem(item: GuideItem): string {
  const meta = [
    item.location
      ? `<span class="where">${escapeHtml(item.location)}</span>`
      : '',
    item.person ? `<span class="who">${escapeHtml(item.person)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  return [
    '<li class="item"><div>',
    `<p class="item-title">${escapeHtml(item.title)}</p>`,
    `<p class="item-detail">${linkify(item.detail)}</p>`,
    meta ? `<p class="item-meta">${meta}</p>` : '',
    '</div></li>',
  ].join('');
}

function renderSection(section: GuideSection): string {
  return [
    `<section id="section-${escapeHtml(section.id)}">`,
    `<h2>${escapeHtml(section.title)}</h2>`,
    section.intro ? `<p class="intro">${escapeHtml(section.intro)}</p>` : '',
    '<ol class="items">',
    section.items.map(renderItem).join(''),
    '</ol></section>',
  ].join('');
}

/** A readable date for a document someone may be holding weeks later. */
function formatGeneratedAt(iso: string): string {
  const when = new Date(iso);

  if (Number.isNaN(when.getTime())) return iso;

  return when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * Render a guide as a complete, self-contained HTML document.
 *
 * The result is safe to write to a file, serve as `text/html`, or hand to a
 * browser's print dialog unchanged.
 */
export function renderCompletionGuideHtml(guide: CompletionGuide): string {
  const audienceNote =
    guide.audience === 'associate'
      ? 'For the person helping with this application. Every blank below gives ' +
        'its PDF page, the label printed at the foot of that page, and the ' +
        'printed question, so nothing has to be hunted for.'
      : 'Your SAWS 2 PLUS draft has been filled in with your answers. This ' +
        'guide lists everything still to do before you send it in.';

  const identity = [
    guide.applicantName
      ? `<dt>Applicant</dt><dd>${escapeHtml(guide.applicantName)}</dd>`
      : '',
    guide.county ? `<dt>County</dt><dd>${escapeHtml(guide.county)}</dd>` : '',
    `<dt>Draft reference</dt><dd>${escapeHtml(guide.draft.reference)}</dd>`,
    `<dt>Generated</dt><dd>${escapeHtml(formatGeneratedAt(guide.draft.generatedAt))}</dd>`,
    guide.draft.pdfFilename
      ? `<dt>Goes with</dt><dd>${escapeHtml(guide.draft.pdfFilename)}</dd>`
      : '',
    `<dt>Answers filled</dt><dd>${guide.filledFieldCount}</dd>`,
  ]
    .filter(Boolean)
    .join('');

  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(guide.title)} — ${escapeHtml(guide.draft.reference)}</title>`,
    `<style>${STYLES}</style>`,
    '</head><body><main>',
    `<h1>${escapeHtml(guide.title)}</h1>`,
    `<p class="lede">${escapeHtml(audienceNote)}</p>`,
    `<div class="identity"><dl>${identity}</dl></div>`,
    guide.sections.map(renderSection).join(''),
    '<footer>',
    escapeHtml(
      'This guide describes one generated draft. If you change your answers ' +
        'and generate a new draft, print the new guide too — the draft ' +
        'reference at the top is how you tell them apart. Kealu never writes ' +
        'a Social Security Number or a signature onto a form.',
    ),
    '</footer>',
    '</main></body></html>',
  ].join('');
}
