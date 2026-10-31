//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The per-person answers H1010 asks, and where they are kept.
 *
 * These are the data-integrity halves of the household work: a person's
 * identity has to survive editing, their answers have to land on their own
 * record, and one person's programme selection must never become another's.
 * The browser tests prove the screen behaves; these prove the model does.
 */

import { describe, expect, it } from 'vitest';

import {
  PERSON_PROGRAM_CHOICES,
  TX_HOUSEHOLD_ROSTER,
  memberDetail,
  memberPrograms,
  writeMemberDetail,
  writeMemberPrograms,
} from '@/lib/form-intake/tx-h1010';
import { buildApplicationFieldPlan } from '@/lib/application-mapper';
import { buildInitialApplicationData } from '@/lib/application-data';
import { messages, t } from '@/i18n';
import type { HouseholdMember } from '@/types/application';

function person(over: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    id: 'person-1',
    firstName: 'María',
    middleName: '',
    lastName: 'Rivera',
    dateOfBirth: '1988-04-02',
    relationshipToApplicant: 'spouse',
    adultDetails: { applyingFor: [] },
    childDetails: { applyingFor: [], placeOfBirth: '', parentStatus: {} },
    ...over,
  };
}

/** A date of birth that makes someone a child today, whenever today is. */
function childDateOfBirth(): string {
  const now = new Date();

  return `${now.getUTCFullYear() - 8}-06-15`;
}

describe('per-person answers land on the person', () => {
  it('keeps an adult answer on the adult record', () => {
    const updated = writeMemberDetail(person(), 'livesInTexas', true);

    expect(updated.adultDetails?.livesInTexas).toBe(true);
    expect(memberDetail(updated, 'livesInTexas')).toBe(true);
  });

  it('keeps a child answer on the child record', () => {
    const child = person({ dateOfBirth: childDateOfBirth() });
    const updated = writeMemberDetail(child, 'attendsSchool', true);

    expect(updated.childDetails?.attendsSchool).toBe(true);
    expect(memberDetail(updated, 'attendsSchool')).toBe(true);
  });

  it('keeps marital status on the adult record whatever the age says', () => {
    /*
     * Adult-only because that is where the field exists. A date of birth
     * corrected downward must not silently drop an answer already given — the
     * intake stops *asking*, which is different from discarding.
     */
    const adult = writeMemberDetail(person(), 'maritalStatus', 'married');

    expect(memberDetail(adult, 'maritalStatus')).toBe('married');

    const nowAChild = { ...adult, dateOfBirth: childDateOfBirth() };

    expect(memberDetail(nowAChild, 'maritalStatus')).toBe('married');
  });

  it('round-trips every tri-state answer, including an explicit no', () => {
    for (const key of [
      'livesInTexas',
      'plansToStayInTexas',
      'attendsSchool',
      'fullTimeStudent',
      'citizenOrNational',
    ] as const) {
      expect(memberDetail(writeMemberDetail(person(), key, false), key)).toBe(
        false,
      );

      // And back to unanswered, which is not the same as no.
      expect(
        memberDetail(writeMemberDetail(person(), key, undefined), key),
      ).toBeUndefined();
    }
  });

  it('leaves a person’s id alone when their answers change', () => {
    let updated = person({ id: 'stable-id' });

    updated = writeMemberDetail(updated, 'livesInTexas', true);
    updated = writeMemberPrograms(updated, ['tx_snap']);
    updated = { ...updated, firstName: 'María Elena' };

    expect(updated.id).toBe('stable-id');
  });
});

describe('programme selection belongs to one person', () => {
  it('starts empty — nobody is applying for anything by default', () => {
    expect(memberPrograms(person())).toEqual([]);
  });

  it('keeps each person’s selection separate', () => {
    const spouse = writeMemberPrograms(person({ id: 'a' }), ['tx_snap']);
    const child = writeMemberPrograms(
      person({ id: 'b', dateOfBirth: childDateOfBirth() }),
      ['tx_chip'],
    );

    expect(memberPrograms(spouse)).toEqual(['tx_snap']);
    expect(memberPrograms(child)).toEqual(['tx_chip']);
  });

  it('offers exactly the four programmes H1010 covers', () => {
    expect(PERSON_PROGRAM_CHOICES.map((c) => c.program)).toEqual([
      'tx_snap',
      'tx_medicaid',
      'tx_chip',
      'tx_tanf',
    ]);
  });

  it('describes each programme in every locale, without promising anything', () => {
    for (const locale of ['en', 'es', 'zh-CN'] as const) {
      for (const choice of PERSON_PROGRAM_CHOICES) {
        const name = t(messages[locale], choice.nameKey);
        const summary = t(messages[locale], choice.summaryKey);

        expect(name).toBeTruthy();
        expect(summary).toBeTruthy();

        // Short enough to scan beside a checkbox.
        expect(summary.length).toBeLessThan(110);

        // Never a promise of eligibility.
        for (const promise of [
          'you qualify',
          'you will get',
          'guarantee',
          'califica',
          'va a recibir',
        ]) {
          expect(summary.toLowerCase()).not.toContain(promise);
        }
      }
    }
  });
});

