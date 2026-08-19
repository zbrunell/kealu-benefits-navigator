#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""What each language's official SAWS 2 PLUS form actually is.

These tests exist because the answer is not the same for Spanish and Chinese,
and the difference is the kind that gets papered over. They assert the facts
about the shipped assets — revision, fillability, script, field agreement — so
that a future change which quietly swaps in the English form for a language it
does not belong to fails here instead of in a county office.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from benefits_navigator.form_templates import (  # noqa: E402
    FORM_REVISION,
    SUPPORTED_LOCALES,
    TEMPLATES,
    normalize_locale,
    template_for,
)
from benefits_navigator.pdf_generator import (  # noqa: E402
    Saws2PlusFieldAdapter,
)


def _read(path: Path) -> PdfReader:
    reader = PdfReader(str(path))

    if reader.is_encrypted:
        # CDSS ships these with an empty user password and owner restrictions.
        reader.decrypt("")

    return reader


def _fields(path: Path) -> dict:
    return _read(path).get_fields() or {}


def _mapped_destinations() -> set[str]:
    """Every PDF field name the adapter is willing to write."""
    out: set[str] = set()

    for name in dir(Saws2PlusFieldAdapter):
        if name.startswith("_"):
            continue

        value = getattr(Saws2PlusFieldAdapter, name)

        if not isinstance(value, dict):
            continue

        for entry in value.values():
            if isinstance(entry, str):
                out.add(entry)
            elif isinstance(entry, (tuple, list)):
                out.update(x for x in entry if isinstance(x, str))

    return out


# ---------------------------------------------------------------------------
# Every shipped asset is the revision we mapped
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("locale", SUPPORTED_LOCALES)
def test_every_template_asset_exists(locale: str) -> None:
    assert template_for(locale).path.exists()


@pytest.mark.parametrize("locale", SUPPORTED_LOCALES)
def test_every_template_is_the_revision_we_mapped(locale: str) -> None:
    """A newer revision may move fields; we must not fill it blind."""
    reader = _read(template_for(locale).path)
    text = reader.pages[0].extract_text() or ""

    assert f"({FORM_REVISION})" in text.replace(" ", "").replace(
        "(4/15)", "(4/15)"
    ) or FORM_REVISION in text


@pytest.mark.parametrize("locale", SUPPORTED_LOCALES)
def test_every_template_has_the_same_page_count(locale: str) -> None:
    assert len(_read(template_for(locale).path).pages) == 29


# ---------------------------------------------------------------------------
# Spanish: a real, official, fillable translation
# ---------------------------------------------------------------------------


def test_spanish_uses_the_official_spanish_form() -> None:
    template = template_for("es")

    assert template.document_language == "es"
    assert template.is_official_translation
    assert template.limitation_key is None
    assert "Spanish" in template.source_url


def test_spanish_form_is_fillable() -> None:
    assert len(_fields(template_for("es").path)) > 1_400


def test_spanish_form_is_actually_spanish() -> None:
    """Printed labels, not just the filename."""
    reader = _read(template_for("es").path)
    text = " ".join((page.extract_text() or "") for page in reader.pages[:8])

    for phrase in ("SOLICITUD", "CONDADO", "NOMBRE"):
        assert phrase in text.upper()


def test_every_field_we_write_exists_on_the_spanish_form() -> None:
    """The mapping is verified against the Spanish template, not assumed.

    Same names are not the same form. This asserts the destinations actually
    resolve there.
    """
    english = set(_fields(template_for("en").path))
    spanish = set(_fields(template_for("es").path))

    # Only names that are genuinely PDF fields — the adapter dicts also carry
    # option labels and semantic keys as values.
    destinations = {d for d in _mapped_destinations() if d in english}

    assert destinations, "no destinations resolved against the English form"
    assert sorted(d for d in destinations if d not in spanish) == []


def test_shared_fields_sit_on_the_same_page_in_both_languages() -> None:
    """Guide page references are only reusable if the pagination agrees."""

    def pages_by_field(path: Path) -> dict[str, list[int]]:
        reader = _read(path)
        out: dict[str, list[int]] = {}

        for index, page in enumerate(reader.pages):
            for annotation in page.get("/Annots") or []:
                obj = annotation.get_object()

                if obj.get("/Subtype") != "/Widget":
                    continue

                name = obj.get("/T")
                parent = obj.get("/Parent")

                if name is None and parent is not None:
                    name = parent.get_object().get("/T")

                if name is not None:
                    out.setdefault(str(name), []).append(index)

        return out

    english = pages_by_field(template_for("en").path)
    spanish = pages_by_field(template_for("es").path)

    mismatched = [
        name
        for name in set(english) & set(spanish)
        if sorted(english[name]) != sorted(spanish[name])
    ]

    assert mismatched == []


