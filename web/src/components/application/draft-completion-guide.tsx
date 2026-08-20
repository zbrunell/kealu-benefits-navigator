//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useTranslation } from "@/hooks/use-translation";

/**
 * What the applicant must do after the partially prefilled SAWS 2 PLUS draft is
 * generated, followed by where to submit it.
 *
 * Scope rules for this component:
 *
 * - It lists only work our UI genuinely cannot do: Social Security Numbers and
 *   signatures (both deliberately never collected), plus review, certifications,
 *   and supporting documents. Anything a normal applicant could answer belongs
 *   in the application flow instead of in this list.
 * - Submission destinations are never invented. BenefitsCal is the statewide
 *   portal California uses for CalFresh, CalWORKs, and Medi-Cal; the county name
 *   comes from the ZIP code the applicant entered. When the county could not be
 *   resolved, the guide explains how to find the right office instead of
 *   guessing an address, phone number, or fax.
 */

/** Statewide California portal for CalFresh / CalWORKs / Medi-Cal applications. */
const BENEFITSCAL_URL = "https://benefitscal.com/";

/** Statewide Medi-Cal / health coverage portal. */
const COVERED_CA_URL = "https://www.coveredca.com/";

interface DraftCompletionGuideProps {
  /** URL of the generated draft on this session's run. */
  draftUrl: string;
  /**
   * URL of the printable completion guide for this same draft.
   *
   * Built server-side from the state the PDF was generated from, so the two
   * always describe the same document.
   */
  guideUrl: string;
  /** Short, non-sensitive identifier printed on both the guide and shown here. */
  draftReference: string;
  /** County resolved from the applicant's ZIP code, or "" when unresolved. */
  county: string;
  /** Whether the application includes a health-coverage program. */
  includesHealthCoverage: boolean;
  /**
   * Printed questions this draft leaves blank, in the applicant's words.
   *
   * Naming them is the difference between "complete anything we missed" and a
   * checklist the applicant can actually work through.
   */
  questionsToCompleteByHand: string[];
}

/**
 * The steps only a person can do, as catalog keys.
 *
 * Keys rather than prose because this list is read by the applicant: it has to
 * appear in their language, and a component-local English array cannot do that.
 */
const MANUAL_STEP_KEYS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: 'dcg_step_review_title', detail: 'dcg_step_review_detail' },
  { title: 'dcg_step_ssn_title', detail: 'dcg_step_ssn_detail' },
  { title: 'dcg_step_sign_title', detail: 'dcg_step_sign_detail' },
  { title: 'dcg_step_rules_title', detail: 'dcg_step_rules_detail' },
  { title: 'dcg_step_questions_title', detail: 'dcg_step_questions_detail' },
  { title: 'dcg_step_documents_title', detail: 'dcg_step_documents_detail' },
];

