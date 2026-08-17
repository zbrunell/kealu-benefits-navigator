# SAWS 2 PLUS — production status

Durable facts about the SAWS 2 PLUS prefill pipeline. Written so a fresh session
can pick the work up from the repository rather than from conversation history.

**Treat the repository as the source of truth.** The numbers below are the last
verified values; re-run the commands in [Verification](#verification) rather than
trusting them.

---

## 1. Where things are

| Concern | Module |
| --- | --- |
| Canonical form semantics | `web/src/lib/saws2-schema.ts` |
| Printed-question inventory | `web/src/lib/saws2-inventory.ts` |
| What the paper can hold | `web/src/lib/printed-capacity.ts` |
| Household row assignment | `web/src/lib/household-rows.ts` |
| Appendix D row assignment | `web/src/lib/appendix-d-rows.ts` |
| Application → canonical plan | `web/src/lib/application-mapper.ts` |
| Per-draft outstanding work | `web/src/lib/draft-completion.ts` |
| Guide document model | `web/src/lib/completion-guide.ts` |
| Printable guide rendering | `web/src/lib/completion-guide-html.ts` |
| Canonical plan → AcroForm | `src/benefits_navigator/pdf_generator.py` |
| PDF field classification | `src/benefits_navigator/saws2_plus_inventory.py` |

The canonical plan is the boundary: TypeScript emits semantic keys, Python
translates them to reviewed AcroForm destinations. **PDF field names never appear
in TypeScript, and application semantics never appear in Python.**

---

## 2. Definition of done

A change is production-ready when all of the following hold.

1. Every modeled, safely mappable printed question is mapped.
2. Every automated write is on `Saws2PlusFieldAdapter.SAFE_FIELDS`.
3. No SSN destination is ever written.
4. No signature destination is ever written.
5. Every applicable manual date is identified by page and printed label.
6. No known application data is silently dropped.
7. Repeated rows are deterministic.
8. Overflow is explicitly surfaced.
9. Conditional logic is tested.
10. Draft completeness is per-draft and truthful.
11. Associate instructions give exact manual-field locations.
12. User instructions give exact signature/date/manual steps.
13. The user guide is downloadable and printable.
14. Submission guidance is grounded in authoritative form/product information.
15. Unsupported content is represented explicitly, never guessed.
16. Unit, integration, typecheck, lint, build and scenario suites are green.
17. SSN and signature invariants are regression-tested.
18. Representative PDFs are inspected visually, not merely counted.
19. The product can say exactly what remains between draft and submission.
20. The repository is clean and commits are logical and revertible.

**The safety invariant overrides all of it:** never increase apparent completion
by guessing a mapping. A manual instruction beats an unverified automated write.
SSNs and signatures stay manual regardless of whether their widgets are writable.

---

## 3. Form structure you will need

The official PDF is `src/benefits_navigator/forms/CA-SAWS-2-PLUS.pdf`:
29 pages, 1,444 AcroForm fields, no `/TU` tooltips and no `/TM` names. **A field's
meaning cannot be inferred from its name** — `Text3 PG 1` is the applicant's
Social Security Number. Every destination must be established by matching the
printed label's text matrix against the widget rectangle.

### Page numbering

| PDF pages | Content |
| --- | --- |
| 1–6 | Coversheet and program rules. No form fields. |
| 7–23 | The form body, printed "PAGE 1 OF 17" … "PAGE 17 OF 17". |
| 24 | Appendix A — health coverage from jobs |
| 25 | Appendix B — American Indian / Alaska Native |
| 26 | Appendix C — assistance with completing this application |
| 27 | Appendix D-1 — employment history, "Person1" |
| 28 | Appendix D-2 — employment history, "Person 2" |
| 29 | Appendix E — vehicle information |

So `PDF page = printed body page + 6`, and widget suffix `PG n` means printed
body page `n`.

### The appendix widget-name shift

**Every appendix's widget names run one letter behind the printed appendix.**
This is an error in the source form. The literal names are required to address
the widgets and must never be "corrected" in code.

| Printed | PDF page | Widget suffix |
| --- | --- | --- |
| Appendix A | 24 | `PG 18` |
| Appendix B | 25 | `APPX A` |
| Appendix C | 26 | `APPX B` |
| Appendix D-1 | 27 | `appx c` |
| Appendix D-2 | 28 | `appx d2` |
| Appendix E | 29 | `appx E` |

---

## 4. Verified unusual mappings

Each of these would be got wrong by trusting sequential widget names. All are
pinned by tests in `tests/test_saws2_plus_gateway_boxes.py`.

- **Appendix D-2, Job 1 hours** — the printed row reads Daily, Weekly, Monthly
  but the widgets are `Check Box8`, `Check Box7`, `Check Box9`. Transposed in
  the source form; resolved by x-coordinate.
- **`Text 10 appx c`** — the literal AcroForm name contains a space after
  "Text".
- **`Text24/25/26/32/33/34/44/45/46 Appx D2`** — capitalised "Appx D2" where
  their neighbours read "appx d2". Names are case-sensitive.
- **Appendix D-1, Job 3** — `Text41` (reason for leaving) precedes `Text40`
  (tribe name) in the annotation array.
- **Appendix A item 13** — visually prints **No before Yes**. The application's
  semantic tuple stays `(yes, no)`; the coordinate inversion is intentional. A
  No suppresses the rest of that section.
- **Appendix A item 6 / Appendix C item 7 — phone numbers are two boxes.** The
  page prints `(          )` and the narrow box sits *inside* those parentheses:
  it is the area code. `Text9 PG 18` is 30.6pt wide; all ten digits do not fit.
  Split into area code + remainder, and only when the value is a recognisable
  ten-digit number.
- **Appendix B item 3** — its follow-up is conditional on **No**, not Yes: "if
  no, is this person eligible to get services from …".
- **Q40 signature block is on PDF page 7**, at the foot of printed PAGE 1 OF 17 —
  not on the last page. The signature *lines* have no widget; `Text61 PG 1` and
  `Text62 PG 1` are the **DATE** boxes beside them.

### Font sizing

The form declares an explicit point size per field, and several of its boxes are
too narrow for what belongs in them — Q6's DATE OF BIRTH column is 47.9pt wide
with `/Helv 10 Tf` set, and `01/01/1990` needs 50.0pt. `_shrink_overflowing_text`
reduces the declared size to fit, using real Helvetica metrics, only for fields a
run wrote and only when the value genuinely overflows.

**Do not replace this with auto-sizing (`/Helv 0 Tf`).** Viewers that honour it
*grow* short values to fill the box, rendering a one-letter "F" in the GENDER
column three times the size of the name beside it. This was tried and rejected.

---

## 5. Manual-only invariants

These are enforced by tests and must never be relaxed.

- **SSNs.** 14 destinations, listed in `SSN_FIELDS`. None is in `SAFE_FIELDS`;
  `map_values` cannot reach them. Page 1's box, five adult rows, five child rows,
  and Appendix A item 2's three boxes (`Text2/3/4 PG 18`). The application data
  model has no SSN field at all, and `application-mapper.ts` throws on any
  canonical key containing a sensitive marker.
- **Signatures.** 2 destinations in `SIGNATURE_FIELDS`, both signature *dates*.
  Prefilling one would assert when the applicant signed.
- **Immigration document numbers.** Treated exactly like SSNs: never collected,
  never stored, never prefilled. Q6e/Q6f are `intentionally_unsupported`.
- **County-use-only.** 8 checkboxes printed "DO NOT COMPLETE — COUNTY USE ONLY".

Adding a file that mentions Social Security Numbers requires adding it to the
reviewed list in `web/tests/unit/saws-application-coverage.test.ts`. That gate is
deliberate.

---

## 6. Intentionally unmappable

Do not "finish" these. Each was searched for and rejected; the schema records
them as `pdf: 'ambiguous'` or `'no_widget'`, which is different from
`'unreviewed'`.

- **Q23f** (renew coverage from tax data) — the page offers two opposite choices
  and the AcroForm has exactly **one** checkbox (`Check Box74 PG 13`) equidistant
  from both printed lines. Ticking it could tell the county either thing.
- **Q27** (home, land or other property) — no gateway checkbox exists. Do not
  fabricate one.
- **Appendix D "Number of hours worked"** — the printed line is followed only by
  Daily/Weekly/Monthly checkboxes. Neither Appendix D page has a widget for the
  count among its 61. The count is collected and reported as a write-in.
- **Appendix A items 10/11** (`Text15/16/17 PG 18`) — labels do not extract with
  a usable text matrix, so the rows were never resolved. Left manual.
- **Appendix E `Check Box46/53/60`** — no label that coordinate matching
  resolves.
- **Appendix C items 3–6** (apartment, city, state, ZIP) — the model holds one
  address string; splitting it would be guessing which part is which. Item 9
  (I.D. number) is not collected. The lower "Certified Application Counselors,
  Navigators, Agents and Brokers Only" block is not modeled.
- **Q24 "stocks or bonds"** — the form prints separate Stocks and Bonds boxes
  and the application collects one combined category.
- **Q15 "other"** — no printed row exists for it.

---

## 7. Overflow model

Three distinct ways a record fails to reach the page, each with its own wording
in the guides (`web/src/lib/printed-capacity.ts`):

- `beyond_printed_rows` — the numbered table is full.
- `printed_row_already_used` — a category-keyed table holds one row per kind, and
  that kind is taken (a second Telephone expense on Q15).
- `category_has_no_printed_row` — the answer's category is not one the table
  offers.

Printed capacities, asserted against the adapter's own tables by
`tests/test_saws2_plus_printed_capacity.py`:

| Block | SAWS | Capacity |
| --- | --- | --- |
| Household adults / children | Q6 / Q6b | 5 each |
| Unearned income | Q7 | 4 |
| Earned income | Q8 | 4 |
| Self-employment | Q8a | 3 |
| Other income | Q9 | 4 named rows |
| Household expenses | Q15 | 6 named rows |
| Resources | Q24 | 4 |
| Personal property | Q25 | 3 |
| Disability detail | Q6j | 2 |
| Employer coverage | Appendix A | 1 |
| Tribal membership | Appendix B | 2 |
| Employment history | Appendix D | 2 people × 3 jobs |
| Vehicles | Appendix E | 3 |

Nothing is truncated. Everything past capacity is reported as a manual item.

---

## 8. Completeness and the guides

`assessDraftCompletion` walks one generated draft and returns items in nine
states: filled, `ssn`, `signature`, `signature_date`, `write_in`, `overflow`,
`unsupported`, `missing_answer`, plus the conditional sections correctly skipped.

- **`reviewAndSignOnly` is literal**, and therefore false for any real draft:
  page 1's Social Security box is always outstanding, so the phrase was never a
  true description. Use `readyForSignature` ("Kealu has nothing left to
  contribute") for UI, and always show the manual items beside it.
- Both guides are generated from that metadata, so they cannot drift from the
  mapper or from each other.
- The guide route reads `session.draftApplicationData` — the state the PDF was
  generated from — so editing an answer without regenerating cannot change the
  guide out from under the downloaded PDF.
- Guide and draft share a non-sensitive reference derived from the run id.
- Submission guidance names only BenefitsCal, Covered California, and the county
  resolved from the applicant's ZIP. **Never invent an address, phone number or
  fax number.** A test asserts no such string reaches the rendered page.

---

## 9. Verification

Run from the repository root unless noted.

```sh
# Python: adapter, inventory, coordinate regressions, scenario matrix
.venv/bin/python -m pytest -q

# Web: unit, api, integration
cd web && npx vitest run

# Typecheck, lint, production build
cd web && ./node_modules/.bin/tsc --noEmit
cd web && npm run lint
cd web && npm run build

# Regenerate the cross-runtime scenario fixture after a mapper change,
# then review the diff before committing it.
cd web && UPDATE_SCENARIOS=1 npx vitest run tests/unit/saws2-e2e-scenarios.test.ts
```

Inspecting the form itself:

```sh
# Every field's classification and the writable count
.venv/bin/python -c "from benefits_navigator.saws2_plus_inventory import coverage_summary; print(coverage_summary()['counts'])"

# Render a page to check values against printed labels
pdftoppm -png -r 130 -f 27 -l 27 <generated.pdf> out
```

### Last verified state

| Measure | Value |
| --- | --- |
| Python tests | 612 passed, 3 deselected |
| Web tests | 1,186 passed / 55 files |
| Typecheck, lint, build | clean |
| PDF fields total | 1,444 |
| Reviewed and writable | 903 |
| SSN destinations | 14, none writable |
| Signature destinations | 2, none writable |
| County-use-only | 8 |
| Reviewed, deliberately blank | 13 |
| Unreviewed remainder | 504 |
| Printed questions tracked | 79 |
| — collected and mapped | 70 |
| — known from application | 1 (Q6b) |
| — manual SSN | 1 (Q6c) |
| — manual signature | 2 (Q40 block, Appendix C) |
| — intentionally unsupported | 2 (Q6e, Q6f) |
| — conditional heading | 1 (Q23a) |
| — verified unmappable | 1 (Q23f) |
| — no writable widget | 1 (Q27) |
| — **not modeled** | **0** |
| E2E scenarios | 17 |

The 504 unreviewed PDF fields are not a gap in the *questions*: one printed
question can own thirty widgets or none, and the remainder is mostly the unused
rows of tables whose first rows are mapped. `not_modeled = 0` is the meaningful
figure — every printed question is accounted for.

---

## 10. Working notes

- **Context runs out on this project.** Commit a tested checkpoint and update
  this file before continuing; do not spend remaining context on a retrospective.
- Prefer `git log` and the tests over conversation history.
- Scenario definitions live in `web/tests/fixtures/saws2-scenarios.ts`; the
  committed JSON beside it is generated and reviewed as a diff.
- The ad-hoc form probe used while resolving coordinates is not committed. It
  dumps printed text and widget rectangles for a page, y-sorted, using
  `page.extract_text(visitor_text=…)` and each widget's `/Rect`.
