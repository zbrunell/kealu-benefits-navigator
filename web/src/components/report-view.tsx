//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useMemo, useState } from "react";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import ErrorBanner from "./error-banner";
import { useTranslation } from "@/hooks/use-translation";
import type { ReportPayload } from "@/lib/report-assembler";

/**
 * Configure marked to open external links in a new tab.
 * Called once at module level — safe because:
 * - Client runtime: one global per browser tab.
 * - Server SSR: module is loaded once per Next.js worker process; the global marked instance
 *   is shared across concurrent SSR renders, but since this only adds a renderer (idempotent),
 *   there are no race conditions.
 *
 * Uses sanitize-html (htmlparser2-based) rather than DOMPurify, which requires window/document.
 * sanitize-html works identically in Node.js and the browser — no SSR crash.
 */
marked.use({
  renderer: {
    link({ href, text }: { href: string | null; text: string }) {
      const safe = href ?? "#";
      const isExternal = safe.startsWith("http");
      const attrs = isExternal
        ? ` target="_blank" rel="noopener noreferrer"`
        : "";
      return `<a href="${safe}"${attrs}>${text}</a>`;
    },
  },
  gfm: true,
});

/**
 * Extended allowlist beyond sanitize-html defaults.
 *
 * Headings (h1–h6): phase outputs use markdown headings for section structure.
 * Table elements: insurance plan comparisons heavily use markdown tables;
 *   ALL table sub-elements must be allowed or the rendered HTML is stripped bare.
 * div/span: needed for the `class="table-wrapper"` overflow-x container injected
 *   by renderMarkdown before sanitization.
 * details/summary: phase sections could include collapsible sub-sections.
 */
const ALLOWED_TAGS: string[] = [
  ...sanitizeHtml.defaults.allowedTags,
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "div",
  "span",
  "details",
  "summary",
];

/** Convert markdown to sanitized HTML with table wrappers for overflow-x scrolling. */
function renderMarkdown(content: string): string {
  const raw = marked.parse(content) as string;

  // Wrap <table> elements for horizontal scrollability on narrow viewports
  const wrapped = raw
    .replace(/<table/g, '<div class="table-wrapper"><table')
    .replace(/<\/table>/g, "</table></div>");

  return sanitizeHtml(wrapped, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "target", "rel", "name"],
      table: ["class"],
      th: ["scope", "align", "colspan"],
      td: ["align", "colspan"],
      div: ["class"],
    },
  });
}

/*
 * Programme names are proper nouns, so they are not translated — an applicant
 * searching a county website for "CalFresh" will not find "Comida fresca".
 * Both states' names live here because this section renders whichever
 * application the household's state has.
 */
const PROGRAM_LABELS: Record<string, string> = {
  medi_cal: "Medi-Cal",
  calfresh: "CalFresh",
  calworks: "CalWORKs",
  tx_medicaid: "Medicaid",
  tx_chip: "CHIP",
  tx_snap: "SNAP",
  tx_tanf: "TANF",
};

/**
 * Catalog keys for the screening outcome — the same keys
 * program-selection-step resolves, so the two views cannot drift apart.
 */
const STATUS_LABEL_KEYS = {
  likely_eligible: "status_likely_eligible",
  possibly_eligible: "status_possibly_eligible",
  unlikely_eligible: "status_unlikely_eligible",
  insufficient_information: "status_insufficient_information",
} as const;

const STATUS_CLASSES = {
  likely_eligible: "border-green-200 bg-green-100 text-green-800",
  possibly_eligible: "border-amber-200 bg-amber-100 text-amber-800",
  unlikely_eligible: "border-slate-200 bg-slate-100 text-slate-700",
  insufficient_information: "border-blue-200 bg-blue-100 text-blue-800",
} as const;

interface ReportViewProps {
  payload: ReportPayload;
  runId: string;
  onRetry: (newRunId: string) => void;
  onStartApplication: () => void;
}

/**
 * ReportView — renders the assembled five-phase benefits report.
 *
 * - Bottom Line summary pinned above all sections.
 * - Phase sections rendered as <details> collapsibles; action-plan expanded by default.
 * - Markdown tables wrapped in overflow-x-auto containers for wide insurance comparisons.
 * - External .gov and program links rendered as target="_blank" anchors.
 * - "Run Again" triggers a new workflow run without repeating intake.
 */
