//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What one generated draft still needs, item by item.
 *
 * This is the difference between "the product can, in principle, fill Q8" and
 * "this applicant's Q8 is filled". Everything downstream — the applicant's
 * submission guide, the associate's completion guide, the readiness banner —
 * reads this module, so all three describe the same document and cannot drift
 * apart or from the PDF adapter.
 *
 * The old measure could not do that. It asked the semantic inventory which
 * printed questions the *product* had trouble with and reported the same
 * answer for every household, so a single applicant with no vehicles and no
 * appendices was told about vehicle blanks they did not have, and an applicant
 * whose eighth job fell off the end of Q8 was told nothing at all.
 *
 * Nine states are distinguished, because they need different words and lead to
 * different actions:
 *
 *   filled            — automation wrote it; nothing to do
 *   ssn               — a Social Security Number, always left for a person
 *   signature         — a line someone must sign by hand
 *   signature_date    — the date beside a signature; part of the act of signing
 *   write_in          — the answer is known but the form has no widget for it
 *   overflow          — a real record the printed page has no room for
 *   unsupported       — printed content the product deliberately does not model
 *   missing_answer    — the application itself does not know the answer yet
 *   not_applicable    — a conditional section this household correctly skips
 *
 * Only the first and last need nothing from anybody. `reviewAndSignOnly` is
 * true exactly when everything outstanding is a signature — not when it is
 * "nearly" that. An applicant told to "review and sign" who then finds four
 * blank Social Security boxes has been misled, and the word "only" is the part
 * that did the misleading.
 */

import { planAppendixDRows } from '@/lib/appendix-d-rows';
import type { ApplicationFieldPlanEntry } from '@/lib/application-mapper';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { planHouseholdRows } from '@/lib/household-rows';
import {
  type DroppedRecord,
  findHouseholdOverflow,
  findPrintedOverflow,
} from '@/lib/printed-capacity';
import { buildInventory } from '@/lib/saws2-inventory';
import { SAWS2_FIELDS } from '@/lib/saws2-schema';
import {
  appendixDApplies,
  getActiveAppendices,
  getRequiredApplicationQuestions,
} from '@/lib/saws2-question-planner';
import type { Saws2PlusApplicationData } from '@/types/application';

/** Why an item is still outstanding on this particular draft. */
/**
 * Every value type a blank can take, as a catalog key.
 *
 * A union rather than a bare string so adding a blank without translating it
 * fails to compile instead of shipping English into a Spanish guide.
 */
export type ValueTypeKey =
  | 'vt_ssn'
  | 'vt_ssn_three_boxes'
  | 'vt_signature'
  | 'vt_date'
  | 'vt_hours'
  | 'vt_one_more'
  | 'vt_one_more_job'
  | 'vt_immigration'
  | 'vt_checkbox_years'
  | 'vt_checkbox_property'
  | 'vt_assister'
  | 'vt_deferred'
  | 'vt_missing';

/** Every instruction sentence, as a catalog key. Same reason as above. */
export type InstructionKey =
  | 'instr_ssn_applicant_page1'
  | 'instr_ssn_household_row'
  | 'instr_ssn_appendix_a'
  | 'instr_signature_applicant'
  | 'instr_signature_date_applicant'
  | 'instr_signature_other_adult'
  | 'instr_signature_date_other_adult'
  | 'instr_signature_representative'
  | 'instr_signature_date_representative'
  | 'instr_write_in_hours'
  | 'instr_overflow_passthrough'
  | 'instr_overflow_appendix_d_person'
  | 'instr_overflow_appendix_d_jobs'
  | 'instr_unsupported_immigration'
  | 'instr_unsupported_renewal_consent'
  | 'instr_unsupported_real_property'
  | 'instr_unsupported_assister'
  | 'instr_deferred_with_page'
  | 'instr_deferred_no_page'
  | 'instr_missing_answer';

export type ManualReason =
  | 'ssn'
  | 'signature'
  | 'signature_date'
  | 'write_in'
  | 'overflow'
  | 'unsupported'
  | 'missing_answer'
  | 'deferred';

