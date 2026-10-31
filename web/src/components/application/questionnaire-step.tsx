//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

import { useMemo, useState } from "react";

import {
  REQUIREMENT_HINT_KEYS,
  REQUIREMENT_LABEL_KEYS,
  getActiveAppendices,
  getRequiredApplicationQuestions,
  isPersonScoped,
  memberOptions,
  readPath,
  safeEntries,
  selectableMembers,
  writePath,
  type PlannedQuestion,
} from "@/lib/saws2-question-planner";
import {
  back as navigatorBack,
  canSkip,
  currentQuestion,
  draftKind,
  resync,
  setDraft as setNavigatorDraft,
  shouldSubmitOnKey,
  skipCurrent,
  startFlow,
  submitChoice,
  submitDraft,
  usesDraft,
  validateDraft,
  type QuestionFlowState,
} from "@/lib/saws2-question-navigator";
import { dateOfBirthBounds } from "@/lib/date-of-birth";
import { useTranslation } from "@/hooks/use-translation";
import type { Saws2PlusApplicationData } from "@/types/application";

/** Last segment of a dotted path, e.g. `dateOfBirth`. */
const leafOf = (path: string): string => path.split(".").pop() ?? "";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 " +
  "focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600";

/**
 * Blank records for each repeatable section, keyed by the planner's entries
 * path. Record shapes are declared here so the generic editor knows which inputs
 * to render — every value starts empty or undefined so nothing is invented.
 */
const RECORD_FACTORIES: Record<string, (id: string, memberId: string) => Record<string, unknown>> = {
  "circumstances.authorizedRepresentative.entries": () => ({
    name: "",
    organization: "",
    phone: "",
    street: "",
    apartment: "",
    city: "",
    state: "",
    zipCode: "",
    forCalFresh: undefined,
    forHealthCoverage: undefined,
  }),
  "circumstances.militaryService.entries": (id, memberId) => ({
    id,
    memberId,
    relationshipToService: "",
    branch: "",
  }),
  "circumstances.students.entries": (id, memberId) => ({
    id,
    memberId,
    schoolName: "",
    halfTimeOrMore: undefined,
  }),
  "circumstances.absentParents.entries": (id, memberId) => ({
    id,
    memberId,
    parentName: "",
    lastKnownLocation: "",
  }),
  "circumstances.fosterCare.entries": (id, memberId) => ({
    id,
    memberId,
    agencyName: "",
    monthlyPayment: undefined,
  }),
  "income.earned.entries": (id, memberId) => ({
    id,
    memberId,
    employerName: "",
    employerAddress: "",
    employerPhone: "",
    startDate: "",
    payFrequency: undefined,
    hourlyRate: undefined,
    hoursPerWeek: undefined,
    grossPerPeriod: undefined,
    grossReceivedThisMonth: undefined,
    expectedToContinue: undefined,
  }),
  "income.selfEmployment.entries": (id, memberId) => ({
    id,
    memberId,
    businessName: "",
    businessType: "",
    startDate: "",
    grossMonthly: undefined,
    netMonthly: undefined,
    expenseMethod: undefined,
    expenseAmount: undefined,
  }),
  "income.unearned.entries": (id, memberId) => ({
    id,
    memberId,
    source: "",
    // The form asks how much and how often, so both are collected as reported
    // rather than asking the applicant to convert to a monthly figure.
    reportedAmount: undefined,
    reportedFrequency: undefined,
  }),
  "income.inKindSupport.entries": (id, memberId) => ({
    id,
    memberId,
    kind: "housing",
    providedBy: "",
    estimatedMonthlyValue: undefined,
  }),
  "income.recentJobChange.entries": (id, memberId) => ({
    id,
    memberId,
    employerName: "",
    changeDate: "",
    reason: "",
  }),
  "expenses.household.entries": (id) => ({
    id,
    kind: "rent_or_mortgage",
    amountMonthly: undefined,
    description: "",
  }),
  "expenses.dependentCare.entries": (id, memberId) => ({
    id,
    memberId,
    providerName: "",
    amountMonthly: undefined,
    forDependentAdult: undefined,
  }),
  "expenses.childSupportPaid.entries": (id, memberId) => ({
    id,
    memberId,
    paidTo: "",
    amountMonthly: undefined,
    courtOrdered: undefined,
  }),
  "expenses.spousalSupportPaid.entries": (id, memberId) => ({
    id,
    memberId,
    paidTo: "",
    amountMonthly: undefined,
    courtOrdered: undefined,
  }),
  "expenses.medical.entries": (id, memberId) => ({
    id,
    memberId,
    kind: "",
    amountMonthly: undefined,
  }),
  "expenses.otherTaxDeductible.entries": (id) => ({
    id,
    kind: "other",
    amountMonthly: undefined,
    description: "",
  }),
  "health.currentCoverage.entries": (id, memberId) => ({
    id,
    memberId,
    planName: "",
    policyHolderName: "",
    endDate: "",
  }),
  "health.coverageEnding.entries": (id, memberId) => ({
    id,
    memberId,
    planName: "",
    policyHolderName: "",
    endDate: "",
  }),
  "health.employerCoverage.entries": (id, memberId) => ({
    id,
    memberId,
    employerName: "",
    employerPhone: "",
    offersCoverage: undefined,
    eligibleNowOrSoon: undefined,
    lowestCostPremium: undefined,
    premiumFrequency: undefined,
  }),
  "resources.accounts.entries": (id, memberId) => ({
    id,
    memberId,
    kind: "checking",
    institution: "",
    balance: undefined,
  }),
  "resources.vehicles.entries": (id, memberId) => ({
    id,
    memberId,
    year: "",
    make: "",
    model: "",
    usedFor: "",
    amountOwed: undefined,
    estimatedValue: undefined,
  }),
  "resources.realProperty.entries": (id, memberId) => ({
    id,
    memberId,
    kind: "home",
    description: "",
    estimatedValue: undefined,
  }),
  "resources.transferredResources.entries": (id, memberId) => ({
    id,
    memberId,
    kind: "other",
    description: "",
    estimatedValue: undefined,
  }),
  "appendices.employmentHistory.entries": (id, memberId) => ({
    id,
    memberId,
    employerName: "",
    employerAddress: "",
    jobTitle: "",
    startDate: "",
    endDate: "",
    reasonForLeaving: "",
    hoursWorked: undefined,
    hoursWorkedFrequency: undefined,
    payAmount: undefined,
    payRateFrequency: undefined,
    selfEmployed: undefined,
    countyHelpedGetJob: undefined,
  }),
};

