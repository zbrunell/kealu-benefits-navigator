//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Where a Texas applicant sends the H1010 we prepared — and only a Texas one.
 *
 * HHSC accepts a paper H1010 three ways: fax, mail, or in person at a benefits
 * office. The generated PDF cannot be filed through YourTexasBenefits.com (that
 * site takes its own online application) and 2-1-1 is a help line, not a way
 * to file, so neither is offered here.
 *
 * ── Fax and mail ───────────────────────────────────────────────────────────
 * Copied from the form itself: page A ("How to send it") and page 7 ("Return
 * this completed form by fax, mail, or in person") of the edition we fill,
 * `forms/TX-H1010-EN-2026-08.pdf`. When that asset is replaced, check these
 * against the new edition.
 *
 * ── In person ──────────────────────────────────────────────────────────────
 * HHSC publishes no office dataset. `tx-hhsc-offices.json` is a snapshot of
 * HHSC's own "Find an office" answer for every county, reduced to the offices
 * that take Texas Works applications (SNAP, TANF, Medicaid for families and
 * children), with each Texas ZIP assigned the nearest of the offices HHSC
 * lists for that ZIP's county. See `tools/build_tx_hhsc_offices.py`. The
 * lookup is a table read: no network, so demo mode runs the same code.
 *
 * ── Texas only ─────────────────────────────────────────────────────────────
 * The caller passes the state of the application it is showing — the
 * registry's answer (`applicationForForm(formId).state`), not a second guess —
 * and anything but Texas gets no office. The home address must also be in
 * Texas: a Texas application whose applicant typed an out-of-state address
 * is told to use the form's mail and fax, not sent to an office we picked
 * from someone else's ZIP.
 */

import { normalizeZip, stateFromZipPrefix } from '@/lib/location';
import type { ApplicationAddress } from '@/types/application';
import snapshot from './tx-hhsc-offices.json';

/** HHSC's fax and mailing address for a completed H1010, as printed on it. */
export const TX_HHSC_SUBMISSION = {
  fax: '1-877-447-2839',
  mailLines: ['HHSC', 'PO Box 149024', 'Austin, TX 78714-9968'],
} as const;

export interface TexasHhscOffice {
  street: string;
  city: string;
  state: 'TX';
  zipCode: string;
  county: string;
}

interface Snapshot {
  offices: Record<string, Omit<TexasHhscOffice, 'state'>>;
  zipToOffice: Record<string, string>;
}

const DATA = snapshot as Snapshot;

/**
 * The HHSC benefits office a Texas applicant can take their H1010 to.
 *
 * Null when the application is not a Texas one, when the home address is not
 * in Texas, or when the ZIP is one HHSC's answer does not cover (a PO-box-only
 * ZIP, a typo). Null never means "no office exists" — the caller still offers
 * fax and mail, and says how to find an office.
 */
export function texasHhscOfficeFor(
  applicationState: string | null | undefined,
  homeAddress: Pick<ApplicationAddress, 'state' | 'zipCode'>,
): TexasHhscOffice | null {
  if ((applicationState ?? '').trim().toUpperCase() !== 'TX') return null;

  const zip = normalizeZip(homeAddress.zipCode);

  if (!zip || stateFromZipPrefix(zip) !== 'TX') return null;

  const typedState = homeAddress.state.trim().toUpperCase();

  if (typedState && typedState !== 'TX') return null;

  const id = DATA.zipToOffice[zip];
  const office = id ? DATA.offices[id] : undefined;

  return office ? { ...office, state: 'TX' } : null;
}
