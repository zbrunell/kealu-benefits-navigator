import { describe, expect, it } from 'vitest';
import type { ApplicationFieldPlanEntry } from '@/lib/application-mapper';
import {
  PRINTED_BLOCKS,
  PRINTED_HOUSEHOLD_ROWS,
  findHouseholdOverflow,
  findPrintedOverflow,
} from '@/lib/printed-capacity';

/** Build a plan with `count` records under one canonical prefix. */
function records(
  prefix: string,
  count: number,
  extra: (index: number) => Record<string, string> = () => ({}),
): ApplicationFieldPlanEntry[] {
  return Array.from({ length: count }, (_, index) => [
    { key: `${prefix}.${index}.person_name`, value: `Person ${index}` },
    ...Object.entries(extra(index)).map(([suffix, value]) => ({
      key: `${prefix}.${index}.${suffix}`,
      value,
    })),
  ]).flat();
}

describe('the printed block registry', () => {
  it('gives every block a location an associate can find', () => {
    for (const block of PRINTED_BLOCKS) {
      expect(block.saws, block.id).toBeTruthy();
      expect(block.printedName, block.id).toBeTruthy();
      expect(block.rowNoun, block.id).toBeTruthy();
      expect(block.page, block.id).toBeGreaterThan(0);
    }
  });

  it('uses a distinct id and canonical prefix per block', () => {
    expect(new Set(PRINTED_BLOCKS.map((b) => b.id)).size).toBe(
      PRINTED_BLOCKS.length,
    );
    expect(new Set(PRINTED_BLOCKS.map((b) => b.canonicalPrefix)).size).toBe(
      PRINTED_BLOCKS.length,
    );
  });
});

describe('findPrintedOverflow — sequential tables', () => {
  it('reports nothing for zero records', () => {
    expect(findPrintedOverflow([])).toEqual([]);
  });

  it('reports nothing for one record', () => {
    expect(findPrintedOverflow(records('income.earned', 1))).toEqual([]);
  });

  it('reports nothing at exactly the printed capacity', () => {
    expect(findPrintedOverflow(records('income.earned', 4))).toEqual([]);
  });

  it('reports the first record past capacity', () => {
    const dropped = findPrintedOverflow(records('income.earned', 5));

    expect(dropped).toHaveLength(1);
    expect(dropped[0].blockId).toBe('income.earned');
    expect(dropped[0].saws).toBe('Q8');
    expect(dropped[0].page).toBe(15);
    expect(dropped[0].ordinal).toBe(5);
    expect(dropped[0].reason).toBe('beyond_printed_rows');
  });

  it('reports every record past capacity, not just the first', () => {
    expect(findPrintedOverflow(records('income.earned', 7))).toHaveLength(3);
  });

  it('explains the overflow in terms of the printed row count', () => {
    const [dropped] = findPrintedOverflow(records('resources.accounts', 5));

    expect(dropped.explanation).toContain('Q24 prints 4 resource rows');
    expect(dropped.explanation).toContain('reported 5');
    expect(dropped.explanation).toContain('separate sheet');
  });

  it('counts records by position, not by the index in the key', () => {
    // A plan whose indices skip a number still overflows on the fifth record.
    const plan = [0, 2, 4, 6].flatMap((index) => [
      { key: `income.earned.${index}.person_name`, value: 'x' },
    ]);

    expect(findPrintedOverflow(plan)).toEqual([]);
  });

  it('keeps each printed block independent', () => {
    const plan = [
      ...records('income.earned', 5),
      ...records('resources.accounts', 2),
    ];

    expect(findPrintedOverflow(plan).map((d) => d.blockId)).toEqual([
      'income.earned',
    ]);
  });

  it('is deterministic across repeated calls', () => {
    const plan = [
      ...records('income.earned', 6),
      ...records('appendices.vehicle', 5),
    ];
    const first = JSON.stringify(findPrintedOverflow(plan));

    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(findPrintedOverflow(plan))).toBe(first);
    }
  });
});

describe('findPrintedOverflow — tables keyed by printed row', () => {
  const expenses = (kinds: string[]) =>
    kinds.flatMap((kind, index) => [
      { key: `expenses.household.${index}.kind`, value: kind },
      { key: `expenses.household.${index}.amount_monthly`, value: 100 },
    ]);

  it('places one expense of each printed kind without complaint', () => {
    expect(
      findPrintedOverflow(expenses(['rent_or_mortgage', 'telephone', 'water'])),
    ).toEqual([]);
  });

  it('reports a second expense that wants a printed row already in use', () => {
    const dropped = findPrintedOverflow(expenses(['telephone', 'telephone']));

    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('printed_row_already_used');
    expect(dropped[0].ordinal).toBe(2);
    expect(dropped[0].explanation).toContain('Telephone');
  });

  it('knows two different kinds can share one printed row', () => {
    const dropped = findPrintedOverflow(expenses(['gas', 'electricity']));

    expect(dropped).toHaveLength(1);
    expect(dropped[0].category).toBe('electricity');
    expect(dropped[0].explanation).toContain('Heating or cooling');
  });

  it('reports a category the printed table has no row for at all', () => {
    const dropped = findPrintedOverflow(expenses(['other']));

    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('category_has_no_printed_row');
    expect(dropped[0].saws).toBe('Q15');
  });

  it('treats a record with no category at all as unplaceable', () => {
    const dropped = findPrintedOverflow([
      { key: 'expenses.household.0.amount_monthly', value: 100 },
    ]);

    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('category_has_no_printed_row');
  });

  it('applies the same rules to Q9 in-kind support', () => {
    const plan = [
      { key: 'income.in_kind.0.kind', value: 'housing' },
      { key: 'income.in_kind.1.kind', value: 'housing' },
      { key: 'income.in_kind.2.kind', value: 'transport' },
    ];

    expect(findPrintedOverflow(plan).map((d) => d.reason)).toEqual([
      'printed_row_already_used',
      'category_has_no_printed_row',
    ]);
  });
});

describe('findHouseholdOverflow', () => {
  it('reports nothing for a household inside the printed tables', () => {
    expect(findHouseholdOverflow(PRINTED_HOUSEHOLD_ROWS, 0)).toEqual([]);
    expect(findHouseholdOverflow(1, PRINTED_HOUSEHOLD_ROWS)).toEqual([]);
  });

  it('reports each adult past the fifth printed row', () => {
    const dropped = findHouseholdOverflow(7, 0);

    expect(dropped.map((d) => d.ordinal)).toEqual([6, 7]);
    expect(dropped[0].saws).toBe('Q6');
    expect(dropped[0].page).toBe(9);
  });

  it('numbers the adult and child tables independently', () => {
    const dropped = findHouseholdOverflow(6, 6);

    expect(dropped.map((d) => `${d.saws}:${d.ordinal}`)).toEqual([
      'Q6:6',
      'Q6b:6',
    ]);
    expect(dropped[1].page).toBe(10);
  });
});
