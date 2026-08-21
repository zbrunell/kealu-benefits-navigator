//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useState } from "react";

import { applicantDateOfBirthErrorKey } from "@/lib/applicant-eligibility";
import {
  checkCity,
  checkEmail,
  checkStreetAddress,
  checkUsPhone,
  checkZipCode,
  formatUsPhone,
  normalizeWhitespace,
  normalizeZipCode,
} from "@/lib/field-validation";
import { dateOfBirthBounds } from "@/lib/date-of-birth";
import { useTranslation } from "@/hooks/use-translation";
import {
  REQUIRED_APPLICANT_FIELD_IDS,
  hasEveryRequiredApplicantAnswer,
  missingRequiredApplicantFields,
} from "@/lib/required-fields";
import {
  FieldLabelText,
  RequiredLegend,
} from "./required-marker";

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

/**
 * The error line under a field.
 *
 * `role="alert"` announces it, the id links it to the input via
 * aria-describedby, and the message carries the meaning — colour is not the
 * only signal, so it still reads for anyone who cannot see red.
 */
function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;

  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-700">
      {message}
    </p>
  );
}

export default function ApplicantStep({
  applicant,
  onChange,
  onHomeAddressChange,
  onBack,
  onContinue,
}: ApplicantStepProps) {
  const { t, tv } = useTranslation();

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
  /*
   * One call covers both the date and the jurisdiction's age rule, so the
   * component cannot check one and forget the other. The state comes from the
   * address the applicant entered, which is what decides the rule.
   */
  const dateOfBirthErrorMessage = applicantDateOfBirthErrorKey(
    applicant.dateOfBirth,
    applicant.homeAddress.state,
  );
  const dateOfBirthError = dateOfBirthErrorMessage
    ? t(dateOfBirthErrorMessage)
    : null;

  /*
   * Errors appear on blur, not on every keystroke: an email is invalid for
   * almost the whole time it takes to type one, and shouting about it while the
   * applicant is mid-word is noise. Once a field has been touched, its error
   * clears as soon as the value becomes valid.
   */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (field: string) =>
    setTouched((current) => ({ ...current, [field]: true }));

  const problems: Record<string, string | null> = {
    dateOfBirth: dateOfBirthErrorMessage,
    email: checkEmail(applicant.email),
    phone: checkUsPhone(applicant.phone),
    alternatePhone: checkUsPhone(applicant.alternatePhone),
    street: checkStreetAddress(applicant.homeAddress.street),
    city: checkCity(applicant.homeAddress.city),
    zipCode: checkZipCode(applicant.homeAddress.zipCode),
  };

  /** The message to show for a field: only once it has been left. */
  const errorFor = (field: string): string | null =>
    touched[field] && problems[field] ? t(problems[field]!) : null;

  /*
   * Presence comes from the requiredness metadata; format still comes from the
   * per-field checks. The list of required fields used to be repeated here as a
   * chain of Boolean(...) calls, which is how it drifted out of step with what
   * the form showed — marital status was checked nowhere and marked nowhere.
   */
  const missingRequired = missingRequiredApplicantFields(applicant);

  const isValid =
    Object.values(problems).every((problem) => problem === null) &&
    hasEveryRequiredApplicantAnswer(applicant);

  /** Whether a field carries an asterisk. One source, shared with the gate. */
  const isRequired = (id: string) => REQUIRED_APPLICANT_FIELD_IDS.has(id);

  /*
   * Shown only after a Continue attempt. Announcing what is missing before the
   * applicant has tried to move on would be scolding them for not having
   * finished typing.
   */
  const [showMissing, setShowMissing] = useState(false);

  function handleContinue() {
    if (!isValid) {
      // Nothing is cleared: the answers already entered stay exactly as they
      // are, and the applicant is told what is still needed.
      setShowMissing(true);
      setTouched((current) => {
        const next = { ...current };
        for (const field of missingRequired) next[field.id] = true;
        return next;
      });

      return;
    }

    onContinue();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
          SAWS 2 PLUS
        </p>

        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {t("applicant_heading")}
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          {t("applicant_intro")}
        </p>

        <RequiredLegend />

        {/* Basic applicant identity. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              <FieldLabelText labelKey="field_first_name" isRequired={isRequired("firstName")} />
            </span>
            <input
              type="text"
              value={applicant.firstName}
              aria-required={isRequired("firstName")}
              onChange={(event) =>
                onChange("firstName", event.target.value)
              }
              autoComplete="given-name"
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              {t("field_middle_name")}
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
              <FieldLabelText labelKey="field_last_name" isRequired={isRequired("lastName")} />
            </span>
            <input
              type="text"
              value={applicant.lastName}
              aria-required={isRequired("lastName")}
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
              <FieldLabelText labelKey="field_date_of_birth" isRequired={isRequired("dateOfBirth")} />
            </span>
            <input
              type="date"
              value={applicant.dateOfBirth}
              aria-required={isRequired("dateOfBirth")}
              min={dateOfBirthBounds().min}
              max={dateOfBirthBounds().max}
              autoComplete="bday"
              onBlur={() => markTouched("dateOfBirth")}
              aria-invalid={dateOfBirthError !== null}
              aria-describedby={
                dateOfBirthError ? "applicant-dob-error" : undefined
              }
              onChange={(event) =>
                onChange("dateOfBirth", event.target.value)
              }
              className={INPUT_CLASS}
            />

            {/*
              The bounds above only make a bad entry harder; this is the check.
              A paste, a browser that ignores min/max, or a restored session all
              reach here.
            */}
            {dateOfBirthError && (
              <p
                id="applicant-dob-error"
                role="alert"
                className="mt-1 text-xs text-red-700"
              >
                {dateOfBirthError}
              </p>
            )}
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              {t("field_preferred_language")}
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
              <option value="English">{t("opt_lang_english")}</option>
              <option value="Spanish">{t("opt_lang_spanish")}</option>
              <option value="Chinese">{t("opt_lang_chinese")}</option>
              <option value="Other">{t("opt_lang_other")}</option>
            </select>
          </label>
        </div>

        {/* Page 1 asks for any other names the applicant has used. */}
        <div className="mt-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              {t("field_other_names")}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {t("applicant_other_names_help")}
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
              {t("field_phone_number")}
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={applicant.phone}
              onBlur={(event) => {
                markTouched("phone");
                // Put the punctuation back once they have finished typing.
                onChange("phone", formatUsPhone(event.target.value));
              }}
              aria-invalid={errorFor("phone") !== null}
              aria-describedby={errorFor("phone") ? "applicant-phone-error" : undefined}
              onChange={(event) =>
                onChange("phone", event.target.value)
              }
              autoComplete="tel"
              className={INPUT_CLASS}
            />
            <FieldError id="applicant-phone-error" message={errorFor("phone")} />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              {t("field_alternate_phone")}
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={applicant.alternatePhone}
              onBlur={(event) => {
                markTouched("alternatePhone");
                onChange("alternatePhone", formatUsPhone(event.target.value));
              }}
              aria-invalid={errorFor("alternatePhone") !== null}
              aria-describedby={
                errorFor("alternatePhone") ? "applicant-alt-phone-error" : undefined
              }
              onChange={(event) =>
                onChange("alternatePhone", event.target.value)
              }
              className={INPUT_CLASS}
            />
            <FieldError id="applicant-alt-phone-error" message={errorFor("alternatePhone")} />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              {t("field_email")}
            </span>
            <input
              type="email"
              value={applicant.email}
              onBlur={(event) => {
                markTouched("email");
                onChange("email", event.target.value.trim());
              }}
              aria-invalid={errorFor("email") !== null}
              aria-describedby={errorFor("email") ? "applicant-email-error" : undefined}
              onChange={(event) =>
                onChange("email", event.target.value)
              }
              autoComplete="email"
              className={INPUT_CLASS}
            />
            <FieldError id="applicant-email-error" message={errorFor("email")} />
          </label>
        </div>

        {/* Home-address fields used on Page 1. */}
        <fieldset className="mt-6">
          <legend className="text-base font-semibold text-slate-900">
            {t("applicant_home_address")}
          </legend>

          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">
                <FieldLabelText labelKey="field_street_address" isRequired={isRequired("street")} />
              </span>
              <input
                type="text"
                value={applicant.homeAddress.street}
              aria-required={isRequired("street")}
                onBlur={(event) => {
                  markTouched("street");
                  onHomeAddressChange("street", normalizeWhitespace(event.target.value));
                }}
                aria-invalid={errorFor("street") !== null}
                aria-describedby={errorFor("street") ? "applicant-street-error" : undefined}
                onChange={(event) =>
                  onHomeAddressChange(
                    "street",
                    event.target.value,
                  )
                }
                autoComplete="street-address"
                className={INPUT_CLASS}
              />
              <FieldError id="applicant-street-error" message={errorFor("street")} />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("field_apartment")}
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
                <FieldLabelText labelKey="field_city" isRequired={isRequired("city")} />
              </span>
              <input
                type="text"
                value={applicant.homeAddress.city}
              aria-required={isRequired("city")}
                onBlur={(event) => {
                  markTouched("city");
                  onHomeAddressChange("city", normalizeWhitespace(event.target.value));
                }}
                aria-invalid={errorFor("city") !== null}
                aria-describedby={errorFor("city") ? "applicant-city-error" : undefined}
                onChange={(event) =>
                  onHomeAddressChange(
                    "city",
                    event.target.value,
                  )
                }
                autoComplete="address-level2"
                className={INPUT_CLASS}
              />
              <FieldError id="applicant-city-error" message={errorFor("city")} />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("field_state")}
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
                <FieldLabelText labelKey="field_zip_code" isRequired={isRequired("zipCode")} />
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={applicant.homeAddress.zipCode}
              aria-required={isRequired("zipCode")}
                onBlur={(event) => {
                  markTouched("zipCode");
                  onHomeAddressChange("zipCode", normalizeZipCode(event.target.value));
                }}
                aria-invalid={errorFor("zipCode") !== null}
                aria-describedby={errorFor("zipCode") ? "applicant-zip-error" : undefined}
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
              <FieldError id="applicant-zip-error" message={errorFor("zipCode")} />
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
            {t("applicant_mailing_same")}
          </span>
        </label>

        {/* Applicant row details used on SAWS Page 3. */}
        <section className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-base font-semibold text-slate-900">
            {t("applicant_household_details")}
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            {t("applicant_household_details_help")}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("field_sex")}
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
                <option value="">{t("opt_select")}</option>
                <option value="male">{t("opt_male")}</option>
                <option value="female">{t("opt_female")}</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                <FieldLabelText labelKey="field_marital_status" isRequired={isRequired("maritalStatus")} />
              </span>

              <select
                value={
                  applicant.householdDetails.maritalStatus
                  ?? ""
                }
                aria-required={isRequired("maritalStatus")}
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
                <option value="">{t("opt_select")}</option>
                <option value="single">{t("opt_single")}</option>
                <option value="married">{t("opt_married")}</option>
                <option value="separated">{t("opt_separated")}</option>
                <option value="divorced">{t("opt_divorced")}</option>
                <option value="widowed">{t("opt_widowed")}</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {/*
              A tri-state, so `aria-required` sits on the group rather than on
              a control: neither button is "the" input, and the answer is
              missing only while both are unpressed.
            */}
            <fieldset
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              aria-required={isRequired("citizenOrNational")}
            >
              <legend className="px-1 text-sm font-medium text-slate-800">
                <FieldLabelText
                  labelKey="applicant_citizen_question"
                  isRequired={isRequired("citizenOrNational")}
                />
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
                  {t("ui_yes")}
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
                  {t("ui_no")}
                </button>
              </div>
            </fieldset>

            <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-medium text-slate-800">
                {t("applicant_student_question")}
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
                  {t("ui_yes")}
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
                  {t("ui_no")}
                </button>
              </div>
            </fieldset>

            <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-medium text-slate-800">
                {t("hh_q_disabled")}
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
                  {t("ui_yes")}
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
                  {t("ui_no")}
                </button>
              </div>
            </fieldset>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            {t("applicant_privacy_note")}
          </p>
        </section>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("applicant_back")}
          </button>

          {/*
            Enabled but blocking, rather than disabled. A disabled button
            cannot be focused, so someone navigating by keyboard or screen
            reader reaches the end of the form and is told nothing; pressing
            this one explains what is still needed. `aria-disabled` keeps the
            state announced without removing it from the tab order.
          */}
          <button
            type="button"
            onClick={handleContinue}
            aria-disabled={!isValid}
            className={
              isValid
                ? "rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
                : "rounded-lg bg-green-700/40 px-4 py-2 text-sm font-medium text-white"
            }
          >
            {t("applicant_continue")}
          </button>
        </div>

        {/*
          A live region, so the message is announced when it appears rather
          than only being visible. It names the outstanding fields instead of
          saying "some fields are missing" and leaving the applicant to hunt.
        */}
        <div aria-live="polite">
          {showMissing && !isValid && (
            <div
              data-testid="applicant-required-missing"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
            >
              <p className="text-sm font-medium text-red-900">
                {t("validation_required_missing")}
              </p>

              {missingRequired.length > 0 && (
                <p className="mt-1 text-sm text-red-800">
                  {tv("validation_still_needed", {
                    fields: missingRequired
                      .map((field) => t(field.labelKey))
                      .join(", "),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}