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
}

/** "PDF page 7 · PAGE 1 OF 17 · Q1" — everything needed to find the blank. */
function locationOf(item: ManualItem): string | undefined {
  if (!item.page) return undefined;

  return `PDF page ${item.page} · ${item.printedPage} · ${item.saws}`;
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
): GuideItem[] {
  return completion.byReason[reason].map((item) => ({
    title: audience === 'associate' ? item.printedLabel : item.valueType,
    detail:
      audience === 'associate'
        ? `${item.printedSection} — ${item.instruction}`
        : item.instruction,
    location: locationOf(item),
    person: item.person,
  }));
}

function reviewSection(
  completion: DraftCompletion,
  audience: GuideAudience,
): GuideSection {
  const items: GuideItem[] = [
    {
      title: 'Check every prefilled answer',
      detail:
        `Kealu filled ${completion.filledFieldCount} answers into this form ` +
        'from what was entered. Read each page and correct anything wrong or ' +
        'out of date before signing — the form is signed under penalty of ' +
        'perjury.',
    },
    {
      title: 'Read the rights, responsibilities and program rules',
      detail:
        'Page 1 confirms that those pages have been read. They are the first ' +
        'six pages of the PDF, before the questions begin.',
    },
  ];

  if (completion.skippedSections.length > 0) {
    items.push({
      title: 'Appendices this household does not need',
      detail:
        'Left blank on purpose, not by omission: ' +
        completion.skippedSections
          .map((section) => `${section.saws} (${section.reason})`)
          .join(' ') +
        (audience === 'associate'
          ? ' Confirm each still does not apply before submitting.'
          : ''),
    });
  }

  return {
    id: 'review',
    title: 'Review',
    intro: 'Start here, before filling anything in by hand.',
    items,
  };
}

function attachmentsSection(
  application: Saws2PlusApplicationData,
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
      title: 'Proof of identity',
      detail:
        'For the person signing. A driver’s licence, state ID, or other photo ' +
        'identification.',
    },
  ];

  if (questionnaire.income.earned?.answer === true) {
    items.push({
      title: 'Proof of earned income',
      detail:
        'Recent pay stubs, or a letter from the employer, for everyone in the ' +
        'household who works.',
    });
  }

  if (questionnaire.income.unearned?.answer === true) {
    items.push({
      title: 'Proof of unearned income',
      detail:
        'Award letters or statements for the benefits, support or other ' +
        'unearned income reported in Q7.',
    });
  }

  if (programs.includes('calfresh')) {
    items.push({
      title: 'Housing and utility costs',
      detail:
        'Rent or mortgage, and utility bills. CalFresh uses these to work out ' +
        'the benefit amount, so leaving them out can lower it.',
    });
  }

  if (questionnaire.expenses.medical?.answer === true) {
    items.push({
      title: 'Medical expense receipts',
      detail:
        'For a household member who is 60 or older or has a disability, ' +
        'out-of-pocket medical costs can raise CalFresh benefits.',
    });
  }

  if (questionnaire.resources.vehicles?.answer === true) {
    items.push({
      title: 'Vehicle registration',
      detail: 'For each vehicle listed on Q26 and in Appendix E.',
    });
  }

  return {
    id: 'attachments',
    title: 'Documents to attach',
    intro:
      'The county can start on the application without these, but it cannot ' +
      'finish without them.',
    items,
  };
}

