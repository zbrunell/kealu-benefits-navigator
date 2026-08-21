//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Pure planner for the SAWS 2 PLUS application questionnaire.
 *
 * It answers one question: given everything we know, what should we ask next?
 * All branching lives here so the UI can render sections without embedding the
 * form's conditional logic in React.
 *
 * Rules it enforces:
 *
 * - A gateway whose answer is `undefined` produces the gateway question.
 * - A gateway answered `false` produces nothing further: its detail records are
 *   inert (see `activeEntries`), never asked about and never submitted.
 * - A gateway answered `true` with no records asks for at least one record, and
 *   surfaces any required field still missing inside the records it has.
 * - Appendices activate only when their prerequisite holds.
 * - Question ids are stable, derived from section and field names only — never
 *   from applicant data, so no PII can leak into an id, a log, or a DOM id.
 */

import { QUESTION_META_FROM_SCHEMA } from '@/lib/saws2-schema';
import type { Saws2PlusApplicationData } from '@/types/application';
import {
  APPLICANT_MEMBER_ID,
  type GatewaySection,
  type Saws2PlusQuestionnaire,
  type TriState,
} from '@/types/saws-questionnaire';

/** Section groupings shown as wizard steps, in order. */
export const QUESTION_SECTIONS = [
  'household',
  'circumstances',
  'income',
  'expenses',
  'health',
  'resources',
  'integrity',
  'appendices',
] as const;

export type QuestionSection = (typeof QUESTION_SECTIONS)[number];

export const SECTION_TITLES: Record<QuestionSection, string> = {
  household: 'Applicant & household',
  circumstances: 'Household circumstances',
  income: 'Income',
  expenses: 'Expenses',
  health: 'Health coverage & taxes',
  resources: 'Resources & property',
  integrity: 'Program history',
  appendices: 'Additional forms',
};

/** What kind of answer a question expects. */
export type QuestionKind = 'gateway' | 'records' | 'field' | 'choice';

/**
 * Priority tier, derived from what the SAWS 2 PLUS form itself needs — not from
 * PDF field order.
 *
 * The form states that answering Q1, Q6-Q9, Q15 and Q24 helps the county
 * determine benefits faster, and the filing rules require only identity and
 * address. That gives four tiers:
 *
 * 1. Filing / identity / core application — asked first, cannot be skipped.
 * 2. Eligibility-critical — Q6 household detail, Q7-Q9 income, Q15 expenses,
 *    Q24 resources. Important, but a useful draft is still possible without them.
 * 3. Supporting — improves the benefit calculation or completes a conditional
 *    section.
 * 4. Optional — the form says outright that some answers do not affect
 *    eligibility (Q38 other services), or they are preferences.
 */
export type QuestionTier = 1 | 2 | 3 | 4;

/**
 * Whether the user may move past a question without answering it.
 *
 * The names describe what skipping costs, not whether the question matters:
 *
 * - `required` — the flow will not continue without it.
 * - `important` — materially affects eligibility, benefit amount or processing
 *   speed, but a usable draft is still possible without it.
 * - `can_complete_later` — may be left blank in the draft, yet the county may
 *   still need it before the application is decided. Q29-Q36 sit here: they are
 *   skippable while building a draft, but they are not "optional" in the sense of
 *   not mattering.
 * - `optional` — the form itself treats it as non-impacting, e.g. Q38 states
 *   outright that the answers do not affect eligibility.
 */
export type QuestionRequirement =
  | 'required'
  | 'important'
  | 'can_complete_later'
  | 'optional';

/** How a tier maps to skippability. */
export function requirementForTier(tier: QuestionTier): QuestionRequirement {
  if (tier === 1) return 'required';
  if (tier === 2) return 'important';
  if (tier === 3) return 'can_complete_later';

  return 'optional';
}

/**
 * Catalog keys for the short label shown beside a question.
 *
 * Keys, not words: these are rendered to the applicant, and this module is
 * imported by a component, so English here reached the screen untranslated in
 * every locale.
 */
export const REQUIREMENT_LABEL_KEYS: Record<QuestionRequirement, string> = {
  required: 'req_label_required',
  important: 'req_label_important',
  can_complete_later: 'req_label_can_complete_later',
  optional: 'req_label_optional',
};

/** Catalog keys for the one-line explanation of what a requirement means. */
export const REQUIREMENT_HINT_KEYS: Record<QuestionRequirement, string> = {
  required: 'req_hint_required',
  important: 'req_hint_important',
  can_complete_later: 'req_hint_can_complete_later',
  optional: 'req_hint_optional',
};

/**
 * Which object a question's `path` is rooted in.
 *
 * Almost every answer lives in the questionnaire, but a few are properties of
 * the application itself — the applicant's own name and date of birth, and the
 * Q4 interview preferences. A question that addresses one of those and does not
 * say so is unanswerable: the write lands in the questionnaire, where nothing
 * reads it, so the planner keeps reporting it as outstanding no matter how many
 * times the applicant answers it.
 *
 * Declaring the store makes that impossible to get wrong silently, and
 * `answerQuestion` is the one place that has to know the difference.
 */
export type AnswerStore = 'questionnaire' | 'application';

export interface PlannedQuestion {
  /** Priority tier; lower is asked first. */
  tier: QuestionTier;
  /** Whether this question may be skipped. */
  requirement: QuestionRequirement;
  /**
   * The question number on the printed SAWS 2 PLUS form, when this question
   * corresponds to one (e.g. "Q8", "Q6q"). Absent for questions we ask that the
   * paper form collects elsewhere.
   */
  sawsQuestion?: string;
  /** Stable, PII-free identifier. */
  id: string;
  section: QuestionSection;
  kind: QuestionKind;
  /** Question text shown to the applicant, in English. Source text. */
  prompt: string;
  /**
   * Message key resolving `prompt` in the applicant's language.
   *
   * Stamped from the question id by `questionMessageKey`. The UI reads this,
   * never `prompt`, so a Spanish or Chinese applicant is never shown the
   * source text.
   */
  promptKey: string;
  /** Optional clarifying sentence, in English. Source text. */
  help?: string;
  /** Message key resolving `help`, present whenever `help` is. */
  helpKey?: string;
  /**
   * Dotted path to the answer, e.g. `income.earned.answer`. The UI uses it to
   * read and write the answer without a per-question switch statement.
   *
   * Rooted in `store` — the questionnaire unless stated otherwise.
   */
  path: string;
  /** Which object `path` is rooted in. */
  store: AnswerStore;
  /** For `records`: the minimum number of records required once Yes. */
  minimumRecords?: number;
  /** For `choice`: the allowed values. */
  options?: Array<{ value: string; label: string }>;
}

export interface PlannedSection {
  section: QuestionSection;
  title: string;
  questions: PlannedQuestion[];
}

export interface QuestionPlan {
  sections: PlannedSection[];
  /** Every outstanding question, flattened, in section order. */
  outstanding: PlannedQuestion[];
  /** Questions already answered, used for progress reporting. */
  answeredCount: number;
  totalCount: number;
}

/**
 * Coerce an unknown value into a record list.
 *
 * `applicationData` crosses two untyped boundaries — JSON from the client on the
 * draft endpoint, and dotted-path writes from the UI — so a section's `entries`
 * cannot be assumed to be an array at runtime. Anything that is not an array is
 * treated as *no records*: an object, a string, or a number is never
 * reinterpreted as record data, because guessing at the shape would fabricate
 * answers on a signed government form.
 */
export function safeEntries<TEntry>(value: unknown): TEntry[] {
  return Array.isArray(value) ? (value as TEntry[]) : [];
}

/**
 * Records that count: a gateway's records are active only when the gateway is
 * explicitly Yes.
 *
 * This is the documented behavior for a Yes → No change. Records are retained in
 * state (so the applicant does not lose typing if they flip back), but every
 * consumer — the planner, the field plan, and therefore the PDF — treats them as
 * absent while the gateway is not Yes.
 */
export function activeEntries<TEntry>(
  section: GatewaySection<TEntry> | undefined | null,
): TEntry[] {
  if (!section || section.answer !== true) return [];

  return safeEntries<TEntry>(section.entries);
}


/** A planned question before priority metadata is stamped on. */
export type UnstampedQuestion = Omit<
  PlannedQuestion,
  // Stamped by `withPriority`, so a definition never spells them out — and a
  // message key can never be written by hand into something the id disagrees
  // with.
  'tier' | 'requirement' | 'sawsQuestion' | 'store' | 'promptKey' | 'helpKey'
> & { store?: AnswerStore };

