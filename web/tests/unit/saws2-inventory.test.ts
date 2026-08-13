//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The semantic inventory is the production-readiness metric.
 *
 * AcroForm field percentage says nothing useful — one printed question can own
 * thirty widgets or none. These tests keep the inventory honest: every printed
 * question is classified exactly once, nothing claims to be mapped that is not,
 * and the SSN and signature questions can never be reclassified as fillable.
 */

import { describe, expect, it } from 'vitest';

import {
  blockersToReviewAndSign,
  buildInventory,
  inventoryCounts,
  printedQuestionCount,
  type InventoryStatus,
} from '@/lib/saws2-inventory';
import { SAWS2_FIELD_BY_ID } from '@/lib/saws2-schema';

const inventory = buildInventory();

describe('inventory shape', () => {
  it('covers every printed question exactly once', () => {
    const numbers = inventory.map((entry) => entry.saws);

    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.length).toBe(printedQuestionCount());
  });

  it('tracks the whole main form plus the five appendices', () => {
    const numbers = new Set(inventory.map((e) => e.saws));

    // Spot-check the range ends and the appendices.
    for (const saws of ['Q1', 'Q6r', 'Q22c', 'Q23f', 'Q39']) {
      expect(numbers, saws).toContain(saws);
    }

    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      expect(numbers).toContain(`Appendix ${letter}`);
    }
  });

  it('gives every entry a real PDF page for re-verification', () => {
    for (const entry of inventory) {
      expect(entry.page, entry.saws).toBeGreaterThanOrEqual(7);
      expect(entry.page, entry.saws).toBeLessThanOrEqual(29);
    }
  });

  it('names the schema entries behind every mapped question', () => {
    for (const entry of inventory) {
      if (entry.status !== 'collected_and_mapped') continue;

      expect(entry.schemaIds.length, entry.saws).toBeGreaterThan(0);

      for (const id of entry.schemaIds) {
        expect(SAWS2_FIELD_BY_ID.get(id), `${entry.saws} -> ${id}`).toBeDefined();
      }
    }
  });

  it('explains every question that is not simply mapped', () => {
    const NEEDS_NO_NOTE: InventoryStatus[] = [
      'collected_and_mapped',
      'known_from_application',
      'manual_ssn',
      'manual_signature',
    ];

    for (const entry of inventory) {
      if (NEEDS_NO_NOTE.includes(entry.status)) continue;
      if (entry.schemaIds.length > 0) continue; // the schema carries the reason

      expect(entry.note, `${entry.saws} is ${entry.status} with no reason`).toBeTruthy();
    }
  });
});

describe('privacy classifications cannot drift', () => {
  it('keeps Q6c classified as manual because of SSNs', () => {
    const q6c = inventory.find((e) => e.saws === 'Q6c');

    expect(q6c?.status).toBe('manual_ssn');
  });

  it('keeps the signature block manual', () => {
    const signature = inventory.filter(
      (e) => e.status === 'manual_signature',
    );

    expect(signature.map((e) => e.saws)).toContain('Q40 (signature block)');
  });

  it('never classifies an SSN or signature question as fillable', () => {
    const FILLABLE: InventoryStatus[] = [
      'collected_and_mapped',
      'known_from_application',
    ];

    for (const entry of inventory) {
      if (!/6c|signature|Appendix C/i.test(`${entry.saws} ${entry.label}`)) {
        continue;
      }

      expect(FILLABLE, `${entry.saws} must stay manual`).not.toContain(
        entry.status,
      );
    }
  });

  it('keeps the noncitizen document questions unsupported', () => {
    for (const saws of ['Q6e', 'Q6f']) {
      const entry = inventory.find((e) => e.saws === saws);

      expect(entry?.status, saws).toBe('intentionally_unsupported');
    }
  });
});

describe('mapped questions really are mapped', () => {
  it('does not call a question mapped while any of its parts is unreviewed', () => {
    for (const entry of inventory) {
      if (entry.status !== 'collected_and_mapped') continue;

      for (const id of entry.schemaIds) {
        const field = SAWS2_FIELD_BY_ID.get(id)!;

        expect(field.pdf, `${entry.saws} -> ${id}`).toBe('mapped');
      }
    }
  });

  it('reports Q27 as having no writable widget', () => {
    expect(inventory.find((e) => e.saws === 'Q27')?.status).toBe(
      'no_writable_widget',
    );
  });

  it('reports the four Q22 questions separately', () => {
    for (const saws of ['Q22', 'Q22a', 'Q22b', 'Q22c']) {
      const entry = inventory.find((e) => e.saws === saws);

      expect(entry, saws).toBeDefined();
      expect(entry?.status, saws).toBe('collected_and_mapped');
    }
  });
});

describe('readiness reporting', () => {
  it('classifies every question into exactly one bucket', () => {
    const counts = inventoryCounts();
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    expect(total).toBe(inventory.length);
  });

  it('names the blockers to a review-and-sign draft', () => {
    const blockers = blockersToReviewAndSign();

    // There genuinely are blockers today; the point is that they are named.
    expect(blockers.length).toBeGreaterThan(0);

    for (const blocker of blockers) {
      expect(blocker.saws).toBeTruthy();
      expect(blocker.status).not.toBe('collected_and_mapped');
    }
  });

  it('does not count SSNs or signatures as blockers', () => {
    // Those are always the applicant's job, so they are not a product gap.
    for (const blocker of blockersToReviewAndSign()) {
      expect(blocker.status).not.toBe('manual_ssn');
      expect(blocker.status).not.toBe('manual_signature');
    }
  });

  it('reports a mapped share that matches the entries', () => {
    const counts = inventoryCounts();
    const mapped =
      (counts.collected_and_mapped ?? 0) + (counts.known_from_application ?? 0);

    expect(mapped).toBe(
      inventory.filter(
        (e) =>
          e.status === 'collected_and_mapped' ||
          e.status === 'known_from_application',
      ).length,
    );
  });
});
