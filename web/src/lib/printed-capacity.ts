//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What the printed SAWS 2 PLUS form can physically hold, and what it cannot.
 *
 * A paper form has a fixed number of printed rows. The application does not: a
 * household can list eight jobs, and Q8's table has four rows. Something has to
 * give, and there are only two honest options — refuse the answer, or write what
 * fits and tell the applicant where the rest goes. This module exists so the
 * product always takes the second one.
 *
 * Before it, the loss was invisible. The Python adapter iterates its row tables
 * and `continue`s past anything it has no row for, so a fifth job, a second
 * "telephone" expense, and a resource categorised "stocks or bonds" all vanished
 * between the questionnaire and the PDF without appearing anywhere in the
 * product's own account of what the draft still needed.
 *
 * Three different things can stop a record reaching the page, and they need
 * different words in the completion guide:
 *
 * 1. `beyond_printed_rows` — the table is full. Q8 prints four job rows; job
 *    five has nowhere to go.
 * 2. `printed_row_already_used` — the printed table is keyed by category rather
 *    than numbered, so it holds one row *per kind*. Q15 has a single
 *    "Telephone" row: a second telephone expense cannot have its own.
 * 3. `category_has_no_printed_row` — the answer's category is not one the
 *    printed table offers at all. Q24 prints separate "Stocks" and "Bonds"
 *    boxes while the application collects one combined category, so neither box
 *    can be ticked without asserting something the applicant did not say.
 *
 * The capacities below are the real row counts of the real form, and a
 * cross-runtime test asserts each one against the adapter's own destination
 * tables — so a row added to or removed from the adapter cannot leave this
 * registry quietly wrong.
 */

import type { ApplicationFieldPlanEntry } from '@/lib/application-mapper';

/** Where a printed block lives, for a completion guide that must be followable. */
interface PrintedLocation {
  /** Printed question number, e.g. "Q8". */
  saws: string;
  /** PDF page of the official form, 1-based. */
  page: number;
  /** The heading printed above the block. */
  printedName: string;
  /** What one row holds, for readable prose: "job", "vehicle", "person". */
  rowNoun: string;
}

interface SequentialBlock extends PrintedLocation {
  id: string;
  kind: 'sequential';
  /** Canonical key prefix the mapper emits, without the index. */
  canonicalPrefix: string;
  /** How many rows the printed table has. */
  capacity: number;
}

interface KeyedBlock extends PrintedLocation {
  id: string;
  kind: 'keyed';
  canonicalPrefix: string;
  /** Canonical suffix holding the category, e.g. "kind". */
  categorySuffix: string;
  /**
   * Category → the printed row it fills. Two categories may share a row: Q15
   * prints one "Property taxes and insurance" row for both property tax and
   * home insurance, so the second of the two has no row of its own.
   */
  rowByCategory: Readonly<Record<string, string>>;
}

export type PrintedBlock = SequentialBlock | KeyedBlock;

/**
 * Every repeated printed block on the form.
 *
 * Household rows are handled separately by planHouseholdRows, which assigns
 * people to rows rather than counting emitted keys; see householdOverflow.
 */
