//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Intake flow logic for the guided household information collection conversation.
 *
 * The intake is structured in two tiers:
 *   - Tier 1: Minimum required fields (ZIP, income, household composition). Research
 *             cannot start without these because FPL calculations and state/county
 *             program lookups depend on all three.
 *   - Tier 2: Improves plan matching quality (coverage, medications, providers, budget,
 *             health needs). These are optional — users can skip via the skip button.
 *
 * Answers are parsed according to the field currently being asked. Structured fields
 * such as ZIP code and yearly income are validated and normalized, while conversational
 * fields are stored as trimmed user-entered text. Opportunistic free-text extraction is
 * retained only for backward compatibility with the MCP-style conversation flow.
 */

import type { ChatMessage, SessionVars } from '@/types/session';

/** Household vars as stored on the session (YAML vars + extra runtime vars). */
type RawVars = SessionVars;

/** All supported intake field keys. */
export type IntakeFieldKey =
  | 'zip_code'
  | 'annual_income'
  | 'household_profile'
  | 'current_coverage'
  | 'medications'
  | 'providers'
  | 'premium_budget'
  | 'health_needs';

/** Result returned when parsing the answer to a specific intake question. */
export interface IntakeParseResult {
  value?: string;
  /**
   * Message key naming why the answer was rejected.
   *
   * A key, not a sentence: the parser runs on the server, where there is no
   * React context to ask what language the applicant reads.
   */
  errorKey?: string;
}

/**
 * Definition of a single guided intake question.
 *
 * One definition per question, in every language. The field carries message
 * keys rather than sentences, so the logic below — which question is next,
 * whether it parses, which tier it belongs to — is written once and the
 * wording is resolved wherever it is displayed. Three copies of this array
 * would be three chances for the Spanish flow to drift out of step with the
 * English one.
 */
export interface IntakeField {
  /** Key into RawVars / HouseholdVars; used to check whether the field is already answered. */
  key: IntakeFieldKey;
  /** Message key for the short label naming this field. */
  labelKey: string;
  /** Message key for the one sentence on why this is asked. Shown below the prompt. */
  rationaleKey: string;
  /** Message key for the question itself. */
  promptKey: string;
  /** Preferred keyboard/input mode for the answer field. */
  inputMode?: 'text' | 'numeric';
  /** Message key for an example shown inside the answer input. */
  placeholderKey?: string;
  /** Intake tier this field belongs to (1 = required, 2 = optional). */
  tier: 1 | 2;
}

/** Tier 1 fields — minimum required to start research. */
export const TIER_1_FIELDS: IntakeField[] = [
  {
    key: 'zip_code',
    labelKey: 'intake_zip_code_label',
    rationaleKey: 'intake_zip_code_rationale',
    promptKey: 'intake_zip_code_prompt',
    inputMode: 'numeric',
    placeholderKey: 'intake_zip_code_placeholder',
    tier: 1,
  },
  {
    key: 'annual_income',
    labelKey: 'intake_annual_income_label',
    rationaleKey: 'intake_annual_income_rationale',
    promptKey: 'intake_annual_income_prompt',
    inputMode: 'numeric',
    tier: 1,
  },
  {
    key: 'household_profile',
    labelKey: 'intake_household_profile_label',
    rationaleKey: 'intake_household_profile_rationale',
    promptKey: 'intake_household_profile_prompt',
    tier: 1,
  },
];

/** Tier 2 fields — improve plan matching quality. */
export const TIER_2_FIELDS: IntakeField[] = [
  {
    key: 'current_coverage',
    labelKey: 'intake_current_coverage_label',
    rationaleKey: 'intake_current_coverage_rationale',
    promptKey: 'intake_current_coverage_prompt',
    tier: 2,
  },
  {
    key: 'medications',
    labelKey: 'intake_medications_label',
    rationaleKey: 'intake_medications_rationale',
    promptKey: 'intake_medications_prompt',
    tier: 2,
  },
  {
    key: 'providers',
    labelKey: 'intake_providers_label',
    rationaleKey: 'intake_providers_rationale',
    promptKey: 'intake_providers_prompt',
    tier: 2,
  },
  {
    key: 'premium_budget',
    labelKey: 'intake_premium_budget_label',
    rationaleKey: 'intake_premium_budget_rationale',
    promptKey: 'intake_premium_budget_prompt',
    tier: 2,
  },
  {
    key: 'health_needs',
    labelKey: 'intake_health_needs_label',
    rationaleKey: 'intake_health_needs_rationale',
    promptKey: 'intake_health_needs_prompt',
    tier: 2,
  },
];

/** All intake fields in display order (Tier 1 followed by Tier 2). */
export const ALL_FIELDS: IntakeField[] = [...TIER_1_FIELDS, ...TIER_2_FIELDS];

