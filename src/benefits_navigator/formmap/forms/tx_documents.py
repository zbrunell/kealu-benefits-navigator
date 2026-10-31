#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The official Texas HHSC documents this repository holds.

One record per file, each stating what the file is rather than what we wish it
were. Read with :mod:`benefits_navigator.formmap.provenance`, which refuses to
open any of them if the bytes have changed.

── How these were obtained ────────────────────────────────────────────────
By hand, through the Your Texas Benefits paper-form catalog, on 4 September
2026. That is worth recording precisely, because the previous handoff concluded
the H1010 PDF could not be obtained at all and that conclusion has now expired
in one direction but not the other:

* **What changed.** Your Texas Benefits publishes a "Get a paper form" catalog
  that serves the documents. It is an AngularJS application that fetches its
  form list client-side, so the catalog still cannot be *enumerated*
  programmatically — but a person can work through it and download the files,
  which is how these five arrived.
* **What did not change.** Direct retrieval is still blocked. Re-verified 4
  September 2026: ``www.hhs.texas.gov/sites/default/files/...`` answers 403,
  and ``fhb.hhs.texas.gov/sites/default/files/...`` answers **200 with an
  Akamai "Access Denied" HTML body** — which is worth flagging to whoever tries
  next, because a script checking the status code alone will conclude it
  downloaded a PDF and write 199 KB of HTML into the forms directory.

HHSC's own form index at ``fhb.hhs.texas.gov/forms/...`` *is* readable, and is
where the catalog metadata below (effective dates, official titles, purpose,
which languages are published) was read from on the same date.

── Two revision numbers, and why both are kept ────────────────────────────
For three of these five files, what HHSC's index calls the current revision and
what the document prints on itself do **not** agree:

===================  ==================  ==================  ================
Document             printed on the PDF  HHSC index says     status
===================  ==================  ==================  ================
H1010 / H1010-S      08/2026             effective 6/2026    current
H3037                04/2003             effective 4/2003    current
H1049                12/2001             effective 12/2015   **unresolved**
H1028-MBIC           12/2015             effective 9/2024    **superseded**
===================  ==================  ==================  ================

The H1010 file prints a *later* date than the index's effective date, which is
ordinary — the index page tracks when the policy took effect and lags the
document. The other two run the wrong way, and they are not the same problem:

* **H1049** may well be fine. HHSC form pages routinely carry an effective date
  for the *procedure* while the printed form keeps its original footer, and a
  fourteen-year-old footer on a self-employment worksheet is not implausible.
  We could not settle it: retrieving HHSC's own ``H1049.pdf`` to compare was
  blocked. Recorded as unresolved rather than assumed either way.
* **H1028-MBIC** is a nine-year gap against an explicit, more recent effective
  date, and is treated as superseded. See
  :data:`TX_H1028_MBIC_EN` — it is registered so the catalog is honest about
  the form existing, and deliberately barred from being a production base
  document until the current revision is in hand.

── What "Spanish" turned out to mean ──────────────────────────────────────
The four forms were expected to divide into English-only and English-plus-
Spanish. They do not, and the difference matters to the resolver:

* **H1010** genuinely has two distinct PDFs. Texas publishes a separate English
  and Spanish document; HHSC designates the Spanish one *Form H1010-S*. The two
  files differ in size, hash, field names and geometry — the same printed
  question sits at a different x on each — so they are two layouts and get two
  independent sets of coordinates. A Spanish applicant is handed the Spanish
  file, never the English one; see
  :func:`benefits_navigator.formmap.documents.resolve_document`.
* **H1049 and H3037 are single bilingual documents.** The official form prints
  its questions in English with the Spanish translation beneath, in one file.
  Texas exposes each through language-specific catalog links, but those links
  resolve to the same bilingual PDF — re-verified by hand on 6 September 2026,
  when the Spanish-link download was again byte-identical to the English-link
  one (``c36e0710…`` for H1049, ``8b9c6704…`` for H3037). So the application
  retains **one** canonical asset per form and reports it as bilingual.

  This is emphatically not "Spanish content does not exist". It does, in
  HHSC's own wording, on HHSC's own paper — it is simply printed in the same
  document as the English. Retaining a second byte-identical file under an
  ``-ES-`` name would have asserted a separate Spanish edition, which is the
  one thing checking established to be untrue, and would have let a future
  reader believe a Spanish reader was being served a fallback.
* **H1028-MBIC is English only**, which HHSC's index confirms — it lists no
  Spanish filename, and the Your Texas Benefits catalog carries an explicit
  ``paperFormDialogForDownloadSpanishDisabled`` state for forms like it.
