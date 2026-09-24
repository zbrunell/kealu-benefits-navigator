//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * One form in the applicant's packet, as a card they can act on.
 *
 * The problem this solves is not layout. Before it, a Texas household reached
 * the end of the flow and got two links and a sentence — and everything that
 * made the paperwork comprehensible lived in a review sheet they had to open,
 * or nowhere at all. Which forms are these? Which one is the application?
 * What is this one for? What language is it in? Is it filled in?
 *
 * ── The one rule ───────────────────────────────────────────────────────────
 * Nothing internal reaches the screen. Not `BI`, `EN`, `ES`, `exact`,
 * `bilingual`, `fallback`, `TX_H1010`, and above all not
 * `TX-H1049-BI-2001-12.pdf`. An applicant is holding a government form; the
 * naming scheme of our forms directory is not their problem. What they see is:
 *
 *     Solicitud de beneficios de Texas      ← the form, named
 *     Formulario H1010                      ← the number a county recognises
 *     Español                               ← the language, in words
 *     Agregamos su información…             ← what state it is in
 *     [Abrir solicitud] [Descargar…]        ← one obvious action
 *
 * ── Language is displayed, never derived ───────────────────────────────────
 * Every language answer comes from the manifest, which got it from what the
 * *document* declares it prints. This component never looks at the locale to
 * decide what a document is. That distinction is the entire bug it was written
 * for: H1049 and H3037 are single bilingual PDFs, so a Spanish reader gets the
 * agency's own Spanish wording and must be told "Official bilingual form" —
 * never the fallback notice, which would say their language is not published
 * while they hold text in it.
 *
 * So there are three presentations and they are visually distinct:
 *
 * - **in their language** — a plain chip. Nothing to explain.
 * - **officially bilingual** — the chip plus a neutral note. Information, not
 *   a shortfall, and deliberately not styled as a warning.
 * - **a real fallback** — an amber advisory. The only case where the document's
 *   language is a limitation, and it says so plainly.
 */

import { useTranslation } from '@/hooks/use-translation';
import {
  hasLanguageShortfall,
  languageLabelKey,
  languageNoteKey,
  requirementLabelKey,
} from '@/lib/document-labels';
import { programNameKey } from '@/lib/state-applications';
import type { FormManifestEntry } from '@/types/form-manifest';

export interface FormCardProps {
  entry: FormManifestEntry;

  /**
   * Where the primary action goes, or null when there is nothing to open.
   *
   * Null for a form we hold no document for, and for one we refuse to prepare.
   * The card still renders — "this form exists and you may be asked for it" is
   * worth saying — with the reason in place of the buttons.
   */
  href: string | null;

  /**
   * Whether the primary action opens the applicant's *prepared* document.
   *
   * Changes the verb, because the two are different promises: "Open
   * application" for something carrying their answers, "Open form" for the
   * agency's blank paper.
   */
  isPrepared: boolean;

  /** Emphasis for the main application, which is the one they must file. */
  emphasis?: boolean;

  testId?: string;
}

