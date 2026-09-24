# Texas official forms, packets, and language editions

How the Texas side of the form layer works: what documents we hold, how a
household's packet is decided, which official language edition each form is
served in, and what to do when HHSC publishes a new revision.

Companion documents: `docs/jurisdictions.md` (how a location decides which
programs exist) and `docs/h1010-mapping-audit.md` (what H1010 maps and what it
deliberately leaves blank).

---

## 1. What changed, and what did not

The previous milestone concluded that HHSC's H1010 PDF **could not be
obtained**, and built a Navigator-authored worksheet instead. Half of that
conclusion has expired.

**What changed.** Your Texas Benefits publishes a "Get a paper form" catalog at
`yourtexasbenefits.com/Learn/GetPaperForm`, and a person can work through it and
download the documents. Five official PDFs were retrieved that way on
**4 September 2026** and are now in `src/benefits_navigator/forms/`.

**What did not change.** Programmatic retrieval is still blocked, re-verified on
the same date:

| Route | Result |
|---|---|
| `www.hhs.texas.gov/sites/default/files/...` | HTTP 403 |
| `fhb.hhs.texas.gov/sites/default/files/...` | **HTTP 200 with an Akamai "Access Denied" HTML body** |
| `yourtexasbenefits.com/Learn/GetPaperForm` | AngularJS app; the form list is fetched client-side |
| `fhb.hhs.texas.gov/forms/...` | Readable — this is where catalog metadata comes from |

The second row is the trap. A script that checks the status code alone will
conclude it downloaded a PDF and write 199 KB of HTML into the forms directory.
Check the magic bytes, not the status.

The catalog therefore still cannot be *enumerated* programmatically. Adding a
form means a person downloading it and recording it in `forms/tx_documents.py`.

---

## 2. The documents we hold

Recorded in `formmap/forms/tx_documents.py`, one `OfficialDocument` each.

| Form | File | Printed rev. | HHSC index | Languages | Fillability | Status |
|---|---|---|---|---|---|---|
| H1010 | `TX-H1010-EN-2026-08.pdf` | 08/2026 | eff. 6/2026 | en | XFA, partial | current |
| H1010-S | `TX-H1010-ES-2026-08.pdf` | 08/2026 | eff. 6/2026 | es | XFA, partial | current |
| H1049 | `TX-H1049-BI-2001-12.pdf` | 12/2001 | eff. 12/2015 | **en + es** | flat | revision unresolved |
| H3037 | `TX-H3037-BI-2003-04.pdf` | 04/2003 | eff. 4/2003 | **en + es** | flat | current |
| H1028-MBIC | `TX-H1028-MBIC-EN-2015-12.pdf` | 12/2015 | eff. 9/2024 | en | XFA, partial | **superseded** |

That is **five files for five forms**, and the count is the point.

### One asset per document, even when the agency offers two links

An earlier revision of this catalog also held `TX-H1049-ES-2001-12.pdf` and
`TX-H3037-ES-2003-04.pdf`, byte-identical copies of their `-BI-` siblings,
retained as evidence that Texas serves one bilingual PDF from both its English
and its Spanish catalog link. **Both have been removed**, and the reasoning is
worth recording because the files looked harmless:

- A second record over the same bytes **asserts an edition that does not
  exist**. `languages=("es",)` on a copy of the bilingual file claims Texas
  publishes a separate Spanish H1049. It does not.
- It invites the rule `locale == "es" → the -ES- file`, which is **wrong for
  exactly these forms** and right for H1010. Once both kinds of file are on
  disk, that rule looks correct and silently hands a Spanish applicant the
  wrong document — or nothing.
- Two metadata objects pointing at one file can **drift apart** about page
  counts, revisions and languages while the bytes never change.

The evidence they carried is kept as what it always was — a claim with a hash
behind it, recorded in `tx_documents.py`'s docstring and re-verified by hand on
**6 September 2026**, when the Spanish-link download was again byte-identical to
the English-link one.

In their place is an invariant that is cheaper and catches more:
`check_no_duplicate_assets()` refuses two canonical documents with the same
SHA-256, and `test_no_two_canonical_documents_are_the_same_bytes` runs it. It is
deliberately scoped to these document declarations rather than being a
repository-wide duplicate-file scan, which would be disproportionate and would
not have caught this any earlier — the duplicate was declared in metadata before
it was a problem, which is where the invariant looks.