/**
 * Catalog keys for record-field labels.
 *
 * The record keys themselves stay English identifiers — they are part of the
 * stored shape — while the words the applicant reads come from the catalog.
 */
const FIELD_LABEL_KEYS: Record<string, string> = {
  phone: "qfield_phone",
  zipCode: "qfield_zipCode",
  state: "qfield_state",
  city: "qfield_city",
  apartment: "qfield_apartment",
  street: "qfield_street",
  memberId: "qfield_memberId",
  employerName: "qfield_employerName",
  startDate: "qfield_startDate",
  endDate: "qfield_endDate",
  changeDate: "qfield_changeDate",
  payFrequency: "qfield_payFrequency",
  employerAddress: "qfield_employerAddress",
  hourlyRate: "qfield_hourlyRate",
  grossPerPeriod: "qfield_grossPerPeriod",
  grossReceivedThisMonth: "qfield_grossReceivedThisMonth",
  expectedToContinue: "qfield_expectedToContinue",
  expenseAmount: "qfield_expenseAmount",
  hoursPerWeek: "qfield_hoursPerWeek",
  businessName: "qfield_businessName",
  businessType: "qfield_businessType",
  grossMonthly: "qfield_grossMonthly",
  netMonthly: "qfield_netMonthly",
  expenseMethod: "qfield_expenseMethod",
  amountMonthly: "qfield_amountMonthly",
  reportedAmount: "qfield_reportedAmount",
  reportedFrequency: "qfield_reportedFrequency",
  estimatedMonthlyValue: "qfield_estimatedMonthlyValue",
  providedBy: "qfield_providedBy",
  providerName: "qfield_providerName",
  forDependentAdult: "qfield_forDependentAdult",
  paidTo: "qfield_paidTo",
  courtOrdered: "qfield_courtOrdered",
  planName: "qfield_planName",
  policyHolderName: "qfield_policyHolderName",
  employerPhone: "qfield_employerPhone",
  offersCoverage: "qfield_offersCoverage",
  eligibleNowOrSoon: "qfield_eligibleNowOrSoon",
  lowestCostPremium: "qfield_lowestCostPremium",
  institution: "qfield_institution",
  balance: "qfield_balance",
  usedFor: "qfield_usedFor",
  amountOwed: "qfield_amountOwed",
  estimatedValue: "qfield_estimatedValue",
  jobTitle: "qfield_jobTitle",
  reasonForLeaving: "qfield_reasonForLeaving",
  hoursWorked: "qfield_hoursWorked",
  hoursWorkedFrequency: "qfield_hoursWorkedFrequency",
  payAmount: "qfield_payAmount",
  payRateFrequency: "qfield_payRateFrequency",
  selfEmployed: "qfield_selfEmployed",
  countyHelpedGetJob: "qfield_countyHelpedGetJob",
  schoolName: "qfield_schoolName",
  halfTimeOrMore: "qfield_halfTimeOrMore",
  relationshipToService: "qfield_relationshipToService",
  branch: "qfield_branch",
  parentName: "qfield_parentName",
  lastKnownLocation: "qfield_lastKnownLocation",
  agencyName: "qfield_agencyName",
  monthlyPayment: "qfield_monthlyPayment",
  organization: "qfield_organization",
  forCalFresh: "qfield_forCalFresh",
  forHealthCoverage: "qfield_forHealthCoverage",
};

