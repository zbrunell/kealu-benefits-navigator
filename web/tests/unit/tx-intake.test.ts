//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The Texas question set, and the machinery that reads it.
 *
 * Two things are being protected here and they fail differently.
 *
 * The **model** is jurisdiction-neutral, so its guarantees are asserted against
 * forms built in this file rather than against Texas: a rule only ever
 * exercised through one configuration is a rule about that configuration.
 *
 * The **Texas configuration** is asserted against what H1010 actually needs —
 * that its gates open the right follow-ups, that the expedited screen belongs to
 * SNAP, that nothing sensitive is collected, and that every prompt resolves in
 * every language an applicant can choose.
 *
 * What is *not* here: where an answer lands on the printed page. That is
 * `tests/test_formmap_h1010_scenarios.py`, against the definition that owns the
 * boxes. Asserting it twice would give two places to update and one of them
 * would rot.
 */

import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n';
import {
  allQuestions,
  askedQuestions,
  isAnswered,
  isAsked,
  isComplete,
  missingRecordAnswers,
  missingRequired,
  progress,
  questionById,
  sectionIsAsked,
  validateIntakeForm,
  type IntakeForm,
  type IntakeQuestion,
} from '@/lib/form-intake/model';
import {
  TX_BILLS,
  TX_H1010_INTAKE,
  TX_JOBS,
  TX_OTHER_INCOME,
  TX_QUESTION_IDS as Q,
  TX_RECORD_LISTS,
  TX_REPRESENTATIVE,
  householdOptions,
  memberDetail,
  writeMemberDetail,
} from '@/lib/form-intake/tx-h1010';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

type Data = Saws2PlusApplicationData;

const blank = (): Data => structuredClone(EMPTY_APPLICATION_DATA);

function answer(data: Data, id: string, value: unknown): Data {
  const question = questionById(TX_H1010_INTAKE, id);

  if (!question) throw new Error(`no such question: ${id}`);

  return question.write(data, value as never);
}

function read(data: Data, id: string): unknown {
  return questionById(TX_H1010_INTAKE, id)?.read(data);
}

// ---------------------------------------------------------------------------
// The model, against forms that are not Texas
// ---------------------------------------------------------------------------

interface Toy {
  gate?: boolean;
  detail: string;
}

const toyForm: IntakeForm<Toy> = {
  formId: 'TX_H1010',
  sections: [
    {
      id: 'toy',
      titleKey: 'ui_yes',
      questions: [
        {
          id: 'gate',
          promptKey: 'ui_yes',
          kind: 'yes_no',
          read: (state) => state.gate,
          write: (state, value) => ({
            ...state,
            gate: typeof value === 'boolean' ? value : undefined,
          }),
        },
        {
          id: 'detail',
          promptKey: 'ui_no',
          kind: 'text',
          required: true,
          gate: { questionId: 'gate', equals: true },
          read: (state) => state.detail,
          write: (state, value) => ({ ...state, detail: String(value ?? '') }),
        },
      ],
    },
  ],
};

