/**
 * Where a Texas applicant submits the H1010 we prepared — and that nobody
 * else is sent to a Texas office.
 *
 * Three guarantees:
 * - The office lookup answers only for a Texas application with a Texas home
 *   address. A California application never gets a Texas HHSC office, even
 *   for a Texas ZIP.
 * - The office comes from the applicant's own home ZIP, via HHSC's own
 *   "Find an office" answer (see tools/build_tx_hhsc_offices.py).
 * - The submission copy offers fax, mail and in person only — never
 *   YourTexasBenefits.com, an upload, or 2-1-1 as a way to submit.
 */
import { describe, expect, it } from 'vitest';

import en from '@/i18n/messages/en';
import es from '@/i18n/messages/es';
import zhCN from '@/i18n/messages/zh-CN';
import { applicationForForm, applicationForState } from '@/lib/state-applications';
import {
  TX_HHSC_SUBMISSION,
  texasHhscOfficeFor,
} from '@/lib/tx-hhsc-office';
import snapshot from '@/lib/tx-hhsc-offices.json';

const texasState = applicationForForm('TX_H1010')?.state;
const californiaState = applicationForForm('CA_SAWS_2_PLUS')?.state;

const austin = { state: 'TX', zipCode: '78705' };

describe('texasHhscOfficeFor — Texas vs. non-Texas', () => {
  it('uses the registry’s state for each form', () => {
    expect(texasState).toBe('TX');
    expect(californiaState).toBe('CA');
    expect(applicationForState('TX')?.formId).toBe('TX_H1010');
  });

  it('returns an office for a Texas application with a Texas address', () => {
    expect(texasHhscOfficeFor(texasState, austin)).not.toBeNull();
  });

  it('never returns a Texas office for a California application', () => {
    // Even when the address itself is in Texas.
    expect(texasHhscOfficeFor(californiaState, austin)).toBeNull();
    expect(
      texasHhscOfficeFor(californiaState, { state: 'CA', zipCode: '90001' }),
    ).toBeNull();
  });

  it('never returns a Texas office for a state we do not support', () => {
    expect(texasHhscOfficeFor('NY', austin)).toBeNull();
    expect(texasHhscOfficeFor('', austin)).toBeNull();
    expect(texasHhscOfficeFor(undefined, austin)).toBeNull();
    expect(texasHhscOfficeFor(null, austin)).toBeNull();
  });

  it('returns no office when a Texas application has an out-of-state address', () => {
    expect(
      texasHhscOfficeFor(texasState, { state: 'CA', zipCode: '90001' }),
    ).toBeNull();
    // A Texas ZIP typed beside another state is not trusted either.
    expect(
      texasHhscOfficeFor(texasState, { state: 'OK', zipCode: '78705' }),
    ).toBeNull();
  });

  it('returns no office for a missing or malformed ZIP', () => {
    expect(texasHhscOfficeFor(texasState, { state: 'TX', zipCode: '' })).toBeNull();
    expect(texasHhscOfficeFor(texasState, { state: 'TX', zipCode: '787' })).toBeNull();
  });

  it('accepts a blank typed state when the ZIP is in Texas', () => {
    expect(
      texasHhscOfficeFor(texasState, { state: '', zipCode: '78705' }),
    ).not.toBeNull();
  });
});

describe('texasHhscOfficeFor — chosen from the applicant’s home ZIP', () => {
  it('sends an Austin ZIP to HHSC’s Austin benefits office', () => {
    // HHSC's own locator answers 78705 with this office.
    expect(texasHhscOfficeFor(texasState, austin)).toEqual({
      street: '5451 North IH 35, Suite D',
      city: 'Austin',
      state: 'TX',
      zipCode: '78723',
      county: 'Travis',
    });
  });

  it('sends a ZIP in a county with no office to the one HHSC names for it', () => {
    // Loving County (Mentone, 79754) has no office; HHSC's locator lists the
    // Pecos office, in Reeves County, for SNAP, TANF and Medicaid. Midland's
    // office, which it also lists, serves only Medicare Savings and MEPD.
    const office = texasHhscOfficeFor(texasState, {
      state: 'TX',
      zipCode: '79754',
    });

    expect(office?.city).toBe('Pecos');
    expect(office?.county).toBe('Reeves');
  });

  it('changes with the address the applicant typed, not the intake ZIP', () => {
    const elPaso = texasHhscOfficeFor(texasState, {
      state: 'TX',
      zipCode: '79901',
    });

    expect(elPaso?.city).toBe('El Paso');
    expect(elPaso).not.toEqual(texasHhscOfficeFor(texasState, austin));
  });
});

