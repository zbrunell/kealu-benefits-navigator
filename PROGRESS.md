# Progress — Texas official forms and packet planning

**Checkpoint date:** 2026-09-24 (§12); earlier checkpoints 2026-09-03 and 2026-09-04
**Branch:** `feat/saws2-required-fields-and-guide`
**HEAD:** `6d28514 fix(web): show a readable message when the draft request cannot reach the server`
**Working tree:** clean apart from this file and `CLAUDE.md`; nothing pushed
**Status:** Texas official-forms milestone committed, H1010 cut over to HHSC's
own document, two browser bugs fixed. **Start at §12**; §1–§11 are the record
of earlier checkpoints, and the RESUME prompt in the middle is out of date.

> **The 2026-09-03 handoff below is superseded in one important respect.** It
> recorded that HHSC's H1010 PDF could not be obtained and recommended
> continuing to try. **It has been obtained** — both official editions, by hand,
> through the Your Texas Benefits paper-form catalog, on 4 September 2026. §11
> at the end of this file records what was built on top of it, what the
> documents turned out to be, and what remains. Read `docs/texas-forms.md`
> first; it is the design document for all of it.

An Austin household can now start at a Texas report, work through Texas-specific
screens, and download a filled Form H1010 worksheet carrying their own answers.
Before this work the same household reached a transcription guide and stopped.

---

## 1. What was implemented

Two milestones, both finished and committed.

### Milestone A — the mapping layer (Python)

Texas H1010 went from "the architecture is demonstrated" to a realistically
usable generated document.