/**
 * Priority and SAWS 2 PLUS question number for every question we ask.
 *
 * This is the single place that ties a question we ask to the numbered question
 * on the printed form, so the mapping can be audited and tested rather than
 * inferred from PDF field order. A question absent from this table defaults to
 * tier 3 (supporting) and carries no form number.
 *
 * `saws` is the printed question number. It is omitted where the paper form has
 * no single corresponding question, and that omission is deliberate: it is
 * better to record "no confident mapping" than to invent one.
 */
/**
 * Priority and printed SAWS question number for every question we ask.
 *
 * Derived from the canonical schema rather than restated here. This table used
 * to be a second, independent record of what the form means, which is how three
 * different health questions ended up all labelled "Q22": the number was
 * corrected in one place and stayed wrong in the other.
 *
 * Manual-only concepts (SSN, signatures) are excluded by the schema itself, so
 * they can never become questions.
 */
export const QUESTION_META: Readonly<
  Record<string, { tier: QuestionTier; saws?: string }>
> = QUESTION_META_FROM_SCHEMA;

/** Tier for a question id, defaulting to supporting. */
export function tierFor(id: string): QuestionTier {
  return QUESTION_META[id]?.tier ?? 3;
}

/** Printed SAWS question number for a question id, when one is established. */
export function sawsQuestionFor(id: string): string | undefined {
  return QUESTION_META[id]?.saws;
}

/**
 * Stamp priority metadata onto a planned question.
 *
 * A question id that is a record/field variant (`income.earned.0.employerName`,
 * `income.earned.records`) inherits the tier of its owning gateway, so a detail
 * never outranks the question that unlocked it.
 */
/**
 * The message key holding a question's wording in the applicant's language.
 *
 * Derived from the question's stable id rather than stored beside it, so a
 * question cannot acquire a key that drifts from the id the rest of the system
 * branches on. `income.earned` becomes `q_income_earned_prompt`.
 *
 * The English wording stays in this file: it is the source text, the way
 * `en.ts` is the source for everything else, and duplicating it into a catalog
 * would create two places to edit a question. `es.ts` and `zh-CN.ts` carry the
 * translations, and `localization.test.ts` fails if a question is missing from
 * either — so the English here is a source, never a silent fallback.
 */
export function questionMessageKey(
  id: string,
  part: 'prompt' | 'help',
): string {
  return `q_${id.replace(/[.-]/g, '_')}_${part}`;
}

function withPriority(question: UnstampedQuestion): PlannedQuestion {
  const ownerId = Object.keys(QUESTION_META)
    .filter((id) => question.id === id || question.id.startsWith(`${id}.`))
    .sort((a, b) => b.length - a.length)[0];

  const tier = ownerId ? QUESTION_META[ownerId].tier : 3;

  return {
    // The questionnaire is where nearly every answer lives; a question that
    // addresses application state overrides this.
    store: 'questionnaire',
    ...question,
    tier,
    requirement: requirementForTier(tier),
    promptKey: questionMessageKey(question.id, 'prompt'),
    ...(question.help
      ? { helpKey: questionMessageKey(question.id, 'help') }
      : {}),
    ...(ownerId && QUESTION_META[ownerId].saws
      ? { sawsQuestion: QUESTION_META[ownerId].saws }
      : {}),
  };
}

/**
 * Whether a tri-state question has an answer.
 *
 * This is the single definition of "answered" for the whole application, and it
 * is deliberately a presence check rather than a truthiness check. `false` is a
 * real answer — the applicant said No — and a No must behave exactly like a Yes
 * as far as "have we asked this yet?" is concerned.
 *
 * Anything of the shape
 *
 *     if (!value) { ask the question again }
 *
 * collapses "answered No" into "never asked" and makes the flow re-ask a
 * question the applicant already dealt with. Use these helpers instead of
 * writing the comparison inline, so there is one place to be right.
 *
 * Skipping is not represented here at all: a skipped question was never
 * answered, so it stays `undefined` and nothing is written for it. The
 * navigator tracks "the user chose to move past this" separately, which is what
 * keeps Skip distinct from No.
 */
export function isAnswered(value: TriState): boolean {
  return value === true || value === false;
}

/** True when a tri-state answer still needs asking. */
export function isUnanswered(value: TriState): boolean {
  return !isAnswered(value);
}

/** Internal shorthand; the exported names are the contract. */
const unanswered = isUnanswered;

interface GatewaySpec {
  section: QuestionSection;
  id: string;
  path: string;
  prompt: string;
  help?: string;
}

/** Simple tri-state gateways that unlock no detail records. */
const SIMPLE_GATEWAYS: GatewaySpec[] = [
  {
    section: 'circumstances',
    id: 'circumstances.prior_public_assistance',
    path: 'circumstances.priorPublicAssistance',
    prompt: 'Has anyone in your household received CalFresh, CalWORKs, or Medi-Cal before?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.california_resident',
    path: 'circumstances.californiaResident',
    prompt: 'Does everyone applying live in California and plan to stay?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.planned_absence',
    path: 'circumstances.plannedAbsence',
    prompt: 'Is anyone planning to be away from California for more than a month?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.food_together',
    path: 'circumstances.buysAndPreparesFoodTogether',
    prompt: 'Does everyone in your household buy and prepare food together?',
    help: 'CalFresh counts people who share food purchases and cooking as one household.',
  },
  {
    section: 'circumstances',
    id: 'circumstances.institutional_living',
    path: 'circumstances.institutionalLiving',
    prompt: 'Is anyone living in a shelter, group home, or institution?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.same_contact_information',
    path: 'circumstances.everyoneHasSameContactInformation',
    prompt: 'Does everyone in your household have the same contact information?',
    help:
      'If someone has a different phone, address, or email, the form has space for theirs.',
  },
  {
    section: 'circumstances',
    id: 'circumstances.health_coverage_representative',
    path: 'circumstances.healthCoverageRepresentative',
    prompt:
      'Do you want someone to act for you on the health-coverage part of this application?',
    help:
      'This is separate from a CalFresh representative — the form asks about them independently.',
  },
  {
    section: 'circumstances',
    id: 'circumstances.disability_limits_activities',
    path: 'circumstances.disabilityLimitsActivities',
    prompt:
      'Does anyone have a disability that limits daily activities such as bathing, dressing, or chores?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.needs_care_from_member',
    path: 'circumstances.needsCareFromHouseholdMember',
    prompt:
      'Is there a child or disabled person who needs care from another household member?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.pregnant_or_teen_parent',
    path: 'circumstances.pregnantOrTeenParent',
    prompt: 'Is anyone in the household pregnant or a teen parent?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.cal_learn',
    path: 'circumstances.calLearnHistory',
    prompt:
      'Has anyone received a cash bonus, penalty, or help with child care or transport from Cal-Learn?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.ever_in_foster_care',
    path: 'circumstances.everInFosterCare',
    prompt: 'Was anyone in the household ever in foster care?',
    help: 'This is about the past — a foster child living with you now is a separate question.',
  },
  {
    section: 'circumstances',
    id: 'circumstances.ihss',
    path: 'circumstances.receivesIhss',
    prompt: 'Is anyone getting In-Home Supportive Services (IHSS)?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.other_food_program',
    path: 'circumstances.otherFoodProgram',
    prompt: 'Is anyone taking part in another food program?',
  },
  {
    section: 'circumstances',
    id: 'circumstances.caretaker_relative',
    path: 'circumstances.caretakerRelative',
    prompt: 'Are you applying for a child who is not your own son or daughter?',
  },
  {
    section: 'income',
    id: 'income.varies_during_year',
    path: 'income.incomeVariesDuringYear',
    prompt: 'Does anyone’s income change during the year?',
    help: 'For example seasonal work, contract work, or school-year employment.',
  },
  {
    section: 'health',
    id: 'health.retroactive_medical',
    path: 'health.retroactiveMedicalHelp',
    prompt: 'Do you need help paying medical bills from the last three months?',
  },
  {
    section: 'health',
    id: 'health.tax_filer',
    path: 'health.taxFiler',
    prompt: 'Do you plan to file a federal income tax return this year?',
  },
  {
    section: 'health',
    id: 'health.renewal_authorization',
    path: 'health.renewalAuthorization',
    prompt: 'May the county use your tax information to renew your health coverage automatically?',
  },
  {
    section: 'health',
    id: 'health.american_indian',
    path: 'health.americanIndianOrAlaskaNative',
    prompt: 'Is anyone applying American Indian or Alaska Native?',
  },
  {
    section: 'resources',
    id: 'resources.diversion_payment',
    path: 'resources.receivedDiversionPayment',
    prompt: 'Has your household ever received a CalWORKs diversion payment?',
  },
  {
    section: 'integrity',
    id: 'integrity.duplicate_benefits',
    path: 'programIntegrity.duplicateBenefits',
    prompt: 'Is anyone getting the same benefits in more than one place?',
  },
  {
    section: 'integrity',
    id: 'integrity.trafficking',
    path: 'programIntegrity.traffickingBenefits',
    prompt: 'Has anyone bought, sold, or traded CalFresh benefits?',
  },
  {
    section: 'integrity',
    id: 'integrity.drugs',
    path: 'programIntegrity.tradingBenefitsForDrugs',
    prompt: 'Has anyone traded CalFresh benefits for drugs?',
  },
  {
    section: 'integrity',
    id: 'integrity.firearms',
    path: 'programIntegrity.tradingBenefitsForFirearms',
    prompt: 'Has anyone traded CalFresh benefits for firearms, ammunition, or explosives?',
  },
  {
    section: 'integrity',
    id: 'integrity.welfare_fraud',
    path: 'programIntegrity.welfareFraudConviction',
    prompt: 'Has anyone been convicted of welfare fraud?',
  },
  {
    section: 'integrity',
    id: 'integrity.sanction',
    path: 'programIntegrity.currentSanctionOrNonCooperation',
    prompt: 'Is anyone currently under a penalty for not cooperating with a benefits program?',
  },
  {
    section: 'integrity',
    id: 'integrity.special_needs_payment',
    path: 'otherServices.specialNeedsPayment',
    prompt:
      'Do you want to apply for a special-need payment for housing or household items lost or damaged?',
    help: 'For example items lost to a fire, earthquake, or flood.',
  },
  {
    section: 'integrity',
    id: 'integrity.third_party_liability',
    path: 'otherServices.thirdPartyLiability',
    prompt:
      'Is anyone applying for health care involved in a workers’ compensation claim, lawsuit, or accident settlement?',
  },
  {
    section: 'integrity',
    id: 'services.chdp_information',
    path: 'otherServices.chdpMoreInformation',
    prompt: 'Do you want more information about CHDP check-ups for children under 21?',
    help: 'Answers to these service questions never affect eligibility.',
  },
  {
    section: 'integrity',
    id: 'services.chdp_medical',
    path: 'otherServices.chdpMedicalServices',
    prompt: 'Do you want CHDP medical services?',
  },
  {
    section: 'integrity',
    id: 'services.chdp_dental',
    path: 'otherServices.chdpDentalServices',
    prompt: 'Do you want CHDP dental services?',
  },
  {
    section: 'integrity',
    id: 'services.chdp_transport',
    path: 'otherServices.chdpAppointmentOrTransportHelp',
    prompt: 'Do you need help making appointments or getting to CHDP services?',
  },
  {
    section: 'integrity',
    id: 'services.immunization',
    path: 'otherServices.immunizationInformation',
    prompt: 'Do you want more information about immunization services?',
  },
  {
    section: 'integrity',
    id: 'services.family_planning',
    path: 'otherServices.familyPlanningServices',
    prompt: 'Does anyone want free or low-cost family-planning services?',
  },
  {
    section: 'integrity',
    id: 'services.breastfeeding',
    path: 'otherServices.breastfeeding',
    prompt: 'Are you breastfeeding a child?',
  },
];