/** Total number of intake steps shown in the progress indicator. Covers Tiers 1–2 only. */
export const TOTAL_STEPS = ALL_FIELDS.length;

/**
 * Field keys whose values are extracted/normalized from free text by
 * parseUserMessage (ZIP validation, income annualization). All other fields —
 * including household_profile, which is free-text (e.g. "just me, 20") — store
 * the user's raw answer verbatim, keyed by the question being asked.
 *
 * household_profile is intentionally NOT listed here: parseUserMessage only
 * captures it opportunistically when a family keyword is present. For the
 * dedicated household question, the raw-answer fallback in the intake route
 * must accept any answer — otherwise single-person households like "just me"
 * loop forever because they don't trigger the family keyword set below.
 * Opportunistic extraction is separate from this mandatory set.
 */
export const PARSED_KEYS = new Set<IntakeFieldKey>(['zip_code', 'annual_income']);

/** 1-based step number for a field key, or null if the key is not an intake field. */
export function getFieldStep(key: IntakeFieldKey | string): number | null {
  const idx = ALL_FIELDS.findIndex((f) => f.key === key);
  return idx === -1 ? null : idx + 1;
}

/** A single answered intake field, safe to show back to the owning session for review/edit. */
export interface IntakeAnswer {
  key: IntakeFieldKey;
  /** Message key for the field's label; resolved where it is displayed. */
  labelKey: string;
  value: string;
  tier: 1 | 2;
}

/**
 * Build the ordered list of answered fields (non-empty values).
 *
 * This is the only place collected vars are surfaced for display, and it is
 * returned exclusively to the owning session (see GET /api/intake) so the user
 * can review and correct what they typed — never to a third party.
 */
export function buildAnswers(vars: RawVars): IntakeAnswer[] {
  const out: IntakeAnswer[] = [];
  for (const f of ALL_FIELDS) {
    const value = (vars as Record<string, string | undefined>)[f.key];
    if (value && value.trim().length > 0) {
      out.push({ key: f.key as IntakeFieldKey, labelKey: f.labelKey, value, tier: f.tier });
    }
  }
  return out;
}

/** Parse and validate an answer for the field currently being asked. */
export function parseIntakeAnswer(
  field: IntakeFieldKey,
  message: string,
): IntakeParseResult {
  switch (field) {
    case 'zip_code':
      return parseZipCode(message);
    case 'annual_income':
      return parseAnnualIncome(message);
    default: {
      const value = message.trim();
      if (!value) {
        return { errorKey: 'intake_error_required' };
      }
      return { value };
    }
  }
}

function parseZipCode(message: string): IntakeParseResult {
  const value = message.trim();
  const match = value.match(/^(\d{5})(?:-\d{4})?$/);

  if (!match) {
    return { errorKey: 'intake_error_zip' };
  }

  return { value: match[1] };
}

function parseAnnualIncome(message: string): IntakeParseResult {
  const compact = message
    .trim()
    .toLowerCase()
    .replace(/[$,\s]/g, '');

  const match = compact.match(/^(\d+(?:\.\d+)?)k?$/);
  if (!match) {
    return {
      errorKey: 'intake_error_income_not_a_number',
    };
  }

  const multiplier = compact.endsWith('k') ? 1000 : 1;
  const amount = Math.round(Number(match[1]) * multiplier);

  if (!Number.isFinite(amount) || amount < 0) {
    return { errorKey: 'intake_error_income_invalid' };
  }

  return { value: String(amount) };
}

/**
 * Extract structured vars from a free-text user message.
 * Does not overwrite existing vars that are already set.
 */
export function parseUserMessage(message: string, existing: RawVars): RawVars {
  const result: RawVars = { ...existing };

  // Opportunistic ZIP extraction is intentionally conservative. Exact field answers
  // should be handled by parseIntakeAnswer using the pending field from the session.
  if (!result.zip_code) {
    const zipMatch = message.match(/\b(\d{5}(?:-\d{4})?)\b/);
    if (zipMatch && !/[$,]\s*\d{5}\b/.test(message)) {
      result.zip_code = zipMatch[1];
    }
  }

// Opportunistic income extraction only recognizes annual household income.
// Monthly income is intentionally unsupported so validation behavior is
// consistent with parseIntakeAnswer().
// Opportunistic income extraction only recognizes annual household income.
// Monthly income is intentionally unsupported.
if (!result.annual_income) {
  const hasMonthlyPeriod =
    /(?:\/\s*mo(?:nth)?|per\s+mo(?:nth)?|monthly)/i.test(message);

  if (!hasMonthlyPeriod) {
    const hasIncomeKeyword =
      /\b(?:income|earn|earning|earns|make|makes|making|salary|wages?|pay|paid|gross|annual|year(?:ly)?|per\s+year)\b/i.test(
        message,
      );

    if (hasIncomeKeyword) {
      const annualMatch = message.match(
        /\$?\s*([\d,]+(?:\.\d+)?)\s*k?\b/i,
      );

      if (annualMatch) {
        const raw = annualMatch[1].replace(/,/g, '');
        const multiplier = annualMatch[0]
          .trim()
          .toLowerCase()
          .endsWith('k')
          ? 1000
          : 1;

        const amount = Math.round(Number(raw) * multiplier);

        if (Number.isFinite(amount) && amount >= 0) {
          result.annual_income = String(amount);
        }
      }
    }
  }
}

  // Household composition may still be extracted from an all-in-one free-text profile.
  if (!result.household_profile) {
    const hasFamily =
      /\b(single\s+parent|family|household|kids?|children|child|spouse|partner|husband|wife|son|daughter)\b/i.test(
        message,
      );
    if (hasFamily) {
      result.household_profile = message.trim();
    }
  }

  return result;
}