export default function DraftCompletionGuide({
  draftUrl,
  guideUrl,
  draftReference,
  county,
  includesHealthCoverage,
  questionsToCompleteByHand,
}: DraftCompletionGuideProps) {
  const { t } = useTranslation();

  const countyLabel = county.trim();

  return (
    <div className="mt-4 space-y-4">
      {/* ── Download ─────────────────────────────────────────────────────── */}
      <div
        className="rounded-lg border border-green-300 bg-green-50 p-4"
        data-testid="draft-download"
      >
        <p className="text-sm font-semibold text-green-900">
          {t("dcg_ready")}
        </p>

        <p className="mt-1 text-sm text-green-800">
          {t("dcg_official_note")}
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href={draftUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
          >
            {t("dcg_open_draft")}
          </a>

          <a
            href={`${draftUrl}?download=1`}
            className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
          >
            {t("dcg_download_draft")}
          </a>
        </div>

        <p className="mt-3 text-xs text-green-800">
          Draft reference{" "}
          <span className="font-mono font-semibold">{draftReference}</span>. The
          same reference is printed on the guide below, so you can tell which
          guide goes with which draft if you generate more than one.
        </p>
      </div>

      {/* ── The printable guide for this draft ───────────────────────────── */}
      <div
        className="rounded-lg border border-slate-300 bg-white p-4"
        data-testid="completion-guide-download"
      >
        <h2 className="text-sm font-semibold text-slate-900">
          {t("dcg_take_guide")}
        </h2>

        <p className="mt-1 text-sm text-slate-700">
          {t("dcg_guide_intro")}
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href={guideUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
          >
            {t("dcg_open_guide")}
          </a>

          <a
            href={`${guideUrl}?download=1`}
            download
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            {t("dcg_download_guide")}
          </a>

          <a
            href={`${guideUrl}?audience=associate`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            {t("dcg_helper_guide")}
          </a>
        </div>

        <p className="mt-3 text-xs text-slate-600">
          Open the guide and use your browser&rsquo;s Print command to print it
          or save it as a PDF. It is laid out for US Letter paper.
        </p>
      </div>

      {/* ── What you must finish by hand ─────────────────────────────────── */}
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-4"
        data-testid="manual-completion-guide"
      >
        <h2 className="text-sm font-semibold text-amber-900">
          {t("dcg_finish_by_hand")}
        </h2>

        <ol className="mt-3 space-y-3">
          {MANUAL_STEP_KEYS.map((step, index) => (
            <li key={t(step.title)} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-semibold text-amber-900"
              >
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-medium text-amber-900">
                  {t(step.title)}
                </span>
                <span className="block text-sm text-amber-800">
                  {t(step.detail)}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {questionsToCompleteByHand.length > 0 && (
          <div
            className="mt-4 rounded-lg border border-amber-300 bg-white p-3"
            data-testid="questions-to-complete-by-hand"
          >
            <p className="text-sm font-medium text-amber-900">
              Printed questions left blank ({questionsToCompleteByHand.length})
            </p>

            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {questionsToCompleteByHand.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Where to submit ─────────────────────────────────────────────── */}
      <div
        className="rounded-lg border border-blue-200 bg-blue-50 p-4"
        data-testid="submission-instructions"
      >
        <h2 className="text-sm font-semibold text-blue-900">
          {t("dcg_where_to_submit")}
        </h2>

        <p className="mt-2 text-sm text-blue-900">
          {countyLabel
            ? `Your ZIP code is in ${countyLabel} County, so ${countyLabel} County processes your application.`
            : "We could not determine your county from your ZIP code, so check which county serves your address before you submit."}
        </p>

        <ul className="mt-3 space-y-2 text-sm text-blue-900">
          <li>
            <span className="font-medium">Online (fastest): </span>
            submit through BenefitsCal, California&rsquo;s statewide portal for
            CalFresh, CalWORKs, and Medi-Cal —{" "}
            <a
              href={BENEFITSCAL_URL}
              target="_blank"
              rel="noreferrer"
              className="underline hover:no-underline"
            >
              benefitscal.com
            </a>
            . You can upload your signed pages and documents there.
          </li>

          <li>
            <span className="font-medium">
              In person, by mail, or by fax:{" "}
            </span>
            {countyLabel
              ? `send or take the signed application to a ${countyLabel} County social services office. Find that office's current address, mailing address, and fax number on BenefitsCal or on the county's official website — we do not guess contact details, because sending an application to the wrong address delays it.`
              : "send or take the signed application to your county's social services office. Look up the correct office through BenefitsCal after entering your address."}
          </li>

          {includesHealthCoverage && (
            <li>
              <span className="font-medium">Health coverage only: </span>
              Medi-Cal and other health coverage can also be applied for through{" "}
              <a
                href={COVERED_CA_URL}
                target="_blank"
                rel="noreferrer"
                className="underline hover:no-underline"
              >
                coveredca.com
              </a>
              .
            </li>
          )}
        </ul>

        <p className="mt-3 text-xs text-blue-800">
          {t("dcg_submit_asap")} For CalFresh, your benefits start from the date the county
          receives your application, even if some documents arrive later.
        </p>
      </div>
    </div>
  );
}
