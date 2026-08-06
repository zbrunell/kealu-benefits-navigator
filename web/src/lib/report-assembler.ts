//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { readFile, stat, rm } from "fs/promises";
import path from "path";

/** Canonical phase execution order. */
export const PHASE_ORDER: string[] = [
  "benefits-research",
  "insurance-research",
  "evidence-verification",
  "eligibility-validation",
  "action-plan",
];

/** Human-readable display names for each phase. */
export const PHASE_DISPLAY_NAMES: Record<string, string> = {
  "benefits-research": "Benefits Research",
  "insurance-research": "Insurance Research",
  "evidence-verification": "Evidence Verification",
  "eligibility-validation": "Eligibility Validation",
  "action-plan": "Action Plan",
};

const SAWS_PROGRAMS = ["medi_cal", "calfresh", "calworks"] as const;

const RECOMMENDATION_STATUSES = [
  "likely_eligible",
  "possibly_eligible",
  "unlikely_eligible",
  "insufficient_information",
] as const;

/** A single rendered phase section in the assembled report. */
export interface ReportSection {
  /** Phase identifier matching an entry in PHASE_ORDER. */
  phaseName: string;

  /** Human-readable title for the collapsible section header. */
  displayName: string;

  /** Raw Markdown content read from the phase's output file. */
  content: string;

  /** True for the action-plan phase, which is expanded by default. */
  expanded: boolean;
}

export type SupportedApplicationForm = "CA_SAWS_2_PLUS";

export type Saws2PlusProgram = (typeof SAWS_PROGRAMS)[number];

export type ProgramRecommendationStatus =
  (typeof RECOMMENDATION_STATUSES)[number];

export interface ProgramRecommendation {
  program: Saws2PlusProgram;
  status: ProgramRecommendationStatus;
  recommendedToApply: boolean;
  reasons: string[];
  missingInformation: string[];
  confidence: number;
}

export interface ApplicationRecommendation {
  formId: SupportedApplicationForm;
  recommended: boolean;
  programs: ProgramRecommendation[];
}

export type ApplicationStatus =
  "not_started" | "in_progress" | "ready_for_review" | "completed";

/** Metadata for the post-report application workflow. */
export interface ApplicationSummary {
  available: boolean;
  formId: SupportedApplicationForm | null;
  formName: string | null;
  status: ApplicationStatus;

  /** Programs preselected for the currently supported form. */
  recommendedPrograms: Saws2PlusProgram[];

  /** Structured applications produced by the Action Plan phase. */
  recommendations: ApplicationRecommendation[];
}

/** The assembled multi-phase report returned by the report API route. */
export interface ReportPayload {
  /**
   * Sections in PHASE_ORDER sequence.
   * Always 5 entries; missing phases receive placeholder content.
   */
  sections: ReportSection[];

  /**
   * Text extracted from the `## Bottom Line` section of the action-plan output.
   */
  bottomLine: string;

  /** Metadata for the separate post-analysis application workflow. */
  application: ApplicationSummary;
}

/**
 * Error thrown when the run directory or all phase files are missing.
 */
export interface AssembleError extends Error {
  code: "RUN_DIR_MISSING" | "INCOMPLETE";
  missingPhases?: string[];
}

/**
 * Resolve the .workforce base directory relative to the repo root.
 */
export function getWorkforceBase(): string {
  return path.join(process.cwd(), "..", ".workforce");
}

/**
 * Resolve the .workforce-drafts base directory relative to the repo root.
 *
 * This remains temporarily because the legacy draft endpoint may still use it.
 */
export function getDraftsBase(): string {
  return path.join(process.cwd(), "..", ".workforce-drafts");
}

/**
 * Extract text under the `## Bottom Line` action-plan section.
 */
function extractBottomLine(content: string): string {
  const match = content.match(
    /^##\s+Bottom Line\s*\n([\s\S]*?)(?=^##\s|\s*$)/m,
  );

  if (!match) {
    return "";
  }

  return match[1].trim();
}

function isSaws2PlusProgram(value: unknown): value is Saws2PlusProgram {
  return (
    typeof value === "string" &&
    (SAWS_PROGRAMS as readonly string[]).includes(value)
  );
}

function isRecommendationStatus(
  value: unknown,
): value is ProgramRecommendationStatus {
  return (
    typeof value === "string" &&
    (RECOMMENDATION_STATUSES as readonly string[]).includes(value)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parseProgramRecommendation(
  value: unknown,
): ProgramRecommendation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (!isSaws2PlusProgram(candidate.program)) {
    return null;
  }

  if (!isRecommendationStatus(candidate.status)) {
    return null;
  }

  if (typeof candidate.recommendedToApply !== "boolean") {
    return null;
  }

  if (!isStringArray(candidate.reasons) || candidate.reasons.length === 0) {
    return null;
  }

  if (!isStringArray(candidate.missingInformation)) {
    return null;
  }

  if (
    typeof candidate.confidence !== "number" ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    return null;
  }

  /*
   * Prevent internally inconsistent output from automatically recommending
   * a program after the Action Planner classified it as unlikely.
   */
  if (
    candidate.status === "unlikely_eligible" &&
    candidate.recommendedToApply
  ) {
    return null;
  }

  return {
    program: candidate.program,
    status: candidate.status,
    recommendedToApply: candidate.recommendedToApply,
    reasons: candidate.reasons,
    missingInformation: candidate.missingInformation,
    confidence: candidate.confidence,
  };
}

function parseApplicationRecommendation(
  value: unknown,
): ApplicationRecommendation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.formId !== "CA_SAWS_2_PLUS") {
    return null;
  }

  if (typeof candidate.recommended !== "boolean") {
    return null;
  }

  if (!Array.isArray(candidate.programs)) {
    return null;
  }

  const programs = candidate.programs
    .map(parseProgramRecommendation)
    .filter((program): program is ProgramRecommendation => program !== null);

  /*
   * SAWS 2 PLUS must contain exactly one valid recommendation for each
   * supported program.
   */
  if (programs.length !== SAWS_PROGRAMS.length) {
    return null;
  }

  const uniquePrograms = new Set(programs.map((program) => program.program));

  if (
    uniquePrograms.size !== SAWS_PROGRAMS.length ||
    !SAWS_PROGRAMS.every((program) => uniquePrograms.has(program))
  ) {
    return null;
  }

  const hasRecommendedProgram = programs.some(
    (program) => program.recommendedToApply,
  );

  /*
   * Require the application-level recommendation to agree with the
   * individual program recommendations.
   */
  if (candidate.recommended !== hasRecommendedProgram) {
    return null;
  }

  return {
    formId: "CA_SAWS_2_PLUS",
    recommended: candidate.recommended,
    programs,
  };
}

