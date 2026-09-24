//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

"use client";

/**
 * The Texas application flow: canonical answers in, Form H1010 out.
 *
 * Same shape as the California flow and almost none of the same code, which is
 * the point. What the two share is everything that is genuinely the same
 * problem — the canonical application model, the field plan, the applicant
 * step, the validation rules, the requiredness primitives, the draft endpoint —
 * and what differs is a *configuration* (`lib/form-intake/tx-h1010.ts`) rather
 * than a second implementation.
 *
 * ── Screens ────────────────────────────────────────────────────────────────
 * Programmes → about you → where you live → who lives with you → money → bills
 * → things you own → urgent needs → your situation → someone helping you →
 * review and generate. Each screen is one or two configured sections plus, where
 * the form has a printed table, the list editor that fills it.
 *
 * A screen whose sections are all inapplicable is skipped in both directions,
 * so a healthcare-only household never sees the SNAP expedited screen and never
 * has to press Back through it either.
 *
 * ── Three states, all the way down ─────────────────────────────────────────
 * A question the applicant has not reached is `undefined`, an explicit No is
 * `false`, and a question behind a shut gate is not asked and has no answer at
 * all. The field plan emits nothing for the first and last, so the generated
 * document reports those printed boxes as "not applicable, because…" rather
 * than as work still outstanding. Nothing in this component collapses the
 * three — the moment it did, an applicant would be told they had answered
 * something they had not.
 */

import { useMemo, useRef, useState } from "react";

import { useTranslation } from "@/hooks/use-translation";
import ApplicantStep from "@/components/application/applicant-step";
import ProgramSelectionStep from "@/components/application/program-selection-step";
import IntakeProgress, {
  progressPercent,
} from "@/components/application/intake-progress";
import {
  RequiredMissingNotice,
  continueButtonClass,
} from "@/components/application/required-marker";
import { QuestionField } from "@/components/intake/question-fields";
import { RecordListEditor } from "@/components/intake/record-list";
import RosterStep, {
  missingRosterAnswers,
} from "@/components/texas/roster-step";
import TexasDraftPanel from "@/components/texas/draft-panel";
import { buildInitialApplicationData } from "@/lib/application-data";
import { householdSizeFromMembers } from "@/lib/household";
import {
  askedQuestions,
  missingRecordAnswers,
  missingRequired,
  progress,
  sectionIsAsked,
  type IntakeSection,
} from "@/lib/form-intake/model";
import {
  TX_BILLS,
  TX_H1010_INTAKE,
  TX_JOBS,
  TX_OTHER_INCOME,
  TX_REPRESENTATIVE,
  TX_SECTIONS,
  householdOptions,
  type RecordList,
} from "@/lib/form-intake/tx-h1010";
import { programNameKey } from "@/lib/state-applications";
import type { ApplicationRecommendation } from "@/lib/report-assembler";
import type {
  ApplicationPrefill,
  HouseholdMember,
  Saws2PlusApplicationData,
} from "@/types/application";
import {
  parseFormManifest,
  type FormManifestEntry,
} from "@/types/form-manifest";

type Data = Saws2PlusApplicationData;

export interface ApplicationFlowProps {
  runId: string;
  recommendation: ApplicationRecommendation;
  prefill: ApplicationPrefill | null;
  onBack: () => void;
}

/**
 * One screen of the flow.
 *
 * `sections` names configured sections; `lists` names printed tables. A screen
 * with neither is a bespoke one — programmes, about you, review — and names its
 * own component below.
 */
interface Screen {
  id: string;
  titleKey?: string;
  sections: readonly string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous record types by design
  lists: readonly RecordList<any>[];
}

const SCREENS: readonly Screen[] = [
  { id: "programs", sections: [], lists: [] },
  { id: "applicant", sections: [], lists: [] },
  {
    id: "where",
    titleKey: "tx_screen_where",
    sections: [TX_SECTIONS.mailing, TX_SECTIONS.home],
    lists: [],
  },
  {
    id: "household",
    titleKey: "tx_screen_household",
    sections: [TX_SECTIONS.household],
    lists: [],
  },
  {
    id: "money",
    titleKey: "tx_screen_money",
    sections: [TX_SECTIONS.money],
    lists: [TX_JOBS, TX_OTHER_INCOME],
  },
  {
    id: "bills",
    titleKey: "tx_screen_bills",
    sections: [TX_SECTIONS.bills],
    lists: [TX_BILLS],
  },
  {
    id: "own",
    titleKey: "tx_screen_own",
    sections: [TX_SECTIONS.own],
    lists: [],
  },
  {
    id: "urgent",
    titleKey: "tx_screen_urgent",
    sections: [TX_SECTIONS.urgent],
    lists: [],
  },
  {
    id: "situation",
    titleKey: "tx_screen_situation",
    sections: [TX_SECTIONS.situation],
    lists: [],
  },
  {
    id: "helper",
    titleKey: "tx_screen_helper",
    sections: [TX_SECTIONS.helper],
    lists: [TX_REPRESENTATIVE],
  },
  { id: "review", sections: [], lists: [] },
];