**If HHSC does publish a genuine Spanish edition of either form**, the change is
a new `OfficialDocument` with `languages=("es",)`, its own measured coordinates,
and its own `DocumentVariant` — not a second file beside the bilingual one.

Three things in the table above are worth reading twice.

### Two revision numbers, deliberately

HHSC's index and HHSC's own printed page do not always agree, so both are
recorded — `printed_revision` and `catalog_revision`. Picking a favourite would
throw away a discrepancy a counselor needs to see. H1010 prints a *later* date
than its effective date, which is ordinary; H1049 and H1028-MBIC run the other
way, which is not.

**H1028-MBIC is treated as superseded** (nine-year gap against an explicit later
effective date). It stays in the catalog so a packet can be honest that the form
exists, and is barred from being a production base document — `CatalogEntry`
carries `fillable=False`. **H1049's discrepancy is recorded as unresolved**:
HHSC form pages routinely carry an effective date for the *procedure* while the
printed form keeps its original footer, and we could not retrieve HHSC's copy to
compare.

### "Spanish" means two different things

Expected: each form is English-only or has an English and a Spanish edition.
What is actually true:

- **H1010 has two genuine, distinct PDFs.** Texas publishes a separate English
  and Spanish document: different sizes, hashes, field names and geometry. HHSC
  designates the Spanish one **Form H1010-S**, which its footer prints. A
  Spanish applicant is handed `TX-H1010-ES-2026-08.pdf` and never the English
  file — asserted by digest, not by filename, in
  `TestGenerationChoosesTheAssetFromTheLocale`.
- **H1049 and H3037 are single bilingual documents.** The official form prints
  each question in English with the Spanish beneath it, in one file. Texas
  exposes them through language-specific catalog links, but those links resolve
  to the same bilingual PDF — so the application retains **one canonical
  asset** per form and declares `languages=("en", "es")`.

  Read that as what it is. It is **not** "Spanish content does not exist": it
  does, in HHSC's own wording, on HHSC's own paper, simply printed in the same
  document as the English. A Spanish applicant receiving `TX-H1049-BI-2001-12`
  is not being given a fallback, and every user-facing surface says
  *"official bilingual form"* rather than the language-fallback notice. Those
  two messages are opposites, they use different catalog keys
  (`form_document_officially_bilingual` against
  `form_document_language_fallback`), and a test asserts they never share
  wording.

  **H3037 carries one qualification**, and it is stated rather than glossed:
  only page 2 — the authorization the *client* signs — is bilingual. Page 1 is
  the clinician's and is English only. The document declares that with
  `language_scope_key`, and the card and review sheet both print it.
- **H1028-MBIC is English only**, which HHSC's index confirms. For a Spanish
  applicant this is a **genuine fallback** and is reported as one. Keeping it
  distinguishable from the H1049 case is the whole reason `LanguageMatch` has
  three values instead of two.

### H1010 is a print-by-hand form

All three fillable PDFs are **XFA** (LiveCycle Designer) forms whose AcroForm
layer is a near-empty fallback. Of H1010's 97 widget annotations, most are the
per-page QR barcode. The English edition has **three** usable text fields on 34
pages; the Spanish edition has **none**. The application pages say "Please use
dark ink. Please print. Fill in the circles."

So `AcroFormTarget` is not a route for anything we map on Texas forms. Every
value is overlaid. This is the opposite of California, whose SAWS 2 PLUS has
1,444 real fields — which is why the target kind is per-field, not per-form.

---

## 3. Where coordinates come from

Never guessed, and never a hand-typed constant. Every box is **anchored to text
the document actually prints**.

```python
"applicant.first_name": Above(Anchor("First name", page=5)),
```

reads as "the writing line above the words *First name* on page 5". H1010 sets
its labels *under* the space they describe, so `Above` is the common placement;
H3037 uses them as column headings, so it uses `Below`. Which convention a form
uses is a fact about the form, declared per field.

Column widths are derived too: `First name` starts at x=164.7 and `Middle name`
at x=312.3, so the first column is the gap between them. The form's own labels
define its grid.

Placements available in `formmap/measure.py`:

| Placement | For |
|---|---|
| `Above` / `Below` | a writing line beside its label |
| `RightOf` | a value on the same line as its prompt |
| `SameRow` | a Yes/No circle beside its question |
| `Slots` | cells between printed separators — `__ / __ / ____` |
| `PhoneSlots` | the three cells of a `(   )    -` template |

