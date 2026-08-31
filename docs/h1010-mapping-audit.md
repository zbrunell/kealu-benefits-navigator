# Texas H1010: what we map, what we do not, and why

An audit of every mapping on Form H1010, and a statement of the ones that stay
blank on purpose. Its companion is `docs/jurisdictions.md`, which covers how a
household's location decides that they get this form at all.

The authority for what is mapped is the definition itself
(`src/benefits_navigator/formmap/forms/h1010.py`), not this file. What this file
holds is the part a definition cannot: the *reasons*.

## The document we do not have

HHSC does not publish H1010 as a retrievable PDF. Re-verified 30 August 2026:

| What was tried | Result |
|---|---|
| `fhb.hhs.texas.gov` form page for H1010 (effective 6/2026) | 200. Its "Form H1010" and "Form H1010-S" links both point at `yourtexasbenefits.com/Learn/GetPaperForm` |
| `yourtexasbenefits.com/Learn/GetPaperForm?lang=en_US` | 200, and it is an Angular application — no document behind it |
| `www.hhs.texas.gov/regulations/forms/...` | 403, with browser headers included |
| `www.hhs.texas.gov/sites/default/files/...` | Reachable, but 404 for every H1010 path tried |

So the generated document is a **Navigator-authored worksheet**, not the
government's paper with our answers on it. Every coordinate in the definition is
one we own and can verify by opening the output; none is a guess about where a
box sits on a page nobody here has seen. `GeneratedForm.is_official_document` is
`False`, the first page says so, and the review sheet leads with it.

The *scope* is not guesswork either. HHSC's own published purpose for H1010 says
the form is used to apply for SNAP, TANF and health care (children, adults
caring for a child, adults not caring for a child, pregnant women, former foster
youth); that it is the **screening document for SNAP applicants who may be
entitled to expedited service**; that it carries an **authorized
representative's acknowledgement**; and that it offers voter registration. Every
section below exists because that description says the form covers the topic and
because our canonical intake can answer it.

## Coverage

154 mappings across 13 sections and 5 pages. "Filled by a scenario" counts the
four Austin households in `web/tests/fixtures/tx-h1010-scenarios.ts`, whose
canonical plans come from the production TypeScript mapper.

| Section | Mappings | Filled by a scenario | Gated | Optional | Pages |
|---|---|---|---|---|---|
| What are you applying for? | 4 | 4 | 0 | 0 | 1 |
| About you | 13 | 11 | 0 | 4 | 1 |
| Where you live | 8 | 8 | 0 | 1 | 1 |
| Where you get your mail | 7 | 6 | 6 | 2 | 2 |
| People who live with you | 42 | 42 | 36 | 6 | 2 |
| Money you get | 6 | 6 | 0 | 0 | 2–3 |
| Jobs | 18 | 18 | 18 | 0 | 3 |
| Other money you get | 12 | 8 | 12 | 0 | 3 |
| Bills you pay | 19 | 15 | 15 | 5 | 3–4 |
| Things you own | 4 | 4 | 0 | 0 | 4 |
| If you need food benefits right away | 8 | 8 | 0 | 5 | 4 |
| Your situation | 5 | 5 | 0 | 1 | 5 |
| Someone helping you apply | 8 | 8 | 7 | 1 | 5 |
| **Total** | **154** | **143** | **94** | **25** | **1–5** |

By kind: 109 text, 33 choice (Yes/No pairs), 7 date, 6 of those text cells
carrying Yes/No as a word inside a table, 4 checkbox, 1 multiline.

The 11 mappings no scenario fills are seven genuinely optional boxes — other
names used, a second phone, a mailing apartment line, four "details" cells
beside an already-named bill — and the four cells of the third other-income row,
which is an unused printed row rather than a missing answer.

## Why the previous pass filled 26 of 38

The starting point was 38 declared mappings with 26 populated by the Austin
sample. Each of the twelve, classified:

| Mapping | Classification | What was done |
|---|---|---|
| `applicant.mailing_address.street` | **Mapping incorrect — it should never have been reported as missing.** The household gets its mail at home, so the six mailing boxes are *not applicable*, not blank. Worse, the TypeScript mapper copies the home address into `mailing_address.*` when they are the same, so a naive fix would have printed the home address twice. | `Condition` added to the mapping layer; the whole block is gated on `applicant.mailing_address_same_as_home == false` and is reported under "Not applicable to your household" |
| `applicant.mailing_address.apartment` | same | same |
| `applicant.mailing_address.city` | same | same |
| `applicant.mailing_address.county` | same | same |
| `applicant.mailing_address.state` | same | same |
| `applicant.mailing_address.zip_code` | same | same |
| `programs.tx_chip` | **Canonical schema could not represent it.** `Saws2PlusApplicationData.selectedPrograms` was typed as California's three programmes, so `programs.tx_chip` could not be emitted no matter what an applicant ticked. The checkbox was unreachable, not merely unticked. | `selectedPrograms` widened to `BenefitProgramId`; the California flow narrows at the point of use instead |
| `programs.tx_tanf` | same | same |
| `applicant.other_names` | **Intentionally optional.** Collected, and blank is a complete answer. | Marked `optional`; the review sheet lists it under "Only if it applies to you" rather than under work outstanding |
| `applicant.alternate_phone` | same | same |
| `applicant.household.marital_status` | **Fixture missing data.** Collected by the intake (`AdultApplicationDetails.maritalStatus`) and simply absent from the hand-written sample. | Fixtures rebuilt from the real mapper; also gained a `humanize` transform, because the canonical value is `single`, not `Single` |
| `applicant.household.sex` | same | same |

Nothing was forced. The mailing block still renders blank for three of the four
scenarios — that is the correct output, and the difference is that the applicant
is now told *why* rather than being sent looking for it.

## Fields we deliberately do not populate

**Never, for anyone.** These are structural: there is no mapping and no
canonical key, so no value can reach them.

- **Signature and date signed.** Present as printed labels only. An application
  we signed on someone's behalf would be a forgery.
- **Social Security numbers, alien registration numbers, immigration document
  numbers, bank and account numbers, driver's licence numbers.** Refused twice
  before rendering — once when a definition is constructed and once when values
  are resolved — and both refusals raise rather than filter.

**Because H1010 asks something we do not collect.** No box is printed for these
at all, rather than an empty one implying we asked:

- **Voter registration.** H1010 doubles as a voter registration opportunity. We
  do not ask, and prompting someone about voting inside a benefits application
  is not a decision this project should make on their behalf.
- **Race and ethnicity.** Optional on the official form and not collected by our
  intake.
- **Per-person Social Security numbers and citizenship documentation.** Same
  refusal as above, applied to every household member.

**Blank because the applicant's own answers exclude them.** Reported under "Not
applicable to your household", with the reason, on every review sheet:

- The mailing address block, when mail comes to the home address.
- The authorized-representative block, when nobody is applying on their behalf.
- Every unused row of the people, jobs, other-income and bills tables.

**Blank because a blank is a complete answer.** Reported under "Only if it
applies to you": middle name, other names used, second phone, email, apartment
lines, county on a mailing address, the description beside a named bill, the
five urgent-need questions beyond the federal expedited test, and the
already-receiving-benefits note.

An **unticked checkbox** is in this group too, whatever the definition says
about it, and that is a rule of the review sheet rather than of any one form: a
blank box on a paper form *is* the answer "no". Telling a food-benefits
applicant that they still have to fill in the three programmes they chose not
to apply for is worse than telling them nothing.

## Answers we collect that H1010 has no box for

Not a defect in either direction — it is a fact about two different forms. The
resolution report lists them as `unmapped` for every generation, and they are
never rendered.

- **California-only concepts**: `household.california_resident`,
  `household.cal_learn_history`, `household.receives_ihss`, the CHDP service
  questions, Appendix A/C/D/E answers, and the SAWS table assignments
  (`applicant.table`, `household.members.N.table_row`).
- **Detail our worksheet has no column for**: an employer's phone and start
  date, hours expected to continue, a child's place of birth and immunization
  status, a member's marital status, absent-parent detail.
- **Derived values that must not be printed as reported answers**:
  `income.unearned.N.amount_monthly` is a budgeting equivalent we compute; the
  printed columns carry the amount and frequency the applicant actually stated.

## Canonical and intake changes this milestone made

