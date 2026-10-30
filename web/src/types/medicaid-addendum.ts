/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */

/**
 * The answers Texas's Medicaid / CHIP addendum asks that nothing else in the
 * application already holds.
 *
 * HHSC's Form H1010 carries an addendum (printed "H1010-M", pages 1-A to 9-A)
 * that every household applying for Medicaid, CHIP or Healthy Texas Women must
 * fill in. Most of it is already answerable from the shared model — Appendix A
 * is `health.employerCoverage`, Appendix B is `appendices.tribalMembership`,
 * Appendix C is the authorized representative, "a child has a parent living
 * outside the home" is `circumstances.absentParents`. This record holds only
 * the rest: questions the shared model has no field for, kept here rather than
 * spread across the California questionnaire so that nothing a Texas household
 * answers can change what a California household is asked or sent.
 *
 * Optional on the application, and every field optional or a string, so an
 * application saved before this existed — or a California one — reads as
 * "never asked" rather than failing.
 */

import type { TriState } from '@/types/saws-questionnaire';

/**
 * Section 1, one person's tax return answers.
 *
 * Keyed by the person's member id (`applicant` for Person 1) rather than by
 * printed row, so reordering or removing someone in the roster cannot move one
 * person's answers onto another's block.
 */
export interface TaxReturnAnswers {
  /** "If married, name of spouse", when the roster cannot say who it is. */
  spouseName?: string;
  /** "Do you plan to file a federal income tax return next year?" */
  plansToFile?: TriState;
  /** a. "Will you file jointly with a spouse?" */
  filesJointly?: TriState;
  /** b. "Are you afraid that giving facts about this person might put you or your children in danger?" */
  fearsHarmFromDisclosure?: TriState;
  /** c. "Will you claim any dependents on your tax return?" */
  claimsDependents?: TriState;
  /** c. "If yes, list name(s) of dependents" */
  dependentNames?: string;
  /** d. "Will you be claimed as a dependent on someone's tax return?" */
  claimedAsDependent?: TriState;
  /** d. "If yes, list the name of tax filer" */
  taxFilerName?: string;
  /** d. "How are you related to the tax filer?" */
  relationshipToTaxFiler?: string;
}

/** Section 5, question 2: why the job-based insurance ended, as printed. */
export type LostJobCoverageReason =
  | 'parent_job_ended'
  | 'parent_cobra_or_ers_ended'
  | 'parent_marital_status_changed'
  | 'chip_other_state_ended'
  | 'medicaid_other_state_ended'
  | 'private_coverage_ended'
  | 'parent_died'
  | 'child_special_health_care_needs'
  | 'medicaid_ended'
  | 'other';

/** Section 6 B: how many years HHSC may renew coverage from tax data. */
export type RenewalYears = 'five' | 'four' | 'three' | 'two' | 'one' | 'none';

/** Section 3, question 7: a woman who does not want to be tested for HTW. */
export interface HtwScreeningOptOut {
  /** The person, from the household; `applicant` for Person 1. */
  memberId: string;
}

export interface MedicaidAddendumAnswers {
  /** Section 1, by member id. */
  taxReturns: Record<string, TaxReturnAnswers>;

  // ── Section 2: tax deductions ──────────────────────────────────────────
  /** Whether anyone has any of the deductions — decides whether to ask which. */
  hasTaxDeductions?: TriState;
  paysAlimony?: TriState;
  alimonyAmount?: number;
  alimonyFrequency?: string;
  /** "Was the divorce or separation agreement executed or last modified on or before Dec. 31, 2018?" */
  alimonyAgreementBefore2019?: TriState;
  paysStudentLoanInterest?: TriState;
  studentLoanInterestAmount?: number;
  studentLoanInterestFrequency?: string;
  hasOtherDeductions?: TriState;
  otherDeductionsAmount?: number;
  otherDeductionsFrequency?: string;
  otherDeductionsTypes?: string;

  // ── Section 3: people applying ─────────────────────────────────────────
  /** 1. "Does a child applying for health care travel with a family member who is a migrant farm worker?" */
  childTravelsWithMigrantWorker?: TriState;
  migrantChildNames?: string;
  /** 2. "Is a child in the Children with Special Health Care Needs program?" */
  childInSpecialHealthCareNeeds?: TriState;
  specialHealthCareNeedsWho?: string;
  /** 4. "Was anyone in foster care when they were age 18 or older?" */
  fosterCareAt18OrOlder?: TriState;
  fosterCareWho?: string;
  fosterCareState?: string;
  /** 6. Whether to give HHSC a confidential address for HTW letters. */
  wantsConfidentialHtwContact?: TriState;
  confidentialStreet?: string;
  confidentialCity?: string;
  confidentialState?: string;
  confidentialZipCode?: string;
  confidentialPhone?: string;
  /** 7. Whether any woman does not want to be tested for HTW. */
  declinesHtwScreening?: TriState;
  htwScreeningOptOuts?: HtwScreeningOptOut[];

  // ── Section 4: money you get, when it changes month to month ───────────
  totalIncomeThisYear?: number;
  totalIncomeNextYear?: number;

  // ── Section 5, question 2: job-based insurance lost ─────────────────────
  lostJobCoverage?: TriState;
  lostJobCoverageWho?: string;
  lostJobCoverageEndDate?: string;
  lostJobCoverageReason?: LostJobCoverageReason;
  lostJobCoverageOtherReason?: string;

  // ── Section 6 ──────────────────────────────────────────────────────────
  /** A. "Is anyone who is applying for health coverage in jail (incarcerated)?" */
  incarcerated?: TriState;
  incarceratedWho?: string;
  /** B. Renewing coverage from tax data. */
  renewalYears?: RenewalYears;

  // ── Appendix C: certified application counselor, navigator, agent, broker
  completedByAssister?: TriState;
  assisterStartDate?: string;
  assisterName?: string;
  assisterOrganization?: string;
  assisterOrganizationId?: string;
}

export function emptyMedicaidAddendum(): MedicaidAddendumAnswers {
  return { taxReturns: {} };
}
