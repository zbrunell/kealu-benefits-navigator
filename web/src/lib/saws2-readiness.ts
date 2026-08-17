//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Readiness evaluation for a SAWS 2 PLUS application.
 *
 * Three states, deliberately not equivalent:
 *
 * - **filingReady** — the information Kealu holds is sufficient for a legally
 *   valid filing that establishes the application date, *once the applicant
 *   signs*. The signature is never counted as missing here: Kealu will not
 *   collect or generate one, so it is reported under
 *   `manualCompletionRequired` instead. A filingReady application is therefore
 *   "ready to sign and file", not "already filed".
 * - **determinationReady** — enough is present that the county could reach an
 *   eligibility determination, subject to the interview and verification that
 *   policy requires regardless of what we collect.
 * - **fullyPrefilled** — every field Kealu currently supports and can safely
 *   answer has been answered.
 *
 * Design rules:
 *
 * - Every blocking rule carries an authoritative citation in `source`. A rule
 *   that could not be grounded in an authoritative source is not implemented
 *   here; see docs/saws2-readiness-requirements.md for the open questions.
 * - An unanswered conditional gateway never blocks *filing*. Nothing in the
 *   authoritative filing rules requires income, resources, or any questionnaire
 *   answer to establish a filing date.
 * - "Not determinationReady" never means "invalid application".
 *   7 CFR 273.2, MPP 40-126.11 and 42 CFR 435.912(g)(2) all bar denial merely
 *   because the record is not yet complete.
 */

import {
  assessDraftCompletion,
  type DraftCompletion,
  type ManualItem,
} from '@/lib/draft-completion';
import {
  getRequiredApplicationQuestions,
  householdHasElderlyOrDisabledMember,
  isAnswered,
} from '@/lib/saws2-question-planner';
import type { Saws2PlusApplicationData } from '@/types/application';
import type { Saws2PlusProgram } from '@/lib/report-assembler';

/** Which stage a requirement belongs to. */
export type ReadinessStage = 'filing' | 'determination' | 'expedited' | 'optional';

/** What happens when the item is missing. */
export type OmissionEffect =
  | 'prevents_filing'
  | 'allows_filing_requires_follow_up'
  | 'prevents_determination'
  | 'affects_expedited_screening_only'
  | 'optional';

export interface Requirement {
  /** Stable, PII-free identifier. */
  id: string;
  /** 'all' when the rule applies to every program on the form. */
  program: 'all' | Saws2PlusProgram;
  /** What the applicant (or county) needs. */
  requirement: string;
  stage: ReadinessStage;
  effect: OmissionEffect;
  /** Authoritative citation for this rule. */
  source: string;
  /**
   * True when Kealu must never supply this: Social Security Numbers and
   * signatures. These appear in `manualCompletionRequired`, never as a reason to
   * collect or generate the value.
   */
  manualOnly?: boolean;
  /** Set when the rule's scope is contested; see the requirements doc. */
  unresolved?: string;
}

export interface ProgramReadiness {
  program: Saws2PlusProgram;
  filingReady: boolean;
  determinationReady: boolean;
  missingForFiling: Requirement[];
  missingForDetermination: Requirement[];
}

/**
 * Why a generated draft is not yet "review, add SSNs, and sign".
 *
 * Answering every question the flow asks is not the same as producing a
 * complete document: a question can be answered and still have nowhere on the
 * printed form to go, and a printed question the product does not model at all
 * never becomes a question in the first place. Both leave the applicant with
 * blanks, so both are reported rather than hidden behind a single boolean.
 *
 * The fields here now come from `assessDraftCompletion`, which inspects the
 * draft that was actually generated, rather than from the semantic inventory,
 * which describes the product's capabilities and gave every household the same
 * answer. `completion` carries the full per-item detail; the three lists below
 * are the same information shaped for the readiness UI.
 */
