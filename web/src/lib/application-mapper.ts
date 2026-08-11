import { householdSizeFromMembers } from "@/lib/household";
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

/**
 * Semantic keys containing any of these markers are never allowed into the
 * automatic prefill plan.
 *
 * This is only one safety layer. The Python SAWS adapter also uses an explicit
 * destination-field allowlist before anything reaches the PDF.
 */
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

  return SENSITIVE_KEY_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

/**
 * Construct one canonical mapping entry while enforcing the semantic
 * sensitive-field boundary.
 */
function entry(
  key: string,
  value: ApplicationFieldValue,
): ApplicationFieldPlanEntry {
  if (isSensitiveKey(key)) {
    throw new Error(
      `Sensitive application field cannot be prefilled: ${key}`,
    );
  }

  return {
    key,
    value,
  };
}

/**
 * Map the primary applicant into reusable canonical fields.
 *
 * This includes both Page 1 applicant/contact information and the applicant's
 * own row-level household details for the SAWS adult/child household tables.
 */
function mapApplicant(
  application: Saws2PlusApplicationData,
  context: ApplicationMappingContext,
): ApplicationFieldPlanEntry[] {
  const applicant = application.applicant;

  const mailingAddress = applicant.mailingAddressSameAsHome
    ? applicant.homeAddress
    : applicant.mailingAddress;

  const fields: ApplicationFieldPlanEntry[] = [
    // Core applicant identity.
    entry(
      "applicant.first_name",
      applicant.firstName,
    ),
    entry(
      "applicant.middle_name",
      applicant.middleName,
    ),
    entry(
      "applicant.last_name",
      applicant.lastName,
    ),
    entry(
      "applicant.date_of_birth",
      applicant.dateOfBirth,
    ),

    // Applicant contact information.
    entry(
      "applicant.phone",
      applicant.phone,
    ),
    entry(
      "applicant.email",
      applicant.email,
    ),
    entry(
      "applicant.preferred_language",
      applicant.preferredLanguage,
    ),

    /**
     * Applicant household-table details.
     *
     * These remain semantic and form-independent. Python decides whether the
     * applicant belongs in the adult or child table based on DOB.
     */
    entry(
      "applicant.household.sex",
      applicant.householdDetails.sex ?? null,
    ),
    entry(
      "applicant.household.citizen_or_national",
      applicant.householdDetails.citizenOrNational ?? null,
    ),
    entry(
      "applicant.household.full_time_student",
      applicant.householdDetails.fullTimeStudent ?? null,
    ),
    entry(
      "applicant.household.disabled",
      applicant.householdDetails.disabled ?? null,
    ),
    entry(
      "applicant.household.marital_status",
      applicant.householdDetails.maritalStatus ?? null,
    ),

    // Home address.
    entry(
      "applicant.home_address.street",
      applicant.homeAddress.street,
    ),
    entry(
      "applicant.home_address.apartment",
      applicant.homeAddress.apartment,
    ),
    entry(
      "applicant.home_address.city",
      applicant.homeAddress.city,
    ),
    entry(
      "applicant.home_address.county",
      context.county ?? "",
    ),
    entry(
      "applicant.home_address.state",
      applicant.homeAddress.state,
    ),
    entry(
      "applicant.home_address.zip_code",
      applicant.homeAddress.zipCode,
    ),

    /**
     * Retain whether mailing is the same as home.
     *
     * The SAWS adapter uses this to avoid redundantly filling the separate
     * mailing-address area when the applicant says both addresses are the same.
     */
    entry(
      "applicant.mailing_address_same_as_home",
      applicant.mailingAddressSameAsHome,
    ),

    // Mailing address.
    entry(
      "applicant.mailing_address.street",
      mailingAddress.street,
    ),
    entry(
      "applicant.mailing_address.apartment",
      mailingAddress.apartment,
    ),
    entry(
      "applicant.mailing_address.city",
      mailingAddress.city,
    ),
    entry(
      "applicant.mailing_address.county",
      context.county ?? "",
    ),
    entry(
      "applicant.mailing_address.state",
      mailingAddress.state,
    ),
    entry(
      "applicant.mailing_address.zip_code",
      mailingAddress.zipCode,
    ),
  ];

  /**
   * The programs selected for the application do not necessarily imply that
   * every household member is applying for all of them.
   *
   * The primary applicant's per-person selections are therefore represented
   * explicitly.
   */
  for (const program of applicant.householdDetails.applyingFor) {
    fields.push(
      entry(
        `applicant.household.applying_for.${program}`,
        true,
      ),
    );
  }

  return fields;
}

/**
 * Map additional household members.
 *
 * Base identity fields are shared by both adult and child rows. Adult- and
 * child-specific details remain namespaced separately so the canonical model
 * does not become coupled to the physical SAWS table layout.
 */