describe('the intake model keeps three states apart', () => {
  const detail = toyForm.sections[0].questions[1];

  it('does not ask a follow-up before its gate is answered', () => {
    expect(isAsked(toyForm, { detail: '' }, detail)).toBe(false);
  });

  it('does not ask a follow-up whose gate was answered the other way', () => {
    expect(isAsked(toyForm, { gate: false, detail: '' }, detail)).toBe(false);
  });

  it('asks a follow-up once its gate is open', () => {
    expect(isAsked(toyForm, { gate: true, detail: '' }, detail)).toBe(true);
  });

  it('never reports a question it did not ask as missing', () => {
    /*
     * The failure this prevents: telling someone they have not answered a
     * question that was never put to them, which is the most common way a
     * branching form loses a person's trust.
     */
    expect(missingRequired(toyForm, { detail: '' })).toEqual([]);
    expect(isComplete(toyForm, { detail: '' })).toBe(true);
  });

  it('reports it the moment the gate opens', () => {
    const missing = missingRequired(toyForm, { gate: true, detail: '' });

    expect(missing.map((question) => question.id)).toEqual(['detail']);
    expect(isComplete(toyForm, { gate: true, detail: '' })).toBe(false);
  });

  it('counts an explicit No as an answer', () => {
    expect(isAnswered(false)).toBe(true);
    expect(isAnswered(0)).toBe(true);
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered('  ')).toBe(false);
  });

  it('counts progress over asked questions only', () => {
    expect(progress(toyForm, { detail: '' })).toEqual({ answered: 0, asked: 1 });
    expect(progress(toyForm, { gate: false, detail: '' })).toEqual({
      answered: 1,
      asked: 1,
    });
    expect(progress(toyForm, { gate: true, detail: 'x' })).toEqual({
      answered: 2,
      asked: 2,
    });
  });

  it('rejects a gate that names a question asked later', () => {
    const broken: IntakeForm<Toy> = {
      formId: 'TX_H1010',
      sections: [
        {
          id: 'toy',
          titleKey: 'ui_yes',
          questions: [
            { ...toyForm.sections[0].questions[1], id: 'detail' },
            { ...toyForm.sections[0].questions[0], id: 'gate' },
          ],
        },
      ],
    };

    expect(validateIntakeForm(broken)).toContain(
      'detail: gate gate is not asked before it',
    );
  });

  it('rejects a duplicate question id', () => {
    const broken: IntakeForm<Toy> = {
      formId: 'TX_H1010',
      sections: [
        {
          id: 'toy',
          titleKey: 'ui_yes',
          questions: [
            toyForm.sections[0].questions[0],
            { ...toyForm.sections[0].questions[0] },
          ],
        },
      ],
    };

    expect(validateIntakeForm(broken)).toContain('duplicate question id: gate');
  });
});

// ---------------------------------------------------------------------------
// The Texas configuration
// ---------------------------------------------------------------------------

