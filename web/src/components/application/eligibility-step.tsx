//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import type {
  ApplicationPreferences,
  ExpeditedServiceInformation,
  PersonalEmergencyInformation,
  PregnancyInformation,
} from "@/types/application";
import { useTranslation } from "@/hooks/use-translation";

interface EligibilityStepProps {
  preferences: ApplicationPreferences;
  expeditedService: ExpeditedServiceInformation;
  pregnancy: PregnancyInformation;
  personalEmergency: PersonalEmergencyInformation;

  onPreferenceChange: <K extends keyof ApplicationPreferences>(
    field: K,
    value: ApplicationPreferences[K],
  ) => void;

  onExpeditedChange: <K extends keyof ExpeditedServiceInformation>(
    field: K,
    value: ExpeditedServiceInformation[K],
  ) => void;

  onPregnancyChange: <K extends keyof PregnancyInformation>(
    field: K,
    value: PregnancyInformation[K],
  ) => void;

  onEmergencyChange: <K extends keyof PersonalEmergencyInformation>(
    field: K,
    value: PersonalEmergencyInformation[K],
  ) => void;

  onBack: () => void;
  onContinue: () => void;
}

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
    <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <legend className="px-1 text-sm font-medium text-slate-900">
        {label}
      </legend>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={
            value === true
              ? "rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white"
              : "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          }
        >
          Yes
        </button>

        <button
          type="button"
          onClick={() => onChange(false)}
          className={
            value === false
              ? "rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white"
              : "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          }
        >
          No
        </button>
      </div>
    </fieldset>
  );
}