function sectionById(id: string): IntakeSection<Data> {
  const section = TX_H1010_INTAKE.sections.find((entry) => entry.id === id);

  if (!section) throw new Error(`unknown Texas intake section: ${id}`);

  return section;
}

/** Whether a list is editable — its gate open — given the answers so far. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see Screen.lists
function listIsOpen(list: RecordList<any>, data: Data): boolean {
  if (!list.gate) return true;

  const question = TX_H1010_INTAKE.sections
    .flatMap((section) => section.questions)
    .find((entry) => entry.id === list.gate?.questionId);

  return question?.read(data) === list.gate.equals;
}

/** Whether a screen has anything to show this household. */
function screenApplies(screen: Screen, data: Data): boolean {
  if (screen.sections.length === 0) return true;

  return screen.sections.some((id) =>
    sectionIsAsked(TX_H1010_INTAKE, data, sectionById(id)),
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------
//
// Declared at module scope, and that is the whole point rather than a style
// preference.
//
// These two were originally nested inside `TexasApplicationView`. A component
// declared inside another is a *new function on every render*, so React sees a
// different element type, unmounts the previous subtree and mounts a fresh one
// — every input inside it becomes a new DOM node. The browser has nothing left
// to keep focus on, so a household member's name field accepted exactly one
// character before focus was lost.
//
// State was never wrong; identity was. That is why `fill()`-style tests passed
// throughout and only continuous typing in a real browser reproduced it. See
// tests/e2e/tx-household-members.spec.ts.

interface FrameProps {
  answered: number;
  asked: number;
  progressFloor: number;
  children: React.ReactNode;
}

function Frame({ answered, asked, progressFloor, children }: FrameProps) {
  return (
    <div className="space-y-4" data-testid="tx-application">
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-green-700">
            H1010
          </p>
        </div>

        <div className="mt-3">
          <IntakeProgress
            answered={answered}
            asked={asked}
            highWaterMark={progressFloor}
            testId="tx-progress"
          />
        </div>

        {children}
      </div>
    </div>
  );
}

interface NavigationProps {
  onBack: () => void;
  onContinue: () => void;
  complete: boolean;
  showMissing: boolean;
  missing: readonly string[];
}

function Navigation({
  onBack,
  onContinue,
  complete,
  showMissing,
  missing,
}: NavigationProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button
          type="button"
          data-testid="tx-back"
          onClick={onBack}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t("programs_back")}
        </button>

        <button
          type="button"
          data-testid="tx-continue"
          onClick={onContinue}
          className={continueButtonClass(complete)}
        >
          {t("programs_continue")}
        </button>
      </div>

      <RequiredMissingNotice
        show={showMissing}
        testId="tx-missing"
        fields={[...missing]}
      />
    </>
  );
}