interface RecordGatewaySpec extends GatewaySpec {
  /** Path to the gateway section itself, e.g. `income.earned`. */
  sectionPath: string;
  recordPrompt: string;
  /** Fields every record must have before the section counts as complete. */
  requiredFields: Array<{ key: string; label: string }>;
}

/** Gateways that unlock repeatable records. */
const RECORD_GATEWAYS: RecordGatewaySpec[] = [
  {
    section: 'circumstances',
    id: 'circumstances.authorized_representative',
    sectionPath: 'circumstances.authorizedRepresentative',
    path: 'circumstances.authorizedRepresentative.answer',
    prompt: 'Do you want someone else to be able to act for your household?',
    help: 'An authorized representative can speak for you at the interview and help with forms.',
    recordPrompt: 'Who is your authorized representative?',
    requiredFields: [{ key: 'name', label: 'Representative’s name' }],
  },
  {
    section: 'circumstances',
    id: 'circumstances.military_service',
    sectionPath: 'circumstances.militaryService',
    path: 'circumstances.militaryService.answer',
    prompt:
      'Has anyone been in the U.S. military, or are they the spouse, parent, or child of someone who was?',
    recordPrompt: 'Who has the military connection?',
    requiredFields: [{ key: 'memberId', label: 'Household member' }],
  },
  {
    section: 'circumstances',
    id: 'circumstances.students',
    sectionPath: 'circumstances.students',
    path: 'circumstances.students.answer',
    prompt: 'Is anyone applying attending a college or vocational school?',
    recordPrompt: 'Who is attending school?',
    requiredFields: [{ key: 'memberId', label: 'Household member' }],
  },
  {
    section: 'circumstances',
    id: 'circumstances.absent_parents',
    sectionPath: 'circumstances.absentParents',
    path: 'circumstances.absentParents.answer',
    prompt: 'Does any child in the household have a parent living outside the home?',
    recordPrompt: 'Which child, and who is the absent parent?',
    requiredFields: [{ key: 'memberId', label: 'Child' }],
  },
  {
    section: 'circumstances',
    id: 'circumstances.foster_care',
    sectionPath: 'circumstances.fosterCare',
    path: 'circumstances.fosterCare.answer',
    prompt: 'Is a foster child living in your home and receiving foster-care services?',
    recordPrompt: 'Which child is in foster care?',
    requiredFields: [{ key: 'memberId', label: 'Child' }],
  },
  {
    section: 'income',
    id: 'income.earned',
    sectionPath: 'income.earned',
    path: 'income.earned.answer',
    prompt: 'Does anyone get income from a job?',
    help: 'Include part-time and temporary work. Self-employment is asked separately.',
    recordPrompt: 'Tell us about each job',
    requiredFields: [
      { key: 'memberId', label: 'Who has this job' },
      { key: 'employerName', label: 'Employer name' },
    ],
  },
  {
    section: 'income',
    id: 'income.self_employment',
    sectionPath: 'income.selfEmployment',
    path: 'income.selfEmployment.answer',
    prompt: 'Is anyone self-employed?',
    recordPrompt: 'Tell us about the business',
    requiredFields: [
      { key: 'memberId', label: 'Who is self-employed' },
      { key: 'businessType', label: 'Type of business' },
    ],
  },
  {
    section: 'income',
    id: 'income.unearned',
    sectionPath: 'income.unearned',
    path: 'income.unearned.answer',
    prompt: 'Does anyone receive income that does not come from work?',
    help:
      'For example unemployment, disability, Social Security, SSI, child support, or retirement.',
    recordPrompt: 'Tell us about each source',
    requiredFields: [
      { key: 'memberId', label: 'Who receives it' },
      { key: 'source', label: 'Where it comes from' },
    ],
  },
  {
    section: 'income',
    id: 'income.in_kind',
    sectionPath: 'income.inKindSupport',
    path: 'income.inKindSupport.answer',
    prompt:
      'Does anyone get housing, utilities, food, or clothing free or in exchange for work?',
    recordPrompt: 'Tell us what is provided',
    requiredFields: [{ key: 'providedBy', label: 'Who provides it' }],
  },
  {
    section: 'income',
    id: 'income.recent_job_change',
    sectionPath: 'income.recentJobChange',
    path: 'income.recentJobChange.answer',
    prompt: 'Has anyone lost a job or had their hours change recently?',
    recordPrompt: 'Tell us what changed',
    requiredFields: [{ key: 'memberId', label: 'Who' }],
  },
  {
    section: 'expenses',
    id: 'expenses.household',
    sectionPath: 'expenses.household',
    path: 'expenses.household.answer',
    prompt: 'Does your household pay rent, a mortgage, or utilities?',
    help: 'Housing and utility costs can increase your CalFresh benefit.',
    recordPrompt: 'Add each housing or utility cost',
    requiredFields: [{ key: 'kind', label: 'Type of cost' }],
  },
  {
    section: 'expenses',
    id: 'expenses.dependent_care',
    sectionPath: 'expenses.dependentCare',
    path: 'expenses.dependentCare.answer',
    prompt: 'Does anyone pay for child care or care for a dependent adult?',
    recordPrompt: 'Tell us about the care you pay for',
    requiredFields: [{ key: 'memberId', label: 'Who needs the care' }],
  },
  {
    section: 'expenses',
    id: 'expenses.child_support_paid',
    sectionPath: 'expenses.childSupportPaid',
    path: 'expenses.childSupportPaid.answer',
    prompt: 'Does anyone pay child support?',
    recordPrompt: 'Tell us about the child support paid',
    requiredFields: [{ key: 'memberId', label: 'Who pays it' }],
  },
  {
    section: 'expenses',
    id: 'expenses.spousal_support_paid',
    sectionPath: 'expenses.spousalSupportPaid',
    path: 'expenses.spousalSupportPaid.answer',
    prompt: 'Is anyone legally required to pay spousal support or alimony?',
    recordPrompt: 'Tell us about the spousal support paid',
    requiredFields: [{ key: 'memberId', label: 'Who pays it' }],
  },
  {
    section: 'expenses',
    id: 'expenses.other_tax_deductible',
    sectionPath: 'expenses.otherTaxDeductible',
    path: 'expenses.otherTaxDeductible.answer',
    prompt: 'Does anyone have other expenses they deduct on their taxes?',
    recordPrompt: 'Add each deductible expense',
    requiredFields: [{ key: 'description', label: 'Expense' }],
  },
  {
    section: 'health',
    id: 'health.current_coverage',
    sectionPath: 'health.currentCoverage',
    path: 'health.currentCoverage.answer',
    prompt: 'Does anyone currently have health insurance?',
    recordPrompt: 'Tell us about each plan',
    requiredFields: [
      { key: 'memberId', label: 'Who is covered' },
      { key: 'planName', label: 'Plan name' },
    ],
  },
  {
    section: 'health',
    id: 'health.coverage_ending',
    sectionPath: 'health.coverageEnding',
    path: 'health.coverageEnding.answer',
    prompt: 'Is anyone’s health coverage ending soon?',
    recordPrompt: 'Tell us which coverage is ending',
    requiredFields: [{ key: 'memberId', label: 'Who is covered' }],
  },
  {
    section: 'health',
    id: 'health.employer_coverage',
    sectionPath: 'health.employerCoverage',
    path: 'health.employerCoverage.answer',
    prompt: 'Does anyone have a job that offers health coverage?',
    help: 'This adds Appendix A to your application.',
    recordPrompt: 'Tell us about the employer’s coverage',
    requiredFields: [
      { key: 'memberId', label: 'Who' },
      { key: 'employerName', label: 'Employer name' },
    ],
  },
  {
    section: 'resources',
    id: 'resources.accounts',
    sectionPath: 'resources.accounts',
    path: 'resources.accounts.answer',
    prompt: 'Does anyone have cash, a bank account, or other savings?',
    recordPrompt: 'Add each account or resource',
    requiredFields: [{ key: 'kind', label: 'Type' }],
  },
  {
    section: 'resources',
    id: 'resources.vehicles',
    sectionPath: 'resources.vehicles',
    path: 'resources.vehicles.answer',
    prompt: 'Does anyone own or use a vehicle?',
    recordPrompt: 'Add each vehicle',
    requiredFields: [{ key: 'make', label: 'Make' }],
  },
  {
    section: 'resources',
    id: 'resources.real_property',
    sectionPath: 'resources.realProperty',
    path: 'resources.realProperty.answer',
    prompt: 'Does anyone own a home, land, or other property?',
    recordPrompt: 'Add each property',
    requiredFields: [{ key: 'kind', label: 'Type' }],
  },
  {
    section: 'resources',
    id: 'resources.transferred',
    sectionPath: 'resources.transferredResources',
    path: 'resources.transferredResources.answer',
    prompt:
      'Has anyone sold, traded, or given away property in the last 30 months?',
    recordPrompt: 'Tell us what was transferred',
    requiredFields: [{ key: 'description', label: 'What it was' }],
  },
];

