//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

const CMS_BASE_URL = "https://marketplace.api.healthcare.gov/api/v1";

export type CmsGender = "Male" | "Female";
export type CmsUtilization = "Low" | "Medium" | "High";

export interface MarketplacePerson {
  age: number;
  gender: CmsGender;
  usesTobacco?: boolean;
  aptcEligible?: boolean;
  hasMec?: boolean;
  isParent?: boolean;
  isPregnant?: boolean;
  relationship?: string;
  utilization?: CmsUtilization;
}

export interface MarketplaceSearchInput {
  zipCode: string;
  state: string;
  annualIncome: number;
  people: MarketplacePerson[];
  year?: number;
  limit?: number;
}

export interface MarketplaceCounty {
  fips: string;
  name: string;
  state: string;
}

export interface MarketplacePlanSummary {
  id: string;
  name: string;
  issuerName: string | null;
  metalLevel: string | null;
  planType: string | null;
  premiumBeforeCredit: number | null;
  premiumAfterCredit: number | null;
  deductible: number | null;
  maximumOutOfPocket: number | null;
  benefitsUrl: string | null;
  brochureUrl: string | null;
  qualityRating: number | null;
}

export interface MarketplaceSearchResult {
  available: true;
  county: MarketplaceCounty;
  total: number;
  plans: MarketplacePlanSummary[];
  year: number;
  disclaimer: string;
}

export class CmsMarketplaceError extends Error {
  public readonly status: number;
  public readonly details: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "CmsMarketplaceError";
    this.status = status;
    this.details = details;
  }
}