function mapHousehold(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return application.householdMembers.flatMap((member, index) => {
    const prefix = `household.members.${index}`;

    const fields: ApplicationFieldPlanEntry[] = [
      // Shared household identity.
      entry(
        `${prefix}.first_name`,
        member.firstName,
      ),
      entry(
        `${prefix}.middle_name`,
        member.middleName,
      ),
      entry(
        `${prefix}.last_name`,
        member.lastName,
      ),
      entry(
        `${prefix}.date_of_birth`,
        member.dateOfBirth,
      ),
      entry(
        `${prefix}.relationship_to_applicant`,
        member.relationshipToApplicant,
      ),
    ];

    /**
     * Age may come from earlier intake prefill data.
     *
     * Python still computes age from DOB where possible, so this value is a
     * helpful hint rather than the authoritative adult/child classifier.
     */
    if (member.age !== undefined) {
      fields.push(
        entry(
          `${prefix}.age`,
          member.age,
        ),
      );
    }

    /**
     * Adult-specific SAWS household information.
     *
     * All nullable booleans preserve the distinction between:
     * - true: explicitly Yes
     * - false: explicitly No
     * - null/omitted: not answered
     */
    const adult = member.adultDetails;

    if (adult) {
      fields.push(
        entry(
          `${prefix}.adult.sex`,
          adult.sex ?? null,
        ),
        entry(
          `${prefix}.adult.marital_status`,
          adult.maritalStatus ?? null,
        ),
        entry(
          `${prefix}.adult.citizen_or_national`,
          adult.citizenOrNational ?? null,
        ),
        entry(
          `${prefix}.adult.full_time_student`,
          adult.fullTimeStudent ?? null,
        ),
        entry(
          `${prefix}.adult.disabled`,
          adult.disabled ?? null,
        ),
      );

      for (const program of adult.applyingFor) {
        fields.push(
          entry(
            `${prefix}.applying_for.${program}`,
            true,
          ),
        );
      }
    }

    /**
     * Child-specific SAWS household information.
     *
     * SSN is intentionally absent from this model. It cannot accidentally be
     * serialized into the automatic prefill plan because no semantic SSN field
     * exists here at all.
     */
    const child = member.childDetails;

    if (child) {
      fields.push(
        entry(
          `${prefix}.child.sex`,
          child.sex ?? null,
        ),
        entry(
          `${prefix}.child.place_of_birth`,
          child.placeOfBirth,
        ),
        entry(
          `${prefix}.child.citizen_or_national`,
          child.citizenOrNational ?? null,
        ),
        entry(
          `${prefix}.child.full_time_student`,
          child.fullTimeStudent ?? null,
        ),
        entry(
          `${prefix}.child.disabled`,
          child.disabled ?? null,
        ),
        entry(
          `${prefix}.child.immunizations_up_to_date`,
          child.immunizationsUpToDate ?? null,
        ),

        // Parent-status checkboxes on the SAWS child household table.
        entry(
          `${prefix}.child.parent_status.not_in_home`,
          child.parentStatus.notInHome ?? null,
        ),
        entry(
          `${prefix}.child.parent_status.unemployed`,
          child.parentStatus.unemployed ?? null,
        ),
        entry(
          `${prefix}.child.parent_status.disabled`,
          child.parentStatus.disabled ?? null,
        ),
        entry(
          `${prefix}.child.parent_status.deceased`,
          child.parentStatus.deceased ?? null,
        ),
        entry(
          `${prefix}.child.parent_status.none`,
          child.parentStatus.none ?? null,
        ),
      );

      for (const program of child.applyingFor) {
        fields.push(
          entry(
            `${prefix}.applying_for.${program}`,
            true,
          ),
        );
      }
    }

    return fields;
  });
}

/**
 * Preserve coarse financial information from the original intake.
 *
 * These values are intentionally canonical only. We do not map annual
 * household income directly into detailed SAWS earned-income rows because the
 * government form asks for person-, employer-, frequency-, and amount-specific
 * answers that cannot safely be inferred from one annual total.
 */
function mapFinancialInformation(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return [
    /**
     * Household size is derived, not collected: the primary applicant plus every
     * household member row currently entered. Because it is computed here rather
     * than stored, it stays correct when members are added, removed, or edited.
     */
    entry(
      "household.size",
      householdSizeFromMembers(application.householdMembers.length),
    ),
    entry(
      "household.annual_income",
      application.annualHouseholdIncome ?? null,
    ),
    entry(
      "household.income_type",
      application.incomeType,
    ),
    entry(
      "household.existing_benefits",
      application.existingBenefits,
    ),
  ];
}

/**
 * Map which programs the application as a whole is requesting.
 *
 * This is separate from per-person program participation on Pages 3 and 4.
 */
function mapPrograms(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  return application.selectedPrograms.map((program) =>
    entry(
      `programs.${program}`,
      true,
    ),
  );
}

/**
 * Map Page 1 applicant/application preferences.
 */
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

/**
 * Map Page 1 expedited-assistance screening questions.
 */
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

/**
 * Map Page 1 pregnancy and personal-emergency questions.
 */
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
 *
 * Empty/null values are omitted. Explicit false and numeric zero are retained
 * because both may be meaningful government-form answers.
 */
export function buildApplicationFieldPlan(
  application: Saws2PlusApplicationData,
  context: ApplicationMappingContext = {},
): ApplicationFieldPlanEntry[] {
  return [
    ...mapApplicant(
      application,
      context,
    ),
    ...mapApplicationPreferences(
      application,
    ),
    ...mapHousehold(
      application,
    ),
    ...mapFinancialInformation(
      application,
    ),
    ...mapExpeditedService(
      application,
    ),
    ...mapPregnancyAndEmergency(
      application,
    ),
    ...mapPrograms(
      application,
    ),
  ].filter(({ value }) => {
    if (value === null) {
      return false;
    }

    return (
      typeof value !== "string"
      || value.trim() !== ""
    );
  });
}