export const PRINTED_BLOCKS: readonly PrintedBlock[] = [
  {
    id: 'income.unearned',
    kind: 'sequential',
    canonicalPrefix: 'income.unearned',
    capacity: 4,
    saws: 'Q7',
    page: 14,
    printedName: 'Unearned income',
    rowNoun: 'unearned income source',
  },
  {
    id: 'income.earned',
    kind: 'sequential',
    canonicalPrefix: 'income.earned',
    capacity: 4,
    saws: 'Q8',
    page: 15,
    printedName: 'Earned income',
    rowNoun: 'job',
  },
  {
    id: 'income.self_employment',
    kind: 'sequential',
    canonicalPrefix: 'income.self_employment',
    capacity: 3,
    saws: 'Q8a',
    page: 15,
    printedName: 'Self-employment',
    rowNoun: 'self-employed business',
  },
  {
    id: 'income.in_kind',
    kind: 'keyed',
    canonicalPrefix: 'income.in_kind',
    categorySuffix: 'kind',
    rowByCategory: {
      housing: 'Housing or rent',
      utilities: 'Utilities',
      food: 'Food',
      clothing: 'Clothing',
    },
    saws: 'Q9',
    page: 16,
    printedName: 'Other income',
    rowNoun: 'in-kind support item',
  },
  {
    id: 'expenses.household',
    kind: 'keyed',
    canonicalPrefix: 'expenses.household',
    categorySuffix: 'kind',
    rowByCategory: {
      rent_or_mortgage: 'Rent or house payment',
      property_tax: 'Property taxes and insurance',
      home_insurance: 'Property taxes and insurance',
      gas: 'Heating or cooling',
      electricity: 'Heating or cooling',
      telephone: 'Telephone',
      water: 'Water, sewage and garbage',
      trash: 'Water, sewage and garbage',
    },
    saws: 'Q15',
    page: 17,
    printedName: 'Household expenses',
    rowNoun: 'household expense',
  },
  {
    id: 'resources.accounts',
    kind: 'sequential',
    canonicalPrefix: 'resources.accounts',
    capacity: 4,
    saws: 'Q24',
    page: 20,
    printedName: 'Household’s resources',
    rowNoun: 'resource',
  },
  {
    id: 'resources.personal_property',
    kind: 'sequential',
    canonicalPrefix: 'resources.personal_property',
    capacity: 3,
    saws: 'Q25',
    page: 20,
    printedName: 'Personal property',
    rowNoun: 'personal property item',
  },
  {
    id: 'household.disability_detail',
    kind: 'sequential',
    canonicalPrefix: 'household.disability_detail',
    capacity: 2,
    saws: 'Q6j',
    page: 12,
    printedName: 'Details for each disabled person',
    rowNoun: 'disabled person',
  },
  {
    id: 'appendices.tribal',
    kind: 'sequential',
    canonicalPrefix: 'appendices.tribal',
    capacity: 2,
    saws: 'Appendix B',
    page: 25,
    printedName: 'Questions for American Indian and Alaska Native individuals',
    rowNoun: 'American Indian or Alaska Native person',
  },
  {
    id: 'appendices.vehicle',
    kind: 'sequential',
    canonicalPrefix: 'appendices.vehicle',
    capacity: 3,
    saws: 'Appendix E',
    page: 29,
    printedName: 'Vehicle information',
    rowNoun: 'vehicle',
  },
  {
    id: 'appendices.employer_coverage',
    kind: 'sequential',
    canonicalPrefix: 'appendices.employer_coverage',
    capacity: 1,
    saws: 'Appendix A',
    page: 24,
    printedName: 'Health coverage from jobs',
    rowNoun: 'employer that offers coverage',
  },
] as const;

/** Rows in each printed household table (Q6 adults, Q6b children). */
export const PRINTED_HOUSEHOLD_ROWS = 5;

/** Why a record could not reach the printed form. */
export type DropReason =
  | 'beyond_printed_rows'
  | 'printed_row_already_used'
  | 'category_has_no_printed_row';

export interface DroppedRecord {
  blockId: string;
  saws: string;
  page: number;
  printedName: string;
  rowNoun: string;
  /** Which record, counting from 1 as a person would. */
  ordinal: number;
  reason: DropReason;
  /** The category involved, for keyed blocks. */
  category?: string;
  /** One sentence an applicant or associate can act on. */
  explanation: string;
}

