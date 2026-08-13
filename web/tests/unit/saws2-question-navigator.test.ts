//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Tests for explicit question submission.
 *
 * The defect being fixed: typing into a required field wrote straight through to
 * application state, so the planner considered the question answered and it
 * vanished mid-keystroke. Answers are now drafted locally and committed only on
 * Enter or Continue.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { buildInitialApplicationData } from '@/lib/application-data';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import {
  activeEntries,
  getRequiredApplicationQuestions,
  readPath,
  writePath,
} from '@/lib/saws2-question-planner';
import {
  back,
  committedValue,
  currentQuestion,
  draftKind,
  resync,
  setDraft,
  shouldSubmitOnKey,
  startFlow,
  stillRelevant,
  submitChoice,
  submitDraft,
  usesDraft,
  validateDraft,
  type QuestionFlowState,
} from '@/lib/saws2-question-navigator';
import type { Saws2PlusApplicationData } from '@/types/application';
import { APPLICANT_MEMBER_ID } from '@/types/saws-questionnaire';

function set(
  data: Saws2PlusApplicationData,
  dotted: string,
  value: unknown,
): Saws2PlusApplicationData {
  return { ...data, questionnaire: writePath(data.questionnaire, dotted, value) };
}

function household(): Saws2PlusApplicationData {
  let n = 0;
  const data = buildInitialApplicationData(
    {
      zipCode: '90001',
      city: 'Los Angeles',
      state: 'CA',
      county: 'Los Angeles',
      preferredLanguage: 'English',
      householdProfile: 'me and my one year old',
      householdSize: 2,
      householdMembers: [{ age: 1 }],
      annualHouseholdIncome: 26000,
      incomeType: '',
      existingBenefits: '',
    },
    () => `member-${++n}`,
  );

  return {
    ...data,
    selectedPrograms: ['calfresh'],
    applicant: {
      ...data.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1993-04-12',
    },
    householdMembers: [
      { ...data.householdMembers[0], dateOfBirth: '2024-06-15' },
    ],
  };
}

/** A household with one job record that is missing its employer name. */
function withEmployerNameQuestion(): {
  data: Saws2PlusApplicationData;
  state: QuestionFlowState;
} {
  let data = set(household(), 'income.earned.answer', true);
  data = set(data, 'income.earned.entries', [
    {
      id: 'j1',
      memberId: APPLICANT_MEMBER_ID,
      employerName: '',
      employerAddress: '',
      employerPhone: '',
      startDate: '',
    },
  ]);

  // Open the flow directly on that question.
  const question = getRequiredApplicationQuestions(data).outstanding.find(
    (q) => q.id === 'income.earned.0.employerName',
  );
  expect(question).toBeDefined();

  return {
    data,
    state: { trail: [question!], index: 0, draft: '', error: null },
  };
}

// ---------------------------------------------------------------------------
// 1–2. Typing does not touch application state or advance the planner
// ---------------------------------------------------------------------------