/**
 * Returns true when all Tier 1 required fields have non-empty values.
 */
export function isTier1Complete(vars: RawVars): boolean {
  const zipOk = typeof vars.zip_code === 'string' && vars.zip_code.trim().length > 0;
  const incomeOk = typeof vars.annual_income === 'string' && vars.annual_income.trim().length > 0;
  const profileOk =
    typeof vars.household_profile === 'string' && vars.household_profile.trim().length > 0;
  return zipOk && incomeOk && profileOk;
}

/**
 * Return the next unanswered IntakeField for the given tier, or null if all fields answered.
 * Returns null immediately when skipIntake is true.
 */
export function getNextQuestion(
  vars: RawVars,
  currentTier: number,
  skipIntake: boolean,
): IntakeField | null {
  if (skipIntake) return null;

  // Tier 1 first
  for (const field of TIER_1_FIELDS) {
    const value = (vars as Record<string, string | undefined>)[field.key];
    if (!value || value.trim().length === 0) return field;
  }

  // Tier 2 is only reached once all Tier 1 fields are present.
  // currentTier is updated server-side by the intake route when tier 1 is complete.
  if (currentTier < 2) return null;

  // Tier 2
  for (const field of TIER_2_FIELDS) {
    const value = (vars as Record<string, string | undefined>)[field.key];
    if (!value || value.trim().length === 0) return field;
  }

  return null;
}

/**
 * Returns true when the submission repeats the most recent user message.
 * Common answers such as "No" and "None" are never deduplicated because they
 * may legitimately answer consecutive intake questions.
 */
export function isIdempotentSubmission(
  messages: ChatMessage[],
  content: string,
): boolean {
  const normalized = content.trim();
  const normalizedLower = normalized.toLowerCase();

  // Common short answers may legitimately be repeated for consecutive fields,
  // such as "None" for both medications and providers or "No" for coverage
  // and health needs. Never suppress them as duplicate submissions.
  if (normalizedLower === 'no' || normalizedLower === 'none') {
    return false;
  }

  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user');

  return lastUserMessage?.content.trim() === normalized;
}

/**
 * Build a human-readable summary string from populated household vars.
 *
 * @remarks
 * **PII-aggregated output** — the returned string combines ZIP code, income,
 * and household description into a single value. Do NOT log, trace, or send
 * this value to error reporters, analytics services, or any third-party sink.
 *
 * @param vars - Raw session vars (partial HouseholdVars + annual_income).
 * @returns Pipe-delimited enriched profile string, or null when all relevant
 *   fields are absent (empty vars object). Callers must check for null before
 *   overwriting an existing stored value.
 */
export function buildHouseholdProfile(vars: RawVars): string | null {
  const parts: string[] = [];
  if (vars.zip_code) parts.push(`ZIP: ${vars.zip_code}`);
  if (vars.annual_income) {
    const numValue = Number(vars.annual_income);
    const formatted = isNaN(numValue) ? vars.annual_income : numValue.toLocaleString('en-US');
    parts.push(`Income: $${formatted}/year`);
  }
  if (vars.household_profile) {
    // Strip any leading enrichment prefix to prevent double-enrichment when this
    // function is called on a vars object whose household_profile was previously
    // set to a buildHouseholdProfile output (e.g. "ZIP: 77001 | Income: ... | text").
    const rawProfile = vars.household_profile
      .replace(/^(?:ZIP:[^|]*\|\s*)?(?:Income:[^|]*\|\s*)?/, '')
      .trim();
    if (rawProfile) parts.push(rawProfile);
  }
  if (vars.state) parts.push(vars.state);
  return parts.length > 0 ? parts.join(' | ') : null;
}
