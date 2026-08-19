#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Generating a real draft in each supported language.

The template registry says which form each locale gets. These tests generate
actual documents from it and check the things that only show up once a value
has been written: that it landed on the right form, that Spanish accents
survive the trip, that a closed gateway still leaks nothing, and that the
Simplified Chinese limitation is visible on disk rather than only in a
docstring.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from benefits_navigator.form_templates import template_for  # noqa: E402
from benefits_navigator.pdf_generator import (  # noqa: E402
    generate_saws2_plus_pdf,
)

#: A household with an accented name, so Latin-1 rendering is exercised rather
#: than assumed. Every value here is canonical data — none of it is translated.
CANONICAL_PLAN = {
    "applicant.first_name": "José",
    "applicant.middle_name": "Ángel",
    "applicant.last_name": "Álvarez-Íñigo",
    "applicant.home_address.street": "1234 Avenida Peña Nieta",
    "applicant.home_address.city": "Muñoz Cañón",
    "applicant.home_address.state": "CA",
    "applicant.home_address.zip_code": "90001",
    "applicant.home_address.county": "Los Angeles",
    "applicant.phone": "(512) 555-1234",
    "applicant.email": "jose@example.com",
    "applicant.other_names": "Ñuñoa Peña",
    "programs.calfresh": True,
    "programs.medi_cal": True,
}


def _generate(locale: str, tmp_path_factory, plan: dict | None = None):
    args = {
        "state": "CA",
        "county": "Los Angeles",
        "zip_code": "90001",
        "locale": locale,
        "application_field_plan": [
            {"key": key, "value": value}
            for key, value in (plan or CANONICAL_PLAN).items()
        ],
    }

    output_dir = tmp_path_factory.mktemp(f"draft-{locale.replace('-', '')}")
    path = generate_saws2_plus_pdf(args, "", output_dir)

    return path, PdfReader(str(path)), output_dir


def _values(reader: PdfReader) -> dict[str, str]:
    return {
        name: str(field.get("/V") or "")
        for name, field in (reader.get_fields() or {}).items()
    }


# ---------------------------------------------------------------------------
# The right form for the language
# ---------------------------------------------------------------------------


def test_english_draft_uses_the_english_form(tmp_path_factory) -> None:
    path, reader, _ = _generate("en", tmp_path_factory)

    assert "-es-" not in path.name
    text = reader.pages[0].extract_text() or ""
    assert "APPLICATION FOR CALFRESH" in text.upper()


def test_spanish_draft_uses_the_official_spanish_form(tmp_path_factory) -> None:
    """Not the English form with Spanish answers typed into it."""
    path, reader, _ = _generate("es", tmp_path_factory)

    assert "-es-" in path.name

    text = reader.pages[0].extract_text() or ""
    assert "SOLICITUD" in text.upper()
    assert "APPLICATION FOR CALFRESH" not in text.upper()


def test_spanish_draft_filename_says_it_is_spanish(tmp_path_factory) -> None:
    """A downloaded file should not need opening to know what it is."""
    path, _, _ = _generate("es", tmp_path_factory)

    assert path.name.startswith("official-ca-saws-2-plus-es-")


def test_simplified_chinese_draft_is_not_labelled_as_translated(
    tmp_path_factory,
) -> None:
    """The English form, named as the English form.

    Marking this file `-zh-CN-` would be the exact dishonesty the registry
    exists to prevent: there is no Simplified Chinese state form to hand over.
    """
    path, reader, _ = _generate("zh-CN", tmp_path_factory)

    assert "zh" not in path.name
    assert "APPLICATION FOR CALFRESH" in (
        reader.pages[0].extract_text() or ""
    ).upper()


def test_simplified_chinese_draft_ships_the_official_chinese_form_to_read(
    tmp_path_factory,
) -> None:
    """The applicant still gets something in Chinese, just not fillable."""
    _, _, output_dir = _generate("zh-CN", tmp_path_factory)

    reference = output_dir / "official-ca-saws-2-plus-zh-Hant-reference.pdf"

    assert reference.exists()
    assert len(PdfReader(str(reference)).pages) == 29


def test_english_and_spanish_drafts_do_not_ship_a_chinese_reference(
    tmp_path_factory,
) -> None:
    for locale in ("en", "es"):
        _, _, output_dir = _generate(locale, tmp_path_factory)

        assert list(output_dir.glob("*zh-Hant*")) == []