/**
 * Reasons that leave a draft short of "review and sign only".
 *
 * `signature` and `signature_date` are absent: dating a signature is part of
 * signing it, so a draft waiting only on those two really is review-and-sign.
 * Everything else is work beyond that and makes the phrase untrue.
 *
 * In practice this stays false for a real applicant, because every draft has at
 * least the page 1 Social Security box. That is the honest answer rather than a
 * defect in the rule — which is why `readyForSignature` exists beside it to
 * carry the signal a UI actually wants.
 */
const BLOCKS_REVIEW_AND_SIGN: readonly ManualReason[] = [
  'ssn',
  'write_in',
  'overflow',
  'unsupported',
  'missing_answer',
  'deferred',
];

/**
 * Reasons that mean Kealu itself still has work to do.
 *
 * An SSN or a signature is not Kealu's to supply, and an overflow row or an
 * unsupported question is a limit of the printed form. A missing answer is
 * different: the questionnaire could still collect it, and regenerating would
 * put it on the page.
 */
const BLOCKS_READY_FOR_SIGNATURE: readonly ManualReason[] = ['missing_answer'];

export interface ManualItem {
  /** Stable, PII-free identifier. */
  id: string;
  reason: ManualReason;
  /** PDF page of the official form, 1-based — what a reader's viewer shows. */
  page: number;
  /** What the page itself prints at the bottom, e.g. "PAGE 1 OF 17". */
  printedPage: string;
  /** Printed question or item number, e.g. "Q6" or "Appendix D". */
  saws: string;
  /** The heading printed above the block. */
  printedSection: string;
  /** Printed text next to the blank, so it can be found by eye. */
  printedLabel: string;
  /**
   * Whose field it is, when it belongs to a person.
   *
   * A name, never a value: an SSN item says *whose* SSN goes in the box and
   * never what it is.
   */
  person?: string;
  /** What kind of value the blank takes. */
  valueType: string;
  /** One instruction, specific enough to act on without hunting. */
  instruction: string;
  /**
   * Catalog keys for the two strings above, plus their substitutions.
   *
   * This module decides *what* a blank needs; it does not decide the words. The
   * English `valueType` and `instruction` remain so existing readers keep
   * working and so a key can be checked against its own English, but the guide
   * renders from these keys and therefore renders in the applicant's language.
   */
  valueTypeKey: ValueTypeKey;
  instructionKey: InstructionKey;
  /** Substitutions for `{name}` placeholders in the instruction. */
  instructionVars?: Readonly<Record<string, string | number>>;
  /** Substitutions for the value type, used only by the overflow rows. */
  valueTypeVars?: Readonly<Record<string, string | number>>;
  /**
   * Ids into PRINTED_SECTIONS / PRINTED_LABELS, when a verified quotation of
   * the page exists for this blank.
   *
   * Absent means the guide quotes the English strings above. Present means it
   * quotes the page in the document's own language.
   */
  printedSectionKey?: string;
  printedLabelKey?: string;
  /**
   * The unanswered question's own catalog key, when this item is one.
   *
   * Lets the guide name the question in the applicant's language instead of
   * quoting the English source prompt back at them.
   */
  questionPromptKey?: string;
}

export interface SkippedSection {
  saws: string;
  printedSection: string;
  page: number;
  /** Why this household does not need it. */
  reason: string;
}

export interface DraftCompletion {
  /** How many AcroForm destinations automation filled on this draft. */
  filledFieldCount: number;
  /** Everything still outstanding, ordered by printed page then item. */
  manualItems: ManualItem[];
  /** Conditional sections this household correctly leaves blank. */
  skippedSections: SkippedSection[];
  /**
   * True only when every outstanding item is a signature or its date.
   *
   * Deliberately literal, and therefore usually false — see the constant it is
   * computed from. Use it to decide whether the words "review and sign" may be
   * shown, and nothing else.
   */
  reviewAndSignOnly: boolean;
  /**
   * True when Kealu has nothing left to contribute to this draft.
   *
   * What remains is then the applicant's own: Social Security Numbers,
   * signatures, and anything the printed form cannot hold. This is the signal
   * a "your application is ready" state should use — paired with the manual
   * items, never instead of them.
   */
  readyForSignature: boolean;
  /** Outstanding items grouped by reason, for the guides. */
  byReason: Record<ManualReason, ManualItem[]>;
}

