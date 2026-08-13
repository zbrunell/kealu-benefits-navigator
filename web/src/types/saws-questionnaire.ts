//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Structured model for the conditional parts of the SAWS 2 PLUS application.
 *
 * Design rules:
 *
 * - **Three-state answers.** Every gateway is `boolean | undefined`, where
 *   `undefined` means "not asked / unknown", `true` means the applicant answered
 *   Yes, and `false` means they answered No. `false` is never a default. The
 *   distinction survives all the way to the PDF: an explicit No ticks the No
 *   box, while unknown leaves both boxes blank.
 * - **No PDF field names.** These are application semantics. The Python adapter
 *   owns every AcroForm destination.
 * - **Stable member ids.** Repeatable records reference the household member
 *   they belong to by `memberId`, matching `HouseholdMember.id`, so a record
 *   stays attached to the right person when rows are reordered.
 * - **Nothing invented.** Every field is optional or empty by default; a value
 *   appears only because the applicant supplied it.
 */

/** Answer to a Yes/No question. `undefined` = never asked. */
export type TriState = boolean | undefined;

/**
 * A gateway question plus the detail records it unlocks.
 *
 * When `answer` is `false` or `undefined`, `entries` is ignored by the planner
 * and by the field plan — see `activeEntries()` in the planner. Records are kept
 * rather than deleted so that a user who flips No back to Yes does not lose what
 * they already typed; nothing hidden is ever submitted as an active answer.
 */
export interface GatewaySection<TEntry> {
  answer: TriState;
  entries: TEntry[];
}

