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
  /**
   * The amount exactly as the applicant reported it, for the form's
   * "HOW MUCH?" column.
   *
   * Paired with `reportedFrequency` for the "HOW OFTEN?" column. These are the
   * facts the applicant signs their name under, so they are stored and printed
   * as stated — never converted. A monthly equivalent for budgeting is derived
   * on demand by `monthlyForBudget`.
   */
  reportedAmount?: number;
  reportedFrequency?: PayFrequency;
  /**
   * Legacy monthly figure from before amount and frequency were collected
   * separately. The questionnaire labelled it "Monthly amount", so a value here
   * genuinely was reported monthly and may still be printed as such.
   */
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

/**
 * Q14 Special Needs Expenses.
 *
 * The printed form asks six independent Yes/No questions under one heading —
 * not one gateway with six details. A household can need a special diet and
 * nothing else, so each is stored separately and a No to one says nothing
 * about the others.
 */
export interface SpecialNeedsExpenses {
  /** "Special diet prescribed by a doctor?" */
  specialDiet: TriState;
  /** "Special phone or other equipment?" */
  specialPhoneOrEquipment: TriState;
  /** "Housework (no one in the home can do it)?" */
  housework: TriState;
  /** "Very high use of utilities?" */
  highUtilityUse: TriState;
  /** "Special laundry service?" */
  specialLaundry: TriState;
  /** "Other special need? (specify)" */
  otherSpecialNeed: TriState;
  /**
   * The two printed free-text lines: "Please list the name of the person with
   * the special need and explain".
   */
  personAndExplanation: string;
  otherSpecialNeedDescription: string;
}

export function emptySpecialNeedsExpenses(): SpecialNeedsExpenses {
  return {
    specialDiet: undefined,
    specialPhoneOrEquipment: undefined,
    housework: undefined,
    highUtilityUse: undefined,
    specialLaundry: undefined,
    otherSpecialNeed: undefined,
    personAndExplanation: '',
    otherSpecialNeedDescription: '',
  };
}

