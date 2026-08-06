//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import type {
  ApplicantInformation,
  HouseholdMember,
} from "@/types/application";

interface HouseholdStepProps {
  applicant: ApplicantInformation;
  members: HouseholdMember[];
  onAdd: () => void;
  onUpdate: <K extends keyof HouseholdMember>(
    memberId: string,
    field: K,
    value: HouseholdMember[K],
  ) => void;
  onRemove: (memberId: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200";

export default function HouseholdStep({
  applicant,
  members,
  onAdd,
  onUpdate,
  onRemove,
  onBack,
  onContinue,
}: HouseholdStepProps) {
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
          Leave this section empty if the applicant lives alone.
        </p>

        <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">Primary applicant</p>
          <p className="mt-1 text-sm text-blue-800">
            {applicant.firstName} {applicant.lastName}
          </p>
        </div>

        <div className="mt-6 space-y-4">
          {members.map((member, index) => (
            <fieldset
              key={member.id}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
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

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    First name
                  </span>
                  <input
                    type="text"
                    value={member.firstName}
                    onChange={(event) =>
                      onUpdate(member.id, "firstName", event.target.value)
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
                      onUpdate(member.id, "middleName", event.target.value)
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
                      onUpdate(member.id, "lastName", event.target.value)
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
                    onChange={(event) =>
                      onUpdate(member.id, "dateOfBirth", event.target.value)
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
                    <option value="">Select relationship</option>
                    <option value="spouse">Spouse</option>
                    <option value="child">Child</option>
                    <option value="parent">Parent</option>
                    <option value="sibling">Sibling</option>
                    <option value="grandparent">Grandparent</option>
                    <option value="grandchild">Grandchild</option>
                    <option value="unrelated">
                      Unrelated household member
                    </option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
            </fieldset>
          ))}
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
            Back to applicant information
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