`SameRow` exists because `Yes` appears about forty times on some pages, so an
anchor naming `Yes` plus an occurrence index is unreadable *and* renumbers when
a question is inserted. Anchoring on the question and finding its options beside
it reads the way the page does.

### The build step

Anchors are resolved **once, offline**:

```bash
.venv/bin/python tools/measure_texas_forms.py          # regenerate
.venv/bin/python tools/measure_texas_forms.py --check  # CI: fail if stale
```

Output is committed to `formmap/forms/measurements/*.json` and reviewed in a
diff like any other source. Rendering reads the committed JSON, so it needs
neither `pdftotext` nor a few seconds per document, and a form's geometry cannot
change under it between runs.

**Read the diff before committing.** A changed anchor moves boxes on a
government form, and the diff is the only place a reviewer can see by how much.

---

## 4. A PDF update cannot silently retain stale coordinates

The single most dangerous failure this layer can produce: HHSC publishes a new
revision whose boxes moved four points, the overlay still renders, nothing
raises, and an applicant's income prints across a printed label.

Two independent digest checks close it.

1. **`provenance.load_document`** refuses to open a file whose SHA-256 does not
   match the record. Dropping a new revision into `forms/` fails here.
2. **`measurements.load_measurements`** refuses boxes whose recorded
   `document_sha256` does not match the document about to be drawn on. Updating
   the digest in (1) without re-measuring fails here.

So updating a form is deliberately a four-step act, and skipping any step is
loud:

### Updating a form when HHSC publishes a new revision

1. Download the new PDF by hand from the Your Texas Benefits catalog. Verify it
   is a PDF, not an Access Denied page.
2. Install it as `TX-<FORM>-<LANG>-<YYYY>-<MM>.pdf` and update its
   `OfficialDocument` in `forms/tx_documents.py`: `sha256`, `byte_size`,
   `page_count`, `printed_revision`, `catalog_revision`, `retrieved_on`,
   `downloaded_as`.
3. Re-measure: `.venv/bin/python tools/measure_texas_forms.py`. **Anchors that
   no longer resolve raise, naming the phrase** — that is the form having been
   re-worded, and it needs a human.
4. Render every scenario, rasterise, and **look at every page** (§7).

Never update a digest alone.

---

## 5. Packet planning: which forms, and why

`formmap/packet.py` answers: *given this household, its selected programs and
its known circumstances, which documents belong in its packet?*

The thing it must never answer is "all of them".

### Applicability is not requirement

Two different questions. *Applicability* asks whether the form has anything to
do with this household; *requirement* asks whether HHSC will refuse the
application without it. `Requirement` has four values and the middle one carries
the weight:

| Value | Meaning |
|---|---|
| `REQUIRED` | HHSC's published instruction says this household files this form |
| `NEEDS_CONFIRMATION` | Applicable; whether it is required turns on something we do not know |
| `OPTIONAL` | Applicable and genuinely the applicant's choice |
| `NOT_APPLICABLE` | Nothing about this household engages it. Never silently included |

Every rule cites the HHSC page it came from, and every decision carries the
canonical keys it consulted. A test asserts both.

### The current Texas rules

| Form | Rule | Level | Grounding |
|---|---|---|---|
| H1010 | any covered program selected | `REQUIRED` | "The household completes the form when applying or reapplying for Medical Programs, SNAP and TANF." |
| H1049 | self-employment reported | `NEEDS_CONFIRMATION` | Purpose says "if accurate tax or business records are not available"; the form itself says "you may attach a copy of the latest income tax forms in place of this form" |
| H3037 | pregnancy **and** a health program | `NEEDS_CONFIRMATION` | Prepared by an advisor for a clinician to complete; HHSC does not state it is the only acceptable verification |
| H1028-MBIC | MBIC selected **and** employment | `NEEDS_CONFIRMATION` | MBIC-specific employer verification, given to the employer by the parent |

Three of these are deliberately *not* `REQUIRED`. Writing
"self-employment → require H1049" would send someone to build an expense ledger
they may not owe anyone; "pregnancy → require H3037" would send someone to a
clinician's office they may not need to visit, for a form whose own text notes
that HHSC cannot pay the clinician for filling it in.

