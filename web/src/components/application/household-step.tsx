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
          Yes
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
          No
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
        Which benefits is this person applying for?
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
            No application programs selected.
          </p>
        )}
      </div>
    </fieldset>
  );
}

/** How each relationship is written on screen. */
const RELATIONSHIP_LABELS: Record<HouseholdRelationship, string> = {
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  grandparent: "Grandparent",
  grandchild: "Grandchild",
  unrelated: "Unrelated household member",
  other: "Other",
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
          Household members
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Add everyone who lives in the household besides the primary applicant.
          These answers populate the adult and child household tables on the
          SAWS 2 PLUS application.
        </p>

        <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">
            Primary applicant
          </p>

          <p className="mt-1 text-sm text-blue-800">
            {applicant.firstName} {applicant.lastName}
          </p>

          <p className="mt-2 text-xs text-blue-700">
            The primary applicant is handled separately and is also included in
            the generated household table.
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
                    Remove
                  </button>
                </div>

                {/* Basic identity fields shared by both adult and child rows. */}
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      First name
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
                      Middle name
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
                      Last name
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
                      Date of birth
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
                      Relationship to applicant
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
                        Select relationship
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
                          {RELATIONSHIP_LABELS[relationship]}
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
                    Enter a date of birth to show the remaining adult or child
                    application questions.
                  </p>
                )}

                {/* Adult-specific SAWS Page 3 fields. */}
                {calculatedAge !== null && !isChild && (
                  <div className="mt-6 space-y-4 border-t border-slate-200 pt-5">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Adult application details
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
                          Marital status
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
                        label="Full-time student?"
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
                        label="Disabled?"
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
                      Child application details
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
                          Place of birth
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
                          placeholder="City, state, or country"
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
                        label="Full-time student?"
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
                        label="Disabled?"
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
                        label="Shots/immunizations up to date?"
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
                        Does any of the following apply to one or both parents?
                      </legend>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            [
                              "notInHome",
                              "Parent not in home",
                            ],
                            [
                              "unemployed",
                              "Parent unemployed",
                            ],
                            [
                              "disabled",
                              "Parent disabled",
                            ],
                            [
                              "deceased",
                              "Parent deceased",
                            ],
                            [
                              "none",
                              "None of these",
                            ],
                          ] as const
                        ).map(([field, label]) => (
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

                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <p className="text-xs text-slate-500">
                      Social Security numbers are intentionally not collected
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
          Add household member
        </button>

        {members.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            No additional household members added.
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to eligibility questions
          </button>

          <button
            type="button"
            onClick={onContinue}
            disabled={!membersValid}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}