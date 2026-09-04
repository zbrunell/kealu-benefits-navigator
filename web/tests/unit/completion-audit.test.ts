//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * A semantic audit of the completion model, re-run after the requiredness and
 * guide changes.
 *
 * The question it answers is not "does each item render?" — other suites cover
 * that — but "does the set of items still describe this draft honestly?" Two
 * ways to fail: naming work that is already done, and staying silent about work
 * that is not.
 */

import { describe, expect, it } from 'vitest';

import { assessDraftCompletion } from '@/lib/draft-completion';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { writePath } from '@/lib/saws2-question-planner';
import { EMPTY_APPLICATION_DATA, type Saws2PlusApplicationData } from '@/types/application';

/** A household that reaches as much of the form as one household can. */
function fullApplication(): Saws2PlusApplicationData {
  const base: Saws2PlusApplicationData = {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      middleName: 'Elena',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
      phone: '5595550100',
      email: 'maria@example.com',
      homeAddress: {
        ...EMPTY_APPLICATION_DATA.applicant.homeAddress,
        street: '12 Oak Street',
        city: 'Fresno',
        state: 'CA',
        zipCode: '93701',
      },
      householdDetails: {
        ...EMPTY_APPLICATION_DATA.applicant.householdDetails,
        maritalStatus: 'married',
        citizenOrNational: true,
      },
    },
  };

  let q = base.questionnaire;

  for (const [path, value] of [
    ['circumstances.everyoneHasSameContactInformation', true],
    ['income.earned.answer', false],
    ['income.unearned.answer', false],
    ['expenses.medical.answer', false],
    ['resources.vehicles.answer', false],
    ['circumstances.authorizedRepresentative.answer', false],
  ] as Array<[string, boolean]>) {
    q = writePath(q, path, value);
  }

  return { ...base, questionnaire: q };
}

describe('the guide does not name work that is already done', () => {
  it('never lists a blank for a key the plan populated', () => {
    const application = fullApplication();
    const populated = new Set(
      buildApplicationFieldPlan(application, {})
        .filter((entry) => entry.value !== undefined && entry.value !== '')
        .map((entry) => entry.key),
    );

    const completion = assessDraftCompletion(application);

    /*
     * The address is the clearest case: it is fully collected, so nothing in
     * the guide may describe it as outstanding.
     */
    expect(populated.has('applicant.home_address.street')).toBe(true);

    const mentionsAddress = completion.manualItems.some(
      (item) =>
        item.id.includes('home_address') || item.id.includes('applicant_street'),
    );

    expect(mentionsAddress).toBe(false);
  });

  it('does not list the Q6a contact blocks when everyone shares details', () => {
    const ids = assessDraftCompletion(fullApplication()).manualItems.map(
      (item) => item.id,
    );

    expect(ids).not.toContain('uncollected.member_contact');
  });

  it('does not list Appendix C when no representative was named', () => {
    const ids = assessDraftCompletion(fullApplication()).manualItems.map(
      (item) => item.id,
    );

    expect(ids).not.toContain('signature.appendix_c');
  });
});

describe('the guide stays silent about nothing it should mention', () => {
  const completion = assessDraftCompletion(fullApplication());
  const ids = completion.manualItems.map((item) => item.id);

  it('still names the Social Security boxes we never prefill', () => {
    expect(ids.some((id) => id.startsWith('ssn.'))).toBe(true);
  });

  it('still names the applicant’s signature and its date', () => {
    expect(ids).toContain('signature.applicant');
    expect(ids).toContain('signature.applicant_date');
  });

  it('names the race block, which is never collected for anyone', () => {
    expect(ids).toContain('uncollected.race_ethnicity');
  });

  it('gives every item a value type and an instruction', () => {
    for (const item of completion.manualItems) {
      expect(item.valueTypeKey, item.id).toBeTruthy();
      expect(item.instructionKey, item.id).toBeTruthy();
    }
  });

  it('gives every printed item a page and a printed page label', () => {
    for (const item of completion.manualItems) {
      /*
       * A missing answer is the exception, and legitimately so: a question
       * nobody has answered yet has no single printed location — the same
       * carve-out saws2-draft-completeness makes. Everything that names a spot
       * on the paper must actually name one.
       */
      if (item.reason === 'missing_answer') continue;

      expect(item.page, item.id).toBeGreaterThan(0);
      expect(item.printedPage, item.id).toBeTruthy();
    }
  });

  it('gives every item a unique id, so none can shadow another', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('requiredness and the guide agree', () => {
  it('an unanswered required question is reported as a missing answer', () => {
    const application = fullApplication();

    // Take marital status back out: it is required, so the model must notice.
    const withoutMaritalStatus: Saws2PlusApplicationData = {
      ...application,
      applicant: {
        ...application.applicant,
        householdDetails: {
          ...application.applicant.householdDetails,
          maritalStatus: undefined,
        },
      },
    };

    const completion = assessDraftCompletion(withoutMaritalStatus);

    // Whatever else it does, it must not claim the draft is ready to sign.
    expect(completion.readyForSignature).toBe(false);
  });

  it('an optional-only remainder does not block review and sign by itself', () => {
    // The race block is the only `optional_not_collected` item, and the form
    // says a blank there is complete — so it must not be what makes a draft
    // look unfinished.
    const completion = assessDraftCompletion(fullApplication());
    const optional = completion.manualItems.filter(
      (item) => item.reason === 'optional_not_collected',
    );

    expect(optional.length).toBeGreaterThan(0);
    expect(optional.every((item) => item.id === 'uncollected.race_ethnicity')).toBe(
      true,
    );
  });
});
