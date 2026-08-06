//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import type { ApplicantInformation } from "@/types/application";

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

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              First name
            </span>
            <input
              type="text"
              value={applicant.firstName}
              onChange={(event) => onChange("firstName", event.target.value)}
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
              onChange={(event) => onChange("middleName", event.target.value)}
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
              onChange={(event) => onChange("lastName", event.target.value)}
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
              onChange={(event) => onChange("dateOfBirth", event.target.value)}
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
                onChange("preferredLanguage", event.target.value)
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

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Phone number
            </span>
            <input
              type="tel"
              value={applicant.phone}
              onChange={(event) => onChange("phone", event.target.value)}
              autoComplete="tel"
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
              onChange={(event) => onChange("email", event.target.value)}
              autoComplete="email"
              className={INPUT_CLASS}
            />
          </label>
        </div>

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
                  onHomeAddressChange("street", event.target.value)
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
                  onHomeAddressChange("apartment", event.target.value)
                }
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">City</span>
              <input
                type="text"
                value={applicant.homeAddress.city}
                onChange={(event) =>
                  onHomeAddressChange("city", event.target.value)
                }
                autoComplete="address-level2"
                className={INPUT_CLASS}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">State</span>
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
                  onHomeAddressChange("zipCode", event.target.value)
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
              onChange("mailingAddressSameAsHome", event.target.checked)
            }
            className="mt-1 h-4 w-4 rounded border-slate-300 text-green-700 focus:ring-green-600"
          />
          <span className="text-sm text-slate-700">
            Mailing address is the same as the home address
          </span>
        </label>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
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
            Continue to household members
          </button>
        </div>
      </div>
    </div>
  );
}