- **H1010 coverage: 38 → 154 mappings** across 13 sections and 5 pages.
- **Four new architecture primitives**, all jurisdiction-neutral:
  - `Condition` — a gateway answer that makes a printed box *not applicable*
    rather than *missing*, carrying the reason to the review sheet.
  - `RepeatingGroup` (`formmap/repeat.py`) — a printed table drawn from a
    canonical indexed collection, with presence markers and overflow counting.
  - `FieldMapping.alternate_keys` — one printed box, several canonical homes
    (the household table's sex column reads `adult.sex` *or* `child.sex`).
  - `FieldMapping.optional` — a box a blank answer completes.
- **New transforms:** `humanize` (`rent_or_mortgage` → `Rent or mortgage`),
  `yes_no_text` (a boolean as a printed word, not a CHOICE option key).
- **`form_filler.generate_application` routes by state** through the formmap
  registry, so Texas is a data lookup rather than a code path. California is
  still checked first and by name, because filling native AcroForm fields is a
  genuinely different job the mapping layer describes but does not do.
- **Review sheet** rewritten: filled / optional / not-applicable-because / too
  long for its box / overflow, grouped by the form's own sections.

### Milestone B — the intake (TypeScript/React)

- **Texas is `generated`** in `state-applications.ts`. `manual` is still modeled
  and tested, but no state uses it today.
- **A jurisdiction-neutral question model** (`web/src/lib/form-intake/model.ts`):
  sections, questions, gates, three-state answers, requiredness, progress, and a
  structural validator. It knows nothing about Texas.
- **The Texas question set as configuration** (`form-intake/tx-h1010.ts`): 40
  questions across 9 sections plus 4 repeating lists (jobs, other income, bills,
  representative) and the household roster. Every question exists because an
  H1010 mapping reads the canonical field it writes.
- **Shared renderers** (`components/intake/`): one question field of any kind,
  one record-list editor, one tri-state control with an explicit way back to
  unanswered.
- **The Texas flow** (`components/texas/`): 11 screens, with screens skipped in
  both directions when nothing on them applies.
- **Components generalised rather than duplicated:** `ApplicantStep` (now takes
  `formCode`, `showMailingSameCheckbox`, `continueLabelKey`) and
  `ProgramSelectionStep` (now generic over `BenefitProgramId`) serve both states.
- **The guide route serves the generator's review sheet** for any document the
  mapping layer rendered, and California's computed completion guide otherwise.
- **127 new message keys in all three catalogues** (en / es / zh-CN).

**Canonical schema changes — two, both jurisdiction-neutral, no H1010-named
fields:**

1. `selectedPrograms` widened from California's three programmes to
   `BenefitProgramId`. Before this, `programs.tx_snap` could not be emitted no
   matter what an applicant ticked.
2. Every indexed collection now emits `<collection>.<n>.present`, not only
   household members — so a printed table can tell "no fourth job" from "a
   fourth job we know nothing about".

---

## 2. Architectural decisions that must be preserved

These are load-bearing. Breaking one produces a wrong answer on a government
form, not a test failure.

1. **The document is a worksheet, not HHSC's paper.** HHSC publishes H1010 only
   through a web application (re-verified 30 Aug 2026; `fhb.hhs.texas.gov` links
   to `yourtexasbenefits.com/Learn/GetPaperForm`, and direct file paths 403/404).
   `GeneratedForm.is_official_document` is `False`, page 1 says so, the review
   sheet leads with it, and the review screen says it before you generate.
   `delivery: 'generated'` means "we fill a form", **not** "it is the agency's
   own paper" — those are different facts and the second lives on the document.
2. **Three states stay distinct, everywhere.** `undefined` (never asked),
   `false` (an explicit No), and not-asked-because-a-gate-is-shut. Truthiness
   checks are how an explicit No becomes an unanswered question.
3. **Gates resolve in opposite directions on purpose.** In the *intake*, an
   unanswered gate is shut (a follow-up must not appear above the question that
   introduces it). In the *mapping layer*, an unanswered gateway suppresses
   nothing (it must never discard an answer the applicant gave). Both rules are
   documented at their definitions; do not "harmonise" them.
4. **Sensitive fields are refused structurally, twice.** SSNs, alien/immigration
   document numbers, bank and account numbers, driver's licence numbers and
   signatures have no question in the intake and no mapping on the form. The
   refusal is the absence of a field, not a filter that could be bypassed.
5. **The shared formmap layer branches on nothing.** `definition`, `targets`,
   `transforms`, `textfit`, `render`, `repeat` and `pipeline` contain no
   comparison against a form id, state code or programme name. A test reads
   their syntax trees and fails if one appears. `registry` is the only module
   allowed to name the forms.
6. **`registry.form_id_for_state` answers without building anything.** Asking
   which form a Texas household files must not import California's 5,000-line
   generator or pypdf. A subprocess test pins that.
7. **Read/write accessors, never path strings.** An intake question carries
   typed `read`/`write` functions so a wrong destination is a compile error.
8. **Requiredness is semantic.** A question is required because an eligibility
   rule or a printed box is wrong without it — never because H1010 has a box.
   The asterisk and the check that blocks Continue read the same field.
9. **The scenario fixtures are built through the intake configuration's own
   `write` functions.** That is what makes "the browser flow produces the plans
   the mapping tests render" true by construction rather than by coincidence.
10. **Presence is stated, never inferred.** Discovering table rows by probing
    for a non-empty value stops at the first gap and drops everyone after it.

---

## 3. Tests: what exists and what it guarantees

### Python (`tests/`)

| File | Tests | Guarantee |
|---|---:|---|
| `test_formmap_mapping.py` | 80 | Canonical key → target and rendered string, with no PDF involved. |
| `test_formmap_primitives.py` | 26 | `Condition`, `RepeatingGroup`, `alternate_keys`, `optional` — asserted against forms invented in the test, so form #3 inherits them. |
| `test_formmap_generation.py` | 52 | The bytes open, values are in the content stream, nothing sensitive reaches the page. |
| `test_formmap_h1010_scenarios.py` | 84 | Four Austin households driven from the TS-emitted plans: every resolved value drawn **inside its own declared box**; no drawn text overlaps any other text or printed label; overflow reported; conditional blocks blank or filled correctly; four committed golden review sheets. |
| `test_formmap_jurisdiction_isolation.py` | 53 | State→form routing; neither form maps the other's keys; the AST check that shared modules never branch on a jurisdiction; the subprocess check that Texas selection loads no California module. |
| `test_formmap_saws2_parity.py` | 20 | The SAWS description cannot drift from the live adapter. |

Two of these are the cross-runtime contract:

- `test_every_h1010_mapping_can_be_reached_from_the_texas_intake` — reads
  `web/tests/fixtures/tx-intake-canonical-keys.json` and asserts H1010 reads
  nothing an applicant cannot supply. **`UNREACHABLE_FROM_THE_INTAKE` is empty,
  and that emptiness is the assertion.**
- `test_the_review_sheet_matches_its_committed_copy` — golden files for the
  applicant-facing text. Regenerate with `UPDATE_REVIEW_SHEETS=1 pytest`.

### TypeScript (`web/tests/`)

| File | Tests | Guarantee |
|---|---:|---|
| `unit/tx-intake.test.ts` | 26 | The model's three-state and gating rules against non-Texas toy forms; then Texas branching, requiredness (listed explicitly, so adding one is a decision someone reads), roster detail routing, and that every prompt resolves in en/es/zh-CN. |
| `unit/tx-intake-coverage.test.ts` | 3 | Emits the canonical keys the Texas screens can produce, by answering everything and running the production mapper. |
| `unit/tx-h1010-scenarios.test.ts` | 24 | Emits `tx-h1010-scenarios.json`; asserts Texas programmes only, no sensitive keys, determinism, presence markers. |
| `unit/texas-application.test.ts` | 35 | Texas routes to a `generated` application; the `manual` kind still works against a synthetic definition. |
| `e2e/tx-h1010-application.spec.ts` | 9 | The six required browser cases: single-adult SNAP, multi-programme family, gateway exclusion, authorized representative, incomplete-required-field, and the download/review path. |

Regenerate committed fixtures with `UPDATE_SCENARIOS=1`.

---

## 4. Bugs found and fixed

Found by rendering pages and by reading the output, not by a failing assertion:

1. `yes` printed literally in the household table's citizenship column — a
   CHOICE option key reaching a text box. → `yes_no_text`.
2. The roster's canonical enum printed as `spouse` on a government form. →
   `humanize` on the relationship column.
3. Long Yes/No questions ran straight through the Yes box. → questions wrap and
   the row grows.
4. Table headers collided (`Gross this month ($)How often paid`). → headers are
   measured and shrunk to their own column.
5. Section headings printed twice, once for the section and once for its table.
6. The mailing block split across a page break, arriving with no heading.
7. The review sheet enumerated all 84 blank table cells for a one-person
   household. → collapsed to a count per table.
8. **The report printed "California benefits application / SAWS 2 PLUS
   application"** over a Texas household's recommendations — invisible while
   Texas was `manual`.
9. Downloads were named `partially-prefilled-SAWS-2-PLUS-draft.pdf` whatever the
   state.
10. The guide route served California's raw review file instead of its computed
    completion guide, because the helper *discovered* a sibling `.review.txt`
    rather than being told one existed. The generator now reports it.
11. Three untranslated English programme-name maps in components; the roster's
    "missing answers" notice emitted raw field ids (`1: first_name`) to screen.

---

## 5. Current test counts (verified 2026-09-03 on `fd619d8`)

| Suite | Result |
|---|---|
| Python (`pytest`) | **1016 passed**, 3 deselected |
| Vitest | **1937 passed** (78 files) |
| Playwright | **81 passed** (2 projects) |
| `tsc --noEmit` | 0 errors |
| `eslint src --max-warnings=0` | clean |

Growth across the two milestones: Python 852 → 1016, Vitest 1881 → 1937,
Playwright 73 → 81.

One known flake: `e2e/error-recovery.spec.ts › error banner shows a correlation
ID` failed once in a full-suite run and passed in isolation and on re-run. It is
unrelated to this work.

---

## 6. Why `household.california_resident` was deliberately not renamed

The instruction was to rename it **only if** the Texas intake exposed why the
name had become structurally harmful. It did not:

- The Texas question set does not ask about state residency at all — the state
  is already resolved from the ZIP, so asking is redundant.
- No Texas code reads or writes `circumstances.californiaResident`.
- H1010 correctly leaves `household.california_resident` unmapped, and
  `test_a_california_answer_reaching_texas_is_reported_not_rendered` pins that
  it lands in `unmapped` rather than on the page.

Renaming would have been a five-file churn (questionnaire field, planner, schema
table, three message catalogues, the SAWS adapter and its tests) justified by
nothing this milestone learned. It remains on the debt list: the neutral name is
`household.resident_of_application_state`, and the trigger to do it is a second
state that actually needs to ask the question.

---

## 7. Remaining blockers before Austin counselor validation

1. **The document is a worksheet, not HHSC's form.** Everything says so, but a
   counselor will still be transcribing into YourTexasBenefits. **This is the
   highest-value remaining item** — see §8.
2. **The intake conversation upstream is still California-shaped.** ZIP, income
   and household profile work, but nothing asks a Texas household about
   pregnancy or caretaker status *before* screening — which is where Texas's
   categorical Medicaid actually turns.
3. **No save/resume.** Eleven screens in one session, lost on reload.
4. **The Spanish and Chinese Texas copy is machine-authored** and has not been
   reviewed by a native speaker or a benefits counselor — the standard the SAWS
   Spanish edition was held to.
5. **Self-employment income is a gateway with no detail rows.** A self-employed
   household answers Yes and the form carries nothing further.
6. **A table cell cannot wrap.** A 61-character employer name is reported as too
   long rather than printed at a smaller size across two lines.

---

## 8. Recommended next task

**Obtain and integrate the real HHSC Form H1010 PDF.**

Everything else is downstream of it, and the architecture was built so this is a
*data change rather than a rewrite*:

1. Drop the file into `src/benefits_navigator/formmap/forms/TX-H1010.pdf`.
2. In `formmap/forms/h1010.py`, set `base_document="TX-H1010.pdf"` and
   `page_count` to its real count.
3. Replace the `Box` in each mapping with the measured one. If the PDF turns out
   to carry usable AcroForm fields, swap `OverlayTarget` for `AcroFormTarget`
   per field — the distinction is already per-field, not per-form.

The canonical keys, transforms, field kinds, fitting behaviour, review sheet,
intake configuration and every test keep working untouched.
`is_official_document` flips to `True` on its own, which changes the wording on
the review screen, the review sheet and the download filename.

**Acquisition is the hard part, not the code.** Programmatic fetching has failed
repeatedly and was re-verified on 30 Aug 2026 (see the docstring in
`formmap/forms/h1010.py` for exactly what was tried). Likely routes: request the
form directly from HHSC; obtain a printed copy from a Travis County benefits
office and scan it; or ask a partner organisation such as Central Texas Food
Bank. **Do not reconstruct it from a third-party form-filling site** — those
copies are re-typed and their box positions are not the agency's.

Second choice, if the PDF cannot be obtained: blocker #2 (a Texas-shaped intake
conversation), because it changes the screening result rather than the paper.

