//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Which application a household in a given state files, and how we help.
 *
 * Two ways of helping, and the difference is the whole point of this module:
 *
 * - `generated` — we hold a machine-fillable copy of the official form, know
 *   what each destination means, and produce a partly prefilled draft.
 * - `manual` — we know the programme, why the household may qualify, and where
 *   to apply, but we do not fill a form. The applicant files through the
 *   official channel and we hand them a checklist.
 *
 * `manual` is not a degraded `generated`. Most benefit applications in most
 * states have no fillable form we can rely on, and a navigator that only works
 * where one exists is not a navigator. Treating the two as separate kinds —
 * rather than as "supported" and "unsupported" — is what keeps a programme
 * visible when we cannot automate it.
 *
 * What this module deliberately does not contain: anything about the *inside*
 * of any PDF. Field names, page counts, destination maps and coordinate tables
 * live with the state implementation that verified them (for California, in
 * pdf_generator.py and printed-labels.ts). A registry that knew about fields
 * would have to be edited every time a form was re-verified, and would invite
 * exactly the guesses this project refuses to make.
 */

/** How far we can take an application on the applicant's behalf. */
export type ApplicationDelivery = 'generated' | 'manual';

/**
 * A benefit programme, identified across every state we support.
 *
 * State-prefixed because the programmes are not the same thing: Texas SNAP and
 * CalFresh are both SNAP, but they are administered separately, have different
 * income tests and appear on different forms. `Saws2PlusProgram` stays the
 * California-only set it always was, rather than being widened until it looks
 * generic while still meaning California.
 */
export const BENEFIT_PROGRAM_IDS = [
  // California — SAWS 2 PLUS
  'medi_cal',
  'calfresh',
  'calworks',
  // Texas — Form H1010
  'tx_medicaid',
  'tx_chip',
  'tx_snap',
  'tx_tanf',
] as const;

export type BenefitProgramId = (typeof BENEFIT_PROGRAM_IDS)[number];

/** Every application form this project knows how to talk about. */
export const SUPPORTED_APPLICATION_FORMS = [
  'CA_SAWS_2_PLUS',
  'TX_H1010',
] as const;

export type SupportedApplicationForm =
  (typeof SUPPORTED_APPLICATION_FORMS)[number];

/** How an applicant can file, in the order we recommend trying. */
export type ApplicationChannel = 'online' | 'phone' | 'in_person' | 'mail';

export interface StateApplicationDefinition {
  /** Two-letter USPS state code, uppercase. */
  state: string;
  formId: SupportedApplicationForm;
  /**
   * The form's own designation, as the agency prints it.
   *
   * Not translated: an applicant looking for "H1010" on a county website will
   * not find "Formulario H1010" if the agency does not use that name.
   */
  formCode: string;
  /** Catalog key for the form's descriptive name. */
  formNameKey: string;
  delivery: ApplicationDelivery;
  /** Programmes this one application covers. */
  programs: readonly BenefitProgramId[];
  /** Where the official application lives. */
  officialUrl: string;
  /** Channels the agency offers, most-recommended first. */
  channels: readonly ApplicationChannel[];
  /**
   * Catalog key for how to file.
   *
   * Present for every entry, `manual` or not: even a generated draft has to be
   * submitted somewhere, and that is the step applicants most often get wrong.
   */
  howToApplyKey: string;
}

/**
 * The applications we support, by state.
 *
 * California is `generated` because the SAWS 2 PLUS AcroForm was inspected,
 * its destinations verified against the printed pages, and its safe fields
 * allowlisted. Texas is `manual` because none of that has been done for Form
 * H1010 — the form has not been inspected at all, and claiming otherwise by
 * writing speculative mappings would be worse than filing on paper.
 */
const DEFINITIONS: readonly StateApplicationDefinition[] = [
  {
    state: 'CA',
    formId: 'CA_SAWS_2_PLUS',
    formCode: 'SAWS 2 PLUS',
    formNameKey: 'app_ca_saws2plus_name',
    delivery: 'generated',
    programs: ['medi_cal', 'calfresh', 'calworks'],
    officialUrl: 'https://benefitscal.com/',
    channels: ['online', 'in_person', 'mail'],
    howToApplyKey: 'app_ca_how_to_apply',
  },
  {
    /*
     * Texas consolidates the same three categories California splits across
     * Medi-Cal, CalFresh and CalWORKs into one form: Form H1010, Texas Works
     * Application for Assistance, which covers SNAP, TANF and healthcare
     * (Medicaid and CHIP). Verified against the Texas HHS form page.
     *
     * `manual` until the form itself has been inspected. If it turns out to
     * carry a usable AcroForm, this entry becomes `generated` and gains a
     * mapping module — which is the change this design is meant to make small.
     */
    state: 'TX',
    formId: 'TX_H1010',
    formCode: 'H1010',
    formNameKey: 'app_tx_h1010_name',
    delivery: 'manual',
    programs: ['tx_medicaid', 'tx_chip', 'tx_snap', 'tx_tanf'],
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['online', 'phone', 'in_person', 'mail'],
    howToApplyKey: 'app_tx_how_to_apply',
  },
];

/** The application for a state, or null when we do not support one yet. */
export function applicationForState(
  state: string | undefined | null,
): StateApplicationDefinition | null {
  const code = (state ?? '').trim().toUpperCase();

  if (code.length === 0) return null;

  return DEFINITIONS.find((entry) => entry.state === code) ?? null;
}

/** The application a form id belongs to. */
export function applicationForForm(
  formId: string,
): StateApplicationDefinition | null {
  return DEFINITIONS.find((entry) => entry.formId === formId) ?? null;
}

/** Whether we produce a prefilled draft for this state. */
export function hasGeneratedApplication(state: string | undefined): boolean {
  return applicationForState(state)?.delivery === 'generated';
}

/** Every state with an application, for tests and diagnostics. */
export function supportedApplicationStates(): string[] {
  return DEFINITIONS.map((entry) => entry.state);
}

/** California's three programmes, for code that only handles SAWS 2 PLUS. */
const SAWS_PROGRAM_IDS = ['medi_cal', 'calfresh', 'calworks'] as const;

/**
 * Narrow a programme id to the California set.
 *
 * The SAWS 2 PLUS components — program selection, the questionnaire, the field
 * plan — genuinely only handle these three, and this is where that is said out
 * loud. Widening those components to accept every programme id would make them
 * look state-agnostic while every line inside still assumed California.
 */
export function isSaws2PlusProgram(
  program: string,
): program is (typeof SAWS_PROGRAM_IDS)[number] {
  return (SAWS_PROGRAM_IDS as readonly string[]).includes(program);
}

/** Whether a programme id belongs to a state's application. */
export function programBelongsToForm(
  formId: string,
  program: string,
): boolean {
  const definition = applicationForForm(formId);

  if (!definition) return false;

  return (definition.programs as readonly string[]).includes(program);
}