**H1028-MBIC is the entry most exposed to mis-application.** Its title reads
"Employment Verification" and every working household looks like a match. It is
not: MBIC is a narrow program for children with disabilities whose family income
exceeds regular Medicaid limits. The *general* H1028 is a different form
entirely, used "when TIERS is down", with HHSC staff completing page 1 — it is
not an applicant deliverable and is not in this catalog.

### Categories

`MAIN_APPLICATION`, `SUPPLEMENTAL_APPLICATION`, `APPLICANT_VERIFICATION`,
`THIRD_PARTY_VERIFICATION`, `AUTHORIZATION_RELEASE`, `OPTIONAL_SUPPORTING`.
Distinguished because they are handled differently by the applicant — a
checklist that mixes them tells someone to sign a form their doctor must
complete.

Language is **not** a planner input. `PacketContext` has no locale field.

---

## 6. Which official language edition

`formmap/documents.py`. The planner decides *which forms*; the resolver decides
*which official edition of each*. Keeping them apart is what lets one packet
hold a Spanish H1010 and an English H1028-MBIC.

| `LanguageMatch` | When | Reported as a limitation? |
|---|---|---|
| `EXACT` | a separate edition in the applicant's language | no |
| `BILINGUAL` | one document printing their language among others | no |
| `FALLBACK` | no edition in their language exists | **yes**, with a message key |

`BILINGUAL` is not a compromise. A Spanish reader handed H3037 gets HHSC's own
Spanish wording on HHSC's own paper; reporting that as a fallback would tell
them they are receiving something they are not.

There is deliberately **no fourth case for translating a form ourselves**. A
government form carries the agency's legal wording; a Navigator-authored Spanish
rendering would be a document HHSC never published, presented as one it did. The
*explanation* is translated — it is a message key, resolved into the applicant's
language — but never the document.

So a Spanish-speaking Austin household applying for SNAP and Medicaid, pregnant,
with self-employment income, receives:

```
Navigator UI and checklist   Spanish
  H1010                      Spanish  (official H1010-S)
  H1049                      bilingual document
  H3037                      bilingual document
  H1028-MBIC (if it applied) English, with the reason stated in Spanish
```

The packet is never downgraded to English because one form in it is
English-only.

### How a locale becomes a file

The three ideas this layer exists to keep apart, because collapsing any two of
them is where the bugs come from:

| | What it is | Who owns it |
|---|---|---|
| **Application locale** | the language of the interface, explanations and guide | the applicant's choice, on the session (`web/src/lib/locale.ts`) |
| **Document language** | the language the paper is printed in | a fact about the file (`OfficialDocument.languages`) |
| **Physical asset** | which file on disk | resolved from the two above, never pattern-matched |

There is exactly one road from the first to the third:

```
locale  →  resolve_for_definition()   ← formmap/documents.py
        →  ResolvedDocument           ← the variant, the match, the reason
        →  generate_form(..., locale=…)
        →  the manifest               ← formmap/manifest.py
        →  the interface's cards, chips and download names
```

**Never infer an asset from a locale by pattern.** `locale == "es"` does not
imply a filename containing `-ES-`: H1049 and H3037 answer Spanish from files
named `-BI-`. Nothing in the TypeScript layer derives a document's language;
it is told, as data, by the manifest.

That road did not exist until recently, and its absence is the defect this
document's earlier revision described without noticing. `resolve_document`,
`LanguageMatch` and their tests were all present — and **nothing on the
generation path called any of them**. `generate_form` took no `locale`
parameter, `h1010_official` pinned `base_document` to `TX-H1010-EN-2026-08.pdf`,
and a comment claimed `generate_form(..., locale="es")` would swap it. There was
no such parameter. Every Texas applicant, in any language, was rendered onto the
English H1010.

Two consequences worth carrying forward:

- **Swapping half of it is worse than swapping none.** The chosen edition
  supplies both `base_document` *and* every mapping's target. Changing the file
  without the coordinates renders every box without error, onto a page where
  the questions sit somewhere else. `resolve_for_definition` does both, and
  `test_the_spanish_render_uses_spanish_coordinates` asserts the drawn
  positions actually differ.
- **A resolver with no caller is not a safeguard.** A test that exercises a
  layer production does not reach proves only that the layer works. Every
  language test now runs through `generate_form` or the browser.

### What the applicant sees