---

## 9. Verifying the repo is still green

Run from the repository root. Each is independent.

```bash
# Python — the mapping layer, generation, jurisdiction isolation
.venv/bin/python -m pytest -q
# expect: 1016 passed, 3 deselected

# TypeScript type check and lint
cd web && npx tsc --noEmit           # expect: no output
cd web && npx eslint src --max-warnings=0   # expect: no output

# Vitest — unit, api and integration
cd web && npx vitest run --reporter=dot
# expect: 1937 passed (78 files)

# Playwright — starts its own dev servers on :3000 and :3101
cd web && npx playwright test --reporter=line
# expect: 81 passed  (~1.5 min)

# Just the Texas browser flow, while iterating
cd web && npx playwright test --project=applications tx-h1010-application --reporter=line
```

Regenerating committed fixtures — **read the diff before accepting**:

```bash
cd web && UPDATE_SCENARIOS=1 npx vitest run tests/unit/tx-h1010-scenarios.test.ts
cd web && UPDATE_SCENARIOS=1 npx vitest run tests/unit/tx-intake-coverage.test.ts
UPDATE_REVIEW_SHEETS=1 .venv/bin/python -m pytest tests/test_formmap_h1010_scenarios.py
```

Rendering the Texas document to look at it:

```bash
.venv/bin/python - <<'PY'
import json, pathlib
from benefits_navigator.formmap import generate_form, canonical_values_from_field_plan
out = pathlib.Path("/tmp/h1010"); out.mkdir(exist_ok=True)
for sc in json.load(open("web/tests/fixtures/tx-h1010-scenarios.json")):
    g = generate_form("TX_H1010", canonical_values_from_field_plan(sc["fieldPlan"]))
    g.write(out / f"{sc['id']}.pdf")
    print(sc["id"], g.page_count, "unfitted:", g.render_plan.unfitted)
PY
pdftoppm -png -r 110 /tmp/h1010/austin_family_of_four.pdf /tmp/h1010/fam   # then read the PNGs
```

