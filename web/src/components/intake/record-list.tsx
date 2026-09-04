//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

/**
 * A list the applicant adds rows to: jobs, other income, bills, a helper.
 *
 * The same component for all of them, because they are the same interaction and
 * the differences — what a row contains, what it is called, how many the
 * printed form has room for — are configuration.
 *
 * ── Overflow is said at the point of typing ────────────────────────────────
 * The mapping layer already reports rows a printed table cannot hold, on the
 * review sheet, after the document exists. That is too late to be useful and
 * too early to be ignored: someone who enters a fourth job should be told while
 * they are entering it that the form has three rows and the fourth goes on an
 * attachment. So the row count is carried in the configuration and the warning
 * appears here, beside the row that will not fit.
 *
 * Nothing is dropped either way. The extra row stays in the application data,
 * reaches the canonical plan, and is counted in the generated document's
 * overflow report — the warning is a warning, not a limit.
 */

import { useTranslation } from "@/hooks/use-translation";
import { QuestionField } from "@/components/intake/question-fields";
import type { IntakeQuestion } from "@/lib/form-intake/model";

export interface RecordListView<TRecord> {
  id: string;
  titleKey: string;
  introKey: string;
  addLabelKey: string;
  emptyKey: string;
  printedRows: number;
  fields: readonly IntakeQuestion<TRecord>[];
  /** Field whose options are the people in this household, if any. */
  peopleField?: string;
}

/** One selectable person, named as they were typed rather than by a key. */
export interface PersonOption {
  value: string;
  /** Catalog key, for the applicant's own row. Empty for a named member. */
  labelKey: string;
  /** The name as entered, shown beside the catalog label when there is one. */
  label: string;
}

interface RecordListEditorProps<TRecord> {
  list: RecordListView<TRecord>;
  records: readonly TRecord[];
  onChange: (records: readonly TRecord[]) => void;
  blank: (index: number) => TRecord;
  showErrors: boolean;
  /** Hide the "add" button once the list is a fixed size — one helper, say. */
  maxRows?: number;
  /**
   * The household, for a list that has to say whose row this is.
   *
   * Passed in rather than read here: who lives in this household is not a
   * property of the printed table, and a list editor that went looking for it
   * would only work for the one application model it happened to know.
   */
  people?: readonly PersonOption[];
}

export function RecordListEditor<TRecord>({
  list,
  records,
  onChange,
  blank,
  showErrors,
  maxRows,
  people,
}: RecordListEditorProps<TRecord>) {
  const { t, tv } = useTranslation();

  /**
   * The field list as rendered, with the people options filled in.
   *
   * A person's name is not a catalog key — it is what they typed — so the
   * option label is built here and the applicant's own row keeps a translated
   * label beside their name.
   */
  const fields = list.fields.map((field) => {
    if (!list.peopleField || field.id !== list.peopleField) return field;

    return {
      ...field,
      options: (people ?? []).map((person) => ({
        value: person.value,
        labelKey: person.labelKey,
        /*
         * A name is not translatable, so it is shown verbatim. The applicant's
         * own row carries a catalog key as well, so it reads "You" in the
         * applicant's language when they have not typed a name yet.
         */
        label: person.labelKey
          ? person.label
            ? `${t(person.labelKey)} — ${person.label}`
            : t(person.labelKey)
          : person.label || person.value,
      })),
    };
  });

  const limit = maxRows ?? Number.MAX_SAFE_INTEGER;
  const overflow = Math.max(0, records.length - list.printedRows);

  function updateRecord(index: number, next: TRecord) {
    onChange(records.map((record, position) => (position === index ? next : record)));
  }

  function removeRecord(index: number) {
    onChange(records.filter((_, position) => position !== index));
  }

  return (
    <section
      data-testid={`record-list-${list.id}`}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h3 className="font-semibold text-slate-900">{t(list.titleKey)}</h3>

      <p className="mt-1 text-sm text-slate-600">{t(list.introKey)}</p>

      {records.length === 0 && (
        <p
          data-testid={`record-list-${list.id}-empty`}
          className="mt-3 rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500"
        >
          {t(list.emptyKey)}
        </p>
      )}

      <ol className="mt-3 space-y-4">
        {records.map((record, index) => (
          <li
            key={index}
            data-testid={`record-${list.id}-${index}`}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {tv("intake_row_number", { number: String(index + 1) })}
              </p>

              <button
                type="button"
                data-testid={`record-${list.id}-${index}-remove`}
                onClick={() => removeRecord(index)}
                className="text-xs font-medium text-red-700 underline hover:text-red-800"
              >
                {t("intake_remove_row")}
              </button>
            </div>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <QuestionField
                  key={field.id}
                  question={{
                    ...field,
                    // Row-scoped, so two rows' inputs never share a test id or
                    // an aria-describedby target.
                    id: `${list.id}-${index}-${field.id}`,
                  }}
                  state={record}
                  onChange={(next) => updateRecord(index, next)}
                  showErrors={showErrors}
                />
              ))}
            </div>

            {index >= list.printedRows && (
              <p
                data-testid={`record-${list.id}-${index}-overflow`}
                className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
              >
                {tv("intake_overflow_row", {
                  rows: String(list.printedRows),
                })}
              </p>
            )}
          </li>
        ))}
      </ol>

      {records.length < limit && (
        <button
          type="button"
          data-testid={`record-list-${list.id}-add`}
          onClick={() => onChange([...records, blank(records.length)])}
          className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t(list.addLabelKey)}
        </button>
      )}

      {overflow > 0 && (
        <p
          data-testid={`record-list-${list.id}-overflow`}
          className="mt-3 text-xs text-amber-900"
        >
          {tv("intake_overflow_total", {
            count: String(overflow),
            rows: String(list.printedRows),
          })}
        </p>
      )}
    </section>
  );
}
