//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { NextResponse } from "next/server";
import {
  buildHouseholdMemberPrefill,
  parseHouseholdComposition,
} from "@/lib/household";
import type {
  ApplicationSummary,
  ReportPayload,
} from "@/lib/report-assembler";
import type { ApplicationPrefill } from "@/types/application";
import { applicationForState } from "@/lib/state-applications";

/**
 * Decide what application, if any, this household can be offered.
 *
 * One place, consulted by both the cached and freshly-assembled paths, which
 * previously each carried their own copy of `state === "CA"`.
 *
 * A `generated` application also needs a recommendation for its own form —
 * without one there is nothing to prefill. A `manual` one does not: the value
 * is the programme list, the official route and the checklist, and those exist
 * whether or not the screening produced a form-specific recommendation.
 *
 * Both deliveries receive the prefill. It withheld it from `manual` on the
 * reasoning that a manual guide reads the applicant's own answers instead — but
 * a manual flow never runs the questionnaire, so there were no answers to read:
 * the guide's "what you already told us" list came back holding nothing but a
 * household size of 1. The prefill *is* the applicant's own answers, derived
 * from intake, and carrying them across is the entire purpose of that page.
 */
function applicationSummaryFor(
  summary: ApplicationSummary,
  state: string | undefined,
  prefill: ApplicationPrefill,
): ApplicationSummary {
  const definition = applicationForState(state);

  if (!definition) return summary;

  if (definition.delivery === "generated") {
    const matching = summary.recommendations.find(
      (recommendation) => recommendation.formId === definition.formId,
    );

    if (!matching) return summary;
  }

  return {
    ...summary,
    available: true,
    formId: definition.formId,
    formName: definition.formCode,
    delivery: definition.delivery,
    prefill,
  };
}

/**
 * GET /api/workflow/[runId]/report
 *
 * Assembles and returns the full report for a completed workflow run.
 * Authorizes via session cookie: session.runId must match path runId.
 * Caches the assembled report in session.reportContent to avoid re-reading on refresh.
 * Deletes the run directory after the first successful assembly.
 *
 * Returns application metadata after the completed benefits analysis.
 * PDF generation occurs later in the dedicated application workflow.
 *
 * Both session-store and report-assembler are imported dynamically so that
 * vi.mock() factories in tests are not triggered at module-load time.
 *
 * Response codes:
 * - 200 `{ sections, bottomLine, application }` — report assembled
 * - 403 — session does not own this runId
 * - 422 `{ error, missingPhases }` — run directory missing or incomplete
 */

function parseAnnualIncome(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  // Next.js 15 hands route params in as a Promise. This handler destructured
  // it synchronously, which logs a "params should be awaited" error on every
  // report fetch and is slated to stop working outright. Every sibling route
  // already awaits it.
  const { runId } = await params;

  // Dynamic imports: defers module resolution to handler invocation time.
  const { sessionStore } = await import("@/lib/session-store");
  const { assembleReport, deleteRunDir, getWorkforceBase, PHASE_ORDER } =
    await import("@/lib/report-assembler");

  // Authorize using only the session cookie from this request.
  const rawCookie = req.headers.get("cookie") ?? "";
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;
  /*
   * Read the locale through the shared helper rather than matching the cookie
   * here. It is the one place that decides what an unsupported tag falls back
   * to — zh-TW becomes English rather than being treated as zh-CN — and a
   * second parser in this route would be free to disagree with it.
   */
  const { localeFromCookieHeader } = await import("@/lib/locale");
  const locale = localeFromCookieHeader(rawCookie);

  /*
   * Named for the model that writes the report body. "Chinese" alone is
   * ambiguous, and this project cares about the difference: the official
   * Chinese SAWS form is Traditional, so an unqualified request risks a report
   * in a different script from the interface around it.
   */
  const preferredLanguage =
    locale === "es"
      ? "Spanish"
      : locale === "zh-CN"
        ? "Simplified Chinese"
        : "English";
  /*
   * Household size and the additional-member rows are derived from the intake
   * household answer, never asked again. Once the applicant edits the household
   * in the application flow, size follows the rows they entered
   * (see householdSizeFromMembers).
   */
  const householdComposition = parseHouseholdComposition(
    session?.vars.household_profile,
  );

  const applicationPrefill = {
    zipCode: session?.vars.zip_code?.trim() ?? "",

    /*
     * City, state, and county were derived from the ZIP code during intake
     * (lib/location.ts). Anything that could not be resolved stays blank so the
     * applicant can supply it rather than being shown a guess.
     */
    city: session?.vars.city?.trim() ?? "",
    /*
     * No default. This used to fall back to "CA" when the ZIP resolved no
     * state, which meant an unresolved location was silently treated as a
     * California household — it was offered the SAWS 2 PLUS application and
     * had California written into its address block. An empty state now stays
     * empty: `applicationForState` returns null, no form is offered, and the
     * applicant is asked rather than guessed at.
     */
    state: session?.vars.state?.trim() ?? "",
    county: session?.vars.county?.trim() ?? "",

    preferredLanguage,

    /* The original free-text answer is retained for reference. */
    householdProfile: session?.vars.household_profile?.trim() ?? "",
    householdSize: householdComposition.size,
    householdMembers: buildHouseholdMemberPrefill(householdComposition),

    annualHouseholdIncome: parseAnnualIncome(session?.vars.annual_income),

    incomeType: session?.vars.income_type?.trim() ?? "",
    existingBenefits: session?.vars.existing_benefits?.trim() ?? "",
  };

  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Return cached report if available.
  if (session.reportContent) {
    const cachedPayload = session.reportContent as ReportPayload;
    cachedPayload.application ??= {
      available: false,
      formId: null,
      formName: null,
      delivery: null,
      status: "not_started",
      recommendedPrograms: [],
      recommendations: [],
      prefill: null,
    };

    cachedPayload.application = applicationSummaryFor(
      cachedPayload.application,
      session.vars.state,
      applicationPrefill,
    );

    return NextResponse.json(cachedPayload, {
      status: 200,
      headers: { "X-Correlation-Id": runId },
    });
  }

  const workforceBase = getWorkforceBase();

  try {
    const payload = await assembleReport(runId, workforceBase);
    payload.application ??= {
      available: false,
      formId: null,
      formName: null,
      delivery: null,
      status: "not_started",
      recommendedPrograms: [],
      recommendations: [],
      prefill: null,
    };

    payload.application = applicationSummaryFor(
      payload.application,
      session.vars.state,
      applicationPrefill,
    );

    // Cache report and mark the workflow complete.
    sessionStore.update(session.sessionId, {
      reportContent: payload,
      runStatus: "complete",
    });

    // The report is cached, so the run directory is no longer needed.
    await deleteRunDir(runId, workforceBase);

    return NextResponse.json(payload, {
      status: 200,
      headers: { "X-Correlation-Id": runId },
    });
  } catch (err: unknown) {
    const e = err as { code?: string; missingPhases?: string[] };

    if (e.code === "RUN_DIR_MISSING") {
      return NextResponse.json(
        {
          error: "Run directory not found — workflow may not have completed.",
          missingPhases: PHASE_ORDER,
        },
        { status: 422, headers: { "X-Correlation-Id": runId } },
      );
    }

    if (e.code === "INCOMPLETE") {
      return NextResponse.json(
        {
          error: "Workflow incomplete — some phases have not finished.",
          missingPhases: e.missingPhases ?? [],
        },
        { status: 422, headers: { "X-Correlation-Id": runId } },
      );
    }

    throw err;
  }
}