---

## 10. Files to inspect first

**Read these before changing anything.** Each carries its reasoning in its own
docstring; the docstrings are the design record, not decoration.

Start here:

- `docs/h1010-mapping-audit.md` — what H1010 maps, what stays blank and why,
  what we deliberately never collect, and what a third form would take.
- `docs/jurisdictions.md` — how a location decides which programs exist, and the
  seven steps to add a jurisdiction.

The mapping layer (Python):

- `src/benefits_navigator/formmap/__init__.py` — the layer's map.
- `src/benefits_navigator/formmap/definition.py` — `FieldMapping`, `Condition`,
  `resolve_mappings`. **The place mapping correctness is asserted.**
- `src/benefits_navigator/formmap/forms/h1010.py` — the Texas form: layout,
  sections, tables, and the record of why we hold no official PDF.
- `src/benefits_navigator/formmap/repeat.py`, `targets.py`, `transforms.py`,
  `render.py`, `textfit.py`, `registry.py`, `pipeline.py`.
- `src/benefits_navigator/form_filler.py` — the routing entry point.

The intake (TypeScript):

- `web/src/lib/form-intake/model.ts` — the neutral question model.
- `web/src/lib/form-intake/tx-h1010.ts` — the Texas question set.
- `web/src/components/texas/texas-application-view.tsx` — the 11 screens.
- `web/src/components/intake/` — the shared renderers.
- `web/src/lib/state-applications.ts` — which state files which form.
- `web/src/components/app-shell.tsx` — `APPLICATION_FLOWS`, the composition root
  and the only place allowed to know which flow fills which form.
- `web/src/lib/application-mapper.ts` — application data → canonical field plan.

Cross-runtime fixtures (committed, compared, never silently regenerated):

- `web/tests/fixtures/tx-h1010-scenarios.ts` / `.json`
- `web/tests/fixtures/tx-intake-canonical-keys.json`
- `tests/fixtures/h1010-*.review.txt`

Deliberately untouched — **do not refactor casually**:

- `src/benefits_navigator/pdf_generator.py` (4,900 lines, California's
  native-field generator, reviewed destination allowlist)
- `web/src/lib/saws2-*.ts`, `web/src/components/application/questionnaire-step.tsx`

---

## RESUME

Paste into a fresh Claude Code session:

> Continue the Kealu Benefits Navigator. Read `PROGRESS.md` at the repo root
> first — it is the handoff from the completed Texas H1010 milestone and records
> the architectural decisions that must be preserved.
>
> State: branch `feat/saws2-required-fields-and-guide`, HEAD `fd619d8`, clean
> tree, nothing in flight. Python 1016 passed, Vitest 1937 passed, Playwright 81
> passed, `tsc --noEmit` and ESLint clean as of 2026-09-03. Verify that before
> starting, using the commands in §9.
>
> Your task is the recommended next step in §8: **obtain and integrate the real
> HHSC Form H1010 PDF**, so the Texas document becomes the agency's own paper
> with the applicant's answers on it instead of a Navigator-authored worksheet.
>
> 1. Try to acquire the PDF. Programmatic fetching has failed repeatedly and was
>    re-verified on 30 Aug 2026 — read the "What we hold, and what we do not"
>    section of `src/benefits_navigator/formmap/forms/h1010.py` for exactly what
>    was tried before repeating it. Do not reconstruct the form from a
>    third-party form-filling site; those copies are re-typed and their box
>    positions are not the agency's.
> 2. **If you obtain it:** inspect it (page count, whether it carries a usable
>    AcroForm, and where each box sits). Then set `base_document` and
>    `page_count`, and replace each mapping's `Box` with the measured one —
>    per field, swapping `OverlayTarget` for `AcroFormTarget` wherever the PDF
>    has a real field. Render every scenario, rasterise the pages, and *look at
>    them* before believing any of it. Keep all 154 mappings reachable and keep
>    California untouched.
> 3. **If you cannot obtain it:** stop, write down precisely what you tried and
>    what each attempt returned, update the provenance section of
>    `h1010.py` and `docs/h1010-mapping-audit.md`, and then move to blocker #2
>    in §7 — a Texas-shaped intake conversation that asks about pregnancy and
>    caretaker status before screening, since that changes the screening result
>    rather than the paper.
>
> Do not begin a third form. Do not rename `household.california_resident` — §6
> explains why. Run the full Python, Vitest, Playwright, `tsc --noEmit` and
> ESLint suites before you stop, and report before/after test counts.

---

## 11. Texas official forms and packet planning (2026-09-04)

This section supersedes §8's recommendation and corrects §2.1 and §7.1.

### 11.1 The premise that changed

§8 said "acquisition is the hard part" and recommended requesting the form from
HHSC or scanning a county-office copy. That was solving a harder problem than
the one in front of it. Your Texas Benefits publishes a **"Get a paper form"
catalog**, and a person can click through it and download the real documents.
Five were obtained that way on 4 September 2026.

Every retrieval attempt §8 recorded still fails, with one correction worth
passing on: `fhb.hhs.texas.gov/sites/default/files/...` answers **200 with an
Akamai "Access Denied" HTML body**. A script checking the status code alone will
write 199 KB of HTML into `forms/`. Check the magic bytes.

The catalog still cannot be *enumerated* programmatically — it is an AngularJS
app that fetches its list client-side — so adding a form remains a manual
download plus a provenance record.

### 11.2 What the documents actually are

The starting brief supplied a language-availability table. Verifying it against
the files changed three things:

| Expected | Actually |
|---|---|
| H1049 has English and Spanish editions | **One bilingual document.** The catalog's Spanish download is byte-identical to its English one (`c36e0710…`), and the content is English/Spanish throughout |
| H3037 has English and Spanish editions | **One bilingual document** (`8b9c6704…`), same evidence |
| "H1028 — employment verification" | The file is **H1028-MBIC**, a different form: employer verification for *Medicaid Buy-In for Children* only. The general H1028 is an HHSC-internal fallback used "when TIERS is down", with staff completing page 1 — not an applicant deliverable |
| H1010 has English and Spanish editions | **True.** Two real files, two layouts. HHSC designates the Spanish one **H1010-S** |

Two assets also disagree with HHSC's current effective dates:

- **H1028-MBIC prints 12/2015; HHSC's index says 9/2024.** Treated as
  **superseded** — registered in the catalog so a packet can be honest the form
  exists, barred from being a production base document (`fillable=False`).
- **H1049 prints 12/2001; HHSC's index says 12/2015.** Recorded as
  **unresolved**: HHSC pages routinely carry an effective date for the
  *procedure* while the printed form keeps its footer, and retrieving HHSC's
  copy to compare was blocked.

And the discovery that decided the whole rendering approach: **all three
fillable PDFs are XFA forms whose AcroForm layer is nearly empty.** H1010
English has three usable text fields across 34 pages; H1010 Spanish has **none**.
The application pages say "Please use dark ink. Please print. Fill in the
circles." `AcroFormTarget` is not a route for any Texas form; everything is
overlaid.

### 11.3 What was built

All jurisdiction-neutral except the three `forms/tx_*` modules.

