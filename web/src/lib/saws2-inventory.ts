//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Semantic inventory of the printed SAWS 2 PLUS form.
 *
 * The production-readiness question is "which printed questions can this
 * product answer?", not "what fraction of 1,444 AcroForm widgets did we fill?".
 * Those two numbers are unrelated: one printed question can own thirty widgets
 * (the Q6 adult table) or none at all (Q27's gateway).
 *
 * So this module lists every printed question and subquestion, taken from the
 * real PDF rather than from memory, and classifies each one. The classification
 * is derived from the canonical schema wherever the schema knows the answer, so
 * the inventory cannot drift from what the product actually does.
 *
 * Question numbers were extracted from the official PDF's own text; the list
 * below is that extraction, reviewed.
 */

import { SAWS2_FIELDS, type Saws2Field } from '@/lib/saws2-schema';

/**
 * What stands between a printed question and a completed draft.
 *
 * Exactly one applies to each printed question.
 */
export type InventoryStatus =
  /** Filled from data the application already holds. */
  | 'known_from_application'
  /** The questionnaire asks it and the answer reaches a reviewed destination. */
  | 'collected_and_mapped'
  /** The questionnaire asks it but no destination has been reviewed yet. */
  | 'collected_not_mapped'
  /** The form asks it, it matters, and the product has no model for it. */
  | 'not_modeled'
  /** Only applies to some households; skipped correctly when it does not. */
  | 'conditional'
  /** Manual because it is a Social Security Number. */
  | 'manual_ssn'
  /** Manual because it is a signature or a signature date. */
  | 'manual_signature'
  /** Deliberately out of scope. */
  | 'intentionally_unsupported'
  /** A destination exists but has not been verified to our standard. */
  | 'mapping_uncertain'
  /** The printed form provides no writable widget for this answer. */
  | 'no_writable_widget';

export interface InventoryEntry {
  /** Printed question number, e.g. "Q6a". */
  saws: string;
  /** What the printed form asks. */
  label: string;
  /** PDF page of the official form, 1-based, for re-verification. */
  page: number;
  status: InventoryStatus;
  /** Schema entries backing this question, when any exist. */
  schemaIds: string[];
  /** Why, when the status is not a plain success. */
  note?: string;
}

/**
 * Every printed question and subquestion on the main form.
 *
 * `status` is stated here only where the schema cannot determine it — for
 * questions the product has no schema entry for at all. Everywhere else it is
 * derived, so a schema change updates the inventory automatically.
 */
interface PrintedQuestion {
  saws: string;
  label: string;
  page: number;
  /** Stated status for questions with no schema entry. */
  status?: InventoryStatus;
  note?: string;
}

const PRINTED_QUESTIONS: readonly PrintedQuestion[] = [
  { saws: 'Q1', label: 'Applicant’s information', page: 7 },
  { saws: 'Q2', label: 'Household’s authorized representative', page: 8 },
  {
    saws: 'Q2a',
    label: 'Health insurance authorized representatives',
    page: 8,
    status: 'not_modeled',
    note: 'A separate representative for health coverage is not modeled.',
  },
  { saws: 'Q3', label: 'American Indian or Alaska Native', page: 8 },
  {
    saws: 'Q4',
    label: 'Interview preference',
    page: 8,
    status: 'not_modeled',
    note: 'Preferred interview time/method is not collected.',
  },
  { saws: 'Q5', label: 'Other programs previously received', page: 8 },
  { saws: 'Q6', label: 'Household’s information: adults', page: 9 },
  {
    saws: 'Q6a',
    label: 'Does everyone in question 6 have the same contact information?',
    page: 9,
    status: 'not_modeled',
    note:
      'Per-member phone, address and email are not in the household model, so ' +
      'the per-person contact blocks stay blank rather than repeating the ' +
      'applicant’s own details in every row.',
  },
  { saws: 'Q6b', label: 'Household’s information: children', page: 10 },
  {
    saws: 'Q6c',
    label: 'Social Security information',
    page: 10,
    status: 'manual_ssn',
  },
  { saws: 'Q6d', label: 'U.S. military service', page: 11 },
  {
    saws: 'Q6e',
    label: 'Noncitizen information',
    page: 11,
    status: 'intentionally_unsupported',
    note:
      'Immigration document numbers are treated like SSNs: never collected, ' +
      'never stored, never prefilled.',
  },
  {
    saws: 'Q6f',
    label: 'Sponsored noncitizen information',
    page: 12,
    status: 'intentionally_unsupported',
    note: 'Sponsor details accompany the noncitizen block, which is unsupported.',
  },
  { saws: 'Q6g', label: 'Child under 21 with a parent outside the home', page: 12 },
  { saws: 'Q6h', label: 'Living with a child under 19 (caretaker relative)', page: 12 },
  {
    saws: 'Q6i',
    label: 'Anyone with a physical, mental, emotional or developmental disability',
    page: 12,
    status: 'not_modeled',
    note:
      'Per-person disability is modeled in the Q6 adult/child rows but the Q6i ' +
      'question itself has no gateway in the questionnaire.',
  },
  {
    saws: 'Q6j',
    label: 'Details for each disabled person',
    page: 12,
    status: 'not_modeled',
    note: 'Disability detail rows are not collected.',
  },
  {
    saws: 'Q6k',
    label: 'A child or disabled person who needs care from another person',
    page: 12,
    status: 'not_modeled',
    note: 'Overlaps Q11 dependent care but is a distinct printed question.',
  },
  { saws: 'Q6l', label: 'Students', page: 13 },
  {
    saws: 'Q6m',
    label: 'Anyone pregnant or a teen parent',
    page: 13,
    status: 'conditional',
    note:
      'Pregnancy is collected on page 1 and mapped there. The Q6m destination ' +
      'has not been reviewed.',
  },
  {
    saws: 'Q6n',
    label: 'Cash bonus, penalty, or help with child care/transport (Cal-Learn)',
    page: 13,
    status: 'not_modeled',
    note: 'Cal-Learn participation history is not collected.',
  },
  {
    saws: 'Q6o',
    label: 'Was anyone ever in foster care?',
    page: 13,
    status: 'not_modeled',
    note: 'Distinct from Q6p, which asks about a foster child living there now.',
  },
  { saws: 'Q6p', label: 'Foster child currently living in the home', page: 14 },
  { saws: 'Q6q', label: 'Everyone lives in California and expects to stay', page: 14 },
  { saws: 'Q6r', label: 'Anyone planning to leave California for over 30 days', page: 14 },
  { saws: 'Q7', label: 'Unearned income', page: 14 },
  { saws: 'Q8', label: 'Earned income', page: 15 },
  { saws: 'Q8a', label: 'Self-employment', page: 15 },
  { saws: 'Q9', label: 'Other income', page: 16 },
  { saws: 'Q10', label: 'Yearly income', page: 16 },
  { saws: 'Q11', label: 'Child/adult care expenses', page: 16 },
  { saws: 'Q12', label: 'Child support payments', page: 16 },
  { saws: 'Q13', label: 'Spousal support / alimony', page: 17 },
  {
    saws: 'Q14',
    label: 'Special needs expenses',
    page: 17,
    status: 'not_modeled',
    note: 'Pregnancy-related and other special-need expense rows are not collected.',
  },
  { saws: 'Q15', label: 'Household expenses', page: 17 },
  { saws: 'Q16', label: 'Medical expenses', page: 18 },
  { saws: 'Q17', label: 'Other tax-deductible expenses', page: 18 },
  { saws: 'Q18', label: 'Food from another program', page: 18 },
  { saws: 'Q19', label: 'Living in a shelter, group home or institution', page: 18 },
  { saws: 'Q20', label: 'In-Home Supportive Services (IHSS)', page: 19 },
  { saws: 'Q21', label: 'Everyone buys and prepares food together', page: 19 },
  {
    saws: 'Q21a',
    label: 'Someone 60+ unable to buy food and cook separately due to disability',
    page: 19,
    status: 'not_modeled',
    note:
      'A CalFresh separate-household rule. Age and disability are known per ' +
      'person, but the combined judgement is not something we may infer.',
  },
  { saws: 'Q22', label: 'Currently enrolled in health coverage', page: 19 },
  { saws: 'Q22a', label: 'Offered health coverage from a job', page: 19 },
  { saws: 'Q22b', label: 'Coverage ending or ended in the last 90 days', page: 19 },
  { saws: 'Q22c', label: 'Help with medical bills from the last three months', page: 19 },
  { saws: 'Q23', label: 'Plans to file a federal income tax return', page: 19 },
  {
    saws: 'Q23a',
    label: 'Tax filer section header',
    page: 19,
    status: 'conditional',
    note: 'A printed heading, not a question with its own answer.',
  },
  {
    saws: 'Q23b',
    label: 'Name of person planning to file',
    page: 19,
    status: 'not_modeled',
    note: 'The tax filer is not identified by name; only "does anyone file".',
  },
  { saws: 'Q23c', label: 'Will this person file jointly with a spouse?', page: 19 },
  {
    saws: 'Q23d',
    label: 'Will this person claim dependents?',
    page: 19,
    status: 'not_modeled',
    note:
      'Tax dependents are not derivable from household relationships and are ' +
      'not collected.',
  },
  {
    saws: 'Q23e',
    label: 'How the dependents relate to the tax filer',
    page: 19,
    status: 'not_modeled',
    note:
      'Depends on Q23d, which is not collected. A tax relationship is not the ' +
      'same as a household relationship and must not be inferred from one.',
  },
  { saws: 'Q23f', label: 'Consent to renew coverage from tax data', page: 19 },
  { saws: 'Q24', label: 'Household’s resources', page: 20 },
  {
    saws: 'Q25',
    label: 'Personal property',
    page: 20,
    status: 'not_modeled',
    note: 'Distinct from Q24 resources; personal-property rows are not collected.',
  },
  { saws: 'Q26', label: 'Vehicles', page: 21 },
  { saws: 'Q27', label: 'Home, land or other property', page: 21 },
  { saws: 'Q28', label: 'Diversion program', page: 21 },
  { saws: 'Q29', label: 'Duplicate benefits', page: 21 },
  { saws: 'Q30', label: 'Trafficking benefits', page: 21 },
  { saws: 'Q31', label: 'Trading benefits for drugs', page: 21 },
  { saws: 'Q32', label: 'Trading benefits for firearms or explosives', page: 21 },
  { saws: 'Q33', label: 'Fraud', page: 21 },
  { saws: 'Q34', label: 'Non-cooperation / sanctions', page: 21 },
  { saws: 'Q35', label: 'Fleeing felon', page: 22 },
  { saws: 'Q36', label: 'Probation / parole violation', page: 22 },
  { saws: 'Q37', label: 'Other special needs', page: 22 },
  { saws: 'Q38A', label: 'CHDP check-ups information', page: 22 },
  { saws: 'Q38B', label: 'Immunization information', page: 22 },
  { saws: 'Q38C', label: 'Pregnancy help', page: 22 },
  { saws: 'Q38D', label: 'Breastfeeding and recent birth', page: 22 },
  { saws: 'Q38E', label: 'Family planning services', page: 22 },
  { saws: 'Q39', label: 'Third party liability', page: 22 },
  {
    saws: 'Q40 (signature block)',
    label: 'Applicant and other adult signatures and dates',
    page: 23,
    status: 'manual_signature',
  },

  // Appendices.
  {
    saws: 'Appendix A',
    label: 'Employer health coverage details',
    page: 24,
    status: 'not_modeled',
    note:
      'Activated when Q22a is Yes. The appendix’s own fields are not collected ' +
      'or mapped.',
  },
  { saws: 'Appendix B', label: 'American Indian / Alaska Native details', page: 25 },
  {
    saws: 'Appendix C',
    label: 'Authorized representative appointment',
    page: 26,
    status: 'manual_signature',
    note: 'The appointment requires the representative’s signature.',
  },
  { saws: 'Appendix D', label: 'Employment history for CalWORKs', page: 27 },
  {
    saws: 'Appendix E',
    label: 'Detailed vehicle information',
    page: 28,
    status: 'not_modeled',
    note:
      'Activated by Q26 for CalWORKs. Owner, valuation, debt and use details ' +
      'are not collected.',
  },
] as const;

/** Schema entries grouped by the printed question they answer. */
function schemaBySaws(): Map<string, Saws2Field[]> {
  const grouped = new Map<string, Saws2Field[]>();

  for (const field of SAWS2_FIELDS) {
    // "Q1 (expedited screening)" answers printed question Q1.
    const base = field.saws.replace(/\s*\(.*\)$/, '');
    grouped.set(base, [...(grouped.get(base) ?? []), field]);
  }

  return grouped;
}

/**
 * Status implied by the schema entries backing a printed question.
 *
 * The worst outstanding state wins: a question is only "collected and mapped"
 * when nothing about it is still unreviewed, because a half-mapped question
 * still leaves the applicant with blanks to fill by hand.
 */
function statusFromSchema(fields: Saws2Field[]): InventoryStatus {
  if (fields.some((f) => f.manualReason === 'ssn')) return 'manual_ssn';
  if (fields.some((f) => f.manualReason === 'signature')) {
    return 'manual_signature';
  }

  if (fields.some((f) => f.pdf === 'no_widget')) return 'no_writable_widget';
  if (fields.some((f) => f.pdf === 'unreviewed')) return 'collected_not_mapped';

  // Everything left is mapped. Prefillable entries need no question at all.
  if (fields.every((f) => f.support === 'prefillable')) {
    return 'known_from_application';
  }

  return 'collected_and_mapped';
}

/** The full semantic inventory, derived from the schema where possible. */
export function buildInventory(): InventoryEntry[] {
  const grouped = schemaBySaws();

  return PRINTED_QUESTIONS.map((question) => {
    const fields = grouped.get(question.saws) ?? [];

    return {
      saws: question.saws,
      label: question.label,
      page: question.page,
      schemaIds: fields.map((f) => f.id),
      status:
        fields.length > 0
          ? statusFromSchema(fields)
          : question.status ?? 'not_modeled',
      note: question.note,
    };
  });
}

/** Count of printed questions in each classification. */
export function inventoryCounts(): Record<InventoryStatus, number> {
  const counts = {} as Record<InventoryStatus, number>;

  for (const entry of buildInventory()) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }

  return counts;
}

/** Total number of printed questions and subquestions tracked. */
export function printedQuestionCount(): number {
  return PRINTED_QUESTIONS.length;
}

/**
 * Printed questions that stop a draft being "review and sign only".
 *
 * Manual SSN and signature entries are excluded: those are the two things the
 * applicant is always expected to do by hand.
 */
export function blockersToReviewAndSign(): InventoryEntry[] {
  const BLOCKING: InventoryStatus[] = [
    'collected_not_mapped',
    'not_modeled',
    'mapping_uncertain',
    'no_writable_widget',
  ];

  return buildInventory().filter((entry) => BLOCKING.includes(entry.status));
}
