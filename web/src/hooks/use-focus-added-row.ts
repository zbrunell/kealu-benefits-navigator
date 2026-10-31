//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useEffect, useRef } from 'react';

/** Rows the hook looks in carry this attribute. */
export const ADDED_ROW_ATTRIBUTE = 'data-added-row';

/**
 * The first box someone would type into: not the row's Remove button, and not
 * a checkbox, which is a choice rather than somewhere to start typing.
 */
const FIRST_FIELD =
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/**
 * Put the cursor in a row the applicant has just added.
 *
 * "Add a person" used to append an empty card and leave focus on the button,
 * so the applicant had to find the new card and click into its first box
 * before typing. Focusing that box also scrolls the new card into view.
 *
 * Only a row added by `markAdded()` is focused. A list that grows for any
 * other reason (a prefill, a resumed session) leaves focus where it was.
 */
export function useFocusAddedRow<T extends HTMLElement>(rowCount: number) {
  const containerRef = useRef<T>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (!pending.current) return;

    pending.current = false;

    const rows = containerRef.current?.querySelectorAll<HTMLElement>(
      `[${ADDED_ROW_ATTRIBUTE}]`,
    );
    const last = rows?.[rows.length - 1];

    last?.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
  }, [rowCount]);

  return {
    containerRef,
    markAdded: () => {
      pending.current = true;
    },
  };
}