No internal vocabulary reaches a screen — not `BI`, `EN`, `ES`, `exact`,
`bilingual`, `fallback`, `TX_H1010`, and above all not
`TX-H1049-BI-2001-12.pdf`. A Spanish applicant's H1010 card reads:

```
Solicitud de beneficios de Texas          ← the agency's own title
Formulario H1010                          ← the number a county recognises
Español                                   ← the language, in words
Agregamos su información donde fue posible
[Abrir solicitud]  [Descargar solicitud]
```

and their H1049 card reads `Inglés y español` with `Formulario oficial
bilingüe` beneath it — never the fallback notice.

Download names are built from the asset's declared languages, in
`formmap/pipeline.download_name`:

| Document | Filename the applicant saves |
|---|---|
| English H1010 | `Texas-H1010-Application-English.pdf` |
| Spanish H1010 | `Texas-H1010-Application-Spanish.pdf` |
| H1049 | `Texas-H1049-Bilingual.pdf` |
| H3037 | `Texas-H3037-Bilingual.pdf` |

`Bilingual` rather than a language it only half is: naming the H1049 download
`-English` would tell a Spanish applicant, in their own downloads folder, that
they had been handed the English one.

### Getting the blank official form

`GET /api/workflow/[runId]/form/[formId]` serves the official document for one
form in the session's packet, in the language that packet resolved. It exists
because we hold HHSC's own verified PDFs and previously had no way to give one
to an applicant — which mattered most for the forms we cannot prefill, where a
household told "you may be asked for Form H1049" was left to find it on a
catalog that is an Angular application and cannot be linked to.

The route never looks at the locale and cannot: `formId` is an allowlist lookup
against the stored packet, and the entry names its own file. A route that built
a filename from the locale would reintroduce the bug at the last hop.

### Variants must be complete

The English and Spanish H1010 are the same form and **not** the same layout: the
same question sits at a different x, field names differ (`CheckBox5` against
`CheckBox1`), and the English edition's three text fields do not exist on the
Spanish one at all.

So a variant carries its own target for **every** mapping. `validate_variant`
refuses one that is missing any, with two explicit escape hatches:

- `absent_keys` — the question is not printed on this edition.
- `deferred_keys` — it *is* printed and we have not measured it yet.

These are kept strictly apart because they mean opposite things to the person
holding the form. "This form does not ask that" ends the matter; "this form asks
that and we did not fill it in" is a line on their to-do list. A key in both is
a validation error.

**Both are empty for H1010**, and that is the state to keep them in: every
mapped key has a measured target on both editions. What the form does not ask
is a separate thing entirely — it is not a mapping at all — and lives in
`h1010_coverage.NOT_ON_THIS_FORM`, described in §9.

Letting a variant inherit another edition's coordinates for anything it does not
override is the exact failure this design prevents — it fails silently and
prints in the wrong place. A test asserts that **no field** shares geometry
between the two H1010 editions.

---

## 7. Completion responsibility, and how to validate visually

### Who fills what

A form is not finished because every mapping resolved. `Responsibility`:

| Value | Meaning |
|---|---|
| `NAVIGATOR` | we fill it from canonical data — the only value a `FieldMapping` can have |
| `APPLICANT` | they must write it |
| `THIRD_PARTY` | an employer or clinician must |
| `SIGNATURE` | never rendered, by anyone |
| `SENSITIVE_REFUSED` | SSNs, immigration and account numbers |
| `AGENCY` | HHSC's own boxes |

Everything except `NAVIGATOR` is a `DeclaredBlank`, which carries **no canonical
key and no target**. The refusal is structural: there is nothing to fill a
signature line *from*, which is stronger than a filter that decides not to.

H3037 is the clearest case — one filled box and nineteen declared blanks. A
system scoring itself on boxes filled would call that a 5% failure. The right
measure is whether the applicant is left with less work and a clear picture of
who does the rest, and by that measure it succeeds: they write nothing on page
1, take it to their clinician, and sign page 2.

Responsibility is **per printed field, not per canonical fact**. The expected
delivery date is the applicant's answer on H1010 and a clinician's attestation
on H3037, so it is prefilled on one and deliberately blank on the other.

### Validating an official form visually

Required after any anchor or document change. Tests prove a value reached the
right *coordinates*; only looking proves the coordinates are the right *place*.

