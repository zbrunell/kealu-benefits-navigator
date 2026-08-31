//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

/**
 * Everyone else who lives with the applicant.
 *
 * Not the generic record-list editor, and for a reason the generic editor
 * cannot express: two of these columns depend on another answer in the same
 * row. The relationships offered depend on the person's date of birth — a
 * nine-year-old is not anyone's spouse — and sex and citizenship are stored on
 * the adult or the child detail record depending on that same date. Wiring that
 * into the generic editor would mean giving every record list a way to talk
 * about its own fields, for one list.
 *
 * The applicant is deliberately not a row here. H1010 lists them in "About
 * you" and everyone else in the table beneath, which is also how the canonical
 * model is shaped: `householdMembers` excludes the applicant and
 * `household.size` is derived from its length, so adding the applicant as a row
 * would count them twice.
 */

import { useTranslation } from "@/hooks/use-translation";
import { TriStateAnswer } from "@/components/intake/question-fields";
import {
  RequiredMissingNotice,
  continueButtonClass,
} from "@/components/application/required-marker";
import { ageOnDate, dateOfBirthBounds } from "@/lib/date-of-birth";
import { dateOfBirthErrorKey } from "@/lib/date-of-birth";
import {
  RELATIONSHIP_LABEL_KEYS,
  allowedRelationshipsForDateOfBirth,
  relationshipAfterAgeChange,
} from "@/lib/household-relationships";
import { normalizeWhitespace } from "@/lib/field-validation";
import {
  TX_HOUSEHOLD_ROSTER,
  memberDetail,
  writeMemberDetail,
} from "@/lib/form-intake/tx-h1010";
import type { HouseholdMember, PersonSex } from "@/types/application";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200";

/** A blank row. Ids are stable for the life of the row, never re-derived. */
function blankMember(index: number): HouseholdMember {
  return {
    id: `tx-member-${index}-${Date.now()}`,
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    relationshipToApplicant: "",
    adultDetails: { applyingFor: [] },
    childDetails: {
      applyingFor: [],
      placeOfBirth: "",
      parentStatus: {},
    },
  };
}

/**
 * What a roster row must have before the flow will continue.
 *
 * Returns catalog keys, never sentences, so the same list reads in the
 * applicant's language wherever it is shown. It used to return field ids —
 * "1: first_name" — which reached the screen as-is.
 *
 * Why these four and not more: the printed table has a name column, a
 * relationship column and a date of birth, and a row with none of them is a
 * person the county cannot identify. A row can arrive already half-filled,
 * because intake counts the household before anyone types a name — so this is
 * also what asks the applicant to finish naming someone the conversation
 * already found.
 */
export interface MissingRosterAnswer {
  /** 1-based row, as the applicant sees it. */
  row: number;
  labelKey: string;
}

export function missingRosterAnswers(
  members: readonly HouseholdMember[],
): readonly MissingRosterAnswer[] {
  const missing: MissingRosterAnswer[] = [];

  members.forEach((member, index) => {
    const row = index + 1;

    if (!member.firstName.trim()) {
      missing.push({ row, labelKey: "field_first_name" });
    }

    if (!member.lastName.trim()) {
      missing.push({ row, labelKey: "field_last_name" });
    }

    if (!member.dateOfBirth.trim()) {
      missing.push({ row, labelKey: "field_date_of_birth" });
    }

    if (!member.relationshipToApplicant.trim()) {
      missing.push({ row, labelKey: "field_relationship_to_applicant" });
    }
  });

  return missing;
}

interface RosterStepProps {
  members: readonly HouseholdMember[];
  onChange: (members: readonly HouseholdMember[]) => void;
  showErrors: boolean;
}

