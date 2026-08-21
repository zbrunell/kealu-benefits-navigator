#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Multilingual answers have to be *visible*, not merely present.

An AcroForm text field carries two things: the value (``/V``) and a cached
appearance stream describing how to draw it. pypdf can only build that stream
with the font the form declares, and SAWS 2 PLUS declares Helvetica — which has
no CJK glyphs. Left there, a Chinese name would round-trip perfectly through
``/V`` and print as blank space or tofu.

``/NeedAppearances true`` is what prevents that: it tells the viewer to ignore
the cached appearance and redraw every field with its own fonts. It is the only
reason CJK renders at all, and it avoids embedding — and licensing — a CJK font.

These tests pin that flag, because nothing else in the suite would notice if it
disappeared: every value assertion reads ``/V`` and would still pass while the
printed page came out empty.
"""

from __future__ import annotations

import pathlib
import tempfile

import pytest
from pypdf import PdfReader

from benefits_navigator.pdf_generator import generate_saws2_plus_pdf

#: Names that exercise the two scripts beyond ASCII this product serves.
CJK_NAME = "李明"
SPANISH_NAME = "Núñez-Peña"


def _generate(values: dict) -> pathlib.Path:
    plan = [
        {"key": "applicant.table", "value": "adult"},
        {"key": "applicant.table_row", "value": 0},
        {"key": "household.members.count", "value": 0},
    ]
    plan += [{"key": k, "value": v} for k, v in values.items()]

    return generate_saws2_plus_pdf(
        {
            "state": "CA",
            "county": "Los Angeles",
            "zip_code": "90001",
            "application_field_plan": plan,
        },
        "",
        pathlib.Path(tempfile.mkdtemp()),
    )


@pytest.fixture(scope="module")
def multilingual_pdf() -> PdfReader:
    return PdfReader(
        str(
            _generate(
                {
                    "applicant.first_name": CJK_NAME,
                    "applicant.last_name": SPANISH_NAME,
                    "applicant.date_of_birth": "1990-01-01",
                }
            )
        )
    )


def test_viewers_are_told_to_regenerate_appearances(multilingual_pdf):
    """The flag that makes non-Latin text render. Without it, a Chinese name is
    stored correctly and printed as nothing."""
    acro = multilingual_pdf.trailer["/Root"].get("/AcroForm")

    assert acro is not None, "the output must still be a fillable form"

    flag = acro.get("/NeedAppearances")

    # pypdf hands back a BooleanObject, not the `True` singleton.
    assert flag is not None, "/NeedAppearances must be present, not merely truthy"
    assert bool(flag) is True


def test_cjk_survives_into_the_field_value(multilingual_pdf):
    fields = multilingual_pdf.get_fields() or {}

    assert CJK_NAME in str(fields["Text1 PG 1"].get("/V"))


def test_spanish_accents_survive_into_the_field_value(multilingual_pdf):
    fields = multilingual_pdf.get_fields() or {}
    value = str(fields["Text1 PG 1"].get("/V"))

    # Not mangled to "Nunez-Pena" or "N??ez-Pe?a".
    assert SPANISH_NAME in value
    assert "?" not in value


def test_the_household_row_carries_both_scripts(multilingual_pdf):
    """The Q6 adult row writes "Last, First", so one cell holds both scripts."""
    fields = multilingual_pdf.get_fields() or {}
    row = str(fields["Text5 PG 3"].get("/V"))

    assert CJK_NAME in row
    assert SPANISH_NAME in row


def test_the_spanish_template_also_regenerates_appearances():
    """The Spanish official form is a different asset and needs the same flag."""
    pdf = _generate(
        {
            "applicant.first_name": SPANISH_NAME,
            "applicant.locale": "es",
        }
    )
    acro = PdfReader(str(pdf)).trailer["/Root"].get("/AcroForm")

    assert acro is not None

    flag = acro.get("/NeedAppearances")

    assert flag is not None
    assert bool(flag) is True


# ---------------------------------------------------------------------------
# The entry point, not just the generator
# ---------------------------------------------------------------------------


def test_the_real_entry_point_sets_the_flag_for_a_california_application():
    """The flag above is set by ``generate_saws2_plus_pdf``. This checks that
    the function the web app actually calls routes there.

    ``form_filler.generate_application`` has a second path,
    ``fill_official_form``, which fills with ``auto_regenerate=False`` and so
    produces a PDF with no ``/NeedAppearances``. A Chinese name written through
    that path would be stored correctly and print as nothing. This pins which
    path a California application with a field plan takes, so the CJK guarantee
    cannot be lost by a change in routing rather than in the generator.
    """
    from benefits_navigator.form_filler import generate_application

    args = {
        "state": "CA",
        "county": "Los Angeles",
        "zip_code": "90001",
        "locale": "zh-CN",
        "application_field_plan": [
            {"key": "applicant.first_name", "value": CJK_NAME},
            {"key": "applicant.home_address.state", "value": "CA"},
            {"key": "applicant.home_address.zip_code", "value": "90001"},
        ],
    }

    with tempfile.TemporaryDirectory() as tmp:
        path, form_type = generate_application(args, "", pathlib.Path(tmp))

        assert form_type == "official"

        reader = PdfReader(str(path))
        acro = reader.trailer["/Root"].get("/AcroForm")

        assert acro is not None, "the entry point must produce a fillable form"

        flag = acro.get("/NeedAppearances")

        assert flag is not None, (
            "the path the web app takes must set /NeedAppearances; without it a "
            "CJK value is stored and printed blank"
        )
        assert bool(flag) is True
