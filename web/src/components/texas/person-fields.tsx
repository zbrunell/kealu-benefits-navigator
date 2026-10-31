//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * The questions H1010 asks about one person, laid out for someone to answer.
 *
 * ── Layout, and why it is one column ───────────────────────────────────────
 * Every question sits *above* the control that answers it, and any explanation
 * sits between the two. That is the whole pattern:
 *
 *     Which benefits is María applying for?
 *     Choose all that apply. Different people can apply for different ones.
 *     [ ] Food benefits (SNAP)   Helps pay for groceries.
 *
 * The roster used to be a two-column grid of `label`-wrapped inputs. On a
 * phone the columns collapsed and the questions ran into each other; on a
 * desktop the longer questions wrapped to three lines beside a field that was
 * half the width it needed. Both are the same mistake — a form laid out for
 * the page rather than for the reading order.
 *
 * Names and dates keep a two-column pair on wide screens because they are
 * short, related, and read as one line on paper. Everything else is full
 * width, in the order the form asks it.
 *
 * ── Progressive disclosure ─────────────────────────────────────────────────
 * Marital status is asked only of adults, and full-time study only of someone
 * in school, because H1010 asks the second as an indented follow-up to the
 * first and a nine-year-old's marital status is not a question anyone expects
 * answered. A question that does not apply is not shown, rather than shown and
 * dimmed.
 */

import { useTranslation } from '@/hooks/use-translation';
import { TriStateAnswer } from '@/components/intake/question-fields';
import { ageOnDate, dateOfBirthBounds } from '@/lib/date-of-birth';
import { dateOfBirthErrorKey } from '@/lib/date-of-birth';
import {
  RELATIONSHIP_LABEL_KEYS,
  allowedRelationshipsForDateOfBirth,
} from '@/lib/household-relationships';
import { normalizeWhitespace } from '@/lib/field-validation';
import {
  PERSON_PROGRAM_CHOICES,
  memberDetail,
  memberPrograms,
  writeMemberDetail,
  writeMemberPrograms,
} from '@/lib/form-intake/tx-h1010';
import type { BenefitProgramId } from '@/lib/state-applications';
import type {
  HouseholdMember,
  MaritalStatus,
  PersonSex,
} from '@/types/application';

/** Age at which H1010's marital-status circles start to mean anything. */
export const MARITAL_STATUS_FROM_AGE = 16;

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200 sm:text-sm';

const MARITAL_STATUSES: readonly { value: MaritalStatus; labelKey: string }[] = [
  { value: 'married', labelKey: 'opt_married' },
  { value: 'single', labelKey: 'opt_single' },
  { value: 'divorced', labelKey: 'opt_divorced' },
  { value: 'separated', labelKey: 'opt_separated' },
  { value: 'widowed', labelKey: 'opt_widowed' },
];

/**
 * One question, with its control beneath it.
 *
 * A plain `<div>` and not a card: a border around every question turns a page
 * of eight into a page of eight boxes, and the applicant has to find the
 * question inside each one. Spacing does the grouping.
 */
