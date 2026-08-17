//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Completeness must describe *this* draft, not the product's capabilities.
 *
 * The trap this guards against used to be one-sided: reporting "fully
 * prefilled" when answered questions had nowhere to go. It is now two-sided,
 * because the previous measure read the semantic inventory and so gave every
 * household the same answer — it told an applicant with no vehicle about
 * vehicle blanks they did not have, and told an applicant whose eighth job fell
 * off the end of a four-row table nothing at all.
 *
 * So the assertions here are about variation between drafts as much as about
 * any single draft: two different households must get two different answers,
 * and every reported item must name a real place on the real form.
 */

import { describe, expect, it } from 'vitest';

import { assessDraftCompletion } from '@/lib/draft-completion';
import { evaluateApplicationReadiness } from '@/lib/saws2-readiness';
import { writePath } from '@/lib/saws2-question-planner';
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

const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({
  ...d,
  questionnaire: writePath(d.questionnaire, p, v),
});

// ---------------------------------------------------------------------------
// The claim itself
// ---------------------------------------------------------------------------

describe('reviewAndSignOnly', () => {
  it('is false while questions remain', () => {
    expect(
      evaluateApplicationReadiness(application()).draftCompleteness
        .reviewAndSignOnly,
    ).toBe(false);
  });

  it('is false for any real draft, because an SSN box always remains', () => {
    // Not a defect in the rule: the phrase "review and sign only" is untrue
    // while the applicant still has a Social Security box to fill in.
    const completion = assessDraftCompletion(application());

    expect(completion.byReason.ssn.length).toBeGreaterThan(0);
    expect(completion.reviewAndSignOnly).toBe(false);
  });

  it('does not count a signature or its date as work beyond signing', () => {
    const completion = assessDraftCompletion(application());
    const blocking = completion.manualItems.filter(
      (item) => item.reason !== 'signature' && item.reason !== 'signature_date',
    );

    // Whatever else is outstanding, it is not the signatures that make the
    // claim false — those are the "sign" half of "review and sign".
    expect(blocking.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Every item must be findable on the real form
// ---------------------------------------------------------------------------

describe('each outstanding item says where it is', () => {
  const completion = assessDraftCompletion(application([member('a', '1980-01-01')]));

  it('gives a real PDF page for everything printed on the form', () => {
    for (const item of completion.manualItems) {
      if (item.reason === 'missing_answer') continue;

      expect(item.page, item.id).toBeGreaterThanOrEqual(7);
      expect(item.page, item.id).toBeLessThanOrEqual(29);
    }
  });

  it('gives the label the page itself prints at its foot', () => {
    for (const item of completion.manualItems) {
      if (item.reason === 'missing_answer') continue;

      expect(item.printedPage, item.id).toMatch(/^(PAGE \d+ OF 17|APPENDIX)/);
    }
  });

  it('names a printed question, a section and a nearby label', () => {
    for (const item of completion.manualItems) {
      expect(item.saws, item.id).toBeTruthy();
      expect(item.printedSection, item.id).toBeTruthy();
      expect(item.printedLabel, item.id).toBeTruthy();
      expect(item.valueType, item.id).toBeTruthy();
      expect(item.instruction.length, item.id).toBeGreaterThan(20);
    }
  });

  it('uses a distinct id per item', () => {
    const ids = completion.manualItems.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('orders items by printed page so a reader can work front to back', () => {
    const pages = completion.manualItems
      .filter((item) => item.page > 0)
      .map((item) => item.page);

    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });
});

// ---------------------------------------------------------------------------
// Social Security Numbers
// ---------------------------------------------------------------------------

describe('Social Security Numbers', () => {
  it('reports one box per person the printed tables hold, plus page 1', () => {
    const completion = assessDraftCompletion(
      application([member('a', '1980-01-01'), member('k', '2015-01-01')]),
    );

    // Page 1's box, two adult rows, one child row.
    expect(completion.byReason.ssn).toHaveLength(4);
  });

  it('varies with the household rather than being a fixed list', () => {
    const alone = assessDraftCompletion(application()).byReason.ssn.length;
    const family = assessDraftCompletion(
      application([member('a', '1980-01-01'), member('b', '1981-01-01')]),
    ).byReason.ssn.length;

    expect(family).toBeGreaterThan(alone);
  });

  it('names whose number belongs in each box', () => {
    const completion = assessDraftCompletion(
      application([member('a', '1980-01-01')]),
    );

    for (const item of completion.byReason.ssn) {
      expect(item.person, item.id).toBeTruthy();
    }

    expect(completion.byReason.ssn[0].person).toBe('Ada Lovelace');
  });

  it('never carries a Social Security Number itself', () => {
    const completion = assessDraftCompletion(
      application([member('a', '1980-01-01')]),
    );

    for (const item of completion.byReason.ssn) {
      expect(JSON.stringify(item)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    }
  });

  it('says the blank was left deliberately', () => {
    for (const item of assessDraftCompletion(application()).byReason.ssn) {
      expect(item.instruction).toMatch(/on purpose|deliberate/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

describe('signatures', () => {
  it('asks for one signature and one date in a single-adult household', () => {
    const completion = assessDraftCompletion(application());

    expect(completion.byReason.signature).toHaveLength(1);
    expect(completion.byReason.signature_date).toHaveLength(1);
  });

  it('adds the second printed line when another adult is applying', () => {
    const completion = assessDraftCompletion(
      application([member('a', '1980-01-01')]),
    );

    expect(completion.byReason.signature).toHaveLength(2);
    expect(completion.byReason.signature_date).toHaveLength(2);
    expect(completion.byReason.signature[1].printedLabel).toContain('SPOUSE');
  });

  it('does not add it for a household of one adult and children', () => {
    const completion = assessDraftCompletion(
      application([member('k', '2015-01-01')]),
    );

    expect(completion.byReason.signature).toHaveLength(1);
  });

  it('sends every signature to the page it is actually printed on', () => {
    for (const item of assessDraftCompletion(application()).byReason.signature) {
      expect(item.page).toBe(7);
      expect(item.printedPage).toBe('PAGE 1 OF 17');
    }
  });

  it('pairs each signature with the date box beside it', () => {
    const completion = assessDraftCompletion(application());

    expect(completion.byReason.signature_date[0].printedLabel).toContain('DATE');
    expect(completion.byReason.signature_date[0].instruction).toMatch(
      /date you actually sign/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Overflow
// ---------------------------------------------------------------------------

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

  it('reports each adult beyond the fifth printed row', () => {
    const completion = assessDraftCompletion(
      application(
        Array.from({ length: 6 }, (_, i) => member(`a${i}`, '1980-01-01')),
      ),
    );

    // Applicant plus six members is seven adults; two do not fit.
    expect(completion.byReason.overflow).toHaveLength(2);
    expect(completion.byReason.overflow[0].saws).toBe('Q6');
    expect(completion.byReason.overflow[0].page).toBe(9);
    expect(completion.byReason.overflow[0].instruction).toMatch(
      /separate sheet/i,
    );
  });

  it('numbers the child table separately from the adult table', () => {
    const completion = assessDraftCompletion(
      application(
        Array.from({ length: 6 }, (_, i) => member(`k${i}`, '2015-01-01')),
      ),
    );

    expect(completion.byReason.overflow).toHaveLength(1);
    expect(completion.byReason.overflow[0].saws).toBe('Q6b');
    expect(completion.byReason.overflow[0].page).toBe(10);
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

// ---------------------------------------------------------------------------
// Per-draft, not per-product
// ---------------------------------------------------------------------------

describe('the draft drives the report, not the inventory', () => {
  it('reports no vehicle blanks on the form for a household with none', () => {
    // Q26 itself is still an unanswered question, which is a different thing:
    // the point is that no *printed blank* about vehicles is reported when the
    // household has none.
    const onForm = assessDraftCompletion(application()).manualItems.filter(
      (item) => item.reason !== 'missing_answer',
    );

    expect(JSON.stringify(onForm)).not.toMatch(/vehicle/i);
  });

  it('says nothing about Appendix D for a household not applying for cash aid', () => {
    const completion = assessDraftCompletion(application());

    expect(JSON.stringify(completion.manualItems)).not.toMatch(/Appendix D/);
  });

  it('lists the appendices this household correctly skips, with a reason', () => {
    const completion = assessDraftCompletion(application());
    const skipped = completion.skippedSections.map((s) => s.saws);

    expect(skipped).toContain('Appendix D');
    expect(skipped).toContain('Appendix E');

    for (const section of completion.skippedSections) {
      expect(section.reason.length, section.saws).toBeGreaterThan(20);
      expect(section.page, section.saws).toBeGreaterThan(0);
    }
  });

  it('stops calling a section skipped once the household activates it', () => {
    const before = assessDraftCompletion(application());
    const after = assessDraftCompletion(
      w(application(), 'health.americanIndianOrAlaskaNative', true),
    );

    expect(before.skippedSections.map((s) => s.saws)).toContain('Appendix B');
    expect(after.skippedSections.map((s) => s.saws)).not.toContain('Appendix B');
  });

  it('raises the Q27 real-property gap only for a household that has property', () => {
    const without = assessDraftCompletion(application());
    const withProperty = assessDraftCompletion(
      w(application(), 'resources.realProperty.answer', true),
    );

    expect(without.byReason.unsupported.map((i) => i.saws)).not.toContain('Q27');
    expect(withProperty.byReason.unsupported.map((i) => i.saws)).toContain('Q27');
  });

  it('is deterministic: the same application always yields the same report', () => {
    const data = application([member('a', '1980-01-01')]);
    const first = JSON.stringify(assessDraftCompletion(data));

    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(assessDraftCompletion(data))).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// Readiness keeps its own contract
// ---------------------------------------------------------------------------

describe('readiness', () => {
  it('never reports an SSN or signature as a product gap', () => {
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

  it('exposes the per-draft detail the guides are generated from', () => {
    const readiness = evaluateApplicationReadiness(application());

    expect(readiness.draftCompleteness.completion.manualItems.length).toBeGreaterThan(0);
    expect(readiness.draftCompleteness.completion.filledFieldCount).toBeGreaterThan(0);
  });
});