def test_checkbox_on_states_agree_across_languages() -> None:
    """A checkbox ticked with the wrong state name renders as unticked."""

    def states(path: Path) -> dict[str, tuple[str, ...]]:
        reader = _read(path)
        out: dict[str, tuple[str, ...]] = {}

        for page in reader.pages:
            for annotation in page.get("/Annots") or []:
                obj = annotation.get_object()
                appearance = obj.get("/AP")

                if not appearance or "/N" not in appearance:
                    continue

                name = obj.get("/T")
                parent = obj.get("/Parent")

                if name is None and parent is not None:
                    name = parent.get_object().get("/T")

                if name is None or not hasattr(appearance["/N"], "keys"):
                    continue

                out[str(name)] = tuple(sorted(appearance["/N"].keys()))

        return out

    english = states(template_for("en").path)
    spanish = states(template_for("es").path)

    differing = [
        name
        for name in set(english) & set(spanish)
        if english[name] != spanish[name]
    ]

    assert differing == []


# ---------------------------------------------------------------------------
# Chinese: the documented blocker
# ---------------------------------------------------------------------------


def test_simplified_chinese_does_not_claim_an_official_translated_form() -> None:
    """The honest half of the Chinese story.

    CDSS publishes SAWS 2 PLUS (4/15) in Chinese, so "no Chinese form exists"
    would be false. What is true is narrower and worse: the published form is
    Traditional, and it cannot be filled. This asserts we say that rather than
    presenting the English form as a Simplified Chinese one.
    """
    template = template_for("zh-CN")

    assert template.locale == "zh-CN"
    assert template.document_language == "en"
    assert template.is_official_translation is False
    assert template.limitation_key == "form_limitation_zh_hant_not_fillable"


def test_the_official_chinese_form_is_kept_for_reading() -> None:
    template = template_for("zh-CN")

    assert template.reference_path is not None
    assert template.reference_path.exists()
    assert template.reference_language == "zh-Hant"


def test_the_official_chinese_form_cannot_be_filled() -> None:
    """Why Simplified Chinese applicants do not get it as their draft."""
    reference = template_for("zh-CN").reference_path

    assert reference is not None
    assert len(_fields(reference)) == 0


def test_the_official_chinese_form_is_traditional_not_simplified() -> None:
    """The other reason, checked against the characters themselves.

    Each pair below is the same word: Traditional first, Simplified second.
    Finding the Traditional forms and none of the Simplified ones is what
    makes "Traditional Chinese" a fact here rather than a claim repeated from
    the CDSS index page.
    """
    reference = template_for("zh-CN").reference_path
    assert reference is not None

    text = " ".join(
        (page.extract_text() or "") for page in _read(reference).pages[:4]
    )

    for traditional, simplified in (
        ("補充", "补充"),   # supplemental
        ("醫療", "医疗"),   # medical
        ("殘障", "残障"),   # disability
        ("計劃", "计划"),   # program / plan
    ):
        assert traditional in text, f"expected Traditional {traditional}"
        assert simplified not in text, f"unexpected Simplified {simplified}"


# ---------------------------------------------------------------------------
# Locale normalization
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("en", "en"),
        ("en-US", "en"),
        ("es", "es"),
        ("es-MX", "es"),
        ("es_419", "es"),
        ("zh-CN", "zh-CN"),
        ("zh", "zh-CN"),
        ("zh-Hans", "zh-CN"),
        ("zh-SG", "zh-CN"),
        # Traditional must not be answered with Simplified.
        ("zh-Hant", "en"),
        ("zh-TW", "en"),
        ("zh-HK", "en"),
        (None, "en"),
        ("", "en"),
        ("klingon", "en"),
    ],
)
def test_normalize_locale(value: str | None, expected: str) -> None:
    assert normalize_locale(value) == expected


def test_registry_covers_every_supported_locale() -> None:
    assert set(TEMPLATES) == set(SUPPORTED_LOCALES)


def test_no_locale_silently_receives_a_form_it_cannot_read() -> None:
    """Either the paper matches the applicant, or the code says it does not."""
    for locale, template in TEMPLATES.items():
        if template.document_language != locale:
            assert template.limitation_key, (
                f"{locale} receives a {template.document_language} form "
                "without naming the limitation"
            )