"""

from __future__ import annotations

from datetime import date

from benefits_navigator.formmap.provenance import (
    Fillability,
    OfficialDocument,
)

#: HHSC's form index, where the catalog metadata below was read.
_INDEX = "https://fhb.hhs.texas.gov/forms"

#: The catalog page a person downloads the documents through.
_CATALOG_EN = "https://www.yourtexasbenefits.com/Learn/GetPaperForm?lang=en_US"
_CATALOG_ES = "https://www.yourtexasbenefits.com/Learn/GetPaperForm?lang=es_ES"

_RETRIEVED = date(2026, 9, 4)


TX_H1010_EN = OfficialDocument(
    filename="TX-H1010-EN-2026-08.pdf",
    sha256="926fbe091d7ad466a2a0f9df70e49ca2fae5745c8d4825bd4a7dfd1ed814157c",
    byte_size=2703107,
    page_count=34,
    page_width=612.0,
    page_height=792.0,
    languages=("en",),
    fillability=Fillability.XFA_PARTIAL,
    printed_revision="08/2026",
    catalog_revision="6/2026",
    source_url=_CATALOG_EN,
    retrieved_on=_RETRIEVED,
    downloaded_as="H1010_Aug2026.pdf",
    notes=(
        "34 pages: 1-4 instructions, 5-25 the H1010 application itself "
        "(printed 'Page 1'-'Page 21'), 26-34 the H1010-M Medicaid/CHIP "
        "addendum and Appendices A-C. An XFA (LiveCycle Designer 6.5) form "
        "whose AcroForm layer is nearly empty: of 97 widget annotations, most "
        "are the per-page QR barcode. Only three usable text fields exist on "
        "the whole document (the contact-preference boxes on printed Page 17) "
        "and the rest are checkboxes concentrated in the addendum. The "
        "application pages are designed to be completed by hand -- 'Please use "
        "dark ink. Please print. Fill in the circles.' Native-field filling is "
        "therefore not a route for anything we map; every value is overlaid."
    ),
)


TX_H1010_ES = OfficialDocument(
    filename="TX-H1010-ES-2026-08.pdf",
    sha256="5baefe5849ad93543ceeee234190bf1269984b5327699cc762df9e60e19a16ec",
    byte_size=2163057,
    page_count=34,
    page_width=612.0,
    page_height=792.0,
    languages=("es",),
    fillability=Fillability.XFA_PARTIAL,
    printed_revision="08/2026",
    catalog_revision="6/2026",
    source_url=_CATALOG_ES,
    retrieved_on=_RETRIEVED,
    downloaded_as="H1010_Aug2026_SPANISH.pdf",
    notes=(
        "HHSC designates this edition Form H1010-S. Same page count as the "
        "English edition and the same section order, but NOT the same layout: "
        "the AcroForm field names differ (CheckBox1 where English has "
        "CheckBox5), the English edition's three text fields do not exist here "
        "at all -- the contact-preference question is checkboxes instead -- "
        "and printed questions sit at different coordinates (a checkbox at "
        "x=140.7 on English page 31 is at x=195.5 here). Coordinates measured "
        "against the English edition are wrong on this one, which is why each "
        "variant carries its own complete target map."
    ),
)


TX_H1049_BILINGUAL = OfficialDocument(
    filename="TX-H1049-BI-2001-12.pdf",
    sha256="c36e071028b7c7c00fb8d62ea5d0ce3b6c4daa95161b3df4552fdef980370752",
    byte_size=32909,
    page_count=2,
    page_width=612.0,
    page_height=792.0,
    languages=("en", "es"),
    fillability=Fillability.FLAT,
    printed_revision="12/2001",
    catalog_revision="12/2015",
    source_url=f"{_INDEX}/1000-1999/form-h1049-clients-statement-self-employment-income",
    retrieved_on=_RETRIEVED,
    downloaded_as="H1049_Nov2014.pdf",
    notes=(
        "Officially bilingual: every question, instruction and privacy notice "
        "is printed in English with the Spanish translation beneath it, in "
        "this one document. Page 1 is the client's statement (name, months "
        "covered, description of the work, and a two-column expense / income "
        "ledger with totals); page 2 is instructions in both languages. "
        "A flat PDF with no form fields of any kind -- produced by Acrobat "
        "PDFWriter 3.02 from Word -- so overlay is the only filling route. "
        "ONE CANONICAL ASSET BY DESIGN: Texas offers this form through both an "
        "English and a Spanish catalog link, and both resolve to these exact "
        "bytes (re-verified 6 September 2026). English and Spanish applicants "
        "therefore receive this same file, and the resolver reports it as "
        "BILINGUAL rather than as an English fallback. "
        "REVISION UNRESOLVED: the document prints 12-2001 while HHSC's index "
        "gives an effective date of 12/2015; retrieving HHSC's own copy to "
        "compare was blocked."
    ),
)


TX_H3037_BILINGUAL = OfficialDocument(
    filename="TX-H3037-BI-2003-04.pdf",
    sha256="8b9c6704ec9c1cb217181cba3299cab3b6519f302d1561852f76f3d8a5c5020f",
    byte_size=18968,
    page_count=2,
    page_width=612.0,
    page_height=792.0,
    languages=("en", "es"),
    fillability=Fillability.FLAT,
    printed_revision="04/2003",
    catalog_revision="4/2003",
    source_url=f"{_INDEX}/3000-3999/form-h3037-report-pregnancy",
    retrieved_on=_RETRIEVED,
    downloaded_as="H3037_Nov2014.pdf",
    # Bilingual, but only on the page the client signs. See the field's own
    # docstring in provenance.py for why this is a key and not a sentence.
    language_scope_key="form_document_bilingual_scope_signature_page_only",
    notes=(
        "The one document here whose printed revision and HHSC's effective "
        "date agree exactly. Officially bilingual, and the split matters: page "
        "1 -- the Report of Pregnancy that a medical professional completes -- "
        "is English only, while page 2, the authorization to release medical "
        "information that the *client* signs, is printed in English with the "
        "Spanish beneath. So a Spanish-reading applicant can read and sign the "
        "part that is theirs, which is why this is declared es-serving; the "
        "English-only clinician page is named by language_scope_key so no "
        "surface can overstate it. Flat PDF, no form fields, overlay only. "
        "ONE CANONICAL ASSET BY DESIGN: Texas offers this form through both an "
        "English and a Spanish catalog link, and both resolve to these exact "
        "bytes (re-verified 6 September 2026). Note that HHSC's procedure has "
        "three parties touching this form: an HHSC advisor prepares the patient "
        "and case details, a medical professional completes the clinical items, "
        "and the client signs the release."
    ),
)


TX_H1028_MBIC_EN = OfficialDocument(
    filename="TX-H1028-MBIC-EN-2015-12.pdf",
    sha256="c53a6b82a5070ddbe8ce2b9f116a9e4f5d4270ce712a167066bdda48ce64a3bb",
    byte_size=1506319,
    page_count=2,
    page_width=612.0,
    page_height=792.0,
    languages=("en",),
    fillability=Fillability.XFA_PARTIAL,
    printed_revision="12/2015",
    catalog_revision="9/2024",
    source_url=(
        f"{_INDEX}/1000-1999/"
        "form-h1028-mbic-employment-verification-medicaid-buy-children"
    ),
    retrieved_on=_RETRIEVED,
    downloaded_as="H1028-MBIC_Dec2015.pdf",
    notes=(
        "SUPERSEDED -- held for reference, not for filling. The document "
        "prints 12-2015; HHSC's index gives an effective date of 9/2024. A "
        "nine-year gap against an explicit later effective date is not the "
        "benign catalog lag seen on H1049, so this file is registered in the "
        "catalog (the form is real and belongs in a household's packet when "
        "MBIC applies) but is barred from being a production base document "
        "until the 9/2024 revision is obtained. "
        "Also note this is NOT Form H1028, Employment Verification. That is a "
        "separate form (effective 7/2022, published in English and Spanish) "
        "which HHSC prepares when TIERS is unavailable. H1028-MBIC is narrower: "
        "employment and job-related health insurance verification for Medicaid "
        "Buy-In for Children only, given to the employer by the parent. "
        "XFA form. Its only usable text fields are the employee name, the "
        "employee SSN -- which we refuse to collect -- and a date; every other "
        "field is the employer's to complete."
    ),
)


#: Every Texas document this repository holds, for registry-wide checks.
TX_DOCUMENTS: tuple[OfficialDocument, ...] = (
    TX_H1010_EN,
    TX_H1010_ES,
    TX_H1049_BILINGUAL,
    TX_H3037_BILINGUAL,
    TX_H1028_MBIC_EN,
)


class DuplicateAssetError(ValueError):
    """Two canonical documents that are the same bytes under two names.

    Raised by :func:`check_no_duplicate_assets`, and the specific mistake it
    exists to stop is the one this catalog already made once: keeping
    ``TX-H1049-ES-2001-12.pdf`` beside ``TX-H1049-BI-2001-12.pdf`` because
    Texas serves the form from an English link and a Spanish link.

    Two files with identical bytes are not two editions. Retaining both models
    a Spanish edition that does not exist as a separate document, and gives two
    metadata records that point at the same bytes and can silently drift out of
    agreement about page counts, revisions or which languages are served. A
    genuinely bilingual document is expressed as one asset with
    ``languages=("en", "es")``, which is what the resolver reads.
    """


def check_no_duplicate_assets(
    documents: tuple[OfficialDocument, ...] = (),
) -> tuple[str, ...]:
    """Problems where two canonical documents share one set of bytes.

    Returns rather than raises so a test can report every collision in one run.
    Deliberately narrow: it compares the recorded digests of *these* document
    records and nothing else. A repository-wide duplicate-file scan would flag
    legitimate coincidences and would not have caught this bug any earlier,
    because the duplicate was declared in metadata before it was a problem.
    """
    documents = documents or TX_DOCUMENTS
    by_digest: dict[str, list[OfficialDocument]] = {}

    for document in documents:
        by_digest.setdefault(document.sha256, []).append(document)

    problems: list[str] = []

    for digest, group in sorted(by_digest.items()):
        if len(group) < 2:
            continue

        names = ", ".join(sorted(entry.filename for entry in group))

        problems.append(
            f"{names} are byte-identical (sha256 {digest[:12]}...). If this is "
            f"one officially bilingual document served from several "
            f"language-specific catalog links, keep a single asset and declare "
            f"every language it prints in its `languages` tuple. Two records "
            f"for one file assert editions that do not exist and can drift "
            f"apart."
        )

    return tuple(problems)
