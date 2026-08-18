//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Questionnaire progress must reach 100% when the interview is done.
 *
 * Two different things get confused here, and the product keeps them apart:
 *
 *   the interview  — questions Benefits Navigator asks and the applicant
 *                    answers, which is what the progress bar measures
 *   the document   — blanks on the printed SAWS 2 PLUS that a person fills in
 *                    by hand: Social Security Numbers, signatures, and printed
 *                    questions no widget can safely carry
 *
 * The second must never count against the first. Reaching 100% means "you have
 * answered everything we can ask", not "the PDF is ready to post".
 *
 * The bug this pins: a planned question could name a path in one store and be
 * written to the other. The write landed, the flow advanced, and the planner
 * kept reporting the question outstanding because nothing read where the value
 * went — so the applicant could finish the interview and still be told
 * questions remained.
 */

import { describe, expect, it } from 'vitest';

import { assessDraftCompletion } from '@/lib/draft-completion';
import { SAWS2_FIELDS } from '@/lib/saws2-schema';
import {
  answerQuestion,
  getRequiredApplicationQuestions,
  type PlannedQuestion,
} from '@/lib/saws2-question-planner';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

function seed(
  programs: Saws2PlusApplicationData['selectedPrograms'] = ['calfresh', 'medi_cal'],
  members: HouseholdMember[] = [],
): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: programs,
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: members,
  };
}

/** A plausible answer for a question, chosen from its kind alone. */
function plausibleAnswer(question: PlannedQuestion): unknown {
  switch (question.kind) {
    case 'gateway':
      return false;
    case 'records':
      return [];
    case 'choice':
      return question.options?.[0]?.value ?? 'other';
    default:
      return 'Answered';
  }
}

/**
 * Answer questions the way the UI does until none remain.
 *
 * Returns the finished application and how many answers it took. Throws if an
 * answer fails to register, which is exactly the failure being guarded: a
 * question that cannot be satisfied would otherwise spin here forever.
 */
function completeInterview(start: Saws2PlusApplicationData): {
  data: Saws2PlusApplicationData;
  answers: number;
} {
  let data = start;

  for (let answers = 0; answers <= 400; answers += 1) {
    const plan = getRequiredApplicationQuestions(data);

    if (plan.outstanding.length === 0) return { data, answers };

    const question = plan.outstanding[0];
    const next = answerQuestion(data, question, plausibleAnswer(question));

    if (JSON.stringify(next) === JSON.stringify(data)) {
      throw new Error(
        `Answering ${question.id} changed nothing — its path ${question.path} ` +
          `does not resolve in the ${question.store} store.`,
      );
    }

    const after = getRequiredApplicationQuestions(next);

    if (after.outstanding.some((left) => left.id === question.id)) {
      throw new Error(
        `${question.id} is still outstanding after being answered. Its path ` +
          `${question.path} is written to the ${question.store} store but read ` +
          'from somewhere else.',
      );
    }

    data = next;
  }

  throw new Error('The interview did not converge');
}

// ---------------------------------------------------------------------------
// The headline behaviour
// ---------------------------------------------------------------------------