export default function EligibilityStep({
  preferences,
  expeditedService,
  pregnancy,
  personalEmergency,
  onPreferenceChange,
  onExpeditedChange,
  onPregnancyChange,
  onEmergencyChange,
  onBack,
  onContinue,
}: EligibilityStepProps) {
  const { t } = useTranslation();

  const requiredAnswers = [
    preferences.needsDisabilityApplicationHelp,
    preferences.homeless,
    expeditedService.grossIncomeUnder150AndResourcesUnder100,
    expeditedService.incomeAndResourcesLessThanHousingCosts,
    expeditedService.migrantOrSeasonalFarmWorker,
    expeditedService.evictionNotice,
    expeditedService.utilitiesShutOffOrNotice,
    expeditedService.foodRunsOutWithinThreeDays,
    expeditedService.needsEssentialClothing,
    expeditedService.needsTransportationForEmergencyNeeds,
    pregnancy.anyonePregnant,
    personalEmergency.hasEmergency,
  ];

  const isComplete = requiredAnswers.every(
    (answer) => typeof answer === "boolean",
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
          SAWS 2 PLUS
        </p>

        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {t("elig_heading")}
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          {t("elig_intro")}
        </p>

        <section className="mt-6">
          <h2 className="text-base font-semibold text-slate-900">
            {t("elig_preferences")}
          </h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <YesNoQuestion
              label="Do you have a disability and need help applying?"
              value={preferences.needsDisabilityApplicationHelp}
              onChange={(value) =>
                onPreferenceChange("needsDisabilityApplicationHelp", value)
              }
            />

            <YesNoQuestion
              label="Are you currently homeless?"
              value={preferences.homeless}
              onChange={(value) => onPreferenceChange("homeless", value)}
            />

            <YesNoQuestion
              label="Do you want information about this application by email?"
              value={preferences.emailApplicationInformation}
              onChange={(value) =>
                onPreferenceChange("emailApplicationInformation", value)
              }
            />

            <YesNoQuestion
              label="Do you want messages about your case by email?"
              value={preferences.emailCaseMessages}
              onChange={(value) =>
                onPreferenceChange("emailCaseMessages", value)
              }
            />

            <YesNoQuestion
              label="Are you deaf or hard of hearing?"
              value={preferences.deafOrHardOfHearing}
              onChange={(value) =>
                onPreferenceChange("deafOrHardOfHearing", value)
              }
            />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">
            {t("elig_faster")}
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            {t("elig_faster_intro")}
          </p>

          <div className="mt-3 space-y-3">
            <YesNoQuestion
              label="Is your household's gross income under $150 and cash/checking/savings $100 or less?"
              value={
                expeditedService.grossIncomeUnder150AndResourcesUnder100
              }
              onChange={(value) =>
                onExpeditedChange(
                  "grossIncomeUnder150AndResourcesUnder100",
                  value,
                )
              }
            />

            <YesNoQuestion
              label="Are your household's combined income and liquid resources less than rent/mortgage and utilities?"
              value={
                expeditedService.incomeAndResourcesLessThanHousingCosts
              }
              onChange={(value) =>
                onExpeditedChange(
                  "incomeAndResourcesLessThanHousingCosts",
                  value,
                )
              }
            />

            <YesNoQuestion
              label="Is your household a migrant or seasonal farm worker household with $100 or less in liquid resources?"
              value={expeditedService.migrantOrSeasonalFarmWorker}
              onChange={(value) =>
                onExpeditedChange("migrantOrSeasonalFarmWorker", value)
              }
            />

            <YesNoQuestion
              label="Do you have an eviction notice or notice to pay rent or leave?"
              value={expeditedService.evictionNotice}
              onChange={(value) =>
                onExpeditedChange("evictionNotice", value)
              }
            />

            <YesNoQuestion
              label="Have your utilities been shut off, or do you have a shut-off notice?"
              value={expeditedService.utilitiesShutOffOrNotice}
              onChange={(value) =>
                onExpeditedChange("utilitiesShutOffOrNotice", value)
              }
            />

            <YesNoQuestion
              label="Will your food run out within three days?"
              value={expeditedService.foodRunsOutWithinThreeDays}
              onChange={(value) =>
                onExpeditedChange("foodRunsOutWithinThreeDays", value)
              }
            />

            <YesNoQuestion
              label="Do you need essential clothing, such as diapers or cold-weather clothing?"
              value={expeditedService.needsEssentialClothing}
              onChange={(value) =>
                onExpeditedChange("needsEssentialClothing", value)
              }
            />

            <YesNoQuestion
              label="Do you need transportation to get food, clothing, medical care, or another emergency item?"
              value={
                expeditedService.needsTransportationForEmergencyNeeds
              }
              onChange={(value) =>
                onExpeditedChange(
                  "needsTransportationForEmergencyNeeds",
                  value,
                )
              }
            />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">
            {t("elig_pregnancy")}
          </h2>

          <div className="mt-3 space-y-3">
            <YesNoQuestion
              label="Is anyone in the household pregnant?"
              value={pregnancy.anyonePregnant}
              onChange={(value) =>
                onPregnancyChange("anyonePregnant", value)
              }
            />

            {pregnancy.anyonePregnant === true && (
              <YesNoQuestion
                label="Did the pregnant person receive a Presumptive Eligibility card?"
                value={pregnancy.presumptiveEligibilityCard}
                onChange={(value) =>
                  onPregnancyChange("presumptiveEligibilityCard", value)
                }
              />
            )}

            <YesNoQuestion
              label="Does anyone in your household have a personal emergency?"
              value={personalEmergency.hasEmergency}
              onChange={(value) =>
                onEmergencyChange("hasEmergency", value)
              }
            />

            {personalEmergency.hasEmergency === true && (
              <fieldset className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <legend className="px-1 text-sm font-medium text-amber-950">
                  {t("elig_emergency_types")}
                </legend>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["pregnancy", "Pregnancy"],
                      ["immediateMedicalNeed", "Immediate medical need"],
                      ["childAbuse", "Child abuse"],
                      ["domesticAbuse", "Domestic abuse"],
                      ["elderAbuse", "Elder abuse"],
                      ["otherEmergency", "Other health or safety emergency"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={personalEmergency[field] === true}
                        onChange={(event) =>
                          onEmergencyChange(field, event.target.checked)
                        }
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-green-700 focus:ring-green-600"
                      />

                      <span className="text-sm text-slate-800">{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </section>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("elig_back")}
          </button>

          <button
            type="button"
            onClick={onContinue}
            disabled={!isComplete}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("elig_continue")}
          </button>
        </div>
      </div>
    </div>
  );
}