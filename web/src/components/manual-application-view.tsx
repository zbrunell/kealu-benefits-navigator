"use client";

//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * The application view for a state whose form we do not fill.
 *
 * Deliberately not a degraded `ApplicationView`. That component drives the
 * SAWS 2 PLUS questionnaire — a long branching interview whose only purpose is
 * to fill specific boxes on a PDF whose internals we verified. Running it for
 * Texas would ask an applicant forty California-shaped questions and then
 * produce nothing, because there is no verified Texas AcroForm to write into.
 *
 * What a household in that position actually needs is different and smaller:
 * which programs they may qualify for and why, where the official application
 * is, what of their own answers they can copy across, and what they will be
 * asked for that we never collected. That is what this renders, from
 * `buildManualApplicationGuide`.
 *
 * The few inputs here exist only to make the transcription aid worth having: a
 * guide that says "household size: 2" and nothing else saves nobody any effort.
 * Anything left blank simply does not appear — the guide lists what you have,
 * never a column of empty rows.
 */

import { useMemo, useState } from "react";

import { useTranslation } from "@/hooks/use-translation";
import { buildInitialApplicationData } from "@/lib/application-data";
import { buildManualApplicationGuide } from "@/lib/manual-application-guide";
import type { ApplicationRecommendation } from "@/lib/report-assembler";
import {
  applicationForForm,
  type ApplicationChannel,
} from "@/lib/state-applications";
import type { ApplicationPrefill } from "@/types/application";

/** Catalog keys for the agency's filing channels. */
const CHANNEL_KEYS: Readonly<Record<ApplicationChannel, string>> = {
  online: "manual_channel_online",
  phone: "manual_channel_phone",
  in_person: "manual_channel_in_person",
  mail: "manual_channel_mail",
};

interface ManualApplicationViewProps {
  recommendation: ApplicationRecommendation;
  prefill: ApplicationPrefill | null;
  onBack: () => void;
}

/** The contact details worth collecting to make the guide useful. */
interface ContactDraft {
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  street: string;
  apartment: string;
}

const EMPTY_CONTACT: ContactDraft = {
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  phone: "",
  email: "",
  street: "",
  apartment: "",
};

export default function ManualApplicationView({
  recommendation,
  prefill,
  onBack,
}: ManualApplicationViewProps) {
  const { t, tv, tReasons } = useTranslation();
  const [contact, setContact] = useState<ContactDraft>(EMPTY_CONTACT);

  const definition = applicationForForm(recommendation.formId);

  const guide = useMemo(() => {
    if (!definition) return null;

    /*
     * The same builder the tests exercise, fed the same application shape the
     * generated path uses. The contact fields are merged in rather than kept
     * separately so `carriedAnswersFrom` stays the single place that decides
     * what is worth carrying.
     */
    const base = buildInitialApplicationData(prefill);

    const application = {
      ...base,
      applicant: {
        ...base.applicant,
        firstName: contact.firstName,
        middleName: contact.middleName,
        lastName: contact.lastName,
        dateOfBirth: contact.dateOfBirth,
        phone: contact.phone,
        email: contact.email,
        homeAddress: {
          ...base.applicant.homeAddress,
          street: contact.street,
          apartment: contact.apartment,
        },
      },
    };

    return buildManualApplicationGuide(
      definition,
      recommendation.programs,
      application,
    );
  }, [definition, prefill, recommendation.programs, contact]);

  if (!definition || !guide) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h1 className="font-semibold text-red-900">
          {t("shell_rec_unavailable")}
        </h1>

        <button
          type="button"
          onClick={onBack}
          className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800"
        >
          {t("shell_back_to_report")}
        </button>
      </div>
    );
  }

  function update(field: keyof ContactDraft, value: string) {
    setContact((current) => ({ ...current, [field]: value }));
  }

  const field = (
    key: keyof ContactDraft,
    labelKey: string,
    type = "text",
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{t(labelKey)}</span>
      <input
        type={type}
        value={contact[key]}
        onChange={(event) => update(key, event.target.value)}
        data-testid={`manual-${key}`}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </label>
  );

  return (
    <div className="space-y-6" data-testid="manual-application">
      {/* ── Heading ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          {guide.formCode}
        </p>

        <h1 className="mt-2 text-lg font-semibold text-slate-900">
          {t("manual_heading")}
        </h1>

        <p className="mt-1 text-sm text-slate-600">{t(guide.formNameKey)}</p>

        <p className="mt-3 max-w-2xl text-sm text-slate-700">
          {t("manual_intro")}
        </p>

        <a
          href={guide.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="manual-official-link"
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t("manual_open_official_link")}
        </a>

        <p className="mt-3 text-sm text-slate-700">{t(guide.howToApplyKey)}</p>

        <ul className="mt-2 flex flex-wrap gap-2">
          {guide.channels.map((channel) => (
            <li
              key={channel}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700"
            >
              {t(CHANNEL_KEYS[channel])}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Programs ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">
          {t("manual_programs_heading")}
        </h2>

        <div className="mt-4 space-y-3">
          {guide.programs.map((program) => (
            <article
              key={program.program}
              data-testid={`manual-program-${program.program}`}
              className="rounded-lg border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-900">
                  {t(program.nameKey)}
                </h3>

                {program.recommendedToApply && (
                  <span className="rounded-full border border-green-300 bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                    {t("ui_recommended")}
                  </span>
                )}
              </div>

              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {tReasons(program.reasons).map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ul>

              {program.missingInformation.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    {t("programs_info_needed")}
                  </p>

                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-900">
                    {tReasons(program.missingInformation).map((sentence) => (
                      <li key={sentence}>{sentence}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* ── Steps ───────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">
          {t("manual_steps_heading")}
        </h2>

        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {guide.steps.map((step) => (
            <li key={step.key}>
              {step.params ? tv(step.key, step.params) : t(step.key)}
            </li>
          ))}
        </ol>
      </section>

      {/* ── Contact details, to make the carried answers worth having ───── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">
          {t("manual_contact_heading")}
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          {t("manual_contact_intro")}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {field("firstName", "field_first_name")}
          {field("middleName", "field_middle_name")}
          {field("lastName", "field_last_name")}
          {field("dateOfBirth", "field_date_of_birth")}
          {field("phone", "field_phone_number", "tel")}
          {field("email", "field_email", "email")}
          {field("street", "field_street_address")}
          {field("apartment", "field_apartment")}
        </div>
      </section>

      {/* ── Carried answers ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">
          {t("manual_your_answers")}
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          {t("manual_your_answers_intro")}
        </p>

        <dl
          className="mt-4 divide-y divide-slate-100"
          data-testid="manual-carried-answers"
        >
          {guide.carriedAnswers.map((answer) => (
            <div
              key={answer.labelKey}
              className="flex justify-between gap-4 py-2 text-sm"
            >
              <dt className="text-slate-600">{t(answer.labelKey)}</dt>
              <dd className="font-medium text-slate-900">{answer.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── What we never asked for ─────────────────────────────────────── */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="font-semibold text-amber-900">
          {t("manual_still_needed")}
        </h2>

        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
          {guide.notCollected.map((item) => (
            <li key={item.key}>
              {item.params ? tv(item.key, item.params) : t(item.key)}
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {t("shell_back_to_report")}
      </button>
    </div>
  );
}
