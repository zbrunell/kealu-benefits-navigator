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
 * contract, and the components that render a question. Texas adds no field to
 * the canonical schema — it turned out that every answer H1010 needs was
 * already representable, and what was missing was only a way for a Texas
 * applicant to give it.
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
import type {
  AnswerValue,
  IntakeForm,
  IntakeQuestion,
  IntakeSection,
} from '@/lib/form-intake/model';
import type {
  ApplicationAddress,
  ApplicationPreferences,
  ExpeditedServiceInformation,
  HouseholdMember,
  Saws2PlusApplicationData,
} from '@/types/application';
import type {
  AuthorizedRepresentative,
  EarnedIncomeEntry,
  HouseholdExpenseEntry,
  UnearnedIncomeEntry,
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
  helper: 'tx-helper',
} as const;

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
    helperSection,
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
  printedRows: 6,
} as const;

/** Read a per-person detail from whichever record the person's age puts it in. */
export function memberDetail(
  member: HouseholdMember,
  key: 'sex' | 'citizenOrNational',
): AnswerValue {
  const record =
    tableForMember(member) === 'child' ? member.childDetails : member.adultDetails;

  return record?.[key];
}

/** Write a per-person detail into the record the person's age selects. */
export function writeMemberDetail(
  member: HouseholdMember,
  key: 'sex' | 'citizenOrNational',
  value: AnswerValue,
): HouseholdMember {
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
        [key]: key === 'citizenOrNational' ? tri(value) : (value as never),
      },
    };
  }

  const adultDetails = member.adultDetails ?? { applyingFor: [] };

  return {
    ...member,
    adultDetails: {
      ...adultDetails,
      [key]: key === 'citizenOrNational' ? tri(value) : (value as never),
    },
  };
}

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

/** Every repeating list the Texas flow edits, in the order it presents them. */
export const TX_RECORD_LISTS = [
  TX_JOBS,
  TX_OTHER_INCOME,
  TX_BILLS,
  TX_REPRESENTATIVE,
] as const;
