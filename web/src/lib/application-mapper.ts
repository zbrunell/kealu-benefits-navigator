import { householdSizeFromMembers } from "@/lib/household";
import { planHouseholdRows } from "@/lib/household-rows";
import { monthlyForBudget, printableAmount } from "@/lib/reported-amounts";
import { activeEntries, memberOptions } from "@/lib/saws2-question-planner";
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
      "applicant.other_names",
      applicant.otherNames,
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
      "applicant.alternate_phone",
      applicant.alternatePhone,
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
      /**
       * Marks that this member exists, independently of whether any of their
       * details have been filled in.
       *
       * The PDF adapter used to discover members by probing for a non-empty
       * first name and stopping at the first gap, which deleted every member
       * after an unnamed one. Presence is now stated rather than inferred.
       */
      entry(
        `${prefix}.present`,
        true,
      ),

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
 * State which printed household row each person occupies.
 *
 * This is the whole point of the canonical boundary: the semantic decision
 * ("the spouse is the second adult") is made once, here, and the PDF adapter
 * only obeys it. The adapter previously re-derived the ordering from whichever
 * canonical keys happened to be present, so a blank name or a missing birth date
 * could move somebody into another person's row.
 *
 * Row numbers are zero-based and printed top to bottom. A row beyond the five
 * the paper form provides is still stated honestly; the adapter drops it rather
 * than wrapping it onto an occupied row.
 */