describe('a completed interview reports 100% and nothing left', () => {
  it('converges to zero outstanding questions', () => {
    const { data } = completeInterview(seed());
    const plan = getRequiredApplicationQuestions(data);

    expect(plan.outstanding).toHaveLength(0);
    expect(plan.answeredCount).toBe(plan.totalCount);
    expect(
      Math.round((plan.answeredCount / plan.totalCount) * 100),
    ).toBe(100);
  });

  it('does so for every program combination', () => {
    for (const programs of [
      ['calfresh'],
      ['calworks'],
      ['medi_cal'],
      ['calfresh', 'calworks', 'medi_cal'],
    ] as const) {
      const { data } = completeInterview(seed([...programs]));
      const plan = getRequiredApplicationQuestions(data);

      expect(plan.outstanding, programs.join('+')).toHaveLength(0);
      expect(plan.answeredCount, programs.join('+')).toBe(plan.totalCount);
    }
  });

  it('does so for a household with other people in it', () => {
    const members: HouseholdMember[] = [
      {
        id: 'm1',
        firstName: 'Luis',
        middleName: '',
        lastName: 'Reyes',
        dateOfBirth: '1988-05-04',
        relationshipToApplicant: 'spouse',
      },
      {
        id: 'm2',
        firstName: 'Sofia',
        middleName: '',
        lastName: 'Delgado',
        dateOfBirth: '2018-03-02',
        relationshipToApplicant: 'child',
      },
    ];

    const { data } = completeInterview(seed(['calfresh', 'medi_cal'], members));

    expect(getRequiredApplicationQuestions(data).outstanding).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Every question must be answerable where it says it lives
// ---------------------------------------------------------------------------

describe('a planned question is answerable in the store it declares', () => {
  it('names a store for every question it asks', () => {
    for (const question of getRequiredApplicationQuestions(seed()).outstanding) {
      expect(['questionnaire', 'application'], question.id).toContain(
        question.store,
      );
    }
  });

  it('settles every question the interview presents, one at a time', () => {
    // completeInterview throws with the offending question's id and path if any
    // answer fails to register or the question survives being answered.
    expect(() => completeInterview(seed(['calfresh', 'calworks', 'medi_cal']))).not.toThrow();
  });

  it('keeps the Q4 interview preferences on the application, where they are read', () => {
    const plan = getRequiredApplicationQuestions(seed());
    const preference = plan.outstanding.find(
      (question) => question.id === 'preferences.in_person_interview',
    );

    expect(preference).toBeDefined();
    expect(preference!.store).toBe('application');

    const answered = answerQuestion(seed(), preference!, true);

    expect(answered.preferences.prefersInPersonInterview).toBe(true);
    // And nothing was smuggled into the questionnaire under a parallel name.
    expect(JSON.stringify(answered.questionnaire)).not.toContain(
      'prefersInPersonInterview',
    );
  });
});

// ---------------------------------------------------------------------------
// Manual PDF work is not interview work
// ---------------------------------------------------------------------------

describe('manual completion never counts against interview progress', () => {
  const { data } = completeInterview(seed(['calfresh', 'medi_cal']));
  const plan = getRequiredApplicationQuestions(data);
  const completion = assessDraftCompletion(data);

  it('leaves the interview complete while the draft still needs hand work', () => {
    expect(plan.outstanding).toHaveLength(0);
    expect(completion.manualItems.length).toBeGreaterThan(0);
  });

  it('asks no question for a Social Security Number or a signature', () => {
    const ids = plan.outstanding.map((question) => question.id).join(' ');

    expect(ids).not.toMatch(/ssn|social_security|signature/i);
    expect(completion.byReason.ssn.length).toBeGreaterThan(0);
    expect(completion.byReason.signature.length).toBeGreaterThan(0);
  });

  it('counts Q23f as answered even though its box must be ticked by hand', () => {
    // Q23f is askable — the applicant tells us the answer — but the printed
    // page has one checkbox between two opposite choices, so it cannot be
    // written. Being unwritable is a fact about the paper, not an unanswered
    // question.
    expect(data.questionnaire.health.renewalAuthorization).not.toBeUndefined();
    expect(
      plan.outstanding.some((question) => question.path.includes('renewalAuthorization')),
    ).toBe(false);

    expect(
      completion.byReason.unsupported.map((item) => item.saws),
    ).toContain('Q23f');
  });

  it('still lists the applicable manual work in the guide', () => {
    const reasons = new Set(completion.manualItems.map((item) => item.reason));

    expect(reasons).toContain('ssn');
    expect(reasons).toContain('signature');
    expect(completion.byReason.missing_answer).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Progress still tells the truth about real gaps
// ---------------------------------------------------------------------------

describe('progress still reflects genuinely unanswered questions', () => {
  it('drops below 100% when an applicable question is unanswered', () => {
    const { data } = completeInterview(seed());
    const complete = getRequiredApplicationQuestions(data);

    const reopened: Saws2PlusApplicationData = {
      ...data,
      questionnaire: {
        ...data.questionnaire,
        programIntegrity: {
          ...data.questionnaire.programIntegrity,
          fleeingFelon: undefined,
        },
      },
    };

    const plan = getRequiredApplicationQuestions(reopened);

    expect(plan.outstanding.length).toBe(1);
    expect(plan.answeredCount).toBe(complete.answeredCount - 1);
    expect(plan.totalCount).toBe(complete.totalCount);
  });

  it('counts a conditional follow-up only once its gateway opens it', () => {
    const closed = seed();
    const beforeTotal = getRequiredApplicationQuestions(closed).totalCount;

    // Saying yes to vehicles opens Appendix E's per-vehicle questions.
    const opened: Saws2PlusApplicationData = {
      ...closed,
      selectedPrograms: ['calworks'],
      questionnaire: {
        ...closed.questionnaire,
        resources: {
          ...closed.questionnaire.resources,
          vehicles: { answer: true, entries: [] },
        },
      },
    };

    const openedTotal = getRequiredApplicationQuestions(opened).totalCount;

    expect(openedTotal).toBeGreaterThan(beforeTotal);
  });

  it('leaves a non-applicable conditional out of the denominator entirely', () => {
    const noVehicles: Saws2PlusApplicationData = {
      ...seed(['calworks']),
      questionnaire: {
        ...seed(['calworks']).questionnaire,
        resources: {
          ...seed(['calworks']).questionnaire.resources,
          vehicles: { answer: false, entries: [] },
        },
      },
    };

    const ids = getRequiredApplicationQuestions(noVehicles).outstanding.map(
      (question) => question.id,
    );

    expect(ids.some((id) => id.startsWith('appendices.vehicle_details'))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The planner and the schema must describe the same answer
// ---------------------------------------------------------------------------

describe('the planner and the schema agree on where an answer lives', () => {
  it('uses the same path for every question they both describe', () => {
    /*
     * Both files name a path for the same concept, and they drifted: the schema
     * said the Q4 interview preferences were at applicant.preferences.*, one
     * hop deeper than the application actually keeps them. Nothing resolved the
     * schema's copy, so the untruth sat there while the planner's copy — which
     * is resolved — broke the progress bar.
     */
    const planned = new Map(
      getRequiredApplicationQuestions(seed(['calfresh', 'calworks', 'medi_cal']))
        .outstanding.map((question) => [question.id, question.path]),
    );

    for (const field of SAWS2_FIELDS) {
      const path = planned.get(field.id);

      if (!path || !field.path) continue;

      expect(field.path, `${field.id} disagrees between schema and planner`).toBe(
        path,
      );
    }
  });
});
