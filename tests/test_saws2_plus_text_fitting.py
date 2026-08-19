#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Every written value has to be readable on the printed page.

The failure this guards is quiet. A value too wide for its box is not reported
by any AcroForm API — it simply renders clipped, so a name becomes "Maria
Guadalupe Fernandez de la C" on a document the applicant signs, and nothing
anywhere says so.

So these tests measure. They render each value with the real Helvetica metrics
at the size the field will actually use, and assert it fits inside the widget
rectangle — width for a single-line field, wrapped height for a multiline one.
Asserting that a string was assigned to a widget would pass in every one of
these cases.
"""

from __future__ import annotations

import pytest

from benefits_navigator.pdf_generator import (
    _FIELD_PADDING,
    _MIN_FONT_SIZE,
    _fits,
    _helvetica_width,
    _largest_size_that_fits,
    _wrap_to_width,
    _FORMS_DIR,
    generate_saws2_plus_pdf,
    inspect_pdf_form,
)

PDF = _FORMS_DIR / "CA-SAWS-2-PLUS.pdf"


# ---------------------------------------------------------------------------
# The fitting primitives
# ---------------------------------------------------------------------------


def test_a_value_that_already_fits_keeps_its_declared_size():
    assert _largest_size_that_fits("Maria", 10, 200, 15, False) == 10


def test_a_long_value_is_shrunk_rather_than_clipped():
    fitted = _largest_size_that_fits("01/01/1990", 10, 47.9, 15, False)

    assert fitted is not None
    assert fitted < 10
    assert _fits("01/01/1990", fitted, 47.9, 15, False)


def test_the_size_chosen_is_the_largest_that_fits():
    """Not merely *a* size that fits — readability is the point."""
    text = "Maria Guadalupe Fernandez de la Cruz"
    fitted = _largest_size_that_fits(text, 10, 120, 15, False)

    assert fitted is not None
    # A hundredth of a point larger must not fit.
    assert not _fits(text, fitted + 0.01, 120, 15, False)


def test_nothing_is_shrunk_below_the_legible_floor():
    """A box far too small reports failure instead of rendering 2pt text."""
    text = "x" * 400

    assert _largest_size_that_fits(text, 10, 40, 12, False) is None


def test_a_single_line_value_must_also_fit_the_box_height():
    # 10pt text cannot render inside a 6pt-tall box however wide it is.
    assert not _fits("Maria", 10, 500, 6, False)


# ---------------------------------------------------------------------------
# Wrapping
# ---------------------------------------------------------------------------


def test_wrapping_breaks_on_spaces():
    lines = _wrap_to_width("Hours were cut back after the season ended", 10, 120)

    assert len(lines) > 1
    for line in lines:
        assert _helvetica_width(line, 10) <= 120


def test_wrapping_breaks_inside_a_word_too_wide_to_fit():
    """A 40-character street name in a narrow column has to break somewhere."""
    lines = _wrap_to_width("Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch", 10, 60)

    assert len(lines) > 1
    for line in lines:
        assert _helvetica_width(line, 10) <= 60


def test_wrapping_preserves_every_character():
    text = "Hours were cut back after the summer season ended"
    joined = "".join(_wrap_to_width(text, 10, 200))

    assert joined.replace(" ", "") == text.replace(" ", "")


def test_a_multiline_field_is_measured_by_height_not_width():
    # Three lines of 10pt need ~34.5pt; a 20pt-tall box cannot hold them.
    text = "one two three four five six seven eight nine ten"

    assert not _fits(text, 10, 100, 20, True)
    assert _fits(text, 10, 100, 200, True)


def test_a_multiline_value_is_scaled_when_wrapping_alone_is_not_enough():
    text = "Hours were cut back after the summer season ended and the store closed"
    fitted = _largest_size_that_fits(text, 10, 237, 30, True)

    assert fitted is not None
    assert fitted <= 10
    assert _fits(text, fitted, 237, 30, True)


# ---------------------------------------------------------------------------
# Real generated documents
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def available_fields() -> set[str]:
    return {f["name"] for f in inspect_pdf_form(PDF) if f.get("name")}


#: Values chosen to stress each kind of field a real applicant can overflow.
LONG_VALUES = {
    "long_name": "Maria Guadalupe Fernandez de la Cruz Villanueva",
    "long_street": "12345 Rancho Santa Margarita Parkway Southeast Apartment 4821",
    "long_city": "Rancho Santa Margarita del Mar y Montaña",
    "long_employer": "Bright Star Community Health and Wellness Cooperative Incorporated",
    "long_representative": "Dr Priyanka Venkataraman-Rodriguez, Certified Application Counselor",
    "long_free_text": (
        "The store closed permanently in November after the owner retired, and "
        "the whole team was let go with two weeks notice at the same time."
    ),
}


def _generate(plan: dict, tmp_path_factory, name: str):
    """Generate a real PDF, returning its widgets and the review companion."""
    from pypdf import PdfReader

    args = {
        "state": "CA",
        "county": "Los Angeles",
        "zip_code": "90001",
        "application_field_plan": [
            {"key": key, "value": value} for key, value in plan.items()
        ],
    }

    path = generate_saws2_plus_pdf(args, "", tmp_path_factory.mktemp(name))
    review = path.with_suffix(".review.txt").read_text(encoding="utf-8")

    return PdfReader(str(path)), review


def _assert_every_value_fits(reader, review: str) -> None:
    """Every written value either fits its box, or is reported for attachment.

    Both halves matter. Fitting silently is the good case; a value that cannot
    be rendered legibly at the floor size is allowed only because the review
    file names it, which is what turns a clipped answer into an instruction to
    attach the full one.
    """
    for page in reader.pages:
        for annotation in page.get("/Annots") or []:
            field = annotation.get_object()

            if str(field.get("/FT")) != "/Tx":
                continue

            value = str(field.get("/V") or "")

            if not value:
                continue

            appearance = field.get("/DA")
            parent = field.get("/Parent")

            if appearance is None and parent:
                appearance = parent.get_object().get("/DA")

            if appearance is None:
                continue

            parts = str(appearance).split()

            try:
                size = float(parts[parts.index("Tf") - 1])
            except (ValueError, IndexError):
                continue

            if size <= 0:
                continue

            flags = int(
                field.get("/Ff")
                or (parent.get_object().get("/Ff") if parent else 0)
                or 0
            )

            rectangle = [float(bound) for bound in field["/Rect"]]
            width = abs(rectangle[2] - rectangle[0])
            height = abs(rectangle[3] - rectangle[1])

            name = str(field.get("/T"))

            if _fits(value, size, width, height, bool(flags & 4096)):
                continue

            assert name in review, (
                f"{name} = {value!r} does not fit its "
                f"{width:.1f}x{height:.1f}pt box at {size}pt, and the review "
                "file does not tell the applicant to attach it"
            )


def test_a_long_applicant_name_and_address_still_fit(tmp_path_factory):
    reader, review = _generate(
        {
            "applicant.first_name": "Maria Guadalupe",
            "applicant.last_name": "Fernandez de la Cruz Villanueva",
            "applicant.home_address.street": LONG_VALUES["long_street"],
            "applicant.home_address.city": LONG_VALUES["long_city"],
            "applicant.home_address.state": "CA",
            "applicant.home_address.zip_code": "90001",
            "applicant.date_of_birth": "1990-01-01",
        },
        tmp_path_factory,
        "long-applicant",
    )

    _assert_every_value_fits(reader, review)


def test_a_long_employer_name_still_fits(tmp_path_factory):
    reader, review = _generate(
        {
            "income.has_earned_income": True,
            "income.earned.0.person_name": LONG_VALUES["long_name"],
            "income.earned.0.employer_name": LONG_VALUES["long_employer"],
        },
        tmp_path_factory,
        "long-employer",
    )

    _assert_every_value_fits(reader, review)


def test_long_appendix_d_free_text_wraps_inside_its_multiline_box(tmp_path_factory):
    reader, review = _generate(
        {
            "appendices.employment.0.person_name": LONG_VALUES["long_name"],
            "appendices.employment.0.job.0.employer": LONG_VALUES["long_employer"],
            # "Reason for leaving this job?" is a multiline box.
            "appendices.employment.0.job.0.reason_for_leaving": LONG_VALUES[
                "long_free_text"
            ],
        },
        tmp_path_factory,
        "long-appendix-d",
    )

    _assert_every_value_fits(reader, review)


def test_a_long_representative_name_still_fits(tmp_path_factory):
    reader, review = _generate(
        {
            "appendices.representative.name": LONG_VALUES["long_representative"],
            "appendices.representative.address": LONG_VALUES["long_street"],
            "appendices.representative.organization": LONG_VALUES["long_employer"],
        },
        tmp_path_factory,
        "long-representative",
    )

    _assert_every_value_fits(reader, review)


def test_every_long_value_reaches_the_page_in_full(tmp_path_factory):
    """Shrinking must not become truncation by another name."""
    reader, review = _generate(
        {
            "applicant.first_name": "Maria Guadalupe",
            "applicant.last_name": "Fernandez de la Cruz Villanueva",
            "applicant.home_address.city": LONG_VALUES["long_city"],
            "appendices.employment.0.job.0.reason_for_leaving": LONG_VALUES[
                "long_free_text"
            ],
        },
        tmp_path_factory,
        "no-truncation",
    )

    values = {
        str(spec.get("/V"))
        for spec in (reader.get_fields() or {}).values()
        if spec.get("/V")
    }

    assert LONG_VALUES["long_city"] in values
    assert LONG_VALUES["long_free_text"] in values