function getApiKey(): string {
  const apiKey = process.env.CMS_API_KEY?.trim();

  if (!apiKey) {
    throw new CmsMarketplaceError("CMS_API_KEY is not configured.", 503);
  }

  return apiKey;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function cmsFetch(
  pathname: string,
  init?: RequestInit,
): Promise<unknown> {
  const apiKey = getApiKey();
  const separator = pathname.includes("?") ? "&" : "?";
  const url =
    `${CMS_BASE_URL}${pathname}${separator}` +
    `apikey=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const body = await parseResponse(response);

  if (!response.ok) {
    throw new CmsMarketplaceError(
      `CMS Marketplace request failed with status ${response.status}.`,
      response.status,
      body,
    );
  }

  return body;
}

function requireObject(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CmsMarketplaceError(message, 502, value);
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }

  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberValue(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = stringValue(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function getNested(value: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = value;

  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function validateInput(input: MarketplaceSearchInput): void {
  if (!/^\d{5}$/.test(input.zipCode)) {
    throw new CmsMarketplaceError(
      "ZIP code must contain exactly five digits.",
      400,
    );
  }

  if (!/^[A-Z]{2}$/.test(input.state)) {
    throw new CmsMarketplaceError(
      "State must be a two-letter uppercase abbreviation.",
      400,
    );
  }

  if (!Number.isFinite(input.annualIncome) || input.annualIncome < 0) {
    throw new CmsMarketplaceError(
      "Annual income must be a non-negative number.",
      400,
    );
  }

  if (!Array.isArray(input.people) || input.people.length === 0) {
    throw new CmsMarketplaceError(
      "At least one household member is required.",
      400,
    );
  }

  for (const person of input.people) {
    if (!Number.isInteger(person.age) || person.age < 0 || person.age > 120) {
      throw new CmsMarketplaceError(
        "Each household member must have a valid age.",
        400,
      );
    }

    if (!["Male", "Female"].includes(person.gender)) {
      throw new CmsMarketplaceError(
        "Each household member must have a CMS-supported gender value.",
        400,
      );
    }
  }
}

export async function getCountiesByZip(
  zipCode: string,
): Promise<MarketplaceCounty[]> {
  if (!/^\d{5}$/.test(zipCode)) {
    throw new CmsMarketplaceError(
      "ZIP code must contain exactly five digits.",
      400,
    );
  }

  const body = requireObject(
    await cmsFetch(`/counties/by/zip/${encodeURIComponent(zipCode)}`),
    "CMS returned an invalid county response.",
  );

  const rawCounties = Array.isArray(body.counties)
    ? body.counties
    : Array.isArray(body)
      ? body
      : [];

  const counties = rawCounties
    .map((item): MarketplaceCounty | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const county = item as Record<string, unknown>;
      const fips = stringValue(county.fips);
      const name = stringValue(county.name);
      const state = stringValue(county.state);

      if (!fips || !name || !state) {
        return null;
      }

      return { fips, name, state };
    })
    .filter((county): county is MarketplaceCounty => county !== null);

  if (counties.length === 0) {
    throw new CmsMarketplaceError(
      `No CMS county was found for ZIP code ${zipCode}.`,
      404,
      body,
    );
  }

  return counties;
}

function normalizePlan(value: unknown): MarketplacePlanSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const plan = value as Record<string, unknown>;

  const id = firstString(plan.id, plan.plan_id, plan.hios_id);

  const name = firstString(plan.name, plan.plan_name);

  if (!id || !name) {
    return null;
  }

  const issuer = getNested(plan, "issuer") as
    Record<string, unknown> | undefined;

  const deductibles = Array.isArray(plan.deductibles) ? plan.deductibles : [];

  const moops = Array.isArray(plan.moops) ? plan.moops : [];

  const firstDeductible =
    deductibles[0] &&
    typeof deductibles[0] === "object" &&
    !Array.isArray(deductibles[0])
      ? (deductibles[0] as Record<string, unknown>)
      : undefined;

  const firstMoop =
    moops[0] && typeof moops[0] === "object" && !Array.isArray(moops[0])
      ? (moops[0] as Record<string, unknown>)
      : undefined;

  return {
    id,
    name,
    issuerName: firstString(issuer?.name, plan.issuer_name),
    metalLevel: firstString(plan.metal_level, plan.metalLevel),
    planType: firstString(plan.type, plan.plan_type),
    premiumBeforeCredit: firstNumber(
      plan.premium,
      plan.premium_before_credit,
      getNested(plan, "premium", "amount"),
    ),
    premiumAfterCredit: firstNumber(
      plan.premium_w_credit,
      plan.premium_after_credit,
      plan.net_premium,
    ),
    deductible: firstNumber(
      plan.deductible,
      firstDeductible?.amount,
      firstDeductible?.value,
    ),
    maximumOutOfPocket: firstNumber(
      plan.maximum_out_of_pocket,
      plan.max_out_of_pocket,
      firstMoop?.amount,
      firstMoop?.value,
    ),
    benefitsUrl: firstString(plan.benefits_url, plan.benefits_url_en),
    brochureUrl: firstString(plan.brochure_url, plan.brochure_url_en),
    qualityRating: firstNumber(
      plan.quality_rating,
      getNested(plan, "quality_rating", "global_rating"),
    ),
  };
}

export async function searchMarketplacePlans(
  input: MarketplaceSearchInput,
): Promise<MarketplaceSearchResult> {
  const normalizedInput: MarketplaceSearchInput = {
    ...input,
    zipCode: input.zipCode.trim(),
    state: input.state.trim().toUpperCase(),
    year: input.year ?? new Date().getFullYear(),
    limit: Math.min(Math.max(input.limit ?? 5, 1), 10),
  };

  validateInput(normalizedInput);

  const counties = await getCountiesByZip(normalizedInput.zipCode);

  const county =
    counties.find((candidate) => candidate.state === normalizedInput.state) ??
    counties[0];

  if (county.state !== normalizedInput.state) {
    throw new CmsMarketplaceError(
      `ZIP code ${normalizedInput.zipCode} does not match state ${normalizedInput.state}.`,
      400,
      { counties },
    );
  }

  const requestBody = {
    household: {
      income: normalizedInput.annualIncome,
      people: normalizedInput.people.map((person) => ({
        age: person.age,
        aptc_eligible: person.aptcEligible ?? true,
        gender: person.gender,
        uses_tobacco: person.usesTobacco ?? false,
        has_mec: person.hasMec ?? false,
        is_parent: person.isParent ?? false,
        is_pregnant: person.isPregnant ?? false,
        relationship: person.relationship,
        utilization: person.utilization ?? "Medium",
      })),
    },
    market: "Individual",
    place: {
      countyfips: county.fips,
      state: normalizedInput.state,
      zipcode: normalizedInput.zipCode,
    },
    year: normalizedInput.year,
    limit: normalizedInput.limit,
    offset: 0,
    order: "asc",
  };

  const body = requireObject(
    await cmsFetch("/plans/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
    "CMS returned an invalid plan-search response.",
  );

  const rawPlans = Array.isArray(body.plans) ? body.plans : [];

  const plans = rawPlans
    .map(normalizePlan)
    .filter((plan): plan is MarketplacePlanSummary => plan !== null)
    .sort((a, b) => {
      const aPremium =
        a.premiumAfterCredit ?? a.premiumBeforeCredit ?? Infinity;
      const bPremium =
        b.premiumAfterCredit ?? b.premiumBeforeCredit ?? Infinity;

      return aPremium - bPremium;
    })
    .slice(0, normalizedInput.limit);

  return {
    available: true,
    county,
    total: numberValue(body.total) ?? plans.length,
    plans,
    year: normalizedInput.year ?? new Date().getFullYear(),
    disclaimer:
      "Marketplace prices and eligibility are estimates. Verify final eligibility, tax credits, provider networks, prescriptions, and enrollment terms through HealthCare.gov.",
  };
}