export function emptyGateway<TEntry>(): GatewaySection<TEntry> {
  return { answer: undefined, entries: [] };
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export type PayFrequency =
  | 'weekly'
  | 'every_two_weeks'
  | 'twice_a_month'
  | 'monthly'
  | 'irregular';

export interface EarnedIncomeEntry {
  id: string;
  /** Household member id, or "applicant" for the primary applicant. */
  memberId: string;
  employerName: string;
  /**
   * Employer address. The form's column is "Employer's Name and Address", so the
   * address is collected rather than leaving half a printed column blank.
   */
  employerAddress: string;
  employerPhone: string;
  /** ISO date the job started, when known. */
  startDate: string;
  payFrequency?: PayFrequency;
  /** Hourly rate, as printed on the form. Never derived from other values. */
  hourlyRate?: number;
  /**
   * Gross pay per pay period, before deductions.
   *
   * NOTE: this is deliberately *not* the same fact as
   * `grossReceivedThisMonth`. The form asks for the total received this month,
   * which cannot be computed from a per-period amount (a two-week pay cycle
   * yields three paychecks in some months), so both are collected separately and
   * only the monthly total reaches the form's monthly column.
   */
  grossPerPeriod?: number;
  /** Total gross earned income actually received this month. */
  grossReceivedThisMonth?: number;
  hoursPerWeek?: number;
  /** The form's "Expect to Continue?" column. */
  expectedToContinue?: TriState;
}

export interface SelfEmploymentEntry {
  id: string;
  memberId: string;
  businessName: string;
  businessType: string;
  startDate: string;
  grossMonthly?: number;
  netMonthly?: number;
  /**
   * How business expenses are claimed. The three options match the printed
   * "Self-Employment Expenses (please check one)" column on form page 9.
   */
  expenseMethod?: 'standard_40_percent' | 'actual_expenses' | 'monthly_average';
  /** Amount for the actual-expenses or monthly-average option. */
  expenseAmount?: number;
}

export interface UnearnedIncomeEntry {
  id: string;
  memberId: string;
  /** e.g. "Unemployment", "SSI", "Child support", "Retirement". */
  source: string;
  amountMonthly?: number;
}

/** Free or in-kind housing, utilities, food, or clothing (form Q9). */
export interface InKindSupportEntry {
  id: string;
  memberId: string;
  kind: 'housing' | 'utilities' | 'food' | 'clothing';
  providedBy: string;
  estimatedMonthlyValue?: number;
}

export interface JobChangeEntry {
  id: string;
  memberId: string;
  employerName: string;
  /** ISO date the job ended or hours changed. */
  changeDate: string
  reason: string;
}

export interface IncomeSections {
  earned: GatewaySection<EarnedIncomeEntry>;
  selfEmployment: GatewaySection<SelfEmploymentEntry>;
  unearned: GatewaySection<UnearnedIncomeEntry>;
  inKindSupport: GatewaySection<InKindSupportEntry>;
  recentJobChange: GatewaySection<JobChangeEntry>;
  /**
   * Form Q10 asks whether income varies over the year (seasonal, contract,
   * school employment). Only the gateway is modeled; the detail rows live in
   * the earned/self-employment records.
   */
  incomeVariesDuringYear: TriState;
}

export function emptyIncomeSections(): IncomeSections {
  return {
    earned: emptyGateway(),
    selfEmployment: emptyGateway(),
    unearned: emptyGateway(),
    inKindSupport: emptyGateway(),
    recentJobChange: emptyGateway(),
    incomeVariesDuringYear: undefined,
  };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type HouseholdExpenseKind =
  | 'rent_or_mortgage'
  | 'property_tax'
  | 'home_insurance'
  | 'electricity'
  | 'gas'
  | 'water'
  | 'trash'
  | 'telephone'
  | 'other';

export interface HouseholdExpenseEntry {
  id: string;
  kind: HouseholdExpenseKind;
  amountMonthly?: number;
  /** Only used for `other`, to name the expense. */
  description: string;
}

export interface CareExpenseEntry {
  id: string;
  /** The household member who needs the care. */
  memberId: string;
  providerName: string;
  amountMonthly?: number;
  /** True when the care is for a dependent adult rather than a child. */
  forDependentAdult?: boolean;
}

export interface SupportPaidEntry {
  id: string;
  memberId: string;
  /** Who the support is paid to. */
  paidTo: string;
  amountMonthly?: number;
  courtOrdered?: TriState;
}

export interface MedicalExpenseEntry {
  id: string;
  memberId: string;
  /** e.g. "Prescriptions", "Doctor visits", "Medicare premium". */
  kind: string;
  amountMonthly?: number;
}

export interface ExpenseSections {
  household: GatewaySection<HouseholdExpenseEntry>;
  dependentCare: GatewaySection<CareExpenseEntry>;
  childSupportPaid: GatewaySection<SupportPaidEntry>;
  spousalSupportPaid: GatewaySection<SupportPaidEntry>;
  /** Q16: only asked when the household has an elderly or disabled member. */
  medical: GatewaySection<MedicalExpenseEntry>;
  specialNeeds: GatewaySection<HouseholdExpenseEntry>;
  otherTaxDeductible: GatewaySection<HouseholdExpenseEntry>;
}

export function emptyExpenseSections(): ExpenseSections {
  return {
    household: emptyGateway(),
    dependentCare: emptyGateway(),
    childSupportPaid: emptyGateway(),
    spousalSupportPaid: emptyGateway(),
    medical: emptyGateway(),
    specialNeeds: emptyGateway(),
    otherTaxDeductible: emptyGateway(),
  };
}

// ---------------------------------------------------------------------------
// Resources and property
// ---------------------------------------------------------------------------

export interface ResourceEntry {
  id: string;
  memberId: string;
  kind: 'checking' | 'savings' | 'cash_on_hand' | 'stocks_or_bonds' | 'trust' | 'other';
  institution: string;
  balance?: number;
}

export interface VehicleEntry {
  id: string;
  memberId: string;
  year: string;
  make: string;
  model: string;
  /** What the vehicle is used for, when the applicant said. */
  usedFor: string;
  amountOwed?: number;
  estimatedValue?: number;
}

export interface RealPropertyEntry {
  id: string;
  memberId: string;
  kind: 'home' | 'land' | 'rental' | 'other';
  description: string;
  estimatedValue?: number;
}

export interface ResourceSections {
  accounts: GatewaySection<ResourceEntry>;
  vehicles: GatewaySection<VehicleEntry>;
  realProperty: GatewaySection<RealPropertyEntry>;
  /** Q25: a resource sold, traded, or given away in the last 30 months. */
  transferredResources: GatewaySection<RealPropertyEntry>;
  /** Whether the household received a CalWORKs diversion payment. */
  receivedDiversionPayment: TriState;
}

export function emptyResourceSections(): ResourceSections {
  return {
    accounts: emptyGateway(),
    vehicles: emptyGateway(),
    realProperty: emptyGateway(),
    transferredResources: emptyGateway(),
    receivedDiversionPayment: undefined,
  };
}

// ---------------------------------------------------------------------------
// Household circumstances
// ---------------------------------------------------------------------------

export interface AuthorizedRepresentative {
  name: string;
  organization: string;
  phone: string;
  address: string;
  /** Whether the representative may act for CalFresh. */
  forCalFresh: TriState;
  /** Whether the representative may act for health coverage (Appendix C). */
  forHealthCoverage: TriState;
}

export interface MilitaryServiceEntry {
  id: string;
  memberId: string;
  /** e.g. "Veteran", "Active duty", "Spouse of veteran". */
  relationshipToService: string;
  branch: string;
}

export interface StudentEntry {
  id: string;
  memberId: string;
  schoolName: string;
  /** True when enrolled at least half time. */
  halfTimeOrMore?: TriState;
}

export interface AbsentParentEntry {
  id: string;
  /** The child the absent parent belongs to. */
  memberId: string;
  parentName: string;
  /** Last known city/state, when the applicant knows it. */
  lastKnownLocation: string;
}

export interface FosterCareEntry {
  id: string;
  memberId: string;
  agencyName: string;
  monthlyPayment?: number;
}

export interface HouseholdCircumstances {
  authorizedRepresentative: GatewaySection<AuthorizedRepresentative>;
  militaryService: GatewaySection<MilitaryServiceEntry>;
  students: GatewaySection<StudentEntry>;
  absentParents: GatewaySection<AbsentParentEntry>;
  fosterCare: GatewaySection<FosterCareEntry>;
  /** Q6: has anyone in the household received public assistance before? */
  priorPublicAssistance: TriState;
  /** Everyone listed lives in California and intends to stay. */
  californiaResident: TriState;
  /** Anyone planning to be away from California for more than a month. */
  plannedAbsence: TriState;
  /** Everyone in the household buys and prepares food together (Q21). */
  buysAndPreparesFoodTogether: TriState;
  /** Anyone living in a shelter, group home, or institution. */
  institutionalLiving: TriState;
  /** Anyone receiving In-Home Supportive Services (Q20). */
  receivesIhss: TriState;
  /** Anyone taking part in another food program. */
  otherFoodProgram: TriState;
  /** A caretaker relative is applying for a child who is not their own. */
  caretakerRelative: TriState;
  /** Interview preference, when the applicant expressed one. */
  interviewPreference?: 'phone' | 'in_person';
}

export function emptyHouseholdCircumstances(): HouseholdCircumstances {
  return {
    authorizedRepresentative: emptyGateway(),
    militaryService: emptyGateway(),
    students: emptyGateway(),
    absentParents: emptyGateway(),
    fosterCare: emptyGateway(),
    priorPublicAssistance: undefined,
    californiaResident: undefined,
    plannedAbsence: undefined,
    buysAndPreparesFoodTogether: undefined,
    institutionalLiving: undefined,
    receivesIhss: undefined,
    otherFoodProgram: undefined,
    caretakerRelative: undefined,
    interviewPreference: undefined,
  };
}

// ---------------------------------------------------------------------------
// Health coverage and taxes
// ---------------------------------------------------------------------------

export interface HealthCoverageEntry {
  id: string;
  memberId: string;
  planName: string;
  policyHolderName: string;
  /** ISO date the coverage ends, when it is ending. */
  endDate: string;
}

export interface EmployerCoverageEntry {
  id: string;
  memberId: string;
  employerName: string;
  employerPhone: string;
  /** Whether the employer currently offers coverage (Appendix A gateway). */
  offersCoverage: TriState;
  /** Whether this person is eligible now or within three months. */
  eligibleNowOrSoon: TriState;
  /** Lowest-cost employee-only premium, when the applicant knows it. */
  lowestCostPremium?: number;
  premiumFrequency?: PayFrequency;
}

export interface TaxDependentEntry {
  id: string;
  memberId: string;
}

export interface HealthAndTaxSections {
  currentCoverage: GatewaySection<HealthCoverageEntry>;
  coverageEnding: GatewaySection<HealthCoverageEntry>;
  employerCoverage: GatewaySection<EmployerCoverageEntry>;
  /** Q: help paying medical bills from the last three months. */
  retroactiveMedicalHelp: TriState;
  /** Whether the applicant plans to file a federal tax return. */
  taxFiler: TriState;
  /** Whether a spouse will file jointly. */
  spouseFilingJointly: TriState;
  taxDependents: GatewaySection<TaxDependentEntry>;
  /** Permission to use tax data to renew coverage automatically. */
  renewalAuthorization: TriState;
  /** Anyone applying is American Indian or Alaska Native (Appendix B). */
  americanIndianOrAlaskaNative: TriState;
}

export function emptyHealthAndTaxSections(): HealthAndTaxSections {
  return {
    currentCoverage: emptyGateway(),
    coverageEnding: emptyGateway(),
    employerCoverage: emptyGateway(),
    retroactiveMedicalHelp: undefined,
    taxFiler: undefined,
    spouseFilingJointly: undefined,
    taxDependents: emptyGateway(),
    renewalAuthorization: undefined,
    americanIndianOrAlaskaNative: undefined,
  };
}

// ---------------------------------------------------------------------------
// Program integrity / legal history (form page 16 and related questions)
// ---------------------------------------------------------------------------

export interface ProgramIntegrityAnswers {
  /** Q35 */
  fleeingFelon: TriState;
  fleeingFelonWho: string;
  /** Q36 */
  probationOrParoleViolation: TriState;
  probationOrParoleWho: string;
  /** Getting the same benefits in more than one place. */
  duplicateBenefits: TriState;
  /** Buying, selling, or trading benefits. */
  traffickingBenefits: TriState;
  tradingBenefitsForDrugs: TriState;
  tradingBenefitsForFirearms: TriState;
  welfareFraudConviction: TriState;
  currentSanctionOrNonCooperation: TriState;
}

export function emptyProgramIntegrityAnswers(): ProgramIntegrityAnswers {
  return {
    fleeingFelon: undefined,
    fleeingFelonWho: '',
    probationOrParoleViolation: undefined,
    probationOrParoleWho: '',
    duplicateBenefits: undefined,
    traffickingBenefits: undefined,
    tradingBenefitsForDrugs: undefined,
    tradingBenefitsForFirearms: undefined,
    welfareFraudConviction: undefined,
    currentSanctionOrNonCooperation: undefined,
  };
}

// ---------------------------------------------------------------------------
// Other services (form page 16, Q37–Q39)
// ---------------------------------------------------------------------------

export interface OtherServicesAnswers {
  /** Q37 special-need payment for items lost or damaged. */
  specialNeedsPayment: TriState;
  specialNeedsExplanation: string;
  /** Q38A CHDP */
  chdpMoreInformation: TriState;
  chdpMedicalServices: TriState;
  chdpDentalServices: TriState;
  chdpAppointmentOrTransportHelp: TriState;
  /** Q38B */
  immunizationInformation: TriState;
  /** Q38C */
  pregnancyAssistance: TriState;
  /** Q38D */
  breastfeeding: TriState;
  gaveBirthInLastTwelveMonths: TriState;
  /** Q38E */
  familyPlanningServices: TriState;
  /** Q39 */
  thirdPartyLiability: TriState;
  thirdPartyLiabilityWho: string;
}

export function emptyOtherServicesAnswers(): OtherServicesAnswers {
  return {
    specialNeedsPayment: undefined,
    specialNeedsExplanation: '',
    chdpMoreInformation: undefined,
    chdpMedicalServices: undefined,
    chdpDentalServices: undefined,
    chdpAppointmentOrTransportHelp: undefined,
    immunizationInformation: undefined,
    pregnancyAssistance: undefined,
    breastfeeding: undefined,
    gaveBirthInLastTwelveMonths: undefined,
    familyPlanningServices: undefined,
    thirdPartyLiability: undefined,
    thirdPartyLiabilityWho: '',
  };
}

// ---------------------------------------------------------------------------
// Appendices
// ---------------------------------------------------------------------------

export interface EmploymentHistoryEntry {
  id: string;
  memberId: string;
  employerName: string;
  jobTitle: string;
  startDate: string;
  endDate: string;
  reasonForLeaving: string;
}

/** Appendix D is only requested for cash aid with two or more adults applying. */
export interface AppendixSections {
  employmentHistory: GatewaySection<EmploymentHistoryEntry>;
  /** Appendix B detail, only when americanIndianOrAlaskaNative is true. */
  tribalName: string;
  /** Appendix E: extra vehicle detail for 65+/disabled or cash aid. */
  detailedVehicleInformationRequired: TriState;
}

export function emptyAppendixSections(): AppendixSections {
  return {
    employmentHistory: emptyGateway(),
    tribalName: '',
    detailedVehicleInformationRequired: undefined,
  };
}

// ---------------------------------------------------------------------------
// The questionnaire as a whole
// ---------------------------------------------------------------------------

export interface Saws2PlusQuestionnaire {
  circumstances: HouseholdCircumstances;
  income: IncomeSections;
  expenses: ExpenseSections;
  health: HealthAndTaxSections;
  resources: ResourceSections;
  programIntegrity: ProgramIntegrityAnswers;
  otherServices: OtherServicesAnswers;
  appendices: AppendixSections;
}

export function emptyQuestionnaire(): Saws2PlusQuestionnaire {
  return {
    circumstances: emptyHouseholdCircumstances(),
    income: emptyIncomeSections(),
    expenses: emptyExpenseSections(),
    health: emptyHealthAndTaxSections(),
    resources: emptyResourceSections(),
    programIntegrity: emptyProgramIntegrityAnswers(),
    otherServices: emptyOtherServicesAnswers(),
    appendices: emptyAppendixSections(),
  };
}

/** The primary applicant's synthetic member id, used by repeatable records. */
export const APPLICANT_MEMBER_ID = 'applicant';