export function Field({
  label,
  help,
  htmlFor,
  error,
  wide = false,
  children,
}: {
  label: string;
  help?: string;
  htmlFor?: string;
  error?: string | null;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const helpId = htmlFor ? `${htmlFor}-help` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-900"
      >
        {label}
      </label>

      {help && (
        <p id={helpId} className="mt-0.5 text-sm text-slate-600">
          {help}
        </p>
      )}

      <div className="mt-1.5">{children}</div>

      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A question answered Yes or No, with its own label element.
 *
 * `TriStateAnswer` is a button group rather than an input, so it is labelled
 * by a `<p>` it points at instead of a `<label htmlFor>` — a label pointing at
 * nothing is worse for a screen reader than no label.
 */
export function YesNoField({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: boolean | undefined;
  onChange: (next: boolean | undefined) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <p id={`${id}-label`} className="text-sm font-medium text-slate-900">
        {label}
      </p>

      {help && <p className="mt-0.5 text-sm text-slate-600">{help}</p>}

      <TriStateAnswer
        id={id}
        value={value}
        labelledBy={`${id}-label`}
        onChange={onChange}
      />
    </div>
  );
}

export interface PersonFieldsProps {
  member: HouseholdMember;

  /** Stable per-person prefix for test ids and control ids. */
  idPrefix: string;

  /** What to call this person once they have a name. */
  displayName: string;

  onChange: (next: HouseholdMember) => void;

  /** A new date of birth can make the stored relationship impossible. */
  onDateOfBirthChange: (value: string) => void;

  showErrors: boolean;
}

export default function PersonFields({
  member,
  idPrefix,
  displayName,
  onChange,
  onDateOfBirthChange,
  showErrors,
}: PersonFieldsProps) {
  const { t, tv } = useTranslation();
  const bounds = dateOfBirthBounds();
  const age = ageOnDate(member.dateOfBirth);
  const dateError = showErrors ? dateOfBirthErrorKey(member.dateOfBirth) : null;

  const attendsSchool = memberDetail(member, 'attendsSchool') as
    | boolean
    | undefined;

  const programs = memberPrograms(member);

  function toggleProgram(program: BenefitProgramId) {
    onChange(
      writeMemberPrograms(
        member,
        programs.includes(program)
          ? programs.filter((entry) => entry !== program)
          : [...programs, program],
      ),
    );
  }

  /*
   * Marital status is asked from 16, and not asked at all until a date of
   * birth is given. Guessing at an unknown age would either ask a small
   * child's marital status or hide an adult's.
   */
  const asksMaritalStatus = age !== null && age >= MARITAL_STATUS_FROM_AGE;

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field
        label={t('field_first_name')}
        htmlFor={`${idPrefix}-first-name`}
      >
        <input
          id={`${idPrefix}-first-name`}
          type="text"
          autoComplete="off"
          value={member.firstName}
          data-testid={`${idPrefix}-first-name`}
          onChange={(event) =>
            onChange({ ...member, firstName: event.target.value })
          }
          onBlur={(event) =>
            onChange({
              ...member,
              firstName: normalizeWhitespace(event.target.value),
            })
          }
          className={FIELD}
        />
      </Field>

      <Field label={t('field_last_name')} htmlFor={`${idPrefix}-last-name`}>
        <input
          id={`${idPrefix}-last-name`}
          type="text"
          autoComplete="off"
          value={member.lastName}
          data-testid={`${idPrefix}-last-name`}
          onChange={(event) =>
            onChange({ ...member, lastName: event.target.value })
          }
          onBlur={(event) =>
            onChange({
              ...member,
              lastName: normalizeWhitespace(event.target.value),
            })
          }
          className={FIELD}
        />
      </Field>

      <Field
        label={t('field_date_of_birth')}
        htmlFor={`${idPrefix}-dob`}
        error={dateError ? t(dateError) : null}
      >
        <input
          id={`${idPrefix}-dob`}
          type="date"
          value={member.dateOfBirth}
          min={bounds.min}
          max={bounds.max}
          data-testid={`${idPrefix}-dob`}
          aria-describedby={dateError ? `${idPrefix}-dob-error` : undefined}
          onChange={(event) => onDateOfBirthChange(event.target.value)}
          className={FIELD}
        />
      </Field>

      <Field
        label={tv('tx_person_relationship', { name: displayName })}
        htmlFor={`${idPrefix}-relationship`}
      >
        <select
          id={`${idPrefix}-relationship`}
          value={member.relationshipToApplicant}
          data-testid={`${idPrefix}-relationship`}
          onChange={(event) =>
            onChange({
              ...member,
              relationshipToApplicant: event.target.value,
            })
          }
          className={FIELD}
        >
          <option value="">{t('opt_select_relationship')}</option>

          {allowedRelationshipsForDateOfBirth(member.dateOfBirth).map(
            (relationship) => (
              <option key={relationship} value={relationship}>
                {t(RELATIONSHIP_LABEL_KEYS[relationship])}
              </option>
            ),
          )}
        </select>
      </Field>

      {/*
        Which benefits *this person* is applying for.
        First among the per-person questions because it is the one the form
        turns on, and because seeing it early explains why the rest are asked
        one person at a time.
      */}
      <div className="sm:col-span-2">
        <p
          id={`${idPrefix}-programs-label`}
          className="text-sm font-medium text-slate-900"
        >
          {tv('tx_person_programs', { name: displayName })}
        </p>

        <p className="mt-0.5 text-sm text-slate-600">
          {t('tx_person_programs_help')}
        </p>

        <div
          role="group"
          aria-labelledby={`${idPrefix}-programs-label`}
          data-testid={`${idPrefix}-programs`}
          className="mt-2 space-y-2"
        >
          {PERSON_PROGRAM_CHOICES.map((choice) => (
            <label
              key={choice.program}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-1 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={programs.includes(choice.program)}
                data-testid={`${idPrefix}-program-${choice.program}`}
                onChange={() => toggleProgram(choice.program)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-slate-400 text-green-700 focus:ring-green-600"
              />

              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">
                  {t(choice.nameKey)}
                </span>

                <span className="block text-sm text-slate-600">
                  {t(choice.summaryKey)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/*
        Sex and marital status each get a full row. Side by side, the help text
        under Sex pushed its select below Marital status's, and each select had
        half the card when the options ("Separated", "Divorced") need more.
      */}
      <Field
        label={t('field_sex')}
        htmlFor={`${idPrefix}-sex`}
        help={tv('tx_person_sex_help', { name: displayName })}
        wide
      >
        <select
          id={`${idPrefix}-sex`}
          value={String(memberDetail(member, 'sex') ?? '')}
          data-testid={`${idPrefix}-sex`}
          onChange={(event) =>
            onChange(
              writeMemberDetail(
                member,
                'sex',
                (event.target.value || undefined) as PersonSex | undefined,
              ),
            )
          }
          className={`${FIELD} sm:max-w-sm`}
        >
          <option value="">{t('opt_select')}</option>
          <option value="male">{t('opt_male')}</option>
          <option value="female">{t('opt_female')}</option>
        </select>
      </Field>

      {asksMaritalStatus && (
        <Field
          label={t('field_marital_status')}
          htmlFor={`${idPrefix}-marital-status`}
          wide
        >
          <select
            id={`${idPrefix}-marital-status`}
            value={String(memberDetail(member, 'maritalStatus') ?? '')}
            data-testid={`${idPrefix}-marital-status`}
            onChange={(event) =>
              onChange(
                writeMemberDetail(
                  member,
                  'maritalStatus',
                  (event.target.value || undefined) as
                    | MaritalStatus
                    | undefined,
                ),
              )
            }
            className={`${FIELD} sm:max-w-sm`}
          >
            <option value="">{t('opt_select')}</option>

            {MARITAL_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {t(status.labelKey)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <YesNoField
        id={`${idPrefix}-lives-in-texas`}
        label={tv('tx_person_lives_in_texas', { name: displayName })}
        value={memberDetail(member, 'livesInTexas') as boolean | undefined}
        onChange={(next) =>
          onChange(writeMemberDetail(member, 'livesInTexas', next))
        }
      />

      <YesNoField
        id={`${idPrefix}-stays-in-texas`}
        label={tv('tx_person_stays_in_texas', { name: displayName })}
        value={
          memberDetail(member, 'plansToStayInTexas') as boolean | undefined
        }
        onChange={(next) =>
          onChange(writeMemberDetail(member, 'plansToStayInTexas', next))
        }
      />

      <YesNoField
        id={`${idPrefix}-citizen`}
        label={tv('tx_person_citizen', { name: displayName })}
        help={tv('tx_person_citizen_help', { name: displayName })}
        value={memberDetail(member, 'citizenOrNational') as boolean | undefined}
        onChange={(next) =>
          onChange(writeMemberDetail(member, 'citizenOrNational', next))
        }
      />

      <YesNoField
        id={`${idPrefix}-school`}
        label={tv('tx_person_school', { name: displayName })}
        value={attendsSchool}
        onChange={(next) =>
          onChange(writeMemberDetail(member, 'attendsSchool', next))
        }
      />

      {/*
        The follow-up H1010 prints indented under the school question, shown
        only when it applies. Asking whether someone studies full time when
        they are not in school is a question with no true answer.
      */}
      {attendsSchool === true && (
        <YesNoField
          id={`${idPrefix}-full-time`}
          label={tv('tx_person_full_time_student', { name: displayName })}
          value={
            memberDetail(member, 'fullTimeStudent') as boolean | undefined
          }
          onChange={(next) =>
            onChange(writeMemberDetail(member, 'fullTimeStudent', next))
          }
        />
      )}

      {age !== null && (
        <p className="text-sm text-slate-500 sm:col-span-2">
          {tv('tx_roster_age', { age: String(age) })}
        </p>
      )}
    </div>
  );
}