| Module | What it owns |
|---|---|
| `formmap/provenance.py` | `OfficialDocument` — hash, both revisions, languages, fillability, source, retrieval date. Refuses to open a file whose bytes changed |
| `formmap/documents.py` | `DocumentVariant`, `resolve_document` — which official *edition* an applicant is handed, and why |
| `formmap/packet.py` | `PacketContext`, `CatalogEntry`, `plan_packet` — which *forms* belong in a household's packet, with reasons |
| `formmap/measure.py` | Anchors and placements: boxes derived from text the document prints |
| `formmap/measurements.py` | Committed measurements, refused if their digest does not match the document |
| `tools/measure_texas_forms.py` | Resolves anchors offline; `--check` fails if committed output is stale |
| `formmap/forms/tx_documents.py` | The five official documents, with provenance |
| `formmap/forms/tx_catalog.py` | Applicability rules, each citing HHSC guidance |
| `formmap/forms/h1010_official.py` | H1010 on both official editions |
| `formmap/forms/h3037.py` | H3037, complete |

Extended in place: `Responsibility` and `DeclaredBlank` (definition.py),
`Segment` and `also_draw_at` (targets.py), segment rendering (render.py),
per-state application lookup and build-time variant validation (registry.py).

**The formmap layer still branches on nothing** — the AST test that forbids a
form id or state code in the shared modules passes unchanged.

### 11.4 Coordinates are anchored, not pasted

`Above(Anchor("First name", page=5))` reads as "the writing line above the words
*First name*". The form's own labels also define its column widths. Anchors
resolve offline into committed JSON keyed by the document's SHA-256.

That closes the brief's requirement 12 with **two** independent checks: a new
PDF fails the provenance digest; updating that digest without re-measuring fails
the measurement digest. Neither can be skipped quietly.

It also caught a real bug during development: two `/` separators on the Spanish
birth-date template differ in y by 0.06 points, so ordering strictly by y put
the *right-hand* slash first and the date's cells came out reversed. Reading
order is now quantised to a 3-point row tolerance, and a test asserts both
editions produce the same box count per field.

### 11.5 Why H1010 was *not* cut over

> **Superseded.** H1010 has since been cut over: `TX_H1010` now builds
> `h1010_official` (115 fields on each edition), the worksheet is registered as
> `TX_H1010_WORKSHEET` as a supplement, and `h1010_worksheet_keys` is gone,
> replaced by `h1010_coverage`. See `docs/texas-forms.md` §9. The text below is
> kept as the record of the 2026-09-04 checkpoint.

The official H1010 is registered as **`TX_H1010_OFFICIAL`**. `TX_H1010` — the
worksheet — is **still what a Texas household is served**, deliberately.

The official definition places 29 of the 154 canonical answers: printed pages
1–3 (PDF pages 5–7), verified page by page in both languages. Pages 4–21 are not
anchored. A government form with three pages filled and eighteen blank is worse
for an applicant than a worksheet carrying every answer they gave, so the
cutover waits until `h1010_worksheet_keys.WORKSHEET_ONLY_KEYS` is empty. That
list — 127 keys — is the remaining work, and each variant carries it as
`deferred_keys` so the review sheet can name the answers still to be copied.

§2.1 stays true meanwhile: the served document is a worksheet,
`is_official_document` is `False`, and everything says so.

### 11.6 Canonical schema changes

Two added, one identified. Neither added field is named after a form.

- **`household.pregnancy.person_name`** — H1010 Section C asks "If yes, who?"
  and H3037 asks it twice. One intake answer, three printed boxes, two forms.
- **`household.pregnancy.due_date`** — asked by H1010 Section C. Deliberately
  *not* printed on H3037, where the same fact sits above a clinician's signature
  attesting to it. Responsibility is per printed field, not per fact.
- **`income.self_employment.*`** — identified, not added. H1049 needs the person,
  months covered, work description and an expense/income ledger; today
  self-employment is a gateway boolean with no detail rows (§7 blocker 5).

**Neither pregnancy field is reachable from the Texas intake yet.** Adding those
two questions is a prerequisite for the cutover, because every mapped key must
be reachable from an intake path.

### 11.7 Test counts

| Suite | Before | After |
|---|---|---|
| Python | 1016 passed | **1077 passed**, 3 deselected |
| Vitest | 1937 passed (80 files) | **1937 passed** (unchanged — no `web/` source changed) |
| Playwright | 81 passed | **79 passed, 2 failed** — see below |
| `tsc --noEmit` | clean | clean |
| ESLint | clean | clean |

The two Playwright failures — `intake-to-report.spec.ts:331` and
`report-rendering.spec.ts:131` — **reproduce identically on a clean worktree at
HEAD** and are unrelated to this work, which touched no file under `web/`. They
regressed between the 2026-09-03 checkpoint and now.

### 11.8 Recommended next task

