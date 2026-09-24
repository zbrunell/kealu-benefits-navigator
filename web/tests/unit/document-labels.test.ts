//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * How a document is described to the person receiving it.
 *
 * Everything here guards one rule: the interface displays what the *document*
 * declares it prints, and never derives a language or a file from the
 * applicant's locale.
 *
 * The rule this replaced was `locale === 'es' ? '-ES-' : '-EN-'`. It is right
 * for Texas H1010, which really has two files, and wrong for H1049 and H3037,
 * which are single bilingual PDFs named `-BI-` — so it handed a Spanish
 * applicant the English form, or nothing. No filename pattern separates those
 * two cases, which is why these tests assert on declared languages rather than
 * on names.
 */

import { describe, expect, it } from 'vitest';

import { messages, t } from '@/i18n';
import {
  draftDownloadName,
  hasLanguageShortfall,
  languageLabelKey,
  languageNoteKey,
  mainApplicationOf,
  officialDownloadName,
  requirementLabelKey,
  supportingFormsOf,
} from '@/lib/document-labels';
import {
  documentLanguageKey,
  parseFormManifest,
  type DocumentDescriptor,
  type FormManifestEntry,
} from '@/types/form-manifest';

function descriptor(
  over: Partial<DocumentDescriptor> = {},
): DocumentDescriptor {
  return {
    languages: ['en'],
    is_bilingual: false,
    language_match: 'exact',
    is_in_applicants_language: true,
    limitation_key: null,
    note_key: null,
    scope_note_key: null,
    download_name: 'Texas-H1010-Application-English.pdf',
    source_filename: 'TX-H1010-EN-2026-08.pdf',
    printed_revision: '08/2026',
    source_url: 'https://example.test/form',
    ...over,
  };
}

function entry(over: Partial<FormManifestEntry> = {}): FormManifestEntry {
  return {
    form_id: 'TX_H1010',
    form_code: 'H1010',
    title: 'Texas Works Application for Assistance',
    state: 'TX',
    category: 'main_application',
    requirement: 'required',
    reason_key: 'tx_h1010_required_for_selected_programs',
    purpose_key: 'form_purpose_tx_h1010',
    programs: ['tx_snap'],
    can_be_prepared: true,
    unavailable_reason_key: null,
    document: descriptor(),
    prefill: null,
    ...over,
  };
}

/** The Spanish H1010: a genuinely separate official edition. */
const SPANISH_H1010 = descriptor({
  languages: ['es'],
  download_name: 'Texas-H1010-Application-Spanish.pdf',
  source_filename: 'TX-H1010-ES-2026-08.pdf',
});

/** H1049: one bilingual document, served to both languages. */
const BILINGUAL_H1049 = descriptor({
  languages: ['en', 'es'],
  is_bilingual: true,
  language_match: 'bilingual',
  note_key: 'form_document_officially_bilingual',
  download_name: 'Texas-H1049-Bilingual.pdf',
  source_filename: 'TX-H1049-BI-2001-12.pdf',
  printed_revision: '12/2001',
});

/** H1028-MBIC for a Spanish reader: a real fallback, and said so. */
const FALLBACK_H1028 = descriptor({
  languages: ['en'],
  language_match: 'fallback',
  is_in_applicants_language: false,
  limitation_key: 'form_document_language_fallback',
  download_name: 'Texas-H1028-MBIC-English.pdf',
  source_filename: 'TX-H1028-MBIC-EN-2015-12.pdf',
});