const CHOICE_OPTIONS: Record<
  string,
  Array<{ value: string; labelKey: string }>
> = {
  /*
   * These values match FREQUENCY_LABELS in reported-amounts.ts, which is what
   * gets printed in the form's "How often?" columns. The stored value is what
   * drives printing, so the applicant can pick "Cada dos semanas" and the page
   * still records every_two_weeks.
   */
  reportedFrequency: [
    { value: "weekly", labelKey: "qopt_weekly" },
    { value: "every_two_weeks", labelKey: "qopt_every_two_weeks" },
    { value: "twice_a_month", labelKey: "qopt_twice_a_month" },
    { value: "monthly", labelKey: "qopt_monthly" },
    { value: "irregular", labelKey: "qopt_irregular" },
  ],
  payFrequency: [
    { value: "weekly", labelKey: "qopt_weekly" },
    { value: "every_two_weeks", labelKey: "qopt_every_two_weeks" },
    { value: "twice_a_month", labelKey: "qopt_twice_a_month" },
    { value: "monthly", labelKey: "qopt_monthly" },
    { value: "irregular", labelKey: "qopt_irregular" },
  ],
  premiumFrequency: [
    { value: "weekly", labelKey: "qopt_weekly" },
    { value: "every_two_weeks", labelKey: "qopt_every_two_weeks" },
    { value: "twice_a_month", labelKey: "qopt_twice_a_month" },
    { value: "monthly", labelKey: "qopt_monthly" },
  ],
  /*
   * Appendix D's two printed choice rows. Both list exactly the boxes the
   * printed page has, so the applicant can never pick an option the form has
   * nowhere to record.
   */
  hoursWorkedFrequency: [
    { value: "daily", labelKey: "qopt_daily" },
    { value: "weekly", labelKey: "qopt_weekly" },
    { value: "monthly", labelKey: "qopt_monthly" },
  ],
  payRateFrequency: [
    { value: "hourly", labelKey: "qopt_hourly" },
    { value: "daily", labelKey: "qopt_daily" },
    { value: "weekly", labelKey: "qopt_weekly" },
    { value: "every_two_weeks", labelKey: "qopt_every_two_weeks" },
    { value: "monthly", labelKey: "qopt_monthly" },
  ],
  expenseMethod: [
    { value: "standard_40_percent", labelKey: "qopt_standard_40_percent" },
    { value: "actual_expenses", labelKey: "qopt_actual_expenses" },
    { value: "monthly_average", labelKey: "qopt_monthly_average" },
  ],
  kind: [
    { value: "rent_or_mortgage", labelKey: "qopt_rent_or_mortgage" },
    { value: "property_tax", labelKey: "qopt_property_tax" },
    { value: "home_insurance", labelKey: "qopt_home_insurance" },
    { value: "electricity", labelKey: "qopt_electricity" },
    { value: "gas", labelKey: "qopt_gas" },
    { value: "water", labelKey: "qopt_water" },
    { value: "trash", labelKey: "qopt_trash" },
    { value: "telephone", labelKey: "qopt_telephone" },
    { value: "checking", labelKey: "qopt_checking" },
    { value: "savings", labelKey: "qopt_savings" },
    { value: "cash_on_hand", labelKey: "qopt_cash_on_hand" },
    { value: "stocks_or_bonds", labelKey: "qopt_stocks_or_bonds" },
    { value: "trust", labelKey: "qopt_trust" },
    { value: "home", labelKey: "qopt_home" },
    { value: "land", labelKey: "qopt_land" },
    { value: "rental", labelKey: "qopt_rental" },
    { value: "housing", labelKey: "qopt_housing" },
    { value: "utilities", labelKey: "qopt_utilities" },
    { value: "food", labelKey: "qopt_food" },
    { value: "clothing", labelKey: "qopt_clothing" },
    { value: "other", labelKey: "qopt_other" },
  ],
};