function parseApplicationRecommendations(
  values: unknown[],
): ApplicationRecommendation[] {
  const applications = values
    .map(parseApplicationRecommendation)
    .filter(
      (application): application is ApplicationRecommendation =>
        application !== null,
    );

  /*
   * Only one SAWS 2 PLUS application is currently supported.
   * Reject duplicate form objects rather than arbitrarily choosing one.
   */
  if (applications.length > 1) {
    return [];
  }

  return applications;
}

/**
 * Extract and validate the machine-readable application data from the
 * Action Plan Markdown.
 *
 * Invalid or malformed output fails closed and returns an empty array.
 */
function extractStructuredApplicationOutput(
  content: string,
): ApplicationRecommendation[] {
  const sectionMatch = content.match(
    /^##\s+Structured Application Output\s*\n([\s\S]*?)(?=^##\s|\s*$)/m,
  );

  if (!sectionMatch) {
    return [];
  }

  const jsonMatch = sectionMatch[1].match(/```json\s*([\s\S]*?)\s*```/i);

  if (!jsonMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]) as {
      schemaVersion?: unknown;
      applications?: unknown;
    };

    if (parsed.schemaVersion !== 1) {
      return [];
    }

    if (!Array.isArray(parsed.applications)) {
      return [];
    }

    return parseApplicationRecommendations(parsed.applications);
  } catch {
    return [];
  }
}

/**
 * Assemble the report payload from phase output files in the run directory.
 *
 * Throws an AssembleError with:
 * - `RUN_DIR_MISSING` when the run directory does not exist
 * - `INCOMPLETE` when all phase files are absent
 */
export async function assembleReport(
  runId: string,
  workforceBase?: string,
): Promise<ReportPayload> {
  const base = workforceBase ?? getWorkforceBase();
  const runDir = path.join(base, runId);

  try {
    await stat(runDir);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;

    if (e.code === "ENOENT") {
      const error = new Error(
        `Run directory not found: ${runDir}`,
      ) as AssembleError;

      error.code = "RUN_DIR_MISSING";
      throw error;
    }

    throw err;
  }

  const sections: ReportSection[] = [];
  const missingPhases: string[] = [];

  let bottomLine = "";
  let applicationRecommendations: ApplicationRecommendation[] = [];

  for (const phaseName of PHASE_ORDER) {
    const filePath = path.join(runDir, `${phaseName}.md`);
    let content: string;

    try {
      content = await readFile(filePath, "utf8");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;

      if (e.code === "ENOENT") {
        missingPhases.push(phaseName);
        content = "_Phase completed without written output._";
      } else {
        throw err;
      }
    }

    if (phaseName === "action-plan" && !missingPhases.includes(phaseName)) {
      bottomLine = extractBottomLine(content);
      applicationRecommendations = extractStructuredApplicationOutput(content);
    }

    sections.push({
      phaseName,
      displayName: PHASE_DISPLAY_NAMES[phaseName] ?? phaseName,
      content,
      expanded: phaseName === "action-plan",
    });
  }

  /*
   * Missing individual phase files do not prevent a partially usable report.
   * Fail only when the entire run directory contains no phase outputs.
   */
  if (missingPhases.length === PHASE_ORDER.length) {
    const error = new Error(
      "All phase files missing — workflow incomplete",
    ) as AssembleError;

    error.code = "INCOMPLETE";
    error.missingPhases = missingPhases;
    throw error;
  }

  const sawsApplication = applicationRecommendations.find(
    (application) => application.formId === "CA_SAWS_2_PLUS",
  );

  const recommendedPrograms =
    sawsApplication?.programs
      .filter((program) => program.recommendedToApply)
      .map((program) => program.program) ?? [];

  return {
    sections,
    bottomLine,
    application: {
      available: false,
      formId: null,
      formName: null,
      status: "not_started",
      recommendedPrograms,
      recommendations: applicationRecommendations,
    },
  };
}

/**
 * Delete the run directory for a completed run.
 */
export async function deleteRunDir(
  runId: string,
  workforceBase?: string,
): Promise<void> {
  const base = workforceBase ?? getWorkforceBase();
  const runDir = path.join(base, runId);

  await rm(runDir, {
    recursive: true,
    force: true,
  });
}