export default function TexasApplicationView({
  runId,
  recommendation,
  prefill,
  onBack,
}: ApplicationFlowProps) {
  const { t, tv } = useTranslation();

  const [screenIndex, setScreenIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);

  const [data, setData] = useState<Data>(() => {
    const base = buildInitialApplicationData(prefill);

    return {
      ...base,
      /*
       * Seeded from the screening, and the applicant's to change. A programme
       * we recommended is pre-ticked; one we did not is offered unticked
       * rather than hidden, because a household may know something the
       * screening does not.
       */
      selectedPrograms: recommendation.programs
        .filter((program) => program.recommendedToApply)
        .map((program) => program.program),
    };
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const generationInFlight = useRef(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [guideUrl, setGuideUrl] = useState<string>("");
  const [generationError, setGenerationError] = useState<string | null>(null);

  /*
   * The forms this household needs, as the mapping layer resolved them for
   * this applicant's language. Held rather than recomputed: it describes the
   * packet the document was generated from, and re-deriving it here is how the
   * cards and the PDF get to disagree.
   */
  const [packet, setPacket] = useState<FormManifestEntry[]>([]);

  /** Screens this household actually sees, in order. */
  const screens = useMemo(
    () => SCREENS.filter((screen) => screenApplies(screen, data)),
    [data],
  );

  const screen = screens[Math.min(screenIndex, screens.length - 1)];
  const overall = progress(TX_H1010_INTAKE, data);

  /*
   * The highest progress shown so far, so the bar cannot retreat.
   *
   * Shutting a gate removes its questions from both the numerator and the
   * denominator, and the ratio can fall — answer three of four questions
   * behind a gate, close it, and 75% becomes 50%. Nothing the applicant did
   * was undone, so a smaller number reads as lost work.
   *
   * A ref rather than state: this must not itself cause a render, and it is
   * read during one. See IntakeProgress for why the floor is the caller's.
   */
  const progressFloorRef = useRef(0);
  const currentPercent = progressPercent(overall.answered, overall.asked);

  if (currentPercent > progressFloorRef.current) {
    progressFloorRef.current = currentPercent;
  }

  const progressFloor = progressFloorRef.current;

  // -- completeness ---------------------------------------------------------

  function missingOnScreen(current: Screen): readonly string[] {
    const missing: string[] = [];

    for (const id of current.sections) {
      const section = sectionById(id);

      for (const question of missingRequired(TX_H1010_INTAKE, data, section)) {
        missing.push(t(question.promptKey));
      }
    }

    for (const list of current.lists) {
      if (!listIsOpen(list, data)) continue;

      list.read(data).forEach((record, index) => {
        for (const field of missingRecordAnswers(list.fields, record)) {
          missing.push(
            `${t(list.titleKey)} ${index + 1}: ${t(field.promptKey)}`,
          );
        }
      });
    }

    if (current.id === "household") {
      for (const item of missingRosterAnswers(data.householdMembers)) {
        /*
         * Named by row, because a household of four has four "First name"
         * fields and "First name is missing" would send the applicant looking
         * at all of them.
         */
        missing.push(
          `${tv("intake_row_number", { number: String(item.row) })}: ${t(
            item.labelKey,
          )}`,
        );
      }
    }

    return missing;
  }

  const screenMissing = screen ? missingOnScreen(screen) : [];
  const screenComplete = screenMissing.length === 0;

  function goForward() {
    if (!screenComplete) {
      setShowErrors(true);
      return;
    }

    setShowErrors(false);
    setScreenIndex((index) => Math.min(index + 1, screens.length - 1));
  }

  function goBack() {
    setShowErrors(false);

    if (screenIndex === 0) {
      onBack();
      return;
    }

    setScreenIndex((index) => Math.max(index - 1, 0));
  }

  // -- generation -----------------------------------------------------------

  async function generate() {
    if (generationInFlight.current) return;

    generationInFlight.current = true;
    setIsGenerating(true);
    setGenerationError(null);
    setDraftUrl(null);
    setPacket([]);

    try {
      const response = await fetch(`/api/workflow/${runId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationData: data }),
      });

      const result = (await response.json()) as {
        draftUrl?: string;
        guideUrl?: string;
        packet?: unknown;
        error?: string;
        errorKey?: string;
        fieldProblems?: Array<{ field: string; messageKey: string }>;
      };

      if (!response.ok || !result.draftUrl) {
        if (result.fieldProblems?.length) {
          throw new Error(
            `${t("av_answers_need_correcting")} ${result.fieldProblems
              .map((problem) => t(problem.messageKey))
              .join(" ")}`,
          );
        }

        throw new Error(result.error ?? t("av_draft_failed"));
      }

      setDraftUrl(result.draftUrl);
      setGuideUrl(result.guideUrl ?? `/api/workflow/${runId}/guide`);
      // Parsed rather than trusted: it crossed a process boundary before it
      // crossed the network, and a malformed card must not blank the panel.
      setPacket(parseFormManifest(result.packet));
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : t("av_draft_failed"),
      );
    } finally {
      generationInFlight.current = false;
      setIsGenerating(false);
    }
  }

  // -- screens --------------------------------------------------------------

  if (!screen) return null;

  if (screen.id === "programs") {
    return (
      <ProgramSelectionStep
        formCode="H1010"
        programs={recommendation.programs}
        isSelected={(program) => data.selectedPrograms.includes(program)}
        onToggleProgram={(program) =>
          setData((current) => ({
            ...current,
            selectedPrograms: current.selectedPrograms.includes(program)
              ? current.selectedPrograms.filter((entry) => entry !== program)
              : [...current.selectedPrograms, program],
          }))
        }
        onBack={onBack}
        onContinue={() => setScreenIndex(1)}
      />
    );
  }

  if (screen.id === "applicant") {
    return (
      <ApplicantStep
        formCode="H1010"
        // Texas asks it as a Yes/No with the address beneath, on the next screen.
        showMailingSameCheckbox={false}
        continueLabelKey="intake_continue"
        applicant={data.applicant}
        onChange={(field, value) =>
          setData((current) => ({
            ...current,
            applicant: { ...current.applicant, [field]: value },
          }))
        }
        onHomeAddressChange={(field, value) =>
          setData((current) => ({
            ...current,
            applicant: {
              ...current.applicant,
              homeAddress: { ...current.applicant.homeAddress, [field]: value },
            },
          }))
        }
        onBack={() => setScreenIndex(0)}
        onContinue={() => setScreenIndex(2)}
      />
    );
  }

  if (screen.id === "review") {
    const selected = data.selectedPrograms.map((program) =>
      t(programNameKey(program)),
    );

    return (
      <Frame
        answered={overall.answered}
        asked={overall.asked}
        progressFloor={progressFloor}
      >
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {t("tx_review_heading")}
        </h1>

        <p className="mt-2 text-sm text-slate-600">{t("tx_review_intro")}</p>

        <dl className="mt-5 divide-y divide-slate-100" data-testid="tx-review">
          <div className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-slate-600">{t("tx_review_programs")}</dt>
            <dd className="font-medium text-slate-900">
              {selected.join(", ")}
            </dd>
          </div>

          <div className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-slate-600">{t("tx_review_household_size")}</dt>
            <dd
              data-testid="tx-review-household-size"
              className="font-medium text-slate-900"
            >
              {householdSizeFromMembers(data.householdMembers.length)}
            </dd>
          </div>

          <div className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-slate-600">{t("tx_review_answered")}</dt>
            <dd className="font-medium text-slate-900">
              {tv("tx_progress", {
                answered: String(overall.answered),
                asked: String(overall.asked),
              })}
            </dd>
          </div>
        </dl>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">{t("tx_review_worksheet_note")}</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            data-testid="tx-back"
            onClick={goBack}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("programs_back")}
          </button>

          <button
            type="button"
            data-testid="tx-generate"
            onClick={generate}
            disabled={isGenerating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? t("tx_generating") : t("av_generate_application")}
          </button>
        </div>

        {generationError && (
          <p
            data-testid="tx-generate-error"
            className="mt-4 text-sm text-red-700"
            role="alert"
          >
            {generationError}
          </p>
        )}

        {draftUrl && (
          <TexasDraftPanel
            draftUrl={draftUrl}
            guideUrl={guideUrl}
            packet={packet}
            /*
             * Where the blank official document for a form is served. Built
             * from the form id and nothing else — deliberately not from the
             * locale or a filename, because the route reads the session's own
             * packet to decide which asset that id resolves to. See the route.
             */
            formUrlFor={(formId) =>
              `/api/workflow/${runId}/form/${encodeURIComponent(formId)}`
            }
          />
        )}
      </Frame>
    );
  }

  return (
    <Frame
      answered={overall.answered}
      asked={overall.asked}
      progressFloor={progressFloor}
    >
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">
        {screen.titleKey ? t(screen.titleKey) : ""}
      </h1>

      <div className="mt-5 space-y-6">
        {screen.sections
          .map(sectionById)
          .filter((section) => sectionIsAsked(TX_H1010_INTAKE, data, section))
          .map((section) => (
            <section key={section.id} data-testid={`tx-section-${section.id}`}>
              <h2 className="text-base font-semibold text-slate-900">
                {t(section.titleKey)}
              </h2>

              {section.introKey && (
                <p className="mt-1 text-sm text-slate-600">
                  {t(section.introKey)}
                </p>
              )}

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {askedQuestions(TX_H1010_INTAKE, data, section).map(
                  (question) => (
                    <QuestionField
                      key={question.id}
                      question={question}
                      state={data}
                      onChange={setData}
                      showErrors={showErrors}
                    />
                  ),
                )}
              </div>
            </section>
          ))}

        {screen.id === "household" && (
          <RosterStep
            members={data.householdMembers}
            onChange={(members: readonly HouseholdMember[]) =>
              setData((current) => ({
                ...current,
                householdMembers: [...members],
              }))
            }
            showErrors={showErrors}
          />
        )}

        {screen.lists
          .filter((list) => listIsOpen(list, data))
          .map((list) => (
            <RecordListEditor
              key={list.id}
              list={list}
              records={list.read(data)}
              blank={list.blank}
              showErrors={showErrors}
              maxRows={list.id === TX_REPRESENTATIVE.id ? 1 : undefined}
              people={householdOptions(data)}
              onChange={(records) =>
                setData((current) => list.write(current, [...records]))
              }
            />
          ))}
      </div>

      <Navigation
        onBack={goBack}
        onContinue={goForward}
        complete={screenComplete}
        showMissing={showErrors && !screenComplete}
        missing={screenMissing}
      />
    </Frame>
  );
}

