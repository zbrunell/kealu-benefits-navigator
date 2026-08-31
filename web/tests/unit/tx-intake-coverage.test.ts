//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Which canonical keys the Texas intake can actually produce.
 *
 * Answers a question neither runtime can answer alone. TypeScript knows what
 * the screens can write; Python knows which canonical keys Form H1010 reads.
 * Between them sits the failure this file exists to catch: a printed box that is
 * mapped, tested, and rendered correctly, and that no applicant can ever fill
 * because nothing asks them the question.
 *
 * So this fills in every answer the Texas flow can capture — every question,
 * one row in every printed table, a roster member, and the applicant fields the
 * shared `ApplicantStep` collects — runs the production mapper over the result,
 * and commits the key set. `tests/test_formmap_h1010_scenarios.py` reads it and
 * asserts that every H1010 mapping is in it, or is on a list of exceptions with
 * a written reason.
 *
 * Deliberately *not* built from the four scenarios. A scenario says what one
 * household answered; this says what the product can ask. A key reachable only
 * because a fixture happened to set it is not reachable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  allQuestions,
  type AnswerValue,
  type IntakeQuestion,
} from '@/lib/form-intake/model';
import {
  TX_H1010_INTAKE,
  TX_RECORD_LISTS,
  writeMemberDetail,
} from '@/lib/form-intake/tx-h1010';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

type Data = Saws2PlusApplicationData;

const FIXTURE = path.join(
  __dirname,
  '..',
  'fixtures',
  'tx-intake-canonical-keys.json',
);

/** A value of the right shape for a question, so the mapper emits its key. */
function probe<TState>(question: IntakeQuestion<TState>): AnswerValue {
  switch (question.kind) {
    case 'yes_no':
      return true;
    case 'money':
    case 'integer':
      return 1;
    case 'date':
      return '2000-01-01';
    case 'choice':
      return question.options?.[0]?.value ?? 'probe';
    case 'tel':
      return '5125550100';
    case 'email':
      return 'probe@example.test';
    default:
      return 'probe';
  }
}

/**
 * The applicant answers the shared `ApplicantStep` collects for Texas.
 *
 * Listed here rather than derived, because the step is a hand-written component
 * and its field set is a decision rather than data. If a field is dropped from
 * it, the emitted key set shrinks and the Python assertion fails — which is the
 * point.
 */
const APPLICANT_ANSWERS: Partial<Data['applicant']> = {
  firstName: 'Probe',
  middleName: 'M',
  lastName: 'Applicant',
  otherNames: 'Former Name',
  dateOfBirth: '1990-01-01',
  phone: '5125550100',
  alternatePhone: '5125550101',
  email: 'probe@example.test',
  preferredLanguage: 'English',
  homeAddress: {
    street: '1 Probe Street',
    apartment: 'Apt 1',
    city: 'Austin',
    state: 'TX',
    zipCode: '78705',
  },
  householdDetails: {
    applyingFor: [],
    sex: 'female',
    citizenOrNational: true,
    maritalStatus: 'single',
    disabled: true,
    fullTimeStudent: true,
  },
};

/** A roster row with every column the Texas roster editor offers. */
function probeMember(): HouseholdMember {
  const member: HouseholdMember = {
    id: 'probe-member',
    firstName: 'Probe',
    middleName: '',
    lastName: 'Member',
    dateOfBirth: '1989-01-01',
    relationshipToApplicant: 'spouse',
    adultDetails: { applyingFor: [] },
    childDetails: { applyingFor: [], placeOfBirth: '', parentStatus: {} },
  };

  return writeMemberDetail(
    writeMemberDetail(member, 'sex', 'male'),
    'citizenOrNational',
    true,
  );
}

/** Everything the Texas flow can capture, all at once. */
function fullyAnswered(): Data {
  let data: Data = {
    ...structuredClone(EMPTY_APPLICATION_DATA),
    selectedPrograms: ['tx_snap', 'tx_medicaid', 'tx_chip', 'tx_tanf'],
    applicant: {
      ...structuredClone(EMPTY_APPLICATION_DATA).applicant,
      ...APPLICANT_ANSWERS,
    },
    householdMembers: [probeMember()],
  };

  /*
   * Written directly rather than through `isAsked`, because the question here
   * is where an answer *lands*, not whether this particular household would be
   * asked for it. Reachability of the gate itself is asserted in
   * `tx-intake.test.ts`.
   */
  for (const question of allQuestions(TX_H1010_INTAKE)) {
    data = question.write(data, probe(question));
  }

  // Mail elsewhere, so the mailing block's own keys are emitted too.
  data = { ...data, applicant: { ...data.applicant, mailingAddressSameAsHome: false } };

  for (const list of TX_RECORD_LISTS) {
    let record: unknown = list.blank(0);

    for (const field of list.fields) {
      /*
       * A "whose is this" column has no declared options — the household
       * supplies them at render time — so it is probed with the applicant's
       * own id. That also exercises the mapper's name resolution: it emits
       * `person_name` only for an id that resolves to a real name, so a broken
       * owner reference shows up here as a missing key rather than as a blank
       * column on a printed form.
       */
      const value =
        list.peopleField && field.id === list.peopleField
          ? 'applicant'
          : probe(field as IntakeQuestion<unknown>);

      record = field.write(record as never, value);
    }

    data = list.write(data, [record as never]);
  }

  return data;
}

function emit(): string[] {
  const plan = buildApplicationFieldPlan(fullyAnswered(), { county: 'Travis' });

  return [...new Set(plan.map((field) => field.key))].sort();
}

describe('the canonical keys a Texas applicant can produce', () => {
  it('matches the committed set', () => {
    const serialized = `${JSON.stringify(emit(), null, 2)}\n`;

    if (process.env.UPDATE_SCENARIOS === '1' || !existsSync(FIXTURE)) {
      mkdirSync(path.dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, serialized, 'utf8');
    }

    expect(
      readFileSync(FIXTURE, 'utf8'),
      'The set of canonical keys the Texas intake can produce has changed. ' +
        'Check that no H1010 mapping became unreachable, then rerun with ' +
        'UPDATE_SCENARIOS=1.',
    ).toBe(serialized);
  });

  it('produces no key we refuse to write onto a form', () => {
    for (const key of emit()) {
      expect(key).not.toMatch(
        /ssn|social_security|alien_number|immigration|passport|driver|account_number|routing|signature/i,
      );
    }
  });

  it('produces the answers behind each Texas screen', () => {
    const keys = new Set(emit());

    for (const key of [
      'programs.tx_snap',
      'applicant.first_name',
      'applicant.household.citizen_or_national',
      'applicant.home_address.zip_code',
      'applicant.mailing_address.street',
      'household.homeless',
      'household.members.0.first_name',
      'household.members.0.adult.sex',
      'income.has_earned_income',
      'income.earned.0.employer_name',
      'income.unearned.0.source',
      'expenses.has_household_expenses',
      'expenses.household.0.amount_monthly',
      'resources.has_vehicles',
      'household.expedited.migrant_or_seasonal_farm_worker',
      'household.military_service',
      'household.authorized_representative',
      'household.authorized_representative.0.name',
    ]) {
      expect(keys, `${key} is not reachable from the Texas intake`).toContain(
        key,
      );
    }
  });
});