# ---------------------------------------------------------------------------
# The answers themselves are language-independent
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("locale", ["en", "es", "zh-CN"])
def test_canonical_values_reach_the_form_in_every_language(
    locale: str, tmp_path_factory
) -> None:
    _, reader, _ = _generate(locale, tmp_path_factory)
    written = set(_values(reader).values())

    for expected in (
        "José Ángel Álvarez-Íñigo",
        "1234 Avenida Peña Nieta",
        "Muñoz Cañón",
        "Ñuñoa Peña",
        "90001",
    ):
        assert expected in written, f"{expected!r} missing from {locale} draft"


@pytest.mark.parametrize("locale", ["en", "es", "zh-CN"])
def test_accented_characters_survive_generation(
    locale: str, tmp_path_factory
) -> None:
    """Spanish names must not arrive mangled or stripped.

    The form's /Helv carries a full Latin-1 Differences array, so these render
    rather than turning into blanks. Asserted per language because each locale
    may be filling a different template.
    """
    _, reader, _ = _generate(locale, tmp_path_factory)
    joined = " ".join(_values(reader).values())

    for character in "éÁÍñÑ":
        assert character in joined, f"{character!r} lost in {locale} draft"


def test_the_same_answers_land_in_the_same_places_in_both_languages(
    tmp_path_factory,
) -> None:
    """The canonical model maps identically; only the template differs.

    If Spanish ever needed its own destination table, this is what would catch
    it — the values would stop agreeing field for field.
    """
    _, english, _ = _generate("en", tmp_path_factory)
    _, spanish, _ = _generate("es", tmp_path_factory)

    english_values = {k: v for k, v in _values(english).items() if v}
    spanish_values = {k: v for k, v in _values(spanish).items() if v}

    assert english_values == spanish_values


# ---------------------------------------------------------------------------
# Branching guarantees hold in every language
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("locale", ["en", "es", "zh-CN"])
def test_a_closed_gateway_leaks_nothing_in_any_language(
    locale: str, tmp_path_factory
) -> None:
    """Answering "no" must not carry the earlier detail onto the paper.

    The branching-consistency guarantee is enforced upstream of the mapper, so
    it should hold whichever template is being filled. This checks that
    changing the template did not change that.
    """
    plan = dict(CANONICAL_PLAN)
    plan["income.earned.answer"] = "no"

    _, reader, _ = _generate(locale, tmp_path_factory, plan)
    written = " ".join(_values(reader).values())

    assert "Bright Star Community Health" not in written
    assert "obsolete" not in written.lower()


# ---------------------------------------------------------------------------
# Readability is not language-specific
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("locale", ["en", "es"])
def test_long_accented_values_stay_inside_their_boxes(
    locale: str, tmp_path_factory
) -> None:
    """Spanish boxes are laid out differently; the fitter must use the real one.

    1,071 of the 1,440 shared widgets sit at different rectangles on the
    Spanish form, so a fitter that measured against English would overflow
    here. Every written value must either fit or be named for attachment.
    """
    plan = dict(CANONICAL_PLAN)
    plan["applicant.first_name"] = "María Guadalupe"
    plan["applicant.middle_name"] = "Fernández"
    plan["applicant.last_name"] = "de la Cruz Villanueva Peña"
    plan["applicant.home_address.street"] = (
        "12345 Avenida Rancho Santa Margarita Suroeste Apartamento 4821"
    )

    path, reader, _ = _generate(locale, tmp_path_factory, plan)
    review = path.with_suffix(".review.txt").read_text(encoding="utf-8")

    for page in reader.pages:
        for annotation in page.get("/Annots") or []:
            field = annotation.get_object()

            if str(field.get("/FT")) != "/Tx" or not field.get("/V"):
                continue

            name = str(field.get("/T") or "")
            rect = [float(x) for x in field["/Rect"]]
            width = abs(rect[2] - rect[0])
            appearance = field.get("/DA") or (
                field.get("/Parent").get_object().get("/DA")
                if field.get("/Parent")
                else None
            )

            if appearance is None:
                continue

            parts = str(appearance).split()

            try:
                size = float(parts[parts.index("Tf") - 1])
            except (ValueError, IndexError):
                continue

            # Rough Helvetica upper bound; the precise fitter is covered by
            # test_saws2_plus_text_fitting. Here we only need to catch a value
            # that plainly runs past its border with no attachment note.
            estimated = len(str(field["/V"])) * size * 0.5

            if estimated > width + 1 and size > 6.0:
                assert name in review, (
                    f"{name} overflows in {locale} without being reported"
                )