```bash
.venv/bin/python tools/measure_texas_forms.py
.venv/bin/python -m pytest -q tests/test_formmap_texas_packet.py
```

Then render and rasterise — `tests/test_formmap_texas_packet.py` has a worked
household in `AUSTIN_HOUSEHOLD` and a `_plan_for(locale)` helper:

```bash
pdftoppm -png -r 120 -f 5 -l 7 /tmp/h1010_EN.pdf /tmp/en
pdftoppm -png -r 120 -f 5 -l 7 /tmp/h1010_ES.pdf /tmp/es
```

**Look at every page, in every language edition.** Check that:

- no value sits across a printed label, rule or checkbox;
- marks land in the circle they belong to, and only that one;
- the agency's own content — instructions, headings, footers, the form number —
  is untouched;
- sensitive blocks (SSN grids, immigration numbers) are still blank;
- signature lines are still blank;
- the footer still names the edition you expect (`H1010` vs `H1010-S`).

Navigator-authored guidance must never be drawn onto the government page. It
belongs in the packet checklist, which is separate material.

---

## 8. Adding a new form

1. Download it by hand from the Your Texas Benefits catalog.
2. Add an `OfficialDocument` to `forms/tx_documents.py` with its hash, page
   count, languages, fillability, both revisions, source URL, retrieval date and
   original filename. Compute these from the file — do not trust a table.
3. **Audit every printed field** and classify each as canonical, derivable,
   ask-applicant, third-party, sensitive, signature, agency, or not applicable.
   Write the audit into the module docstring; H3037's is the model.
4. Add a `CatalogEntry` to `forms/tx_catalog.py` with an applicability rule
   grounded in HHSC's published guidance, and cite it. If you cannot ground it,
   the rule is `NEEDS_CONFIRMATION`, not `REQUIRED`.
5. Declare `PLACEMENTS` (anchors) for every canonical field, and `BLANKS` for
   every printed field you are not filling.
6. Register it in `formmap/registry.py`.
7. Regenerate measurements, render, and look at every page.

A canonical field must describe the **real-world fact**, not the box a state
prints it in. `household.pregnancy.person_name`, never `h3037_patient_name`. If
several forms need an employer's name, they consume the same canonical
employment record.

---

## 9. Current state and what remains

**Integrated:** H1010 (both editions, printed pages 1–3 = PDF pages 5–7, 29
canonical fields, 217 boxes per edition, visually verified) and H3037
(complete: 1 field, 19 declared blanks).

**Registered but not filling:** H1049 (canonical gap, below), H1028-MBIC
(superseded asset).

**The Texas application served in production is HHSC's own document.**
`TX_H1010` builds `h1010_official`, in both published editions, and a household
downloads the government form with their answers on it.

That is a change. It was the Navigator worksheet while the official definition
placed 29 of the intake's answers, because a form with three pages filled and
eighteen blank is worse for an applicant than a worksheet carrying every
answer. The official definition now places **115 fields on each edition** —
every answer H1010 has a box for — so the same measure that once favoured the
worksheet now favours the form.

The worksheet is still registered, as `TX_H1010_WORKSHEET`. It is a supplement,
not a substitute: it carries answers the official form has no box for, which
makes it worth bringing to an interview, and it is the fixture the mapping
suite's scenario tests read. `TX_H1010_OFFICIAL` stays resolvable as an alias
so anything stored before the cutover still finds its form.

`h1010_worksheet_keys.WORKSHEET_ONLY_KEYS` is **gone**. It held 127 keys under
"printed on pages 4-21, not yet measured", and two things were wrong with it:
it mixed "H1010 asks this and we have not measured it" with "H1010 does not ask
this", so it could never reach empty; and nothing rendered it, though its
docstring said the review sheet did.

Of the 127: **83 now reach the form** (59 in a box of their own, 24 read by a
derivation), 12 are answers beyond the rows the form prints, and 32 are
classified in `h1010_coverage` with a concrete reason each. The review sheet
prints the reasons for the ones a given household actually answered.

### What H1010 does not ask, and how the applicant learns it

`formmap/forms/h1010_coverage.py`. Every canonical answer the Texas intake
collects falls into exactly one of four buckets, and three of them are read off
the code so the classification cannot drift from the implementation:

| Bucket | Where it comes from |
|---|---|
| **Direct** — the form has a box, we fill it | `h1010_official.PLACED_KEYS` |
| **Indirect** — re-projected into the shape the form asks | `DERIVATIONS[*].reads()` |
| **Beyond the printed rows** — mappable, more of them than rows | `OFFICIAL_GROUPS` |
| **Not on this form** — the form does not ask it | `NOT_ON_THIS_FORM`, by hand |

Only the last is written out, because it is the only one that is a judgement
rather than a fact about the code, and each entry carries a **concrete reason**.
A test asserts the four buckets cover every intake answer, so a new intake
question cannot be added without classifying it.

**The reasons reach the applicant.** The review sheet — which is the Texas
completion guide — prints the notes for the answers *this* household actually
gave, each with what to do instead, in their own language. That is new: the
previous `deferred_keys` list was validated and rendered nowhere, so an
applicant holding a partly filled form had no way to learn which of their
answers were not on it.

#### The one field left blank on purpose

`income.earned.N.gross_received_this_month`. The intake asks for "everything
received this month before deductions — **not one paycheck**". Section O's box
is labelled "Amount paid before taxes and deductions are taken out" and sits
directly above "How often are you paid?", which makes it a **per-pay-period**
figure.

Writing the monthly total there would misstate the household's income to HHSC —
and combined with the frequency circle beside it, misstate it by however many
pay periods a month holds. Deriving the per-period figure would mean dividing by
a number the applicant never gave, which is the one thing a `Derivation` may
never do. So the box stays blank and the guide says: *"Section O asks how much
you are paid each payday, not for the month. We have your monthly total, which
is a different number, so we left the box blank rather than write the wrong
figure."*

### Three shapes the form asks in

Not every answer lands in a box named after it. `definition.Derivation`
re-projects, and the rule it may not cross is that a derivation may only
**re-project or logically entail** what the applicant said — never estimate,
average, annualize, or fill a gap.

- **`PivotByKind`** — Section P prints one labelled amount box per *kind* of
  housing cost; the intake collects an indexed list of bills each carrying its
  kind. Also marks the circle beside each box it filled, because the form's own
  instruction is "mark the costs they have **and** list the amount".
- **`AnyYes`** — Sections B, N, O and Q ask broader questions than the intake
  does ("any of these types of items", "working for someone else *or* for
  yourself"). Any source Yes → Yes; every source answered and all No → No;
  **otherwise blank**, because some No and the rest unanswered cannot make a
  No — the unanswered one might have been the Yes.
- **`JoinValues`** — the form gives one line where the intake collects two
  answers (street + apartment; employer name + address). An apartment number
  used to be dropped silently.

Derivations deliberately **do not chain**: each sees the applicant's answers and
nothing another derivation produced, so no declaration order can change what a
government form prints.

### Measuring a character grid

Dates and phone templates are drawn as vector rectangles carrying no text, so
they cannot be anchored to. Two approaches were tried:

- **Estimating the outer edges from the printed separators** (`Slots`). Wrong by
  up to 25 points on Section H, because the year cells are narrower than the day
  cells and nothing in the text says so.
- **Reading the rectangles the form draws** (`CellGrid`). Exact, and it returns
  one box *per cell*: a value centred across a two-cell group printed each digit
  half over the divider between them, which is a keying error waiting to happen.

`CellGrid` also caught that Section C's due date is a **six**-cell `MM / DD / YY`
grid printed to the *right* of its label, not an eight-cell one above it. A
four-digit year written into it would have put the century in the day cells.

---

### Canonical schema gaps this work identified

Both are real-world facts, neither is named after a form.

- **`household.pregnancy.person_name`** — *added*. H1010 Section C asks "If yes,
  who?" and H3037 asks it twice. One intake answer, three printed boxes, two
  government forms.
- **`household.pregnancy.due_date`** — *added*. Asked by H1010 Section C.
  Deliberately not printed on H3037, where it is the clinician's to attest.
- **`income.self_employment.*`** — *identified, not added*. H1049 needs the
  person, months covered, a description of the work, and an expense/income
  ledger. Today self-employment is a gateway boolean with no detail rows
  (`PROGRESS.md` §7 blocker 5), so H1049 has nothing to fill from. Adding it
  means a canonical collection **and** the intake questions to populate it —
  every mapped key must be reachable from an intake path.

Neither pregnancy field is reachable from the Texas intake yet, so the boxes
they fill on H1010 and H3037 stay blank until those two questions are added.
