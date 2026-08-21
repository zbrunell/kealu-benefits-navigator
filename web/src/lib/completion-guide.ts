//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The document that goes with a generated draft.
 *
 * Two people need to know what is still blank on a partly prefilled SAWS 2
 * PLUS, and they need it in different words:
 *
 *   the applicant — what was filled, what to check, where to sign, what to
 *                   attach, and where to send it
 *   the associate — a benefits associate, caseworker or navigator sitting with
 *                   them, who needs the exact page and printed label of every
 *                   blank so they are not hunting through 29 pages
 *
 * Both are built here from the same `assessDraftCompletion` metadata, so they
 * cannot describe different documents, and neither can drift from the PDF
 * adapter: if a mapping changes, the metadata changes, and both guides change
 * with it. A hand-written paragraph would have gone stale the first time a
 * destination moved, which is exactly what happened to the sentence "some
 * printed questions are left blank because we did not collect them".
 *
 * Nothing here invents an address, a phone number, or an agency instruction.
 * The submission section names BenefitsCal and Covered California — the
 * statewide portals California actually uses for these programs — and the
 * county resolved from the applicant's own ZIP code. Where the county is
 * unknown it says how to find the right office rather than guessing one.
 */

import {
  assessDraftCompletion,
  type DraftCompletion,
  type ManualItem,
  type ManualReason,
} from '@/lib/draft-completion';
import type { ApplicationFieldPlanEntry } from '@/lib/application-mapper';
import { documentLanguageFor, DEFAULT_LOCALE, type Locale } from '@/lib/locale';
import { interpolate, messages, t } from '@/i18n';
import {
  PRINTED_LABELS,
  PRINTED_APPENDICES,
  PRINTED_SECTIONS,
  printedTextFor,
} from '@/lib/printed-labels';
import type { Saws2PlusApplicationData } from '@/types/application';

/** Statewide California portal for CalFresh / CalWORKs / Medi-Cal. */
export const BENEFITSCAL_URL = 'https://benefitscal.com/';

/** Statewide Medi-Cal / health coverage portal. */
export const COVERED_CA_URL = 'https://www.coveredca.com/';

export type GuideAudience = 'applicant' | 'associate';

/** One thing to do, with enough detail to find it on the form. */
export interface GuideItem {
  /** Short label — the action or the blank. */
  title: string;
  /** What to do. */
  detail: string;
  /**
   * Where on the form, already formatted: "PDF page 7 · PAGE 1 OF 17 · Q1".
   * Absent for items that are not on the form at all.
   */
  location?: string;
  /** Whose field it is, when it belongs to a person. Never a value. */
  person?: string;
}

export interface GuideSection {
  id: string;
  title: string;
  /** One line of context, when the items alone would be cryptic. */
  intro?: string;
  items: GuideItem[];
}

/**
 * Which draft this guide belongs to.
 *
 * Printed on the guide and shown beside the download button so a household
 * holding two generated drafts can tell which guide goes with which PDF. The
 * reference is a prefix of the run id — not a name, not an SSN, not an address.
 */
export interface DraftReference {
  /** Short, non-sensitive identifier shared with the draft. */
  reference: string;
  /** ISO 8601 instant the draft was generated. */
  generatedAt: string;
  /** Filename of the PDF this guide accompanies, when known. */
  pdfFilename?: string;
}

export interface CompletionGuide {
  audience: GuideAudience;
  /** The language this guide is written in — the applicant's choice. */
  locale: Locale;
  /**
   * The language of the paper form this guide accompanies.
   *
   * Deliberately separate from `locale`. A Simplified Chinese applicant reads a
   * Chinese guide while holding the English form, because CDSS publishes no
   * fillable Simplified Chinese SAWS 2 PLUS. Every printed label quoted below
   * is therefore in *this* language, not in `locale`, so that what the guide
   * says to look for is what the page actually says.
   */
  documentLanguage: Locale;
  title: string;
  /** Applicant name, for identifying the document. Never more than that. */
  applicantName: string;
  county: string;
  draft: DraftReference;
  /** How many form fields automation filled. */
  filledFieldCount: number;
  sections: GuideSection[];
}

export interface CompletionGuideInput {
  application: Saws2PlusApplicationData;
  audience: GuideAudience;
  draft: DraftReference;
  /** County resolved from the ZIP code, or '' when it could not be resolved. */
  county?: string;
  /** Reused when the caller already built it. */
  plan?: readonly ApplicationFieldPlanEntry[];
  /** Reused when the caller already assessed the draft. */
  completion?: DraftCompletion;
  /** The applicant's chosen language. Defaults to English. */
  locale?: Locale;
}

/**
 * "PDF page 7 · PAGE 1 OF 17 · Q1" — everything needed to find the blank.
 *
 * Only the words are translated. `printedPage` and `saws` are quotations of
 * what the page itself prints, so they stay exactly as the paper reads.
 */
function locationOf(item: ManualItem, locale: Locale): string | undefined {
  if (!item.page) return undefined;

  const page = t(messages[locale], 'guide_location_pdf_page').replace(
    '{page}',
    String(item.page),
  );

  return `${page} · ${item.printedPage} · ${item.saws}`;
}