export interface ExpenseSections {
  household: GatewaySection<HouseholdExpenseEntry>;
  dependentCare: GatewaySection<CareExpenseEntry>;
  childSupportPaid: GatewaySection<SupportPaidEntry>;
  spousalSupportPaid: GatewaySection<SupportPaidEntry>;
  /** Q16: only asked when the household has an elderly or disabled member. */
  medical: GatewaySection<MedicalExpenseEntry>;
  specialNeeds: GatewaySection<HouseholdExpenseEntry>;
  /** Q14: six independent special-need questions. */
  specialNeedsExpenses: SpecialNeedsExpenses;
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
    specialNeedsExpenses: emptySpecialNeedsExpenses(),
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

/**
 * Q25 personal-property categories, exactly as the printed form lists them.
 *
 * "Tools" and "Personal tools" are two separate printed boxes in two separate
 * columns and stay separate here: collapsing them would tick a box the
 * applicant did not choose.
 */
export type PersonalPropertyCategory =
  | 'tools'
  | 'business_inventory'
  | 'livestock'
  | 'business_equipment'
  | 'sporting_equipment_guns'
  | 'non_motor_boats_or_trailers'
  | 'camper_shells'
  | 'personal_tools'
  | 'jewelry_artwork_or_collections';

/**
 * One Q25 personal-property item.
 *
 * Q25 is deliberately separate from Q24: Q24 covers cash, accounts and other
 * liquid resources, Q25 covers physical personal and business property, and the
 * form prints them as different questions with different columns.
 */
export interface PersonalPropertyEntry {
  id: string;
  /** Owner, so member-owned or joint property stays attributed. */
  memberId: string;
  /** The printed "Item" column. */
  item: string;
  /** The printed "Is it listed for Sale?" column. */
  listedForSale?: TriState;
  /** The printed "Purchase Price or Current Value" column. */
  purchasePriceOrCurrentValue?: number;
  /** The printed "Amount Owed" column. */
  amountOwed?: number;
}

export interface ResourceSections {
  accounts: GatewaySection<ResourceEntry>;
  vehicles: GatewaySection<VehicleEntry>;
  realProperty: GatewaySection<RealPropertyEntry>;
  /** Q25: a resource sold, traded, or given away in the last 30 months. */
  transferredResources: GatewaySection<RealPropertyEntry>;
  /** Q25 personal property. Distinct from Q24 household resources. */
  personalProperty: GatewaySection<PersonalPropertyEntry>;
  /**
   * Q25's printed category checklist. Independent of the item rows: the form
   * asks the applicant to tick every category they hold and then describe
   * individual items.
   */
  personalPropertyCategories: PersonalPropertyCategory[];
  /** Whether the household received a CalWORKs diversion payment. */
  receivedDiversionPayment: TriState;
}

export function emptyResourceSections(): ResourceSections {
  return {
    accounts: emptyGateway(),
    vehicles: emptyGateway(),
    realProperty: emptyGateway(),
    transferredResources: emptyGateway(),
    personalProperty: emptyGateway(),
    personalPropertyCategories: [],
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

/** Q6j: how long a disability is expected to last, as the form offers it. */
export type DisabilityDuration = 'thirty_days_or_more' | 'twelve_months_or_more';

/**
 * Q6j "Complete for each disabled person listed in question 6."
 *
 * Four independent Yes/No questions plus a duration choice, asked per disabled
 * person. They are deliberately not collapsed into one `disabled` flag: the
 * county uses them for different rules (dependent care, IHSS, the CalFresh
 * medical deduction, institutional status), and the printed form asks each
 * separately.
 *
 * `memberId` ties the answers to a stable household person, so a detail can
 * never drift onto someone else when rows are reordered.
 */
export interface DisabilityDetailEntry {
  id: string;
  memberId: string;
  /** "Does this person need care so that someone else can work or attend school?" */
  needsCareForOthersToWork?: TriState;
  /** "Does this person need help with activities of daily living...?" */
  needsHelpWithDailyLiving?: TriState;
  needsHelpWithDailyLivingExplanation: string;
  /** "Does this person work and have medical expenses that help them keep working?" */
  worksWithMedicalExpenses?: TriState;
  worksWithMedicalExpensesExplanation: string;
  /** "Is this person in a medical facility or nursing home?" */
  inMedicalFacility?: TriState;
  /**
   * Name of the facility. Only the second printed block has a field for this —
   * see the adapter's note — so for the first person it is manual work.
   */
  medicalFacilityName: string;
  /** "Disability is expected to last:" 30 days or more / 12 months or more. */
  expectedDuration?: DisabilityDuration;
}

export interface HouseholdCircumstances {
  authorizedRepresentative: GatewaySection<AuthorizedRepresentative>;
  militaryService: GatewaySection<MilitaryServiceEntry>;
  students: GatewaySection<StudentEntry>;
  absentParents: GatewaySection<AbsentParentEntry>;
  fosterCare: GatewaySection<FosterCareEntry>;
  /** Q6j: per-disabled-person detail, unlocked by Q6i. */
  disabilityDetails: GatewaySection<DisabilityDetailEntry>;
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
  /**
   * Q6a: does everyone listed in question 6 have the same contact information?
   *
   * A No unlocks the two printed per-person contact blocks. Those details are
   * stored on the members themselves (HouseholdMember.contact) rather than
   * here, so they stay attached to the right person.
   */
  everyoneHasSameContactInformation: TriState;
  /**
   * Q2a: an authorized representative for the health-coverage part only.
   *
   * Independent of Q2, which appoints a representative for the CalFresh case.
   * The printed form asks them as two separate questions with separate
   * checkboxes, so a No to one says nothing about the other.
   */
  healthCoverageRepresentative: TriState;
  /**
   * Q6i: anyone with a physical, mental, emotional or developmental disability
   * that limits daily activities such as bathing, dressing or chores.
   *
   * Distinct from the per-person `disabled` flag in the Q6 household table:
   * that records disability status, this records activity limitation, and the
   * form asks them in different places for different purposes.
   */
  disabilityLimitsActivities: TriState;
  /** Q6k: a child or disabled person needs care from another household member. */
  needsCareFromHouseholdMember: TriState;
  /** Q6m: anyone pregnant or a teen parent. */
  pregnantOrTeenParent: TriState;
  /** Q6n: anyone has received a Cal-Learn bonus, penalty or support service. */
  calLearnHistory: TriState;
  /**
   * Q6o: anyone was ever in foster care. Distinct from Q6p, which asks about a
   * foster child living in the home now.
   */
  everInFosterCare: TriState;
  /**
   * Q21a: someone 60 or older who cannot buy food and cook separately because
   * of a disability.
   *
   * A CalFresh separate-household rule. Age and disability are known per person,
   * but whether the two combine this way is a judgement only the applicant can
   * make, so it is asked rather than inferred.
   */
  elderlyUnableToPrepareMealsSeparately: TriState;
  /** Q21a follow-up: who that person is. */
  elderlyUnableToPrepareMealsWho: string;
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
    disabilityDetails: emptyGateway(),
    priorPublicAssistance: undefined,
    californiaResident: undefined,
    plannedAbsence: undefined,
    buysAndPreparesFoodTogether: undefined,
    institutionalLiving: undefined,
    everyoneHasSameContactInformation: undefined,
    healthCoverageRepresentative: undefined,
    disabilityLimitsActivities: undefined,
    needsCareFromHouseholdMember: undefined,
    pregnantOrTeenParent: undefined,
    calLearnHistory: undefined,
    everInFosterCare: undefined,
    elderlyUnableToPrepareMealsSeparately: undefined,
    elderlyUnableToPrepareMealsWho: '',
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

/**
 * Appendix A premium frequency, exactly as the appendix prints its six options.
 *
 * Deliberately not PayFrequency: Appendix A offers Quarterly and Yearly, which
 * the income sections do not, and omits "irregular", which they do. Reusing the
 * income enum would let a value be selected that the appendix cannot print.
 */
export type AppendixAPremiumFrequency =
  | 'weekly'
  | 'bi_weekly'
  | 'twice_a_month'
  | 'monthly'
  | 'quarterly'
  | 'yearly';

/** Appendix A item 16: what the employer will change for the new plan year. */
export type EmployerPlanChange =
  | 'will_no_longer_provide'
  | 'will_start_offering_or_change_premium'
  | 'no_changes_expected';

/**
 * One employer that offers health coverage — Q22a, detailed by Appendix A.
 *
 * The appendix is one printed page per such employer, so its fields live on this
 * record rather than in a parallel structure. Employee, employer and
 * covered-person identities stay separate: `memberId` is the employee this page
 * is about, `otherEligibleMemberIds` are other household people the same job
 * would cover, and the employer is described by its own name/address/contact
 * fields.
 *
 * The employee's Social Security Number is item 2 of the appendix and is
 * deliberately absent from this model — there is nowhere to store one, so
 * nothing can reach the three printed SSN boxes.
 */
export interface EmployerCoverageEntry {
  id: string;
  /** The employee this Appendix A page is about. */
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

  // ── Appendix A detail ──────────────────────────────────────────────────
  /** Item 4, "EMPLOYER IDENTIFICATION NUMBER (EIN)". */
  employerIdentificationNumber: string;
  /** Items 5 and 7-9. */
  employerAddress: string;
  employerCity: string;
  employerState: string;
  employerZipCode: string;
  /** Item 12, the employer representative's email address. */
  employerEmail: string;
  /** Item 13a, when enrolment is possible if in a waiting period. */
  waitingPeriodEnrollmentDate: string;
  /** Other household people the same job would cover (three printed slots). */
  otherEligibleMemberIds: string[];
  /** Item 14, "meets the minimum value standard". */
  meetsMinimumValueStandard?: TriState;
  /** Item 14a, "Is this a State employee benefit plan?" */
  isStateEmployeeBenefitPlan?: TriState;
  /** Item 15b, the frequency printed beside the lowest-cost premium. */
  lowestCostPremiumFrequency?: AppendixAPremiumFrequency;
  /** Item 15, "The employer doesn't offer wellness programs." */
  noWellnessPrograms?: boolean;
  /** Item 16, the change expected for the new plan year. */
  planChange?: EmployerPlanChange;
  /** Item 16a/16b, the premium after the change. */
  changedPremium?: number;
  changedPremiumFrequency?: AppendixAPremiumFrequency;
  /** Item 16c, "Date of change (mm/dd/yyyy)". */
  planChangeDate: string;
}

/**
 * A person the tax filer will claim as a dependent (Q23d/Q23e).
 *
 * A tax dependent is not necessarily a household member — a filer can claim a
 * child who lives with an ex-partner, or a parent living elsewhere. So the
 * person is identified either by a household member id or, when they are
 * outside the household, by name. Forcing an unrelated person into a member id
 * would attach the wrong identity to a signed government form.
 *
 * A tax relationship is also not a household relationship: "son" in the Q6
 * table and "son" on a tax return happen to coincide often, but the county asks
 * Q23e separately, so it is collected separately rather than inferred.
 */
export interface TaxDependentEntry {
  id: string;
  /** Set when the dependent is someone already in the household. */
  memberId?: string;
  /** Used when the dependent is not a household member. */
  name: string;
  /** Q23e: how this dependent is related to the tax filer. */
  relationshipToFiler: string;
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
  /** Q23c follow-up: the spouse's name, printed beside the joint-filing answer. */
  spouseName: string;
  /**
   * Q23b: who plans to file.
   *
   * A household member id where possible, so the printed name stays in step
   * with the Q6 table. `taxFilerName` covers a filer outside the household.
   */
  taxFilerMemberId?: string;
  taxFilerName: string;
  /** Q23d/Q23e: dependents the filer will claim. */
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
    spouseName: '',
    taxFilerMemberId: undefined,
    taxFilerName: '',
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

/** Appendix D: how often the printed "Number of hours worked" is counted. */
export type HoursWorkedFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * Appendix D: the printed pay-frequency row under "How much ... and when?".
 *
 * Distinct from the income sections' `PayFrequency`: Appendix D prints Hourly
 * and Daily, which no income row offers, and omits "Twice a month" and
 * "Irregular", which several income rows do offer. Merging the two would put an
 * option on paper that the printed row does not have.
 */
export type AppendixDPayFrequency =
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'every_two_weeks'
  | 'monthly';

/**
 * One job in the applicant's Appendix D employment history.
 *
 * The printed appendix gives each person a NAME line and three identical "Job n"
 * blocks, so one entry is one printed job block. Every field below has a
 * reviewed destination on the form except `hoursWorked`: the printed line reads
 * "Number of hours worked:" followed only by Daily / Weekly / Monthly
 * checkboxes, and the AcroForm has no widget for the count itself. The count is
 * still collected — dropping it would lose an answer the applicant gave — and is
 * reported as a manual write-in rather than silently discarded.
 */
export interface EmploymentHistoryEntry {
  id: string;
  memberId: string;
  /** Printed "Name and Address of Employer" — the name half. */
  employerName: string;
  /** Printed "Name and Address of Employer" — the address half. */
  employerAddress: string;
  /**
   * Not printed anywhere in Appendix D. Retained because the questionnaire
   * collects it and the report uses it; it has no PDF destination.
   */
  jobTitle: string;
  /** Printed "Dates you worked: From ___ To ___". */
  startDate: string;
  endDate: string;
  reasonForLeaving: string;
  /** Printed "Number of hours worked:" — the count has no widget on the form. */
  hoursWorked?: number;
  hoursWorkedFrequency?: HoursWorkedFrequency;
  /** Printed "Was this your own business (self-employed)?" */
  selfEmployed?: TriState;
  /** Printed "How much do you or did you get paid at this job and when? $___". */
  payAmount?: number;
  /**
   * Named apart from the income sections' `payFrequency` because the record
   * editor keys its choice lists by field name: sharing the name would offer
   * "Twice a month" and "Irregular", which the printed Appendix D row has no
   * box for and the adapter would therefore drop.
   */
  payRateFrequency?: AppendixDPayFrequency;
  /** Printed "Did the County help you get this job?" */
  countyHelpedGetJob?: TriState;
}

/** Appendix D is only requested for cash aid with two or more adults applying. */
/** Appendix E: how a gift/donation vehicle was transferred. */
export type VehicleTransferKind = 'gift' | 'donation' | 'family_transfer';

/** Appendix E: how the applicant established the vehicle's fair market value. */
export type FairMarketValueSource =
  | 'for_sale_ads'
  | 'kelly_blue_book'
  | 'mechanic'
  | 'purchase_price'
  | 'other';

/** Appendix E: how the applicant established the amount still owed. */
export type AmountOwedSource =
  | 'last_bill'
  | 'lender_statement'
  | 'estimate'
  | 'other';

/**
 * One Appendix E vehicle.
 *
 * Appendix E applies when the household is applying for cash aid, or for health
 * care where someone is 65 or older or disabled — the printed page says so at
 * the top. Each vehicle is its own record so the three printed columns cannot
 * blend two vehicles together.
 *
 * `ownerMemberId` and `userMemberId` are separate on purpose: the form asks for
 * the owner and the person who uses the vehicle as two different columns.
 */
export interface VehicleDetailEntry {
  id: string;
  /** "Owner of vehicle". */
  ownerMemberId: string;
  /** "Name of person who uses this vehicle" — often, but not always, the owner. */
  userMemberId: string;
  /** "Year/Make/Model" — one printed column, so one value. */
  yearMakeModel: string;
  vehicleLicenseNumber: string;
  /** "Is this vehicle: used as a home / for self-employment / ..." group answer. */
  usedForExemptPurpose?: TriState;
  /** "Is this vehicle used by a child under age 18 to: ..." group answer. */
  usedByChildUnder18?: TriState;
  /** "Is this vehicle a gift, donation, or family transfer?" */
  isGiftDonationOrTransfer?: TriState;
  transferKind?: VehicleTransferKind;
  /** "Estimated value of vehicle ... Fair Market Value." */
  fairMarketValue?: number;
  /** The printed "I don't know / I need help finding out the value" box. */
  fairMarketValueUnknown?: boolean;
  fairMarketValueSource?: FairMarketValueSource;
  fairMarketValueSourceOther: string;
  /** "How much I owe on the vehicle". */
  amountOwed?: number;
  /** The printed "I don't know / I need help finding out the amount owed" box. */
  amountOwedUnknown?: boolean;
  amountOwedSource?: AmountOwedSource;
  amountOwedSourceOther: string;
  /** "Is this a leased vehicle?" */
  isLeased?: TriState;
}

/**
 * One person's Appendix B answers (American Indian / Alaska Native).
 *
 * Activated by Q3 when health care is being applied for. The appendix asks four
 * things per person, and item 3's follow-up is conditional on a *No*: "if no, is
 * this person eligible to get services from ...". That inversion is preserved
 * rather than normalised, because a Yes and a No lead to different questions.
 */
export interface TribalMembershipEntry {
  id: string;
  memberId: string;
  /** Item 2, "Member of a federally recognized tribe?" */
  memberOfFederallyRecognizedTribe?: TriState;
  /** Item 2 follow-up, printed only for a Yes. */
  tribeName: string;
  /** Item 3, has ever received a service from the Indian Health Service. */
  hasReceivedIndianHealthService?: TriState;
  /** Item 3 follow-up, printed only for a No: is this person eligible to. */
  eligibleForIndianHealthService?: TriState;
  /**
   * Item 4, whether there is tribal income of the kinds the appendix lists.
   * `false` corresponds to the printed "None to report" box.
   */
  hasExcludableTribalIncome?: TriState;
  /** Item 4 detail: the amount and how often, as the applicant reported them. */
  tribalIncomeAmount?: number;
  tribalIncomeFrequency: string;
}

export interface AppendixSections {
  employmentHistory: GatewaySection<EmploymentHistoryEntry>;
  /** Appendix B, one record per American Indian / Alaska Native person. */
  tribalMembership: GatewaySection<TribalMembershipEntry>;
  /** Appendix E vehicle detail, one record per vehicle. */
  vehicleDetails: GatewaySection<VehicleDetailEntry>;
  /** Appendix B detail, only when americanIndianOrAlaskaNative is true. */
  tribalName: string;
  /** Appendix E: extra vehicle detail for 65+/disabled or cash aid. */
  detailedVehicleInformationRequired: TriState;
}

export function emptyAppendixSections(): AppendixSections {
  return {
    employmentHistory: emptyGateway(),
    tribalMembership: emptyGateway(),
    vehicleDetails: emptyGateway(),
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
