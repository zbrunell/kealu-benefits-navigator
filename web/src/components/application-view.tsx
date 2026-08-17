//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useState } from "react";

import { buildInitialApplicationData } from "@/lib/application-data";
import { householdSizeFromMembers } from "@/lib/household";

import ApplicantStep from "./application/applicant-step";
import { evaluateApplicationReadiness } from "@/lib/saws2-readiness";

import DraftCompletionGuide from "./application/draft-completion-guide";
import EligibilityStep from "./application/eligibility-step";
import HouseholdStep from "./application/household-step";
import ProgramSelectionStep from "./application/program-selection-step";
import QuestionnaireStep from "./application/questionnaire-step";

import type {
  ApplicationRecommendation,
  Saws2PlusProgram,
} from "@/lib/report-assembler";

import {
  type ApplicantInformation,
  type ApplicationPrefill,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from "@/types/application";

type ApplicationStep =
  | "programs"
  | "applicant"
  | "eligibility"
  | "household"
  | "questionnaire"
  | "household-complete";

interface ApplicationViewProps {
  runId: string;
  recommendation: ApplicationRecommendation;
  prefill: ApplicationPrefill | null;
  onBack: () => void;
}

const PROGRAM_LABELS: Record<Saws2PlusProgram, string> = {
  medi_cal: "Medi-Cal",
  calfresh: "CalFresh",
  calworks: "CalWORKs",
};

/**
 * ApplicationView owns the structured SAWS 2 PLUS application state.
 *
 * The UI collects semantic application answers only. It intentionally knows
 * nothing about PDF AcroForm field names; application-mapper.ts converts this
 * state into canonical fields and Python owns form-specific PDF mapping.
 */
export default function ApplicationView({
  runId,
  recommendation,
  prefill,
  onBack,
}: ApplicationViewProps) {
  const [step, setStep] = useState<ApplicationStep>("programs");

  const [isGenerating, setIsGenerating] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [guideUrl, setGuideUrl] = useState<string>("");
  const [draftReference, setDraftReference] = useState<string>("");
  const [generationError, setGenerationError] = useState<string | null>(null);

  /**
   * Initialize application state from the earlier intake where possible.
   *
   * Unknown answers remain blank/undefined rather than being guessed. This is
   * particularly important for government-form answers such as citizenship,
   * disability, program participation, and household-member details.
   */
  const [applicationData, setApplicationData] = useState<Saws2PlusApplicationData>(
    () => buildInitialApplicationData(prefill),
  );

  /**
   * Program selection is initially based on recommendation output, but the user
   * remains in control of which programs are actually included.
   */
  const [selectedPrograms, setSelectedPrograms] = useState<
    Record<Saws2PlusProgram, boolean>
  >(() => {
    const initialSelections: Record<Saws2PlusProgram, boolean> = {
      medi_cal: false,
      calfresh: false,
      calworks: false,
    };

    for (const program of recommendation.programs) {
      initialSelections[program.program] = program.recommendedToApply;
    }

    return initialSelections;
  });

  /**
   * Household size: the primary applicant plus every member row. Derived on
   * render rather than stored, so it cannot drift out of sync when members are
   * added, removed, or edited.
   */
  const householdSize = householdSizeFromMembers(
    applicationData.householdMembers.length,
  );

  /**
   * What the generated draft still leaves for the applicant to do by hand.
   *
   * Derived from the semantic inventory rather than a field count, so the
   * completion guide can name the printed questions rather than gesture at them.
   */
  const draftCompleteness = evaluateApplicationReadiness(
    applicationData,
    applicationData.selectedPrograms,
  ).draftCompleteness;

  function toggleProgram(program: Saws2PlusProgram) {
    setSelectedPrograms((current) => ({
      ...current,
      [program]: !current[program],
    }));
  }

  function toggleOtherProgram() {
    setApplicationData((current) => ({
      ...current,
      otherProgramRequested: !current.otherProgramRequested,
      // Clearing the box also clears the description so a stale answer is
      // never written to the form.
      otherProgramDescription: current.otherProgramRequested
        ? ""
        : current.otherProgramDescription,
    }));
  }

  function updateOtherProgramDescription(value: string) {
    setApplicationData((current) => ({
      ...current,
      otherProgramDescription: value,
    }));
  }

  function continueFromPrograms() {
    const selected = Object.entries(selectedPrograms)
      .filter(([, isSelected]) => isSelected)
      .map(([program]) => program as Saws2PlusProgram);

    setApplicationData((current) => ({
      ...current,
      selectedPrograms: selected,

      /**
       * Default the primary applicant to the programs selected for this
       * application. Household members remain independently configurable.
       *
       * The user can change this later when editing household details.
       */
      applicant: {
        ...current.applicant,
        householdDetails: {
          ...current.applicant.householdDetails,
          applyingFor: selected,
        },
      },
    }));

    setStep("applicant");
  }

  /** Update a top-level applicant field such as name, phone, or DOB. */
  function updateApplicantField<K extends keyof ApplicantInformation>(
    field: K,
    value: ApplicantInformation[K],
  ) {
    setApplicationData((current) => ({
      ...current,
      applicant: {
        ...current.applicant,
        [field]: value,
      },
    }));
  }

  /** Update one field in the applicant's home address. */
  function updateHomeAddressField(
    field: keyof ApplicantInformation["homeAddress"],
    value: string,
  ) {
    setApplicationData((current) => ({
      ...current,
      applicant: {
        ...current.applicant,
        homeAddress: {
          ...current.applicant.homeAddress,
          [field]: value,
        },
      },
    }));
  }

  /** Update one Page 1 application-preference answer. */
  function updatePreferenceField<
    K extends keyof Saws2PlusApplicationData["preferences"],
  >(
    field: K,
    value: Saws2PlusApplicationData["preferences"][K],
  ) {
    setApplicationData((current) => ({
      ...current,
      preferences: {
        ...current.preferences,
        [field]: value,
      },
    }));
  }

  /** Update one expedited-service screening answer. */
  function updateExpeditedField<
    K extends keyof Saws2PlusApplicationData["expeditedService"],
  >(
    field: K,
    value: Saws2PlusApplicationData["expeditedService"][K],
  ) {
    setApplicationData((current) => ({
      ...current,
      expeditedService: {
        ...current.expeditedService,
        [field]: value,
      },
    }));
  }

  /** Update pregnancy-related Page 1 information. */
  function updatePregnancyField<
    K extends keyof Saws2PlusApplicationData["pregnancy"],
  >(
    field: K,
    value: Saws2PlusApplicationData["pregnancy"][K],
  ) {
    setApplicationData((current) => ({
      ...current,
      pregnancy: {
        ...current.pregnancy,
        [field]: value,
      },
    }));
  }

  /** Update personal-emergency information from Page 1. */
  function updateEmergencyField<
    K extends keyof Saws2PlusApplicationData["personalEmergency"],
  >(
    field: K,
    value: Saws2PlusApplicationData["personalEmergency"][K],
  ) {
    setApplicationData((current) => ({
      ...current,
      personalEmergency: {
        ...current.personalEmergency,
        [field]: value,
      },
    }));
  }

  /**
   * Add a blank household member.
   *
   * Sensitive values such as SSNs are intentionally not part of this model.
   */
  function addHouseholdMember() {
    const member: HouseholdMember = {
      id: crypto.randomUUID(),
      firstName: "",
      middleName: "",
      lastName: "",
      dateOfBirth: "",
      relationshipToApplicant: "",

      adultDetails: {
        applyingFor: [],
        sex: undefined,
        citizenOrNational: undefined,
        fullTimeStudent: undefined,
        disabled: undefined,
        maritalStatus: undefined,
      },

      childDetails: {
        applyingFor: [],
        sex: undefined,
        citizenOrNational: undefined,
        fullTimeStudent: undefined,
        disabled: undefined,
        placeOfBirth: "",
        immunizationsUpToDate: undefined,

        parentStatus: {
          notInHome: undefined,
          unemployed: undefined,
          disabled: undefined,
          deceased: undefined,
          none: undefined,
        },
      },
    };

    setApplicationData((current) => ({
      ...current,
      householdMembers: [...current.householdMembers, member],
    }));
  }

  /** Update a household member's base identity/demographic field. */
  function updateHouseholdMember<K extends keyof HouseholdMember>(
    memberId: string,
    field: K,
    value: HouseholdMember[K],
  ) {
    setApplicationData((current) => ({
      ...current,
      householdMembers: current.householdMembers.map((member) =>
        member.id === memberId
          ? {
              ...member,
              [field]: value,
            }
          : member,
      ),
    }));
  }

  /**
   * Update an adult-specific field for one household member.
   *
   * This separate updater keeps adult fields nested rather than flattening the
   * application model around SAWS-specific table columns.
   */
  function updateHouseholdAdultDetails<
    K extends NonNullable<HouseholdMember["adultDetails"]> extends infer T
      ? keyof T
      : never,
  >(
    memberId: string,
    field: K,
    value: NonNullable<HouseholdMember["adultDetails"]>[K],
  ) {
    setApplicationData((current) => ({
      ...current,
      householdMembers: current.householdMembers.map((member) => {
        if (member.id !== memberId) {
          return member;
        }

        const adultDetails =
          member.adultDetails ?? {
            applyingFor: [],
          };

        return {
          ...member,
          adultDetails: {
            ...adultDetails,
            [field]: value,
          },
        };
      }),
    }));
  }

  /**
   * Update a child-specific field for one household member.
   */
  function updateHouseholdChildDetails<
    K extends NonNullable<HouseholdMember["childDetails"]> extends infer T
      ? keyof T
      : never,
  >(
    memberId: string,
    field: K,
    value: NonNullable<HouseholdMember["childDetails"]>[K],
  ) {
    setApplicationData((current) => ({
      ...current,
      householdMembers: current.householdMembers.map((member) => {
        if (member.id !== memberId) {
          return member;
        }

        const childDetails =
          member.childDetails ?? {
            applyingFor: [],
            placeOfBirth: "",
            parentStatus: {},
          };

        return {
          ...member,
          childDetails: {
            ...childDetails,
            [field]: value,
          },
        };
      }),
    }));
  }

  /**
   * Update one child parent-status checkbox without replacing the rest of that
   * nested state.
   */
  function updateChildParentStatus(
    memberId: string,
    field: keyof NonNullable<
      HouseholdMember["childDetails"]
    >["parentStatus"],
    value: boolean | undefined,
  ) {
    setApplicationData((current) => ({
      ...current,
      householdMembers: current.householdMembers.map((member) => {
        if (member.id !== memberId) {
          return member;
        }

        const childDetails =
          member.childDetails ?? {
            applyingFor: [],
            placeOfBirth: "",
            parentStatus: {},
          };

        return {
          ...member,
          childDetails: {
            ...childDetails,
            parentStatus: {
              ...childDetails.parentStatus,
              [field]: value,
            },
          },
        };
      }),
    }));
  }

  function removeHouseholdMember(memberId: string) {
    setApplicationData((current) => ({
      ...current,
      householdMembers: current.householdMembers.filter(
        (member) => member.id !== memberId,
      ),
    }));
  }

  /**
   * Generate the official partially-prefilled PDF through the authenticated
   * workflow draft endpoint.
   */
  async function handleGenerateApplication() {
    setIsGenerating(true);
    setGenerationError(null);
    setDraftUrl(null);

    try {
      const response = await fetch(`/api/workflow/${runId}/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          applicationData,
        }),
      });

      const result = (await response.json()) as {
        draftUrl?: string;
        guideUrl?: string;
        draftReference?: string;
        error?: string;
      };

      if (!response.ok || !result.draftUrl) {
        throw new Error(
          result.error ?? "Failed to generate application draft.",
        );
      }

      setDraftUrl(result.draftUrl);
      setGuideUrl(result.guideUrl ?? `/api/workflow/${runId}/guide`);
      setDraftReference(result.draftReference ?? "");
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : "Failed to generate application draft.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  switch (step) {
    case "applicant":
      return (
        <ApplicantStep
          applicant={applicationData.applicant}
          onChange={updateApplicantField}
          onHomeAddressChange={updateHomeAddressField}
          onBack={() => setStep("programs")}
          onContinue={() => setStep("eligibility")}
        />
      );

    case "eligibility":
      return (
        <EligibilityStep
          preferences={applicationData.preferences}
          expeditedService={applicationData.expeditedService}
          pregnancy={applicationData.pregnancy}
          personalEmergency={applicationData.personalEmergency}
          onPreferenceChange={updatePreferenceField}
          onExpeditedChange={updateExpeditedField}
          onPregnancyChange={updatePregnancyField}
          onEmergencyChange={updateEmergencyField}
          onBack={() => setStep("applicant")}
          onContinue={() => setStep("household")}
        />
      );

    case "household":
      return (
        <HouseholdStep
          applicant={applicationData.applicant}
          members={applicationData.householdMembers}
          selectedPrograms={applicationData.selectedPrograms}
          onAdd={addHouseholdMember}
          onUpdate={updateHouseholdMember}
          onAdultDetailsChange={updateHouseholdAdultDetails}
          onChildDetailsChange={updateHouseholdChildDetails}
          onChildParentStatusChange={updateChildParentStatus}
          onRemove={removeHouseholdMember}
          onBack={() => setStep("eligibility")}
          onContinue={() => setStep("questionnaire")}
        />
      );

    case "questionnaire":
      return (
        <QuestionnaireStep
          application={applicationData}
          onChange={setApplicationData}
          onBack={() => setStep("household")}
          onContinue={() => setStep("household-complete")}
        />
      );

    case "household-complete":
      return (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
              SAWS 2 PLUS
            </p>

            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              Household information saved
            </h1>

            <p className="mt-2 text-sm text-slate-600">
              Your application includes the primary applicant and{" "}
              {applicationData.householdMembers.length} additional household{" "}
              {applicationData.householdMembers.length === 1
                ? "member"
                : "members"}
              .
            </p>

            {/* Household size is derived from the rows above — never asked for
                separately — so it always matches what was entered. */}
            <p className="mt-1 text-sm font-medium text-slate-700">
              Household size: {householdSize}
            </p>

            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-900">
                Selected programs:{" "}
                {applicationData.selectedPrograms
                  .map((program) => PROGRAM_LABELS[program])
                  .join(", ")}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep("questionnaire")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to questions
              </button>

              <button
                type="button"
                onClick={handleGenerateApplication}
                disabled={isGenerating}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? "Generating…" : "Generate application"}
              </button>
            </div>

            {generationError && (
              <p className="mt-4 text-sm text-red-700" role="alert">
                {generationError}
              </p>
            )}

            {draftUrl && (
              <DraftCompletionGuide
                draftUrl={draftUrl}
                guideUrl={guideUrl}
                draftReference={draftReference}
                county={prefill?.county ?? ""}
                includesHealthCoverage={applicationData.selectedPrograms.includes(
                  "medi_cal",
                )}
                /*
                 * Named rather than summarised: readiness knows exactly which
                 * printed questions this draft leaves blank, so the applicant
                 * gets a checklist instead of "complete anything we missed".
                 */
                questionsToCompleteByHand={[
                  ...draftCompleteness.answeredButNotWritable,
                  ...draftCompleteness.notModeled,
                  ...draftCompleteness.overflow,
                ].map((item) => item.requirement)}
              />
            )}
          </div>
        </div>
      );

    case "programs":
    default:
      return (
        <ProgramSelectionStep
          recommendation={recommendation}
          selectedPrograms={selectedPrograms}
          onToggleProgram={toggleProgram}
          otherRequested={applicationData.otherProgramRequested === true}
          otherDescription={applicationData.otherProgramDescription}
          onToggleOther={toggleOtherProgram}
          onOtherDescriptionChange={updateOtherProgramDescription}
          onBack={onBack}
          onContinue={continueFromPrograms}
        />
      );
  }
}