export interface DraftCompleteness {
  /**
   * True only when nothing but signatures and their dates remains.
   *
   * Literal, and therefore usually false: every draft leaves at least the page
   * 1 Social Security box for the applicant. Use `completion.readyForSignature`
   * for "Kealu has done everything it can", and always show the manual items
   * beside either one.
   */
  reviewAndSignOnly: boolean;
  /** Answers the applicant gave that the form cannot yet receive. */
  answeredButNotWritable: Requirement[];
  /** Printed questions the product has no model for. */
  notModeled: Requirement[];
  /** Repeated records beyond the rows the printed form provides. */
  overflow: Requirement[];
  /** The per-draft detail every guide is generated from. */
  completion: DraftCompletion;
}

export interface ApplicationReadiness {
  filingReady: boolean;
  determinationReady: boolean;
  /**
   * Nothing Kealu can safely answer is still outstanding in the questionnaire.
   *
   * This is a statement about the *interview*, not about the document. See
   * `draftCompleteness.reviewAndSignOnly` for whether the generated PDF is
   * actually finished.
   */
  fullyPrefilled: boolean;
  draftCompleteness: DraftCompleteness;
  selectedPrograms: {
    calfresh?: ProgramReadiness;
    calworks?: ProgramReadiness;
    mediCal?: ProgramReadiness;
  };
  missingForFiling: Requirement[];
  missingForDetermination: Requirement[];
  manualCompletionRequired: Requirement[];
  recommendedButOptional: Requirement[];
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SOURCE = {
  /** CalFresh minimum filing content. */
  CF_FILING:
    'MPP § 63-300.21 / § 63-300.32; 7 CFR § 273.2 (application filed when it contains the applicant’s name and address and is signed by a responsible household member or authorized representative)',
  CF_HOMELESS_ADDRESS:
    'MPP § 63-300 as implemented by county policy: for a homeless applicant the district/county office address is acceptable',
  CF_ES_SCREEN:
    '7 CFR § 273.2(i)(1); MPP § 63-301 — every CalFresh application must be screened for expedited service; ES benefits are due no later than 3 days from the application date',
  CF_INTERVIEW:
    '7 CFR § 273.2(e)(1); county policy under MPP § 63-300 — all households must be interviewed before CalFresh eligibility is determined',
  CF_FORM_ACCEPTED:
    'County policy under MPP § 63-300 lists SAWS 2 PLUS among the acceptable CalFresh application forms',

  /** CalWORKs. */
  CW_APPLICATION_FORM:
    'MPP § 40-103.4 — “An application is a request for aid in writing made to the county welfare department on the SAWS 1”',
  CW_STATEMENT_OF_FACTS:
    'MPP § 40-105.22 — the applicant is given a Statement of Facts to complete and sign under penalty of perjury',
  CW_EVIDENCE_PARTICIPATION:
    'MPP § 40-105.222 / § 40-105.224 — the applicant must participate in gathering evidence; the application process is not complete until all the evidence is in',
  CW_NO_DENIAL_FOR_DELAY:
    'MPP § 40-126.1 / § 40-126.11 — 45 days from the day after filing to act; inability to complete the determination in time is not a basis for denial',
  CW_IDENTITY:
    'MPP § 40-105.343 — where acceptable photo identification does not exist, the applicant’s sworn statement under penalty of perjury as to identity is sufficient',
  CW_RIGHT_TO_APPLY:
    'MPP § 40-109.1 — any person has the right to apply; an applicant who appears ineligible must still be allowed to apply',

  /** Medi-Cal. */
  MC_SIGNATURE:
    '42 CFR § 435.907(f) — all initial applications must be signed under penalty of perjury',
  MC_ACCEPT:
    '42 CFR § 435.907(a) — the agency must accept an application filed through any of the listed channels',
  MC_SSN_APPLICANT:
    '42 CFR § 435.910(a) — each individual seeking Medicaid must furnish their SSN as a condition of eligibility',
  MC_SSN_LATER:
    '42 CFR § 435.910(f) — the agency must not deny or delay services to an otherwise eligible individual pending issuance or verification of the SSN',
  MC_SSN_EXCEPTIONS:
    '42 CFR § 435.910(h) — the SSN requirement does not apply to individuals ineligible for an SSN or with well-established religious objections',
  MC_SSN_NONAPPLICANT:
    '42 CFR § 435.907(e)(3) — an SSN may be requested from a non-applicant only voluntarily, with notice',
  MC_TIMELINESS:
    '42 CFR § 435.912(c)(3) — 45 days (90 days for disability-based applications); § 435.912(g)(2) bars denying eligibility because the agency missed the standard',
} as const;

// ---------------------------------------------------------------------------
// Field-level helpers
// ---------------------------------------------------------------------------

function hasText(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function applicantHasName(data: Saws2PlusApplicationData): boolean {
  return hasText(data.applicant.firstName) && hasText(data.applicant.lastName);
}

/**
 * Whether an address adequate for filing is on file.
 *
 * A homeless applicant is not blocked: county policy accepts the district office
 * address, which the county supplies rather than the applicant.
 */
function applicantHasFilingAddress(data: Saws2PlusApplicationData): boolean {
  if (data.preferences.homeless === true) return true;

  const address = data.applicant.homeAddress;

  return hasText(address.street) && hasText(address.city) && hasText(address.zipCode);
}

/** Every household member needs an age or date of birth for a determination. */
function householdAgesKnown(data: Saws2PlusApplicationData): boolean {
  return data.householdMembers.every(
    (member) => member.age !== undefined || hasText(member.dateOfBirth),
  );
}

/**
 * True when a tri-state gateway has been answered either way.
 *
 * Re-exported from the planner rather than redefined, so "answered" cannot drift
 * between what the flow asks and what readiness reports as outstanding.
 */
const answered = isAnswered;

/** Income gateways the county needs answered to compute any budget. */
function incomeGatewaysAnswered(data: Saws2PlusApplicationData): boolean {
  const income = data.questionnaire.income;

  return (
    answered(income.earned.answer) &&
    answered(income.selfEmployment.answer) &&
    answered(income.unearned.answer)
  );
}

// ---------------------------------------------------------------------------
// Requirement builders
// ---------------------------------------------------------------------------

/** Requirements shared by every program on the form. */
function sharedFilingRequirements(
  data: Saws2PlusApplicationData,
): Requirement[] {
  const missing: Requirement[] = [];

  if (!applicantHasName(data)) {
    missing.push({
      id: 'filing.applicant_name',
      program: 'all',
      requirement: 'Applicant’s first and last name',
      stage: 'filing',
      effect: 'prevents_filing',
      source: SOURCE.CF_FILING,
    });
  }

  if (!applicantHasFilingAddress(data)) {
    missing.push({
      id: 'filing.applicant_address',
      program: 'all',
      requirement:
        'Applicant’s address. A homeless applicant may use the county district office address instead.',
      stage: 'filing',
      effect: 'prevents_filing',
      source: `${SOURCE.CF_FILING}; ${SOURCE.CF_HOMELESS_ADDRESS}`,
    });
  }

  return missing;
}

/**
 * Items only the applicant can complete on the printed form.
 *
 * These are reported, never collected. The signature is what makes a printed
 * SAWS 2 PLUS a filed application, but Kealu neither collects nor generates it.
 */
function manualRequirements(
  data: Saws2PlusApplicationData,
  programs: Saws2PlusProgram[],
): Requirement[] {
  const manual: Requirement[] = [
    {
      id: 'manual.signature',
      program: 'all',
      requirement:
        'Signature of the applicant, or of a responsible adult household member or authorized representative, on the printed form. Until it is signed the paper application is not filed.',
      stage: 'filing',
      effect: 'prevents_filing',
      source: `${SOURCE.CF_FILING}; ${SOURCE.MC_SIGNATURE}`,
      manualOnly: true,
    },
    {
      id: 'manual.application_date',
      program: 'all',
      requirement:
        'The application date is set by the county when it receives the signed form; it is not something Kealu can fill in.',
      stage: 'filing',
      effect: 'optional',
      source: SOURCE.MC_ACCEPT,
      manualOnly: true,
    },
  ];

  if (programs.includes('medi_cal')) {
    manual.push({
      id: 'manual.ssn_medi_cal',
      program: 'medi_cal',
      requirement:
        'Social Security Number for each person applying for Medi-Cal, written on the form by hand. It may be supplied after filing: services must not be denied or delayed while an SSN is pending, and it is not required of non-applicants or of people who are ineligible for an SSN or have a religious objection.',
      stage: 'determination',
      effect: 'allows_filing_requires_follow_up',
      source: `${SOURCE.MC_SSN_APPLICANT}; ${SOURCE.MC_SSN_LATER}; ${SOURCE.MC_SSN_EXCEPTIONS}; ${SOURCE.MC_SSN_NONAPPLICANT}`,
      manualOnly: true,
    });
  }

  if (programs.includes('calworks')) {
    manual.push({
      id: 'manual.calworks_saws1',
      program: 'calworks',
      requirement:
        'A SAWS 1 may be needed to establish the CalWORKs application date. The regulation defines a cash-aid application as a written request made on the SAWS 1, while county policy also lists SAWS 2 PLUS as an acceptable application form — confirm with the county which form sets the date.',
      stage: 'filing',
      effect: 'allows_filing_requires_follow_up',
      source: `${SOURCE.CW_APPLICATION_FORM}; ${SOURCE.CF_FORM_ACCEPTED}`,
      manualOnly: true,
      unresolved:
        'MPP § 40-103.4 names the SAWS 1 as the cash-aid application of record; county policy lists SAWS 2 PLUS as acceptable. Treated as a follow-up item, not a filing blocker.',
    });
  }

  manual.push({
    id: 'manual.identity',
    program: 'all',
    requirement:
      'Proof of identity at the interview. Where acceptable photo identification does not exist, a sworn statement as to identity is sufficient.',
    stage: 'determination',
    effect: 'prevents_determination',
    source: SOURCE.CW_IDENTITY,
    manualOnly: true,
  });

  return manual;
}

/** CalFresh determination-stage requirements. */
function calFreshDetermination(data: Saws2PlusApplicationData): Requirement[] {
  const missing: Requirement[] = [];

  if (!incomeGatewaysAnswered(data)) {
    missing.push({
      id: 'determination.calfresh.income',
      program: 'calfresh',
      requirement:
        'Whether anyone has earned income, self-employment, or income that does not come from work — answered either way.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.CF_INTERVIEW,
    });
  }

  if (!householdAgesKnown(data)) {
    missing.push({
      id: 'determination.calfresh.household_ages',
      program: 'calfresh',
      requirement: 'A date of birth or age for every household member.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.CF_INTERVIEW,
    });
  }

  if (!answered(data.questionnaire.expenses.household.answer)) {
    missing.push({
      id: 'determination.calfresh.shelter_costs',
      program: 'calfresh',
      requirement:
        'Whether the household pays rent, a mortgage, or utilities. Shelter and utility costs change the CalFresh benefit amount.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.CF_INTERVIEW,
    });
  }

  return missing;
}

/** CalWORKs determination-stage requirements. */
function calWorksDetermination(data: Saws2PlusApplicationData): Requirement[] {
  const missing: Requirement[] = [];

  if (!incomeGatewaysAnswered(data)) {
    missing.push({
      id: 'determination.calworks.income',
      program: 'calworks',
      requirement:
        'Income answers for the household, so the county can complete the Statement of Facts.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.CW_STATEMENT_OF_FACTS,
    });
  }

  if (!householdAgesKnown(data)) {
    missing.push({
      id: 'determination.calworks.household_ages',
      program: 'calworks',
      requirement: 'A date of birth or age for every household member.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.CW_STATEMENT_OF_FACTS,
    });
  }

  if (!answered(data.questionnaire.resources.accounts.answer)) {
    missing.push({
      id: 'determination.calworks.resources',
      program: 'calworks',
      requirement:
        'Whether anyone has cash, a bank account, or other savings. Cash aid applies a property limit.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.CW_EVIDENCE_PARTICIPATION,
    });
  }

  return missing;
}

/** Medi-Cal determination-stage requirements. */
function mediCalDetermination(data: Saws2PlusApplicationData): Requirement[] {
  const missing: Requirement[] = [];

  if (!incomeGatewaysAnswered(data)) {
    missing.push({
      id: 'determination.medi_cal.income',
      program: 'medi_cal',
      requirement: 'Household income answers, for the MAGI determination.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.MC_TIMELINESS,
    });
  }

  const citizenshipAnswered =
    answered(data.applicant.householdDetails.citizenOrNational) &&
    data.householdMembers.every((member) =>
      answered(
        member.adultDetails?.citizenOrNational ??
          member.childDetails?.citizenOrNational,
      ),
    );

  if (!citizenshipAnswered) {
    missing.push({
      id: 'determination.medi_cal.citizenship',
      program: 'medi_cal',
      requirement:
        'Whether each person applying is a U.S. citizen or national. Immigration status for non-citizens is verified separately by the county.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.MC_TIMELINESS,
    });
  }

  if (!answered(data.questionnaire.health.taxFiler)) {
    missing.push({
      id: 'determination.medi_cal.tax_household',
      program: 'medi_cal',
      requirement:
        'Whether the applicant plans to file a federal tax return, which establishes the MAGI tax household.',
      stage: 'determination',
      effect: 'prevents_determination',
      source: SOURCE.MC_TIMELINESS,
    });
  }

  return missing;
}

/** Items that improve the outcome but never block filing or determination. */
function optionalRequirements(data: Saws2PlusApplicationData): Requirement[] {
  const optional: Requirement[] = [];

  if (!hasText(data.applicant.phone) && !hasText(data.applicant.email)) {
    optional.push({
      id: 'optional.contact_information',
      program: 'all',
      requirement:
        'A phone number or email address. Not required to file, but the county needs to reach you for the interview.',
      stage: 'optional',
      effect: 'optional',
      source: SOURCE.CF_INTERVIEW,
    });
  }

  if (!answered(data.questionnaire.circumstances.californiaResident)) {
    optional.push({
      id: 'optional.residency',
      program: 'all',
      requirement:
        'Confirmation that the household lives in California. Residency is an eligibility factor the county verifies; leaving it blank does not stop the filing.',
      stage: 'determination',
      effect: 'allows_filing_requires_follow_up',
      source: SOURCE.CW_EVIDENCE_PARTICIPATION,
    });
  }

  return optional;
}

/**
 * Expedited-service screening inputs for CalFresh.
 *
 * Missing these never blocks filing or determination — the county screens every
 * application regardless — but without them Kealu cannot show whether the
 * household looks entitled to benefits within three days.
 */
function expeditedRequirements(
  data: Saws2PlusApplicationData,
  programs: Saws2PlusProgram[],
): Requirement[] {
  if (!programs.includes('calfresh')) return [];

  const expedited = data.expeditedService;
  const anyAnswered = Object.values(expedited).some(
    (value) => value !== undefined,
  );

  if (anyAnswered) return [];

  return [
    {
      id: 'expedited.calfresh_screening',
      program: 'calfresh',
      requirement:
        'The expedited-service screening questions (very low income and resources, housing costs, migrant or seasonal farm work). The county screens every application anyway; answering these lets us show whether 3-day benefits look likely.',
      stage: 'expedited',
      effect: 'affects_expedited_screening_only',
      source: SOURCE.CF_ES_SCREEN,
    },
  ];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const PROGRAM_KEYS = {
  calfresh: 'calfresh',
  calworks: 'calworks',
  medi_cal: 'mediCal',
} as const;

/** One manual item, shaped as a readiness requirement. */
function requirementFor(item: ManualItem): Requirement {
  const where = item.page
    ? ` (${item.printedPage}, PDF page ${item.page})`
    : '';

  return {
    id: `draft.${item.id}`,
    program: 'all',
    requirement: `${item.saws}: ${item.printedLabel}${where}. ${item.instruction}`,
    stage: item.reason === 'missing_answer' ? 'determination' : 'filing',
    effect: 'allows_filing_requires_follow_up',
    source: SOURCE.CF_FILING,
    manualOnly:
      item.reason === 'ssn' ||
      item.reason === 'signature' ||
      item.reason === 'signature_date',
  };
}

/**
 * What still stands between the generated PDF and a review-and-sign draft.
 *
 * Delegates to `assessDraftCompletion`, which walks the draft that was actually
 * produced. This used to read the semantic inventory instead, which describes
 * what the *product* can do rather than what *this document* contains — so it
 * reported the same blockers to every household regardless of their answers,
 * and reported none at all for a household whose eighth job simply fell off the
 * end of a four-row table.
 */
function draftCompleteness(data: Saws2PlusApplicationData): DraftCompleteness {
  const completion = assessDraftCompletion(data);

  return {
    reviewAndSignOnly: completion.reviewAndSignOnly,
    answeredButNotWritable: completion.byReason.write_in.map(requirementFor),
    notModeled: completion.byReason.unsupported.map(requirementFor),
    overflow: completion.byReason.overflow.map(requirementFor),
    completion,
  };
}

/**
 * Evaluate how ready an application is, per program and overall.
 *
 * Pure: no I/O, no mutation, no clock or randomness.
 */
export function evaluateApplicationReadiness(
  data: Saws2PlusApplicationData,
  selectedPrograms: Saws2PlusProgram[] = data.selectedPrograms,
): ApplicationReadiness {
  const programs = [...new Set(selectedPrograms)];

  const sharedFiling = sharedFilingRequirements(data);
  const manual = manualRequirements(data, programs);
  const optional = [
    ...optionalRequirements(data),
    ...expeditedRequirements(data, programs),
  ];

  const determinationByProgram: Record<Saws2PlusProgram, Requirement[]> = {
    calfresh: programs.includes('calfresh') ? calFreshDetermination(data) : [],
    calworks: programs.includes('calworks') ? calWorksDetermination(data) : [],
    medi_cal: programs.includes('medi_cal') ? mediCalDetermination(data) : [],
  };

  const selected: ApplicationReadiness['selectedPrograms'] = {};

  for (const program of programs) {
    // Filing requirements are the same across the three programs on this form;
    // per-program filing differences are reported as manual follow-ups.
    const missingForFiling = sharedFiling;
    const missingForDetermination = determinationByProgram[program];

    selected[PROGRAM_KEYS[program]] = {
      program,
      filingReady: missingForFiling.length === 0,
      determinationReady:
        missingForFiling.length === 0 && missingForDetermination.length === 0,
      missingForFiling,
      missingForDetermination,
    };
  }

  const missingForDetermination = programs.flatMap(
    (program) => determinationByProgram[program],
  );

  const filingReady = sharedFiling.length === 0;

  /*
   * fullyPrefilled: nothing Kealu can safely answer is still outstanding. The
   * planner is the authority on what remains askable; SSN and signature are
   * excluded by construction because they are never planned questions.
   */
  const plan = getRequiredApplicationQuestions(data);
  const completeness = draftCompleteness(data);

  return {
    filingReady,
    determinationReady: filingReady && missingForDetermination.length === 0,
    fullyPrefilled: plan.outstanding.length === 0,
    draftCompleteness: completeness,
    selectedPrograms: selected,
    missingForFiling: sharedFiling,
    missingForDetermination,
    manualCompletionRequired: manual,
    recommendedButOptional: optional,
  };
}

/**
 * Whether the household looks entitled to CalFresh expedited service.
 *
 * Screening criteria only — the county makes the actual call. Returns undefined
 * when the answers needed to screen are not present, which is different from
 * "not entitled".
 */
export function looksExpeditedEligible(
  data: Saws2PlusApplicationData,
): boolean | undefined {
  const expedited = data.expeditedService;

  const criteria = [
    expedited.grossIncomeUnder150AndResourcesUnder100,
    expedited.incomeAndResourcesLessThanHousingCosts,
    expedited.migrantOrSeasonalFarmWorker,
  ];

  if (criteria.some((value) => value === true)) return true;
  if (criteria.every((value) => value === false)) return false;

  return undefined;
}

/** Re-exported so callers can show why a rule blocks without re-deriving it. */
export const READINESS_SOURCES = SOURCE;

/** True when the household includes someone 60+ or disabled (medical deduction). */
export { householdHasElderlyOrDisabledMember };
