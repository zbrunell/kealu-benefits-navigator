//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * One canonical description of what the SAWS 2 PLUS form means.
 *
 * Before this module the form's semantics were spread across four places that
 * each knew part of the truth and could disagree: the planner's tier/question
 * table, the planner's gateway specs, the mapper's canonical-key emission, and
 * the Python adapter's destination tables. A question number could be corrected
 * in one and stay wrong in another — which is exactly how three different
 * questions ended up all labelled "Q22".
 *
 * Everything a consumer needs to reason about a form concept lives in one entry
 * here:
 *
 *   - what the printed form calls it            (`saws`)
 *   - where the answer lives in application data (`path`)
 *   - what the answer means                      (`kind`)
 *   - whether we may fill it, ask it, or never touch it (`support`)
 *   - whether a verified PDF destination exists  (`pdf`)
 *
 * Consumers:
 *
 *   planner  — which applicable entries are still unresolved
 *   mapper   — which canonical key an answer becomes
 *   adapter  — which reviewed widget a canonical key is written to
 *
 * The PDF destinations themselves deliberately stay in the Python adapter,
 * where they are verified against the real AcroForm and the fail-closed
 * `SAFE_FIELDS` guard lives. This module records the *status* of that mapping,
 * and a cross-runtime test asserts the two never disagree — the schema may not
 * claim a destination the adapter lacks, and the adapter may not write a
 * destination the schema calls manual-only.
 */

import type { QuestionSection, QuestionTier } from '@/lib/saws2-question-planner';

/** What kind of answer a form concept holds. */
export type FieldKind =
  | 'boolean'
  | 'text'
  | 'number'
  | 'date'
  | 'enum'
  | 'records';

/**
 * What the product is allowed to do with a form concept.
 *
 * `manual_only` is a hard boundary, not a to-do: those entries must never gain
 * a path, a canonical key, or a PDF destination.
 */
export type FieldSupport =
  | 'prefillable'
  | 'askable'
  | 'manual_only'
  | 'unsupported';

/**
 * Whether an answer can reach the printed form.
 *
 * `no_widget` is a real and permanent state, not a gap: some printed questions
 * (Q27 real property) have no writable checkbox at all, so a semantic answer
 * exists with nowhere to put it. The schema can represent that honestly rather
 * than forcing every answer to have a destination.
 */
export type PdfStatus =
  | 'mapped'
  | 'unreviewed'
  | 'no_widget'
  | 'manual';

/** Why an entry is manual-only. Required whenever support is `manual_only`. */
export type ManualReason = 'ssn' | 'signature';

export interface Saws2Field {
  /** Stable semantic id. Matches the planner's question id where one exists. */
  id: string;
  /** The printed question number, e.g. "Q22a". */
  saws: string;
  /** Human-readable description of the printed question. */
  label: string;
  section: QuestionSection;
  tier: QuestionTier;
  kind: FieldKind;
  support: FieldSupport;
  pdf: PdfStatus;
  /** Path into the questionnaire, when the answer is stored there. */
  path?: string;
  /** Canonical key emitted into the field plan, when one exists. */
  canonicalKey?: string;
  /** Required when `support` is `manual_only`. */
  manualReason?: ManualReason;
  /** Why an entry is unreviewed, no_widget or unsupported. */
  note?: string;
}

/**
 * Every SAWS 2 PLUS concept the product currently reasons about.
 *
 * Tiers come from what the form itself needs, not from PDF field order:
 *
 * 1. filing / identity — the flow will not continue without it
 * 2. eligibility-critical — Q6 detail, Q7-Q10 income, Q15 expenses, Q24 resources
 * 3. supporting — improves the calculation or completes a conditional section
 * 4. optional — the form states outright that the answer does not affect
 *    eligibility. Only Q38 qualifies, and it says so in print.
 */
