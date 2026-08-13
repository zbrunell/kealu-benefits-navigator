//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Readiness must name what is missing, not just say "incomplete".
 *
 * The trap this guards against: answering every question the flow asks is not
 * the same as producing a finished document. A question can be answered and
 * still have nowhere on the printed form to go, and a printed question the
 * product does not model never becomes a question at all. Reporting
 * "fully prefilled" in either case tells the applicant a half-blank form is
 * done.
 */

import { describe, expect, it } from 'vitest';

import { evaluateApplicationReadiness } from '@/lib/saws2-readiness';
import { blockersToReviewAndSign, buildInventory } from '@/lib/saws2-inventory';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

function member(id: string, dateOfBirth: string): HouseholdMember {
  return {
    id,
    firstName: `P${id}`,
    middleName: '',
    lastName: 'Test',
    dateOfBirth,
    relationshipToApplicant: 'Other adult',
  };
}

function application(
  members: HouseholdMember[] = [],
): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: members,
  };
}

describe('draft completeness', () => {
  it('does not claim review-and-sign while questions remain', () => {
    const readiness = evaluateApplicationReadiness(application());

    expect(readiness.draftCompleteness.reviewAndSignOnly).toBe(false);
  });

  it('names the questions that are answered but cannot be written', () => {
    const { answeredButNotWritable } =
      evaluateApplicationReadiness(application()).draftCompleteness;

    expect(answeredButNotWritable.length).toBeGreaterThan(0);

    for (const requirement of answeredButNotWritable) {
      // Each one must say which printed question it is about.
      expect(requirement.requirement).toMatch(/^(Q\d|Appendix )/);
      expect(requirement.id).toMatch(/^draft\./);
    }
  });

  it('names the printed questions the product does not model', () => {
    const { notModeled } =
      evaluateApplicationReadiness(application()).draftCompleteness;

    expect(notModeled.length).toBeGreaterThan(0);

    for (const requirement of notModeled) {
      expect(requirement.requirement).toMatch(/^(Q\d|Appendix )/);
    }
  });

  it('accounts for every inventory blocker exactly once', () => {
    const { answeredButNotWritable, notModeled } =
      evaluateApplicationReadiness(application()).draftCompleteness;

    expect(answeredButNotWritable.length + notModeled.length).toBe(
      blockersToReviewAndSign().length,
    );
  });

  it('never reports an SSN or signature as a product gap', () => {
    // Those are the applicant's own step, always.
    const { answeredButNotWritable, notModeled, overflow } =
      evaluateApplicationReadiness(application()).draftCompleteness;

    for (const requirement of [
      ...answeredButNotWritable,
      ...notModeled,
      ...overflow,
    ]) {
      expect(requirement.requirement).not.toMatch(/social security|signature/i);
    }
  });

  it('still lists SSNs and signatures as manual completion steps', () => {
    // The SSN requirement is scoped to Medi-Cal (42 CFR 435.910), so the
    // assertion uses an application that includes it.
    const readiness = evaluateApplicationReadiness({
      ...application(),
      selectedPrograms: ['medi_cal'],
    });

    const manual = readiness.manualCompletionRequired
      .map((r) => r.requirement)
      .join(' ');

    expect(manual).toMatch(/social security/i);
    expect(manual).toMatch(/sign/i);
  });
});

describe('household overflow', () => {
  it('reports nothing while the household fits the printed rows', () => {
    // Applicant plus four other adults is exactly the five printed rows.
    const readiness = evaluateApplicationReadiness(
      application([
        member('a', '1980-01-01'),
        member('b', '1981-01-01'),
        member('c', '1982-01-01'),
        member('d', '1983-01-01'),
      ]),
    );

    expect(readiness.draftCompleteness.overflow).toEqual([]);
  });

  it('reports adults beyond the fifth printed row', () => {
    const readiness = evaluateApplicationReadiness(
      application([
        member('a', '1980-01-01'),
        member('b', '1981-01-01'),
        member('c', '1982-01-01'),
        member('d', '1983-01-01'),
        member('e', '1984-01-01'),
        member('f', '1985-01-01'),
      ]),
    );

    const overflow = readiness.draftCompleteness.overflow;

    expect(overflow).toHaveLength(1);
    expect(overflow[0].id).toBe('draft.overflow.adult');
    // The applicant plus six members is seven adults; two do not fit.
    expect(overflow[0].requirement).toContain('7 adults');
    expect(overflow[0].requirement).toContain('2 extra');
    expect(overflow[0].requirement).toMatch(/attached sheet/i);
  });

  it('reports children overflowing separately from adults', () => {
    const readiness = evaluateApplicationReadiness(
      application([
        member('k1', '2015-01-01'),
        member('k2', '2016-01-01'),
        member('k3', '2017-01-01'),
        member('k4', '2018-01-01'),
        member('k5', '2019-01-01'),
        member('k6', '2020-01-01'),
      ]),
    );

    const overflow = readiness.draftCompleteness.overflow;

    expect(overflow.map((o) => o.id)).toEqual(['draft.overflow.child']);
    expect(overflow[0].requirement).toContain('6 childs');
  });

  it('makes overflow block the review-and-sign claim', () => {
    const readiness = evaluateApplicationReadiness(
      application(
        Array.from({ length: 6 }, (_, i) => member(`a${i}`, '1980-01-01')),
      ),
    );

    expect(readiness.draftCompleteness.reviewAndSignOnly).toBe(false);
  });
});

describe('the inventory drives the report', () => {
  it('reports a blocker for every unmapped or unmodeled printed question', () => {
    const inventory = buildInventory();
    const blocking = inventory.filter((entry) =>
      ['collected_not_mapped', 'not_modeled', 'no_writable_widget'].includes(
        entry.status,
      ),
    );

    const { answeredButNotWritable, notModeled } =
      evaluateApplicationReadiness(application()).draftCompleteness;

    const reported = [...answeredButNotWritable, ...notModeled];

    for (const entry of blocking) {
      expect(
        reported.some((r) => r.requirement.startsWith(`${entry.saws}:`)),
        `${entry.saws} (${entry.status}) is not reported`,
      ).toBe(true);
    }
  });
});
