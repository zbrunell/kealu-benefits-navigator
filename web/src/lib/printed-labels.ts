//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * What the paper actually says, in the language of the paper.
 *
 * These strings are quotations, not prose. When the guide tells someone to look
 * for a heading, the words have to match the page in front of them — so they are
 * keyed by **document** language, not by interface language.
 *
 * That distinction is the whole point of this module:
 *
 *   es    reads a Spanish guide holding the Spanish form  → Spanish quotations
 *   zh-CN reads a Chinese guide holding the *English* form → English quotations
 *   en    English throughout
 *
 * Getting it wrong in either direction sends someone hunting for text that is
 * not on their page.
 *
 * Every Spanish string below was extracted from the official fillable CDSS
 * Spanish form in this repository — `forms/CA-SAWS-2-PLUS-ES.pdf`, revision
 * 4/15 — not translated by hand. `printed-labels.test.ts` re-extracts them from
 * that PDF and fails if they drift, so this file cannot quietly become a
 * paraphrase.
 *
 * The official government PDFs are never modified, regenerated or translated by
 * this project.
 */

import type { Locale } from '@/lib/locale';

/** A quotation of the printed page, per document language. */
export interface PrintedText {
  en: string;
  /**
   * Absent when the Spanish form's wording has not been verified against the
   * PDF yet. `printedTextFor` then falls back to English rather than guessing,
   * because a wrong Spanish quotation is worse than an English one: it looks
   * right and cannot be found.
   */
  es?: string;
}

/**
 * Section headings the completion guide points at.
 *
 * Keys are stable ids. The English side is what the assessor used to hardcode.
 */
export const PRINTED_SECTIONS: Record<string, PrintedText> = {
  applicant_information: {
    en: 'Applicant’s information',
    es: 'Información del solicitante',
  },
  household_adults: {
    en: 'Household’s information: adults',
    es: 'Información del hogar: adultos',
  },
  household_children: {
    en: 'Household’s information: children',
    es: 'Información del hogar: niños',
  },
  /*
   * Our own description of a region, not a heading the form prints. It is
   * therefore translated as prose in the catalog (guide_region_* keys) rather
   * than quoted, and carries no `es` entry here.
   */
  signature_block_page_1: {
    en: 'Signature block at the foot of page 1',
  },
  noncitizen_information: {
    en: 'Noncitizen and sponsored-noncitizen information',
    es: 'Información de las personas que no son ciudadanas',
  },
  // Also our own description; see signature_block_page_1.
  renew_with_tax_data: {
    en: 'Using tax data to renew coverage',
  },
  /*
   * Q27's printed heading is the question sentence itself, quoted from the
   * Spanish form.
   */
  real_property: {
    en: 'Home, land or other property',
    es: 'casa, terreno, o propiedad',
  },
  // Appendix A's own printed block heading.
  employer_coverage_employee: {
    en: 'Health coverage from jobs — employee information',
    es: 'Información acerca del EMPLEADOR',
  },
  employment_history: {
    en: 'Employment history',
    es: 'Historial de empleo',
  },
};

/**
 * Labels printed beside individual blanks.
 *
 * These are the strings a reader scans the page for, so they are reproduced
 * exactly as the form prints them — including its own capitalisation.
 */
export const PRINTED_LABELS: Record<string, PrintedText> = {
  ssn_page_1: {
    en: 'SOCIAL SECURITY NUMBER (IF YOU HAVE',
    es: 'NÚMERO DE SEGURO SOCIAL (SI LO TIENE',
  },
  ssn_household_column: {
    en: 'SOCIAL SECURITY NUMBER',
    es: 'NÚMERO DE SEGURO SOCIAL',
  },
  ssn_appendix_a_employee: {
    en: 'EMPLOYEE SOCIAL SECURITY NUMBER',
    es: 'NÚMERO DE SEGURO SOCIAL DEL EMPLEADO',
  },
  signature_applicant: {
    en: 'SIGNATURE OF APPLICANT, CARETAKER RELATIVE (OR ADULT HOUSEHOLD MEMBER/ AUTHORIZED REPRESENTATIVE*/GUARDIAN)',
    es: 'FIRMA DEL SOLICITANTE, PERSONA ENCARGADA DEL CUIDADO CONTINUO DE UN FAMILIAR',
  },
  signature_other_adult: {
    en: 'SIGNATURE OF SPOUSE, OTHER PARENT, OTHER AIDED ADULT, OR REGISTERED DOMESTIC PARTNER',
    es: 'FIRMA DE LA ESPOSA(O), OTRO PADRE/MADRE, OTRO ADULTO QUE RECIBE ASISTENCIA, O PAREJA DOMÉSTICA',
  },
  employer_name: {
    en: 'EMPLOYER NAME',
    es: 'NOMBRE DEL EMPLEADOR',
  },
  employee_name: {
    en: 'EMPLOYEE NAME (FIRST NAME, MIDDLE NAME, LAST NAME)',
    es: 'NOMBRE DEL EMPLEADO (PRIMER NOMBRE, SEGUNDO NOMBRE, APELLIDO)',
  },
};

/**
 * The quotation for `key` in the language of the paper.
 *
 * `documentLanguage` is deliberately the argument, not the interface locale.
 * Falls back to English when Spanish has not been verified, because an
 * unverified Spanish quotation would look correct and be unfindable.
 */
export function printedTextFor(
  table: Record<string, PrintedText>,
  key: string,
  documentLanguage: Locale,
): string | undefined {
  const entry = table[key];

  if (!entry) return undefined;
  if (documentLanguage === 'es' && entry.es) return entry.es;

  return entry.en;
}