/**
 * The applicant-facing name of a record field.
 *
 * `tOr` rather than `t` because the fallback is a real case: a record key with
 * no catalog entry still has to render something, and de-camel-casing the key
 * beats throwing in the middle of a form.
 */
function labelFor(
  key: string,
  tOr: (key: string, fallback: string) => string,
): string {
  const keyed = FIELD_LABEL_KEYS[key];
  const deCamelCased = key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());

  return keyed ? tOr(keyed, deCamelCased) : deCamelCased;
}

const DATE_KEYS = new Set(["startDate", "endDate", "changeDate"]);
const NUMBER_KEYS = new Set([
  "grossPerPeriod",
  "grossReceivedThisMonth",
  "hourlyRate",
  "expenseAmount",
  "hoursPerWeek",
  "grossMonthly",
  "netMonthly",
  "amountMonthly",
  "estimatedMonthlyValue",
  "balance",
  "amountOwed",
  "estimatedValue",
  "lowestCostPremium",
  "monthlyPayment",
  "hoursWorked",
  "payAmount",
]);


/**
 * Three-state Yes/No control. An explicit click commits and advances.
 *
 * Declared at module scope on purpose. A component defined inside the parent
 * gets a new function identity on every render, so React treats it as a
 * different component type, unmounts the previous one and destroys its DOM —
 * which is what previously made record inputs lose focus after one keystroke.
 */