// ---------------------------------------------------------------------------
// Printed page labels
// ---------------------------------------------------------------------------

/**
 * What each PDF page prints at its own foot.
 *
 * The form numbers its body pages "PAGE n OF 17" starting at PDF page 7, and
 * names its appendix pages instead. Both appear in the guides so a reader can
 * confirm they are looking at the right sheet whether they are counting PDF
 * pages in a viewer or reading the paper in their hand.
 */
const APPENDIX_PAGE_LABELS: Readonly<Record<number, string>> = {
  24: 'APPENDIX A',
  25: 'APPENDIX B',
  26: 'APPENDIX C',
  27: 'APPENDIX D-1',
  28: 'APPENDIX D-2',
  29: 'APPENDIX E',
};

/** First PDF page carrying form fields; it prints "PAGE 1 OF 17". */
const FIRST_NUMBERED_PDF_PAGE = 7;

export function printedPageLabel(page: number): string {
  const appendix = APPENDIX_PAGE_LABELS[page];
  if (appendix) return appendix;

  return `PAGE ${page - FIRST_NUMBERED_PDF_PAGE + 1} OF 17`;
}

// ---------------------------------------------------------------------------
// Social Security Numbers
// ---------------------------------------------------------------------------

/**
 * The printed SSN blanks this particular draft leaves for a person to fill.
 *
 * Automation never writes an SSN, so every one of these is outstanding by
 * design rather than by omission. What varies per draft is *which* exist: a
 * one-person household has one SSN box in play, not eleven, and Appendix A's
 * employee SSN only exists once an employer page is in the draft.
 *
 * Each item names the person the box belongs to. It never carries the number,
 * which is the whole reason the box was left blank.
 */