export default function ReportView({
  payload,
  runId,
  onRetry,
  onStartApplication,
}: ReportViewProps) {
  const { t, tv, tn, tOr, tReasons } = useTranslation();
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const sawsRecommendation = payload.application.recommendations.find(
    (application) => application.formId === "CA_SAWS_2_PLUS",
  );

  const recommendedProgramCount =
    sawsRecommendation?.programs.filter((program) => program.recommendedToApply)
      .length ?? 0;

  const renderedSections = useMemo(
    () =>
      payload.sections.map((section) => ({
        ...section,
        html: renderMarkdown(section.content),
      })),
    [payload.sections],
  );

  const bottomLineHtml = useMemo(
    () => (payload.bottomLine ? renderMarkdown(payload.bottomLine) : null),
    [payload.bottomLine],
  );

  async function handleRunAgain() {
    setRetryError(null);
    setIsRetrying(true);
    try {
      const res = await fetch("/api/workflow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        runId?: string;
        error?: string;
        errorKey?: string;
      };

      if (data.runId) {
        onRetry(data.runId);
        return;
      }
      setRetryError(
        tOr(data.errorKey ?? "", data.error ?? t("report_start_failed")),
      );
    } catch {
      setRetryError(t("report_refresh_failed"));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <div data-testid="report-view" className="space-y-4">
      {/* ── Bottom Line — pinned summary card ─────────────────────────────── */}
      {bottomLineHtml && (
        <div
          data-testid="bottom-line"
          className="rounded-xl border border-blue-200 bg-blue-50 p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-2">
            {t("report_bottom_line")}
          </p>
          <div
            className="markdown-content text-blue-900 text-sm"
            dangerouslySetInnerHTML={{ __html: bottomLineHtml }}
          />
        </div>
      )}

      {/* ── Phase sections ────────────────────────────────────────────────── */}
      {renderedSections.map((section) => (
        <details
          key={section.phaseName}
          data-testid={`section-${section.phaseName}`}
          open={section.expanded}
          className="group rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4 font-medium text-slate-800 hover:bg-slate-50 rounded-xl list-none">
            {/*
              The catalog already names every phase; PHASE_DISPLAY_NAMES is the
              English fallback for a phase id it does not know.
            */}
            <span>
              {tOr(
                `phase_${section.phaseName.replace(/-/g, '_')}`,
                section.displayName,
              )}
            </span>
            <span className="text-xs text-slate-400 font-normal group-open:hidden">
              {t("report_expand")}
            </span>
            <span className="text-xs text-slate-400 font-normal hidden group-open:inline">
              {t("report_collapse")}
            </span>
          </summary>
          <div
            data-testid="section-content"
            className="px-5 pb-5 pt-1 border-t border-slate-100"
          >
            <div
              className="markdown-content"
              dangerouslySetInnerHTML={{ __html: section.html }}
            />
          </div>
        </details>
      ))}

      {/* ── SAWS 2 PLUS application recommendations ──────────────────────── */}
      {payload.application.available && sawsRecommendation && (
        <section
          data-testid="saws-recommendation"
          className="rounded-xl border border-green-200 bg-green-50 p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
                {t("report_ca_application")}
              </p>

              <h2 className="mt-2 text-lg font-semibold text-green-950">
                {t("report_saws_application")}
              </h2>

              <p className="mt-2 max-w-2xl text-sm text-green-900">
                {t("report_action_plan_intro")}
              </p>
            </div>

            {sawsRecommendation.recommended && (
              <span className="w-fit rounded-full border border-green-300 bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                {t("ui_recommended")}
              </span>
            )}
          </div>

          <div className="mt-5 space-y-3">
            {sawsRecommendation.programs.map((program) => (
              <article
                key={program.program}
                className="rounded-lg border border-green-200 bg-white p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">
                      {PROGRAM_LABELS[program.program]}
                    </h3>

                    {program.recommendedToApply && (
                      <span className="rounded-full bg-green-700 px-2 py-0.5 text-xs font-medium text-white">
                        {t("ui_apply")}
                      </span>
                    )}
                  </div>

                  <span
                    className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${
                      STATUS_CLASSES[program.status]
                    }`}
                  >
                    {t(STATUS_LABEL_KEYS[program.status])}
                  </span>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("ui_why")}
                  </p>

                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {tReasons(program.reasons).map((sentence) => (
                      <li key={sentence}>{sentence}</li>
                    ))}
                  </ul>
                </div>

                {program.missingInformation.length > 0 && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      {t("programs_info_needed")}
                    </p>

                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-900">
                      {tReasons(program.missingInformation).map((sentence) => (
                        <li key={sentence}>{sentence}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-3 text-xs text-slate-500">
                  {tv("report_screening_confidence", {
                    percent: Math.round(program.confidence * 100),
                  })}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-5 border-t border-green-200 pt-4">
            <p className="text-xs text-green-800">
              {t("report_screening_note")}
            </p>

            <button
              type="button"
              onClick={onStartApplication}
              className="mt-4 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              {recommendedProgramCount > 0
                ? tn("report_continue_programs", recommendedProgramCount)
                : t("report_review_saws")}
            </button>
          </div>
        </section>
      )}

      {/* ── Footer actions ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-slate-400 font-mono truncate max-w-[50%]">
          {tv("report_run_label", { runId })}
        </p>
        <button
          type="button"
          onClick={() => void handleRunAgain()}
          disabled={isRetrying}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors"
        >
          {isRetrying ? t("report_starting") : t("report_run_again")}
        </button>
      </div>

      {retryError && (
        <ErrorBanner
          message={retryError}
          correlationId={runId}
          onRetry={() => void handleRunAgain()}
        />
      )}
    </div>
  );
}
