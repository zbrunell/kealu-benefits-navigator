//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The guide for an application we do not fill in.
 *
 * Deliberately not the SAWS completion guide. That one answers "which printed
 * boxes on this draft are still blank, and where are they" — it quotes page
 * numbers, printed headings and appendix labels, all of which only exist
 * because we hold and have verified a specific PDF. Reusing it for a manual
 * application would mean inventing pages and labels for a form nobody has
 * inspected, which is the exact failure this project avoids elsewhere.
 *
 * This guide answers a different question: "what do I do next, and what do I
 * already have?" It lists the programmes the household may qualify for and why,
 * where to file, what of their own information they have already given us and
 * can copy across, and what they will need that we never asked for.
 *
 * Everything here is data plus catalog keys, the same as the eligibility
 * reasons: the module chooses what to say and never what words to say it in.
 */

import type { EligibilityReason } from '@/lib/eligibility-reasons';
import type {
  ApplicationChannel,
  StateApplicationDefinition,
} from '@/lib/state-applications';
import type { ProgramRecommendation } from '@/lib/report-assembler';
import type { Saws2PlusApplicationData } from '@/types/application';

/** One programme, as the guide presents it. */
export interface ManualProgramEntry {
  program: string;
  /** Catalog key for the programme's name. */
  nameKey: string;
  /** Why this household may qualify — the screening's own reasons. */
  reasons: readonly EligibilityReason[];
  /** What the screening still needs, if anything. */
  missingInformation: readonly EligibilityReason[];
  recommendedToApply: boolean;
}

/** An answer the applicant already gave that the paper form will ask for. */
export interface CarriedAnswer {
  /** Catalog key naming the field. */
  labelKey: string;
  /** The value, as the applicant entered it. Never reformatted or guessed. */
  value: string;
}

/** A step the applicant has to take themselves. */
export interface ManualStep {
  /** Catalog key for the instruction. */
  key: string;
  /** Values the instruction interpolates. */
  params?: Record<string, string | number>;
}

export interface ManualApplicationGuide {
  formId: string;
  /** The agency's own designation, untranslated. */
  formCode: string;
  formNameKey: string;
  officialUrl: string;
  channels: readonly ApplicationChannel[];
  howToApplyKey: string;
  programs: readonly ManualProgramEntry[];
  /**
   * What the applicant told us that the official form will ask for.
   *
   * Not a prefill — we are not filling anything. It is a transcription aid, so
   * someone at a county office with a paper form is not answering the same
   * questions from memory a second time.
   */
  carriedAnswers: readonly CarriedAnswer[];
  /** What they must do, in order. */
  steps: readonly ManualStep[];
  /**
   * Information the official form is likely to need that we never collected.
   *
   * Only things we know we do not ask. This is not a guess at the form's
   * contents: it is a statement about our own intake, which we can be certain
   * about. A Social Security number is on every benefits application in the
   * country and we deliberately never ask for one.
   */
  notCollected: readonly ManualStep[];
}

/** Programme name keys, by programme id. */
const PROGRAM_NAME_KEYS: Record<string, string> = {
  medi_cal: 'program_medi_cal',
  calfresh: 'program_calfresh',
  calworks: 'program_calworks',
  tx_medicaid: 'program_tx_medicaid',
  tx_chip: 'program_tx_chip',
  tx_snap: 'program_tx_snap',
  tx_tanf: 'program_tx_tanf',
};

/** A trimmed value, or undefined when there is nothing to carry. */
function present(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? '').trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The answers worth carrying to a paper form.
 *
 * Only what the applicant actually entered. A field they skipped produces no
 * entry rather than a blank row: a checklist that lists everything and marks
 * most of it empty is harder to use than one that lists what you have.
 */
function carriedAnswersFrom(
  application: Saws2PlusApplicationData,
): CarriedAnswer[] {
  const applicant = application.applicant;
  const address = applicant.homeAddress;
  const carried: CarriedAnswer[] = [];

  const add = (labelKey: string, value: string | undefined) => {
    const kept = present(value);

    if (kept !== undefined) carried.push({ labelKey, value: kept });
  };

  add('field_first_name', applicant.firstName);
  add('field_middle_name', applicant.middleName);
  add('field_last_name', applicant.lastName);
  add('field_date_of_birth', applicant.dateOfBirth);
  add('field_phone_number', applicant.phone);
  add('field_email', applicant.email);
  add('field_street_address', address?.street);
  add('field_apartment', address?.apartment);
  add('field_city', address?.city);
  add('field_state', address?.state);
  add('field_zip_code', address?.zipCode);

  /*
   * Household size rather than each member's details. The size is what a paper
   * form asks first, and it is the one number an applicant most often has to
   * stop and count.
   */
  const householdSize = 1 + application.householdMembers.length;

  carried.push({
    labelKey: 'field_household_size',
    value: String(householdSize),
  });

  return carried;
}

/** Whether the household reported any earned or unearned income. */
function reportedIncome(application: Saws2PlusApplicationData): boolean {
  const income = application.questionnaire.income;

  return income.earned?.answer === true || income.unearned?.answer === true;
}

/**
 * Build the guide for a state whose application we do not fill.
 *
 * Pure: the same household and recommendations always produce the same guide.
 */
export function buildManualApplicationGuide(
  definition: StateApplicationDefinition,
  recommendations: readonly ProgramRecommendation[],
  application: Saws2PlusApplicationData,
): ManualApplicationGuide {
  /*
   * Only the programmes this form covers. A recommendation for a programme on
   * another state's form would mean the screening and the registry disagree,
   * and silently listing it would send the applicant to the wrong agency.
   */
  const covered = recommendations.filter((recommendation) =>
    (definition.programs as readonly string[]).includes(recommendation.program),
  );

  const programs: ManualProgramEntry[] = covered.map((recommendation) => ({
    program: recommendation.program,
    nameKey: PROGRAM_NAME_KEYS[recommendation.program] ?? recommendation.program,
    reasons: recommendation.reasons,
    missingInformation: recommendation.missingInformation,
    recommendedToApply: recommendation.recommendedToApply,
  }));

  const steps: ManualStep[] = [
    { key: 'manual_step_open_official', params: { form: definition.formCode } },
    { key: 'manual_step_copy_answers' },
    { key: 'manual_step_answer_remaining' },
    { key: 'manual_step_submit' },
  ];

  /*
   * What we know we did not ask. Stated as facts about our intake, not
   * predictions about the form.
   */
  const notCollected: ManualStep[] = [
    { key: 'manual_missing_ssn' },
    { key: 'manual_missing_signature' },
    { key: 'manual_missing_immigration_documents' },
  ];

  if (reportedIncome(application)) {
    // They told us there is income, so the form will want the detail we hold
    // only in summary — employer names, pay dates, amounts per cheque.
    notCollected.push({ key: 'manual_missing_income_detail' });
  }

  return {
    formId: definition.formId,
    formCode: definition.formCode,
    formNameKey: definition.formNameKey,
    officialUrl: definition.officialUrl,
    channels: definition.channels,
    howToApplyKey: definition.howToApplyKey,
    programs,
    carriedAnswers: carriedAnswersFrom(application),
    steps,
    notCollected,
  };
}
