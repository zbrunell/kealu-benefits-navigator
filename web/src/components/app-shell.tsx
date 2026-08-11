//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useState } from "react";
import ChatInterface from "./chat-interface";
import PhaseTracker from "./phase-tracker";
import ReportView from "./report-view";
import ApplicationView from "./application-view";
import type { ChatMessage } from "@/types/session";
import type { IntakeField } from "@/lib/intake-flow";
import type { ReportPayload } from "@/lib/report-assembler";

type View = "intake" | "progress" | "report" | "application";

interface AppShellProps {
  initialView: View;
  initialMessages: ChatMessage[];
  initialNextQuestion: IntakeField | null;
  initialRunId?: string;
  initialReport?: ReportPayload;
}

/**
 * AppShell — client component that owns view-transition state.
 *
 * Receives serializable initial state from the server component (page.tsx) and
 * orchestrates transitions: intake → progress → report, and retry → progress.
 */
export default function AppShell({
  initialView,
  initialMessages,
  initialNextQuestion,
  initialRunId,
  initialReport,
}: AppShellProps) {
  const [view, setView] = useState<View>(initialView);
  const [runId, setRunId] = useState<string | undefined>(initialRunId);
  const [report, setReport] = useState<ReportPayload | undefined>(initialReport);

  const sawsRecommendation = report?.application.recommendations.find(
    (application) => application.formId === "CA_SAWS_2_PLUS",
  );

  /** Called by ChatInterface when all intake fields are collected and a run is started. */
  function handleReady(newRunId: string) {
    setRunId(newRunId);
    setView("progress");
  }

  /** Called by PhaseTracker when the action-plan phase completes and the report is fetched. */
  function handleRunComplete(payload: ReportPayload) {
    setReport(payload);
    setView("report");
  }

  /**
   * Called by ReportView "Run Again" — re-uses the same session vars to start a new run
   * without repeating the intake conversation.
   */
  function handleRetry(newRunId: string) {
    setRunId(newRunId);
    setView("progress");
  }

  function handleStartApplication() {
    setView("application");
  }

  function handleReturnToReport() {
    setView("report");
  }

  /**
   * Called by PhaseTracker "Try Again" — a new run has been started with the same
   * data. Swap in the new runId; the keyed PhaseTracker remounts and reconnects.
   */
  function handleRestart(newRunId: string) {
    setRunId(newRunId);
    setView("progress");
  }

  /**
   * Called by PhaseTracker when the user stops a run ("Stop & edit") or chooses to
   * edit after an error. Returns to the chat intake view, where the inline answers
   * panel lets the user review/correct their information and re-run — the single
   * edit surface used throughout the app. The stop route has already detached the
   * run from the session, so the next "Run Analysis" spawns a fresh run.
   */
  function handleEdit() {
    setRunId(undefined);
    setView("intake");
  }

  return (
    <>
      {view === "intake" && (
        <ChatInterface
          initialMessages={initialMessages}
          initialNextQuestion={initialNextQuestion}
          onReady={handleReady}
        />
      )}

      {view === "progress" && runId && (
        <PhaseTracker
          key={runId}
          runId={runId}
          onComplete={handleRunComplete}
          onRestart={handleRestart}
          onEdit={handleEdit}
        />
      )}

      {view === "report" && report && (
        <ReportView
          payload={report}
          runId={runId ?? ""}
          onRetry={handleRetry}
          onStartApplication={handleStartApplication}
        />
      )}

      {view === "application" && sawsRecommendation && (
        <ApplicationView
          runId={runId ?? ""}
          recommendation={sawsRecommendation}
          prefill={report?.application.prefill ?? null}
          onBack={handleReturnToReport}
        />
      )}

      {view === "application" && !sawsRecommendation && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h1 className="font-semibold text-red-900">
            Application recommendation unavailable
          </h1>

          <p className="mt-2 text-sm text-red-800">
            The structured SAWS 2 PLUS recommendation could not be found.
          </p>

          <button
            type="button"
            onClick={handleReturnToReport}
            className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
          >
            Back to report
          </button>
        </div>
      )}
    </>
  );
}