/**
 * Whether a repeatable section's records belong to a specific household person.
 *
 * `person` sections are created by picking the household member first, so the
 * record is born with a real `memberId` and the UI never invents a person.
 * `household` sections describe the household as a whole — rent, utilities, an
 * authorized representative who is not a household member — and must not ask
 * "who is this for?".
 *
 * `onePerPerson` marks a fact a person can only have once (their student status,
 * their military connection, a child's foster-care placement). Everything else
 * may legitimately repeat: two jobs, two bank accounts, two prescriptions.
 */
export interface RecordScope {
  scope: 'person' | 'household';
  onePerPerson?: boolean;
}

export const RECORD_SCOPES: Readonly<Record<string, RecordScope>> = {
  // Household-level: no member selection.
  'circumstances.authorizedRepresentative.entries': { scope: 'household' },
  'expenses.household.entries': { scope: 'household' },
  'expenses.otherTaxDeductible.entries': { scope: 'household' },

  // Person-scoped, one record per person.
  'circumstances.militaryService.entries': { scope: 'person', onePerPerson: true },
  'circumstances.students.entries': { scope: 'person', onePerPerson: true },
  'circumstances.fosterCare.entries': { scope: 'person', onePerPerson: true },

  // Person-scoped, repeatable per person.
  'circumstances.absentParents.entries': { scope: 'person' },
  'income.earned.entries': { scope: 'person' },
  'income.selfEmployment.entries': { scope: 'person' },
  'income.unearned.entries': { scope: 'person' },
  'income.inKindSupport.entries': { scope: 'person' },
  'income.recentJobChange.entries': { scope: 'person' },
  'expenses.dependentCare.entries': { scope: 'person' },
  'expenses.childSupportPaid.entries': { scope: 'person' },
  'expenses.spousalSupportPaid.entries': { scope: 'person' },
  'expenses.medical.entries': { scope: 'person' },
  'health.currentCoverage.entries': { scope: 'person' },
  'health.coverageEnding.entries': { scope: 'person' },
  'health.employerCoverage.entries': { scope: 'person' },
  'resources.accounts.entries': { scope: 'person' },
  'resources.vehicles.entries': { scope: 'person' },
  'resources.realProperty.entries': { scope: 'person' },
  'resources.transferredResources.entries': { scope: 'person' },
  'appendices.employmentHistory.entries': { scope: 'person' },
};

/** True when records in this section belong to a household person. */
export function isPersonScoped(entriesPath: string): boolean {
  return RECORD_SCOPES[entriesPath]?.scope === 'person';
}

/** True when a person may appear in this section more than once. */
export function allowsMultiplePerPerson(entriesPath: string): boolean {
  const scope = RECORD_SCOPES[entriesPath];

  return scope?.scope === 'person' && scope.onePerPerson !== true;
}

/**
 * Members who may still be added to a one-per-person section.
 *
 * Returns every member for a repeatable section, and only the unused ones when
 * the section allows a single record per person.
 */
export function selectableMembers(
  application: Saws2PlusApplicationData,
  entriesPath: string,
): Array<{ id: string; label: string }> {
  const members = memberOptions(application);

  if (allowsMultiplePerPerson(entriesPath) || !isPersonScoped(entriesPath)) {
    return members;
  }

  const used = new Set(
    safeEntries<{ memberId?: string }>(
      readPath(application.questionnaire, entriesPath),
    ).map((entry) => entry?.memberId),
  );

  return members.filter((member) => !used.has(member.id));
}

/** Read a dotted path out of the questionnaire. */
export function readPath(
  questionnaire: Saws2PlusQuestionnaire,
  path: string,
): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      questionnaire,
    );
}

/**
 * Immutably write a dotted path into the questionnaire.
 *
 * Arrays are cloned as arrays. Writing through an array index — which the
 * planner does whenever it surfaces a missing field inside a record, e.g.
 * `income.earned.entries.0.employerName` — must not turn the list into a plain
 * object keyed by "0". That is what previously broke every later read of
 * `entries`.
 */
export function writePath(
  questionnaire: Saws2PlusQuestionnaire,
  path: string,
  value: unknown,
): Saws2PlusQuestionnaire {
  const keys = path.split('.');

  function assign(target: unknown, index: number): unknown {
    if (index === keys.length) return value;

    const key = keys[index];

    if (Array.isArray(target)) {
      const position = Number(key);

      // A non-numeric key against an array would corrupt the list; leave it be.
      if (!Number.isInteger(position) || position < 0) return target;

      const next = [...target];
      next[position] = assign(target[position], index + 1);

      return next;
    }

    const source = (target ?? {}) as Record<string, unknown>;

    return { ...source, [key]: assign(source[key], index + 1) };
  }

  return assign(questionnaire, 0) as Saws2PlusQuestionnaire;
}

/**
 * Write an answer where its question says it lives.
 *
 * The one place that has to know the difference between the two answer stores.
 * Everything that commits an answer goes through here, so a question can never
 * again be written somewhere the planner does not read — which is a silent
 * failure: the value lands, the UI advances, and the question stays outstanding
 * forever because nothing is looking where it went.
 *
 * Pure: returns new application data and mutates nothing.
 */