export const SAWS2_FIELDS: readonly Saws2Field[] = [
  // ── Tier 1: filing and identity ────────────────────────────────────────
  {
    id: 'household.applicant_name',
    saws: 'Q1',
    label: 'Applicant’s name',
    section: 'household',
    tier: 1,
    kind: 'text',
    support: 'askable',
    pdf: 'mapped',
    path: 'applicant.name',
    canonicalKey: 'applicant.first_name',
  },
  {
    id: 'household.applicant_dob',
    saws: 'Q6',
    label: 'Applicant’s date of birth',
    section: 'household',
    tier: 1,
    kind: 'date',
    support: 'askable',
    pdf: 'mapped',
    path: 'applicant.dateOfBirth',
    canonicalKey: 'applicant.date_of_birth',
  },
  {
    id: 'household.adult_table',
    saws: 'Q6',
    label:
      'Adult household table: name, relationship, date of birth, gender, ' +
      'marital status, program selections, student and disabled indicators, ' +
      'and citizenship',
    section: 'household',
    tier: 2,
    kind: 'records',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.adult_rows.count',
    note:
      'Rows are assigned by planHouseholdRows before the adapter runs: the ' +
      'applicant always takes row 1, other adults follow in application order.',
  },
  {
    id: 'household.child_table',
    saws: 'Q6b',
    label:
      'Child household table: name, relationship, date of birth, place of ' +
      'birth, gender, program selections, parent status and immunizations',
    section: 'household',
    tier: 2,
    kind: 'records',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.child_rows.count',
    note: 'Numbered independently of the adult table so neither can shift the other.',
  },

  /*
   * Page 1 blocks. The printed page carries no question numbers of its own, so
   * these use the same "Qn (block)" convention already used for the job-change
   * and transferred-resource blocks rather than inventing numbers.
   *
   * All are `prefillable`: they are collected in the applicant and program
   * steps, not by the questionnaire, so the planner never asks them.
   */
  {
    id: 'programs.calfresh',
    saws: 'Q1 (programs applied for)',
    label: 'Applying for CalFresh',
    section: 'household',
    tier: 1,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'programs.calfresh',
  },
  {
    id: 'programs.calworks',
    saws: 'Q1 (programs applied for)',
    label: 'Applying for Cash Aid (CalWORKs, GA/GR)',
    section: 'household',
    tier: 1,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'programs.calworks',
  },
  {
    id: 'programs.medi_cal',
    saws: 'Q1 (programs applied for)',
    label: 'Applying for Health Coverage (Medi-Cal)',
    section: 'household',
    tier: 1,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'programs.medi_cal',
  },
  {
    id: 'programs.other',
    saws: 'Q1 (programs applied for)',
    label: 'Applying for another program',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'programs.other',
  },
  {
    id: 'preferences.email_application_information',
    saws: 'Q1 (contact preferences)',
    label: 'I want to get information about this application by email',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'applicant.email_application_information',
  },
  {
    id: 'preferences.email_case_messages',
    saws: 'Q1 (contact preferences)',
    label: 'I want to get messages about my case by email',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'applicant.email_case_messages',
  },
  {
    id: 'preferences.disability_application_help',
    saws: 'Q1 (accessibility)',
    label: 'Do you have a disability and need help applying?',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'applicant.needs_disability_application_help',
  },
  {
    id: 'preferences.deaf_or_hard_of_hearing',
    saws: 'Q1 (accessibility)',
    label: 'Check here if you are deaf or hard of hearing',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'applicant.deaf_or_hard_of_hearing',
  },
  {
    id: 'household.homeless',
    saws: 'Q1 (housing status)',
    label: 'Are you homeless?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.homeless',
  },
  {
    id: 'expedited.gross_income_and_resources',
    saws: 'Q1 (expedited screening)',
    label:
      'Gross income under $150 and cash/checking/savings of $100 or less?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey:
      'household.expedited.gross_income_under_150_and_resources_under_100',
  },
  {
    id: 'expedited.income_less_than_housing',
    saws: 'Q1 (expedited screening)',
    label:
      'Combined gross income and liquid resources less than rent/mortgage and utilities?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey:
      'household.expedited.income_and_resources_less_than_housing_costs',
  },
  {
    id: 'expedited.migrant_or_seasonal',
    saws: 'Q1 (expedited screening)',
    label: 'Migrant or seasonal farm worker household with resources ≤ $100?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.expedited.migrant_or_seasonal_farm_worker',
  },
  {
    id: 'expedited.eviction_notice',
    saws: 'Q1 (expedited screening)',
    label: 'Do you have an eviction notice or a notice to pay rent or leave?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.expedited.eviction_notice',
  },
  {
    id: 'expedited.utilities_shut_off',
    saws: 'Q1 (expedited screening)',
    label: 'Have your utilities been shut off, or do you have a notice?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.expedited.utilities_shut_off_or_notice',
  },
  {
    id: 'expedited.food_runs_out',
    saws: 'Q1 (expedited screening)',
    label: 'Will your food run out within three days?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.expedited.food_runs_out_within_three_days',
  },
  {
    id: 'expedited.needs_clothing',
    saws: 'Q1 (expedited screening)',
    label: 'Do you need essential clothing?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.expedited.needs_essential_clothing',
  },
  {
    id: 'expedited.needs_transportation',
    saws: 'Q1 (expedited screening)',
    label: 'Do you need transportation for emergency needs?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey:
      'household.expedited.needs_transportation_for_emergency_needs',
  },
  {
    id: 'pregnancy.anyone_pregnant',
    saws: 'Q1 (pregnancy)',
    label: 'Is anyone in the household pregnant?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.anyone_pregnant',
  },
  {
    id: 'pregnancy.presumptive_eligibility_card',
    saws: 'Q1 (pregnancy)',
    label: 'Do you have a presumptive-eligibility card?',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.pregnancy.presumptive_eligibility_card',
  },
  {
    id: 'emergency.has_emergency',
    saws: 'Q1 (personal emergency)',
    label: 'Does anyone in your household have a personal emergency?',
    section: 'household',
    tier: 2,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.personal_emergency.has_emergency',
  },
  {
    id: 'emergency.pregnancy',
    saws: 'Q1 (personal emergency)',
    label: 'Personal emergency: pregnancy',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.personal_emergency.pregnancy',
  },
  {
    id: 'emergency.immediate_medical_need',
    saws: 'Q1 (personal emergency)',
    label: 'Personal emergency: immediate medical need',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.personal_emergency.immediate_medical_need',
  },
  {
    id: 'emergency.child_abuse',
    saws: 'Q1 (personal emergency)',
    label: 'Personal emergency: child abuse',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.personal_emergency.child_abuse',
  },
  {
    id: 'emergency.domestic_abuse',
    saws: 'Q1 (personal emergency)',
    label: 'Personal emergency: domestic abuse',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.personal_emergency.domestic_abuse',
  },
  {
    id: 'emergency.elder_abuse',
    saws: 'Q1 (personal emergency)',
    label: 'Personal emergency: elder abuse',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.personal_emergency.elder_abuse',
  },
  {
    id: 'emergency.other',
    saws: 'Q1 (personal emergency)',
    label: 'Personal emergency: other threat to health or safety',
    section: 'household',
    tier: 3,
    kind: 'boolean',
    support: 'prefillable',
    pdf: 'mapped',
    canonicalKey: 'household.personal_emergency.other',
  },

  // ── Tier 2: eligibility-critical ───────────────────────────────────────
  {
    id: 'circumstances.california_resident',
    saws: 'Q6q',
    label: 'Does everyone applying live in California and plan to stay?',
    section: 'circumstances',
    tier: 2,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.californiaResident',
    canonicalKey: 'household.california_resident',
    note: 'Q6q destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.food_together',
    saws: 'Q21',
    label: 'Does everyone in your household buy and prepare food together?',
    section: 'circumstances',
    tier: 2,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'circumstances.buysAndPreparesFoodTogether',
    canonicalKey: 'household.buys_and_prepares_food_together',
  },
  {
    id: 'income.unearned',
    saws: 'Q7',
    label: 'Unearned income',
    section: 'income',
    tier: 2,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'income.unearned.answer',
    canonicalKey: 'income.has_unearned_income',
  },
  {
    id: 'income.earned',
    saws: 'Q8',
    label: 'Income from a job',
    section: 'income',
    tier: 2,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'income.earned.answer',
    canonicalKey: 'income.has_earned_income',
  },
  {
    id: 'income.self_employment',
    saws: 'Q8a',
    label: 'Self-employment',
    section: 'income',
    tier: 2,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'income.selfEmployment.answer',
    canonicalKey: 'income.has_self_employment',
  },
  {
    id: 'income.in_kind',
    saws: 'Q9',
    label:
      'Housing, utilities, food or clothing received free or in exchange for work',
    section: 'income',
    tier: 2,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'income.inKindSupport.answer',
    canonicalKey: 'income.has_in_kind_support',
  },
  {
    id: 'income.varies_during_year',
    saws: 'Q10',
    label: 'Does anyone’s income change during the year?',
    section: 'income',
    tier: 2,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'income.incomeVariesDuringYear',
    canonicalKey: 'income.varies_during_year',
    note: 'Q10 destination not yet located on the printed form.',
  },
  {
    id: 'expenses.household',
    saws: 'Q15',
    label: 'Household expenses',
    section: 'expenses',
    tier: 2,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'expenses.household.answer',
    canonicalKey: 'expenses.has_household_expenses',
  },
  {
    id: 'resources.accounts',
    saws: 'Q24',
    label: 'Cash, bank accounts and other savings',
    section: 'resources',
    tier: 2,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'resources.accounts.answer',
    canonicalKey: 'resources.has_accounts',
  },

  // ── Tier 3: supporting ─────────────────────────────────────────────────
  {
    id: 'circumstances.authorized_representative',
    saws: 'Q2',
    label: 'Someone else may act for the household',
    section: 'circumstances',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.authorizedRepresentative.answer',
    canonicalKey: 'household.authorized_representative',
    note: 'Q2 destination not yet located; Appendix C carries the detail.',
  },
  {
    id: 'health.american_indian',
    saws: 'Q3',
    label: 'Is anyone applying American Indian or Alaska Native?',
    section: 'health',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'health.americanIndianOrAlaskaNative',
    canonicalKey: 'health.american_indian_or_alaska_native',
    note: 'Q3 destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.prior_public_assistance',
    saws: 'Q5',
    label: 'Has anyone received CalFresh, CalWORKs or Medi-Cal before?',
    section: 'circumstances',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.priorPublicAssistance',
    canonicalKey: 'household.prior_public_assistance',
    note: 'Q5 destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.military_service',
    saws: 'Q6d',
    label: 'U.S. military service in the household',
    section: 'circumstances',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.militaryService.answer',
    canonicalKey: 'household.military_service',
    note: 'Q6d destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.absent_parents',
    saws: 'Q6g',
    label: 'A child has a parent living outside the home',
    section: 'circumstances',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.absentParents.answer',
    canonicalKey: 'household.absent_parents',
    note: 'Q6g destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.caretaker_relative',
    saws: 'Q6h',
    label: 'Applying for a child who is not your own son or daughter',
    section: 'circumstances',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.caretakerRelative',
    canonicalKey: 'household.caretaker_relative',
    note: 'Q6h destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.students',
    saws: 'Q6l',
    label: 'Anyone attending a college or vocational school',
    section: 'circumstances',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.students.answer',
    canonicalKey: 'household.students',
    note: 'Q6l destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.foster_care',
    saws: 'Q6p',
    label: 'A foster child living in the home',
    section: 'circumstances',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.fosterCare.answer',
    canonicalKey: 'household.foster_care',
    note: 'Q6p destination not yet located on the printed form.',
  },
  {
    id: 'circumstances.planned_absence',
    saws: 'Q6r',
    label: 'Anyone planning to be away from California for over a month',
    section: 'circumstances',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.plannedAbsence',
    canonicalKey: 'household.planned_absence',
    note: 'Q6r destination not yet located on the printed form.',
  },
  {
    id: 'income.recent_job_change',
    saws: 'Q8 (job change)',
    label: 'Anyone lost a job or had their hours change recently',
    section: 'income',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'income.recentJobChange.answer',
    canonicalKey: 'income.recent_job_change',
    note: 'Printed inside the Q8 area but carries no number of its own.',
  },
  {
    id: 'expenses.dependent_care',
    saws: 'Q11',
    label: 'Child or dependent adult care expenses',
    section: 'expenses',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'expenses.dependentCare.answer',
    canonicalKey: 'expenses.has_dependent_care',
  },
  {
    id: 'expenses.child_support_paid',
    saws: 'Q12',
    label: 'Legally obligated child support paid',
    section: 'expenses',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'expenses.childSupportPaid.answer',
    canonicalKey: 'expenses.pays_child_support',
  },
  {
    id: 'expenses.spousal_support_paid',
    saws: 'Q13',
    label: 'Legally obligated spousal support or alimony paid',
    section: 'expenses',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'expenses.spousalSupportPaid.answer',
    canonicalKey: 'expenses.pays_spousal_support',
  },
  {
    id: 'expenses.medical',
    saws: 'Q16',
    label: 'Out-of-pocket medical expenses for an elderly or disabled person',
    section: 'expenses',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'expenses.medical.answer',
    canonicalKey: 'expenses.has_medical_expenses',
  },
  {
    id: 'expenses.other_tax_deductible',
    saws: 'Q17',
    label: 'Other tax-deductible expenses',
    section: 'expenses',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'expenses.otherTaxDeductible.answer',
    canonicalKey: 'expenses.other_tax_deductible',
  },
  {
    id: 'circumstances.other_food_program',
    saws: 'Q18',
    label: 'Taking part in another food program',
    section: 'circumstances',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'circumstances.otherFoodProgram',
    canonicalKey: 'household.other_food_program',
    note: 'Q18 is a checkbox list rather than a single Yes/No pair.',
  },
  {
    id: 'circumstances.institutional_living',
    saws: 'Q19',
    label: 'Anyone living in a shelter, group home or institution',
    section: 'circumstances',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'circumstances.institutionalLiving',
    canonicalKey: 'household.institutional_living',
  },
  {
    id: 'circumstances.ihss',
    saws: 'Q20',
    label: 'Anyone getting In-Home Supportive Services (IHSS)',
    section: 'circumstances',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'circumstances.receivesIhss',
    canonicalKey: 'household.receives_ihss',
  },

  /*
   * Q22 is four separate printed questions, numbered separately. Labelling three
   * of them "Q22" made the flow look like it was asking the same question over
   * and over. None is a follow-up to Q22: answering Q22 No must not suppress any
   * of the other three.
   */
  {
    id: 'health.current_coverage',
    saws: 'Q22',
    label: 'Is anyone enrolled in health coverage now?',
    section: 'health',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'health.currentCoverage.answer',
    canonicalKey: 'health.has_current_coverage',
  },
  {
    id: 'health.employer_coverage',
    saws: 'Q22a',
    label: 'Is anyone offered health care coverage from a job?',
    section: 'health',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'health.employerCoverage.answer',
    canonicalKey: 'health.has_employer_coverage',
    note: 'A Yes here is what adds Appendix A.',
  },
  {
    id: 'health.coverage_ending',
    saws: 'Q22b',
    label:
      'Is anyone’s health insurance ending, or did it end in the last 90 days?',
    section: 'health',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'health.coverageEnding.answer',
    canonicalKey: 'health.coverage_ending',
  },
  {
    id: 'health.retroactive_medical',
    saws: 'Q22c',
    label: 'Does anyone want help with medical bills from the last three months?',
    section: 'health',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'health.retroactiveMedicalHelp',
    canonicalKey: 'health.retroactive_medical_help',
  },
  {
    id: 'health.tax_filer',
    saws: 'Q23',
    label: 'Does anyone plan to file a federal income tax return next year?',
    section: 'health',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'health.taxFiler',
    canonicalKey: 'health.tax_filer',
  },
  {
    id: 'health.spouse_filing_jointly',
    saws: 'Q23c',
    label: 'Will this person file jointly with a spouse?',
    section: 'health',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'health.spouseFilingJointly',
    canonicalKey: 'health.spouse_filing_jointly',
  },
  {
    id: 'health.renewal_authorization',
    saws: 'Q23f',
    label: 'May the county use tax information to renew coverage automatically?',
    section: 'health',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'health.renewalAuthorization',
    canonicalKey: 'health.renewal_authorization',
    note: 'Q23f offers a duration choice (1-5 years) the model does not carry.',
  },
  {
    id: 'resources.transferred',
    saws: 'Q24 (transferred resources)',
    label: 'Property sold, traded or given away in the last 30 months',
    section: 'resources',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'resources.transferredResources.answer',
    canonicalKey: 'resources.transferred_resources',
    note: 'Printed at the end of Q24, above the Q25 heading; carries no number.',
  },
  {
    id: 'resources.vehicles',
    saws: 'Q26',
    label: 'Does anyone own or use a vehicle?',
    section: 'resources',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'mapped',
    path: 'resources.vehicles.answer',
    canonicalKey: 'resources.has_vehicles',
  },
  {
    id: 'resources.real_property',
    saws: 'Q27',
    label: 'Does anyone own a home, land or other property?',
    section: 'resources',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'no_widget',
    path: 'resources.realProperty.answer',
    canonicalKey: 'resources.has_real_property',
    note:
      'Q27 is a table of property rows with no gateway checkbox on the printed ' +
      'form. A No has nowhere to be written and correctly leaves the table blank.',
  },
  {
    id: 'resources.diversion_payment',
    saws: 'Q28',
    label: 'Has the household ever received a CalWORKs diversion payment?',
    section: 'resources',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'resources.receivedDiversionPayment',
    canonicalKey: 'resources.received_diversion_payment',
  },

  /*
   * Program integrity, Q29-Q36. These bear on eligibility, so they are
   * "can complete later" rather than "optional" — the form never says they do
   * not matter.
   */
  {
    id: 'integrity.duplicate_benefits',
    saws: 'Q29',
    label: 'Is anyone getting the same benefits in more than one place?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.duplicateBenefits',
    canonicalKey: 'integrity.duplicate_benefits',
  },
  {
    id: 'integrity.trafficking',
    saws: 'Q30',
    label: 'Has anyone bought, sold or traded CalFresh benefits?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.traffickingBenefits',
    canonicalKey: 'integrity.trafficking_benefits',
  },
  {
    id: 'integrity.drugs',
    saws: 'Q31',
    label: 'Has anyone traded CalFresh benefits for drugs?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.tradingBenefitsForDrugs',
    canonicalKey: 'integrity.trading_benefits_for_drugs',
  },
  {
    id: 'integrity.firearms',
    saws: 'Q32',
    label: 'Has anyone traded CalFresh benefits for firearms or explosives?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.tradingBenefitsForFirearms',
    canonicalKey: 'integrity.trading_benefits_for_firearms',
  },
  {
    id: 'integrity.welfare_fraud',
    saws: 'Q33',
    label: 'Has anyone been convicted of welfare fraud?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.welfareFraudConviction',
    canonicalKey: 'integrity.welfare_fraud_conviction',
  },
  {
    id: 'integrity.sanction',
    saws: 'Q34',
    label: 'Is anyone under a penalty for not cooperating with a program?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.currentSanctionOrNonCooperation',
    canonicalKey: 'integrity.current_sanction',
  },
  {
    id: 'integrity.fleeing_felon',
    saws: 'Q35',
    label: 'Is anyone hiding or running from the law for a felony charge?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.fleeingFelon',
    canonicalKey: 'integrity.fleeing_felon',
  },
  {
    id: 'integrity.fleeing_felon_who',
    saws: 'Q35',
    label: 'Who is affected by the fleeing-felon answer?',
    section: 'integrity',
    tier: 3,
    kind: 'text',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.fleeingFelonWho',
    canonicalKey: 'integrity.fleeing_felon_who',
  },
  {
    id: 'integrity.probation_violation',
    saws: 'Q36',
    label: 'Has a court found anyone violating probation or parole?',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.probationOrParoleViolation',
    canonicalKey: 'integrity.probation_or_parole_violation',
  },
  {
    id: 'integrity.probation_who',
    saws: 'Q36',
    label: 'Who is affected by the probation answer?',
    section: 'integrity',
    tier: 3,
    kind: 'text',
    support: 'askable',
    pdf: 'mapped',
    path: 'programIntegrity.probationOrParoleWho',
    canonicalKey: 'integrity.probation_or_parole_who',
  },

  /*
   * Q37 and Q39 sit in tier 3, not tier 4. Only Q38 states in print that "your
   * answers to the questions will not affect your eligibility"; Q37 is a request
   * for a special-need payment and Q39 bears on Medi-Cal third-party recovery,
   * so calling either "Optional" would tell the applicant something untrue.
   */
  {
    id: 'integrity.special_needs_payment',
    saws: 'Q37',
    label: 'Apply for a special-need payment for items lost or damaged',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.specialNeedsPayment',
    canonicalKey: 'services.special_needs_payment',
  },
  {
    id: 'integrity.special_needs_explanation',
    saws: 'Q37',
    label: 'What was lost or damaged?',
    section: 'integrity',
    tier: 3,
    kind: 'text',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.specialNeedsExplanation',
    canonicalKey: 'services.special_needs_explanation',
  },
  {
    id: 'integrity.third_party_liability',
    saws: 'Q39',
    label: 'Anyone applying for health care in a claim, lawsuit or settlement',
    section: 'integrity',
    tier: 3,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.thirdPartyLiability',
    canonicalKey: 'services.third_party_liability',
  },
  {
    id: 'integrity.third_party_who',
    saws: 'Q39',
    label: 'Who is involved in the claim or settlement?',
    section: 'integrity',
    tier: 3,
    kind: 'text',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.thirdPartyLiabilityWho',
    canonicalKey: 'services.third_party_liability_who',
  },

  // Appendices.
  {
    id: 'appendices.tribal_name',
    saws: 'Appendix B',
    label: 'Tribal membership details',
    section: 'appendices',
    tier: 3,
    kind: 'text',
    support: 'askable',
    pdf: 'unreviewed',
    note: 'Appendix B destinations not yet reviewed.',
  },
  {
    id: 'appendices.employment_history',
    saws: 'Appendix D',
    label: 'Employment history for CalWORKs',
    section: 'appendices',
    tier: 3,
    kind: 'records',
    support: 'askable',
    pdf: 'unreviewed',
    path: 'appendices.employmentHistory.answer',
    note: 'Appendix D destinations not yet reviewed.',
  },

  /*
   * Tier 4 — the form itself states these do not affect eligibility. Q38's
   * preamble reads: "The following services are available. Your answers to the
   * questions will not affect your eligibility."
   */
  {
    id: 'services.chdp_information',
    saws: 'Q38A',
    label: 'Want more information about CHDP check-ups?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.chdpMoreInformation',
    canonicalKey: 'services.chdp_more_information',
  },
  {
    id: 'services.chdp_medical',
    saws: 'Q38A',
    label: 'Want CHDP medical services?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.chdpMedicalServices',
    canonicalKey: 'services.chdp_medical',
  },
  {
    id: 'services.chdp_dental',
    saws: 'Q38A',
    label: 'Want CHDP dental services?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.chdpDentalServices',
    canonicalKey: 'services.chdp_dental',
  },
  {
    id: 'services.chdp_transport',
    saws: 'Q38A',
    label: 'Need help with appointments or transport to CHDP services?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.chdpAppointmentOrTransportHelp',
    canonicalKey: 'services.chdp_appointment_help',
  },
  {
    id: 'services.immunization',
    saws: 'Q38B',
    label: 'Want more information about immunization services?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.immunizationInformation',
    canonicalKey: 'services.immunization_information',
  },
  {
    id: 'services.pregnancy_assistance',
    saws: 'Q38C',
    label: 'Want to talk to someone about help during pregnancy?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.pregnancyAssistance',
    canonicalKey: 'services.pregnancy_assistance',
  },
  {
    id: 'services.breastfeeding',
    saws: 'Q38D',
    label: 'Are you breastfeeding a child?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.breastfeeding',
    canonicalKey: 'services.breastfeeding',
  },
  {
    id: 'services.gave_birth_recently',
    saws: 'Q38D',
    label: 'Have you given birth within the last 12 months?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.gaveBirthInLastTwelveMonths',
    canonicalKey: 'services.gave_birth_last_twelve_months',
  },
  {
    id: 'services.family_planning',
    saws: 'Q38E',
    label: 'Want free or low-cost family-planning services?',
    section: 'integrity',
    tier: 4,
    kind: 'boolean',
    support: 'askable',
    pdf: 'mapped',
    path: 'otherServices.familyPlanningServices',
    canonicalKey: 'services.family_planning',
  },

  // ── Manual-only. These must never gain a path or a destination. ────────
  {
    id: 'manual.applicant_ssn',
    saws: 'Q6c',
    label: 'Social Security Number for each person applying',
    section: 'household',
    tier: 1,
    kind: 'text',
    support: 'manual_only',
    pdf: 'manual',
    manualReason: 'ssn',
    note:
      'Never collected, never stored, never mapped. The applicant writes it on ' +
      'the printed form.',
  },
  {
    id: 'manual.applicant_signature',
    saws: 'Q40 (signature block)',
    label: 'Applicant’s signature and the date it was signed',
    section: 'household',
    tier: 1,
    kind: 'text',
    support: 'manual_only',
    pdf: 'manual',
    manualReason: 'signature',
    note:
      'Prefilling the date would imply the document was signed on that date. ' +
      'Signing is a manual final step.',
  },
  {
    id: 'manual.other_adult_signature',
    saws: 'Q40 (signature block)',
    label: 'Spouse or other adult signature and date',
    section: 'household',
    tier: 1,
    kind: 'text',
    support: 'manual_only',
    pdf: 'manual',
    manualReason: 'signature',
  },
  {
    id: 'manual.representative_signature',
    saws: 'Appendix C',
    label: 'Authorized representative signature and date',
    section: 'circumstances',
    tier: 3,
    kind: 'text',
    support: 'manual_only',
    pdf: 'manual',
    manualReason: 'signature',
  },
];

