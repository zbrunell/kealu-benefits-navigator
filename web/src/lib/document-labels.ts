//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * How a document is described to the person receiving it.
 *
 * One module, so that "which language is this form in" is answered the same way
 * on the card, in the download filename and in the completion guide. When those
 * three disagree the applicant is the one who finds out.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * Every answer here comes from the manifest the Python layer produced — from
 * what the *document* declares it prints. Nothing is derived from the
 * applicant's locale, and nothing is derived from a filename. The rule this
 * replaces was
 *
 *     locale === 'es' ? '-ES-' : '-EN-'
 *
 * which is wrong for Texas H1049 and H3037: they are single bilingual PDFs
 * named `-BI-`, so the rule found no Spanish file and fell back to English for
 * an applicant who was never being short-changed. It is right for H1010, which
 * really does have two files. No naming pattern separates those two cases,
 * which is why the interface is told rather than guessing.
 *
 * ── What never reaches an applicant ────────────────────────────────────────
 * `BI`, `EN`, `ES`, `TX-H1049-BI-2001-12.pdf`, `exact`, `bilingual`,
 * `fallback`, `TX_H1010`. Those are all internal. What a person sees is a form
 * name, a form number, a language in words, and a filename they could read out
 * over the phone.
 */

import type { StateApplicationDefinition } from '@/lib/state-applications';
import type {
  DocumentDescriptor,
  FormManifestEntry,
} from '@/types/form-manifest';

/** The manifest entry for a state's main application, if the packet has one. */
export function mainApplicationOf(
  packet: readonly FormManifestEntry[],
): FormManifestEntry | null {
  return (
    packet.find((entry) => entry.category === 'main_application') ?? null
  );
}

/** Supporting forms, in the order the packet planner put them. */
export function supportingFormsOf(
  packet: readonly FormManifestEntry[],
): FormManifestEntry[] {
  return packet.filter((entry) => entry.category !== 'main_application');
}

/**
 * The catalog key for the language chip on a card.
 *
 * A bilingual document gets its own label rather than the first language in its
 * list. "English" on a document that prints both would be the misreport this
 * whole change exists to remove — and for a Spanish reader it would look like
 * exactly the English fallback we are at pains not to give them.
 */
export function languageLabelKey(document: DocumentDescriptor): string {
  if (document.is_bilingual) return 'form_card_language_en_es';

  const language = (document.languages[0] ?? 'en')
    .replace('-', '_')
    .toLowerCase();

  return `form_card_language_${language}`;
}

/**
 * The catalog key for the sentence explaining the document's language, if any.
 *
 * Three outcomes and three different sentences, because they mean different
 * things to the reader:
 *
 * - **exact** — nothing to say. The form is in their language; the chip already
 *   said so, and a sentence explaining it would imply something was in doubt.
 * - **bilingual** — "official bilingual form". Information, and phrased as a
 *   property of the agency's document rather than as anything about us.
 * - **fallback** — the limitation, stated plainly.
 *
 * The bilingual and fallback cases must never share wording. That is the
 * confusing-English-fallback-messaging problem by name: telling someone holding
 * HHSC's own Spanish text that their form is not published in Spanish.
 */
export function languageNoteKey(
  document: DocumentDescriptor,
): string | null {
  if (document.limitation_key) return document.limitation_key;

  return document.note_key;
}

/**
 * Is this document's language worth flagging as a shortfall?
 *
 * Used to choose a card's tone — an advisory panel rather than a neutral chip.
 * True only for a real fallback, so a bilingual form never renders as a
 * degraded outcome.
 */
export function hasLanguageShortfall(document: DocumentDescriptor): boolean {
  return !document.is_in_applicants_language;
}

/**
 * The filename an applicant sees when they save their prepared draft.
 *
 * Prefers the name the manifest computed for the main application, because that
 * name is derived from the document's own declared languages — so a Spanish
 * applicant's file is `-Spanish`, and a bilingual form's is `-Bilingual`
 * instead of a language it only half is.
 *
 * The `-draft` suffix is added here and not in Python: it is a statement about
 * *this* file, which carries the applicant's answers and is not the blank
 * official document. The blank one is served under the manifest name as-is.
 *
 * Falls back to the old form-code name when there is no manifest — a state with
 * no forms catalog, or a generation that predates one. Naming a file is not
 * worth failing a download over.
 */
export function draftDownloadName(params: {
  definition: StateApplicationDefinition | null;
  formType: 'official' | 'worksheet';
  packet: readonly FormManifestEntry[];
}): string {
  const { definition, formType, packet } = params;
  const main = mainApplicationOf(packet);
  const named = main?.document?.download_name;

  if (named) {
    const stem = named.replace(/\.pdf$/i, '');

    /*
     * "worksheet" and "official" are genuinely different documents and the
     * filename says which. A worksheet named as though it were the agency's
     * form is the failure this whole flow warns about in prose; it should not
     * be undone by the filename.
     */
    return formType === 'official'
      ? `${stem}-Prefilled-Draft.pdf`
      : `${stem}-Worksheet-Draft.pdf`;
  }

  const slug = definition
    ? definition.formCode.trim().toLowerCase().replace(/\s+/g, '-')
    : '';

  if (!slug) return 'benefits-preparation-worksheet-draft.pdf';

  return formType === 'official'
    ? `partially-prefilled-${slug}-draft.pdf`
    : `${slug}-worksheet-draft.pdf`;
}

/**
 * The filename for a blank official document handed over as-is.
 *
 * Used by the official-form route. No `-draft` suffix, because nothing has been
 * added to it: this is the agency's own paper, in the applicant's language.
 */
export function officialDownloadName(entry: FormManifestEntry): string {
  return entry.document?.download_name
    ?? `${entry.state}-${entry.form_code}.pdf`;
}

/**
 * Requirement → the catalog key for its badge.
 *
 * `needs_confirmation` deliberately does not read as "required". A household
 * with self-employment income *may* be asked for H1049 and may instead attach a
 * tax return, and a badge saying "Required" would be assigning work on our own
 * authority rather than the agency's.
 */
export function requirementLabelKey(entry: FormManifestEntry): string {
  return `form_card_requirement_${entry.requirement}`;
}
