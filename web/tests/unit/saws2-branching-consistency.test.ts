//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Changing an earlier answer must not leave the later ones on the form.
 *
 * The architecture keeps reversed branches in state on purpose, so an applicant
 * who says No and changes their mind back does not retype everything. That is
 * only safe while the mapper refuses to emit detail behind a closed gateway —
 * otherwise a job the household no longer has is printed on a document they
 * sign under penalty of perjury.
 *
 * These pin the refusal, and the recalculation that goes with it.
 */

import { describe, expect, it } from 'vitest';

import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { assessDraftCompletion } from '@/lib/draft-completion';
import {
  getRequiredApplicationQuestions,
  writePath,
} from '@/lib/saws2-question-planner';
import { allowedRelationshipsForDateOfBirth } from '@/lib/household-relationships';
import {
  EMPTY_APPLICATION_DATA,
  type Saws2PlusApplicationData,
} from '@/types/application';

const TODAY = new Date(Date.UTC(2026, 7, 18));

function seed(): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: [],
  };
}

const w = (d: Saws2PlusApplicationData, path: string, value: unknown) => ({
  ...d,
  questionnaire: writePath(d.questionnaire, path, value),
});

/** A household with one job recorded behind an open Q8 gateway. */
function withEarnedIncome(): Saws2PlusApplicationData {
  let data = w(seed(), 'income.earned.answer', true);

  return w(data, 'income.earned.entries', [
    {
      id: 'e1',
      memberId: 'applicant',
      employerName: 'Acme Corp',
      reportedAmount: 400,
      reportedFrequency: 'weekly',
      expectedToContinue: true,
    },
  ]);
}

describe('reversing a gateway', () => {
  it('writes the job while the gateway is open', () => {
    const keys = buildApplicationFieldPlan(withEarnedIncome(), {}).map(
      (entry) => entry.key,
    );

    expect(keys.some((key) => /^income\.earned\.\d/.test(key))).toBe(true);
  });

  it('writes no job detail once the gateway is closed', () => {
    /*
     * The entries are deliberately still in state — reversible — but a closed
     * gateway means the household says it has no earned income, and printing a
     * job beside that answer would contradict it.
     */
    const reversed = w(withEarnedIncome(), 'income.earned.answer', false);
    const plan = buildApplicationFieldPlan(reversed, {});
    const keys = plan.map((entry) => entry.key);

    expect(keys.filter((key) => /^income\.earned\.\d/.test(key))).toEqual([]);
    expect(plan.find((entry) => entry.key === 'income.has_earned_income')?.value).toBe(
      false,
    );
  });

  it('stops asking the questions behind the closed gateway', () => {
    const reversed = w(withEarnedIncome(), 'income.earned.answer', false);
    const outstanding = getRequiredApplicationQuestions(reversed).outstanding;

    expect(outstanding.some((q) => q.id.startsWith('income.earned'))).toBe(false);
  });

  it('recalculates progress when a branch with follow-ups closes', () => {
    /*
     * Q26's Yes opens Appendix E's per-vehicle questions for a cash-aid
     * household. Closing it must take them out of the denominator, not merely
     * stop showing them — a question that cannot be reached must not be counted
     * as one the applicant still owes.
     */
    const cashAid: Saws2PlusApplicationData = {
      ...seed(),
      selectedPrograms: ['calworks'],
    };

    const open = getRequiredApplicationQuestions(
      w(cashAid, 'resources.vehicles.answer', true),
    );
    const closed = getRequiredApplicationQuestions(
      w(cashAid, 'resources.vehicles.answer', false),
    );

    expect(closed.totalCount).toBeLessThan(open.totalCount);
  });

  it('recalculates the completion guide when a branch closes', () => {
    const cashAid: Saws2PlusApplicationData = {
      ...seed(),
      selectedPrograms: ['calworks'],
    };

    const open = assessDraftCompletion(
      w(cashAid, 'resources.vehicles.answer', true),
    );
    const closed = assessDraftCompletion(
      w(cashAid, 'resources.vehicles.answer', false),
    );

    // Appendix E stops being an active appendix and becomes a skipped section.
    expect(open.skippedSections.map((s) => s.saws)).not.toContain('Appendix E');
    expect(closed.skippedSections.map((s) => s.saws)).toContain('Appendix E');
  });

  it('restores the detail when the applicant changes their mind back', () => {
    // The point of keeping reversed branches: no retyping.
    const reopened = w(
      w(withEarnedIncome(), 'income.earned.answer', false),
      'income.earned.answer',
      true,
    );

    const keys = buildApplicationFieldPlan(reopened, {}).map((e) => e.key);

    expect(keys.some((key) => /^income\.earned\.\d/.test(key))).toBe(true);
  });
});

