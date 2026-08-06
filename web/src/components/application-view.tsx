//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useState } from "react";

import ApplicantStep from "./application/applicant-step";
import HouseholdStep from "./application/household-step";
import ProgramSelectionStep from "./application/program-selection-step";

import type {
  ApplicationRecommendation,
  Saws2PlusProgram,
} from "@/lib/report-assembler";

import {
  EMPTY_APPLICATION_DATA,
  type ApplicantInformation,
  type ApplicationPrefill,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

type ApplicationStep =
  "programs" | "applicant" | "household" | "household-complete";

interface ApplicationViewProps {
  recommendation: ApplicationRecommendation;
  prefill: ApplicationPrefill | null;
  onBack: () => void;
}

const PROGRAM_LABELS: Record<Saws2PlusProgram, string> = {
  medi_cal: "Medi-Cal",
  calfresh: "CalFresh",
  calworks: "CalWORKs",
};

export default function ApplicationView({
  recommendation,
  prefill,
  onBack,
}: ApplicationViewProps) {
  const [step, setStep] = useState<ApplicationStep>("programs");

  const [applicationData, setApplicationData] =
  useState<Saws2PlusApplicationData>(() => {
    const prefilledMembers: HouseholdMember[] =
      prefill?.householdMembers.map((member) => ({
        id: crypto.randomUUID(),
        firstName: '',
        middleName: '',
        lastName: '',
        dateOfBirth: member.dateOfBirth ?? '',
        age: member.age,
        relationshipToApplicant: '',
      })) ?? [];

    return {
      ...EMPTY_APPLICATION_DATA,

      applicant: {
        ...EMPTY_APPLICATION_DATA.applicant,

        preferredLanguage:
          prefill?.preferredLanguage ||
          EMPTY_APPLICATION_DATA.applicant.preferredLanguage,

        homeAddress: {
          ...EMPTY_APPLICATION_DATA.applicant.homeAddress,
          city: prefill?.city ?? '',
          state: prefill?.state || 'CA',
          zipCode: prefill?.zipCode ?? '',
        },

        mailingAddress: {
          ...EMPTY_APPLICATION_DATA.applicant.mailingAddress,
          city: prefill?.city ?? '',
          state: prefill?.state || 'CA',
          zipCode: prefill?.zipCode ?? '',
        },
      },

      householdMembers: prefilledMembers,

      annualHouseholdIncome: prefill?.annualHouseholdIncome,
      incomeType: prefill?.incomeType ?? '',
      existingBenefits: prefill?.existingBenefits ?? '',
    };
  });

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

  function toggleProgram(program: Saws2PlusProgram) {
    setSelectedPrograms((current) => ({
      ...current,
      [program]: !current[program],
    }));
  }

  function continueFromPrograms() {
    const selected = Object.entries(selectedPrograms)
      .filter(([, isSelected]) => isSelected)
      .map(([program]) => program as Saws2PlusProgram);

    setApplicationData((current) => ({
      ...current,
      selectedPrograms: selected,
    }));

    setStep("applicant");
  }

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

  function addHouseholdMember() {
    const member: HouseholdMember = {
      id: crypto.randomUUID(),
      firstName: "",
      middleName: "",
      lastName: "",
      dateOfBirth: "",
      relationshipToApplicant: "",
    };

    setApplicationData((current) => ({
      ...current,
      householdMembers: [...current.householdMembers, member],
    }));
  }

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

  function removeHouseholdMember(memberId: string) {
    setApplicationData((current) => ({
      ...current,
      householdMembers: current.householdMembers.filter(
        (member) => member.id !== memberId,
      ),
    }));
  }

  switch (step) {
    case "applicant":
      return (
        <ApplicantStep
          applicant={applicationData.applicant}
          onChange={updateApplicantField}
          onHomeAddressChange={updateHomeAddressField}
          onBack={() => setStep("programs")}
          onContinue={() => setStep("household")}
        />
      );

    case "household":
      return (
        <HouseholdStep
          applicant={applicationData.applicant}
          members={applicationData.householdMembers}
          onAdd={addHouseholdMember}
          onUpdate={updateHouseholdMember}
          onRemove={removeHouseholdMember}
          onBack={() => setStep("applicant")}
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

            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-900">
                Selected programs:{" "}
                {applicationData.selectedPrograms
                  .map((program) => PROGRAM_LABELS[program])
                  .join(", ")}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setStep("household")}
              className="mt-5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to household members
            </button>
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
          onBack={onBack}
          onContinue={continueFromPrograms}
        />
      );
  }
}