Deliberately none of them named "H1010". Each is a concept another state can
reuse.

1. **`selectedPrograms` widened to `BenefitProgramId`.** "What am I applying
   for?" is the same question everywhere. The California questionnaire narrows
   at the point of use (`isSaws2PlusProgram`, and a filter inside
   `evaluateApplicationReadiness`), which is honest; narrowing the shared model
   was not.
2. **Every indexed collection states that its row exists.** The field plan now
   emits `<collection>.<n>.present` for jobs, bills, accounts, vehicles,
   representatives and the rest — not only for household members. A reader that
   discovers rows by probing for a non-empty value stops at the first gap and
   drops everything after it, and a printed table cannot otherwise tell "no
   fourth person" from "a fourth person we know nothing about".

No new field was added to the intake for this milestone, because none was
needed: housing and utility costs, dependent care, child support, income by job
and by source, resources, citizenship, and the expedited screen were all already
canonical. What was missing was H1010 mappings for them.

## Architectural debt

- **`household.california_resident` is a canonical key with a state in its
  name.** Texas Works asks the same question about Texas. The neutral key is
  `household.resident_of_application_state`; the rename touches the
  questionnaire field, the planner, the schema table, three message catalogues
  and the SAWS adapter, so it is called out here rather than done quietly
  alongside a Texas milestone. H1010 leaves it unmapped, and a test pins that.
- **The Texas intake questionnaire does not exist.** `state-applications.ts`
  still lists Texas as `manual`, so a Texas household in the web app gets the
  guide, not the application flow — the flow is built on the SAWS 2 PLUS
  question schema. The Python generator produces a correct H1010 from a
  canonical plan today; what is missing is a UI that collects one for Texas.
- **A table cell cannot wrap.** A value too long for a column at six points is
  reported rather than drawn, which is the right policy for a single-line box,
  but a two-line record block would let a 61-character employer name print
  instead of being written in by hand.
- **`Saws2PlusApplicationData` is named for one state's form** while serving as
  the application carrier for both.

## What a third form would take

The reusable parts, as of this milestone:

- `targets` (native field vs. drawn box, per field), `transforms` (named,
  registered, no locale), `textfit` (measure, shrink, refuse), `render` (draws
  what it is handed), `repeat` (printed tables), `definition` (mapping,
  conditions, alternates, resolution) and `pipeline` (plan → document → review
  sheet). A test suite reads these modules' syntax trees and fails on any
  comparison against a form id, state code or programme name.
- `registry` is the only module that names the forms, and `form_id_for_state`
  is the only place a state becomes a form. It answers without building
  anything, so asking which form a Texas household files does not import
  California's generator or pypdf — a test runs that question in a subprocess
  and checks neither module was loaded.

**Adding an overlay-based form** (no usable AcroForm, like H1010) is:

*(Steps 1–4 are the document. A form an applicant can reach also needs an
intake configuration under `web/src/lib/form-intake/` and an entry in
`APPLICATION_FLOWS`; see `docs/jurisdictions.md`.)*


1. a module under `formmap/forms/` declaring sections, fields and tables — the
   `_Layout` helper in `h1010.py` is a good starting point to copy, since page
   geometry is a property of the form rather than of the layer;
2. one entry in `registry._FORMS`, naming the state it serves and how to build
   it;
3. one entry in `state-applications.ts` so the TypeScript side routes to it;
4. a scenario file and emitter test on the TypeScript side, and a Python suite
   that consumes the emitted JSON — both roughly copies of the Texas pair.

Nothing in `definition`, `render`, `repeat`, `transforms`, `textfit` or
`pipeline` should need to change. If it does, that is the signal that a
primitive is missing.

**Adding a native-fillable form** (a real AcroForm we can write to) is a larger
job, because this layer *describes* native fields and does not write them:
`pipeline.generate_form` raises `NativeFieldFormNotRenderable` rather than
producing a blank document. Writing native fields means cloning the template,
setting values, regenerating appearance streams and re-running the fitting pass
over the widget rectangles — all of which exists in `pdf_generator` for
California, behind a reviewed destination allowlist. Lifting that into the
mapping layer, so an `AcroFormTarget` renders as well as it maps, is the work a
second native form should start with.