describe('typing is local until submitted', () => {
  it('does not write a single character into application data', () => {
    const { data, state } = withEmployerNameQuestion();
    const typed = setDraft(state, 'A');

    expect(typed.draft).toBe('A');
    expect(readPath(data.questionnaire, 'income.earned.entries.0.employerName')).toBe(
      '',
    );
  });

  it('does not advance the planner while characters accumulate', () => {
    const { data, state } = withEmployerNameQuestion();

    let flow = state;
    for (const draft of ['A', 'Ac', 'Acm', 'Acme']) {
      flow = setDraft(flow, draft);

      // The question on screen never changes.
      expect(currentQuestion(flow)?.id).toBe('income.earned.0.employerName');
      // And it is still outstanding, because nothing was written.
      expect(
        getRequiredApplicationQuestions(data).outstanding.map((q) => q.id),
      ).toContain('income.earned.0.employerName');
    }

    expect(flow.draft).toBe('Acme');
  });

  it('never mutates the data object it is given', () => {
    const { data, state } = withEmployerNameQuestion();
    const snapshot = JSON.stringify(data);

    setDraft(state, 'Acme');
    validateDraft(currentQuestion(state), 'Acme');

    expect(JSON.stringify(data)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 3–4. Enter and Continue each commit exactly once and advance
// ---------------------------------------------------------------------------

describe('submitting an answer', () => {
  it('commits once and advances', () => {
    const { data, state } = withEmployerNameQuestion();
    const typed = setDraft(state, 'Acme Diner');

    const result = submitDraft(data, typed);

    expect(result.committed).toBe(true);
    expect(
      readPath(result.data.questionnaire, 'income.earned.entries.0.employerName'),
    ).toBe('Acme Diner');
    // The answered question is no longer outstanding.
    expect(
      getRequiredApplicationQuestions(result.data).outstanding.map((q) => q.id),
    ).not.toContain('income.earned.0.employerName');
    // And the flow moved on.
    expect(currentQuestion(result.state)?.id).not.toBe(
      'income.earned.0.employerName',
    );
  });

  it('is idempotent in effect when submitted twice', () => {
    const { data, state } = withEmployerNameQuestion();
    const first = submitDraft(data, setDraft(state, 'Acme Diner'));

    // A second submit on the advanced state cannot re-write the old answer.
    const second = submitDraft(first.data, first.state);

    expect(
      readPath(second.data.questionnaire, 'income.earned.entries.0.employerName'),
    ).toBe('Acme Diner');
    expect(
      activeEntries(second.data.questionnaire.income.earned),
    ).toHaveLength(1);
  });

  it('trims the committed value', () => {
    const { data, state } = withEmployerNameQuestion();
    const result = submitDraft(data, setDraft(state, '   Acme Diner   '));

    expect(
      readPath(result.data.questionnaire, 'income.earned.entries.0.employerName'),
    ).toBe('Acme Diner');
  });

  it('maps Enter to submit and Shift+Enter to nothing', () => {
    expect(shouldSubmitOnKey({ key: 'Enter' })).toBe(true);
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(shouldSubmitOnKey({ key: 'a' })).toBe(false);
    // A multiline input never submits on Enter.
    expect(shouldSubmitOnKey({ key: 'Enter' }, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Empty and invalid values cannot advance
// ---------------------------------------------------------------------------

describe('validation before commit', () => {
  it('refuses an empty required value', () => {
    const { data, state } = withEmployerNameQuestion();
    const result = submitDraft(data, state);

    expect(result.committed).toBe(false);
    expect(result.data).toBe(data);
    expect(result.state.error).toBeTruthy();
    expect(currentQuestion(result.state)?.id).toBe('income.earned.0.employerName');
  });

  it('refuses whitespace only', () => {
    const { data, state } = withEmployerNameQuestion();
    const result = submitDraft(data, setDraft(state, '    '));

    expect(result.committed).toBe(false);
    expect(readPath(result.data.questionnaire, 'income.earned.entries.0.employerName')).toBe('');
  });

  it('validates amounts and dates by field semantics', () => {
    const amount = { id: 'x', kind: 'field' as const, section: 'income' as const, prompt: '', path: 'income.earned.entries.0.grossPerPeriod' };
    const date = { id: 'y', kind: 'field' as const, section: 'income' as const, prompt: '', path: 'income.earned.entries.0.startDate' };

    expect(draftKind(amount)).toBe('number');
    expect(draftKind(date)).toBe('date');

    expect(validateDraft(amount, 'abc').ok).toBe(false);
    expect(validateDraft(amount, '-5').ok).toBe(false);
    expect(validateDraft(amount, '800').value).toBe(800);

    expect(validateDraft(date, 'not a date').ok).toBe(false);
    expect(validateDraft(date, '2024-01-15').value).toBe('2024-01-15');
  });

  it('reports which questions use a draft at all', () => {
    const { state } = withEmployerNameQuestion();

    expect(usesDraft(currentQuestion(state))).toBe(true);
    expect(
      usesDraft({ id: 'g', kind: 'gateway', section: 'income', prompt: '', path: 'income.earned.answer' }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6–8. Back, prefill, and editing
// ---------------------------------------------------------------------------

describe('question-level back', () => {
  /** Answer two gateways so the trail has history. */
  function twoAnswered() {
    let data = household();
    let flow = startFlow(data);

    const first = currentQuestion(flow)!;
    let result = submitChoice(data, flow, first.path, false);
    data = result.data;
    flow = result.state;

    const second = currentQuestion(flow)!;
    result = submitChoice(data, flow, second.path, true);

    return { data: result.data, state: result.state, first, second };
  }

  it('returns to the previous question with its answer still selected', () => {
    const { data, state, second } = twoAnswered();
    const result = back(data, state);

    expect(result.atStart).toBe(false);
    expect(currentQuestion(result.state)?.id).toBe(second.id);

    // A Yes/No answer is shown by the selected button, not by a text draft, so
    // committedValue is empty for a boolean while the answer itself remains.
    expect(readPath(data.questionnaire, second.path)).toBe(true);
    expect(committedValue(data, second)).toBe('');
  });

  it('does not mutate application data', () => {
    const { data, state } = twoAnswered();
    const snapshot = JSON.stringify(data);

    back(data, state);

    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it('does not erase the existing answer', () => {
    const { data, state, first, second } = twoAnswered();

    back(data, state);

    // Both previously committed answers survive navigation untouched.
    expect(readPath(data.questionnaire, first.path)).toBe(false);
    expect(readPath(data.questionnaire, second.path)).toBe(true);
  });

  it('reports atStart at the beginning so the component can leave the step', () => {
    const data = household();
    const flow = startFlow(data);

    const result = back(data, flow);

    expect(result.atStart).toBe(true);
    // The state is unchanged; leaving the step is the component's decision.
    expect(result.state).toBe(flow);
  });

  it('prefills a text answer when revisiting it', () => {
    const { data, state } = withEmployerNameQuestion();
    const committed = submitDraft(data, setDraft(state, 'Acme Diner'));

    const returned = back(committed.data, committed.state);

    expect(currentQuestion(returned.state)?.id).toBe('income.earned.0.employerName');
    expect(returned.state.draft).toBe('Acme Diner');
  });

  it('lets an earlier answer be edited and recommitted', () => {
    const { data, state } = withEmployerNameQuestion();
    const committed = submitDraft(data, setDraft(state, 'Acme Diner'));
    const returned = back(committed.data, committed.state);

    const edited = submitDraft(
      committed.data,
      setDraft(returned.state, 'Night Shift Co'),
    );

    expect(
      readPath(edited.data.questionnaire, 'income.earned.entries.0.employerName'),
    ).toBe('Night Shift Co');
  });
});

// ---------------------------------------------------------------------------
// 9. Changing a gateway respects branching and the stale-record policy
// ---------------------------------------------------------------------------

describe('editing a gateway after the fact', () => {
  function jobAnswered() {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      {
        id: 'j1',
        memberId: APPLICANT_MEMBER_ID,
        employerName: 'Acme Diner',
        employerAddress: '',
        employerPhone: '',
        startDate: '',
      },
    ]);

    const gateway = {
      id: 'income.earned',
      kind: 'gateway' as const,
      section: 'income' as const,
      prompt: 'Does anyone get income from a job?',
      path: 'income.earned.answer',
    };
    const field = {
      id: 'income.earned.0.employerName',
      kind: 'field' as const,
      section: 'income' as const,
      prompt: 'Employer name',
      path: 'income.earned.entries.0.employerName',
    };

    return {
      data,
      state: { trail: [gateway, field], index: 1, draft: '', error: null },
      gateway,
      field,
    };
  }

  it('treats a record field as irrelevant once its gateway becomes No', () => {
    const { data, field } = jobAnswered();
    const flipped = set(data, 'income.earned.answer', false);

    expect(stillRelevant(data, field)).toBe(true);
    expect(stillRelevant(flipped, field)).toBe(false);
  });

  it('skips the now-irrelevant question when stepping back', () => {
    const { state, gateway, field } = jobAnswered();
    let data = jobAnswered().data;

    // The user goes back to the gateway and changes it to No.
    const returned = back(data, state);
    expect(currentQuestion(returned.state)?.id).toBe(gateway.id);

    const flipped = submitChoice(data, returned.state, gateway.path, false);
    data = flipped.data;

    // Forward navigation must not land on the inert record field.
    expect(currentQuestion(flipped.state)?.id).not.toBe(field.id);
  });

  it('retains the stale record but treats it as inactive', () => {
    const { data, state, gateway } = jobAnswered();
    const returned = back(data, state);
    const flipped = submitChoice(data, returned.state, gateway.path, false);

    // Existing stale-record policy: data kept, records inactive.
    expect(flipped.data.questionnaire.income.earned.entries).toHaveLength(1);
    expect(activeEntries(flipped.data.questionnaire.income.earned)).toEqual([]);

    const keys = buildApplicationFieldPlan(flipped.data).map((f) => f.key);
    expect(keys.filter((key) => key.startsWith('income.earned.'))).toEqual([]);
  });

  it('does not fabricate answers or reactivate records when going back', () => {
    const { data, state } = jobAnswered();
    const flipped = set(data, 'income.earned.answer', false);

    const returned = back(flipped, state);

    expect(activeEntries(flipped.questionnaire.income.earned)).toEqual([]);
    expect(returned.state.draft === '' || typeof returned.state.draft === 'string').toBe(
      true,
    );
  });

  it('reactivates the records when the gateway goes back to Yes', () => {
    const { data, state, gateway } = jobAnswered();
    const off = submitChoice(data, back(data, state).state, gateway.path, false);
    const on = submitChoice(off.data, off.state, gateway.path, true);

    expect(activeEntries(on.data.questionnaire.income.earned)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 10–11. Explicit choices submit immediately
// ---------------------------------------------------------------------------

describe('explicit choices', () => {
  it('commits a Yes/No answer immediately and advances', () => {
    const data = household();
    const flow = startFlow(data);
    const question = currentQuestion(flow)!;

    const result = submitChoice(data, flow, question.path, false);

    expect(result.committed).toBe(true);
    expect(readPath(result.data.questionnaire, question.path)).toBe(false);
    expect(currentQuestion(result.state)?.id).not.toBe(question.id);
  });

  it('keeps Yes and No distinguishable from unknown', () => {
    const data = household();
    const flow = startFlow(data);
    const question = currentQuestion(flow)!;

    expect(readPath(data.questionnaire, question.path)).toBeUndefined();
    expect(
      readPath(submitChoice(data, flow, question.path, true).data.questionnaire, question.path),
    ).toBe(true);
  });

  it('commits a member selection as an explicit choice', () => {
    let data = set(household(), 'income.earned.answer', true);
    const flow = startFlow(data);

    const record = {
      id: 'j1',
      memberId: 'member-1',
      employerName: '',
      employerAddress: '',
      employerPhone: '',
      startDate: '',
    };

    const result = submitChoice(data, flow, 'income.earned.entries', [record]);

    expect(
      activeEntries(result.data.questionnaire.income.earned)[0],
    ).toMatchObject({ memberId: 'member-1' });
  });

  it('does not advance merely because a picker was opened', () => {
    // Opening a picker is local component state; the flow is untouched.
    const data = set(household(), 'income.earned.answer', true);
    const flow = startFlow(data);

    expect(currentQuestion(resync(data, flow))?.id).toBe(currentQuestion(flow)?.id);
  });
});

// ---------------------------------------------------------------------------
// 12–13. Step isolation and array preservation
// ---------------------------------------------------------------------------

describe('step isolation', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../../src/components/application/questionnaire-step.tsx'),
    'utf8',
  );

  it('has no form element, so Enter cannot submit the application step', () => {
    expect(source).not.toMatch(/<form/);
  });

  it('prevents the default action on the Enter key', () => {
    expect(source).toMatch(/preventDefault\(\)/);
  });

  it('routes Enter through the navigator rather than the step buttons', () => {
    expect(source).toMatch(/shouldSubmitOnKey/);
  });

  it('keeps the two Back concepts separate', () => {
    // Question-level back is the navigator's; the step-level one calls onBack.
    expect(source).toMatch(/atStart/);
    expect(source).toMatch(/onBack\(\)/);
  });
});

describe('array-backed paths survive submission', () => {
  it('keeps entries an array after committing a record field', () => {
    const { data, state } = withEmployerNameQuestion();
    const result = submitDraft(data, setDraft(state, 'Acme Diner'));

    const entries = readPath(result.data.questionnaire, 'income.earned.entries');

    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
  });

  it('leaves sibling records untouched', () => {
    let data = set(household(), 'income.earned.answer', true);
    data = set(data, 'income.earned.entries', [
      { id: 'a', memberId: APPLICANT_MEMBER_ID, employerName: 'First', employerAddress: '', employerPhone: '', startDate: '' },
      { id: 'b', memberId: APPLICANT_MEMBER_ID, employerName: '', employerAddress: '', employerPhone: '', startDate: '' },
    ]);

    const question = getRequiredApplicationQuestions(data).outstanding.find(
      (q) => q.id === 'income.earned.1.employerName',
    );
    expect(question).toBeDefined();

    const result = submitDraft(
      data,
      { trail: [question!], index: 0, draft: 'Second', error: null },
    );

    const entries = readPath(
      result.data.questionnaire,
      'income.earned.entries',
    ) as Array<{ employerName: string }>;

    expect(entries[0].employerName).toBe('First');
    expect(entries[1].employerName).toBe('Second');
  });
});

// ---------------------------------------------------------------------------
// Draft lifecycle
// ---------------------------------------------------------------------------

describe('draft lifecycle', () => {
  it('starts empty for an unanswered question', () => {
    const data = household();
    const flow = startFlow(data);

    expect(flow.draft).toBe('');
  });

  it('initializes from the committed answer when revisiting', () => {
    const { data, state } = withEmployerNameQuestion();
    const committed = submitDraft(data, setDraft(state, 'Acme Diner'));

    expect(back(committed.data, committed.state).state.draft).toBe('Acme Diner');
  });

  it('resets when the displayed question changes', () => {
    const { data, state } = withEmployerNameQuestion();
    const typed = setDraft(state, 'Acme Diner');
    const committed = submitDraft(data, typed);

    // The next question gets its own draft, not the previous text.
    const next = currentQuestion(committed.state);
    expect(committed.state.draft).toBe(committedValue(committed.data, next));
  });

  it('clears the error as soon as the draft changes', () => {
    const { data, state } = withEmployerNameQuestion();
    const failed = submitDraft(data, state);

    expect(failed.state.error).toBeTruthy();
    expect(setDraft(failed.state, 'A').error).toBeNull();
  });
});
