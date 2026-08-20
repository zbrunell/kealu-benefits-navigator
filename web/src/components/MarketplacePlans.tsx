'use client';

import { useTranslation } from '@/hooks/use-translation';

import { useEffect, useState } from 'react';

import type {
  MarketplacePlanSummary,
  MarketplaceSearchResult,
} from '@/lib/cms-marketplace';

interface MarketplacePlansProps {

  runId: string;

}

type MarketplaceState =
  | { status: 'loading' }
  | { status: 'success'; result: MarketplaceSearchResult }
  /**
   * `detail` is the API's own diagnostic when it sent one, which is not
   * translated because it does not come from our catalog. The applicant-facing
   * line is resolved at render instead, so it follows a language switch made
   * after the error.
   */
  | { status: 'error'; detail: string | null };

function formatCurrency(
  value: number | null,
  notProvided: string,
  locale: string,
): string {
  if (value === null) {
    return notProvided;
  }

  // The amount is a US dollar premium either way; only the grouping and the
  // symbol's position follow the reader's locale.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function PlanCard({ plan }: { plan: MarketplacePlanSummary }) {
  const { t, locale } = useTranslation();

  const notProvided = t("mkt_not_provided");

  const displayedPremium =
    plan.premiumAfterCredit ?? plan.premiumBeforeCredit;

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{plan.name}</h3>

          {plan.issuerName && (
            <p className="text-sm text-gray-600">{plan.issuerName}</p>
          )}
        </div>

        {plan.metalLevel && (
          <span className="rounded-full border px-3 py-1 text-sm">
            {plan.metalLevel}
          </span>
        )}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-gray-600">
            {t("mkt_premium")}
          </dt>
          <dd className="font-medium">
            {formatCurrency(displayedPremium, notProvided, locale)}
          </dd>
        </div>

        <div>
          <dt className="text-sm text-gray-600">{t("mkt_deductible")}</dt>
          <dd className="font-medium">
            {formatCurrency(plan.deductible, notProvided, locale)}
          </dd>
        </div>

        <div>
          <dt className="text-sm text-gray-600">
            {t("mkt_max_oop")}
          </dt>
          <dd className="font-medium">
            {formatCurrency(plan.maximumOutOfPocket, notProvided, locale)}
          </dd>
        </div>
      </dl>

      {(plan.benefitsUrl || plan.brochureUrl) && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          {plan.benefitsUrl && (
            <a
              href={plan.benefitsUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {t("mkt_view_benefits")}
            </a>
          )}

          {plan.brochureUrl && (
            <a
              href={plan.brochureUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {t("mkt_view_brochure")}
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export default function MarketplacePlans({ runId }: MarketplacePlansProps) {
  const { t, tv } = useTranslation();

  const [marketplace, setMarketplace] =
    useState<MarketplaceState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlans(): Promise<void> {
      setMarketplace({ status: 'loading' });

      try {
        const response = await fetch('/api/marketplace', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
  runId,
  limit: 5,
}),
          signal: controller.signal,
        });

        const body = (await response.json()) as
          | MarketplaceSearchResult
          | { error?: string };

        if (!response.ok) {
          throw new Error('error' in body && body.error ? body.error : '');
        }

        setMarketplace({
          status: 'success',
          result: body as MarketplaceSearchResult,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setMarketplace({
          status: 'error',
          detail:
            error instanceof Error && error.message ? error.message : null,
        });
      }
    }

    void loadPlans();

    return () => controller.abort();
  }, [runId]);

  return (
    <section
      aria-labelledby="marketplace-plans-heading"
      className="rounded-xl border p-6"
    >
      <h2
        id="marketplace-plans-heading"
        className="text-xl font-semibold"
      >
        {t("mkt_heading")}
      </h2>

      <p className="mt-2 text-sm text-gray-600">
        {t("mkt_intro")}
      </p>

      {marketplace.status === 'loading' && (
        <p className="mt-6" role="status">
          {t("mkt_loading")}
        </p>
      )}

      {marketplace.status === 'error' && (
        <div className="mt-6 rounded-lg border p-4" role="alert">
          <p className="font-medium">
            {t("mkt_unavailable")}
          </p>
          <p className="mt-1 text-sm">
            {marketplace.detail ?? t("mkt_load_failed")}
          </p>
        </div>
      )}

      {marketplace.status === 'success' && (
        <>
          <p className="mt-4 text-sm">
            {tv("mkt_showing", {
              shown: marketplace.result.plans.length,
              total: marketplace.result.total,
              county: marketplace.result.county.name,
              state: marketplace.result.county.state,
            })}
          </p>

          {marketplace.result.plans.length === 0 ? (
            <p className="mt-6">
              {t("mkt_none")}
            </p>
          ) : (
            <div className="mt-6 grid gap-4">
              {marketplace.result.plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          )}

          <p className="mt-6 text-xs text-gray-600">
            {marketplace.result.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}
