//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The generator's review sheet, as a page someone can read and print.
 *
 * The mapping layer writes the sheet as plain text beside the PDF, and that is
 * the right storage format: it is diffable, it is checked into the Python
 * suite as a golden file, and it survives being emailed. It is not a good
 * *reading* format in a browser, where it renders as one grey block.
 *
 * So this adds exactly what a reader needs and nothing that could change the
 * meaning: the section headings the sheet already marks by indentation become
 * headings, the indented lines become list items, and everything else is
 * escaped and rendered as written. No text is added, removed, reordered or
 * translated — the sheet is already written in the language the document was
 * filled in, and rewriting it here would let the page and the PDF disagree.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** How deeply a line is indented, in the sheet's two-space steps. */
function depthOf(line: string): number {
  const leading = line.length - line.trimStart().length;

  return Math.floor(leading / 2);
}

/**
 * Turn the sheet into HTML.
 *
 * A blank line ends the current block. A line at depth 0 that ends in a colon
 * is a section heading; deeper lines are its items. Anything else is a
 * paragraph. That is the whole grammar, and it is derived from how the sheet is
 * already written rather than imposed on it.
 */
export function renderReviewSheetHtml(
  sheet: string,
  reference: string,
): string {
  const lines = sheet.replace(/\r\n/g, '\n').split('\n');
  const body: string[] = [];

  let inList = false;

  const closeList = () => {
    if (inList) {
      body.push('</ul>');
      inList = false;
    }
  };

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    const depth = depthOf(line);

    if (depth === 0) {
      closeList();

      // The first line is the form's own title.
      if (index === 0) {
        body.push(`<h1>${escapeHtml(trimmed)}</h1>`);
        continue;
      }

      if (trimmed.endsWith(':')) {
        body.push(`<h2>${escapeHtml(trimmed)}</h2>`);
        continue;
      }

      body.push(`<p>${escapeHtml(trimmed)}</p>`);
      continue;
    }

    if (!inList) {
      body.push('<ul>');
      inList = true;
    }

    body.push(
      `<li class="depth-${Math.min(depth, 3)}">${escapeHtml(trimmed)}</li>`,
    );
  }

  closeList();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(reference)}</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0 auto;
    max-width: 46rem;
    padding: 2rem 1.5rem 4rem;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
    background: #ffffff;
  }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 2rem 0 .5rem; color: #334155; }
  p { margin: .5rem 0; }
  ul { margin: .25rem 0 .5rem; padding-left: 1.25rem; list-style: none; }
  li { margin: .15rem 0; }
  li.depth-2, li.depth-3 { padding-left: 1.25rem; color: #334155; }
  .reference {
    margin: 0 0 1.5rem;
    font-size: .75rem;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #64748b;
  }
  @media print {
    body { max-width: none; padding: 0; font-size: 11pt; }
    h2 { break-after: avoid; }
    li { break-inside: avoid; }
  }
</style>
</head>
<body>
<p class="reference">${escapeHtml(reference)}</p>
${body.join('\n')}
</body>
</html>
`;
}