export function answerQuestion(
  data: Saws2PlusApplicationData,
  question: Pick<PlannedQuestion, 'path' | 'store'>,
  value: unknown,
): Saws2PlusApplicationData {
  if (question.store === 'application') {
    return writeApplicationPath(data, question.path, value);
  }

  return {
    ...data,
    questionnaire: writePath(data.questionnaire, question.path, value),
  };
}

/**
 * Immutably write a dotted path into the application itself.
 *
 * `applicant.name` is the one composite: the printed form asks for a single
 * name and the model keeps first and last apart, so it is split here rather
 * than leaving a path no writer understands.
 */
function writeApplicationPath(
  data: Saws2PlusApplicationData,
  path: string,
  value: unknown,
): Saws2PlusApplicationData {
  if (path === 'applicant.name') {
    const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) return data;

    return {
      ...data,
      applicant: {
        ...data.applicant,
        firstName: parts[0],
        lastName: parts.slice(1).join(' ') || data.applicant.lastName,
      },
    };
  }

  const [root, ...rest] = path.split('.');

  if (root !== 'applicant' && root !== 'preferences') return data;

  const branch = data[root] as unknown;

  return {
    ...data,
    [root]: writeInto(branch, rest, value),
  } as Saws2PlusApplicationData;
}

/** Immutable dotted write into a plain object branch. */
function writeInto(target: unknown, keys: string[], value: unknown): unknown {
  if (keys.length === 0) return value;

  const source = (target ?? {}) as Record<string, unknown>;

  return {
    ...source,
    [keys[0]]: writeInto(source[keys[0]], keys.slice(1), value),
  };
}

/** Record with an index signature, for required-field checks. */
type UnknownRecord = Record<string, unknown>;

function missingRequiredFields(
  spec: RecordGatewaySpec,
  entriesValue: unknown,
): UnstampedQuestion[] {
  const questions: UnstampedQuestion[] = [];

  // Never assume the caller handed us a list.
  safeEntries<unknown>(entriesValue).forEach((entry, index) => {
    for (const field of spec.requiredFields) {
      const record = (entry ?? {}) as UnknownRecord;
      const value = record[field.key];
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '');

      if (isEmpty) {
        questions.push({
          // Index only — never any record content.
          id: `${spec.id}.${index}.${field.key}`,
          section: spec.section,
          kind: 'field',
          prompt: `${field.label} is needed for entry ${index + 1}.`,
          path: `${spec.sectionPath}.entries.${index}.${field.key}`,
        });
      }
    }
  });

  return questions;
}

/**
 * Derive every applicable, still-unanswered question.
 *
 * Both arguments are read-only; the planner never mutates state.
 */