function submissionSection(
  application: Saws2PlusApplicationData,
  county: string,
): GuideSection {
  const countyLabel = county.trim();
  const items: GuideItem[] = [
    {
      title: 'Online, through BenefitsCal',
      detail:
        `California’s statewide portal for CalFresh, CalWORKs and Medi-Cal is ` +
        `${BENEFITSCAL_URL}. Signed pages and documents can be uploaded there. ` +
        'This is normally the fastest route.',
    },
    {
      title: 'In person, by mail, or by fax',
      detail: countyLabel
        ? `Send or take the signed application to a ${countyLabel} County ` +
          'social services office. Look up that office’s current address and ' +
          'fax number on BenefitsCal or the county’s own website — an ' +
          'application sent to the wrong address is delayed, so this guide ' +
          'does not guess one.'
        : 'Send or take the signed application to the county social services ' +
          'office that serves this address. Enter the address on BenefitsCal ' +
          'to find the right office; this guide does not guess one.',
    },
  ];

  if (application.selectedPrograms.includes('medi_cal')) {
    items.push({
      title: 'Health coverage can also go through Covered California',
      detail: `Medi-Cal and other health coverage: ${COVERED_CA_URL}.`,
    });
  }

  items.push({
    title: 'Send it as soon as it is signed',
    detail:
      'For CalFresh, benefits run from the date the county receives the ' +
      'application, even if some documents arrive later. Missing documents ' +
      'are a reason to follow up, not a reason to wait.',
  });

  return {
    id: 'submission',
    title: 'Where to submit',
    intro: countyLabel
      ? `This ZIP code is in ${countyLabel} County, so ${countyLabel} County ` +
        'processes the application.'
      : 'The county could not be resolved from the ZIP code, so confirm which ' +
        'county serves this address before submitting.',
    items,
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const SECTION_TITLES: Record<
  Exclude<ManualReason, never>,
  { title: string; intro: string }
> = {
  ssn: {
    title: 'Social Security Numbers',
    intro:
      'Every box below was left blank on purpose. Kealu never asks for, ' +
      'stores, or writes a Social Security Number, so each one is filled in ' +
      'by hand. This guide names whose number goes where and nothing more.',
  },
  signature: {
    title: 'Signatures',
    intro:
      'These lines are signed by hand. The form is signed under penalty of ' +
      'perjury, so read the pages above before signing.',
  },
  signature_date: {
    title: 'Dates to write in',
    intro:
      'Left blank because only the signer knows when they signed. Prefilling ' +
      'a signature date would assert something on their behalf.',
  },
  write_in: {
    title: 'Answers to write in by hand',
    intro:
      'These answers are known, but the printed form provides no fillable box ' +
      'for them. The value to write is given for each one.',
  },
  overflow: {
    title: 'Information that did not fit',
    intro:
      'The printed form ran out of rows. Nothing here was discarded — each ' +
      'item needs a separate sheet attached to the application.',
  },
  unsupported: {
    title: 'Questions to answer by hand',
    intro:
      'The printed form asks these, but they cannot be filled automatically ' +
      'for the reason given. Each one is answered by hand.',
  },
  missing_answer: {
    title: 'Still missing from the application',
    intro:
      'These are not blanks on the form — they are questions Kealu has not ' +
      'been given an answer to. Answering them and regenerating the draft ' +
      'fills them in automatically.',
  },
};

/** Reason sections in the order a reader works through the document. */
const SECTION_ORDER: readonly ManualReason[] = [
  'missing_answer',
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
  const { application, audience, draft, county = '' } = input;
  const completion =
    input.completion ?? assessDraftCompletion(application, input.plan);

  const sections: GuideSection[] = [reviewSection(completion, audience)];

  for (const reason of SECTION_ORDER) {
    const items = itemsFor(completion, reason, audience);

    if (items.length === 0) continue;

    sections.push({
      id: reason,
      title: SECTION_TITLES[reason].title,
      intro: SECTION_TITLES[reason].intro,
      items,
    });
  }

  sections.push(attachmentsSection(application), submissionSection(application, county));

  const applicantName =
    `${application.applicant.firstName} ${application.applicant.lastName}`.trim();

  return {
    audience,
    title:
      audience === 'associate'
        ? 'SAWS 2 PLUS — what this draft still needs'
        : 'Finishing and submitting your SAWS 2 PLUS application',
    applicantName,
    county,
    draft,
    filledFieldCount: completion.filledFieldCount,
    sections: sections.filter((section) => section.items.length > 0),
  };
}
