import type { Saws2PlusApplicationData } from "@/types/application";

export type ApplicationFieldValue = string | boolean | number | null;

/**
 * Canonical application field used at the TypeScript/Python boundary.
 *
 * Keys describe application semantics and must never contain PDF-specific
 * AcroForm field names. A form adapter owns that translation.
 */
export interface ApplicationFieldPlanEntry {
  key: string;
  value: ApplicationFieldValue;
}

export interface ApplicationMappingContext {
  county?: string;
}

const SENSITIVE_KEY_MARKERS = [
  "ssn",
  "social_security",
  "social-security",
  "social security",
  "socialsecurity",
  "signature",
  "signed",
  "date_signed",
  "alien_number",
  "immigration_document",
  "document_number",
] as const;

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker));
}

function entry(
  key: string,
  value: ApplicationFieldValue,
): ApplicationFieldPlanEntry {
  if (isSensitiveKey(key)) {
    throw new Error(`Sensitive application field cannot be prefilled: ${key}`);
  }

  return { key, value };
}

function mapApplicant(
  application: Saws2PlusApplicationData,
  context: ApplicationMappingContext,
): ApplicationFieldPlanEntry[] {
  const applicant = application.applicant;

  const mailingAddress = applicant.mailingAddressSameAsHome
    ? applicant.homeAddress
    : applicant.mailingAddress;

  return [
    entry("applicant.first_name", applicant.firstName),
    entry("applicant.middle_name", applicant.middleName),
    entry("applicant.last_name", applicant.lastName),
    entry("applicant.date_of_birth", applicant.dateOfBirth),
    entry("applicant.phone", applicant.phone),
    entry("applicant.email", applicant.email),
    entry("applicant.preferred_language", applicant.preferredLanguage),

    entry("applicant.home_address.street", applicant.homeAddress.street),
    entry("applicant.home_address.apartment", applicant.homeAddress.apartment),
    entry("applicant.home_address.city", applicant.homeAddress.city),
    entry("applicant.home_address.county", context.county ?? ""),
    entry("applicant.home_address.state", applicant.homeAddress.state),
    entry("applicant.home_address.zip_code", applicant.homeAddress.zipCode),

    entry(
      "applicant.mailing_address_same_as_home",
      applicant.mailingAddressSameAsHome,
    ),

    entry("applicant.mailing_address.street", mailingAddress.street),
    entry("applicant.mailing_address.apartment", mailingAddress.apartment),
    entry("applicant.mailing_address.city", mailingAddress.city),
    entry("applicant.mailing_address.county", context.county ?? ""),
    entry("applicant.mailing_address.state", mailingAddress.state),
    entry("applicant.mailing_address.zip_code", mailingAddress.zipCode),
  ];
}

function mapHousehold(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return application.householdMembers.flatMap((member, index) => {
    const prefix = `household.members.${index}`;

    const fields = [
      entry(`${prefix}.first_name`, member.firstName),
      entry(`${prefix}.middle_name`, member.middleName),
      entry(`${prefix}.last_name`, member.lastName),
      entry(`${prefix}.date_of_birth`, member.dateOfBirth),
      entry(
        `${prefix}.relationship_to_applicant`,
        member.relationshipToApplicant,
      ),
    ];

    if (member.age !== undefined) {
      fields.push(entry(`${prefix}.age`, member.age));
    }

    return fields;
  });
}

function mapFinancialInformation(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return [
    entry(
      "household.annual_income",
      application.annualHouseholdIncome ?? null,
    ),
    entry("household.income_type", application.incomeType),
    entry("household.existing_benefits", application.existingBenefits),
  ];
}

function mapPrograms(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return application.selectedPrograms.map((program) =>
    entry(`programs.${program}`, true),
  );
}

function mapApplicationPreferences(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  const preferences = application.preferences;

  return [
    entry(
      "applicant.email_application_information",
      preferences.emailApplicationInformation ?? null,
    ),
    entry(
      "applicant.email_case_messages",
      preferences.emailCaseMessages ?? null,
    ),
    entry(
      "applicant.needs_disability_application_help",
      preferences.needsDisabilityApplicationHelp ?? null,
    ),
    entry(
      "household.homeless",
      preferences.homeless ?? null,
    ),
    entry(
      "applicant.deaf_or_hard_of_hearing",
      preferences.deafOrHardOfHearing ?? null,
    ),
  ];
}

function mapExpeditedService(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  const expedited = application.expeditedService;

  return [
    entry(
      "household.expedited.gross_income_under_150_and_resources_under_100",
      expedited.grossIncomeUnder150AndResourcesUnder100 ?? null,
    ),
    entry(
      "household.expedited.income_and_resources_less_than_housing_costs",
      expedited.incomeAndResourcesLessThanHousingCosts ?? null,
    ),
    entry(
      "household.expedited.migrant_or_seasonal_farm_worker",
      expedited.migrantOrSeasonalFarmWorker ?? null,
    ),
    entry(
      "household.expedited.eviction_notice",
      expedited.evictionNotice ?? null,
    ),
    entry(
      "household.expedited.utilities_shut_off_or_notice",
      expedited.utilitiesShutOffOrNotice ?? null,
    ),
    entry(
      "household.expedited.food_runs_out_within_three_days",
      expedited.foodRunsOutWithinThreeDays ?? null,
    ),
    entry(
      "household.expedited.needs_essential_clothing",
      expedited.needsEssentialClothing ?? null,
    ),
    entry(
      "household.expedited.needs_transportation_for_emergency_needs",
      expedited.needsTransportationForEmergencyNeeds ?? null,
    ),
  ];
}

function mapPregnancyAndEmergency(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return [
    entry(
      "household.anyone_pregnant",
      application.pregnancy.anyonePregnant ?? null,
    ),
    entry(
      "household.pregnancy.presumptive_eligibility_card",
      application.pregnancy.presumptiveEligibilityCard ?? null,
    ),

    entry(
      "household.personal_emergency.has_emergency",
      application.personalEmergency.hasEmergency ?? null,
    ),
    entry(
      "household.personal_emergency.pregnancy",
      application.personalEmergency.pregnancy ?? null,
    ),
    entry(
      "household.personal_emergency.immediate_medical_need",
      application.personalEmergency.immediateMedicalNeed ?? null,
    ),
    entry(
      "household.personal_emergency.child_abuse",
      application.personalEmergency.childAbuse ?? null,
    ),
    entry(
      "household.personal_emergency.domestic_abuse",
      application.personalEmergency.domesticAbuse ?? null,
    ),
    entry(
      "household.personal_emergency.elder_abuse",
      application.personalEmergency.elderAbuse ?? null,
    ),
    entry(
      "household.personal_emergency.other",
      application.personalEmergency.otherEmergency ?? null,
    ),
  ];
}


/**
 * Convert structured application state into a reusable, form-independent plan.
 * Empty/null values are omitted; false and zero are meaningful and retained.
 */
export function buildApplicationFieldPlan(
  application: Saws2PlusApplicationData,
  context: ApplicationMappingContext = {},
): ApplicationFieldPlanEntry[] {
  return [
    ...mapApplicant(application, context),
    ...mapHousehold(application),
    ...mapFinancialInformation(application),
    ...mapPrograms(application),
    ...mapExpeditedService(application),
    ...mapPregnancyAndEmergency(application),
    ...mapApplicationPreferences(application),
  ].filter(({ value }) => {
    if (value === null) return false;

    return typeof value !== "string" || value.trim() !== "";
  });
}