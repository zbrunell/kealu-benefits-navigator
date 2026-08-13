//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import type {
  AdultApplicationDetails,
  ApplicantInformation,
} from "@/types/application";

interface ApplicantStepProps {
  applicant: ApplicantInformation;
  onChange: <K extends keyof ApplicantInformation>(
    field: K,
    value: ApplicantInformation[K],
  ) => void;
  onHomeAddressChange: (
    field: keyof ApplicantInformation["homeAddress"],
    value: string,
  ) => void;
  onBack: () => void;
  onContinue: () => void;
}

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200";

export default function ApplicantStep({
  applicant,
  onChange,
  onHomeAddressChange,
  onBack,
  onContinue,
}: ApplicantStepProps) {
  /**
   * Update one field used by the applicant's Page 3 household row.
   *
   * These values stay semantic here. The TypeScript mapper and Python SAWS
   * adapter decide which actual AcroForm fields they belong to.
   */
  function updateHouseholdDetails<
    K extends keyof AdultApplicationDetails,
  >(
    field: K,
    value: AdultApplicationDetails[K],
  ) {
    onChange(
      "householdDetails",
      {
        ...applicant.householdDetails,
        [field]: value,
      },
    );
  }

  /**
   * Base applicant information must be present before moving on.
   *
   * Household-row details below may remain unanswered; unanswered values are
   * intentionally left blank in the generated PDF instead of being guessed.
   */
  const isValid =
    Boolean(applicant.firstName.trim()) &&
    Boolean(applicant.lastName.trim()) &&
    Boolean(applicant.dateOfBirth) &&
    Boolean(applicant.homeAddress.street.trim()) &&
    Boolean(applicant.homeAddress.city.trim()) &&
    Boolean(applicant.homeAddress.zipCode.trim());

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
          SAWS 2 PLUS
        </p>

        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Applicant information
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Enter the information for the primary person applying for benefits.
        </p>

        {/* Basic applicant identity. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              First name
            </span>
            <input
              type="text"
              value={applicant.firstName}
              onChange={(event) =>
                onChange("firstName", event.target.value)
              }
              autoComplete="given-name"
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Middle name
            </span>
            <input
              type="text"
              value={applicant.middleName}
              onChange={(event) =>
                onChange("middleName", event.target.value)
              }
              autoComplete="additional-name"
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Last name
            </span>
            <input
              type="text"
              value={applicant.lastName}
              onChange={(event) =>
                onChange("lastName", event.target.value)
              }
              autoComplete="family-name"
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
              value={applicant.dateOfBirth}
              onChange={(event) =>
                onChange("dateOfBirth", event.target.value)
              }
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Preferred language
            </span>
            <select
              value={applicant.preferredLanguage}
              onChange={(event) =>
                onChange(
                  "preferredLanguage",
                  event.target.value,
                )
              }
              className={INPUT_CLASS}
            >
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
              <option value="Chinese">Chinese</option>
              <option value="Other">Other</option>
            </select>
          </label>
        </div>

        {/* Page 1 asks for any other names the applicant has used. */}
        <div className="mt-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Other names you have used
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Maiden name, nicknames, or any other name on your records. Leave
              blank if none.
            </span>
            <input
              type="text"
              value={applicant.otherNames}
              onChange={(event) =>
                onChange("otherNames", event.target.value)
              }
              className={INPUT_CLASS}
            />
          </label>
        </div>

        {/* Contact information used on Page 1. */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Phone number
            </span>
            <input
              type="tel"
              value={applicant.phone}
              onChange={(event) =>
                onChange("phone", event.target.value)
              }
              autoComplete="tel"
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Work, alternate, or message phone
            </span>
            <input
              type="tel"
              value={applicant.alternatePhone}
              onChange={(event) =>
                onChange("alternatePhone", event.target.value)
              }
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Email address
            </span>
            <input
              type="email"
              value={applicant.email}
              onChange={(event) =>
                onChange("email", event.target.value)
              }
              autoComplete="email"
              className={INPUT_CLASS}
            />
          </label>
        </div>

        {/* Home-address fields used on Page 1. */}
        <fieldset className="mt-6">
          <legend className="text-base font-semibold text-slate-900">
            Home address
          </legend>

          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">
                Street address
              </span>
              <input
                type="text"
                value={applicant.homeAddress.street}
                onChange={(event) =>
                  onHomeAddressChange(
                    "street",
                    event.target.value,
                  )
                }
                autoComplete="street-address"
                className={INPUT_CLASS}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Apartment or unit
              </span>
              <input
                type="text"
                value={applicant.homeAddress.apartment}
                onChange={(event) =>
                  onHomeAddressChange(
                    "apartment",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                City
              </span>
              <input
                type="text"
                value={applicant.homeAddress.city}
                onChange={(event) =>
                  onHomeAddressChange(
                    "city",
                    event.target.value,
                  )
                }
                autoComplete="address-level2"
                className={INPUT_CLASS}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                State
              </span>
              <input
                type="text"
                value={applicant.homeAddress.state}
                disabled
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                ZIP code
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={applicant.homeAddress.zipCode}
                onChange={(event) =>
                  onHomeAddressChange(
                    "zipCode",
                    event.target.value,
                  )
                }
                autoComplete="postal-code"
                maxLength={10}
                className={INPUT_CLASS}
              />
            </label>
          </div>
        </fieldset>

        <label className="mt-6 flex items-start gap-3">
          <input
            type="checkbox"
            checked={applicant.mailingAddressSameAsHome}
            onChange={(event) =>
              onChange(
                "mailingAddressSameAsHome",
                event.target.checked,
              )
            }
            className="mt-1 h-4 w-4 rounded border-slate-300 text-green-700 focus:ring-green-600"
          />
          <span className="text-sm text-slate-700">
            Mailing address is the same as the home address
          </span>
        </label>

        {/* Applicant row details used on SAWS Page 3. */}
        <section className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-base font-semibold text-slate-900">
            Applicant household details
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            These answers help complete your row in the SAWS 2 PLUS adult
            household section.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Sex
              </span>

              <select
                value={applicant.householdDetails.sex ?? ""}
                onChange={(event) =>
                  updateHouseholdDetails(
                    "sex",
                    (
                      event.target.value || undefined
                    ) as AdultApplicationDetails["sex"],
                  )
                }
                className={INPUT_CLASS}
              >
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Marital status
              </span>

              <select
                value={
                  applicant.householdDetails.maritalStatus
                  ?? ""
                }
                onChange={(event) =>
                  updateHouseholdDetails(
                    "maritalStatus",
                    (
                      event.target.value || undefined
                    ) as AdultApplicationDetails["maritalStatus"],
                  )
                }
                className={INPUT_CLASS}
              >
                <option value="">Select</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="separated">Separated</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-medium text-slate-800">
                U.S. citizen or national?
              </legend>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateHouseholdDetails(
                      "citizenOrNational",
                      true,
                    )
                  }
                  className={
                    applicant.householdDetails
                      .citizenOrNational === true
                      ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  }
                >
                  Yes
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateHouseholdDetails(
                      "citizenOrNational",
                      false,
                    )
                  }
                  className={
                    applicant.householdDetails
                      .citizenOrNational === false
                      ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  }
                >
                  No
                </button>
              </div>
            </fieldset>

            <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-medium text-slate-800">
                Full-time student?
              </legend>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateHouseholdDetails(
                      "fullTimeStudent",
                      true,
                    )
                  }
                  className={
                    applicant.householdDetails
                      .fullTimeStudent === true
                      ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  }
                >
                  Yes
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateHouseholdDetails(
                      "fullTimeStudent",
                      false,
                    )
                  }
                  className={
                    applicant.householdDetails
                      .fullTimeStudent === false
                      ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  }
                >
                  No
                </button>
              </div>
            </fieldset>

            <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-medium text-slate-800">
                Disabled?
              </legend>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateHouseholdDetails(
                      "disabled",
                      true,
                    )
                  }
                  className={
                    applicant.householdDetails.disabled === true
                      ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  }
                >
                  Yes
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateHouseholdDetails(
                      "disabled",
                      false,
                    )
                  }
                  className={
                    applicant.householdDetails.disabled === false
                      ? "rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  }
                >
                  No
                </button>
              </div>
            </fieldset>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Social Security numbers and signature fields are intentionally not
            collected or automatically prefilled.
          </p>
        </section>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to program selection
          </button>

          <button
            type="button"
            onClick={onContinue}
            disabled={!isValid}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue to eligibility questions
          </button>
        </div>
      </div>
    </div>
  );
}