describe('the field plan carries per-person answers', () => {
  function planFor(members: HouseholdMember[]) {
    const data = buildInitialApplicationData(null);

    return buildApplicationFieldPlan(
      { ...data, householdMembers: members },
      { county: 'Travis' },
    );
  }

  function valueOf(plan: ReturnType<typeof planFor>, key: string) {
    return plan.find((entry) => entry.key === key)?.value;
  }

  it('emits one programme entry per person, and none for a person not applying', () => {
    const plan = planFor([
      writeMemberPrograms(person({ id: 'a' }), ['tx_snap']),
      writeMemberPrograms(
        person({ id: 'b', dateOfBirth: childDateOfBirth() }),
        ['tx_chip', 'tx_medicaid'],
      ),
      // Applying for nothing: nobody chose for them.
      person({ id: 'c' }),
    ]);

    expect(valueOf(plan, 'household.members.0.programs.tx_snap')).toBe(true);
    expect(valueOf(plan, 'household.members.1.programs.tx_chip')).toBe(true);
    expect(valueOf(plan, 'household.members.1.programs.tx_medicaid')).toBe(
      true,
    );

    // Person 0 did not ask for CHIP and person 2 asked for nothing. Absent,
    // not false: an unmarked circle is what "not applying" looks like on the
    // form, and a `false` here would be a claim nobody made.
    expect(valueOf(plan, 'household.members.0.programs.tx_chip')).toBeUndefined();

    for (const choice of PERSON_PROGRAM_CHOICES) {
      expect(
        valueOf(plan, `household.members.2.programs.${choice.program}`),
      ).toBeUndefined();
    }
  });

  it('emits residency, school and marital answers per person', () => {
    let spouse = person({ id: 'a' });
    spouse = writeMemberDetail(spouse, 'livesInTexas', true);
    spouse = writeMemberDetail(spouse, 'plansToStayInTexas', false);
    spouse = writeMemberDetail(spouse, 'maritalStatus', 'married');
    spouse = writeMemberDetail(spouse, 'attendsSchool', false);

    const plan = planFor([spouse]);

    expect(valueOf(plan, 'household.members.0.adult.lives_in_texas')).toBe(
      true,
    );
    expect(
      valueOf(plan, 'household.members.0.adult.plans_to_stay_in_texas'),
    ).toBe(false);
    expect(valueOf(plan, 'household.members.0.adult.marital_status')).toBe(
      'married',
    );
    expect(valueOf(plan, 'household.members.0.adult.attends_school')).toBe(
      false,
    );
  });

  it('routes a child’s answers to the child keys', () => {
    let child = person({ id: 'a', dateOfBirth: childDateOfBirth() });
    child = writeMemberDetail(child, 'livesInTexas', true);
    child = writeMemberDetail(child, 'attendsSchool', true);
    child = writeMemberDetail(child, 'fullTimeStudent', true);

    const plan = planFor([child]);

    expect(valueOf(plan, 'household.members.0.child.lives_in_texas')).toBe(
      true,
    );
    expect(valueOf(plan, 'household.members.0.child.attends_school')).toBe(
      true,
    );
    expect(valueOf(plan, 'household.members.0.child.full_time_student')).toBe(
      true,
    );
  });
});

describe('the roster shows the capacity the form actually has', () => {
  it('warns after four people, which is what H1010 prints', () => {
    /*
     * H1010 prints Person 2 through Person 5. This said six — the intake's own
     * capacity — so a household of six was told everything fitted and two
     * people would have vanished from the printed table.
     *
     * Kept in step with `h1010_official.OFFICIAL_PERSON_ROWS`, which is what
     * reports the overflow on the review sheet. The Python suite asserts that
     * number against the form; this asserts the interface agrees with it.
     */
    expect(TX_HOUSEHOLD_ROSTER.printedRows).toBe(4);
  });
});