describe('the language a card shows', () => {
  it('names a monolingual document by its own language', () => {
    expect(languageLabelKey(descriptor())).toBe('form_card_language_en');
    expect(languageLabelKey(SPANISH_H1010)).toBe('form_card_language_es');
  });

  it('gives a bilingual document its own label, not its first language', () => {
    /*
     * The sharp one. `languages[0]` is 'en', so a naive implementation labels
     * HHSC's bilingual form "English" — which to a Spanish reader looks exactly
     * like the fallback we are at pains not to give them.
     */
    expect(languageLabelKey(BILINGUAL_H1049)).toBe('form_card_language_en_es');
    expect(languageLabelKey(BILINGUAL_H1049)).not.toBe(
      'form_card_language_en',
    );
  });

  it('reads "English & Spanish" in English and "Inglés y español" in Spanish', () => {
    const key = languageLabelKey(BILINGUAL_H1049);

    expect(t(messages.en, key)).toBe('English & Spanish');
    expect(t(messages.es, key)).toBe('Inglés y español');
  });

  it('names the language in the reader’s own language', () => {
    // A Spanish reader with the Spanish H1010 sees "Español" — the label from
    // the requirement's own worked example.
    expect(t(messages.es, languageLabelKey(SPANISH_H1010))).toBe('Español');
    expect(t(messages.en, languageLabelKey(SPANISH_H1010))).toBe('Spanish');
  });

  it('exposes the same rule from the manifest module', () => {
    // Two call sites, one answer. A second implementation is how the card and
    // the download name get to disagree.
    for (const document of [descriptor(), SPANISH_H1010, BILINGUAL_H1049]) {
      expect(documentLanguageKey(document)).toBe(languageLabelKey(document));
    }
  });
});

describe('bilingual is never reported as a fallback', () => {
  it('gives a bilingual document the bilingual note, not the limitation', () => {
    expect(languageNoteKey(BILINGUAL_H1049)).toBe(
      'form_document_officially_bilingual',
    );
    expect(languageNoteKey(BILINGUAL_H1049)).not.toBe(
      'form_document_language_fallback',
    );
  });

  it('does not treat a bilingual document as a shortfall', () => {
    expect(hasLanguageShortfall(BILINGUAL_H1049)).toBe(false);
  });

  it('reads as a property of the agency’s form, not an apology', () => {
    expect(t(messages.en, 'form_document_officially_bilingual')).toBe(
      'Official bilingual form',
    );
    expect(t(messages.es, 'form_document_officially_bilingual')).toBe(
      'Formulario oficial bilingüe',
    );
  });

  it('says nothing at all when the form is simply in their language', () => {
    expect(languageNoteKey(descriptor())).toBeNull();
    expect(languageNoteKey(SPANISH_H1010)).toBeNull();
    expect(hasLanguageShortfall(SPANISH_H1010)).toBe(false);
  });

  it('states the limitation when English really is a fallback', () => {
    /*
     * The opposite case, and it must stay distinguishable: H1028-MBIC has no
     * Spanish edition, so English *is* a shortfall. Collapsing this with the
     * bilingual case would make one of the two a lie.
     */
    expect(hasLanguageShortfall(FALLBACK_H1028)).toBe(true);
    expect(languageNoteKey(FALLBACK_H1028)).toBe(
      'form_document_language_fallback',
    );
  });

  it('never uses the same sentence for bilingual and fallback', () => {
    for (const locale of ['en', 'es'] as const) {
      expect(t(messages[locale], 'form_document_officially_bilingual')).not.toBe(
        t(messages[locale], 'form_document_language_fallback'),
      );
    }
  });
});