> **Partly superseded** by the cutover noted in §11.5: steps 2 and 3 are done.
> Steps 1 (the two pregnancy questions) and 4 (`income.self_employment.*` and
> H1049) remain.

**Finish H1010's official mapping, then cut over.** In order:

1. Add the two pregnancy questions to the Texas intake (`form-intake/tx-h1010.ts`)
   so the new canonical keys are reachable.
2. Anchor printed pages 4–21, section by section, rendering and *looking at*
   every page as you go. Shrink `WORKSHEET_ONLY_KEYS` to empty.
3. Cut `TX_H1010` over to the official definition, retire the worksheet, regenerate
   the four golden review sheets, and update the scenario tests that assert
   worksheet geometry.
4. Then `income.self_employment.*` and H1049.

Do not skip step 1: without it the cross-runtime reachability test cannot hold.

### 11.9 Files to read first

- `docs/texas-forms.md` — the design document for all of the above.
- `formmap/forms/h3037.py` — the field-audit format every new form should follow.
- `formmap/documents.py` — why forms and language are decided separately.
- `formmap/packet.py` — why applicability is not requirement.
- `tests/test_formmap_texas_packet.py` — 60 tests, each pinning a failure mode
  that produces a form which *looks* right.

---

## 12. Browser fixes, grouped commits and cleanup (2026-09-24)

The Texas official-forms milestone (§11) and the web work built on it were
sitting uncommitted. They are now eight commits, and two errors reported from
the browser are fixed. The operational rules these taught are in `CLAUDE.md`
("Working notes"); this section records what happened and why.

### 12.1 `TypeError: crypto.randomUUID is not a function`

**Why it failed.** Browsers expose `crypto.randomUUID()` only in a secure
context: HTTPS or `localhost`. The app was being opened over plain HTTP on a LAN
address, where the function is undefined. Two client call sites used it:

- `web/src/lib/application-data.ts`, which builds household row ids when the
  application view first opens. The error was thrown while rendering, so React
  unmounted the whole tree and the page went blank.
- `web/src/components/application-view.tsx`, "Add household member".

No test caught it because every e2e run is on `localhost`, which is secure.
Server routes were never affected: they import Node's `randomUUID`, which always
exists.

**Fix** (`d223bcc`). `createClientId()` in `web/src/lib/client-id.ts` uses
`randomUUID` when present and otherwise builds an RFC 4122 v4 id from
`crypto.getRandomValues()`. Both call sites use it.

**Proof.** `web/tests/e2e/insecure-context.spec.ts` deletes `randomUUID` before
the page loads and walks the California and Texas flows to the household step.
Against the old code it fails in about two seconds with the original message.
The SAWS 2 PLUS and Texas household specs were also run from
`http://192.168.0.81`, where the browser reported `isSecureContext: false`, and
passed.

### 12.2 "Failed to fetch" when generating the PDF

**Why it failed.** "Failed to fetch" means the browser received no response at
all. The `npm run dev:demo` server on :3000 had stopped, so the page (still open
from before) posted the draft request to nothing. Why it stopped was not
established: a second `next dev` with its own build directory was tested and
does not stop the first. With a server running, both states generate a draft in
about a second, including over the LAN address.

The code made this worse: both application views called `fetch` and
`response.json()` directly, so the browser's own text reached the applicant.
An HTML error page would likewise have shown `Unexpected token '<'`.

**Fix** (`6d28514`). `requestDraft()` in `web/src/lib/draft-request.ts` wraps
the request. A rejected fetch becomes `DraftRequestError('av_draft_unreachable')`,
which says the server could not be reached and that the answers are kept. An
unreadable body becomes `av_draft_failed`. The route's own error responses pass
through unchanged. The new message is in all three catalogs.

**Proof.** `web/tests/e2e/draft-unreachable.spec.ts` aborts the draft request in
the Texas flow, expects the translated message, then retries and gets the PDF.
Against the old code it fails with `Received: "Failed to fetch"`.

### 12.3 Two e2e failures that were not regressions

`intake-to-report.spec.ts:331` and `report-rendering.spec.ts:131` (also noted in
§11.7) fail whenever `dev:demo` is running on :3000. `playwright.config.ts` sets
`reuseExistingServer: !process.env.CI`, so the `chromium` project tested against
the demo server, whose report does not contain the mock-kvr fixture's `18,240`
or `tdhca.state.tx.us`. On fresh servers all specs pass. No code changed for
this.

### 12.4 The commits

