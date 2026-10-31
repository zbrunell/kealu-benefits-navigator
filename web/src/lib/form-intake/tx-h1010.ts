//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What Texas Form H1010 needs asked, as configuration.
 *
 * Every question here exists because an H1010 mapping reads the canonical field
 * it writes. That is the rule this file is built on, and
 * `tx-intake-coverage.test.ts` enforces it in both directions: a question whose
 * answer no mapping reads is a question we are asking for nothing, and a
 * mapping no question can reach is a printed box the applicant can never fill.
 *
 * ── Not the SAWS questionnaire ─────────────────────────────────────────────
 * The California flow asks about Cal-Learn, IHSS, CHDP appointments, county
 * residency, Appendix D employment history and thirty other things H1010 has no
 * box for. Running it for a Texas household would be forty questions of which
 * two thirds go nowhere. So the question *set* is Texas's own.
 *
 * What is shared is everything underneath: the canonical application model, the
 * field plan, the validation rules, the requiredness primitives, the tri-state
 * contract, and the components that render a question. For the main form Texas
 * adds no field to the canonical schema — every answer it needs was already
 * representable. The Medicaid / CHIP addendum asks a few things nothing held
 * (each person's tax filing, tax deductions, Healthy Texas Women's confidential
 * address), and those live in one optional, Texas-only record,
 * `medicaidAddendum`; everything else it asks reuses the shared fields.
 *
 * ── Where an answer lives ──────────────────────────────────────────────────
 * Each question carries a typed `read`/`write` pair rather than a path string,
 * so a wrong destination is a compile error. The destinations are the same
 * fields the California flow writes — `preferences.homeless`,
 * `questionnaire.income.earned.answer` — which is why the same
 * `buildApplicationFieldPlan` produces a Texas plan with no Texas branch in it.
 *
 * ── What is deliberately not asked ─────────────────────────────────────────
 * Social Security numbers, alien registration and immigration document numbers,
 * bank and account numbers, driver's licence numbers, and signatures. The
 * mapping layer refuses to place them and the intake does not collect them, so
 * the refusal is not a filter that could be bypassed — the answer never exists.
 * Race and ethnicity are not asked either: the printed form says they are
 * optional and they affect nothing we compute.
 */

import {
  checkCity,
  checkStreetAddress,
  checkUsPhone,
  checkZipCode,
  normalizeUsPhone,
  normalizeWhitespace,
  normalizeZipCode,
} from '@/lib/field-validation';
import { readPath, writePath } from '@/lib/saws2-question-planner';
import { tableForMember } from '@/lib/household-rows';
import { RELATIONSHIP_LABEL_KEYS } from '@/lib/household-relationships';
import {
  addendumOf,
  addendumPeople,
  appliesForHealthCoverage,
  fullName,
  householdHasPossibleChild,
  householdHasPossibleHtwCandidate,
  needsSpouseName,
  taxReturnFor,
} from '@/lib/medicaid-addendum';
import type { BenefitProgramId } from '@/lib/state-applications';
import type {
  AnswerValue,
  IntakeForm,
  IntakeQuestion,
  IntakeSection,
  QuestionKind,
} from '@/lib/form-intake/model';
import type {
  ApplicationAddress,
  ApplicationPreferences,
  ExpeditedServiceInformation,
  HouseholdMember,
  Saws2PlusApplicationData,
} from '@/types/application';
import type {
  HtwScreeningOptOut,
  MedicaidAddendumAnswers,
  TaxReturnAnswers,
} from '@/types/medicaid-addendum';
import {
  APPLICANT_MEMBER_ID,
  type AuthorizedRepresentative,
  type EarnedIncomeEntry,
  type EmployerCoverageEntry,
  type HouseholdExpenseEntry,
  type TribalMembershipEntry,
  type UnearnedIncomeEntry,
} from '@/types/saws-questionnaire';

type Data = Saws2PlusApplicationData;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

const text = (value: AnswerValue): string =>
  value === undefined || value === null ? '' : String(value);

const tri = (value: AnswerValue): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/** A question whose answer lives on the applicant's mailing address. */
function mailingAddressField(
  field: keyof ApplicationAddress,
): Pick<IntakeQuestion<Data>, 'read' | 'write'> {
  return {
    read: (data) => data.applicant.mailingAddress[field],
    write: (data, value) => ({
      ...data,
      applicant: {
        ...data.applicant,
        mailingAddress: {
          ...data.applicant.mailingAddress,
          [field]: text(value),
        },
      },
    }),
  };
}

/** A question whose answer is one of the page-1 preference checkboxes. */
function preference(
  field: keyof ApplicationPreferences,
): Pick<IntakeQuestion<Data>, 'read' | 'write'> {
  return {
    read: (data) => data.preferences[field],
    write: (data, value) => ({
      ...data,
      preferences: { ...data.preferences, [field]: tri(value) },
    }),
  };
}

/** A question whose answer is one of the expedited-service criteria. */
function expedited(
  field: keyof ExpeditedServiceInformation,
): Pick<IntakeQuestion<Data>, 'read' | 'write'> {
  return {
    read: (data) => data.expeditedService[field],
    write: (data, value) => ({
      ...data,
      expeditedService: { ...data.expeditedService, [field]: tri(value) },
    }),
  };
}

/** A question whose answer lives on a dotted path inside the questionnaire. */
function questionnaire(
  path: string,
): Pick<IntakeQuestion<Data>, 'read' | 'write'> {
  return {
    read: (data) => readPath(data.questionnaire, path) as AnswerValue,
    write: (data, value) => ({
      ...data,
      questionnaire: writePath(data.questionnaire, path, value),
    }),
  };
}

/** The same, for a Yes/No whose `undefined` must survive the round trip. */
function questionnaireTri(
  path: string,
): Pick<IntakeQuestion<Data>, 'read' | 'write'> {
  const accessor = questionnaire(path);

  return {
    read: accessor.read,
    write: (data, value) => accessor.write(data, tri(value)),
  };
}

// ---------------------------------------------------------------------------
// Question builders
// ---------------------------------------------------------------------------

interface YesNoSpec {
  id: string;
  promptKey: string;
  helpKey?: string;
  required?: boolean;
  gate?: IntakeQuestion<Data>['gate'];
  accessor: Pick<IntakeQuestion<Data>, 'read' | 'write'>;
}

function yesNo(spec: YesNoSpec): IntakeQuestion<Data> {
  return {
    id: spec.id,
    promptKey: spec.promptKey,
    helpKey: spec.helpKey,
    kind: 'yes_no',
    required: spec.required,
    gate: spec.gate,
    ...spec.accessor,
  };
}

// ---------------------------------------------------------------------------
// The gates, named once
// ---------------------------------------------------------------------------

const Q = {
  mailSame: 'tx.mail.same',
  homeless: 'tx.live.homeless',
  institutional: 'tx.live.institutional',
  foodTogether: 'tx.household.food_together',
  pregnant: 'tx.household.pregnant',
  students: 'tx.household.students',
  hasJob: 'tx.money.has_job',
  selfEmployed: 'tx.money.self_employed',
  otherIncome: 'tx.money.other_income',
  incomeVaries: 'tx.money.varies',
  annualIncome: 'tx.money.annual',
  incomeType: 'tx.money.kind',
  hasBills: 'tx.bills.has_household',
  dependentCare: 'tx.bills.dependent_care',
  childSupport: 'tx.bills.child_support',
  medical: 'tx.bills.medical',
  accounts: 'tx.own.accounts',
  vehicles: 'tx.own.vehicles',
  realProperty: 'tx.own.real_property',
  personalProperty: 'tx.own.personal_property',
  expeditedIncome: 'tx.urgent.income_and_resources',
  expeditedHousing: 'tx.urgent.less_than_housing',
  expeditedFarm: 'tx.urgent.farm_worker',
  expeditedFood: 'tx.urgent.food_runs_out',
  expeditedEviction: 'tx.urgent.eviction',
  expeditedUtilities: 'tx.urgent.utilities',
  expeditedClothing: 'tx.urgent.clothing',
  expeditedTransport: 'tx.urgent.transport',
  military: 'tx.situation.military',
  disability: 'tx.situation.disability',
  fosterCare: 'tx.situation.foster_care',
  priorAssistance: 'tx.situation.prior_assistance',
  existingBenefits: 'tx.situation.existing_benefits',
  // The Medicaid / CHIP addendum. See "Medicaid / CHIP addendum" below.
  hasDeductions: 'tx.deductions.any',
  alimony: 'tx.deductions.alimony',
  studentLoan: 'tx.deductions.student_loan',
  otherDeductions: 'tx.deductions.other',
  migrantChild: 'tx.health.migrant_child',
  specialNeedsChild: 'tx.health.special_needs_child',
  absentParent: 'tx.health.absent_parent',
  fosterCareAt18: 'tx.health.foster_care_at_18',
  americanIndian: 'tx.health.american_indian',
  htwConfidential: 'tx.htw.confidential',
  htwDeclines: 'tx.htw.declines',
  jobCoverage: 'tx.coverage.job_offers',
  lostJobCoverage: 'tx.coverage.lost',
  lostJobCoverageReason: 'tx.coverage.lost_reason',
  incarcerated: 'tx.final.incarcerated',
  assister: 'tx.assister.has',
  hasHelper: 'tx.helper.has',
} as const;