function ssnItems(application: Saws2PlusApplicationData): ManualItem[] {
  const items: ManualItem[] = [];
  const rows = planHouseholdRows(application);

  const nameFor = (assignment: (typeof rows.all)[number]): string => {
    if (assignment.isApplicant) {
      const { firstName, lastName } = application.applicant;
      return `${firstName} ${lastName}`.trim() || 'the applicant';
    }

    const member = application.householdMembers[assignment.memberIndex!];
    return (
      `${member.firstName} ${member.lastName}`.trim() ||
      member.relationshipToApplicant ||
      `household member ${assignment.memberIndex! + 1}`
    );
  };

  // Page 1's own SSN box, on the applicant's name row.
  items.push({
    id: 'ssn.applicant',
    reason: 'ssn',
    page: 7,
    printedPage: printedPageLabel(7),
    saws: 'Q1',
    printedSection: 'Applicant’s information',
    printedSectionKey: 'applicant_information',
    printedLabel:
      'SOCIAL SECURITY NUMBER (IF YOU HAVE ONE AND ARE APPLYING FOR BENEFITS)',
    printedLabelKey: 'ssn_page_1',
    person: nameFor(rows.all[0]),
    valueType: 'Social Security Number',
    valueTypeKey: 'vt_ssn',
    instruction:
      'Third box on the applicant’s name row, at the top right of the page. ' +
      'Left blank on purpose: Kealu never writes a Social Security Number.',
    instructionKey: 'instr_ssn_applicant_page1',
  });

  for (const [table, assignments, saws, page, section] of [
    ['adult', rows.adults, 'Q6', 9, 'Household’s information: adults'],
    ['child', rows.children, 'Q6b', 10, 'Household’s information: children'],
  ] as const) {
    assignments.forEach((assignment, row) => {
      // Only rows the printed table actually has.
      if (row >= 5) return;

      items.push({
        id: `ssn.${table}.${row}`,
        reason: 'ssn',
        page,
        printedPage: printedPageLabel(page),
        saws,
        printedSection: section,
        printedLabel: 'SOCIAL SECURITY NUMBER',
        printedLabelKey: 'ssn_household_column',
        person: nameFor(assignment),
        valueType: 'Social Security Number',
        valueTypeKey: 'vt_ssn',
        instruction:
          `Row ${row + 1} of the ${table} table, in the Social Security ` +
          'Number column at the far right. Left blank on purpose.',
        instructionKey: 'instr_ssn_household_row',
        instructionVars: { row: row + 1, table },
      });
    });
  }

  if (getActiveAppendices(application).some((appendix) => appendix.id === 'A')) {
    items.push({
      id: 'ssn.appendix_a_employee',
      reason: 'ssn',
      page: 24,
      printedPage: printedPageLabel(24),
      saws: 'Appendix A item 2',
      printedSection: 'Health coverage from jobs — employee information',
      printedLabel: 'EMPLOYEE SOCIAL SECURITY NUMBER',
      person: nameFor(rows.all[0]),
      valueType: 'Social Security Number, in three boxes',
      valueTypeKey: 'vt_ssn_three_boxes',
      instruction:
        'Three small boxes beside the employee’s name. Left blank on purpose.',
      instructionKey: 'instr_ssn_appendix_a',
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Signatures and the dates that go with them
// ---------------------------------------------------------------------------

/**
 * The signatures and signature dates this draft needs.
 *
 * The signature lines themselves have no AcroForm widget — they are ruled lines
 * to be signed by hand. The DATE boxes beside them do have widgets, and both
 * stay blank: prefilling a signature date would assert when the applicant
 * signed, which is part of the act of signing.
 *
 * The second line is conditional. It reads "SIGNATURE OF SPOUSE, OTHER PARENT,
 * OTHER AIDED ADULT, OR REGISTERED DOMESTIC PARTNER", so it only applies when
 * the household has another adult on the application.
 */
function signatureItems(application: Saws2PlusApplicationData): ManualItem[] {
  const items: ManualItem[] = [
    {
      id: 'signature.applicant',
      reason: 'signature',
      page: 7,
      printedPage: printedPageLabel(7),
      saws: 'Q1 (signature block)',
      printedSection: 'Signature block at the foot of page 1',
      printedSectionKey: 'signature_block_page_1',
      printedLabelKey: 'signature_applicant',
      printedLabel:
        'SIGNATURE OF APPLICANT, CARETAKER RELATIVE (OR ADULT HOUSEHOLD ' +
        'MEMBER/AUTHORIZED REPRESENTATIVE/GUARDIAN)',
      person:
        `${application.applicant.firstName} ${application.applicant.lastName}`.trim() ||
        'the applicant',
      valueType: 'Handwritten signature',
      valueTypeKey: 'vt_signature',
      instruction:
        'Sign the long ruled line at the very bottom left of page 1. This is ' +
        'signed under penalty of perjury, so read the page first.',
      instructionKey: 'instr_signature_applicant',
    },
    {
      id: 'signature.applicant_date',
      reason: 'signature_date',
      page: 7,
      printedPage: printedPageLabel(7),
      saws: 'Q1 (signature block)',
      printedSection: 'Signature block at the foot of page 1',
      printedLabel: 'DATE (beside the applicant’s signature line)',
      person:
        `${application.applicant.firstName} ${application.applicant.lastName}`.trim() ||
        'the applicant',
      valueType: 'Date',
      valueTypeKey: 'vt_date',
      instruction:
        'The DATE box at the right-hand end of the applicant’s signature ' +
        'line. Write the date you actually sign; it is left blank because ' +
        'only the signer knows that.',
      instructionKey: 'instr_signature_date_applicant',
    },
  ];

  const otherAdults = planHouseholdRows(application).adults.length - 1;

  if (otherAdults > 0) {
    items.push(
      {
        id: 'signature.second_adult',
        reason: 'signature',
        page: 7,
        printedPage: printedPageLabel(7),
        saws: 'Q1 (signature block)',
        printedSection: 'Signature block at the foot of page 1',
        printedLabel:
          'SIGNATURE OF SPOUSE, OTHER PARENT, OTHER AIDED ADULT, OR ' +
          'REGISTERED DOMESTIC PARTNER',
        valueType: 'Handwritten signature',
        valueTypeKey: 'vt_signature',
        instruction:
          'The second ruled line, directly below the applicant’s. Required ' +
          'because another adult in this household is applying.',
        instructionKey: 'instr_signature_other_adult',
      },
      {
        id: 'signature.second_adult_date',
        reason: 'signature_date',
        page: 7,
        printedPage: printedPageLabel(7),
        saws: 'Q1 (signature block)',
        printedSection: 'Signature block at the foot of page 1',
        printedLabel: 'DATE (beside the second signature line)',
        valueType: 'Date',
        valueTypeKey: 'vt_date',
        instruction:
          'The DATE box at the right-hand end of the second signature line.',
        instructionKey: 'instr_signature_date_other_adult',
      },
    );
  }

  if (getActiveAppendices(application).some((appendix) => appendix.id === 'C')) {
    items.push(
      {
        id: 'signature.appendix_c',
        reason: 'signature',
        page: 26,
        printedPage: printedPageLabel(26),
        saws: 'Appendix C item 10',
        printedSection:
          'Appendix C — assistance with completing this application',
        printedLabel: '10. Your signature',
        person:
          `${application.applicant.firstName} ${application.applicant.lastName}`.trim() ||
          'the applicant',
        valueType: 'Handwritten signature',
        valueTypeKey: 'vt_signature',
        instruction:
          'Sign to allow the named representative to act for you on the ' +
          'health-insurance part of this application.',
        instructionKey: 'instr_signature_representative',
      },
      {
        id: 'signature.appendix_c_date',
        reason: 'signature_date',
        page: 26,
        printedPage: printedPageLabel(26),
        saws: 'Appendix C item 11',
        printedSection:
          'Appendix C — assistance with completing this application',
        printedLabel: '11. Date',
        valueType: 'Date',
        valueTypeKey: 'vt_date',
        instruction: 'The date box to the right of item 10’s signature line.',
        instructionKey: 'instr_signature_date_representative',
      },
    );
  }

  return items;
}

// ---------------------------------------------------------------------------
// Answers the form has no widget for
// ---------------------------------------------------------------------------

/**
 * Values the applicant gave that no AcroForm widget can carry.
 *
 * There is exactly one on this form today, and it is not an oversight in the
 * mapping: Appendix D prints "Number of hours worked:" followed only by Daily /
 * Weekly / Monthly checkboxes, with no box for the count. Neither Appendix D
 * page has a widget for it among its 61.
 *
 * The count is collected anyway, because the alternative is not asking a
 * question the form asks. It is reported here so it is written in by hand
 * rather than lost between the questionnaire and the page.
 */
function writeInItems(application: Saws2PlusApplicationData): ManualItem[] {
  if (!appendixDApplies(application)) return [];

  const items: ManualItem[] = [];

  for (const person of planAppendixDRows(application).persons) {
    const page = 27 + person.personBlock;

    for (const job of person.jobs) {
      if (job.entry.hoursWorked === undefined) continue;

      items.push({
        id: `write_in.appendix_d.${person.personBlock}.${job.jobSlot}`,
        reason: 'write_in',
        page,
        printedPage: printedPageLabel(page),
        saws: `Appendix D, Job ${job.jobSlot + 1}`,
        printedSection: `Employment history — ${
          person.personBlock === 0 ? 'Person1' : 'Person 2'
        }`,
        printedLabel: 'Number of hours worked:',
        person: person.personName || undefined,
        valueType: 'Number of hours',
        valueTypeKey: 'vt_hours',
        instruction:
          `Write "${job.entry.hoursWorked}" in the blank space just above ` +
          'the Daily / Weekly / Monthly boxes. The correct box is already ' +
          'ticked; the form provides no fillable box for the number itself.',
        instructionKey: 'instr_write_in_hours',
        instructionVars: { hours: String(job.entry.hoursWorked ?? '') },
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Records that did not fit
// ---------------------------------------------------------------------------

function overflowItem(dropped: DroppedRecord): ManualItem {
  return {
    id: `overflow.${dropped.blockId}.${dropped.ordinal}`,
    reason: 'overflow',
    page: dropped.page,
    printedPage: printedPageLabel(dropped.page),
    saws: dropped.saws,
    printedSection: dropped.printedName,
    printedLabel: dropped.printedName,
    valueType: `One more ${dropped.rowNoun}`,
    valueTypeKey: 'vt_one_more',
    valueTypeVars: { noun: dropped.rowNoun },
    instruction: dropped.explanation,
    /*
     * The sentence itself is composed in printed-capacity.ts, per printed
     * block. It is passed through rather than re-keyed here: this module does
     * not own that wording, and inventing a second copy of it would let the two
     * drift. printed-capacity.ts is the remaining English source for these.
     */
    instructionKey: 'instr_overflow_passthrough',
    instructionVars: { explanation: dropped.explanation },
  };
}

/** Appendix D overflow, which its own row planner reports rather than the plan. */
function appendixDOverflowItems(
  application: Saws2PlusApplicationData,
): ManualItem[] {
  if (!appendixDApplies(application)) return [];

  return planAppendixDRows(application).overflow.map((dropped, index) => ({
    id: `overflow.appendices.employment.${index}`,
    reason: 'overflow' as const,
    page: 27,
    printedPage: printedPageLabel(27),
    saws: 'Appendix D',
    printedSection: 'Employment history',
    printedLabel: 'Appendix D — EMPLOYMENT HISTORY',
    person: dropped.personName || undefined,
    valueType: 'One more job',
    valueTypeKey: 'vt_one_more_job',
    instruction:
      dropped.reason === 'person_blocks_exhausted'
        ? 'Appendix D prints two people and this household has more. The ' +
          'page itself says to copy it or use a separate sheet: add a page ' +
          `for ${dropped.personName || 'this person'} and attach it.`
        : 'Appendix D prints three jobs per person and this person has more. ' +
          'Copy the page or use a separate sheet for the extra job, as the ' +
          'printed instructions say.',
    instructionKey:
      dropped.reason === 'person_blocks_exhausted'
        ? 'instr_overflow_appendix_d_person'
        : 'instr_overflow_appendix_d_jobs',
    instructionVars: { person: dropped.personName || '' },
  }));
}

// ---------------------------------------------------------------------------
// Printed content the product deliberately does not model
// ---------------------------------------------------------------------------

/**
 * Unsupported printed content that *this* draft actually runs into.
 *
 * Gated on the draft's own answers rather than listed unconditionally: telling
 * every applicant about the sponsored-noncitizen block would bury the one or
 * two things they really do have to write, and most households never reach it.
 */
function unsupportedItems(
  application: Saws2PlusApplicationData,
): ManualItem[] {
  const items: ManualItem[] = [];
  const questionnaire = application.questionnaire;

  const anyNonCitizen =
    application.applicant.householdDetails.citizenOrNational === false ||
    application.householdMembers.some(
      (member) =>
        member.adultDetails?.citizenOrNational === false ||
        member.childDetails?.citizenOrNational === false,
    );

  if (anyNonCitizen) {
    items.push({
      id: 'unsupported.noncitizen_documents',
      reason: 'unsupported',
      page: 11,
      printedPage: printedPageLabel(11),
      saws: 'Q6e / Q6f',
      printedSection: 'Noncitizen and sponsored-noncitizen information',
      printedLabel: 'Q6e. Noncitizen information',
      valueType: 'Immigration document details',
      valueTypeKey: 'vt_immigration',
      instruction:
        'Fill this section in by hand. Kealu treats immigration document ' +
        'numbers like Social Security Numbers — never collected, never ' +
        'stored, never prefilled — so the whole block is left for you.',
      instructionKey: 'instr_unsupported_immigration',
    });
  }

  if (questionnaire.health.renewalAuthorization !== undefined) {
    items.push({
      id: 'unsupported.q23f_consent',
      reason: 'unsupported',
      page: 19,
      printedPage: printedPageLabel(19),
      saws: 'Q23f',
      printedSection: 'Using tax data to renew coverage',
      printedLabel:
        'Yes, renew my eligibility automatically for the next … / No, don’t ' +
        'use information from tax returns to renew my coverage.',
      valueType: 'One checkbox, and a number of years if Yes',
      valueTypeKey: 'vt_checkbox_years',
      instruction:
        'Tick the box yourself. The form prints two opposite choices but ' +
        'contains only one checkbox between them, so ticking it could tell ' +
        'the county either one. Also circle how many years if you answer Yes.',
      instructionKey: 'instr_unsupported_renewal_consent',
    });
  }

  if (questionnaire.resources.realProperty?.answer === true) {
    items.push({
      id: 'unsupported.q27_real_property',
      reason: 'unsupported',
      page: 21,
      printedPage: printedPageLabel(21),
      saws: 'Q27',
      printedSection: 'Home, land or other property',
      printedLabel: 'Does anyone own a home, land, or other property?',
      valueType: 'One checkbox and the property details',
      valueTypeKey: 'vt_checkbox_property',
      instruction:
        'Answer this by hand. The printed question has no Yes/No checkbox in ' +
        'the form’s fillable fields at all, so there is nothing to fill.',
      instructionKey: 'instr_unsupported_real_property',
    });
  }

  if (getActiveAppendices(application).some((appendix) => appendix.id === 'C')) {
    items.push({
      id: 'unsupported.appendix_c_assister',
      reason: 'unsupported',
      page: 26,
      printedPage: printedPageLabel(26),
      saws: 'Appendix C (lower block)',
      printedSection:
        'For Certified Application Counselors, Navigators, Agents and Brokers Only',
      printedLabel: '1. Application start date (mm/dd/yyyy)',
      valueType: 'Start date, name, organization and I.D. number',
      valueTypeKey: 'vt_assister',
      instruction:
        'Only for a certified counsellor, navigator, agent or broker who ' +
        'filled this application out for someone else. If that is you, ' +
        'complete the four items yourself; otherwise leave the block blank.',
      instructionKey: 'instr_unsupported_assister',
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Questions the application has not answered yet
// ---------------------------------------------------------------------------

/**
 * Questions the applicant chose to answer later.
 *
 * Distinct from `missing_answer`, and the distinction is the point: an
 * unanswered question is one Kealu can still ask, so the instruction is "answer
 * it here and regenerate". A deferred one was consciously postponed, so the
 * instruction is where to write it on the paper — the applicant already decided
 * not to give it to us.
 *
 * The printed location comes from the schema entry that shares the question's
 * id, and the page from the inventory entry for that printed question. Where
 * the product has no printed location — a question the form asks somewhere the
 * mapping has not resolved — the item still appears, without a page, rather
 * than being dropped for want of a page number.
 */
function deferredItems(application: Saws2PlusApplicationData): ManualItem[] {
  const deferred = application.deferredQuestionIds ?? [];

  if (deferred.length === 0) return [];

  const plan = getRequiredApplicationQuestions(application);
  const stillOutstanding = new Set(plan.outstanding.map((q) => q.id));
  const promptById = new Map(plan.outstanding.map((q) => [q.id, q.prompt]));

  const schemaById = new Map(SAWS2_FIELDS.map((field) => [field.id, field]));
  const inventoryBySaws = new Map(
    buildInventory().map((entry) => [entry.saws, entry]),
  );

  return deferred
    // A question answered after being skipped is no longer deferred.
    .filter((id) => stillOutstanding.has(id))
    .map((id) => {
      const field = schemaById.get(id);
      const printed = field ? inventoryBySaws.get(field.saws) : undefined;
      const page = printed?.page ?? 0;

      return {
        id: `deferred.${id}`,
        reason: 'deferred' as const,
        page,
        printedPage: page ? printedPageLabel(page) : '',
        saws: field?.saws ?? id,
        printedSection: printed?.label ?? field?.label ?? 'Questionnaire',
        printedLabel: field?.label ?? promptById.get(id) ?? id,
        valueType: 'An answer you chose to give later',
        valueTypeKey: 'vt_deferred',
        instruction: page
          ? 'You chose to answer this later. Write it on the printed form at ' +
            `${field?.saws ?? id}, or answer it in Kealu and generate a new draft.`
          : 'You chose to answer this later. Answer it in Kealu and generate a ' +
            'new draft, or complete it on the printed form before submitting.',
        instructionKey: page
          ? 'instr_deferred_with_page'
          : 'instr_deferred_no_page',
        instructionVars: { saws: field?.saws ?? id },
      };
    });
}

function missingAnswerItems(
  application: Saws2PlusApplicationData,
): ManualItem[] {
  /*
   * A deferred question is still outstanding, so it appears here too unless it
   * is excluded — and the guide would then list it twice, once as "still
   * missing" and once as "you chose to give later". The second is the truer
   * description, so it wins.
   */
  const deferred = new Set(application.deferredQuestionIds ?? []);

  return getRequiredApplicationQuestions(application)
    .outstanding.filter((question) => !deferred.has(question.id))
    .map((question) => ({
      id: `missing.${question.id}`,
      reason: 'missing_answer' as const,
      // The questionnaire is answered in Kealu, not on the page, so these have
      // no printed location to send anyone to.
      page: 0,
      printedPage: '',
      saws: question.id,
      printedSection: question.section,
      printedLabel: question.prompt,
      valueType: 'An answer in Kealu',
      valueTypeKey: 'vt_missing',
      instruction:
        `Still unanswered: ${question.prompt} Answer it in Kealu and ` +
        'regenerate the draft — it will then be filled in for you.',
      instructionKey: 'instr_missing_answer',
      /*
       * The question's own promptKey travels with it, so the guide can name the
       * unanswered question in the applicant's language rather than quoting the
       * English source text back at them.
       */
      instructionVars: { question: question.prompt },
      questionPromptKey: question.promptKey,
    }),
  );
}

// ---------------------------------------------------------------------------
// Conditional sections this household correctly skips
// ---------------------------------------------------------------------------

function skippedSections(
  application: Saws2PlusApplicationData,
): SkippedSection[] {
  const active = new Set(getActiveAppendices(application).map((a) => a.id));

  const candidates: Array<[string, string, number, boolean, string]> = [
    [
      'Appendix A',
      'Health coverage from jobs',
      24,
      active.has('A'),
      'Nobody in this household has a job that offers health coverage.',
    ],
    [
      'Appendix B',
      'Questions for American Indian and Alaska Native individuals',
      25,
      active.has('B'),
      'Nobody applying is American Indian or Alaska Native.',
    ],
    [
      'Appendix C',
      'Assistance with completing this application',
      26,
      active.has('C'),
      'No authorized representative was named for health coverage.',
    ],
    [
      'Appendix D',
      'Employment history',
      27,
      active.has('D'),
      'Appendix D is for cash aid with two or more adults applying.',
    ],
    [
      'Appendix E',
      'Vehicle information',
      29,
      active.has('E'),
      'Detailed vehicle information is only needed for cash aid, or for ' +
        'health care where someone applying is 65 or older or disabled.',
    ],
  ];

  return candidates
    .filter(([, , , isActive]) => !isActive)
    .map(([saws, printedSection, page, , reason]) => ({
      saws,
      printedSection,
      page,
      reason,
    }));
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Printed order: page first, then the order each collector produced. */
function byPrintedOrder(items: ManualItem[]): ManualItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.page - b.item.page || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Everything this draft still needs, and everything it correctly leaves blank.
 *
 * Pure and deterministic: the same application always produces the same list in
 * the same order. `plan` is injectable so a caller that has already built the
 * field plan does not build it twice, and so a test can drive the overflow
 * paths directly.
 */
export function assessDraftCompletion(
  application: Saws2PlusApplicationData,
  plan: readonly ApplicationFieldPlanEntry[] = buildApplicationFieldPlan(
    application,
    {},
  ),
): DraftCompletion {
  const rows = planHouseholdRows(application);

  const manualItems = byPrintedOrder([
    ...ssnItems(application),
    ...signatureItems(application),
    ...writeInItems(application),
    ...findPrintedOverflow(plan).map(overflowItem),
    ...findHouseholdOverflow(rows.adults.length, rows.children.length).map(
      overflowItem,
    ),
    ...appendixDOverflowItems(application),
    ...unsupportedItems(application),
    ...deferredItems(application),
    ...missingAnswerItems(application),
  ]);

  const byReason = {
    ssn: [],
    signature: [],
    signature_date: [],
    write_in: [],
    overflow: [],
    unsupported: [],
    missing_answer: [],
    deferred: [],
  } as Record<ManualReason, ManualItem[]>;

  for (const item of manualItems) byReason[item.reason].push(item);

  return {
    filledFieldCount: plan.length,
    manualItems,
    skippedSections: skippedSections(application),
    reviewAndSignOnly: BLOCKS_REVIEW_AND_SIGN.every(
      (reason) => byReason[reason].length === 0,
    ),
    readyForSignature: BLOCKS_READY_FOR_SIGNATURE.every(
      (reason) => byReason[reason].length === 0,
    ),
    byReason,
  };
}