| Commit | What it contains |
|---|---|
| `b07269d` feat(formmap): add official Texas documents with provenance and box measurement | The five HHSC PDFs; `provenance.py` (source, revision, SHA-256; a swapped file is refused); `measure.py` / `measurements.py` and committed JSON (boxes anchored to printed text); `tools/measure_texas_forms.py` (`--check` for CI); `segments` and `also_draw_at` on overlay targets |
| `063d201` feat(formmap): resolve official language editions and plan Texas packets | `documents.py` (edition per locale), `packet.py` + `forms/tx_catalog.py` (which forms and why), `manifest.py` (the packet as JSON for the web), `review_words.py` (review sheet in English and Spanish), declared blanks and derivations in `definition.py`, locale-aware `pipeline.py` |
| `e156e42` feat(formmap): fill Texas H1010 and H3037 on HHSC's own documents | `h1010_official.py` (115 fields, 217 boxes per edition), `h1010_coverage.py`, `h3037.py`; the worksheet renamed `TX_H1010_WORKSHEET`; the registry cutover of `TX_H1010`; the form filler returns the packet; Python tests and golden review sheets |
| `87d7a47` docs: document the Texas official forms, packet and H1010 cutover | `docs/texas-forms.md`, corrected `docs/h1010-mapping-audit.md`, §11 of this file |
| `454443b` feat(web): describe each form in the packet as a card in the reader's language | Form cards, `document-labels.ts`, `form-manifest.ts`, the blank-form route, the packet stored with the draft, the review sheet's `lang`, card strings and the "worksheet" to "official form" copy |
| `27b9bd8` feat(web): ask Texas per-person questions and show intake progress | `person-fields.tsx`, `intake-progress.tsx`, the Texas view (including the one-keystroke focus fix), per-person answers in the mapper, strings, unit and e2e specs |
| `d223bcc` fix(web): stop crashing where crypto.randomUUID is unavailable | §12.1 |
| `6d28514` fix(web): show a readable message when the draft request cannot reach the server | §12.2 |

The message catalogs, `component-english-leaks.test.ts` and
`playwright.config.ts` were split by content between `454443b` and `27b9bd8`, so
each commit carries only its own lines. `texas-application-view.tsx` mixes both
themes line by line and went whole into `27b9bd8`.

Each commit was checked out alone in a worktree and passes pytest, `tsc` and
Vitest. The one failure first seen there (`TestMeasurementToolIsInStep`) was the
worktree lacking `.venv`, not the code.

`h1010_worksheet_keys.py` was staged once and deleted before any commit, so it
never entered history.

### 12.5 Stale comments corrected

- `forms/h1010.py`: the worksheet's `base_document_note` still said the
  worksheet was what a household files, and pointed at the deleted
  `WORKSHEET_ONLY_KEYS`. It now says the worksheet is a supplement to
  `h1010_official`. `tests/test_formmap_mapping.py` asserts the current reason is
  present and both earlier reasons are absent.
- §11.5 and §11.8 above are marked superseded, with the steps that remain.
- `docs/texas-forms.md` called the pregnancy questions "a prerequisite for the
  H1010 cutover", which has since happened. It now says those boxes stay blank
  until the questions are asked.
- A scan of every added line found no leftover debug output or TODOs. The
  `print` calls in `tools/measure_texas_forms.py` are its command-line output.

### 12.6 Test counts

| Suite | §11.7 | Now |
|---|---|---|
| Python | 1077 passed, 3 deselected | **1176 passed**, 3 deselected |
| Vitest | 1937 passed (80 files) | **2013 passed** (85 files) |
| Playwright | 79 passed, 2 failed | **121 passed** (on fresh servers) |
| `tsc --noEmit` | clean | clean |
| ESLint | clean | clean |
| `next build` | — | succeeds |

### 12.7 Open items

1. **Stale applicant-facing text.** `worksheet_reason_tx_h1010_partial_coverage`
   in `formmap/review_words.py` (English and Spanish) and the four
   `tests/fixtures/h1010-*.review.txt` golden files still tell the applicant we
   "can currently fill only its first few pages" of H1010. Untrue since the
   cutover. It needs new wording from product, then regenerated goldens.
2. **Pregnancy questions.** `household.pregnancy.person_name` and
   `household.pregnancy.due_date` are mapped on H1010 and H3037 but not asked by
   `web/src/lib/form-intake/tx-h1010.ts`, so those boxes stay blank.
3. **Self-employment and H1049.** `income.self_employment.*` is identified but
   not added; H1049 has nothing to fill from until it is.
4. **Why the dev server stopped** (§12.2) is unknown. If "Failed to fetch"
   recurs with a server running, capture the server terminal output at that
   moment.

### 12.8 Resume

> Continue the Kealu Benefits Navigator. Read `PROGRESS.md` §12 and the
> "Working notes" in `CLAUDE.md` first.
>
> State: branch `feat/saws2-required-fields-and-guide`, HEAD `6d28514`, nothing
> pushed. Python 1176, Vitest 2013 and Playwright 121 passed on 2026-09-24;
> verify with the commands in `CLAUDE.md` before starting, with nothing running
> on :3000 or :3101.
>
> Next: agree the new worksheet reason wording (§12.7.1), then add the two
> pregnancy questions to the Texas intake (§12.7.2).