describe('the office snapshot', () => {
  const offices = Object.values(snapshot.offices);
  const zips = Object.keys(snapshot.zipToOffice);

  it('records where it came from and when', () => {
    expect(snapshot.source).toBe(
      'https://www.yourtexasbenefits.com/Screener/FindanOffice',
    );
    expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
  });

  it('covers Texas ZIPs only, and every one points at a real office', () => {
    expect(zips.length).toBeGreaterThan(1500);

    for (const zip of zips) {
      expect(zip).toMatch(/^7[5-9]\d{3}$|^885\d{2}$/);

      const id = (snapshot.zipToOffice as Record<string, string>)[zip];

      expect((snapshot.offices as Record<string, unknown>)[id]).toBeDefined();
    }
  });

  it('holds a complete Texas street address for every office', () => {
    expect(offices.length).toBeGreaterThan(50);

    for (const office of offices) {
      expect(office.street.trim()).not.toBe('');
      expect(office.city.trim()).not.toBe('');
      expect(office.zipCode).toMatch(/^\d{5}$/);
    }
  });
});

describe('Texas submission instructions', () => {
  it('uses the fax and mailing address printed on Form H1010', () => {
    expect(TX_HHSC_SUBMISSION.fax).toBe('1-877-447-2839');
    expect(TX_HHSC_SUBMISSION.mailLines).toEqual([
      'HHSC',
      'PO Box 149024',
      'Austin, TX 78714-9968',
    ]);
  });

  const catalogs = { en, es, 'zh-CN': zhCN } as const;

  const SUBMIT_KEYS = Object.keys(en).filter((key) =>
    key.startsWith('tx_submit_'),
  ) as (keyof typeof en)[];

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale}: never offers YourTexasBenefits.com or an upload as a way to submit`, () => {
      for (const key of SUBMIT_KEYS) {
        const text = catalog[key];

        expect(text, key).not.toMatch(/yourtexasbenefits/i);
        expect(text, key).not.toMatch(/upload|subir|cargar|上传/i);
      }
    });

    it(`${locale}: mentions 2-1-1 only as a way to find an office`, () => {
      for (const key of SUBMIT_KEYS) {
        if (catalog[key].includes('2-1-1')) {
          expect(key).toBe('tx_submit_office_unknown');
        }
      }
    });
  }

  it('the old online / 2-1-1 next-steps copy is gone', () => {
    expect('tx_draft_next_steps' in en).toBe(false);
    expect('tx_draft_official_link' in en).toBe(false);
  });

  it('says HHSC decides, may ask for more, and that proof is a separate step', () => {
    expect(en.tx_submit_intro).toMatch(/still needs to be submitted to HHSC/);
    expect(en.tx_submit_after).toMatch(/HHSC makes the official decision/);
    expect(en.tx_submit_after).toMatch(/may ask for more information or proof/);
    expect(en.tx_submit_after).toMatch(/separate step from submitting/);
  });
});

describe('preliminary eligibility wording', () => {
  const DEFINITIVE = /\byou qualify\b|\byou are eligible\b|\byou will receive\b/i;

  it('the results summary says “may qualify”, based on what was provided', () => {
    expect(en.report_action_plan_intro).toBe(
      'Based on the information you provided, you may qualify for the following benefits.',
    );
  });

  it('the results summary and disclaimers make no definitive promise', () => {
    for (const key of [
      'report_action_plan_intro',
      'report_screening_note',
      'report_disclaimer',
      'report_disclaimer_tx',
    ] as const) {
      expect(en[key], key).not.toMatch(DEFINITIVE);
    }
  });

  it('the Texas disclaimer names HHSC as the one who decides; the other does not', () => {
    expect(en.report_disclaimer_tx).toContain(
      'does not make an official eligibility determination',
    );
    expect(en.report_disclaimer_tx).toContain(
      'The Texas Health and Human Services Commission (HHSC) will make the final determination',
    );
    expect(en.report_disclaimer).not.toMatch(/HHSC|Texas/);
    expect(es.report_disclaimer).not.toMatch(/HHSC|Texas/);
    expect(zhCN.report_disclaimer).not.toMatch(/HHSC|德州/);
  });

  it('Texas CHIP guidance does not ask the applicant to choose between programs', () => {
    expect(en.elig_tx_chip_after_medicaid_screen).toMatch(
      /do not choose between them/,
    );
  });
});
