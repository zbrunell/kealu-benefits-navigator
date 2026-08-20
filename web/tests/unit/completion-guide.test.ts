//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The guide must stay in step with the mapper.
 *
 * A hand-written "here is what is still blank" paragraph is wrong the first
 * time a destination changes, and nobody notices — the paragraph still reads
 * plausibly. So the assertions here are mostly about derivation: every item the
 * guide shows must come from the draft's own completion metadata, and every
 * outstanding item in that metadata must appear somewhere in the guide.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCompletionGuide,
  draftReferenceFrom,
  type DraftReference,
} from '@/lib/completion-guide';
import { renderCompletionGuideHtml } from '@/lib/completion-guide-html';
import { assessDraftCompletion } from '@/lib/draft-completion';
import { writePath } from '@/lib/saws2-question-planner';
import {
  EMPTY_APPLICATION_DATA,
  type HouseholdMember,
  type Saws2PlusApplicationData,
} from '@/types/application';

const DRAFT: DraftReference = {
  reference: '9F3A21C0',
  generatedAt: '2026-08-17T22:51:17Z',
  pdfFilename: 'official-ca-saws-2-plus-93701-20260817-225117.pdf',
};

function member(id: string, firstName: string, dateOfBirth: string): HouseholdMember {
  return {
    id,
    firstName,
    middleName: '',
    lastName: 'Reyes',
    dateOfBirth,
    relationshipToApplicant: 'Spouse',
  };
}

function application(
  members: HouseholdMember[] = [],
): Saws2PlusApplicationData {
  return {
    ...EMPTY_APPLICATION_DATA,
    selectedPrograms: ['calfresh', 'medi_cal'],
    applicant: {
      ...EMPTY_APPLICATION_DATA.applicant,
      firstName: 'Maria',
      lastName: 'Delgado',
      dateOfBirth: '1990-01-01',
    },
    householdMembers: members,
  };
}

const w = (d: Saws2PlusApplicationData, p: string, v: unknown) => ({
  ...d,
  questionnaire: writePath(d.questionnaire, p, v),
});

const guideFor = (
  data: Saws2PlusApplicationData,
  audience: 'applicant' | 'associate' = 'applicant',
  county = 'Fresno',
) => buildCompletionGuide({ application: data, audience, county, draft: DRAFT });

const allItems = (data: Saws2PlusApplicationData, audience: 'applicant' | 'associate' = 'applicant') =>
  guideFor(data, audience).sections.flatMap((section) => section.items);

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

