//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

/**
 * What the applicant gets, once the Texas document exists.
 *
 * Two links and one sentence they have to read. The sentence is the important
 * part: HHSC publishes H1010 only through a web application, so what we produce
 * is a prefilled worksheet carrying their answers rather than the agency's own
 * paper. Saying that here, at the moment they download it, is the difference
 * between a useful transcription aid and a document someone posts to a county
 * office and hears nothing about.
 *
 * Deliberately not `DraftCompletionGuide`, which is California's: that component
 * lists the printed SAWS 2 PLUS questions a draft leaves blank, computed from
 * the SAWS readiness model. Texas's equivalent already exists and is better —
 * the review sheet the generator writes beside the PDF, which names what was
 * filled, what is optional, what is not applicable and why, and anything too
 * long for its printed box. It is served by the guide route.
 */

import { useTranslation } from "@/hooks/use-translation";

export default function TexasDraftPanel({
  draftUrl,
  guideUrl,
}: {
  draftUrl: string;
  guideUrl: string;
}) {
  const { t } = useTranslation();

  return (
    <section
      data-testid="tx-draft-ready"
      className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4"
    >
      <h2 className="font-semibold text-green-900">{t("tx_draft_ready")}</h2>

      <p className="mt-1 text-sm text-green-900">{t("tx_draft_worksheet")}</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={`${draftUrl}?download=1`}
          data-testid="tx-draft-download"
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          {t("tx_draft_download")}
        </a>

        <a
          href={guideUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="tx-review-open"
          className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          {t("tx_draft_open_review")}
        </a>

        <a
          href="https://www.yourtexasbenefits.com/"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="tx-official-link"
          className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          {t("tx_draft_official_link")}
        </a>
      </div>

      <p className="mt-3 text-xs text-green-900">{t("tx_draft_next_steps")}</p>
    </section>
  );
}