describe('download filenames', () => {
  it('names the applicant’s prepared worksheet by its language', () => {
    expect(
      draftDownloadName({
        definition: null,
        formType: 'worksheet',
        packet: [entry({ document: SPANISH_H1010 })],
      }),
    ).toBe('Texas-H1010-Application-Spanish-Worksheet-Draft.pdf');

    expect(
      draftDownloadName({
        definition: null,
        formType: 'worksheet',
        packet: [entry()],
      }),
    ).toBe('Texas-H1010-Application-English-Worksheet-Draft.pdf');
  });

  it('keeps "worksheet" out of an official document’s name and in a worksheet’s', () => {
    const packet = [entry()];

    expect(
      draftDownloadName({ definition: null, formType: 'official', packet }),
    ).toContain('Prefilled-Draft');
    expect(
      draftDownloadName({ definition: null, formType: 'worksheet', packet }),
    ).toContain('Worksheet-Draft');
  });

  it('names a bilingual document Bilingual rather than English', () => {
    expect(officialDownloadName(entry({ document: BILINGUAL_H1049 }))).toBe(
      'Texas-H1049-Bilingual.pdf',
    );
  });

  it('leaks no canonical storage name, language code or revision', () => {
    const names = [
      officialDownloadName(entry()),
      officialDownloadName(entry({ document: SPANISH_H1010 })),
      officialDownloadName(entry({ document: BILINGUAL_H1049 })),
      draftDownloadName({
        definition: null,
        formType: 'worksheet',
        packet: [entry({ document: BILINGUAL_H1049 })],
      }),
    ];

    for (const name of names) {
      for (const leak of ['-BI-', '-ES-', '-EN-', '2001-12', '2026-08']) {
        expect(name, name).not.toContain(leak);
      }
    }
  });

  it('falls back to the form code when there is no manifest', () => {
    // Naming a file is not worth failing a download over.
    expect(
      draftDownloadName({
        definition: {
          state: 'CA',
          formId: 'CA_SAWS_2_PLUS',
          formCode: 'SAWS 2 PLUS',
          formNameKey: 'app_ca_saws2plus_name',
          delivery: 'generated',
          programs: [],
          officialUrl: 'https://benefitscal.com/',
          channels: [],
          howToApplyKey: 'app_ca_how_to_apply',
        },
        formType: 'official',
        packet: [],
      }),
    ).toBe('partially-prefilled-saws-2-plus-draft.pdf');
  });
});

describe('the packet the cards render', () => {
  const packet: FormManifestEntry[] = [
    entry(),
    entry({
      form_id: 'TX_H1049',
      form_code: 'H1049',
      category: 'applicant_verification',
      requirement: 'needs_confirmation',
      reason_key: 'tx_h1049_self_employment_reported',
      purpose_key: 'form_purpose_tx_h1049',
      document: BILINGUAL_H1049,
    }),
  ];

  it('separates the application from what supports it', () => {
    expect(mainApplicationOf(packet)?.form_code).toBe('H1010');
    expect(supportingFormsOf(packet).map((f) => f.form_code)).toEqual([
      'H1049',
    ]);
  });

  it('does not badge a form we may be asked for as required', () => {
    const supporting = supportingFormsOf(packet)[0];

    expect(t(messages.en, requirementLabelKey(supporting))).toBe(
      'You may be asked for this',
    );
    expect(t(messages.es, requirementLabelKey(supporting))).toBe(
      'Se lo podrían pedir',
    );
  });

  it('translates every key an entry carries, in every locale', () => {
    for (const locale of ['en', 'es', 'zh-CN'] as const) {
      for (const item of packet) {
        expect(t(messages[locale], item.purpose_key)).toBeTruthy();
        expect(t(messages[locale], item.reason_key)).toBeTruthy();
        expect(t(messages[locale], requirementLabelKey(item))).toBeTruthy();

        if (item.document) {
          expect(
            t(messages[locale], languageLabelKey(item.document)),
          ).toBeTruthy();

          const note = languageNoteKey(item.document);

          if (note) expect(t(messages[locale], note)).toBeTruthy();
        }
      }
    }
  });
});

describe('the manifest is parsed, not trusted', () => {
  it('drops malformed entries rather than throwing', () => {
    // It crossed a process boundary. A bad card must not break a page.
    expect(parseFormManifest(null)).toEqual([]);
    expect(parseFormManifest('nope')).toEqual([]);
    expect(parseFormManifest([{ nonsense: true }, entry()])).toHaveLength(1);
  });

  it('keeps a well-formed entry intact', () => {
    expect(parseFormManifest([entry()])[0].form_code).toBe('H1010');
  });
});