describe('the guide is derived from the draft, not written by hand', () => {
  it('shows every outstanding item the completion metadata reports', () => {
    const data = application([member('m1', 'Luis', '1988-05-04')]);
    const completion = assessDraftCompletion(data);
    const rendered = JSON.stringify(allItems(data, 'associate'));

    for (const item of completion.manualItems) {
      expect(rendered, item.id).toContain(item.instruction);
    }
  });

  it('changes when the draft changes', () => {
    const alone = guideFor(application());
    const family = guideFor(
      application([member('m1', 'Luis', '1988-05-04')]),
    );

    expect(JSON.stringify(alone)).not.toBe(JSON.stringify(family));
  });

  it('is deterministic for one draft', () => {
    const data = application([member('m1', 'Luis', '1988-05-04')]);
    const first = JSON.stringify(guideFor(data));

    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(guideFor(data))).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

describe('sections', () => {
  it('omits empty sections rather than printing a bare heading', () => {
    const guide = guideFor(application());

    for (const section of guide.sections) {
      expect(section.items.length, section.id).toBeGreaterThan(0);
    }
  });

  it('always has review, signatures, attachments and submission', () => {
    const ids = guideFor(application()).sections.map((s) => s.id);

    expect(ids).toContain('review');
    expect(ids).toContain('signature');
    expect(ids).toContain('attachments');
    expect(ids).toContain('submission');
  });

  it('has no overflow section for a household that fits the form', () => {
    expect(guideFor(application()).sections.map((s) => s.id)).not.toContain(
      'overflow',
    );
  });

  it('gains an overflow section when the household does not fit', () => {
    const data = application(
      Array.from({ length: 6 }, (_, i) => member(`a${i}`, `P${i}`, '1980-01-01')),
    );

    expect(guideFor(data).sections.map((s) => s.id)).toContain('overflow');
  });
});

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

describe('every blank says where it is', () => {
  const items = allItems(
    application([member('m1', 'Luis', '1988-05-04')]),
    'associate',
  );

  it('gives a PDF page, a printed page label and a printed question', () => {
    const located = items.filter((item) => item.location);

    expect(located.length).toBeGreaterThan(0);

    for (const item of located) {
      expect(item.location).toMatch(
        /^PDF page \d+ · (PAGE \d+ OF 17|APPENDIX [A-E](-\d)?) · .+/,
      );
    }
  });

  it('names whose field it is for every Social Security box', () => {
    const guide = guideFor(
      application([member('m1', 'Luis', '1988-05-04')]),
      'associate',
    );
    const ssn = guide.sections.find((s) => s.id === 'ssn');

    expect(ssn).toBeDefined();

    for (const item of ssn!.items) {
      expect(item.person).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe('privacy', () => {
  it('never prints a Social Security Number', () => {
    const data = application([member('m1', 'Luis', '1988-05-04')]);
    const html = renderCompletionGuideHtml(guideFor(data, 'associate'));

    expect(html).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(html).not.toMatch(/\b\d{9}\b/);
  });

  it('says the Social Security boxes were left blank deliberately', () => {
    const ssn = guideFor(application()).sections.find((s) => s.id === 'ssn');

    expect(ssn!.intro).toMatch(/never asks for, stores, or writes/i);
  });
});

// ---------------------------------------------------------------------------
// Submission guidance
// ---------------------------------------------------------------------------

describe('submission guidance', () => {
  it('names the county resolved from the ZIP code', () => {
    const section = guideFor(application()).sections.find(
      (s) => s.id === 'submission',
    );

    expect(section!.intro).toContain('Fresno County');
  });

  it('says how to find the office when the county is unknown', () => {
    const section = buildCompletionGuide({
      application: application(),
      audience: 'applicant',
      county: '',
      draft: DRAFT,
    }).sections.find((s) => s.id === 'submission');

    expect(section!.intro).toMatch(/could not be resolved/i);
    expect(JSON.stringify(section)).not.toMatch(/\bCounty\b.*\boffice at\b/);
  });

  it('invents no address, phone number or fax number', () => {
    const html = renderCompletionGuideHtml(guideFor(application()));

    // No street address, no phone number, no fax.
    expect(html).not.toMatch(/\(\d{3}\)\s*\d{3}-\d{4}/);
    expect(html).not.toMatch(/\b\d{3}-\d{3}-\d{4}\b/);
    expect(html).not.toMatch(/\b\d+\s+[A-Z][a-z]+\s+(Street|Avenue|Road|Blvd)\b/);
  });

  it('names only the statewide portals California actually uses', () => {
    const html = renderCompletionGuideHtml(guideFor(application()));
    const urls = [...html.matchAll(/https?:\/\/[^\s"<,)]+/g)].map((m) => m[0]);

    for (const url of urls) {
      expect(['https://benefitscal.com/', 'https://www.coveredca.com/']).toContain(
        url,
      );
    }
  });

  it('mentions Covered California only for a health-coverage application', () => {
    const withHealth = renderCompletionGuideHtml(guideFor(application()));
    const withoutHealth = renderCompletionGuideHtml(
      guideFor({ ...application(), selectedPrograms: ['calfresh'] }),
    );

    expect(withHealth).toContain('coveredca.com');
    expect(withoutHealth).not.toContain('coveredca.com');
  });
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

describe('documents to attach', () => {
  const attachments = (data: Saws2PlusApplicationData) =>
    guideFor(data)
      .sections.find((s) => s.id === 'attachments')!
      .items.map((i) => i.title);

  it('always asks for proof of identity', () => {
    expect(attachments(application())).toContain('Proof of identity');
  });

  it('asks for pay stubs only when the household reported earned income', () => {
    expect(attachments(application())).not.toContain('Proof of earned income');
    expect(
      attachments(w(application(), 'income.earned.answer', true)),
    ).toContain('Proof of earned income');
  });

  it('asks for vehicle registration only when there is a vehicle', () => {
    expect(
      attachments(w(application(), 'resources.vehicles.answer', true)),
    ).toContain('Vehicle registration');
  });
});

// ---------------------------------------------------------------------------
// Draft pairing
// ---------------------------------------------------------------------------

describe('pairing a guide with its draft', () => {
  it('derives a short, non-sensitive reference from the run id', () => {
    const reference = draftReferenceFrom('4e138a6f-b53c-43c1-a120-bf55dac8d316');

    expect(reference).toBe('4E138A6F');
    expect(reference).toHaveLength(8);
  });

  it('prints the reference, the generation time and the PDF filename', () => {
    const html = renderCompletionGuideHtml(guideFor(application()));

    expect(html).toContain('9F3A21C0');
    /*
     * The stamp is written the way the reader's language writes dates, so this
     * asserts the parts rather than one fixed string. It stays pinned to UTC so
     * two readers of the same guide never see two different times.
     */
    expect(html).toMatch(/2026/);
    expect(html).toContain('UTC');
    expect(html).toContain('official-ca-saws-2-plus-93701-20260817-225117.pdf');
  });

  it('tells the reader why the reference is there', () => {
    const html = renderCompletionGuideHtml(guideFor(application()));

    expect(html).toMatch(/how you tell them apart/i);
  });
});

// ---------------------------------------------------------------------------
// The printable document
// ---------------------------------------------------------------------------

describe('the printable HTML', () => {
  const html = renderCompletionGuideHtml(
    guideFor(application([member('m1', 'Luis', '1988-05-04')])),
  );

  it('is a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('fetches nothing from the network, so it prints anywhere', () => {
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/src\s*=/i);
    expect(html).not.toMatch(/@import/i);
  });

  it('sets up US Letter with real margins', () => {
    expect(html).toContain('@page { size: Letter; margin: .5in; }');
  });

  it('keeps a heading with the items under it', () => {
    expect(html).toContain('h2 { break-after: avoid-page; }');
    expect(html).toContain('li.item { break-inside: avoid; }');
  });

  it('does not forbid breaking inside a section, which wastes paper', () => {
    expect(html).not.toContain('section { break-inside: avoid-page; }');
  });

  it('has a useful title carrying the draft reference', () => {
    expect(html).toMatch(
      /<title>Finishing and submitting your SAWS 2 PLUS application — 9F3A21C0<\/title>/,
    );
  });

  it('is responsive rather than fixed-width', () => {
    expect(html).toContain('width=device-width');
    expect(html).toContain('max-width: 46rem');
  });

  it('escapes text so a stray angle bracket cannot break the page', () => {
    const guide = guideFor(application());
    guide.applicantName = '<script>alert(1)</script>';

    expect(renderCompletionGuideHtml(guide)).not.toContain('<script>');
  });

  it('gives the associate a different title from the applicant', () => {
    const associate = renderCompletionGuideHtml(
      guideFor(application(), 'associate'),
    );

    expect(associate).toContain('what this draft still needs');
    expect(associate).toContain('nothing has to be hunted for');
  });
});