/** Fast lookup by semantic id. */
export const SAWS2_FIELD_BY_ID: ReadonlyMap<string, Saws2Field> = new Map(
  SAWS2_FIELDS.map((field) => [field.id, field]),
);

/** Entries whose answers may reach the printed form. */
export function mappedFields(): Saws2Field[] {
  return SAWS2_FIELDS.filter((field) => field.pdf === 'mapped');
}

/**
 * Entries the questionnaire collects but cannot yet write.
 *
 * These are the honest production gap: the applicant answers them and the
 * printed form stays blank, so readiness must surface them as manual work.
 */
export function collectedButUnmappedFields(): Saws2Field[] {
  return SAWS2_FIELDS.filter(
    (field) => field.support === 'askable' && field.pdf === 'unreviewed',
  );
}

/** Entries that must never be prefilled, with the reason. */
export function manualOnlyFields(): Saws2Field[] {
  return SAWS2_FIELDS.filter((field) => field.support === 'manual_only');
}

/**
 * Priority metadata for the planner, derived rather than restated.
 *
 * Only `askable` entries appear. A `prefillable` concept comes from the
 * applicant and program steps, so the questionnaire must never ask it, and a
 * `manual_only` concept must never become a question at all.
 */
export const QUESTION_META_FROM_SCHEMA: Readonly<
  Record<string, { tier: QuestionTier; saws?: string }>
> = Object.fromEntries(
  SAWS2_FIELDS.filter((field) => field.support === 'askable').map((field) => [
    field.id,
    { tier: field.tier, saws: field.saws },
  ]),
);