export default function RosterStep({
  members,
  onChange,
  showErrors,
}: RosterStepProps) {
  const { t, tv } = useTranslation();
  const bounds = dateOfBirthBounds();

  function update(index: number, next: HouseholdMember) {
    onChange(members.map((member, position) => (position === index ? next : member)));
  }

  /**
   * A new date of birth can make the stored relationship impossible.
   *
   * `relationshipAfterAgeChange` returns '' when it has, so the answer is
   * cleared rather than left behind — a hidden "spouse" on a nine-year-old
   * would still be printed on the form.
   */
  function updateDateOfBirth(index: number, value: string) {
    const member = members[index];

    update(index, {
      ...member,
      dateOfBirth: value,
      relationshipToApplicant: relationshipAfterAgeChange(
        member.relationshipToApplicant,
        value,
      ),
    });
  }

  const overflow = Math.max(0, members.length - TX_HOUSEHOLD_ROSTER.printedRows);

  return (
    <section
      data-testid="tx-roster"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h3 className="font-semibold text-slate-900">
        {t(TX_HOUSEHOLD_ROSTER.titleKey)}
      </h3>

      <p className="mt-1 text-sm text-slate-600">
        {t(TX_HOUSEHOLD_ROSTER.introKey)}
      </p>

      {members.length === 0 && (
        <p
          data-testid="tx-roster-empty"
          className="mt-3 rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500"
        >
          {t(TX_HOUSEHOLD_ROSTER.emptyKey)}
        </p>
      )}

      <ol className="mt-3 space-y-4">
        {members.map((member, index) => {
          const age = ageOnDate(member.dateOfBirth);
          const dateError = showErrors
            ? dateOfBirthErrorKey(member.dateOfBirth)
            : null;

          return (
            <li
              key={member.id}
              data-testid={`tx-member-${index}`}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {tv("intake_row_number", { number: String(index + 1) })}
                </p>

                <button
                  type="button"
                  data-testid={`tx-member-${index}-remove`}
                  onClick={() =>
                    onChange(members.filter((_, position) => position !== index))
                  }
                  className="text-xs font-medium text-red-700 underline hover:text-red-800"
                >
                  {t("intake_remove_row")}
                </button>
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("field_first_name")}
                  </span>

                  <input
                    type="text"
                    value={member.firstName}
                    data-testid={`tx-member-${index}-first-name`}
                    onChange={(event) =>
                      update(index, {
                        ...member,
                        firstName: event.target.value,
                      })
                    }
                    onBlur={(event) =>
                      update(index, {
                        ...member,
                        firstName: normalizeWhitespace(event.target.value),
                      })
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
                    data-testid={`tx-member-${index}-last-name`}
                    onChange={(event) =>
                      update(index, { ...member, lastName: event.target.value })
                    }
                    onBlur={(event) =>
                      update(index, {
                        ...member,
                        lastName: normalizeWhitespace(event.target.value),
                      })
                    }
                    className={INPUT_CLASS}
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("field_date_of_birth")}
                  </span>

                  <input
                    type="date"
                    value={member.dateOfBirth}
                    min={bounds.min}
                    max={bounds.max}
                    data-testid={`tx-member-${index}-dob`}
                    aria-describedby={
                      dateError ? `tx-member-${index}-dob-error` : undefined
                    }
                    onChange={(event) =>
                      updateDateOfBirth(index, event.target.value)
                    }
                    className={INPUT_CLASS}
                  />

                  {dateError && (
                    <p
                      id={`tx-member-${index}-dob-error`}
                      role="alert"
                      className="mt-1 text-xs text-red-700"
                    >
                      {t(dateError)}
                    </p>
                  )}
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("field_relationship_to_applicant")}
                  </span>

                  <select
                    value={member.relationshipToApplicant}
                    data-testid={`tx-member-${index}-relationship`}
                    onChange={(event) =>
                      update(index, {
                        ...member,
                        relationshipToApplicant: event.target.value,
                      })
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="">{t("opt_select_relationship")}</option>

                    {allowedRelationshipsForDateOfBirth(
                      member.dateOfBirth,
                    ).map((relationship) => (
                      <option key={relationship} value={relationship}>
                        {t(RELATIONSHIP_LABEL_KEYS[relationship])}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("field_sex")}
                  </span>

                  <select
                    value={String(memberDetail(member, "sex") ?? "")}
                    data-testid={`tx-member-${index}-sex`}
                    onChange={(event) =>
                      update(
                        index,
                        writeMemberDetail(
                          member,
                          "sex",
                          (event.target.value || undefined) as
                            | PersonSex
                            | undefined,
                        ),
                      )
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="">{t("opt_select")}</option>
                    <option value="male">{t("opt_male")}</option>
                    <option value="female">{t("opt_female")}</option>
                  </select>
                </label>

                <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
                  <legend
                    id={`tx-member-${index}-citizen-label`}
                    className="px-1 text-sm font-medium text-slate-800"
                  >
                    {t("tx_roster_citizen")}
                  </legend>

                  <TriStateAnswer
                    id={`tx-member-${index}-citizen`}
                    value={
                      memberDetail(member, "citizenOrNational") as
                        | boolean
                        | undefined
                    }
                    labelledBy={`tx-member-${index}-citizen-label`}
                    onChange={(next) =>
                      update(
                        index,
                        writeMemberDetail(member, "citizenOrNational", next),
                      )
                    }
                  />
                </fieldset>
              </div>

              {age !== null && (
                <p className="mt-3 text-xs text-slate-500">
                  {tv("tx_roster_age", { age: String(age) })}
                </p>
              )}

              {index >= TX_HOUSEHOLD_ROSTER.printedRows && (
                <p
                  data-testid={`tx-member-${index}-overflow`}
                  className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
                >
                  {tv("intake_overflow_row", {
                    rows: String(TX_HOUSEHOLD_ROSTER.printedRows),
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        data-testid="tx-roster-add"
        onClick={() => onChange([...members, blankMember(members.length)])}
        className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {t(TX_HOUSEHOLD_ROSTER.addLabelKey)}
      </button>

      {overflow > 0 && (
        <p
          data-testid="tx-roster-overflow"
          className="mt-3 text-xs text-amber-900"
        >
          {tv("intake_overflow_total", {
            count: String(overflow),
            rows: String(TX_HOUSEHOLD_ROSTER.printedRows),
          })}
        </p>
      )}

      <RequiredMissingNotice
        show={showErrors && missingRosterAnswers(members).length > 0}
        testId="tx-roster-missing"
      />
    </section>
  );
}

export { blankMember, continueButtonClass };