describe('the Texas question set', () => {
  it('is internally consistent', () => {
    expect(validateIntakeForm(TX_H1010_INTAKE)).toEqual([]);
  });

  it('fills the Texas form and no other', () => {
    expect(TX_H1010_INTAKE.formId).toBe('TX_H1010');
  });

  it('resolves every prompt in every language an applicant can choose', () => {
    const keys = [
      ...TX_H1010_INTAKE.sections.flatMap((section) => [
        section.titleKey,
        section.introKey,
      ]),
      ...allQuestions(TX_H1010_INTAKE).flatMap((question) => [
        question.promptKey,
        question.helpKey,
        ...(question.options ?? []).map((option) => option.labelKey),
      ]),
      ...TX_RECORD_LISTS.flatMap((list) => [
        list.titleKey,
        list.introKey,
        list.addLabelKey,
        list.emptyKey,
        ...list.fields.flatMap((field) => [
          field.promptKey,
          field.helpKey,
          ...(field.options ?? []).map((option) => option.labelKey),
        ]),
      ]),
    ].filter((key): key is string => Boolean(key));

    for (const locale of ['en', 'es', 'zh-CN'] as const) {
      for (const key of keys) {
        expect(messages[locale], `${locale} is missing ${key}`).toHaveProperty(
          key,
        );
      }
    }
  });

  it('collects nothing we refuse to write onto a form', () => {
    /*
     * The refusal is structural rather than filtered: there is no question, so
     * there is no answer to drop later. The mapping layer refuses these keys
     * too, and two independent refusals is the point.
     */
    const forbidden =
      /ssn|social_?security|alien|immigration|passport|driver|account_?number|routing|signature/i;

    for (const question of allQuestions(TX_H1010_INTAKE)) {
      expect(question.id, question.id).not.toMatch(forbidden);
      expect(question.promptKey, question.id).not.toMatch(forbidden);
    }

    for (const list of TX_RECORD_LISTS) {
      for (const field of list.fields) {
        expect(field.id, `${list.id}.${field.id}`).not.toMatch(forbidden);
      }
    }
  });

  it('asks nothing twice', () => {
    const ids = allQuestions(TX_H1010_INTAKE).map((question) => question.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Texas branching', () => {
  it('hides the mailing address until mail goes somewhere else', () => {
    const street = questionById(TX_H1010_INTAKE, 'tx.mail.street')!;

    expect(isAsked(TX_H1010_INTAKE, blank(), street)).toBe(false);

    const elsewhere = answer(blank(), Q.mailSame, false);

    expect(isAsked(TX_H1010_INTAKE, elsewhere, street)).toBe(true);

    const atHome = answer(blank(), Q.mailSame, true);

    expect(isAsked(TX_H1010_INTAKE, atHome, street)).toBe(false);
  });

  it('does not report a hidden mailing address as missing', () => {
    const atHome = answer(blank(), Q.mailSame, true);
    const mailing = TX_H1010_INTAKE.sections[0];

    expect(missingRequired(TX_H1010_INTAKE, atHome, mailing)).toEqual([]);
  });

  it('screens for expedited service only when food benefits were asked for', () => {
    const urgent = TX_H1010_INTAKE.sections.find(
      (section) => section.id === 'tx-urgent',
    )!;

    const health: Data = { ...blank(), selectedPrograms: ['tx_medicaid'] };
    const food: Data = { ...blank(), selectedPrograms: ['tx_snap'] };

    expect(sectionIsAsked(TX_H1010_INTAKE, health, urgent)).toBe(false);
    expect(sectionIsAsked(TX_H1010_INTAKE, food, urgent)).toBe(true);

    // And its required questions follow the section, not the other way round.
    expect(missingRequired(TX_H1010_INTAKE, health, urgent)).toEqual([]);
    expect(missingRequired(TX_H1010_INTAKE, food, urgent).length).toBe(3);
  });

  it('opens each record list on its own gateway', () => {
    for (const [list, gate] of [
      [TX_JOBS, Q.hasJob],
      [TX_OTHER_INCOME, Q.otherIncome],
      [TX_BILLS, Q.hasBills],
      [TX_REPRESENTATIVE, Q.hasHelper],
    ] as const) {
      expect(list.gate?.questionId, list.id).toBe(gate);
      expect(list.gate?.equals, list.id).toBe(true);
    }
  });

  it('keeps an answer when its gate closes, and stops emitting it', () => {
    /*
     * A person who answers Yes, types a job, then corrects the gateway to No
     * has not asked us to delete what they typed — but the form must not carry
     * it. `activeEntries` in the mapper is what enforces the second half; this
     * pins the first.
     */
    let data = answer(blank(), Q.hasJob, true);
    data = TX_JOBS.write(data, [TX_JOBS.blank(0)]);
    data = answer(data, Q.hasJob, false);

    expect(TX_JOBS.read(data)).toHaveLength(1);
    expect(read(data, Q.hasJob)).toBe(false);
  });
});

describe('Texas requiredness', () => {
  it('asks for the answers the document and the screening cannot do without', () => {
    const required = allQuestions(TX_H1010_INTAKE)
      .filter((question) => question.required)
      .map((question) => question.id);

    /*
     * Listed rather than counted, so adding a required question is a decision
     * someone reads. Each is here because an eligibility rule or a printed box
     * is wrong without it, never because H1010 has a box.
     */
    expect(required).toEqual([
      Q.mailSame,
      'tx.mail.street',
      'tx.mail.city',
      'tx.mail.state',
      'tx.mail.zip',
      Q.homeless,
      Q.foodTogether,
      Q.pregnant,
      Q.hasJob,
      Q.otherIncome,
      Q.hasBills,
      Q.expeditedIncome,
      Q.expeditedHousing,
      Q.expeditedFarm,
      Q.hasHelper,
    ]);
  });

  it('requires a helper’s name once a helper is named', () => {
    const nameField = TX_REPRESENTATIVE.fields.find(
      (field) => field.id === 'name',
    )!;

    expect(nameField.required).toBe(true);

    const empty = TX_REPRESENTATIVE.blank(0);

    expect(missingRecordAnswers(TX_REPRESENTATIVE.fields, empty)).toContain(
      nameField,
    );
  });

  it('requires only what a row cannot be understood without', () => {
    const requiredIn = (fields: readonly IntakeQuestion<never>[]) =>
      fields.filter((field) => field.required).map((field) => field.id);

    expect(requiredIn(TX_JOBS.fields as never)).toEqual([
      'memberId',
      'employerName',
      'grossReceivedThisMonth',
    ]);
    expect(requiredIn(TX_BILLS.fields as never)).toEqual([
      'kind',
      'amountMonthly',
    ]);
  });
});

describe('the household roster writes where the canonical model keeps things', () => {
  it('puts an adult’s details on the adult record', () => {
    const member = {
      id: 'm1',
      firstName: 'Diego',
      middleName: '',
      lastName: 'Ramirez',
      dateOfBirth: '1989-07-19',
      relationshipToApplicant: 'spouse',
      adultDetails: { applyingFor: [] },
      childDetails: { applyingFor: [], placeOfBirth: '', parentStatus: {} },
    };

    const updated = writeMemberDetail(member, 'citizenOrNational', true);

    expect(updated.adultDetails?.citizenOrNational).toBe(true);
    expect(updated.childDetails?.citizenOrNational).toBeUndefined();
    expect(memberDetail(updated, 'citizenOrNational')).toBe(true);
  });

  it('puts a child’s details on the child record', () => {
    const member = {
      id: 'm2',
      firstName: 'Sofia',
      middleName: '',
      lastName: 'Ramirez',
      dateOfBirth: '2016-09-08',
      relationshipToApplicant: 'child',
      adultDetails: { applyingFor: [] },
      childDetails: { applyingFor: [], placeOfBirth: '', parentStatus: {} },
    };

    const updated = writeMemberDetail(member, 'sex', 'female');

    expect(updated.childDetails?.sex).toBe('female');
    expect(updated.adultDetails?.sex).toBeUndefined();
    expect(memberDetail(updated, 'sex')).toBe('female');
  });

  it('offers the applicant and every member as an income owner', () => {
    const data: Data = {
      ...blank(),
      applicant: {
        ...blank().applicant,
        firstName: 'Marisol',
        lastName: 'Ramirez',
      },
      householdMembers: [
        {
          id: 'm1',
          firstName: 'Diego',
          middleName: '',
          lastName: 'Ramirez',
          dateOfBirth: '1989-07-19',
          relationshipToApplicant: 'spouse',
        },
      ],
    };

    const options = householdOptions(data);

    expect(options.map((option) => option.value)).toEqual(['applicant', 'm1']);
    expect(options[0].labelKey).toBe('tx_person_you');
    expect(options[1].label).toBe('Diego Ramirez');
  });
});

describe('the Texas screens ask everything the section declares', () => {
  it('asks every non-gated question of a household that answered nothing', () => {
    const data = blank();

    const asked = TX_H1010_INTAKE.sections.flatMap((section) =>
      askedQuestions(TX_H1010_INTAKE, data, section).map((q) => q.id),
    );

    // Nothing behind a gate, and nothing from the SNAP-only section.
    expect(asked).not.toContain('tx.mail.street');
    expect(asked).not.toContain(Q.expeditedIncome);

    // But the gateways themselves are always asked.
    expect(asked).toContain(Q.mailSame);
    expect(asked).toContain(Q.hasJob);
    expect(asked).toContain(Q.hasHelper);
  });
});
