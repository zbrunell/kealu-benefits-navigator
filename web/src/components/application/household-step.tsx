//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import {
  allowedRelationshipsForDateOfBirth,
  type HouseholdRelationship,
} from "@/lib/household-relationships";
import { ageOnDate, dateOfBirthBounds } from "@/lib/date-of-birth";
import { useTranslation } from "@/hooks/use-translation";
import type { Saws2PlusProgram } from "@/lib/report-assembler";

import type {
  AdultApplicationDetails,
  ApplicantInformation,
  ChildApplicationDetails,
  HouseholdMember,
} from "@/types/application";

interface HouseholdStepProps {
  applicant: ApplicantInformation;
  members: HouseholdMember[];
  selectedPrograms: Saws2PlusProgram[];

  onAdd: () => void;

  onUpdate: <K extends keyof HouseholdMember>(
    memberId: string,
    field: K,
    value: HouseholdMember[K],
  ) => void;

  onAdultDetailsChange: <
    K extends keyof AdultApplicationDetails,
  >(
    memberId: string,
    field: K,
    value: AdultApplicationDetails[K],
  ) => void;

  onChildDetailsChange: <
    K extends keyof ChildApplicationDetails,
  >(
    memberId: string,
    field: K,
    value: ChildApplicationDetails[K],
  ) => void;

  onChildParentStatusChange: (
    memberId: string,
    field: keyof ChildApplicationDetails["parentStatus"],
    value: boolean | undefined,
  ) => void;