/** Section ids, which are also the screens the flow pages through. */
export const TX_SECTIONS = {
  mailing: 'tx-mailing',
  home: 'tx-home',
  household: 'tx-household',
  money: 'tx-money',
  bills: 'tx-bills',
  own: 'tx-own',
  urgent: 'tx-urgent',
  situation: 'tx-situation',
  deductions: 'tx-deductions',
  incomeTotals: 'tx-income-totals',
  jobCoverage: 'tx-job-coverage',
  healthChildren: 'tx-health-children',
  healthPeople: 'tx-health-people',
  htw: 'tx-htw',
  healthFinal: 'tx-health-final',
  helper: 'tx-helper',
  assister: 'tx-assister',
} as const;

/**
 * Section 1 of the addendum is one block per person, Person 1 first.
 *
 * Seven, because the roster holds up to six people besides the applicant. The
 * printed page has five blocks; the sixth and seventh people are reported as
 * overflow ("add more pages with the same facts"), exactly as they are in
 * Section H.
 */
export const TAX_PERSON_SLOTS = 7;

/** The section id for one person's tax-return block. */
export function taxSectionId(slot: number): string {
  return `tx-tax-${slot}`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const mailingSection: IntakeSection<Data> = {
  id: TX_SECTIONS.mailing,
  titleKey: 'tx_section_mailing',
  introKey: 'tx_section_mailing_intro',
  questions: [
    yesNo({
      id: Q.mailSame,
      promptKey: 'tx_q_mail_same',
      required: true,
      /*
       * A plain boolean on the model rather than a tri-state, because the
       * printed question has no third box and the default — mail comes to the
       * address you live at — is true for almost everyone. The Yes/No control
       * still writes an explicit answer, so the field plan carries what the
       * applicant chose rather than what the model started at.
       */
      accessor: {
        read: (data) => data.applicant.mailingAddressSameAsHome,
        write: (data, value) => ({
          ...data,
          applicant: {
            ...data.applicant,
            mailingAddressSameAsHome: value !== false,
          },
        }),
      },
    }),
    {
      id: 'tx.mail.street',
      promptKey: 'field_street_address',
      kind: 'text',
      required: true,
      gate: { questionId: Q.mailSame, equals: false },
      normalize: normalizeWhitespace,
      validate: (value) => checkStreetAddress(text(value)),
      ...mailingAddressField('street'),
    },
    {
      id: 'tx.mail.apartment',
      promptKey: 'field_apartment',
      kind: 'text',
      gate: { questionId: Q.mailSame, equals: false },
      normalize: normalizeWhitespace,
      ...mailingAddressField('apartment'),
    },
    {
      id: 'tx.mail.city',
      promptKey: 'field_city',
      kind: 'text',
      required: true,
      gate: { questionId: Q.mailSame, equals: false },
      normalize: normalizeWhitespace,
      validate: (value) => checkCity(text(value)),
      ...mailingAddressField('city'),
    },
    {
      id: 'tx.mail.state',
      promptKey: 'field_state',
      kind: 'text',
      required: true,
      gate: { questionId: Q.mailSame, equals: false },
      normalize: (raw) => raw.trim().toUpperCase().slice(0, 2),
      ...mailingAddressField('state'),
    },
    {
      id: 'tx.mail.zip',
      promptKey: 'field_zip_code',
      kind: 'text',
      required: true,
      gate: { questionId: Q.mailSame, equals: false },
      normalize: normalizeZipCode,
      validate: (value) => checkZipCode(text(value)),
      ...mailingAddressField('zipCode'),
    },
  ],
};

const homeSection: IntakeSection<Data> = {
  id: TX_SECTIONS.home,
  titleKey: 'tx_section_home',
  introKey: 'tx_section_home_intro',
  questions: [
    yesNo({
      id: Q.homeless,
      promptKey: 'tx_q_homeless',
      // Decides expedited screening and where notices can be sent.
      required: true,
      accessor: preference('homeless'),
    }),
    yesNo({
      id: Q.institutional,
      promptKey: 'tx_q_institutional',
      accessor: questionnaireTri('circumstances.institutionalLiving'),
    }),
  ],
};

const householdSection: IntakeSection<Data> = {
  id: TX_SECTIONS.household,
  titleKey: 'tx_section_household',
  introKey: 'tx_section_household_intro',
  questions: [
    yesNo({
      id: Q.foodTogether,
      promptKey: 'tx_q_food_together',
      helpKey: 'tx_q_food_together_help',
      // Decides who is in the SNAP household, so it decides the income test.
      required: true,
      accessor: questionnaireTri('circumstances.buysAndPreparesFoodTogether'),
    }),
    yesNo({
      id: Q.pregnant,
      promptKey: 'tx_q_pregnant',
      helpKey: 'tx_q_pregnant_help',
      /*
       * Texas Medicaid is categorical: pregnancy is one of the few categories
       * an adult can qualify under at all. An unanswered question here is the
       * difference between a coverage route and none.
       */
      required: true,
      accessor: {
        read: (data) => data.pregnancy.anyonePregnant,
        write: (data, value) => ({
          ...data,
          pregnancy: { ...data.pregnancy, anyonePregnant: tri(value) },
        }),
      },
    }),
    yesNo({
      id: Q.students,
      promptKey: 'tx_q_students',
      accessor: questionnaireTri('circumstances.students.answer'),
    }),
  ],
};

const moneySection: IntakeSection<Data> = {
  id: TX_SECTIONS.money,
  titleKey: 'tx_section_money',
  introKey: 'tx_section_money_intro',
  questions: [
    {
      id: Q.annualIncome,
      promptKey: 'tx_q_annual_income',
      helpKey: 'tx_q_annual_income_help',
      kind: 'money',
      read: (data) => data.annualHouseholdIncome,
      write: (data, value) => ({
        ...data,
        annualHouseholdIncome:
          value === undefined || value === '' ? undefined : Number(value),
      }),
    },
    {
      id: Q.incomeType,
      promptKey: 'tx_q_income_kind',
      helpKey: 'tx_q_income_kind_help',
      kind: 'text',
      normalize: normalizeWhitespace,
      read: (data) => data.incomeType,
      write: (data, value) => ({ ...data, incomeType: text(value) }),
    },
    yesNo({
      id: Q.hasJob,
      promptKey: 'tx_q_has_job',
      // The income test cannot run without it, and it opens the jobs table.
      required: true,
      accessor: questionnaireTri('income.earned.answer'),
    }),
    yesNo({
      id: Q.selfEmployed,
      promptKey: 'tx_q_self_employed',
      accessor: questionnaireTri('income.selfEmployment.answer'),
    }),
    yesNo({
      id: Q.otherIncome,
      promptKey: 'tx_q_other_income',
      helpKey: 'tx_q_other_income_help',
      required: true,
      accessor: questionnaireTri('income.unearned.answer'),
    }),
    yesNo({
      id: Q.incomeVaries,
      promptKey: 'tx_q_income_varies',
      accessor: questionnaireTri('income.incomeVariesDuringYear'),
    }),
  ],
};

const billsSection: IntakeSection<Data> = {
  id: TX_SECTIONS.bills,
  titleKey: 'tx_section_bills',
  introKey: 'tx_section_bills_intro',
  questions: [
    yesNo({
      id: Q.hasBills,
      promptKey: 'tx_q_has_bills',
      helpKey: 'tx_q_has_bills_help',
      // Housing and utility costs are a SNAP deduction; a No here can cost a
      // household benefit every month.
      required: true,
      accessor: questionnaireTri('expenses.household.answer'),
    }),
    yesNo({
      id: Q.dependentCare,
      promptKey: 'tx_q_dependent_care',
      accessor: questionnaireTri('expenses.dependentCare.answer'),
    }),
    yesNo({
      id: Q.childSupport,
      promptKey: 'tx_q_child_support',
      accessor: questionnaireTri('expenses.childSupportPaid.answer'),
    }),
    yesNo({
      id: Q.medical,
      promptKey: 'tx_q_medical_costs',
      helpKey: 'tx_q_medical_costs_help',
      accessor: questionnaireTri('expenses.medical.answer'),
    }),
  ],
};

const ownSection: IntakeSection<Data> = {
  id: TX_SECTIONS.own,
  titleKey: 'tx_section_own',
  introKey: 'tx_section_own_intro',
  questions: [
    yesNo({
      id: Q.accounts,
      promptKey: 'tx_q_accounts',
      helpKey: 'tx_q_accounts_help',
      accessor: questionnaireTri('resources.accounts.answer'),
    }),
    yesNo({
      id: Q.vehicles,
      promptKey: 'tx_q_vehicles',
      accessor: questionnaireTri('resources.vehicles.answer'),
    }),
    yesNo({
      id: Q.realProperty,
      promptKey: 'tx_q_real_property',
      accessor: questionnaireTri('resources.realProperty.answer'),
    }),
    yesNo({
      id: Q.personalProperty,
      promptKey: 'tx_q_personal_property',
      accessor: questionnaireTri('resources.personalProperty.answer'),
    }),
  ],
};

/**
 * The SNAP expedited screen.
 *
 * HHSC's published purpose for H1010 names it as the screening document for
 * applicants who may be entitled to expedited service, so the section applies
 * when the household asked for food benefits and not otherwise. Asking a
 * healthcare-only household whether their food will run out in three days is
 * asking a question that leads nowhere.
 */
const urgentSection: IntakeSection<Data> = {
  id: TX_SECTIONS.urgent,
  titleKey: 'tx_section_urgent',
  introKey: 'tx_section_urgent_intro',
  appliesWhen: (data) => data.selectedPrograms.includes('tx_snap'),
  questions: [
    yesNo({
      id: Q.expeditedIncome,
      promptKey: 'tx_q_expedited_income',
      required: true,
      accessor: expedited('grossIncomeUnder150AndResourcesUnder100'),
    }),
    yesNo({
      id: Q.expeditedHousing,
      promptKey: 'tx_q_expedited_housing',
      required: true,
      accessor: expedited('incomeAndResourcesLessThanHousingCosts'),
    }),
    yesNo({
      id: Q.expeditedFarm,
      promptKey: 'tx_q_expedited_farm',
      required: true,
      accessor: expedited('migrantOrSeasonalFarmWorker'),
    }),
    yesNo({
      id: Q.expeditedFood,
      promptKey: 'tx_q_expedited_food',
      accessor: expedited('foodRunsOutWithinThreeDays'),
    }),
    yesNo({
      id: Q.expeditedEviction,
      promptKey: 'tx_q_expedited_eviction',
      accessor: expedited('evictionNotice'),
    }),
    yesNo({
      id: Q.expeditedUtilities,
      promptKey: 'tx_q_expedited_utilities',
      accessor: expedited('utilitiesShutOffOrNotice'),
    }),
    yesNo({
      id: Q.expeditedClothing,
      promptKey: 'tx_q_expedited_clothing',
      accessor: expedited('needsEssentialClothing'),
    }),
    yesNo({
      id: Q.expeditedTransport,
      promptKey: 'tx_q_expedited_transport',
      accessor: expedited('needsTransportationForEmergencyNeeds'),
    }),
  ],
};

const situationSection: IntakeSection<Data> = {
  id: TX_SECTIONS.situation,
  titleKey: 'tx_section_situation',
  introKey: 'tx_section_situation_intro',
  questions: [
    yesNo({
      id: Q.military,
      promptKey: 'tx_q_military',
      accessor: questionnaireTri('circumstances.militaryService.answer'),
    }),
    yesNo({
      id: Q.disability,
      promptKey: 'tx_q_disability',
      accessor: questionnaireTri('circumstances.disabilityLimitsActivities'),
    }),
    yesNo({
      id: Q.fosterCare,
      promptKey: 'tx_q_foster_care',
      helpKey: 'tx_q_foster_care_help',
      accessor: questionnaireTri('circumstances.everInFosterCare'),
    }),
    yesNo({
      id: Q.priorAssistance,
      promptKey: 'tx_q_prior_assistance',
      accessor: questionnaireTri('circumstances.priorPublicAssistance'),
    }),
    {
      id: Q.existingBenefits,
      promptKey: 'tx_q_existing_benefits',
      kind: 'text',
      normalize: normalizeWhitespace,
      read: (data) => data.existingBenefits,
      write: (data, value) => ({ ...data, existingBenefits: text(value) }),
    },
  ],
};

const helperSection: IntakeSection<Data> = {
  id: TX_SECTIONS.helper,
  titleKey: 'tx_section_helper',
  introKey: 'tx_section_helper_intro',
  questions: [
    yesNo({
      id: Q.hasHelper,
      promptKey: 'tx_q_has_helper',
      helpKey: 'tx_q_has_helper_help',
      required: true,
      accessor: questionnaireTri('circumstances.authorizedRepresentative.answer'),
    }),
  ],
};

// ---------------------------------------------------------------------------
// Medicaid / CHIP addendum
// ---------------------------------------------------------------------------
//
// HHSC's addendum to H1010 ("Applying for or renewing Medicaid, CHIP, or
// Healthy Texas Women? If yes, you must fill out this form"). Every section
// below applies only when the household chose Medicaid or CHIP, so a household
// applying for food benefits alone sees exactly the screens it saw before.
//
// Questions the shared model already answers are not asked again. The answers
// these questions write that nothing else holds live in `medicaidAddendum`;
// the rest reuse the fields the California flow already writes, so the mapping
// layer reads one key for both states.

/** Normalise a value for the kind of question writing it. */
function coerce(kind: QuestionKind, value: AnswerValue): AnswerValue {
  if (kind === 'money' || kind === 'integer') {
    return value === undefined || value === '' ? undefined : Number(value);
  }

  if (kind === 'yes_no') return tri(value);

  return text(value);
}

/** A question whose answer lives on the addendum record. */
function addendumAnswer(
  field: Exclude<keyof MedicaidAddendumAnswers, 'taxReturns' | 'htwScreeningOptOuts'>,
  kind: QuestionKind,
): Pick<IntakeQuestion<Data>, 'read' | 'write'> {
  return {
    read: (data) => addendumOf(data)[field] as AnswerValue,
    write: (data, value) => ({
      ...data,
      medicaidAddendum: { ...addendumOf(data), [field]: coerce(kind, value) },
    }),
  };
}

/** The member id printed as Person `slot + 1`, if that person exists. */
function memberIdAt(data: Data, slot: number): string | undefined {
  if (slot === 0) return APPLICANT_MEMBER_ID;

  return data.householdMembers[slot - 1]?.id;
}

/** A question about one person's tax return. */
function taxAnswer(
  slot: number,
  field: keyof TaxReturnAnswers,
  kind: QuestionKind,
): Pick<IntakeQuestion<Data>, 'read' | 'write'> {
  return {
    read: (data) => {
      const memberId = memberIdAt(data, slot);

      return memberId ? (taxReturnFor(data, memberId)[field] as AnswerValue) : undefined;
    },
    write: (data, value) => {
      const memberId = memberIdAt(data, slot);

      if (!memberId) return data;

      const addendum = addendumOf(data);

      return {
        ...data,
        medicaidAddendum: {
          ...addendum,
          taxReturns: {
            ...addendum.taxReturns,
            [memberId]: {
              ...taxReturnFor(data, memberId),
              [field]: coerce(kind, value),
            },
          },
        },
      };
    },
  };
}

/** A free-text addendum question, normalised like every other text answer. */
function addendumText(
  spec: Omit<IntakeQuestion<Data>, 'kind' | 'read' | 'write' | 'normalize'> & {
    field: Parameters<typeof addendumAnswer>[0];
  },
): IntakeQuestion<Data> {
  const { field, ...rest } = spec;

  return {
    ...rest,
    kind: 'text',
    normalize: normalizeWhitespace,
    ...addendumAnswer(field, 'text'),
  };
}

/**
 * One person's Section 1 block.
 *
 * Its own section so the heading can name the person, and so a household of
 * two sees two blocks rather than an empty table to add rows to. The printed
 * order is kept: "If yes, answer questions a to c. If no, skip to question c."
 */
function taxSection(slot: number): IntakeSection<Data> {
  const id = (name: string) => `tx.tax.${slot}.${name}`;
  const plansToFile = { questionId: id('plans_to_file'), equals: true };

  return {
    id: taxSectionId(slot),
    titleKey: slot === 0 ? 'tx_tax_title_you' : 'tx_tax_title_person',
    titleValues: (data) => {
      const memberId = memberIdAt(data, slot);
      const person = addendumPeople(data).find(
        (candidate) => candidate.memberId === memberId,
      );

      return { name: person ? fullName(person) : '' };
    },
    introKey: slot === 0 ? 'tx_tax_intro' : undefined,
    appliesWhen: (data) =>
      appliesForHealthCoverage(data) && memberIdAt(data, slot) !== undefined,
    questions: [
      {
        id: id('spouse_name'),
        promptKey: 'tx_tax_spouse_name',
        kind: 'text',
        normalize: normalizeWhitespace,
        // Only for someone married whose spouse the roster does not name.
        appliesWhen: (data) => {
          const memberId = memberIdAt(data, slot);

          return memberId !== undefined && needsSpouseName(data, memberId);
        },
        ...taxAnswer(slot, 'spouseName', 'text'),
      },
      yesNo({
        id: id('plans_to_file'),
        promptKey: slot === 0 ? 'tx_tax_plans_to_file_you' : 'tx_tax_plans_to_file',
        helpKey: 'tx_tax_plans_to_file_help',
        accessor: taxAnswer(slot, 'plansToFile', 'yes_no'),
      }),
      yesNo({
        id: id('files_jointly'),
        promptKey: 'tx_tax_files_jointly',
        gate: plansToFile,
        accessor: taxAnswer(slot, 'filesJointly', 'yes_no'),
      }),
      yesNo({
        id: id('fears_harm'),
        promptKey: 'tx_tax_fears_harm',
        helpKey: 'tx_tax_fears_harm_help',
        gate: plansToFile,
        accessor: taxAnswer(slot, 'fearsHarmFromDisclosure', 'yes_no'),
      }),
      yesNo({
        id: id('claims_dependents'),
        promptKey: 'tx_tax_claims_dependents',
        accessor: taxAnswer(slot, 'claimsDependents', 'yes_no'),
      }),
      {
        id: id('dependent_names'),
        promptKey: 'tx_tax_dependent_names',
        kind: 'text',
        normalize: normalizeWhitespace,
        gate: { questionId: id('claims_dependents'), equals: true },
        ...taxAnswer(slot, 'dependentNames', 'text'),
      },
      yesNo({
        id: id('claimed_as_dependent'),
        promptKey: 'tx_tax_claimed_as_dependent',
        accessor: taxAnswer(slot, 'claimedAsDependent', 'yes_no'),
      }),
      {
        id: id('tax_filer_name'),
        promptKey: 'tx_tax_filer_name',
        kind: 'text',
        normalize: normalizeWhitespace,
        gate: { questionId: id('claimed_as_dependent'), equals: true },
        ...taxAnswer(slot, 'taxFilerName', 'text'),
      },
      {
        id: id('relationship_to_tax_filer'),
        promptKey: 'tx_tax_relationship_to_filer',
        kind: 'text',
        normalize: normalizeWhitespace,
        gate: { questionId: id('claimed_as_dependent'), equals: true },
        ...taxAnswer(slot, 'relationshipToTaxFiler', 'text'),
      },
    ],
  };
}

/** Section 2. One Yes/No first, so a household with none answers once. */
const deductionsSection: IntakeSection<Data> = {
  id: TX_SECTIONS.deductions,
  titleKey: 'tx_section_deductions',
  introKey: 'tx_section_deductions_intro',
  appliesWhen: appliesForHealthCoverage,
  questions: [
    yesNo({
      id: Q.hasDeductions,
      promptKey: 'tx_q_has_deductions',
      helpKey: 'tx_q_has_deductions_help',
      accessor: addendumAnswer('hasTaxDeductions', 'yes_no'),
    }),
    yesNo({
      id: Q.alimony,
      promptKey: 'tx_q_alimony',
      gate: { questionId: Q.hasDeductions, equals: true },
      accessor: addendumAnswer('paysAlimony', 'yes_no'),
    }),
    {
      id: 'tx.deductions.alimony_amount',
      promptKey: 'tx_q_deduction_amount',
      kind: 'money',
      gate: { questionId: Q.alimony, equals: true },
      ...addendumAnswer('alimonyAmount', 'money'),
    },
    addendumText({
      id: 'tx.deductions.alimony_frequency',
      promptKey: 'tx_q_deduction_frequency',
      gate: { questionId: Q.alimony, equals: true },
      field: 'alimonyFrequency',
    }),
    yesNo({
      id: 'tx.deductions.alimony_before_2019',
      promptKey: 'tx_q_alimony_before_2019',
      gate: { questionId: Q.alimony, equals: true },
      accessor: addendumAnswer('alimonyAgreementBefore2019', 'yes_no'),
    }),
    yesNo({
      id: Q.studentLoan,
      promptKey: 'tx_q_student_loan_interest',
      gate: { questionId: Q.hasDeductions, equals: true },
      accessor: addendumAnswer('paysStudentLoanInterest', 'yes_no'),
    }),
    {
      id: 'tx.deductions.student_loan_amount',
      promptKey: 'tx_q_deduction_amount',
      kind: 'money',
      gate: { questionId: Q.studentLoan, equals: true },
      ...addendumAnswer('studentLoanInterestAmount', 'money'),
    },
    addendumText({
      id: 'tx.deductions.student_loan_frequency',
      promptKey: 'tx_q_deduction_frequency',
      gate: { questionId: Q.studentLoan, equals: true },
      field: 'studentLoanInterestFrequency',
    }),
    yesNo({
      id: Q.otherDeductions,
      promptKey: 'tx_q_other_deductions',
      helpKey: 'tx_q_other_deductions_help',
      gate: { questionId: Q.hasDeductions, equals: true },
      accessor: addendumAnswer('hasOtherDeductions', 'yes_no'),
    }),
    {
      id: 'tx.deductions.other_amount',
      promptKey: 'tx_q_deduction_amount',
      kind: 'money',
      gate: { questionId: Q.otherDeductions, equals: true },
      ...addendumAnswer('otherDeductionsAmount', 'money'),
    },
    addendumText({
      id: 'tx.deductions.other_frequency',
      promptKey: 'tx_q_deduction_frequency',
      gate: { questionId: Q.otherDeductions, equals: true },
      field: 'otherDeductionsFrequency',
    }),
    addendumText({
      id: 'tx.deductions.other_types',
      promptKey: 'tx_q_other_deduction_types',
      gate: { questionId: Q.otherDeductions, equals: true },
      field: 'otherDeductionsTypes',
    }),
  ],
};

/**
 * Section 4, "Fill out this section only if the amount of money you get
 * changes or might change from month to month."
 *
 * The money screen already asks whether anyone's income changes during the
 * year, so that answer decides this section rather than a second question.
 */
const incomeTotalsSection: IntakeSection<Data> = {
  id: TX_SECTIONS.incomeTotals,
  titleKey: 'tx_section_income_totals',
  introKey: 'tx_section_income_totals_intro',
  appliesWhen: (data) =>
    appliesForHealthCoverage(data) &&
    data.questionnaire.income.incomeVariesDuringYear === true,
  questions: [
    {
      id: 'tx.income_totals.this_year',
      promptKey: 'tx_q_total_income_this_year',
      kind: 'money',
      ...addendumAnswer('totalIncomeThisYear', 'money'),
    },
    {
      id: 'tx.income_totals.next_year',
      promptKey: 'tx_q_total_income_next_year',
      helpKey: 'tx_q_total_income_next_year_help',
      kind: 'money',
      ...addendumAnswer('totalIncomeNextYear', 'money'),
    },
  ],
};

/** Section 5. Question 1 opens Appendix A, the list after this section. */
const jobCoverageSection: IntakeSection<Data> = {
  id: TX_SECTIONS.jobCoverage,
  titleKey: 'tx_section_job_coverage',
  appliesWhen: appliesForHealthCoverage,
  questions: [
    yesNo({
      id: Q.jobCoverage,
      promptKey: 'tx_q_job_coverage',
      helpKey: 'tx_q_job_coverage_help',
      accessor: questionnaireTri('health.employerCoverage.answer'),
    }),
    yesNo({
      id: Q.lostJobCoverage,
      promptKey: 'tx_q_lost_job_coverage',
      accessor: addendumAnswer('lostJobCoverage', 'yes_no'),
    }),
    addendumText({
      id: 'tx.coverage.lost_who',
      promptKey: 'tx_q_lost_job_coverage_who',
      gate: { questionId: Q.lostJobCoverage, equals: true },
      field: 'lostJobCoverageWho',
    }),
    {
      id: 'tx.coverage.lost_end_date',
      promptKey: 'tx_q_lost_job_coverage_end_date',
      kind: 'date',
      gate: { questionId: Q.lostJobCoverage, equals: true },
      ...addendumAnswer('lostJobCoverageEndDate', 'date'),
    },
    {
      id: Q.lostJobCoverageReason,
      promptKey: 'tx_q_lost_job_coverage_reason',
      kind: 'choice',
      gate: { questionId: Q.lostJobCoverage, equals: true },
      // In the order the printed checkboxes read, column by column.
      options: [
        { value: 'parent_job_ended', labelKey: 'tx_opt_lost_parent_job_ended' },
        { value: 'parent_cobra_or_ers_ended', labelKey: 'tx_opt_lost_parent_cobra' },
        { value: 'parent_marital_status_changed', labelKey: 'tx_opt_lost_parent_marital_status' },
        { value: 'chip_other_state_ended', labelKey: 'tx_opt_lost_chip_other_state' },
        { value: 'medicaid_other_state_ended', labelKey: 'tx_opt_lost_medicaid_other_state' },
        { value: 'private_coverage_ended', labelKey: 'tx_opt_lost_private_coverage' },
        { value: 'parent_died', labelKey: 'tx_opt_lost_parent_died' },
        { value: 'child_special_health_care_needs', labelKey: 'tx_opt_lost_special_needs' },
        { value: 'medicaid_ended', labelKey: 'tx_opt_lost_medicaid_ended' },
        { value: 'other', labelKey: 'tx_opt_lost_other' },
      ],
      ...addendumAnswer('lostJobCoverageReason', 'choice'),
    },
    addendumText({
      id: 'tx.coverage.lost_other_reason',
      promptKey: 'tx_q_lost_job_coverage_other_reason',
      gate: { questionId: Q.lostJobCoverage, equals: true },
      appliesWhen: (data) => addendumOf(data).lostJobCoverageReason === 'other',
      field: 'lostJobCoverageOtherReason',
    }),
  ],
};

/** Section 3's questions about children, for a household that has one. */
const healthChildrenSection: IntakeSection<Data> = {
  id: TX_SECTIONS.healthChildren,
  titleKey: 'tx_section_health_children',
  appliesWhen: (data) =>
    appliesForHealthCoverage(data) && householdHasPossibleChild(data),
  questions: [
    yesNo({
      id: Q.migrantChild,
      promptKey: 'tx_q_migrant_child',
      accessor: addendumAnswer('childTravelsWithMigrantWorker', 'yes_no'),
    }),
    addendumText({
      id: 'tx.health.migrant_child_names',
      promptKey: 'tx_q_migrant_child_names',
      gate: { questionId: Q.migrantChild, equals: true },
      field: 'migrantChildNames',
    }),
    yesNo({
      id: Q.specialNeedsChild,
      promptKey: 'tx_q_special_needs_child',
      helpKey: 'tx_q_special_needs_child_help',
      accessor: addendumAnswer('childInSpecialHealthCareNeeds', 'yes_no'),
    }),
    addendumText({
      id: 'tx.health.special_needs_who',
      promptKey: 'tx_q_special_needs_who',
      gate: { questionId: Q.specialNeedsChild, equals: true },
      field: 'specialHealthCareNeedsWho',
    }),
    // The California flow's own answer, so one key serves both forms.
    yesNo({
      id: Q.absentParent,
      promptKey: 'tx_q_absent_parent',
      accessor: questionnaireTri('circumstances.absentParents.answer'),
    }),
  ],
};

/** Section 3's questions about anyone applying. */
const healthPeopleSection: IntakeSection<Data> = {
  id: TX_SECTIONS.healthPeople,
  titleKey: 'tx_section_health_people',
  appliesWhen: appliesForHealthCoverage,
  questions: [
    /*
     * Asked only after "Was anyone in your home ever in foster care?" says
     * Yes. A No there answers this too; the field plan says so on the form.
     */
    yesNo({
      id: Q.fosterCareAt18,
      promptKey: 'tx_q_foster_care_at_18',
      gate: { questionId: Q.fosterCare, equals: true },
      accessor: addendumAnswer('fosterCareAt18OrOlder', 'yes_no'),
    }),
    addendumText({
      id: 'tx.health.foster_care_who',
      promptKey: 'tx_q_foster_care_who',
      gate: { questionId: Q.fosterCareAt18, equals: true },
      field: 'fosterCareWho',
    }),
    addendumText({
      id: 'tx.health.foster_care_state',
      promptKey: 'tx_q_foster_care_state',
      gate: { questionId: Q.fosterCareAt18, equals: true },
      field: 'fosterCareState',
    }),
    // The shared answer Appendix B hangs from; its list follows this section.
    yesNo({
      id: Q.americanIndian,
      promptKey: 'tx_q_american_indian',
      helpKey: 'tx_q_american_indian_help',
      accessor: questionnaireTri('health.americanIndianOrAlaskaNative'),
    }),
  ],
};

/** Section 3, questions 6 and 7: Healthy Texas Women, for women 15 to 44. */
const htwSection: IntakeSection<Data> = {
  id: TX_SECTIONS.htw,
  titleKey: 'tx_section_htw',
  introKey: 'tx_section_htw_intro',
  appliesWhen: (data) =>
    appliesForHealthCoverage(data) && householdHasPossibleHtwCandidate(data),
  questions: [
    yesNo({
      id: Q.htwConfidential,
      promptKey: 'tx_q_htw_confidential',
      helpKey: 'tx_q_htw_confidential_help',
      accessor: addendumAnswer('wantsConfidentialHtwContact', 'yes_no'),
    }),
    {
      id: 'tx.htw.street',
      promptKey: 'field_street_address',
      kind: 'text',
      gate: { questionId: Q.htwConfidential, equals: true },
      normalize: normalizeWhitespace,
      validate: (value) => (text(value) ? checkStreetAddress(text(value)) : null),
      ...addendumAnswer('confidentialStreet', 'text'),
    },
    {
      id: 'tx.htw.city',
      promptKey: 'field_city',
      kind: 'text',
      gate: { questionId: Q.htwConfidential, equals: true },
      normalize: normalizeWhitespace,
      validate: (value) => (text(value) ? checkCity(text(value)) : null),
      ...addendumAnswer('confidentialCity', 'text'),
    },
    {
      id: 'tx.htw.state',
      promptKey: 'field_state',
      kind: 'text',
      gate: { questionId: Q.htwConfidential, equals: true },
      normalize: (raw) => raw.trim().toUpperCase().slice(0, 2),
      ...addendumAnswer('confidentialState', 'text'),
    },
    {
      id: 'tx.htw.zip',
      promptKey: 'field_zip_code',
      kind: 'text',
      gate: { questionId: Q.htwConfidential, equals: true },
      normalize: normalizeZipCode,
      validate: (value) => (text(value) ? checkZipCode(text(value)) : null),
      ...addendumAnswer('confidentialZipCode', 'text'),
    },
    {
      id: 'tx.htw.phone',
      promptKey: 'field_phone_number',
      kind: 'tel',
      gate: { questionId: Q.htwConfidential, equals: true },
      normalize: normalizeUsPhone,
      validate: (value) => (text(value) ? checkUsPhone(text(value)) : null),
      ...addendumAnswer('confidentialPhone', 'text'),
    },
    yesNo({
      id: Q.htwDeclines,
      promptKey: 'tx_q_htw_declines',
      helpKey: 'tx_q_htw_declines_help',
      accessor: addendumAnswer('declinesHtwScreening', 'yes_no'),
    }),
  ],
};

/** Section 6, "Read and sign this form" — everything but the signature. */
const healthFinalSection: IntakeSection<Data> = {
  id: TX_SECTIONS.healthFinal,
  titleKey: 'tx_section_health_final',
  appliesWhen: appliesForHealthCoverage,
  questions: [
    yesNo({
      id: Q.incarcerated,
      promptKey: 'tx_q_incarcerated',
      accessor: addendumAnswer('incarcerated', 'yes_no'),
    }),
    addendumText({
      id: 'tx.final.incarcerated_who',
      promptKey: 'tx_q_incarcerated_who',
      gate: { questionId: Q.incarcerated, equals: true },
      field: 'incarceratedWho',
    }),
    {
      id: 'tx.final.renewal_years',
      promptKey: 'tx_q_renewal_years',
      helpKey: 'tx_q_renewal_years_help',
      kind: 'choice',
      options: [
        { value: 'five', labelKey: 'tx_opt_renewal_five' },
        { value: 'four', labelKey: 'tx_opt_renewal_four' },
        { value: 'three', labelKey: 'tx_opt_renewal_three' },
        { value: 'two', labelKey: 'tx_opt_renewal_two' },
        { value: 'one', labelKey: 'tx_opt_renewal_one' },
        { value: 'none', labelKey: 'tx_opt_renewal_none' },
      ],
      ...addendumAnswer('renewalYears', 'choice'),
    },
  ],
};

/**
 * Appendix C's second block, for a certified application counselor, navigator,
 * agent or broker filling the application in for someone else. Asked once; a
 * household filling in its own application answers No and moves on.
 */
const assisterSection: IntakeSection<Data> = {
  id: TX_SECTIONS.assister,
  titleKey: 'tx_section_assister',
  appliesWhen: appliesForHealthCoverage,
  questions: [
    yesNo({
      id: Q.assister,
      promptKey: 'tx_q_assister',
      accessor: addendumAnswer('completedByAssister', 'yes_no'),
    }),
    {
      id: 'tx.assister.start_date',
      promptKey: 'tx_q_assister_start_date',
      kind: 'date',
      gate: { questionId: Q.assister, equals: true },
      ...addendumAnswer('assisterStartDate', 'date'),
    },
    addendumText({
      id: 'tx.assister.name',
      promptKey: 'tx_q_assister_name',
      gate: { questionId: Q.assister, equals: true },
      field: 'assisterName',
    }),
    addendumText({
      id: 'tx.assister.organization',
      promptKey: 'tx_q_assister_organization',
      gate: { questionId: Q.assister, equals: true },
      field: 'assisterOrganization',
    }),
    addendumText({
      id: 'tx.assister.organization_id',
      promptKey: 'tx_q_assister_organization_id',
      gate: { questionId: Q.assister, equals: true },
      field: 'assisterOrganizationId',
    }),
  ],
};

const TAX_SECTIONS: readonly IntakeSection<Data>[] = Array.from(
  { length: TAX_PERSON_SLOTS },
  (_, slot) => taxSection(slot),
);

export const TX_H1010_INTAKE: IntakeForm<Data> = {
  formId: 'TX_H1010',
  sections: [
    mailingSection,
    homeSection,
    householdSection,
    moneySection,
    billsSection,
    ownSection,
    urgentSection,
    situationSection,
    ...TAX_SECTIONS,
    deductionsSection,
    incomeTotalsSection,
    jobCoverageSection,
    healthChildrenSection,
    healthPeopleSection,
    htwSection,
    healthFinalSection,
    helperSection,
    assisterSection,
  ],
};

/** The gate ids other modules need to name. */
export const TX_QUESTION_IDS = Q;

// ---------------------------------------------------------------------------
// Repeating records
// ---------------------------------------------------------------------------

/**
 * A list of records the applicant adds rows to, and the printed table it feeds.
 *
 * `printedRows` is a property of the paper, not of the household. A form with
 * three job rows and a fourth job has to say so before it is handed in, which is
 * what the mapping layer's overflow report does — this is where the UI learns
 * the same number so it can warn at the point of typing rather than afterwards.
 */
export interface RecordList<TRecord> {
  id: string;
  /**
   * A field whose options are the people in this household.
   *
   * Named here so the renderer can fill them without knowing what a household
   * is, and so nothing has to guess which field means "whose is this".
   */
  peopleField?: string;
  /**
   * Further fields whose options are the household, beyond `peopleField`.
   *
   * Appendix A prints three "Name:" lines for anyone else the same job would
   * cover. Those are people too, but not the person the row is about, so they
   * are not `peopleField`.
   */
  peopleFields?: readonly string[];
  /**
   * Whether a field is asked for this row, for follow-ups inside a row:
   * "If yes, tribe name". Absent means every field is asked, which is what
   * every list before the Medicaid addendum needs.
   */
  isFieldAsked?: (fieldId: string, record: TRecord, data: Data) => boolean;
  titleKey: string;
  introKey: string;
  addLabelKey: string;
  emptyKey: string;
  /** Only editable when this question is answered this way. */
  gate?: { questionId: string; equals: boolean };
  read: (data: Data) => readonly TRecord[];
  write: (data: Data, records: readonly TRecord[]) => Data;
  blank: (index: number) => TRecord;
  fields: readonly IntakeQuestion<TRecord>[];
  printedRows: number;
}

function entriesOf<TRecord>(path: string) {
  return {
    read: (data: Data): readonly TRecord[] =>
      (readPath(data.questionnaire, path) as TRecord[] | undefined) ?? [],
    write: (data: Data, records: readonly TRecord[]): Data => ({
      ...data,
      questionnaire: writePath(data.questionnaire, path, [...records]),
    }),
  };
}

/** A record field, with the boilerplate of reading and writing one key. */
function recordField<TRecord>(
  key: keyof TRecord & string,
  spec: Omit<IntakeQuestion<TRecord>, 'id' | 'read' | 'write'> & { id?: string },
): IntakeQuestion<TRecord> {
  return {
    id: spec.id ?? key,
    ...spec,
    read: (record) => record[key] as AnswerValue,
    write: (record, value) => ({
      ...record,
      [key]:
        spec.kind === 'money' || spec.kind === 'integer'
          ? value === undefined || value === ''
            ? undefined
            : Number(value)
          : spec.kind === 'yes_no'
            ? tri(value)
            : text(value),
    }),
  };
}

/**
 * The household roster.
 *
 * The applicant is not a row: H1010 lists them in "About you" and everyone else
 * in the table beneath, which is also how the canonical model is shaped
 * (`householdMembers` excludes the applicant, and `household.size` is derived
 * from its length).
 *
 * Sex and citizenship are written to the adult or the child detail record
 * depending on the person's date of birth, because that is where the canonical
 * model keeps them — the printed Texas table has one column for everyone, which
 * the mapping layer resolves with an alternate key rather than by making the
 * intake write both and hope.
 */
export const TX_HOUSEHOLD_ROSTER = {
  id: 'tx-roster',
  titleKey: 'tx_roster_title',
  introKey: 'tx_roster_intro',
  addLabelKey: 'tx_roster_add',
  emptyKey: 'tx_roster_empty',
  /*
   * Four, because that is what HHSC's form prints: Person 2 through Person 5,
   * two per page on printed pages 4 and 5.
   *
   * This said six, which was the intake's own capacity rather than the form's.
   * The overflow warning therefore appeared one person too late — a household
   * of six was told everything fitted, and two people would have gone missing
   * from the printed table with nothing to say so. Kept in step with
   * `h1010_official.OFFICIAL_PERSON_ROWS`, which is what reports the overflow
   * on the review sheet.
   */
  printedRows: 4,
} as const;

/**
 * The per-person answers H1010 asks in every printed person block.
 *
 * Stored on the adult or the child record according to the person's age,
 * because the canonical model splits a person's details that way for
 * California — which prints two household tables. H1010 prints one, so the
 * official mapping reads either through `alternate_keys`.
 *
 * `maritalStatus` is adult-only: it exists on `AdultApplicationDetails` and
 * the intake asks it from 16, so a child's record has nowhere to put it and
 * nothing to put there.
 */
export type MemberDetailKey =
  | 'sex'
  | 'citizenOrNational'
  | 'maritalStatus'
  | 'attendsSchool'
  | 'fullTimeStudent'
  | 'livesInTexas'
  | 'plansToStayInTexas';

/** Details stored as a three-state answer rather than a value. */
const TRI_STATE_DETAILS: ReadonlySet<string> = new Set([
  'citizenOrNational',
  'attendsSchool',
  'fullTimeStudent',
  'livesInTexas',
  'plansToStayInTexas',
]);

/** Read a per-person detail from whichever record the person's age puts it in. */
export function memberDetail(
  member: HouseholdMember,
  key: MemberDetailKey,
): AnswerValue {
  // Adult-only, so read it there whatever the age says. A person whose date of
  // birth was corrected downward keeps the answer rather than losing it, and
  // the intake stops asking.
  if (key === 'maritalStatus') {
    return member.adultDetails?.maritalStatus;
  }

  const record =
    tableForMember(member) === 'child' ? member.childDetails : member.adultDetails;

  return record?.[key];
}

/**
 * Which Texas benefits this person is applying for.
 *
 * Its own reader rather than a `memberDetail` key, because `AnswerValue` is
 * the intake model's type for *one* answer — a string, a number, a yes/no —
 * and widening it to hold a list would let any question return an array.
 */
export function memberPrograms(
  member: HouseholdMember,
): readonly BenefitProgramId[] {
  const record =
    tableForMember(member) === 'child'
      ? member.childDetails
      : member.adultDetails;

  return record?.texasPrograms ?? [];
}

/** Replace this person's programme selection. */
export function writeMemberPrograms(
  member: HouseholdMember,
  programs: readonly BenefitProgramId[],
): HouseholdMember {
  const next = [...programs];

  if (tableForMember(member) === 'child') {
    return {
      ...member,
      childDetails: {
        ...(member.childDetails ?? {
          applyingFor: [],
          placeOfBirth: '',
          parentStatus: {},
        }),
        texasPrograms: next,
      },
    };
  }

  return {
    ...member,
    adultDetails: {
      ...(member.adultDetails ?? { applyingFor: [] }),
      texasPrograms: next,
    },
  };
}

/** Write a per-person detail into the record the person's age selects. */
export function writeMemberDetail(
  member: HouseholdMember,
  key: MemberDetailKey,
  value: AnswerValue,
): HouseholdMember {
  if (key === 'maritalStatus') {
    return {
      ...member,
      adultDetails: {
        ...(member.adultDetails ?? { applyingFor: [] }),
        maritalStatus: value as never,
      },
    };
  }

  const isChild = tableForMember(member) === 'child';

  if (isChild) {
    const childDetails = member.childDetails ?? {
      applyingFor: [],
      placeOfBirth: '',
      parentStatus: {},
    };

    return {
      ...member,
      childDetails: {
        ...childDetails,
        [key]: TRI_STATE_DETAILS.has(key) ? tri(value) : (value as never),
      },
    };
  }

  const adultDetails = member.adultDetails ?? { applyingFor: [] };

  return {
    ...member,
    adultDetails: {
      ...adultDetails,
      [key]: TRI_STATE_DETAILS.has(key) ? tri(value) : (value as never),
    },
  };
}

/**
 * The benefits one person can be applying for, in the form's own order.
 *
 * Exactly the four programmes H1010 covers and this product supports. Each
 * carries a one-line description because "CHIP" means nothing to someone who
 * has not applied before, and a person choosing for their child needs to know
 * which of two health programmes to pick.
 *
 * The descriptions say what a programme *helps with*, never who qualifies:
 * eligibility is HHSC's to decide, and a description that reads as a promise
 * is worse than none.
 */
export const PERSON_PROGRAM_CHOICES: readonly {
  program: BenefitProgramId;
  nameKey: string;
  summaryKey: string;
}[] = [
  {
    program: 'tx_snap',
    nameKey: 'tx_program_snap_name',
    summaryKey: 'tx_program_snap_summary',
  },
  {
    program: 'tx_medicaid',
    nameKey: 'tx_program_medicaid_name',
    summaryKey: 'tx_program_medicaid_summary',
  },
  {
    program: 'tx_chip',
    nameKey: 'tx_program_chip_name',
    summaryKey: 'tx_program_chip_summary',
  },
  {
    program: 'tx_tanf',
    nameKey: 'tx_program_tanf_name',
    summaryKey: 'tx_program_tanf_summary',
  },
];

/** The relationship options a Texas roster row offers. */
export { RELATIONSHIP_LABEL_KEYS };

export const TX_JOBS: RecordList<EarnedIncomeEntry> = {
  id: 'tx-jobs',
  peopleField: 'memberId',
  titleKey: 'tx_jobs_title',
  introKey: 'tx_jobs_intro',
  addLabelKey: 'tx_jobs_add',
  emptyKey: 'tx_jobs_empty',
  gate: { questionId: Q.hasJob, equals: true },
  printedRows: 3,
  ...entriesOf<EarnedIncomeEntry>('income.earned.entries'),
  blank: (index) => ({
    id: `job-${index}-${Date.now()}`,
    memberId: 'applicant',
    employerName: '',
    employerAddress: '',
    employerPhone: '',
    startDate: '',
    payFrequency: undefined,
  }),
  fields: [
    recordField<EarnedIncomeEntry>('memberId', {
      promptKey: 'tx_job_who',
      kind: 'choice',
      required: true,
      /*
       * Filled in at render time from the applicant plus the roster, which is
       * why the declared list is empty: who lives in this household is not a
       * property of the form. `person_name` is derived from this id by the
       * mapper, so the printed "Who works there" column follows a roster edit
       * rather than going stale.
       */
      options: [],
    }),
    recordField<EarnedIncomeEntry>('employerName', {
      promptKey: 'tx_job_employer',
      kind: 'text',
      required: true,
      normalize: normalizeWhitespace,
    }),
    recordField<EarnedIncomeEntry>('employerAddress', {
      promptKey: 'tx_job_employer_address',
      helpKey: 'tx_job_employer_address_help',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<EarnedIncomeEntry>('grossReceivedThisMonth', {
      promptKey: 'tx_job_gross_this_month',
      helpKey: 'tx_job_gross_this_month_help',
      kind: 'money',
      required: true,
    }),
    recordField<EarnedIncomeEntry>('payFrequency', {
      promptKey: 'tx_job_pay_frequency',
      kind: 'choice',
      options: [
        { value: 'weekly', labelKey: 'qopt_weekly' },
        { value: 'every_two_weeks', labelKey: 'qopt_every_two_weeks' },
        { value: 'twice_a_month', labelKey: 'qopt_twice_a_month' },
        { value: 'monthly', labelKey: 'qopt_monthly' },
        { value: 'irregular', labelKey: 'qopt_irregular' },
      ],
    }),
    recordField<EarnedIncomeEntry>('hoursPerWeek', {
      promptKey: 'tx_job_hours',
      kind: 'integer',
    }),
  ],
};

export const TX_OTHER_INCOME: RecordList<UnearnedIncomeEntry> = {
  id: 'tx-other-income',
  peopleField: 'memberId',
  titleKey: 'tx_other_income_title',
  introKey: 'tx_other_income_intro',
  addLabelKey: 'tx_other_income_add',
  emptyKey: 'tx_other_income_empty',
  gate: { questionId: Q.otherIncome, equals: true },
  printedRows: 3,
  ...entriesOf<UnearnedIncomeEntry>('income.unearned.entries'),
  blank: (index) => ({
    id: `unearned-${index}-${Date.now()}`,
    memberId: 'applicant',
    source: '',
  }),
  fields: [
    recordField<UnearnedIncomeEntry>('memberId', {
      promptKey: 'tx_other_income_who',
      kind: 'choice',
      required: true,
      // See the jobs table: supplied at render time from the household.
      options: [],
    }),
    recordField<UnearnedIncomeEntry>('source', {
      promptKey: 'tx_other_income_source',
      helpKey: 'tx_other_income_source_help',
      kind: 'text',
      required: true,
      normalize: normalizeWhitespace,
    }),
    recordField<UnearnedIncomeEntry>('reportedAmount', {
      promptKey: 'tx_other_income_amount',
      kind: 'money',
      required: true,
    }),
    recordField<UnearnedIncomeEntry>('reportedFrequency', {
      promptKey: 'tx_other_income_frequency',
      kind: 'choice',
      required: true,
      options: [
        { value: 'weekly', labelKey: 'qopt_weekly' },
        { value: 'every_two_weeks', labelKey: 'qopt_every_two_weeks' },
        { value: 'twice_a_month', labelKey: 'qopt_twice_a_month' },
        { value: 'monthly', labelKey: 'qopt_monthly' },
        { value: 'irregular', labelKey: 'qopt_irregular' },
      ],
    }),
  ],
};

export const TX_BILLS: RecordList<HouseholdExpenseEntry> = {
  id: 'tx-bills',
  titleKey: 'tx_bills_title',
  introKey: 'tx_bills_intro',
  addLabelKey: 'tx_bills_add',
  emptyKey: 'tx_bills_empty',
  gate: { questionId: Q.hasBills, equals: true },
  printedRows: 5,
  ...entriesOf<HouseholdExpenseEntry>('expenses.household.entries'),
  blank: (index) => ({
    id: `bill-${index}-${Date.now()}`,
    kind: 'rent_or_mortgage',
    description: '',
  }),
  fields: [
    recordField<HouseholdExpenseEntry>('kind', {
      promptKey: 'tx_bill_kind',
      kind: 'choice',
      required: true,
      options: [
        { value: 'rent_or_mortgage', labelKey: 'qopt_rent_or_mortgage' },
        { value: 'property_tax', labelKey: 'qopt_property_tax' },
        { value: 'home_insurance', labelKey: 'qopt_home_insurance' },
        { value: 'electricity', labelKey: 'qopt_electricity' },
        { value: 'gas', labelKey: 'qopt_gas' },
        { value: 'water', labelKey: 'qopt_water' },
        { value: 'trash', labelKey: 'qopt_trash' },
        { value: 'telephone', labelKey: 'qopt_telephone' },
        { value: 'other', labelKey: 'qopt_other' },
      ],
    }),
    recordField<HouseholdExpenseEntry>('amountMonthly', {
      promptKey: 'tx_bill_amount',
      kind: 'money',
      required: true,
    }),
    recordField<HouseholdExpenseEntry>('description', {
      promptKey: 'tx_bill_description',
      helpKey: 'tx_bill_description_help',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
  ],
};

/**
 * The authorized representative.
 *
 * One printed block, so one record. It is a list in the canonical model
 * because California's Appendix C can name more than one, and reusing that
 * shape rather than adding a Texas-only field is the whole point: the mapping
 * layer reads `household.authorized_representative.0.*` for both states.
 */
export const TX_REPRESENTATIVE: RecordList<AuthorizedRepresentative> = {
  id: 'tx-representative',
  titleKey: 'tx_helper_details_title',
  introKey: 'tx_helper_details_intro',
  addLabelKey: 'tx_helper_add',
  emptyKey: 'tx_helper_empty',
  gate: { questionId: Q.hasHelper, equals: true },
  printedRows: 1,
  ...entriesOf<AuthorizedRepresentative>(
    'circumstances.authorizedRepresentative.entries',
  ),
  blank: () => ({
    name: '',
    organization: '',
    phone: '',
    street: '',
    apartment: '',
    city: '',
    state: 'TX',
    zipCode: '',
    forCalFresh: true,
    forHealthCoverage: true,
  }),
  fields: [
    recordField<AuthorizedRepresentative>('name', {
      promptKey: 'tx_helper_name',
      kind: 'text',
      required: true,
      normalize: normalizeWhitespace,
    }),
    recordField<AuthorizedRepresentative>('organization', {
      promptKey: 'tx_helper_organization',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    // Appendix C item 9, beside the organization's name.
    recordField<AuthorizedRepresentative>('organizationId', {
      promptKey: 'tx_helper_organization_id',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<AuthorizedRepresentative>('phone', {
      promptKey: 'field_phone_number',
      kind: 'tel',
      normalize: normalizeUsPhone,
      validate: (value) => checkUsPhone(text(value)),
    }),
    recordField<AuthorizedRepresentative>('street', {
      promptKey: 'field_street_address',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    // Appendix C item 3, "Apartment or suite number". Already on the record.
    recordField<AuthorizedRepresentative>('apartment', {
      promptKey: 'field_apartment',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<AuthorizedRepresentative>('city', {
      promptKey: 'field_city',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<AuthorizedRepresentative>('state', {
      promptKey: 'field_state',
      kind: 'text',
      normalize: (raw) => raw.trim().toUpperCase().slice(0, 2),
    }),
    recordField<AuthorizedRepresentative>('zipCode', {
      promptKey: 'field_zip_code',
      kind: 'text',
      normalize: normalizeZipCode,
      validate: (value) => checkZipCode(text(value)),
    }),
  ],
};

/**
 * The people an income row can belong to: the applicant, then the roster.
 *
 * `APPLICANT_MEMBER_ID` is the canonical synthetic id the questionnaire model
 * already uses for the primary applicant, so a Texas job on the applicant is
 * indistinguishable from a California one and the mapper resolves the printed
 * name the same way for both.
 */
export function householdOptions(
  data: Data,
): readonly { value: string; labelKey: string; label: string }[] {
  const applicantName = [data.applicant.firstName, data.applicant.lastName]
    .filter((part) => part.trim().length > 0)
    .join(' ');

  return [
    {
      value: 'applicant',
      labelKey: 'tx_person_you',
      label: applicantName,
    },
    ...data.householdMembers.map((member) => ({
      value: member.id,
      labelKey: '',
      label: [member.firstName, member.lastName]
        .filter((part) => part.trim().length > 0)
        .join(' '),
    })),
  ];
}


// ---------------------------------------------------------------------------
// Medicaid / CHIP addendum: the printed tables
// ---------------------------------------------------------------------------

/** A gateway section's entries, marking the section answered when written. */
function gatewayEntriesOf<TRecord>(path: string) {
  return {
    read: (data: Data): readonly TRecord[] =>
      (readPath(data.questionnaire, `${path}.entries`) as TRecord[] | undefined) ?? [],
    write: (data: Data, records: readonly TRecord[]): Data => ({
      ...data,
      questionnaire: writePath(data.questionnaire, path, {
        answer: true,
        entries: [...records],
      }),
    }),
  };
}

/** The six premium frequencies Appendix A prints, in its order. */
const PREMIUM_FREQUENCY_OPTIONS = [
  { value: 'weekly', labelKey: 'qopt_weekly' },
  { value: 'bi_weekly', labelKey: 'qopt_every_two_weeks' },
  { value: 'twice_a_month', labelKey: 'qopt_twice_a_month' },
  { value: 'monthly', labelKey: 'qopt_monthly' },
  { value: 'quarterly', labelKey: 'tx_opt_quarterly' },
  { value: 'yearly', labelKey: 'tx_opt_yearly' },
] as const;

/** One of Appendix A's three "anyone else eligible" name lines. */
function otherEligibleField(slot: number): IntakeQuestion<EmployerCoverageEntry> {
  return {
    id: `otherEligible${slot}`,
    promptKey: 'tx_employer_other_eligible',
    kind: 'choice',
    // Supplied at render time from the household, like `memberId`.
    options: [],
    read: (record) => record.otherEligibleMemberIds?.[slot] ?? '',
    write: (record, value) => {
      const ids = [...(record.otherEligibleMemberIds ?? [])];

      ids[slot] = text(value);

      return {
        ...record,
        // Kept compact: an emptied middle line must not leave a hole that
        // shifts the names after it onto the wrong printed line.
        otherEligibleMemberIds: ids.filter((id) => id && id.trim()),
      };
    },
  };
}

/**
 * Appendix A, "Health Coverage from Jobs": one printed page per job that
 * offers coverage. The shared `health.employerCoverage` record, so the field
 * plan's existing `appendices.employer_coverage.*` keys carry it.
 *
 * Item 2, the employee's Social Security number, is not asked: the model has
 * nowhere to store one.
 */
export const TX_EMPLOYER_COVERAGE: RecordList<EmployerCoverageEntry> = {
  id: 'tx-employer-coverage',
  peopleField: 'memberId',
  peopleFields: ['otherEligible0', 'otherEligible1', 'otherEligible2'],
  titleKey: 'tx_employer_title',
  introKey: 'tx_employer_intro',
  addLabelKey: 'tx_employer_add',
  emptyKey: 'tx_employer_empty',
  gate: { questionId: Q.jobCoverage, equals: true },
  printedRows: 1,
  ...gatewayEntriesOf<EmployerCoverageEntry>('health.employerCoverage'),
  blank: (index) => ({
    id: `employer-coverage-${index}-${Date.now()}`,
    memberId: 'applicant',
    employerName: '',
    employerPhone: '',
    offersCoverage: true,
    eligibleNowOrSoon: undefined,
    employerIdentificationNumber: '',
    employerAddress: '',
    employerCity: '',
    employerState: 'TX',
    employerZipCode: '',
    employerEmail: '',
    waitingPeriodEnrollmentDate: '',
    otherEligibleMemberIds: [],
    planChangeDate: '',
  }),
  /*
   * "No (Stop here)" after item 13; the plan questions are for someone who
   * can get the coverage now or within three months. The changed premium is
   * for the change that alters it, and a date for any change.
   */
  isFieldAsked: (fieldId, record) => {
    const eligible = record.eligibleNowOrSoon === true;

    switch (fieldId) {
      case 'waitingPeriodEnrollmentDate':
      case 'otherEligible0':
      case 'otherEligible1':
      case 'otherEligible2':
      case 'meetsMinimumValueStandard':
      case 'lowestCostPremium':
      case 'lowestCostPremiumFrequency':
      case 'planChange':
        return eligible;
      case 'changedPremium':
      case 'changedPremiumFrequency':
        return eligible && record.planChange === 'will_start_offering_or_change_premium';
      case 'planChangeDate':
        return eligible && record.planChange !== undefined;
      default:
        return true;
    }
  },
  fields: [
    recordField<EmployerCoverageEntry>('memberId', {
      promptKey: 'tx_employer_employee',
      kind: 'choice',
      required: true,
      options: [],
    }),
    recordField<EmployerCoverageEntry>('employerName', {
      promptKey: 'tx_job_employer',
      kind: 'text',
      required: true,
      normalize: normalizeWhitespace,
    }),
    recordField<EmployerCoverageEntry>('employerIdentificationNumber', {
      promptKey: 'tx_employer_ein',
      helpKey: 'tx_employer_ein_help',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<EmployerCoverageEntry>('employerAddress', {
      promptKey: 'field_street_address',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<EmployerCoverageEntry>('employerCity', {
      promptKey: 'field_city',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<EmployerCoverageEntry>('employerState', {
      promptKey: 'field_state',
      kind: 'text',
      normalize: (raw) => raw.trim().toUpperCase().slice(0, 2),
    }),
    recordField<EmployerCoverageEntry>('employerZipCode', {
      promptKey: 'field_zip_code',
      kind: 'text',
      normalize: normalizeZipCode,
      validate: (value) => (text(value) ? checkZipCode(text(value)) : null),
    }),
    recordField<EmployerCoverageEntry>('employerPhone', {
      promptKey: 'tx_employer_phone',
      kind: 'tel',
      normalize: normalizeUsPhone,
      validate: (value) => (text(value) ? checkUsPhone(text(value)) : null),
    }),
    recordField<EmployerCoverageEntry>('contactName', {
      promptKey: 'tx_employer_contact',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<EmployerCoverageEntry>('contactPhone', {
      promptKey: 'tx_employer_contact_phone',
      kind: 'tel',
      normalize: normalizeUsPhone,
      validate: (value) => (text(value) ? checkUsPhone(text(value)) : null),
    }),
    recordField<EmployerCoverageEntry>('employerEmail', {
      promptKey: 'tx_employer_email',
      kind: 'email',
      normalize: normalizeWhitespace,
    }),
    recordField<EmployerCoverageEntry>('eligibleNowOrSoon', {
      promptKey: 'tx_employer_eligible',
      kind: 'yes_no',
    }),
    recordField<EmployerCoverageEntry>('waitingPeriodEnrollmentDate', {
      promptKey: 'tx_employer_waiting_period',
      kind: 'date',
    }),
    otherEligibleField(0),
    otherEligibleField(1),
    otherEligibleField(2),
    recordField<EmployerCoverageEntry>('meetsMinimumValueStandard', {
      promptKey: 'tx_employer_minimum_value',
      helpKey: 'tx_employer_minimum_value_help',
      kind: 'yes_no',
    }),
    recordField<EmployerCoverageEntry>('lowestCostPremium', {
      promptKey: 'tx_employer_premium',
      helpKey: 'tx_employer_premium_help',
      kind: 'money',
    }),
    recordField<EmployerCoverageEntry>('lowestCostPremiumFrequency', {
      promptKey: 'tx_employer_premium_frequency',
      kind: 'choice',
      options: PREMIUM_FREQUENCY_OPTIONS,
    }),
    recordField<EmployerCoverageEntry>('planChange', {
      promptKey: 'tx_employer_plan_change',
      helpKey: 'tx_employer_plan_change_help',
      kind: 'choice',
      // The two changes Appendix A prints. "No change" has no box, so it is
      // not offered: leaving the question blank says the same thing.
      options: [
        { value: 'will_no_longer_provide', labelKey: 'tx_opt_plan_change_stop' },
        {
          value: 'will_start_offering_or_change_premium',
          labelKey: 'tx_opt_plan_change_premium',
        },
      ],
    }),
    recordField<EmployerCoverageEntry>('changedPremium', {
      promptKey: 'tx_employer_changed_premium',
      kind: 'money',
    }),
    recordField<EmployerCoverageEntry>('changedPremiumFrequency', {
      promptKey: 'tx_employer_premium_frequency',
      kind: 'choice',
      options: PREMIUM_FREQUENCY_OPTIONS,
    }),
    recordField<EmployerCoverageEntry>('planChangeDate', {
      promptKey: 'tx_employer_plan_change_date',
      kind: 'date',
    }),
  ],
};

/**
 * Appendix B, "American Indian or Alaska Native Family Member": two printed
 * person columns. The shared `appendices.tribalMembership` record.
 */
export const TX_TRIBAL_MEMBERS: RecordList<TribalMembershipEntry> = {
  id: 'tx-tribal-members',
  peopleField: 'memberId',
  titleKey: 'tx_tribal_title',
  introKey: 'tx_tribal_intro',
  addLabelKey: 'tx_tribal_add',
  emptyKey: 'tx_tribal_empty',
  gate: { questionId: Q.americanIndian, equals: true },
  printedRows: 2,
  ...gatewayEntriesOf<TribalMembershipEntry>('appendices.tribalMembership'),
  blank: (index) => ({
    id: `tribal-${index}-${Date.now()}`,
    memberId: 'applicant',
    tribeName: '',
    tribalIncomeFrequency: '',
  }),
  /*
   * Item 2's tribe name is for a Yes; item 3's follow-up is for a No — "If no,
   * is this person eligible to get services…". Item 4's amount and how often
   * are for someone who has that money.
   */
  isFieldAsked: (fieldId, record) => {
    switch (fieldId) {
      case 'tribeName':
        return record.memberOfFederallyRecognizedTribe === true;
      case 'eligibleForIndianHealthService':
        return record.hasReceivedIndianHealthService === false;
      case 'tribalIncomeAmount':
      case 'tribalIncomeFrequency':
        return record.hasExcludableTribalIncome === true;
      default:
        return true;
    }
  },
  fields: [
    recordField<TribalMembershipEntry>('memberId', {
      promptKey: 'tx_tribal_who',
      kind: 'choice',
      required: true,
      options: [],
    }),
    recordField<TribalMembershipEntry>('memberOfFederallyRecognizedTribe', {
      promptKey: 'tx_tribal_member_of_tribe',
      kind: 'yes_no',
    }),
    recordField<TribalMembershipEntry>('tribeName', {
      promptKey: 'tx_tribal_tribe_name',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
    recordField<TribalMembershipEntry>('hasReceivedIndianHealthService', {
      promptKey: 'tx_tribal_received_service',
      kind: 'yes_no',
    }),
    recordField<TribalMembershipEntry>('eligibleForIndianHealthService', {
      promptKey: 'tx_tribal_eligible_for_service',
      kind: 'yes_no',
    }),
    recordField<TribalMembershipEntry>('hasExcludableTribalIncome', {
      promptKey: 'tx_tribal_has_income',
      helpKey: 'tx_tribal_has_income_help',
      kind: 'yes_no',
    }),
    recordField<TribalMembershipEntry>('tribalIncomeAmount', {
      promptKey: 'tx_q_deduction_amount',
      kind: 'money',
    }),
    recordField<TribalMembershipEntry>('tribalIncomeFrequency', {
      promptKey: 'tx_q_deduction_frequency',
      kind: 'text',
      normalize: normalizeWhitespace,
    }),
  ],
};

/** Section 3 question 7: up to three women who do not want HTW testing. */
export const TX_HTW_OPT_OUTS: RecordList<HtwScreeningOptOut> = {
  id: 'tx-htw-opt-outs',
  peopleField: 'memberId',
  titleKey: 'tx_htw_opt_outs_title',
  introKey: 'tx_htw_opt_outs_intro',
  addLabelKey: 'tx_htw_opt_outs_add',
  emptyKey: 'tx_htw_opt_outs_empty',
  gate: { questionId: Q.htwDeclines, equals: true },
  printedRows: 3,
  read: (data) => addendumOf(data).htwScreeningOptOuts ?? [],
  write: (data, records) => ({
    ...data,
    medicaidAddendum: {
      ...addendumOf(data),
      htwScreeningOptOuts: [...records],
    },
  }),
  blank: () => ({ memberId: 'applicant' }),
  fields: [
    recordField<HtwScreeningOptOut>('memberId', {
      promptKey: 'tx_htw_opt_out_who',
      kind: 'choice',
      required: true,
      options: [],
    }),
  ],
};

/** Every repeating list the Texas flow edits, in the order it presents them. */
export const TX_RECORD_LISTS = [
  TX_JOBS,
  TX_OTHER_INCOME,
  TX_BILLS,
  TX_EMPLOYER_COVERAGE,
  TX_TRIBAL_MEMBERS,
  TX_HTW_OPT_OUTS,
  TX_REPRESENTATIVE,
] as const;