/** Capitalise a row noun that is starting a sentence. */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Indices the plan emits under one canonical prefix, in ascending order. */
function emittedIndices(
  plan: readonly ApplicationFieldPlanEntry[],
  prefix: string,
): number[] {
  const found = new Set<number>();
  const pattern = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.`,
  );

  for (const { key } of plan) {
    const match = pattern.exec(key);
    if (match) found.add(Number(match[1]));
  }

  return [...found].sort((a, b) => a - b);
}

function categoryAt(
  plan: readonly ApplicationFieldPlanEntry[],
  prefix: string,
  index: number,
  suffix: string,
): string | undefined {
  const value = plan.find(
    (candidate) => candidate.key === `${prefix}.${index}.${suffix}`,
  )?.value;

  return typeof value === 'string' ? value : undefined;
}

/**
 * Every record in the plan that the printed form has no place for.
 *
 * Reads the canonical field plan rather than the questionnaire because the plan
 * is the boundary the adapter actually sees: anything the mapper chose not to
 * emit was never destined for the page, and anything it did emit either lands
 * in a row or is lost. Measuring here therefore cannot disagree with what the
 * PDF ends up containing.
 *
 * Pure and deterministic: the same plan always yields the same list, ordered by
 * printed block and then by record.
 */
export function findPrintedOverflow(
  plan: readonly ApplicationFieldPlanEntry[],
): DroppedRecord[] {
  const dropped: DroppedRecord[] = [];

  for (const block of PRINTED_BLOCKS) {
    const indices = emittedIndices(plan, block.canonicalPrefix);

    if (block.kind === 'sequential') {
      for (let position = block.capacity; position < indices.length; position += 1) {
        dropped.push({
          blockId: block.id,
          saws: block.saws,
          page: block.page,
          printedName: block.printedName,
          rowNoun: block.rowNoun,
          ordinal: position + 1,
          reason: 'beyond_printed_rows',
          explanation:
            `${block.saws} prints ${block.capacity} ` +
            `${block.capacity === 1 ? `${block.rowNoun} row` : `${block.rowNoun} rows`} ` +
            `and this household reported ${indices.length}. ` +
            `${sentenceCase(block.rowNoun)} ${position + 1} must be written ` +
            'on a separate sheet and attached.',
        });
      }

      continue;
    }

    const usedRows = new Set<string>();

    for (const [position, index] of indices.entries()) {
      const category = categoryAt(
        plan,
        block.canonicalPrefix,
        index,
        block.categorySuffix,
      );
      const row = category ? block.rowByCategory[category] : undefined;

      if (!row) {
        dropped.push({
          blockId: block.id,
          saws: block.saws,
          page: block.page,
          printedName: block.printedName,
          rowNoun: block.rowNoun,
          ordinal: position + 1,
          reason: 'category_has_no_printed_row',
          category,
          explanation:
            `${block.saws} has no printed row for this kind of ` +
            `${block.rowNoun}, so it must be written on a separate sheet and ` +
            'attached.',
        });

        continue;
      }

      if (usedRows.has(row)) {
        dropped.push({
          blockId: block.id,
          saws: block.saws,
          page: block.page,
          printedName: block.printedName,
          rowNoun: block.rowNoun,
          ordinal: position + 1,
          reason: 'printed_row_already_used',
          category,
          explanation:
            `${block.saws} prints one “${row}” row and it is already in use, ` +
            `so this second ${block.rowNoun} must be written on a separate ` +
            'sheet and attached.',
        });

        continue;
      }

      usedRows.add(row);
    }
  }

  return dropped;
}

/**
 * People the printed household tables cannot hold.
 *
 * Separate from findPrintedOverflow because household rows are assigned by
 * planHouseholdRows — a person's row depends on their age and on the applicant
 * always taking row 1, not on the order keys happen to be emitted in.
 */
export function findHouseholdOverflow(
  adults: number,
  children: number,
): DroppedRecord[] {
  const dropped: DroppedRecord[] = [];

  for (const [table, count, saws, page] of [
    ['adult', adults, 'Q6', 9],
    ['child', children, 'Q6b', 10],
  ] as const) {
    for (let row = PRINTED_HOUSEHOLD_ROWS; row < count; row += 1) {
      dropped.push({
        blockId: `household.${table}s`,
        saws,
        page,
        printedName:
          table === 'adult'
            ? 'Household’s information: adults'
            : 'Household’s information: children',
        rowNoun: table,
        ordinal: row + 1,
        reason: 'beyond_printed_rows',
        explanation:
          `${saws} prints ${PRINTED_HOUSEHOLD_ROWS} ${table} rows and this ` +
          `household has ${count} ${table === 'adult' ? 'adults' : 'children'}. ` +
          `${table === 'adult' ? 'Adult' : 'Child'} ${row + 1} must be listed ` +
          'on a separate sheet and attached.',
      });
    }
  }

  return dropped;
}
