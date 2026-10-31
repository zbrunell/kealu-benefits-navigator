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
     * `generated`, and the change this design was meant to make small: the
     * mapping layer holds 154 verified H1010 mappings, the Texas intake
     * collects the canonical answers behind them, and Python renders the
     * document. What Texas does *not* have is HHSC's own PDF — the agency
     * publishes H1010 only through a web application — so the generated
     * document is a prefilled worksheet carrying the applicant's answers, and
     * every surface that shows it says so. That distinction lives on the
     * generated document itself (`is_official_document`), not here: `manual`
     * means "we do not fill a form at all", which is a different thing from
     * "the form we fill is not the agency's own paper".
     */
    state: 'TX',
    formId: 'TX_H1010',
    formCode: 'H1010',
    formNameKey: 'app_tx_h1010_name',
    delivery: 'generated',
    programs: ['tx_medicaid', 'tx_chip', 'tx_snap', 'tx_tanf'],
    officialUrl: 'https://www.yourtexasbenefits.com/',
    channels: ['online', 'phone', 'in_person', 'mail'],
    howToApplyKey: 'app_tx_how_to_apply',
  },
];

// ---------------------------------------------------------------------------
// Application bundles — the form follows the programs, not the other way round
// ---------------------------------------------------------------------------

/**
 * Registry program id -> the box it occupies on a state's consolidated form.
 *
 * Two different id spaces, deliberately kept apart:
 *
 * - `lib/programs/` ids (`tx_medicaid_child`, `travis_central_health_map`)
 *   answer "what programs exist, and where are they valid".
 * - `BenefitProgramId` answers "what does this *form* cover".
 *
 * They are not the same question, and collapsing them would break both. Texas
 * Form H1010 has one healthcare section covering every Medicaid category, so
 * four registry programs map to one form program. Central Health MAP maps to no
 * form at all - it has its own application, which is exactly the fact the
 * action plan needs and would lose if every program were forced onto a form.
 */
const REGISTRY_TO_FORM_PROGRAM: Readonly<Record<string, BenefitProgramId>> = {
  // California - SAWS 2 PLUS
  ca_medi_cal: 'medi_cal',
  ca_calfresh: 'calfresh',
  ca_calworks: 'calworks',

  // Texas - Form H1010. The healthcare section covers every Medicaid category,
  // so the age-band, pregnancy and parent programs share one destination.
  tx_medicaid_child: 'tx_medicaid',
  tx_medicaid_pregnancy: 'tx_medicaid',
  tx_medicaid_parent: 'tx_medicaid',
  tx_chip: 'tx_chip',
  tx_chip_perinatal: 'tx_chip',
  tx_snap: 'tx_snap',
  tx_tanf: 'tx_tanf',
};

/** The form box a registry program belongs in, or null when it has no form. */
export function formProgramFor(
  registryProgramId: string,
): BenefitProgramId | null {
  return REGISTRY_TO_FORM_PROGRAM[registryProgramId] ?? null;
}

/**
 * Everything an applicant must file, given where they live and what they need.
 *
 * The answer to the brief's `resolve_application_bundle`. It derives the form
 * from the jurisdiction and the selected programs rather than assuming SAWS 2
 * PLUS is the canonical multi-benefit application - which is what made a Texas
 * household's route wrong even after the programs were right.
 *
 * `separateApplications` is the part a form-only model cannot express: programs
 * that are genuinely available to this household but are not on the state form
 * and have their own agency, portal and deadline. For an Austin household that
 * is Central Health MAP and the Austin Energy discount, and omitting them would
 * leave the two most useful local programs with no route.
 */
export interface ApplicationBundle {
  /** The state's consolidated form, when the household is in a state we cover. */
  definition: StateApplicationDefinition | null;
  /** Form boxes to tick, deduplicated, in the form's own order. */
  formPrograms: readonly BenefitProgramId[];
  /** Registry program ids that route to the state form. */
  formProgramSources: readonly string[];
  /** Registry program ids that need their own separate application. */
  separateApplications: readonly string[];
}

/**
 * Resolve the application bundle for a state and a set of registry programs.
 *
 * Pure and total: an unsupported state yields a bundle with no form and every
 * program listed as needing its own application, which is the honest answer
 * rather than an error.
 */
export function resolveApplicationBundle(params: {
  state: string | undefined | null;
  programIds: readonly string[];
}): ApplicationBundle {
  const definition = applicationForState(params.state);

  const formPrograms: BenefitProgramId[] = [];
  const formProgramSources: string[] = [];
  const separateApplications: string[] = [];

  for (const id of params.programIds) {
    const formProgram = formProgramFor(id);

    /*
     * A program only routes to the form when the form actually covers it. A
     * California program id reaching a Texas bundle therefore lands in
     * `separateApplications` rather than silently ticking a Texas box - though
     * the jurisdiction invariant should have rejected it long before here.
     */
    const covered =
      definition !== null &&
      formProgram !== null &&
      (definition.programs as readonly string[]).includes(formProgram);

    if (covered) {
      if (!formPrograms.includes(formProgram)) formPrograms.push(formProgram);

      formProgramSources.push(id);
    } else {
      separateApplications.push(id);
    }
  }

  // Present the form boxes in the order the form itself lists them.
  const ordered = definition
    ? definition.programs.filter((program) => formPrograms.includes(program))
    : [];

  return {
    definition,
    formPrograms: ordered,
    formProgramSources,
    separateApplications,
  };
}

/**
 * The catalog key naming a programme, for any state.
 *
 * One lookup, because three components each held their own English map —
 * `{ medi_cal: "Medi-Cal", ... }` — which meant a Spanish-speaking applicant
 * read translated help text beside an untranslated programme name, and a Texas
 * programme had no entry at all so its checkbox rendered blank.
 */
const PROGRAM_NAME_KEYS: Readonly<Record<BenefitProgramId, string>> = {
  medi_cal: 'program_medi_cal',
  calfresh: 'program_calfresh',
  calworks: 'program_calworks',
  tx_medicaid: 'program_tx_medicaid',
  tx_chip: 'program_tx_chip',
  tx_snap: 'program_tx_snap',
  tx_tanf: 'program_tx_tanf',
};

/** The catalog key for a programme's name, or the id when it is unknown. */
export function programNameKey(program: string): string {
  return PROGRAM_NAME_KEYS[program as BenefitProgramId] ?? program;
}

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
