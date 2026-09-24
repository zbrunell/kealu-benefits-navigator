//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The forms a household needs, as the Python mapping layer describes them.
 *
 * The TypeScript half of the contract in
 * `src/benefits_navigator/formmap/manifest.py`. Field names are snake_case
 * because they arrive as JSON from a Python process and renaming them at the
 * boundary would only give two names for one thing.
 *
 * ── Why the interface is told rather than deciding ─────────────────────────
 * Which physical PDF an applicant receives is decided once, in Python, from
 * what each official document declares it prints. Nothing here re-derives it,
 * and that is deliberate: the obvious TypeScript version of the rule is
 *
 *     locale === 'es' ? theFileNamed('-ES-') : theFileNamed('-EN-')
 *
 * which is now known to be wrong. Texas's H1049 and H3037 are single bilingual
 * documents — one file, both languages, named `-BI-` — so that rule hands a
 * Spanish applicant either the English form or nothing. H1010 genuinely does
 * have two files. No filename pattern distinguishes the two situations, which
 * is why the answer travels as data.
 *
 * ── The three ideas, in the types ──────────────────────────────────────────
 * 1. The **application locale** is `Locale`, in `lib/locale.ts`. It is the
 *    applicant's own choice and governs the interface.
 * 2. The **document language** is `DocumentDescriptor.languages` — what the
 *    paper is printed in, which is a fact about the file.
 * 3. The **physical asset** is `source_filename`, and it is developer-only.
 *
 * Collapsing any two of them is the bug this file exists to make hard.
 */

/** How well the chosen document answers the applicant's language. */
export type LanguageMatch =
  /** The agency publishes a separate edition in their language. */
  | 'exact'
  /** One official document prints their language alongside another. */
  | 'bilingual'
  /** No edition in their language exists; this one is offered, and said. */
  | 'fallback';

/** What role a form plays in a packet. */
export type FormCategory =
  | 'main_application'
  | 'supplemental_application'
  | 'applicant_verification'
  | 'third_party_verification'
  | 'authorization_release'
  | 'optional_supporting';

/** How strongly this household needs this form. */
export type FormRequirement = 'required' | 'needs_confirmation' | 'optional';

/** The physical document an applicant receives for one form. */
export interface DocumentDescriptor {
  /**
   * Every language the document itself prints, as BCP-47 tags.
   *
   * The list, not the matched one. `['en', 'es']` is what lets a card say
   * "English & Spanish" rather than picking one and implying the other is
   * missing.
   */
  languages: string[];
  /** True when one asset serves several languages. */
  is_bilingual: boolean;
  language_match: LanguageMatch;
  /** Whether the applicant can read the paper they were handed. */
  is_in_applicants_language: boolean;
  /**
   * Catalog key naming a limitation, or null when there is none.
   *
   * Set only for a genuine fallback. A bilingual document carries `note_key`
   * instead — "the agency publishes this in both languages" is information,
   * not a shortfall, and showing the fallback wording for it would tell a
   * Spanish reader their form is English-only while handing them the agency's
   * own Spanish text.
   */
  limitation_key: string | null;
  /** Catalog key for a positive statement about the document's language. */
  note_key: string | null;
  /** Catalog key qualifying a partly-bilingual document, or null. */
  scope_note_key: string | null;
  /** The filename the applicant sees when they save it. */
  download_name: string;
  /**
   * The canonical storage name.
   *
   * **Never rendered to an applicant.** It exists for logs, developer tooling
   * and debug surfaces. `download_name` is what a person sees.
   */
  source_filename: string;
  /** What the document prints about its own revision, e.g. "12/2001". */
  printed_revision: string;
  /** The first-party page it was retrieved from. */
  source_url: string;
}

/** How far a prepared document got. */
export interface PrefillStatus {
  /** Boxes our answers filled. */
  filled: number;
  /** Boxes this form maps in total. */
  mapped: number;
  /** Whether the values sit on the agency's own paper. */
  is_official_document: boolean;
  /** Boxes left for someone else, by catalog key. */
  left_for_others: Record<string, number>;
}

/** One form in a household's packet, ready to render. */
export interface FormManifestEntry {
  form_id: string;
  /**
   * The agency's own designation — "H1010".
   *
   * Never translated. An applicant searching a county website for
   * "Formulario H1010" finds nothing; the interface composes its own localized
   * label *around* this string.
   */
  form_code: string;
  /** The agency's own title, in the document's language. */
  title: string;
  state: string;
  category: FormCategory;
  requirement: FormRequirement;
  /** Catalog key for why this form is in the packet. */
  reason_key: string;
  /** Catalog key for what the form is for, in plain language. */
  purpose_key: string;
  /** The household's own selected programmes that this form serves. */
  programs: string[];
  can_be_prepared: boolean;
  unavailable_reason_key: string | null;
  document: DocumentDescriptor | null;
  prefill: PrefillStatus | null;
}

/**
 * Narrow an unknown value to a manifest, dropping anything malformed.
 *
 * The manifest crosses a process boundary, so it is parsed rather than
 * trusted. Malformed entries are dropped instead of throwing: the cards are
 * presentation, and losing one is a much smaller failure than losing the
 * document the applicant came for.
 */
export function parseFormManifest(value: unknown): FormManifestEntry[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isManifestEntry);
}

function isManifestEntry(value: unknown): value is FormManifestEntry {
  if (typeof value !== 'object' || value === null) return false;

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.form_id === 'string'
    && typeof entry.form_code === 'string'
    && typeof entry.requirement === 'string'
    && (entry.document === null || typeof entry.document === 'object')
  );
}

/**
 * The catalog key naming the document's language, for a card's language chip.
 *
 * The one function that turns a document's declared languages into something a
 * person reads, and the reason it is a function rather than a lookup on the
 * locale: a bilingual document gets its own label. Showing "English" for a
 * document that prints both — because English happens to be first in the list
 * — is the exact misreport this whole change removes.
 */
export function documentLanguageKey(document: DocumentDescriptor): string {
  if (document.is_bilingual) return 'form_card_language_en_es';

  const language = document.languages[0] ?? 'en';

  return `form_card_language_${language.replace('-', '_').toLowerCase()}`;
}