function mapHouseholdRowAssignments(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  const plan = planHouseholdRows(application);

  const fields: ApplicationFieldPlanEntry[] = [
    entry(
      "household.members.count",
      application.householdMembers.length,
    ),
    entry(
      "household.adult_rows.count",
      plan.adults.length,
    ),
    entry(
      "household.child_rows.count",
      plan.children.length,
    ),
  ];

  for (const assignment of plan.all) {
    fields.push(
      entry(
        `${assignment.prefix}.table`,
        assignment.table,
      ),
      entry(
        `${assignment.prefix}.table_row`,
        assignment.row,
      ),
    );
  }

  return fields;
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
  const fields = application.selectedPrograms.map((program) =>
    entry(
      `programs.${program}`,
      true,
    ),
  );

  /*
   * Page 1 also offers an "Other" program box with a free-text description.
   * The checkbox is only ticked when the applicant asked for it.
   */
  if (application.otherProgramRequested === true) {
    fields.push(entry("programs.other", true));
    fields.push(
      entry("programs.other_description", application.otherProgramDescription),
    );
  }

  return fields;
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
 * Map the three-state questionnaire answers.
 *
 * A tri-state answer is emitted only when it is a real boolean: `undefined`
 * produces no entry at all, so an unasked question leaves both the Yes and the
 * No box blank on the form. An explicit `false` is emitted as `false` and the
 * adapter ticks No.
 */
function mapQuestionnaire(
  application: Saws2PlusApplicationData,
): ApplicationFieldPlanEntry[] {
  const { programIntegrity, otherServices, circumstances, income, expenses, resources, health } =
    application.questionnaire;

  const fields: ApplicationFieldPlanEntry[] = [];

  /*
   * Resolve a member id to the person's typed name for the form's
   * "Person Working" / "Person Self-Employed" columns.
   *
   * Only a real name is returned. The planner's display fallbacks
   * ("Household member 2") are placeholders for the UI, never values to print on
   * a government form, so an unnamed person leaves the column blank.
   */
  const namesById = new Map(
    memberOptions(application).map((option) => [option.id, option.label]),
  );

  const realNames = new Set<string>();
  const applicantName =
    `${application.applicant.firstName} ${application.applicant.lastName}`.trim();
  if (applicantName) realNames.add(applicantName);
  for (const member of application.householdMembers) {
    const name = `${member.firstName} ${member.lastName}`.trim();
    if (name) realNames.add(name);
  }

  const personName = (memberId: string): string => {
    const label = namesById.get(memberId) ?? "";
    return realNames.has(label) ? label : "";
  };

  /** Emit a tri-state answer, skipping unknowns. */
  const tri = (key: string, value: boolean | undefined) => {
    if (typeof value === "boolean") {
      fields.push(entry(key, value));
    }
  };

  /**
   * Emit a non-empty string.
   *
   * Tolerates a missing value: `applicationData` arrives as JSON from the client,
   * so a payload written against an older shape can omit a field the current
   * types declare. A missing answer is simply not emitted rather than throwing.
   */
  const text = (key: string, value: string | undefined | null) => {
    const trimmed = typeof value === "string" ? value.trim() : "";

    if (trimmed) fields.push(entry(key, trimmed));
  };

  // ── Program integrity / legal history (form page 16) ────────────────────
  tri("integrity.fleeing_felon", programIntegrity.fleeingFelon);
  tri("integrity.probation_or_parole_violation", programIntegrity.probationOrParoleViolation);
  tri("integrity.duplicate_benefits", programIntegrity.duplicateBenefits);
  tri("integrity.trafficking_benefits", programIntegrity.traffickingBenefits);
  tri("integrity.trading_benefits_for_drugs", programIntegrity.tradingBenefitsForDrugs);
  tri("integrity.trading_benefits_for_firearms", programIntegrity.tradingBenefitsForFirearms);
  tri("integrity.welfare_fraud_conviction", programIntegrity.welfareFraudConviction);
  tri("integrity.current_sanction", programIntegrity.currentSanctionOrNonCooperation);

  /*
   * The "who?" explanations are only meaningful alongside a Yes. A stale
   * explanation left over from a Yes the user changed to No is not emitted.
   */
  if (programIntegrity.fleeingFelon === true) {
    text("integrity.fleeing_felon_who", programIntegrity.fleeingFelonWho);
  }

  if (programIntegrity.probationOrParoleViolation === true) {
    text("integrity.probation_or_parole_who", programIntegrity.probationOrParoleWho);
  }

  // ── Other services (form page 16, Q37–Q39) ─────────────────────────────
  tri("services.special_needs_payment", otherServices.specialNeedsPayment);

  if (otherServices.specialNeedsPayment === true) {
    text("services.special_needs_explanation", otherServices.specialNeedsExplanation);
  }

  tri("services.chdp_more_information", otherServices.chdpMoreInformation);
  tri("services.chdp_medical", otherServices.chdpMedicalServices);
  tri("services.chdp_dental", otherServices.chdpDentalServices);
  tri("services.chdp_appointment_help", otherServices.chdpAppointmentOrTransportHelp);
  tri("services.immunization_information", otherServices.immunizationInformation);
  tri("services.pregnancy_assistance", otherServices.pregnancyAssistance);
  tri("services.breastfeeding", otherServices.breastfeeding);

  // Only meaningful when breastfeeding is Yes.
  if (otherServices.breastfeeding === true) {
    tri("services.gave_birth_last_twelve_months", otherServices.gaveBirthInLastTwelveMonths);
  }

  tri("services.family_planning", otherServices.familyPlanningServices);
  tri("services.third_party_liability", otherServices.thirdPartyLiability);

  if (otherServices.thirdPartyLiability === true) {
    text("services.third_party_liability_who", otherServices.thirdPartyLiabilityWho);
  }

  // ── Household circumstances ────────────────────────────────────────────
  tri("household.prior_public_assistance", circumstances.priorPublicAssistance);
  tri("household.california_resident", circumstances.californiaResident);
  tri("household.planned_absence", circumstances.plannedAbsence);
  tri("household.buys_and_prepares_food_together", circumstances.buysAndPreparesFoodTogether);
  tri("household.institutional_living", circumstances.institutionalLiving);
  tri("household.receives_ihss", circumstances.receivesIhss);
  tri("household.other_food_program", circumstances.otherFoodProgram);
  tri("household.caretaker_relative", circumstances.caretakerRelative);
  tri("household.authorized_representative", circumstances.authorizedRepresentative.answer);

  /*
   * The record gateways' own Yes/No answers. These were previously not emitted
   * at all, so answering Q6d/Q6g/Q6l/Q6p left both printed boxes blank even
   * when the applicant had explicitly said No.
   */
  tri("household.military_service", circumstances.militaryService.answer);
  tri("household.absent_parents", circumstances.absentParents.answer);
  tri("household.students", circumstances.students.answer);
  tri("household.foster_care", circumstances.fosterCare.answer);

  // Newly modeled household circumstances.
  tri("household.health_coverage_representative", circumstances.healthCoverageRepresentative);
  tri("household.disability_limits_activities", circumstances.disabilityLimitsActivities);
  tri("household.needs_care_from_member", circumstances.needsCareFromHouseholdMember);
  tri("household.pregnant_or_teen_parent", circumstances.pregnantOrTeenParent);
  tri("household.cal_learn_history", circumstances.calLearnHistory);
  tri("household.ever_in_foster_care", circumstances.everInFosterCare);
  tri(
    "household.elderly_unable_to_prepare_meals",
    circumstances.elderlyUnableToPrepareMealsSeparately,
  );

  // The "who" line is printed only when the answer is Yes.
  if (circumstances.elderlyUnableToPrepareMealsSeparately === true) {
    text(
      "household.elderly_unable_to_prepare_meals_who",
      circumstances.elderlyUnableToPrepareMealsWho,
    );
  }

  for (const [index, representative] of activeEntries(
    circumstances.authorizedRepresentative,
  ).entries()) {
    const prefix = `household.authorized_representative.${index}`;
    text(`${prefix}.name`, representative.name);
    text(`${prefix}.organization`, representative.organization);
    text(`${prefix}.phone`, representative.phone);
    text(`${prefix}.address`, representative.address);
    tri(`${prefix}.for_calfresh`, representative.forCalFresh);
    tri(`${prefix}.for_health_coverage`, representative.forHealthCoverage);
  }

  // ── Income ─────────────────────────────────────────────────────────────
  tri("income.has_earned_income", income.earned.answer);
  tri("income.has_self_employment", income.selfEmployment.answer);
  tri("income.has_unearned_income", income.unearned.answer);
  tri("income.has_in_kind_support", income.inKindSupport.answer);
  tri("income.recent_job_change", income.recentJobChange.answer);
  tri("income.varies_during_year", income.incomeVariesDuringYear);

  for (const [index, job] of activeEntries(income.earned).entries()) {
    const prefix = `income.earned.${index}`;
    text(`${prefix}.member_id`, job.memberId);
    text(`${prefix}.person_name`, personName(job.memberId));
    text(`${prefix}.employer_name`, job.employerName);
    text(`${prefix}.employer_address`, job.employerAddress);
    text(`${prefix}.employer_phone`, job.employerPhone);
    text(`${prefix}.start_date`, job.startDate);
    if (job.payFrequency) text(`${prefix}.pay_frequency`, job.payFrequency);
    if (job.hourlyRate !== undefined) {
      fields.push(entry(`${prefix}.hourly_rate`, job.hourlyRate));
    }
    if (job.grossPerPeriod !== undefined) {
      fields.push(entry(`${prefix}.gross_per_period`, job.grossPerPeriod));
    }
    if (job.grossReceivedThisMonth !== undefined) {
      fields.push(
        entry(`${prefix}.gross_received_this_month`, job.grossReceivedThisMonth),
      );
    }
    if (job.hoursPerWeek !== undefined) {
      fields.push(entry(`${prefix}.hours_per_week`, job.hoursPerWeek));
    }
    tri(`${prefix}.expected_to_continue`, job.expectedToContinue);
  }

  for (const [index, business] of activeEntries(income.selfEmployment).entries()) {
    const prefix = `income.self_employment.${index}`;
    text(`${prefix}.member_id`, business.memberId);
    text(`${prefix}.person_name`, personName(business.memberId));
    text(`${prefix}.business_name`, business.businessName);
    text(`${prefix}.business_type`, business.businessType);
    text(`${prefix}.start_date`, business.startDate);
    if (business.grossMonthly !== undefined) {
      fields.push(entry(`${prefix}.gross_monthly`, business.grossMonthly));
    }
    if (business.netMonthly !== undefined) {
      fields.push(entry(`${prefix}.net_monthly`, business.netMonthly));
    }
    if (business.expenseMethod) {
      text(`${prefix}.expense_method`, business.expenseMethod);
    }
    if (business.expenseAmount !== undefined) {
      fields.push(entry(`${prefix}.expense_amount`, business.expenseAmount));
    }
  }

  // Q7 Unearned Income — person, source and monthly amount.
  for (const [index, source] of activeEntries(income.unearned).entries()) {
    const prefix = `income.unearned.${index}`;
    text(`${prefix}.member_id`, source.memberId);
    text(`${prefix}.person_name`, personName(source.memberId));
    text(`${prefix}.source`, source.source);

    /*
     * The form's "HOW MUCH?" and "HOW OFTEN?" columns want the applicant's own
     * words. `printableAmount` returns the reported pair when it exists and
     * falls back to the legacy monthly figure otherwise; it never invents a
     * frequency, so an amount with no known frequency leaves that column blank.
     *
     * The monthly equivalent is emitted separately for budgeting and is never a
     * destination for either printed column.
     */
    const printable = printableAmount(source);

    if (printable.amount !== undefined) {
      fields.push(entry(`${prefix}.reported_amount`, printable.amount));
    }

    if (printable.frequency !== undefined) {
      fields.push(entry(`${prefix}.reported_frequency`, printable.frequency));
    }

    const monthly = monthlyForBudget(source);

    if (monthly !== undefined) {
      fields.push(entry(`${prefix}.amount_monthly`, monthly));
    }
  }

  // Q9 Other Income — housing, utilities, food or clothing received free or in
  // exchange for work. The printed table has one fixed row per item type.
  for (const [index, support] of activeEntries(income.inKindSupport).entries()) {
    const prefix = `income.in_kind.${index}`;
    text(`${prefix}.member_id`, support.memberId);
    text(`${prefix}.person_name`, personName(support.memberId));
    text(`${prefix}.kind`, support.kind);
    text(`${prefix}.provided_by`, support.providedBy);
    if (support.estimatedMonthlyValue !== undefined) {
      fields.push(
        entry(`${prefix}.estimated_monthly_value`, support.estimatedMonthlyValue),
      );
    }
  }

  for (const [index, change] of activeEntries(income.recentJobChange).entries()) {
    const prefix = `income.recent_job_change.${index}`;
    text(`${prefix}.member_id`, change.memberId);
    text(`${prefix}.person_name`, personName(change.memberId));
    text(`${prefix}.employer_name`, change.employerName);
    text(`${prefix}.change_date`, change.changeDate);
    text(`${prefix}.reason`, change.reason);
  }

  // ── Expenses ───────────────────────────────────────────────────────────
  tri("expenses.has_household_expenses", expenses.household.answer);
  tri("expenses.has_dependent_care", expenses.dependentCare.answer);
  tri("expenses.pays_child_support", expenses.childSupportPaid.answer);
  tri("expenses.pays_spousal_support", expenses.spousalSupportPaid.answer);
  tri("expenses.has_medical_expenses", expenses.medical.answer);

  for (const [index, expense] of activeEntries(expenses.household).entries()) {
    const prefix = `expenses.household.${index}`;
    text(`${prefix}.kind`, expense.kind);
    text(`${prefix}.description`, expense.description);
    if (expense.amountMonthly !== undefined) {
      fields.push(entry(`${prefix}.amount_monthly`, expense.amountMonthly));
    }
  }

  for (const [index, expense] of activeEntries(expenses.medical).entries()) {
    const prefix = `expenses.medical.${index}`;
    text(`${prefix}.member_id`, expense.memberId);
    text(`${prefix}.kind`, expense.kind);
    if (expense.amountMonthly !== undefined) {
      fields.push(entry(`${prefix}.amount_monthly`, expense.amountMonthly));
    }
  }

  // ── Resources ──────────────────────────────────────────────────────────
  tri("resources.has_accounts", resources.accounts.answer);
  tri("resources.has_vehicles", resources.vehicles.answer);
  tri("resources.has_real_property", resources.realProperty.answer);
  tri("resources.transferred_resources", resources.transferredResources.answer);
  tri("resources.received_diversion_payment", resources.receivedDiversionPayment);

  // Q24 Household's Resources.
  for (const [index, account] of activeEntries(resources.accounts).entries()) {
    const prefix = `resources.accounts.${index}`;
    text(`${prefix}.member_id`, account.memberId);
    text(`${prefix}.person_name`, personName(account.memberId));
    text(`${prefix}.kind`, account.kind);
    text(`${prefix}.institution`, account.institution);
    if (account.balance !== undefined) {
      fields.push(entry(`${prefix}.balance`, account.balance));
    }
  }

  // The un-numbered transferred-resource question at the end of Q24.
  for (const [index, transferred] of activeEntries(
    resources.transferredResources,
  ).entries()) {
    const prefix = `resources.transferred.${index}`;
    text(`${prefix}.member_id`, transferred.memberId);
    text(`${prefix}.description`, transferred.description);
    if (transferred.estimatedValue !== undefined) {
      fields.push(entry(`${prefix}.estimated_value`, transferred.estimatedValue));
    }
  }

  for (const [index, vehicle] of activeEntries(resources.vehicles).entries()) {
    const prefix = `resources.vehicles.${index}`;
    text(`${prefix}.member_id`, vehicle.memberId);
    text(`${prefix}.year`, vehicle.year);
    text(`${prefix}.make`, vehicle.make);
    text(`${prefix}.model`, vehicle.model);
    text(`${prefix}.used_for`, vehicle.usedFor);
    if (vehicle.amountOwed !== undefined) {
      fields.push(entry(`${prefix}.amount_owed`, vehicle.amountOwed));
    }
    if (vehicle.estimatedValue !== undefined) {
      fields.push(entry(`${prefix}.estimated_value`, vehicle.estimatedValue));
    }
  }

  // ── Health coverage and taxes ──────────────────────────────────────────
  /*
   * The tax household. Everything is emitted only while Q23 is Yes, so a
   * household that stopped planning to file cannot leave a stale filer name or
   * dependent list on the form.
   */
  if (health.taxFiler === true) {
    text("health.tax_filer_name", health.taxFilerMemberId
      ? personName(health.taxFilerMemberId)
      : health.taxFilerName);

    if (health.spouseFilingJointly === true) {
      text("health.spouse_name", health.spouseName);
    }

    tri("health.has_tax_dependents", health.taxDependents.answer);

    const dependents = activeEntries(health.taxDependents);

    // The form prints one line for all dependent names and one for all
    // relationships, so the collected records are joined rather than each
    // needing its own printed row.
    const names = dependents
      .map((dependent) =>
        dependent.memberId ? personName(dependent.memberId) : dependent.name,
      )
      .filter((name) => name.trim());

    if (names.length > 0) text("health.tax_dependent_names", names.join(", "));

    const relationships = dependents
      .map((dependent) => dependent.relationshipToFiler)
      .filter((relationship) => relationship.trim());

    if (relationships.length > 0) {
      text("health.tax_dependent_relationships", relationships.join(", "));
    }
  }

  tri("health.has_current_coverage", health.currentCoverage.answer);
  tri("health.coverage_ending", health.coverageEnding.answer);
  tri("health.has_employer_coverage", health.employerCoverage.answer);
  tri("health.retroactive_medical_help", health.retroactiveMedicalHelp);
  tri("health.tax_filer", health.taxFiler);
  tri("health.american_indian_or_alaska_native", health.americanIndianOrAlaskaNative);
  tri("health.renewal_authorization", health.renewalAuthorization);

  if (health.taxFiler === true) {
    tri("health.spouse_filing_jointly", health.spouseFilingJointly);
  }

  for (const [index, coverage] of activeEntries(health.currentCoverage).entries()) {
    const prefix = `health.current_coverage.${index}`;
    text(`${prefix}.member_id`, coverage.memberId);
    text(`${prefix}.plan_name`, coverage.planName);
    text(`${prefix}.policy_holder_name`, coverage.policyHolderName);
    text(`${prefix}.end_date`, coverage.endDate);
  }

  for (const [index, coverage] of activeEntries(health.employerCoverage).entries()) {
    const prefix = `health.employer_coverage.${index}`;
    text(`${prefix}.member_id`, coverage.memberId);
    text(`${prefix}.employer_name`, coverage.employerName);
    text(`${prefix}.employer_phone`, coverage.employerPhone);
    tri(`${prefix}.offers_coverage`, coverage.offersCoverage);
    tri(`${prefix}.eligible_now_or_soon`, coverage.eligibleNowOrSoon);
    if (coverage.lowestCostPremium !== undefined) {
      fields.push(entry(`${prefix}.lowest_cost_premium`, coverage.lowestCostPremium));
    }
  }

  return fields;
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
    ...mapHouseholdRowAssignments(
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
    ...mapQuestionnaire(
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