function TriStateControl({
  value,
  onAnswer,
}: {
  value: boolean | undefined;
  onAnswer: (answer: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex items-center gap-2">
      {[
        { labelKey: "ui_yes", answer: true },
        { labelKey: "ui_no", answer: false },
      ].map((option) => (
        <button
          key={option.labelKey}
          type="button"
          onClick={() => onAnswer(option.answer)}
          aria-pressed={value === option.answer}
          className={`rounded-lg border px-5 py-2 text-sm font-medium ${
            value === option.answer
              ? "border-green-700 bg-green-700 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {t(option.labelKey)}
        </button>
      ))}

      {value === undefined && (
        <span className="text-xs text-slate-500">{t("qstep_not_answered_yet")}</span>
      )}
    </div>
  );
}

/**
 * Editor for one repeatable record, derived from the record's own shape.
 *
 * Module scope for the same reason as TriStateControl: a stable component
 * identity is what lets its inputs keep focus and cursor position while typing.
 */
function RecordEditor({
  record,
  memberName,
  onFieldChange,
  onRemove,
  index,
}: {
  record: Record<string, unknown>;
  memberName: string | null;
  onFieldChange: (key: string, value: unknown) => void;
  onRemove: () => void;
  index: number;
}) {
  const { t, tv, tOr } = useTranslation();

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">
          {memberName ? memberName : tv("qstep_entry_number", { number: index + 1 })}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-medium text-red-700 underline hover:text-red-900"
        >
          {t("ui_remove")}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.keys(record)
          .filter((key) => key !== "id" && key !== "memberId")
          .map((key) => {
            const value = record[key];
            const options = CHOICE_OPTIONS[key];

            if (options) {
              return (
                <label key={key} className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {labelFor(key, tOr)}
                  </span>
                  <select
                    value={String(value ?? "")}
                    onChange={(event) =>
                      onFieldChange(key, event.target.value || undefined)
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="">{t("qstep_not_answered_option")}</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            if (NUMBER_KEYS.has(key)) {
              return (
                <label key={key} className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {labelFor(key, tOr)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={value === undefined || value === null ? "" : String(value)}
                    onChange={(event) =>
                      onFieldChange(
                        key,
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </label>
              );
            }

            if (typeof value === "boolean" || value === undefined) {
              return (
                <div key={key}>
                  <span className="text-sm font-medium text-slate-700">
                    {labelFor(key, tOr)}
                  </span>
                  <div className="mt-1 flex gap-2">
                    {[
                      { labelKey: "ui_yes", answer: true },
                      { labelKey: "ui_no", answer: false },
                    ].map((option) => (
                      <button
                        key={option.labelKey}
                        type="button"
                        onClick={() => onFieldChange(key, option.answer)}
                        aria-pressed={value === option.answer}
                        className={`rounded-lg border px-3 py-1 text-sm ${
                          value === option.answer
                            ? "border-green-700 bg-green-700 text-white"
                            : "border-slate-300 bg-white text-slate-700"
                        }`}
                      >
                        {t(option.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <label key={key} className="block">
                <span className="text-sm font-medium text-slate-700">
                  {labelFor(key, tOr)}
                </span>
                <input
                  type={DATE_KEYS.has(key) ? "date" : "text"}
                  value={String(value ?? "")}
                  onChange={(event) => onFieldChange(key, event.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
            );
          })}
      </div>
    </div>
  );
}

interface QuestionnaireStepProps {
  application: Saws2PlusApplicationData;
  onChange: (next: Saws2PlusApplicationData) => void;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * Dynamic SAWS 2 PLUS completion flow.
 *
 * The planner decides what to ask; this component only renders. Sections with no
 * outstanding questions disappear entirely, which is what makes the flow much
 * shorter than the 17-page paper form.
 */
export default function QuestionnaireStep({
  application,
  onChange,
  onBack,
  onContinue,
}: QuestionnaireStepProps) {
  const plan = useMemo(
    () => getRequiredApplicationQuestions(application),
    [application],
  );

  const appendices = useMemo(() => getActiveAppendices(application), [application]);
  const members = useMemo(() => memberOptions(application), [application]);

  /**
   * Question-level navigation state.
   *
   * Distinct from the application step: `flow` walks the questionnaire's own
   * trail, and only when the navigator reports `atStart` does Back leave the
   * step via `onBack()`.
   */
  const { t, tq, tn } = useTranslation();

  const [flow, setFlow] = useState<QuestionFlowState>(() => startFlow(application));

  /** Entries path awaiting a household-member choice before a record is made. */
  const [pendingPersonPick, setPendingPersonPick] = useState<string | null>(null);

  const question = currentQuestion(flow);

  const percent =
    plan.totalCount === 0
      ? 100
      : Math.round((plan.answeredCount / plan.totalCount) * 100);

  /** Apply new application data and re-sync the flow to it. */
  function applyData(next: Saws2PlusApplicationData, nextFlow?: QuestionFlowState) {
    onChange(next);
    setFlow(nextFlow ?? resync(next, flow));
  }

  function readAnswer(path: string): unknown {
    return readPath(application.questionnaire, path);
  }

  /** Commit the drafted answer for the current question. */
  function commitDraft() {
    const result = submitDraft(application, flow);

    setFlow(result.state);

    if (result.committed) onChange(result.data);
  }

  /** Commit an explicit Yes/No choice, which needs no second confirmation. */
  function commitChoice(path: string, value: unknown) {
    const result = submitChoice(application, flow, path, value);

    onChange(result.data);
    setFlow(result.state);
  }

  /**
   * Skip a non-required question.
   *
   * Writes no answer, and records the deferral on the application so the
   * completion guide can tell the applicant what they postponed and where it
   * belongs on the paper form.
   */
  function skipQuestion() {
    const result = skipCurrent(application, flow);

    applyData(result.data, result.state);
  }

  /** Question-level Back; leaves the step only at the very beginning. */
  function goBack() {
    const result = navigatorBack(application, flow);

    if (result.atStart) {
      onBack();
      return;
    }

    setFlow(result.state);
  }

  function beginAddRecord(entriesPath: string) {
    if (isPersonScoped(entriesPath)) {
      setPendingPersonPick(entriesPath);
      return;
    }

    createRecord(entriesPath, "");
  }

  function createRecord(entriesPath: string, memberId: string) {
    const factory = RECORD_FACTORIES[entriesPath];
    if (!factory) return;

    const existing = safeEntries<unknown>(readAnswer(entriesPath));
    const record = factory(`record-${existing.length + 1}-${Date.now()}`, memberId);

    setPendingPersonPick(null);
    applyData({
      ...application,
      questionnaire: writePath(application.questionnaire, entriesPath, [
        ...existing,
        record,
      ]),
    });
  }

  function removeRecord(entriesPath: string, index: number) {
    const existing = safeEntries<unknown>(readAnswer(entriesPath));

    applyData({
      ...application,
      questionnaire: writePath(
        application.questionnaire,
        entriesPath,
        existing.filter((_, position) => position !== index),
      ),
    });
  }

  function updateRecordField(
    entriesPath: string,
    index: number,
    key: string,
    value: unknown,
  ) {
    const existing = safeEntries<unknown>(readAnswer(entriesPath)).slice();
    existing[index] = { ...(existing[index] as Record<string, unknown>), [key]: value };

    /*
     * Editing a field inside a record changes no gateway, so navigation is not
     * recomputed here. Re-running the flow on every keystroke is what used to
     * reconstruct the active question mid-typing.
     */
    onChange({
      ...application,
      questionnaire: writePath(application.questionnaire, entriesPath, existing),
    });
  }

  function renderRecordsQuestion(current: PlannedQuestion) {
    const records = safeEntries<Record<string, unknown>>(readAnswer(current.path));
    const picking = pendingPersonPick === current.path;
    const choices = selectableMembers(application, current.path);

    return (
      <div>
        {records.map((record, index) => (
          <RecordEditor
            key={String(record.id ?? index)}
            index={index}
            record={record}
            memberName={
              members.find((member) => member.id === record.memberId)?.label ?? null
            }
            onFieldChange={(key, value) =>
              updateRecordField(current.path, index, key, value)
            }
            onRemove={() => removeRecord(current.path, index)}
          />
        ))}

        {picking ? (
          <div
            className="mt-3 rounded-lg border border-green-300 bg-green-50 p-4"
            data-testid="member-picker"
          >
            <p className="text-sm font-medium text-green-900">{t("qstep_who_is_this_for")}</p>

            {choices.length === 0 ? (
              <p className="mt-2 text-sm text-green-800">
                {t("qstep_everyone_has_entry")}
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {choices.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => createRecord(current.path, member.id)}
                    className="rounded-lg border border-green-700 bg-white px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100"
                  >
                    {member.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setPendingPersonPick(null)}
              className="mt-3 text-xs text-slate-600 underline hover:text-slate-800"
            >
              {t("ui_cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => beginAddRecord(current.path)}
            disabled={isPersonScoped(current.path) && choices.length === 0}
            className="mt-3 rounded-lg border border-green-700 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("qstep_add_entry")}
          </button>
        )}
      </div>
    );
  }

  /** The drafted text/number/date input plus its explicit Continue. */
  function renderDraftQuestion(current: PlannedQuestion) {
    const kind = draftKind(current);
    const valid = validateDraft(current, flow.draft).ok;

    return (
      <div>
        <input
          key={current.id}
          type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
          {...(kind === "number"
            ? { min: 0, step: "0.01", inputMode: "decimal" as const }
            : {})}
          {...(kind === "date" && leafOf(current.path) === "dateOfBirth"
            ? dateOfBirthBounds()
            : {})}
          value={flow.draft}
          onChange={(event) => setFlow(setNavigatorDraft(flow, event.target.value))}
          onKeyDown={(event) => {
            if (!shouldSubmitOnKey(event)) return;

            // Keep Enter inside this question: it must never reach the
            // application-step buttons.
            event.preventDefault();
            event.stopPropagation();
            commitDraft();
          }}
          autoFocus
          aria-label={tq(current)}
          className={INPUT_CLASS}
          data-testid="question-input"
        />

        {flow.error && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {t(flow.error)}
          </p>
        )}

        <button
          type="button"
          onClick={commitDraft}
          disabled={!valid}
          className="mt-3 rounded-lg bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="question-continue"
        >
          {t("ui_continue")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
          {question ? t(`section_title_${question.section}`) : "SAWS 2 PLUS"}
        </p>

        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {question ? tq(question) : t("questionnaire_all_answered")}
        </h1>

        {question && (
          <div className="mt-2">
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full border px-2 py-0.5 font-medium ${
                  question.requirement === "required"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : question.requirement === "important"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : question.requirement === "can_complete_later"
                        ? "border-blue-200 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
                data-testid="question-requirement"
              >
                {t(REQUIREMENT_LABEL_KEYS[question.requirement])}
              </span>

              {question.sawsQuestion && (
                <span className="text-slate-500">
                  SAWS 2 PLUS {question.sawsQuestion}
                </span>
              )}
            </p>

            <p className="mt-1 text-xs text-slate-600">
              {t(REQUIREMENT_HINT_KEYS[question.requirement])}
            </p>
          </div>
        )}

        {/* Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span data-testid="questionnaire-progress-label">
              {plan.outstanding.length === 0
                ? t("questionnaire_all_answered")
                : tn("qstep_questions_left", plan.outstanding.length)}
            </span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-green-600 transition-[width]"
              style={{ width: `${percent}%` }}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("qstep_progress_aria")}
            />
          </div>
        </div>

        {/* The question on screen */}
        <div className="mt-5" data-testid="questionnaire-questions">
          {question?.kind === "gateway" && (
            <TriStateControl
              value={readAnswer(question.path) as boolean | undefined}
              onAnswer={(answer) => commitChoice(question.path, answer)}
            />
          )}
          {question?.kind === "records" && renderRecordsQuestion(question)}
          {question && usesDraft(question) && renderDraftQuestion(question)}
        </div>

        {/* Appendices that this application activates */}
        {appendices.length > 0 && (
          <div
            className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4"
            data-testid="active-appendices"
          >
            <p className="text-sm font-semibold text-blue-900">
              {t("qstep_extra_pages")}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-blue-900">
              {appendices.map((appendix) => (
                <li key={appendix.id}>
                  <span className="font-medium">Appendix {appendix.id}</span> —{" "}
                  {appendix.title}. {appendix.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            data-testid="question-back"
          >
            {t("ui_back")}
          </button>

          {question?.kind === "records" && (
            <button
              type="button"
              onClick={() => setFlow(resync(application, { ...flow, index: flow.index + 1 }))}
              className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
            >
              {t("qstep_next_question")}
            </button>
          )}

          {canSkip(question) && (
            <button
              type="button"
              onClick={skipQuestion}
              title={t("qstep_skip_tooltip")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              data-testid="question-skip"
            >
              {t("qstep_skip_for_now")}
            </button>
          )}

          <button
            type="button"
            onClick={onContinue}
            className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-slate-600 underline hover:text-slate-800"
          >
            {question ? t("qstep_finish_review") : t("qstep_continue_review")}
          </button>

          {canSkip(question) && (
            <p
              className="w-full text-xs text-slate-500"
              data-testid="skip-explanation"
            >
              {t("qstep_skip_explanation")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
