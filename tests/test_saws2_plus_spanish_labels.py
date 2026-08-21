#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""The Spanish labels the guide quotes must be the Spanish form's own words.

`web/src/lib/printed-labels.ts` holds quotations of the printed page, keyed by
document language. A Spanish applicant holds the official Spanish form, so the
guide must quote *its* text — not a translation of the English form's text,
which would look right and be unfindable.

These tests re-extract the strings from the official fillable Spanish CDSS PDF
in this repository and fail if the checked-in quotations drift away from it. The
government PDFs themselves are never modified.

Asserting "the Spanish differs from the English" would be nearly worthless: a
hand translation also differs. So every assertion is against text actually
present in the Spanish document.
"""

from __future__ import annotations

import re
from pathlib import Path

import pypdf
import pytest

REPO = Path(__file__).resolve().parent.parent
ES_FORM = REPO / "src/benefits_navigator/forms/CA-SAWS-2-PLUS-ES.pdf"
EN_FORM = REPO / "src/benefits_navigator/forms/CA-SAWS-2-PLUS.pdf"
LABELS_TS = REPO / "web/src/lib/printed-labels.ts"


def _normalize(value: str) -> str:
    """Collapse whitespace so line wrapping in the PDF does not matter."""
    return re.sub(r"\s+", " ", value).strip().upper()


@pytest.fixture(scope="module")
def spanish_text() -> str:
    reader = pypdf.PdfReader(str(ES_FORM))

    return _normalize(
        " ".join((page.extract_text() or "") for page in reader.pages)
    )


@pytest.fixture(scope="module")
def english_text() -> str:
    reader = pypdf.PdfReader(str(EN_FORM))

    return _normalize(
        " ".join((page.extract_text() or "") for page in reader.pages)
    )


@pytest.fixture(scope="module")
def checked_in_spanish() -> dict[str, str]:
    """Every `es:` quotation in printed-labels.ts, by its key."""
    source = LABELS_TS.read_text()
    entries: dict[str, str] = {}

    # key: { en: '...', es: '...' } — on one line or several, since prettier
    # collapses short entries and a layout change must not silently drop an
    # entry out of this fixture and out of every test that depends on it.
    for match in re.finditer(
        r"(\w+):\s*\{\s*en:\s*'((?:[^'\\]|\\.)*)',\s*es:\s*'((?:[^'\\]|\\.)*)'",
        source,
    ):
        entries[match.group(1)] = match.group(3).replace("\\'", "'")

    return entries


def test_the_spanish_form_is_present_and_fillable():
    reader = pypdf.PdfReader(str(ES_FORM))

    assert len(reader.pages) == 29
    assert len(reader.get_fields() or {}) > 1400, "must be a real AcroForm"


def test_the_spanish_form_is_the_same_revision_as_the_english_one(
    spanish_text, english_text
):
    """Quoting a different revision's wording would be quoting another form.

    The Spanish footer carries an (SP) marker — "SAWS 2 PLUS (SP) (4/15)" — so
    the revision is checked rather than the whole footer string.
    """
    assert "SAWS 2 PLUS (SP) (4/15)" in spanish_text
    assert "SAWS 2 PLUS (4/15)" in english_text


def test_every_checked_in_spanish_quotation_was_found(checked_in_spanish):
    """The extractor must actually have parsed the file."""
    assert len(checked_in_spanish) >= 19, checked_in_spanish


def test_every_spanish_quotation_appears_in_the_spanish_form(
    checked_in_spanish, spanish_text
):
    """The real assertion: each quotation is text the Spanish PDF contains."""
    missing = [
        f"{key}: {value}"
        for key, value in checked_in_spanish.items()
        if _normalize(value) not in spanish_text
    ]

    assert not missing, (
        "these Spanish quotations are not in CA-SAWS-2-PLUS-ES.pdf — they were "
        "translated rather than extracted:\n  " + "\n  ".join(missing)
    )


def test_the_spanish_quotations_are_not_merely_the_english_ones(
    checked_in_spanish, english_text
):
    """A guard against an en value being pasted into the es slot."""
    for key, value in checked_in_spanish.items():
        # Short shared tokens (EIN, SAWS) legitimately appear in both.
        if len(value) < 25:
            continue

        assert _normalize(value) not in english_text, (
            f"{key} holds English text in its Spanish slot"
        )


@pytest.mark.parametrize(
    "spanish_fragment",
    [
        # Spot-checks of headings the completion guide points at, taken from the
        # Spanish form's own pages.
        "INFORMACIÓN DEL SOLICITANTE",
        "INFORMACIÓN DEL HOGAR",
        "NÚMERO DE SEGURO SOCIAL",
        "FIRMA DEL SOLICITANTE",
        "HISTORIAL DE EMPLEO",
        "NOMBRE DEL EMPLEADO",
    ],
)
def test_spot_checked_headings_exist_in_the_spanish_form(
    spanish_fragment, spanish_text
):
    assert _normalize(spanish_fragment) in spanish_text


def test_the_english_form_has_no_acroform_fields_removed():
    """Guard: the Spanish asset must not have been swapped for the English one."""
    en_fields = set(pypdf.PdfReader(str(EN_FORM)).get_fields() or {})
    es_fields = set(pypdf.PdfReader(str(ES_FORM)).get_fields() or {})

    assert en_fields != es_fields or len(en_fields) == 0, (
        "the two templates have identical field sets, which suggests one file "
        "was copied over the other"
    )