/** The dot colour for a requirement. Never the only signal — a word follows. */
const REQUIREMENT_TONE: Readonly<Record<string, string>> = {
  required: 'bg-green-100 text-green-900 ring-green-200',
  needs_confirmation: 'bg-amber-100 text-amber-900 ring-amber-200',
  optional: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export default function FormCard({
  entry,
  href,
  isPrepared,
  emphasis = false,
  testId,
}: FormCardProps) {
  const { t, tv } = useTranslation();

  const document = entry.document;
  const shortfall = document ? hasLanguageShortfall(document) : false;
  const noteKey = document ? languageNoteKey(document) : null;

  const programs = entry.programs
    .map((program) => t(programNameKey(program)))
    .filter(Boolean);

  return (
    <article
      data-testid={testId ?? `form-card-${entry.form_code.toLowerCase()}`}
      data-form-code={entry.form_code}
      /*
       * The document's language, for tests and assistive tooling — the one
       * place a language *tag* is legitimate, because it is metadata rather
       * than something read aloud as a label.
       */
      data-document-language={document?.languages.join('+') ?? ''}
      data-bilingual={document?.is_bilingual ? 'true' : 'false'}
      className={`rounded-xl border p-5 ${
        emphasis
          ? 'border-green-300 bg-white shadow-sm'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/*
            The agency's own title, and then its own designation beneath. The
            title is in the document's language because it is the document's
            title — an applicant looking for it on a county desk needs the
            words that are actually printed on it.
          */}
          <h3 className="text-base font-semibold text-slate-900">
            {entry.title}
          </h3>

          <p
            data-testid={`form-card-code-${entry.form_code.toLowerCase()}`}
            className="mt-0.5 text-sm text-slate-500"
          >
            {entry.form_code}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
            REQUIREMENT_TONE[entry.requirement] ?? REQUIREMENT_TONE.optional
          }`}
        >
          {t(requirementLabelKey(entry))}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-700">{t(entry.purpose_key)}</p>

      {/* Why this form is in *their* packet, from their own answers. */}
      <p className="mt-2 text-sm text-slate-600">{t(entry.reason_key)}</p>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {programs.length > 0 && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              {t('form_card_program_label')}
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {programs.join(', ')}
            </dd>
          </div>
        )}

        {document && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              {t('form_card_language_label')}
            </dt>
            <dd
              data-testid={`form-card-language-${entry.form_code.toLowerCase()}`}
              className="mt-0.5 font-medium text-slate-900"
            >
              {t(languageLabelKey(document))}
            </dd>
          </div>
        )}
      </dl>

      {/*
        The bilingual note. Neutral on purpose: a slate chip, not an amber
        panel. "Official bilingual form" describes the agency's document and
        must not read as an apology — that is the confusing-fallback-messaging
        problem, and the two cases are rendered by different branches below so
        they cannot converge.
      */}
      {document && !shortfall && noteKey && (
        <p
          data-testid={`form-card-bilingual-${entry.form_code.toLowerCase()}`}
          className="mt-3 inline-flex rounded-md bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200"
        >
          {t(noteKey)}
        </p>
      )}

      {/* Where a partly-bilingual document's coverage stops. */}
      {document?.scope_note_key && !shortfall && (
        <p className="mt-2 text-xs text-slate-500">
          {t(document.scope_note_key)}
        </p>
      )}

      {/* The only case where the document's language is a limitation. */}
      {document && shortfall && noteKey && (
        <p
          data-testid={`form-card-fallback-${entry.form_code.toLowerCase()}`}
          role="note"
          className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200"
        >
          {t(noteKey)}
        </p>
      )}

      {/* What state the document is in. */}
      <p className="mt-3 text-sm text-slate-600">
        {isPrepared
          ? entry.prefill?.is_official_document === false
            ? t('form_card_prefill_worksheet')
            : t('form_card_prefill_done')
          : t('form_card_prefill_blank')}
      </p>

      {entry.prefill && entry.prefill.mapped > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {tv('form_card_prefill_counts', {
            filled: entry.prefill.filled,
            mapped: entry.prefill.mapped,
          })}
        </p>
      )}

      {/* Actions, or the reason there are none. */}
      {href ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`form-card-open-${entry.form_code.toLowerCase()}`}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              emphasis
                ? 'bg-green-700 text-white hover:bg-green-800'
                : 'bg-slate-800 text-white hover:bg-slate-900'
            }`}
          >
            {t(isPrepared ? 'form_card_open' : 'form_card_open_form')}
          </a>

          {/*
            The secondary action, and it earns its place: an applicant who has
            to attach the PDF to a portal upload or take it to an office needs
            the file, not a tab. Anything beyond these two would be clutter on
            a card whose job is to be obvious.
          */}
          <a
            href={`${href}${href.includes('?') ? '&' : '?'}download=1`}
            data-testid={`form-card-download-${entry.form_code.toLowerCase()}`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t(isPrepared ? 'form_card_download' : 'form_card_download_form')}
          </a>
        </div>
      ) : (
        <p
          data-testid={`form-card-unavailable-${entry.form_code.toLowerCase()}`}
          className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200"
        >
          {t('form_card_unavailable')}
          {entry.unavailable_reason_key
            ? ` ${t(entry.unavailable_reason_key)}`
            : ''}
        </p>
      )}
    </article>
  );
}
