//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * What the applicant gets, once the Texas documents exist.
 *
 * This used to be two links and one sentence, and the sentence said the
 * document was a worksheet rather than HHSC's own paper. It is not a worksheet
 * any more: the official H1010 now carries every answer it has a box for, in
 * the applicant's own language, so what they download is the government form.
 *
 * Two links was also never enough to describe a packet. A household with
 * self-employment income and a pregnancy needs three forms, in two different
 * language arrangements, and the old panel said nothing about any of that. So
 * the panel is a card per form, rendered from the manifest the mapping layer
 * resolved during generation. Each card names the form, its number, what it is
 * for, why it is in this household's packet, the programme it serves, and the
 * language of the document — and offers one obvious action.
 *
 * ── Two kinds of document on one screen ────────────────────────────────────
 * - The **prefilled application** — HHSC's Form H1010 with the applicant's
 *   answers on it, served from the draft route. A Spanish applicant gets
 *   HHSC's Spanish edition, never the English one.
 * - The **official blank forms** for what supports it — H1049, H3037 — served
 *   from the form route. We hold these and could not previously hand one over,
 *   which left a household told "you may be asked for Form H1049" to find it
 *   on a catalog that cannot be linked to.
 *
 * What the applicant must still do by hand is not on these cards: it is in the
 * checklist behind "what we filled in, and what is left", which names every
 * remaining box and what to write in it. See `h1010_coverage`.
 *
 * ── Degrading without losing the document ──────────────────────────────────
 * An empty manifest falls back to the plain two-link panel. The manifest is
 * presentation; the PDF is what the applicant came for, and a catalog defect
 * must not cost them the document.
 */

import FormCard from '@/components/application/form-card';
import { useTranslation } from '@/hooks/use-translation';
import { mainApplicationOf, supportingFormsOf } from '@/lib/document-labels';
import { TX_HHSC_SUBMISSION, type TexasHhscOffice } from '@/lib/tx-hhsc-office';
import type { FormManifestEntry } from '@/types/form-manifest';

export default function TexasDraftPanel({
  draftUrl,
  guideUrl,
  packet = [],
  formUrlFor,
  office,
}: {
  draftUrl: string;
  guideUrl: string;

  /**
   * The HHSC benefits office for the applicant's home address, or null when
   * it could not be matched. See `texasHhscOfficeFor`.
   */
  office: TexasHhscOffice | null;

  /** The forms this household needs, as the mapping layer resolved them. */
  packet?: readonly FormManifestEntry[];

  /** Where the blank official document for a form id is served. */
  formUrlFor?: (formId: string) => string;
}) {
  const { t } = useTranslation();

  const main = mainApplicationOf(packet);
  const supporting = supportingFormsOf(packet);

  return (
    <section
      data-testid="tx-draft-ready"
      className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4"
    >
      <h2 className="font-semibold text-green-900">{t('tx_draft_ready')}</h2>

      <p className="mt-1 text-sm text-green-900">{t('tx_draft_worksheet')}</p>

      {/* The prepared document, always. */}
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={`${draftUrl}?download=1`}
          data-testid="tx-draft-download"
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          {t('tx_draft_download')}
        </a>

        <a
          href={guideUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="tx-review-open"
          className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          {t('tx_draft_open_review')}
        </a>
      </div>

      {/*
        * Fax, mail, or in person — the three ways HHSC takes a paper H1010.
        * Not YourTexasBenefits.com, which takes its own online application
        * rather than this PDF, and not 2-1-1, which is a help line.
        */}
      <div className="mt-4 text-sm text-green-900" data-testid="tx-submit">
        <h3 className="font-semibold">{t('tx_submit_heading')}</h3>

        <p className="mt-1">{t('tx_submit_intro')}</p>

        <dl className="mt-2 space-y-2">
          <div data-testid="tx-submit-fax">
            <dt className="font-medium">{t('tx_submit_fax')}</dt>
            <dd>
              {TX_HHSC_SUBMISSION.fax}. {t('tx_submit_fax_note')}
            </dd>
          </div>

          <div data-testid="tx-submit-mail">
            <dt className="font-medium">{t('tx_submit_mail')}</dt>
            {TX_HHSC_SUBMISSION.mailLines.map((line) => (
              <dd key={line}>{line}</dd>
            ))}
          </div>

          <div data-testid="tx-submit-in-person">
            <dt className="font-medium">{t('tx_submit_in_person')}</dt>
            {office ? (
              <>
                <dd data-testid="tx-hhsc-office">
                  {t('tx_submit_office_name')}
                  <br />
                  {office.street}
                  <br />
                  {office.city}, {office.state} {office.zipCode}
                </dd>
                <dd className="text-xs">{t('tx_submit_office_for_address')}</dd>
              </>
            ) : (
              <dd>{t('tx_submit_office_unknown')}</dd>
            )}
          </div>
        </dl>

        <p className="mt-3 text-xs">{t('tx_submit_after')}</p>
      </div>

      {packet.length > 0 && (
        <div className="mt-6 rounded-lg bg-white p-4" data-testid="tx-packet">
          <h3 className="text-base font-semibold text-slate-900">
            {t('packet_heading')}
          </h3>

          <p className="mt-1 text-sm text-slate-600">{t('packet_intro')}</p>

          {main && (
            <>
              <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('packet_main_heading')}
              </h4>

              <div className="mt-2">
                <FormCard
                  entry={main}
                  emphasis
                  /*
                   * The applicant's own prefilled H1010 — HHSC's document with
                   * their answers on it — not the blank official form.
                   *
                   * This card used to point at the blank one, because the
                   * document we generated was a Navigator worksheet and the
                   * blank official form was the only official paper we could
                   * hand over. We now fill the official form itself, so the
                   * primary action is the filled one and `isPrepared` says so.
                   */
                  href={draftUrl}
                  isPrepared
                />
              </div>
            </>
          )}

          {supporting.length > 0 && (
            <>
              <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('packet_supporting_heading')}
              </h4>

              <div className="mt-2 space-y-3">
                {supporting.map((entry) => (
                  <FormCard
                    key={entry.form_id}
                    entry={entry}
                    href={
                      formUrlFor && entry.document && entry.can_be_prepared
                        ? formUrlFor(entry.form_id)
                        : null
                    }
                    isPrepared={false}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