  onRemove: (memberId: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200";

const PROGRAM_LABELS: Record<Saws2PlusProgram, string> = {
  medi_cal: "Medi-Cal",
  calfresh: "CalFresh",
  calworks: "CalWORKs",
};

/**
 * Parse a YYYY-MM-DD date and return an approximate current age.
 *
 * We use this only to decide whether to show the adult or child SAWS section.
 * It is not itself written into the PDF.
 */
const ageFromDateOfBirth = (dateOfBirth: string): number | null =>
  ageOnDate(dateOfBirth);

/**
 * Small reusable yes/no control.
 *
 * `undefined` means "not answered yet", which is intentionally different from
 * an explicit No answer.
 */
function YesNoQuestion({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
      <legend className="px-1 text-sm font-medium text-slate-800">
        {label}
      </legend>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={
            value === true
              ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
              : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          }
        >
          {t("ui_yes")}
        </button>

        <button
          type="button"
          onClick={() => onChange(false)}
          className={
            value === false
              ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
              : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          }
        >
          {t("ui_no")}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Program selection for an individual household member.
 *
 * A household may apply for several programs while an individual person applies
 * for only a subset, so we collect this per person rather than assuming every
 * member applies for every selected program.
 */
function ProgramCheckboxes({
  selectedPrograms,
  applyingFor,
  onChange,
}: {
  selectedPrograms: Saws2PlusProgram[];
  applyingFor: Saws2PlusProgram[];
  onChange: (programs: Saws2PlusProgram[]) => void;
}) {
  const { t } = useTranslation();

  function toggle(program: Saws2PlusProgram) {
    onChange(
      applyingFor.includes(program)
        ? applyingFor.filter((item) => item !== program)
        : [...applyingFor, program],
    );
  }

  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
      <legend className="px-1 text-sm font-medium text-slate-800">
        {t("household_which_benefits")}
      </legend>

      <div className="mt-2 flex flex-wrap gap-4">
        {selectedPrograms.map((program) => (
          <label
            key={program}
            className="flex items-center gap-2 text-sm text-slate-700"
          >
            <input
              type="checkbox"
              checked={applyingFor.includes(program)}
              onChange={() => toggle(program)}
              className="h-4 w-4 rounded border-slate-300 text-green-700 focus:ring-green-600"
            />

            {PROGRAM_LABELS[program]}
          </label>
        ))}

        {selectedPrograms.length === 0 && (
          <p className="text-sm text-slate-500">
            {t("household_no_programs")}
          </p>
        )}
      </div>
    </fieldset>
  );
}

/** How each relationship is written on screen. */
/**
 * Catalog keys, not prose: this map is rendered into a <select> the applicant
 * reads, so the words have to come from their language's catalog.
 */
const RELATIONSHIP_LABEL_KEYS: Record<HouseholdRelationship, string> = {
  spouse: "rel_spouse",
  child: "rel_child",
  parent: "rel_parent",
  sibling: "rel_sibling",
  grandparent: "rel_grandparent",
  grandchild: "rel_grandchild",
  unrelated: "rel_unrelated",
  other: "rel_other",
};

export default function HouseholdStep({
  applicant,
  members,
  selectedPrograms,
  onAdd,
  onUpdate,
  onAdultDetailsChange,
  onChildDetailsChange,
  onChildParentStatusChange,
  onRemove,
  onBack,
  onContinue,
}: HouseholdStepProps) {
  const { t } = useTranslation();

  /**
   * Base identity information is required before continuing.
   *
   * The more detailed adult/child questions may remain unanswered while the
   * user is still working through the form; unanswered values stay blank in
   * the PDF rather than being guessed.
   */
  const membersValid = members.every(
    (member) =>
      Boolean(member.firstName.trim()) &&
      Boolean(member.lastName.trim()) &&
      Boolean(member.dateOfBirth) &&
      Boolean(member.relationshipToApplicant.trim()),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
          SAWS 2 PLUS
        </p>

        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {t("household_heading")}
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          {t("household_intro_1")} {t("household_intro_2")}
        </p>

        <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">
            {t("household_primary_applicant")}
          </p>

          <p className="mt-1 text-sm text-blue-800">
            {applicant.firstName} {applicant.lastName}
          </p>

          <p className="mt-2 text-xs text-blue-700">
            {t("household_primary_note")}
          </p>
        </div>

        <div className="mt-6 space-y-5">
          {members.map((member, index) => {
            const calculatedAge =
              ageFromDateOfBirth(member.dateOfBirth)
              ?? member.age
              ?? null;

            const isChild =
              calculatedAge !== null
              && calculatedAge < 18;

            const adultDetails =
              member.adultDetails ?? {
                applyingFor: [],
              };

            const childDetails =
              member.childDetails ?? {
                applyingFor: [],
                placeOfBirth: "",
                parentStatus: {},
              };

            return (
              <fieldset
                key={member.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <legend className="font-semibold text-slate-900">
                    Household member {index + 1}
                  </legend>

                  <button
                    type="button"
                    onClick={() => onRemove(member.id)}
                    className="text-sm font-medium text-red-700 hover:text-red-900"
                  >
                    {t("ui_remove")}
                  </button>
                </div>

                {/* Basic identity fields shared by both adult and child rows. */}
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      {t("field_first_name")}
                    </span>

                    <input
                      type="text"
                      value={member.firstName}
                      onChange={(event) =>
                        onUpdate(
                          member.id,
                          "firstName",
                          event.target.value,
                        )
                      }
                      className={INPUT_CLASS}
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      {t("field_middle_name")}
                    </span>

                    <input
                      type="text"
                      value={member.middleName}
                      onChange={(event) =>
                        onUpdate(
                          member.id,
                          "middleName",
                          event.target.value,
                        )
                      }
                      className={INPUT_CLASS}
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      {t("field_last_name")}
                    </span>

                    <input
                      type="text"
                      value={member.lastName}
                      onChange={(event) =>
                        onUpdate(
                          member.id,
                          "lastName",
                          event.target.value,
                        )
                      }
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      {t("field_date_of_birth")}
                    </span>

                    <input
                      type="date"
                      value={member.dateOfBirth}
                      min={dateOfBirthBounds().min}
                      max={dateOfBirthBounds().max}
                      onChange={(event) =>
                        onUpdate(
                          member.id,
                          "dateOfBirth",
                          event.target.value,
                        )
                      }
                      className={INPUT_CLASS}
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      {t("field_relationship_to_applicant")}
                    </span>

                    <select
                      value={member.relationshipToApplicant}
                      onChange={(event) =>
                        onUpdate(
                          member.id,
                          "relationshipToApplicant",
                          event.target.value,
                        )
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="">
                        {t("opt_select_relationship")}
                      </option>

                      {/*
                        Offered options come from the domain rule, so a child
                        is never shown "Spouse". Editing the date of birth
                        re-runs it, and the stored value is cleared by
                        updateMember if it has become impossible.
                      */}
                      {allowedRelationshipsForDateOfBirth(
                        member.dateOfBirth,
                      ).map((relationship) => (
                        <option key={relationship} value={relationship}>
                          {t(RELATIONSHIP_LABEL_KEYS[relationship])}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {calculatedAge !== null && (
                  <p className="mt-3 text-xs text-slate-500">
                    This person will be entered in the{" "}
                    {isChild ? "child" : "adult"} household section based on
                    their date of birth.
                  </p>
                )}

                {calculatedAge === null && (
                  <p className="mt-3 text-xs text-amber-700">
                    {t("household_dob_hint")}
                  </p>
                )}

                {/* Adult-specific SAWS Page 3 fields. */}
                {calculatedAge !== null && !isChild && (
                  <div className="mt-6 space-y-4 border-t border-slate-200 pt-5">
                    <h2 className="text-sm font-semibold text-slate-900">
                      {t("household_adult_details")}
                    </h2>

                    <ProgramCheckboxes
                      selectedPrograms={selectedPrograms}
                      applyingFor={adultDetails.applyingFor}
                      onChange={(programs) =>
                        onAdultDetailsChange(
                          member.id,
                          "applyingFor",
                          programs,
                        )
                      }
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">
                          Sex
                        </span>

                        <select
                          value={adultDetails.sex ?? ""}
                          onChange={(event) =>
                            onAdultDetailsChange(
                              member.id,
                              "sex",
                              (
                                event.target.value
                                || undefined
                              ) as AdultApplicationDetails["sex"],
                            )
                          }
                          className={INPUT_CLASS}
                        >
                          <option value="">
                            Select
                          </option>
                          <option value="male">
                            Male
                          </option>
                          <option value="female">
                            Female
                          </option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">
                          {t("field_marital_status")}
                        </span>

                        <select
                          value={adultDetails.maritalStatus ?? ""}
                          onChange={(event) =>
                            onAdultDetailsChange(
                              member.id,
                              "maritalStatus",
                              (
                                event.target.value
                                || undefined
                              ) as AdultApplicationDetails["maritalStatus"],
                            )
                          }
                          className={INPUT_CLASS}
                        >
                          <option value="">
                            Select
                          </option>
                          <option value="single">
                            Single
                          </option>
                          <option value="married">
                            Married
                          </option>
                          <option value="separated">
                            Separated
                          </option>
                          <option value="divorced">
                            Divorced
                          </option>
                          <option value="widowed">
                            Widowed
                          </option>
                        </select>
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <YesNoQuestion
                        label="U.S. citizen or national?"
                        value={adultDetails.citizenOrNational}
                        onChange={(value) =>
                          onAdultDetailsChange(
                            member.id,
                            "citizenOrNational",
                            value,
                          )
                        }
                      />

                      <YesNoQuestion
                        label={t("hh_q_full_time_student")}
                        value={adultDetails.fullTimeStudent}
                        onChange={(value) =>
                          onAdultDetailsChange(
                            member.id,
                            "fullTimeStudent",
                            value,
                          )
                        }
                      />

                      <YesNoQuestion
                        label={t("hh_q_disabled")}
                        value={adultDetails.disabled}
                        onChange={(value) =>
                          onAdultDetailsChange(
                            member.id,
                            "disabled",
                            value,
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {/* Child-specific SAWS Page 4 fields. */}
                {calculatedAge !== null && isChild && (
                  <div className="mt-6 space-y-4 border-t border-slate-200 pt-5">
                    <h2 className="text-sm font-semibold text-slate-900">
                      {t("household_child_details")}
                    </h2>

                    <ProgramCheckboxes
                      selectedPrograms={selectedPrograms}
                      applyingFor={childDetails.applyingFor}
                      onChange={(programs) =>
                        onChildDetailsChange(
                          member.id,
                          "applyingFor",
                          programs,
                        )
                      }
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">
                          Sex
                        </span>

                        <select
                          value={childDetails.sex ?? ""}
                          onChange={(event) =>
                            onChildDetailsChange(
                              member.id,
                              "sex",
                              (
                                event.target.value
                                || undefined
                              ) as ChildApplicationDetails["sex"],
                            )
                          }
                          className={INPUT_CLASS}
                        >
                          <option value="">
                            Select
                          </option>
                          <option value="male">
                            Male
                          </option>
                          <option value="female">
                            Female
                          </option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">
                          {t("field_place_of_birth")}
                        </span>

                        <input
                          type="text"
                          value={childDetails.placeOfBirth}
                          onChange={(event) =>
                            onChildDetailsChange(
                              member.id,
                              "placeOfBirth",
                              event.target.value,
                            )
                          }
                          placeholder={t("household_place_of_birth_placeholder")}
                          className={INPUT_CLASS}
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <YesNoQuestion
                        label="U.S. citizen or national?"
                        value={childDetails.citizenOrNational}
                        onChange={(value) =>
                          onChildDetailsChange(
                            member.id,
                            "citizenOrNational",
                            value,
                          )
                        }
                      />

                      <YesNoQuestion
                        label={t("hh_q_full_time_student")}
                        value={childDetails.fullTimeStudent}
                        onChange={(value) =>
                          onChildDetailsChange(
                            member.id,
                            "fullTimeStudent",
                            value,
                          )
                        }
                      />

                      <YesNoQuestion
                        label={t("hh_q_disabled")}
                        value={childDetails.disabled}
                        onChange={(value) =>
                          onChildDetailsChange(
                            member.id,
                            "disabled",
                            value,
                          )
                        }
                      />

                      <YesNoQuestion
                        label={t("hh_q_immunizations")}
                        value={childDetails.immunizationsUpToDate}
                        onChange={(value) =>
                          onChildDetailsChange(
                            member.id,
                            "immunizationsUpToDate",
                            value,
                          )
                        }
                      />
                    </div>

                    <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
                      <legend className="px-1 text-sm font-medium text-slate-800">
                        {t("household_parent_question")}
                      </legend>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            [
                              "notInHome",
                              "household_parent_not_in_home",
                            ],
                            [
                              "unemployed",
                              "household_parent_unemployed",
                            ],
                            [
                              "disabled",
                              "household_parent_disabled",
                            ],
                            [
                              "deceased",
                              "household_parent_deceased",
                            ],
                            [
                              "none",
                              "household_parent_none",
                            ],
                          ] as const
                        ).map(([field, labelKey]) => (
                          <label
                            key={field}
                            className="flex items-center gap-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={
                                childDetails.parentStatus[field]
                                === true
                              }
                              onChange={(event) =>
                                onChildParentStatusChange(
                                  member.id,
                                  field,
                                  event.target.checked,
                                )
                              }
                              className="h-4 w-4 rounded border-slate-300 text-green-700 focus:ring-green-600"
                            />

                            {t(labelKey)}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <p className="text-xs text-slate-500">
                      {t("household_privacy_note")}
                      or prefilled here. They must be entered manually in the
                      official form if required.
                    </p>
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="mt-5 rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          {t("household_add_member")}
        </button>

        {members.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            {t("household_none_added")}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("household_back")}
          </button>

          <button
            type="button"
            onClick={onContinue}
            disabled={!membersValid}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("ui_continue")}
          </button>
        </div>
      </div>
    </div>
  );
}