export function getRequiredApplicationQuestions(
  application: Saws2PlusApplicationData,
): QuestionPlan {
  const questionnaire = application.questionnaire;
  const bySection = new Map<QuestionSection, PlannedQuestion[]>(
    QUESTION_SECTIONS.map((section) => [section, []]),
  );

  let answeredCount = 0;
  let totalCount = 0;

  const push = (question: UnstampedQuestion) => {
    bySection.get(question.section)!.push(withPriority(question));
  };

  // ── Applicant & household ────────────────────────────────────────────────
  totalCount += 1;
  if (!application.applicant.firstName.trim() || !application.applicant.lastName.trim()) {
    push({
      id: 'household.applicant_name',
      section: 'household',
      kind: 'field',
      prompt: 'We need the applicant’s first and last name.',
      path: 'applicant.name',
      store: 'application',
    });
  } else {
    answeredCount += 1;
  }

  totalCount += 1;
  if (!application.applicant.dateOfBirth) {
    push({
      id: 'household.applicant_dob',
      section: 'household',
      kind: 'field',
      prompt: 'We need the applicant’s date of birth.',
      path: 'applicant.dateOfBirth',
      store: 'application',
    });
  } else {
    answeredCount += 1;
  }

  // A household member with neither an age nor a date of birth needs one.
  application.householdMembers.forEach((member, index) => {
    totalCount += 1;

    if (member.age === undefined && !member.dateOfBirth.trim()) {
      push({
        id: `household.member.${index}.age`,
        section: 'household',
        kind: 'field',
        prompt: `We need a date of birth for household member ${index + 1}.`,
        path: `householdMembers.${index}.dateOfBirth`,
      });
    } else {
      answeredCount += 1;
    }
  });

  // ── Simple tri-state gateways ────────────────────────────────────────────
  for (const spec of SIMPLE_GATEWAYS) {
    totalCount += 1;
    const value = readPath(questionnaire, spec.path) as TriState;

    if (unanswered(value)) {
      push({
        id: spec.id,
        section: spec.section,
        kind: 'gateway',
        prompt: spec.prompt,
        help: spec.help,
        path: spec.path,
      });
    } else {
      answeredCount += 1;
    }
  }

  // Follow-up: only ask about a recent birth when breastfeeding is Yes.
  if (questionnaire.otherServices.breastfeeding === true) {
    totalCount += 1;

    if (unanswered(questionnaire.otherServices.gaveBirthInLastTwelveMonths)) {
      push({
        id: 'services.gave_birth_recently',
        section: 'integrity',
        kind: 'gateway',
        prompt: 'Have you given birth within the last 12 months?',
        help: 'This may qualify your household for WIC.',
        path: 'otherServices.gaveBirthInLastTwelveMonths',
      });
    } else {
      answeredCount += 1;
    }
  }

  // Follow-up: pregnancy help is only relevant when someone is pregnant.
  if (application.pregnancy.anyonePregnant === true) {
    totalCount += 1;

    if (unanswered(questionnaire.otherServices.pregnancyAssistance)) {
      push({
        id: 'services.pregnancy_assistance',
        section: 'integrity',
        kind: 'gateway',
        prompt:
          'Do you want to talk to someone about finding a doctor and healthy foods during pregnancy?',
        path: 'otherServices.pregnancyAssistance',
      });
    } else {
      answeredCount += 1;
    }
  }

  /*
   * Q21a follows Q21. The printed question asks whether someone 60+ cannot buy
   * food and cook separately because of a disability — a CalFresh
   * separate-household rule that only arises when the household does NOT all
   * buy and prepare food together. Asking it of a household that already eats
   * together would be asking about a situation they have just ruled out.
   */
  if (questionnaire.circumstances.buysAndPreparesFoodTogether === false) {
    totalCount += 1;

    if (unanswered(questionnaire.circumstances.elderlyUnableToPrepareMealsSeparately)) {
      push({
        id: 'circumstances.elderly_separate_meals',
        section: 'circumstances',
        kind: 'gateway',
        prompt:
          'Is anyone living with you 60 or older and unable to buy food and fix meals separately because of a disability?',
        path: 'circumstances.elderlyUnableToPrepareMealsSeparately',
      });
    } else {
      answeredCount += 1;

      if (
        questionnaire.circumstances.elderlyUnableToPrepareMealsSeparately === true &&
        !(questionnaire.circumstances.elderlyUnableToPrepareMealsWho ?? '').trim()
      ) {
        totalCount += 1;
        push({
          id: 'circumstances.elderly_separate_meals_who',
          section: 'circumstances',
          kind: 'field',
          prompt: 'Who is that?',
          path: 'circumstances.elderlyUnableToPrepareMealsWho',
        });
      }
    }
  }

  /*
   * The tax-household block. Everything here hangs off Q23: a household that
   * does not plan to file has no filer, no joint spouse and no dependents to
   * describe, and the printed form says outright "if no, skip to 23f".
   */
  if (questionnaire.health.taxFiler === true) {
    // Q23b — who is filing.
    totalCount += 1;

    if (
      !questionnaire.health.taxFilerMemberId &&
      !(questionnaire.health.taxFilerName ?? '').trim()
    ) {
      push({
        id: 'health.tax_filer_person',
        section: 'health',
        kind: 'choice',
        prompt: 'Who plans to file a federal income tax return?',
        path: 'health.taxFilerMemberId',
        options: memberOptions(application).map((member) => ({
          value: member.id,
          label: member.label,
        })),
      });
    } else {
      answeredCount += 1;
    }

    // Q23c — joint filing, and the spouse's name once the answer is Yes.
    totalCount += 1;

    if (unanswered(questionnaire.health.spouseFilingJointly)) {
      push({
        id: 'health.spouse_filing_jointly',
        section: 'health',
        kind: 'gateway',
        prompt: 'Will your spouse file jointly with you?',
        path: 'health.spouseFilingJointly',
      });
    } else {
      answeredCount += 1;

      if (
        questionnaire.health.spouseFilingJointly === true &&
        !(questionnaire.health.spouseName ?? '').trim()
      ) {
        totalCount += 1;
        push({
          id: 'health.spouse_name',
          section: 'health',
          kind: 'field',
          prompt: 'What is your spouse’s name?',
          path: 'health.spouseName',
        });
      }
    }

    // Q23d — dependents, and Q23e's relationship for each one.
    totalCount += 1;

    if (unanswered(questionnaire.health.taxDependents?.answer)) {
      push({
        id: 'health.tax_dependents',
        section: 'health',
        kind: 'gateway',
        prompt: 'Will this person claim any dependents on their tax return?',
        help:
          'A tax dependent does not have to live with you — you can claim someone who lives elsewhere.',
        path: 'health.taxDependents.answer',
      });
    } else {
      answeredCount += 1;

      if (questionnaire.health.taxDependents?.answer === true) {
        const dependents = safeEntries<{
          name?: string;
          memberId?: string;
          relationshipToFiler?: string;
        }>(questionnaire.health.taxDependents?.entries);

        if (dependents.length === 0) {
          totalCount += 1;
          push({
            id: 'health.tax_dependents.records',
            section: 'health',
            kind: 'records',
            prompt: 'Who will be claimed as a dependent?',
            path: 'health.taxDependents.entries',
            minimumRecords: 1,
          });
        }

        dependents.forEach((dependent, index) => {
          // Q23e is asked per dependent: the county wants the relationship of
          // each claimed person, and a tax relationship is not the household
          // relationship already recorded in Q6.
          if (!dependent?.relationshipToFiler?.trim()) {
            totalCount += 1;
            push({
              id: `health.tax_dependents.${index}.relationshipToFiler`,
              section: 'health',
              kind: 'field',
              prompt: `How is dependent ${index + 1} related to the tax filer?`,
              path: `health.taxDependents.entries.${index}.relationshipToFiler`,
            });
          }
        });
      }
    }
  }

  // ── Explanations required by an affirmative legal answer ─────────────────
  const EXPLANATIONS: Array<{
    when: TriState;
    id: string;
    prompt: string;
    path: string;
    value: string;
  }> = [
    {
      when: questionnaire.programIntegrity.fleeingFelon,
      id: 'integrity.fleeing_felon_who',
      prompt: 'Who in the household is affected?',
      path: 'programIntegrity.fleeingFelonWho',
      value: questionnaire.programIntegrity.fleeingFelonWho,
    },
    {
      when: questionnaire.programIntegrity.probationOrParoleViolation,
      id: 'integrity.probation_who',
      prompt: 'Who in the household is affected?',
      path: 'programIntegrity.probationOrParoleWho',
      value: questionnaire.programIntegrity.probationOrParoleWho,
    },
    {
      when: questionnaire.otherServices.specialNeedsPayment,
      id: 'integrity.special_needs_explanation',
      prompt: 'Please explain what was lost or damaged.',
      path: 'otherServices.specialNeedsExplanation',
      value: questionnaire.otherServices.specialNeedsExplanation,
    },
    {
      when: questionnaire.otherServices.thirdPartyLiability,
      id: 'integrity.third_party_who',
      prompt: 'Who is involved in the claim or settlement?',
      path: 'otherServices.thirdPartyLiabilityWho',
      value: questionnaire.otherServices.thirdPartyLiabilityWho,
    },
  ];

  for (const explanation of EXPLANATIONS) {
    if (explanation.when !== true) continue;

    totalCount += 1;

    if (!explanation.value.trim()) {
      push({
        id: explanation.id,
        section: 'integrity',
        kind: 'field',
        prompt: explanation.prompt,
        path: explanation.path,
      });
    } else {
      answeredCount += 1;
    }
  }

  // The fleeing-felon and probation gateways live with the other legal
  // questions but carry their own explanation, so they are declared here.
  for (const spec of [
    {
      id: 'integrity.fleeing_felon',
      path: 'programIntegrity.fleeingFelon',
      prompt:
        'Is anyone in the household hiding or running from the law for a felony charge?',
    },
    {
      id: 'integrity.probation_violation',
      path: 'programIntegrity.probationOrParoleViolation',
      prompt:
        'Has a court found anyone in the household to be violating probation or parole?',
    },
  ]) {
    totalCount += 1;
    const value = readPath(questionnaire, spec.path) as TriState;

    if (unanswered(value)) {
      push({
        id: spec.id,
        section: 'integrity',
        kind: 'gateway',
        prompt: spec.prompt,
        path: spec.path,
      });
    } else {
      answeredCount += 1;
    }
  }

  /*
   * Q4 interview preference and Q14 special-needs expenses.
   *
   * Both are sets of independent printed checkboxes rather than gateways, so
   * each is asked on its own and a No to one says nothing about the others.
   * Reads tolerate a missing field: a stored session predating these questions
   * has no value there, and that must mean "still to ask", not a crash.
   */
  for (const spec of [
    {
      id: 'preferences.in_person_interview',
      path: 'preferences.prefersInPersonInterview',
      prompt: 'Would you prefer an in-person interview for CalFresh?',
      value: application.preferences?.prefersInPersonInterview,
    },
    {
      id: 'preferences.interview_disability_arrangements',
      path: 'preferences.needsDisabilityInterviewArrangements',
      prompt: 'Do you need other arrangements for the interview because of a disability?',
      value: application.preferences?.needsDisabilityInterviewArrangements,
    },
  ]) {
    totalCount += 1;

    if (unanswered(spec.value)) {
      push({
        id: spec.id,
        section: 'household',
        kind: 'gateway',
        prompt: spec.prompt,
        path: spec.path,
        store: 'application',
      });
    } else {
      answeredCount += 1;
    }
  }

  const specialNeeds = questionnaire.expenses.specialNeedsExpenses;

  for (const spec of [
    { key: 'specialDiet', prompt: 'Does anyone need a special diet prescribed by a doctor?' },
    { key: 'specialPhoneOrEquipment', prompt: 'Does anyone need a special phone or other equipment?' },
    { key: 'housework', prompt: 'Does anyone need help with housework because no one at home can do it?' },
    { key: 'highUtilityUse', prompt: 'Does a medical condition cause very high use of utilities?' },
    { key: 'specialLaundry', prompt: 'Does anyone need a special laundry service?' },
    { key: 'otherSpecialNeed', prompt: 'Is there any other special need caused by a medical condition?' },
  ] as const) {
    totalCount += 1;
    const value = specialNeeds?.[spec.key];

    if (unanswered(value)) {
      push({
        id: `expenses.special_needs.${spec.key}`,
        section: 'expenses',
        kind: 'gateway',
        prompt: spec.prompt,
        path: `expenses.specialNeedsExpenses.${spec.key}`,
      });
    } else {
      answeredCount += 1;
    }
  }

  /*
   * The form gives one free-text line for "the name of the person with the
   * special need and explain", so it is asked once any special need is Yes
   * rather than per sub-question.
   */
  const anySpecialNeed = [
    specialNeeds?.specialDiet,
    specialNeeds?.specialPhoneOrEquipment,
    specialNeeds?.housework,
    specialNeeds?.highUtilityUse,
    specialNeeds?.specialLaundry,
    specialNeeds?.otherSpecialNeed,
  ].some((value) => value === true);

  if (anySpecialNeed) {
    totalCount += 1;

    if (!(specialNeeds?.personAndExplanation ?? '').trim()) {
      push({
        id: 'expenses.special_needs.person',
        section: 'expenses',
        kind: 'field',
        prompt: 'Who has the special need, and what is it?',
        path: 'expenses.specialNeedsExpenses.personAndExplanation',
      });
    } else {
      answeredCount += 1;
    }
  }

  if (specialNeeds?.otherSpecialNeed === true) {
    totalCount += 1;

    if (!(specialNeeds?.otherSpecialNeedDescription ?? '').trim()) {
      push({
        id: 'expenses.special_needs.other_description',
        section: 'expenses',
        kind: 'field',
        prompt: 'What is the other special need?',
        path: 'expenses.specialNeedsExpenses.otherSpecialNeedDescription',
      });
    } else {
      answeredCount += 1;
    }
  }

  /*
   * Q6j "Complete for each disabled person listed in question 6."
   *
   * Conditional on Q6i: the form only asks for per-person disability detail once
   * the household has said someone has a disability that limits activities. The
   * printed page provides two person blocks.
   */
  if (questionnaire.circumstances.disabilityLimitsActivities === true) {
    const details = questionnaire.circumstances.disabilityDetails;

    totalCount += 1;

    if (safeEntries(details?.entries).length === 0) {
      push({
        id: 'circumstances.disability_details.records',
        section: 'circumstances',
        kind: 'records',
        prompt: 'Who has the disability?',
        path: 'circumstances.disabilityDetails.entries',
        minimumRecords: 1,
      });
    } else {
      answeredCount += 1;

      safeEntries<Record<string, unknown>>(details?.entries).forEach(
        (detail, index) => {
          for (const field of [
            { key: 'needsCareForOthersToWork', prompt: 'need care so someone else can work or attend school' },
            { key: 'needsHelpWithDailyLiving', prompt: 'need help with activities of daily living' },
            { key: 'worksWithMedicalExpenses', prompt: 'work and have medical expenses that help them keep working' },
            { key: 'inMedicalFacility', prompt: 'live in a medical facility or nursing home' },
          ]) {
            totalCount += 1;

            if (unanswered(detail?.[field.key] as TriState)) {
              push({
                id: `circumstances.disability_details.${index}.${field.key}`,
                section: 'circumstances',
                kind: 'gateway',
                prompt: `Does person ${index + 1} ${field.prompt}?`,
                path: `circumstances.disabilityDetails.entries.${index}.${field.key}`,
              });
            } else {
              answeredCount += 1;
            }
          }
        },
      );
    }
  }

  /*
   * Q25 personal property. Kept separate from Q24: Q24 covers cash, accounts
   * and other liquid resources; Q25 covers physical personal and business
   * property, and the printed form gives them different columns.
   */
  {
    const property = questionnaire.resources.personalProperty;

    totalCount += 1;

    if (unanswered(property?.answer)) {
      push({
        id: 'resources.personal_property',
        section: 'resources',
        kind: 'gateway',
        prompt: 'Does anyone own any personal or business property?',
        help:
          'For example tools, business equipment or inventory, livestock, a camper shell, a non-motor boat or trailer, sporting equipment or guns, or jewellery, artwork or collections.',
        path: 'resources.personalProperty.answer',
      });
    } else {
      answeredCount += 1;

      if (
        property?.answer === true &&
        safeEntries(property?.entries).length === 0
      ) {
        totalCount += 1;
        push({
          id: 'resources.personal_property.records',
          section: 'resources',
          kind: 'records',
          prompt: 'Tell us about each item',
          path: 'resources.personalProperty.entries',
          minimumRecords: 1,
        });
      }
    }
  }

  /*
   * Appendix E vehicle detail.
   *
   * The printed page states its own applicability: required for cash aid, and
   * for health care only where someone applying is 65 or older or disabled. The
   * existing detailedVehicleInformationRequired helper already encodes that, so
   * this asks only when it holds and Q26 said there is a vehicle.
   */
  if (
    questionnaire.resources.vehicles?.answer === true &&
    appendixEApplies(application)
  ) {
    const vehicles = questionnaire.appendices.vehicleDetails;

    totalCount += 1;

    if (safeEntries(vehicles?.entries).length === 0) {
      push({
        id: 'appendices.vehicle_details.records',
        section: 'appendices',
        kind: 'records',
        prompt: 'Tell us about each vehicle',
        help: 'Appendix E asks for the owner, value and use of every vehicle.',
        path: 'appendices.vehicleDetails.entries',
        minimumRecords: 1,
      });
    } else {
      answeredCount += 1;

      safeEntries<Record<string, unknown>>(vehicles?.entries).forEach(
        (vehicle, index) => {
          for (const field of [
            { key: 'isGiftDonationOrTransfer', prompt: 'a gift, donation or family transfer' },
            { key: 'isLeased', prompt: 'leased' },
            { key: 'usedForExemptPurpose', prompt: 'used as a home, for self-employment, to transport a disabled member, or to fetch fuel or water' },
            { key: 'usedByChildUnder18', prompt: 'used by a child under 18 for school, work, training or a job search' },
          ]) {
            totalCount += 1;

            if (unanswered(vehicle?.[field.key] as TriState)) {
              push({
                id: `appendices.vehicle_details.${index}.${field.key}`,
                section: 'appendices',
                kind: 'gateway',
                prompt: `Is vehicle ${index + 1} ${field.prompt}?`,
                path: `appendices.vehicleDetails.entries.${index}.${field.key}`,
              });
            } else {
              answeredCount += 1;
            }
          }
        },
      );
    }
  }

  /*
   * Appendix B, for American Indian and Alaska Native people. The printed form
   * activates it from Q3 "and applying for health care".
   */
  if (
    questionnaire.health.americanIndianOrAlaskaNative === true &&
    application.selectedPrograms.includes('medi_cal')
  ) {
    const tribal = questionnaire.appendices.tribalMembership;

    totalCount += 1;

    if (safeEntries(tribal?.entries).length === 0) {
      push({
        id: 'appendices.tribal_membership.records',
        section: 'appendices',
        kind: 'records',
        prompt: 'Who is American Indian or Alaska Native?',
        path: 'appendices.tribalMembership.entries',
        minimumRecords: 1,
      });
    } else {
      answeredCount += 1;

      safeEntries<Record<string, unknown>>(tribal?.entries).forEach(
        (person, index) => {
          for (const field of [
            { key: 'memberOfFederallyRecognizedTribe', prompt: 'a member of a federally recognized tribe' },
            { key: 'hasReceivedIndianHealthService', prompt: 'someone who has received a service from the Indian Health Service or a tribal health program' },
            { key: 'hasExcludableTribalIncome', prompt: 'receiving per-capita tribal payments or income from natural resources, farming, ranching, fishing, leases or royalties' },
          ]) {
            totalCount += 1;

            if (unanswered(person?.[field.key] as TriState)) {
              push({
                id: `appendices.tribal_membership.${index}.${field.key}`,
                section: 'appendices',
                kind: 'gateway',
                prompt: `Is person ${index + 1} ${field.prompt}?`,
                path: `appendices.tribalMembership.entries.${index}.${field.key}`,
              });
            } else {
              answeredCount += 1;
            }
          }

          /*
           * Item 3's follow-up is conditional on a No, not a Yes: "if no, is
           * this person eligible to get services from ...".
           */
          if (person?.hasReceivedIndianHealthService === false) {
            totalCount += 1;

            if (unanswered(person?.eligibleForIndianHealthService as TriState)) {
              push({
                id: `appendices.tribal_membership.${index}.eligibleForIndianHealthService`,
                section: 'appendices',
                kind: 'gateway',
                prompt: `Is person ${index + 1} eligible to get services from the Indian Health Service, a tribal health program, or an urban Indian health program?`,
                path: `appendices.tribalMembership.entries.${index}.eligibleForIndianHealthService`,
              });
            } else {
              answeredCount += 1;
            }
          }
        },
      );
    }
  }

  // ── Record gateways ─────────────────────────────────────────────────────
  for (const spec of RECORD_GATEWAYS) {
    // Medical expenses are only asked when the household includes an elderly or
    // disabled member, matching the form's own condition on Q16.
    totalCount += 1;

    const section = readPath(questionnaire, spec.sectionPath) as
      | GatewaySection<unknown>
      | undefined;
    const answer = section?.answer;

    if (unanswered(answer)) {
      push({
        id: spec.id,
        section: spec.section,
        kind: 'gateway',
        prompt: spec.prompt,
        help: spec.help,
        path: spec.path,
      });
      continue;
    }

    answeredCount += 1;

    // An explicit No ends the branch: details are neither asked nor submitted.
    if (answer !== true) continue;

    const entries = safeEntries<unknown>(section?.entries);

    if (entries.length === 0) {
      totalCount += 1;
      push({
        id: `${spec.id}.records`,
        section: spec.section,
        kind: 'records',
        prompt: spec.recordPrompt,
        path: `${spec.sectionPath}.entries`,
        minimumRecords: 1,
      });
      continue;
    }

    const missing = missingRequiredFields(spec, entries);
    totalCount += missing.length;
    missing.forEach(push);
  }

  // ── Medical expenses: conditional on an elderly or disabled member ───────
  if (householdHasElderlyOrDisabledMember(application)) {
    totalCount += 1;

    if (unanswered(questionnaire.expenses.medical.answer)) {
      push({
        id: 'expenses.medical',
        section: 'expenses',
        kind: 'gateway',
        prompt:
          'Does anyone 60 or older, or anyone with a disability, have out-of-pocket medical expenses?',
        path: 'expenses.medical.answer',
      });
    } else {
      answeredCount += 1;

      if (
        questionnaire.expenses.medical.answer === true &&
        safeEntries(questionnaire.expenses.medical.entries).length === 0
      ) {
        totalCount += 1;
        push({
          id: 'expenses.medical.records',
          section: 'expenses',
          kind: 'records',
          prompt: 'Add each medical expense',
          path: 'expenses.medical.entries',
          minimumRecords: 1,
        });
      }
    }
  }

  // ── Appendices ──────────────────────────────────────────────────────────
  for (const appendix of getActiveAppendices(application)) {
    if (appendix.id !== 'B') continue;

    // Appendix B needs the tribe's name.
    totalCount += 1;

    if (!questionnaire.appendices.tribalName.trim()) {
      push({
        id: 'appendices.tribal_name',
        section: 'appendices',
        kind: 'field',
        prompt: 'What is the name of the tribe?',
        path: 'appendices.tribalName',
      });
    } else {
      answeredCount += 1;
    }
  }

  /*
   * Appendix D employment history.
   *
   * The printed page states its own scope: "your work history for the past 24
   * months (two years)". A Yes on the gateway opens the per-job detail the
   * appendix actually prints — everything asked below has a reviewed
   * destination except the hours *count*, which the form has no widget for and
   * which is therefore reported as a manual write-in rather than not asked.
   */
  if (appendixDApplies(application)) {
    const employment = questionnaire.appendices.employmentHistory;

    totalCount += 1;

    if (unanswered(employment.answer)) {
      push({
        id: 'appendices.employment_history',
        section: 'appendices',
        kind: 'gateway',
        prompt: 'Can you tell us about recent employment for each adult applying for cash aid?',
        help: 'Cash aid asks for employment history when two or more adults apply.',
        path: 'appendices.employmentHistory.answer',
      });
    } else {
      answeredCount += 1;

      if (employment.answer === true) {
        totalCount += 1;

        if (safeEntries(employment.entries).length === 0) {
          push({
            id: 'appendices.employment_history.records',
            section: 'appendices',
            kind: 'records',
            prompt: 'Tell us about each job from the last two years',
            help: 'Appendix D asks for the employer, the dates worked, the pay, and why each job ended.',
            path: 'appendices.employmentHistory.entries',
            minimumRecords: 1,
          });
        } else {
          answeredCount += 1;

          safeEntries<Record<string, unknown>>(employment.entries).forEach(
            (job, index) => {
              for (const field of [
                { key: 'selfEmployed', prompt: 'your own business (self-employed)' },
                { key: 'countyHelpedGetJob', prompt: 'a job the County helped get' },
              ]) {
                totalCount += 1;

                if (unanswered(job?.[field.key] as TriState)) {
                  push({
                    id: `appendices.employment_history.${index}.${field.key}`,
                    section: 'appendices',
                    kind: 'gateway',
                    prompt: `Was job ${index + 1} ${field.prompt}?`,
                    path: `appendices.employmentHistory.entries.${index}.${field.key}`,
                  });
                } else {
                  answeredCount += 1;
                }
              }
            },
          );
        }
      }
    }
  }

  const sections: PlannedSection[] = QUESTION_SECTIONS.map((section) => ({
    section,
    title: SECTION_TITLES[section],
    questions: byTier(bySection.get(section)!),
  })).filter((planned) => planned.questions.length > 0);

  /*
   * The outstanding list drives the one-question-at-a-time flow, so it is
   * ordered by priority across sections: filing and identity first, then the
   * eligibility-critical income/expense/resource questions the form says speed
   * up a determination, then supporting, then optional.
   */
  return {
    sections,
    outstanding: byTier(sections.flatMap((planned) => planned.questions)),
    answeredCount,
    totalCount,
  };
}