describe('changing a date of birth', () => {
  it('changes which relationships are offered', () => {
    // The same person, aged down past the spouse threshold.
    expect(allowedRelationshipsForDateOfBirth('1990-01-01', TODAY)).toContain(
      'spouse',
    );
    expect(allowedRelationshipsForDateOfBirth('2017-01-01', TODAY)).not.toContain(
      'spouse',
    );
  });

  it('changes which household table a person lands in', () => {
    const withAdult: Saws2PlusApplicationData = {
      ...seed(),
      householdMembers: [
        {
          id: 'm1',
          firstName: 'Luis',
          middleName: '',
          lastName: 'Reyes',
          dateOfBirth: '1988-05-04',
          relationshipToApplicant: 'spouse',
        },
      ],
    };

    const asChild: Saws2PlusApplicationData = {
      ...withAdult,
      householdMembers: [
        { ...withAdult.householdMembers[0], dateOfBirth: '2017-01-01' },
      ],
    };

    const adultKeys = buildApplicationFieldPlan(withAdult, {}).map((e) => e.key);
    const childKeys = buildApplicationFieldPlan(asChild, {}).map((e) => e.key);

    expect(adultKeys).toContain('household.members.0.table');
    expect(
      buildApplicationFieldPlan(withAdult, {}).find(
        (e) => e.key === 'household.members.0.table',
      )?.value,
    ).toBe('adult');
    expect(
      buildApplicationFieldPlan(asChild, {}).find(
        (e) => e.key === 'household.members.0.table',
      )?.value,
    ).toBe('child');
    expect(childKeys.length).toBeGreaterThan(0);
  });
});

describe('changing the programs applied for', () => {
  it('asks the same base questions of every program', () => {
    // The base set is not program-specific; the differences live behind
    // conditional gateways, which is the next case.
    const calFreshOnly = getRequiredApplicationQuestions(seed());
    const allThree = getRequiredApplicationQuestions({
      ...seed(),
      selectedPrograms: ['calfresh', 'calworks', 'medi_cal'],
    });

    expect(allThree.totalCount).toBe(calFreshOnly.totalCount);
  });

  it('asks the cash-aid-only questions only for cash aid', () => {
    /*
     * Appendix E's printed page states its own scope: required for cash aid,
     * and for health care only where someone is 65 or older or disabled. With
     * a vehicle declared, a cash-aid household is asked more than a Medi-Cal
     * one of the same shape.
     */
    const withVehicle = (programs: Saws2PlusApplicationData['selectedPrograms']) =>
      getRequiredApplicationQuestions(
        w({ ...seed(), selectedPrograms: programs }, 'resources.vehicles.answer', true),
      ).totalCount;

    expect(withVehicle(['calworks'])).toBeGreaterThan(withVehicle(['medi_cal']));
  });

  it('writes only the programs currently selected', () => {
    const plan = buildApplicationFieldPlan(
      { ...seed(), selectedPrograms: ['calfresh'] },
      {},
    );

    expect(plan.find((e) => e.key === 'programs.calfresh')?.value).toBe(true);
    expect(plan.find((e) => e.key === 'programs.calworks')?.value).not.toBe(true);
  });
});
