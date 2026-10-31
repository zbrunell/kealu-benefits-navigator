//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import type { ProgramRecommendation } from "@/lib/report-assembler";
import { useTranslation } from "@/hooks/use-translation";
import {
  programNameKey,
  type BenefitProgramId,
} from "@/lib/state-applications";

/**
 * Catalog keys for the screening outcome. report-view resolves the same keys —
 * one meaning, one place, rather than a copy of this map in each component.
 */
const STATUS_LABEL_KEYS = {
  likely_eligible: "status_likely_eligible",
  possibly_eligible: "status_possibly_eligible",
  unlikely_eligible: "status_unlikely_eligible",
  insufficient_information: "status_insufficient_information",
} as const;

/**
 * "What are you applying for?", for any state's form.
 *
 * Generic over `BenefitProgramId` because the question is: every state's form
 * opens by asking which of its programmes you want. It used to hold its own
 * English map of California's three, which meant a Spanish-speaking applicant
 * read translated help beside an untranslated programme name and a Texas
 * programme rendered as blank — so the caller now passes the programmes it
 * covers and the name comes from the shared catalog lookup.
 *
 * The "Other" box is optional: SAWS 2 PLUS prints one and H1010 does not, and a
 * form without it should not render a checkbox that maps to nothing.
 */
interface ProgramSelectionStepProps {
  /** The agency's own designation, printed above the heading. */
  formCode: string;
  /** The programmes this form covers, already screened for this household. */
  programs: readonly ProgramRecommendation[];
  isSelected: (program: BenefitProgramId) => boolean;
  onToggleProgram: (program: BenefitProgramId) => void;
  /** Page 1 "Other" program box, for a form that prints one. */
  otherRequested?: boolean;
  otherDescription?: string;
  onToggleOther?: () => void;
  onOtherDescriptionChange?: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export default function ProgramSelectionStep({
  formCode,
  programs,
  isSelected,
  onToggleProgram,
  otherRequested = false,
  otherDescription = "",
  onToggleOther,
  onOtherDescriptionChange,
  onBack,
  onContinue,
}: ProgramSelectionStepProps) {
  const { t, tn, tReasons } = useTranslation();

  const offersOther = Boolean(onToggleOther);

  const selectedCount =
    programs.filter((program) => isSelected(program.program)).length +
    (offersOther && otherRequested ? 1 : 0);

  return (
    <div
      data-testid="program-selection-step"
      className="space-y-4"
    >
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
          {formCode}
        </p>

        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {t("programs_heading")}
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          {t("programs_intro")}
        </p>

        <div className="mt-6 space-y-3">
          {programs.map((program) => {
            const checked = isSelected(program.program);

            return (
              <label
                key={program.program}
                className="block cursor-pointer rounded-lg border border-slate-200 bg-white p-4 hover:border-green-300"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleProgram(program.program)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-green-700 focus:ring-green-600"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-slate-900">
                          {t(programNameKey(program.program))}
                        </h2>

                        {program.recommendedToApply && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            {t("ui_recommended")}
                          </span>
                        )}
                      </div>

                      <span className="text-xs font-medium text-slate-500">
                        {t(STATUS_LABEL_KEYS[program.status])}
                      </span>
                    </div>

                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                      {tReasons(program.reasons).map((sentence) => (
                        <li key={sentence}>{sentence}</li>
                      ))}
                    </ul>

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
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            {selectedCount === 0
              ? t("prog_none_selected")
              : tn("prog_selected", selectedCount)}
          </p>
        </div>

        {/* Page 1 also offers an "Other" program box with a description. */}
        {offersOther && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={otherRequested}
              onChange={onToggleOther}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-green-700 focus:ring-green-600"
            />
            <span>
              <span className="font-medium text-slate-900">
                {t("programs_other")}
              </span>
              <span className="mt-0.5 block text-xs text-slate-600">
                {t("prog_other_explanation")}
              </span>
            </span>
          </label>

          {otherRequested && (
            <input
              type="text"
              value={otherDescription}
              onChange={(event) =>
                onOtherDescriptionChange?.(event.target.value)
              }
              placeholder={t("programs_other_placeholder")}
              aria-label={t("programs_other_aria")}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
          )}
        </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("programs_back")}
          </button>

          <button
            type="button"
            onClick={onContinue}
            disabled={selectedCount === 0}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("programs_continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
