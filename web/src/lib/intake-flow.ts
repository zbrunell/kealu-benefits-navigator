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

import type { HouseholdVars, ChatMessage } from '@/types/session';

/** Partial HouseholdVars plus the extra `annual_income` runtime variable. */
type RawVars = Partial<HouseholdVars> & { annual_income?: string };

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
  error?: string;
}

/** Definition of a single guided intake question. */
export interface IntakeField {
  /** Key into RawVars / HouseholdVars; used to check whether the field is already answered. */
  key: IntakeFieldKey;
  /** Short human-readable label for this field. */
  label: string;
  /** One-sentence explanation of why this information is needed. Shown below the prompt. */
  rationale: string;
  /** Full text of the question to display to the user. */
  prompt: string;
  /** Preferred keyboard/input mode for the answer field. */
  inputMode?: 'text' | 'numeric';
  /** Optional example shown inside the answer input. */
  placeholder?: string;
  /** Intake tier this field belongs to (1 = required, 2 = optional). */
  tier: 1 | 2;
}

/** Tier 1 fields — minimum required to start research. */
export const TIER_1_FIELDS: IntakeField[] = [
  {
    key: 'zip_code',
    label: 'ZIP Code',
    rationale: 'We use your ZIP code to find plans and benefit programs available where you live.',
    prompt:
      'Hi! I can help you find health insurance and benefit programs for your household.\n\n' +
      'I’ll ask a few short questions. Your answers stay private, and you do not need an account.\n\n' +
      'What is your ZIP code?',
    inputMode: 'numeric',
    placeholder: '19020',
    tier: 1,
  },
  {
    key: 'annual_income',
    label: 'Annual Household Income',
    rationale: 'We use this to estimate which programs, discounts, and tax credits your household may qualify for.',
    prompt: 'What is your household’s total yearly income before taxes?',
    inputMode: 'numeric',
    placeholder: '42000',
    tier: 1,
  },
  {
    key: 'household_profile',
    label: 'Household Members',
    rationale: 'Household size and ages affect eligibility and benefit amounts.',
    prompt:
      'Who should be included in your benefits household?\n\n' +
      'Include yourself, your spouse, and anyone you claim as a tax dependent. Add each person’s age and mention pregnancy, disability, or veteran status.\n\n' +
      'Example: Two adults, ages 32 and 30, and two children, ages 4 and 8.',
    tier: 1,
  },
];

/** Tier 2 fields — improve plan matching quality. */
export const TIER_2_FIELDS: IntakeField[] = [
  {
    key: 'current_coverage',
    label: 'Current Health Insurance',
    rationale: 'This helps us understand whether you need new coverage or help with your current plan.',
    prompt:
      'Do you currently have health insurance?\n\n' +
      'Tell us where it comes from, such as an employer, Medicaid, Medicare, or COBRA. You can also answer “No.”',
    tier: 2,
  },
  {
    key: 'medications',
    label: 'Prescription Medications',
    rationale: 'This helps us look for plans that cover the medicines your household uses.',
    prompt:
      'Does anyone in your household take prescription medication regularly?\n\n' +
      'List the medication names, or answer “None.”',
    tier: 2,
  },
  {
    key: 'providers',
    label: 'Doctors and Specialists',
    rationale: 'This helps us look for plans that include the doctors and clinics you want to keep.',
    prompt:
      'Are there any doctors, specialists, clinics, or hospitals you want to keep using?\n\n' +
      'List their names, or answer “None.”',
    tier: 2,
  },
  {
    key: 'premium_budget',
    label: 'Monthly Budget',
    rationale: 'This helps us focus on plans your household can realistically afford.',
    prompt:
      'What is the most your household can afford to pay each month for health insurance?\n\n' +
      'Enter an amount, or answer “As low as possible.”',
    tier: 2,
  },
  {
    key: 'health_needs',
    label: 'Health Care Needs',
    rationale: 'This helps us match your household with coverage that fits the care you expect to need.',
    prompt:
      'Does anyone in your household have ongoing health needs or care planned soon?\n\n' +
      'For example: chronic conditions, therapy, pregnancy care, surgery, or frequent doctor visits. You can also answer “No.”',
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
  label: string;
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
      out.push({ key: f.key as IntakeFieldKey, label: f.label, value, tier: f.tier });
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
        return { error: 'Please enter an answer.' };
      }
      return { value };
    }
  }
}

function parseZipCode(message: string): IntakeParseResult {
  const value = message.trim();
  const match = value.match(/^(\d{5})(?:-\d{4})?$/);

  if (!match) {
    return { error: 'Enter a valid 5-digit ZIP code. For example: 19020.' };
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
      error: 'Enter your yearly household income using numbers only. For example: 42000.',
    };
  }

  const multiplier = compact.endsWith('k') ? 1000 : 1;
  const amount = Math.round(Number(match[1]) * multiplier);

  if (!Number.isFinite(amount) || amount < 0) {
    return { error: 'Enter a valid yearly household income.' };
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