/** Stable sort by tier: lower tiers first, original order preserved within. */
function byTier(questions: PlannedQuestion[]): PlannedQuestion[] {
  return questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => a.question.tier - b.question.tier || a.index - b.index)
    .map(({ question }) => question);
}

/** True when any household member is 60+ or marked disabled. */
export function householdHasElderlyOrDisabledMember(
  application: Saws2PlusApplicationData,
): boolean {
  if (application.applicant.householdDetails.disabled === true) return true;

  const applicantAge = ageFromDateOfBirth(application.applicant.dateOfBirth);
  if (applicantAge !== undefined && applicantAge >= 60) return true;

  return application.householdMembers.some((member) => {
    if (member.adultDetails?.disabled === true) return true;
    if (member.childDetails?.disabled === true) return true;

    const age = member.age ?? ageFromDateOfBirth(member.dateOfBirth);

    return age !== undefined && age >= 60;
  });
}

/** Whole years between an ISO date of birth and today, or undefined. */
export function ageFromDateOfBirth(dateOfBirth: string): number | undefined {
  const trimmed = dateOfBirth.trim();
  if (!trimmed) return undefined;

  const born = new Date(trimmed);
  if (Number.isNaN(born.getTime())) return undefined;

  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();

  const beforeBirthday =
    today.getMonth() < born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() < born.getDate());

  if (beforeBirthday) age -= 1;

  return age >= 0 ? age : undefined;
}