/** A short reference derived from the run id: enough to pair, not to identify. */
export function draftReferenceFrom(runId: string): string {
  return runId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * Items of one reason, as guide items.
 *
 * The associate gets the printed label as the title, because they are looking
 * for it on paper. The applicant gets the plain instruction, because they are
 * being told what to do.
 */
function itemsFor(
  completion: DraftCompletion,
  reason: ManualReason,
  audience: GuideAudience,
  locale: Locale,
  documentLanguage: Locale,
): GuideItem[] {
  const msgs = messages[locale];

  /*
   * Quotations of the page follow the *document* language, never the interface.
   * A Spanish reader holding the Spanish form must be told to look for the
   * Spanish heading; a Simplified Chinese reader holding the English form must
   * be told the English one. Either mistake sends someone hunting for text that
   * is not on their page.
   */
  const quote = (
    table: typeof PRINTED_SECTIONS,
    key: string | undefined,
    fallback: string,
  ): string =>
    (key && printedTextFor(table, key, documentLanguage)) || fallback;

  return completion.byReason[reason].map((item) => {
    /*
     * The assessor decides *what* a blank needs and names the sentence; the
     * words are chosen here, at the presentation boundary. That is why nothing
     * downstream ever parses `item.instruction`.
     */
    const valueType = interpolate(
      t(msgs, item.valueTypeKey),
      item.valueTypeVars ?? {},
    );

    /*
     * A missing answer names the question it is missing. The question's own
     * catalog key travels on the item, so the applicant is told which question
     * in their language rather than being handed the English source prompt.
     */
    const vars = { ...(item.instructionVars ?? {}) };

    if (item.questionPromptKey) {
      /*
       * A non-throwing lookup, matching translateQuestion's policy: a question
       * named in the wrong language is better than a guide that fails to
       * render at all.
       *
       * It matters here because a question inside a repeatable record carries
       * its index in its id — `...vehicle_details.0.isGiftDonationOrTransfer` —
       * so its key is per-record and cannot have a catalog entry. Those fall
       * back to the English prompt the assessor already recorded. The gateway
       * questions an applicant actually meets are index-free and translated;
       * localization.test.ts is what holds that line.
       */
      const translated = (msgs as Record<string, string>)[item.questionPromptKey];

      if (translated !== undefined) vars.question = translated;
    }

    const instruction = interpolate(t(msgs, item.instructionKey), vars);

    return {
      /*
       * The associate guide leads with the label printed on the paper, so it
       * follows the *document* language, not the interface. The applicant guide
       * leads with what kind of value goes in the box, which is our own prose.
       */
      title:
        audience === 'associate'
          ? quote(PRINTED_LABELS, item.printedLabelKey, item.printedLabel)
          : valueType,
      detail:
        audience === 'associate'
          ? `${quote(
              PRINTED_SECTIONS,
              item.printedSectionKey,
              item.printedSection,
            )} — ${instruction}`
          : instruction,
      location: locationOf(item, locale),
      person: item.person,
    };
  });
}

function reviewSection(
  completion: DraftCompletion,
  audience: GuideAudience,
  tr: (key: string) => string,
  /* Appendix names quote the printed page, so they follow the document. */
  documentLanguage: Locale,
): GuideSection {
  const items: GuideItem[] = [
    {
      title: tr('guide_review_check_title'),
      detail: interpolate(tr('guide_review_check_detail'), {
        count: completion.filledFieldCount,
      }),
    },
    {
      title: tr('guide_review_rules_title'),
      detail: tr('guide_review_rules_detail'),
    },
  ];

  if (completion.skippedSections.length > 0) {
    items.push({
      title: tr('guide_review_appendices_title'),
      detail:
        interpolate(tr('guide_review_appendices_detail'), {
          /*
             Two languages in one line, deliberately: the appendix name is a
             pointer to a heading on the printed page, so it follows the
             document language, while the reason is our own explanation and
             follows the interface language.
          */
          list: completion.skippedSections
            .map((section) => {
              const name =
                printedTextFor(
                  PRINTED_APPENDICES,
                  section.sawsKey,
                  documentLanguage,
                ) ?? section.saws;

              return `${name} (${tr(section.reasonKey)})`;
            })
            .join(' '),
        })
        + (audience === 'associate'
          ? tr('guide_review_appendices_confirm')
          : ''),
    });
  }

  return {
    id: 'review',
    title: tr('guide_review_title'),
    intro: tr('guide_review_intro'),
    items,
  };
}

function attachmentsSection(
  application: Saws2PlusApplicationData,
  tr: (key: string) => string,
): GuideSection {
  /*
   * Grounded in what this household is applying for and what it told us, not
   * in a generic checklist: a household with no earned income is not asked for
   * pay stubs, and housing costs are only listed where CalFresh makes them
   * matter.
   */
  const programs = application.selectedPrograms;
  const questionnaire = application.questionnaire;
  const items: GuideItem[] = [
    {
      title: tr('guide_attach_identity_title'),
      detail: tr('guide_attach_identity_detail'),
    },
  ];

  if (questionnaire.income.earned?.answer === true) {
    items.push({
      title: tr('guide_attach_earned_title'),
      detail: tr('guide_attach_earned_detail'),
    });
  }

  if (questionnaire.income.unearned?.answer === true) {
    items.push({
      title: tr('guide_attach_unearned_title'),
      detail: tr('guide_attach_unearned_detail'),
    });
  }

  if (programs.includes('calfresh')) {
    items.push({
      title: tr('guide_attach_housing_title'),
      detail: tr('guide_attach_housing_detail'),
    });
  }

  if (questionnaire.expenses.medical?.answer === true) {
    items.push({
      title: tr('guide_attach_medical_title'),
      detail: tr('guide_attach_medical_detail'),
    });
  }

  if (questionnaire.resources.vehicles?.answer === true) {
    items.push({
      title: tr('guide_attach_vehicle_title'),
      detail: tr('guide_attach_vehicle_detail'),
    });
  }

  return {
    id: 'attachments',
    title: tr('guide_attach_title'),
    intro: tr('guide_attach_intro'),
    items,
  };
}

function submissionSection(
  application: Saws2PlusApplicationData,
  county: string,
  tr: (key: string) => string,
): GuideSection {
  const countyLabel = county.trim();
  const items: GuideItem[] = [
    {
      title: tr('guide_submit_online_title'),
      detail: interpolate(tr('guide_submit_online_detail'), {
        url: BENEFITSCAL_URL,
      }),
    },
    {
      title: tr('guide_submit_inperson_title'),
      detail: countyLabel
        ? interpolate(tr('guide_submit_inperson_county'), {
            county: countyLabel,
          })
        : tr('guide_submit_inperson_unknown'),
    },
  ];

  if (application.selectedPrograms.includes('medi_cal')) {
    items.push({
      title: tr('guide_submit_coveredca_title'),
      detail: interpolate(tr('guide_submit_coveredca_detail'), {
        url: COVERED_CA_URL,
      }),
    });
  }

  items.push({
    title: tr('guide_submit_asap_title'),
    detail: tr('guide_submit_asap_detail'),
  });

  return {
    id: 'submission',
    title: tr('guide_submit_title'),
    intro: countyLabel
      ? interpolate(tr('guide_submit_intro_county'), { county: countyLabel })
      : tr('guide_submit_intro_unknown'),
    items,
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Heading and lead sentence for each reason, resolved from the catalog.
 *
 * A function rather than a constant map: the wording depends on the reader's
 * language, and a module-level constant would freeze whichever locale happened
 * to load first.
 */
function sectionHeading(
  reason: ManualReason,
  tr: (key: string) => string,
): { title: string; intro: string } {
  return {
    title: tr(`guide_section_${reason}_title`),
    intro: tr(`guide_section_${reason}_intro`),
  };
}

/** Reason sections in the order a reader works through the document. */
const SECTION_ORDER: readonly ManualReason[] = [
  'missing_answer',
  'deferred',
  'ssn',
  'write_in',
  'unsupported',
  'overflow',
  'signature',
  'signature_date',
];

/**
 * Build the guide for one generated draft.
 *
 * Pure and deterministic. Sections with no items are omitted entirely rather
 * than printed as an empty heading — a guide that says "Information that did
 * not fit" above nothing invites a reader to go looking for something.
 */
export function buildCompletionGuide(
  input: CompletionGuideInput,
): CompletionGuide {
  const {
    application,
    audience,
    draft,
    county = '',
    locale = DEFAULT_LOCALE,
  } = input;
  const msgs = messages[locale];
  const completion =
    input.completion ?? assessDraftCompletion(application, input.plan);

  const tr = (key: string) => t(msgs, key);

  /*
   * The paper's language, which is not the interface language: Spanish has an
   * official translated form, Simplified Chinese does not.
   */
  const documentLanguage = documentLanguageFor(locale);

  const sections: GuideSection[] = [
    reviewSection(completion, audience, tr, documentLanguage),
  ];

  for (const reason of SECTION_ORDER) {
    const items = itemsFor(
      completion,
      reason,
      audience,
      locale,
      documentLanguage,
    );

    if (items.length === 0) continue;

    sections.push({
      id: reason,
      title: sectionHeading(reason, tr).title,
      intro: sectionHeading(reason, tr).intro,
      items,
    });
  }

  sections.push(
    attachmentsSection(application, tr),
    submissionSection(application, county, tr),
  );

  const applicantName =
    `${application.applicant.firstName} ${application.applicant.lastName}`.trim();

  return {
    audience,
    locale,
    documentLanguage,
    title: t(
      msgs,
      audience === 'associate'
        ? 'guide_title_associate'
        : 'guide_title_applicant',
    ),
    applicantName,
    county,
    draft,
    filledFieldCount: completion.filledFieldCount,
    sections: sections.filter((section) => section.items.length > 0),
  };
}