export interface ActiveAppendix {
  id: 'A' | 'B' | 'C' | 'D' | 'E';
  title: string;
  reason: string;
}

/**
 * Appendices that apply to this application.
 *
 * An appendix is never activated speculatively — each requires an explicit
 * affirmative answer, so an unknown gateway leaves the appendix inactive.
 */
export function getActiveAppendices(
  application: Saws2PlusApplicationData,
): ActiveAppendix[] {
  const questionnaire = application.questionnaire;
  const active: ActiveAppendix[] = [];

  if (activeEntries(questionnaire.health.employerCoverage).length > 0) {
    active.push({
      id: 'A',
      title: 'Job-based health coverage',
      reason: 'Someone in the household has a job that offers health coverage.',
    });
  }

  if (questionnaire.health.americanIndianOrAlaskaNative === true) {
    active.push({
      id: 'B',
      title: 'American Indian or Alaska Native',
      reason: 'Someone applying is American Indian or Alaska Native.',
    });
  }

  if (
    activeEntries(questionnaire.circumstances.authorizedRepresentative).some(
      (representative) => representative.forHealthCoverage === true,
    )
  ) {
    active.push({
      id: 'C',
      title: 'Health-insurance authorized representative',
      reason: 'An authorized representative was named for health coverage.',
    });
  }

  if (appendixDApplies(application)) {
    active.push({
      id: 'D',
      title: 'Employment history',
      reason: 'Cash aid is requested and two or more adults are applying.',
    });
  }

  /*
   * Appendix E attaches as soon as the household says it has a vehicle. It used
   * to require a filled Q26 row, which meant the appendix could not be offered
   * until the applicant had already described a vehicle — and left the appendix
   * list disagreeing with the questionnaire about whether it applied.
   */
  if (
    questionnaire.resources.vehicles?.answer === true &&
    appendixEApplies(application)
  ) {
    active.push({
      id: 'E',
      title: 'Vehicle information',
      reason:
        'Detailed vehicle information is required for cash aid, or for a household member who is 65 or older or disabled.',
    });
  }

  return active;
}

/**
 * Appendix E: detailed vehicle information is required.
 *
 * The printed page states its own rule at the top: required for cash aid, and
 * for health care only where someone applying is 65 or older or disabled. This
 * is the single definition — the appendix list and the questionnaire both use
 * it, so they cannot disagree about whether the appendix is active.
 */
export function appendixEApplies(
  application: Saws2PlusApplicationData,
): boolean {
  return (
    application.questionnaire.appendices?.detailedVehicleInformationRequired ===
      true ||
    application.selectedPrograms.includes('calworks') ||
    householdHasElderlyOrDisabledMember(application)
  );
}

/** Appendix D: cash aid requested and at least two adults applying. */
export function appendixDApplies(
  application: Saws2PlusApplicationData,
): boolean {
  if (!application.selectedPrograms.includes('calworks')) return false;

  const adultMembers = application.householdMembers.filter((member) => {
    const age = member.age ?? ageFromDateOfBirth(member.dateOfBirth);
    return age === undefined ? false : age >= 18;
  });

  // The applicant plus at least one other adult.
  return adultMembers.length >= 1;
}

/** Members available for a "who does this apply to?" selector. */
export function memberOptions(
  application: Saws2PlusApplicationData,
): Array<{ id: string; label: string }> {
  const applicantName =
    `${application.applicant.firstName} ${application.applicant.lastName}`.trim();

  return [
    { id: APPLICANT_MEMBER_ID, label: applicantName || 'Primary applicant' },
    ...application.householdMembers.map((member, index) => ({
      id: member.id,
      label:
        `${member.firstName} ${member.lastName}`.trim() ||
        member.relationshipToApplicant ||
        `Household member ${index + 1}`,
    })),
  ];
}
