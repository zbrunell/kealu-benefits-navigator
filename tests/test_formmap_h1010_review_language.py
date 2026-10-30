#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The official H1010 review sheet names each question as the edition prints it.

Every spec declares ``printed_label_es``, but nothing carried it past the spec:
the mappings were built from the English labels and the Spanish variant swapped
only the targets. So a Spanish applicant holding the Spanish edition was told
"First name: Marisol" about a page that prints "Nombre". The Spanish variant
now carries its labels and ``resolve_for_definition`` applies them with the
targets, for every field rather than a list of them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from benefits_navigator.formmap import (
    canonical_values_from_field_plan,
    definition_for_form,
    generate_form,
)
from benefits_navigator.formmap.documents import resolve_for_definition
from benefits_navigator.formmap.forms.h1010_official import ADDENDUM_KEYS, FIELD_SPECS

_SCENARIOS = json.loads(
    (
        Path(__file__).resolve().parent.parent
        / "web" / "tests" / "fixtures" / "tx-h1010-scenarios.json"
    ).read_text()
)
_SPECS = {spec.key: spec for spec in FIELD_SPECS}

#: A food-benefits household and a Medicaid one, so both the main pages and
#: the addendum are on the sheet.
_HOUSEHOLDS = ("austin_single_adult", "austin_family_of_four")


def _values(scenario_id: str) -> dict:
    scenario = next(s for s in _SCENARIOS if s["id"] == scenario_id)

    return canonical_values_from_field_plan(scenario["fieldPlan"])


def _expected(key: str, locale: str) -> str:
    spec = _SPECS[key]

    return spec.printed_label_es if locale == "es" else spec.printed_label


def test_every_field_declares_its_spanish_wording():
    assert [spec.key for spec in FIELD_SPECS if not spec.printed_label_es] == []


@pytest.mark.parametrize("locale", ["en", "es"])
def test_each_edition_carries_its_own_label_on_every_mapping(locale):
    definition, _ = resolve_for_definition(definition_for_form("TX_H1010"), locale)

    for mapping in definition.fields:
        assert mapping.printed_label == _expected(mapping.key, locale), mapping.key


@pytest.mark.parametrize("locale", ["en", "es"])
@pytest.mark.parametrize("scenario_id", _HOUSEHOLDS)
def test_the_sheet_lists_every_filled_answer_under_the_editions_label(
    scenario_id, locale
):
    form = generate_form("TX_H1010", _values(scenario_id), locale=locale)

    for resolved in form.resolution.fields:
        assert resolved.mapping.printed_label == _expected(resolved.key, locale)
        assert f"    {_expected(resolved.key, locale)}: " in form.review_text, (
            resolved.key
        )


@pytest.mark.parametrize("scenario_id", _HOUSEHOLDS)
def test_the_spanish_sheet_prints_no_english_label_that_has_a_spanish_one(
    scenario_id,
):
    form = generate_form("TX_H1010", _values(scenario_id), locale="es")
    lines = {line.strip().split(":")[0] for line in form.review_text.splitlines()}

    leaked = [
        spec.key
        for spec in FIELD_SPECS
        if spec.printed_label != spec.printed_label_es
        and spec.printed_label in lines
    ]

    assert leaked == []


def test_both_parts_of_the_form_are_covered():
    """Pages 1-25 and the addendum, so this is not about the new fields."""
    form = generate_form("TX_H1010", _values("austin_family_of_four"), locale="es")
    keys = {resolved.key for resolved in form.resolution.fields}

    assert keys - ADDENDUM_KEYS
    assert keys & ADDENDUM_KEYS
    assert "    Nombre: " in form.review_text
    assert (
        "¿Va a presentar una declaración de impuestos del IRS el próximo año? "
        "(Persona 1)" in form.review_text
    )


def test_an_unanswered_question_is_named_in_spanish_too():
    values = _values("austin_family_of_four")
    values.pop("health.tax_household.0.claims_dependents", None)
    form = generate_form("TX_H1010", values, locale="es")

    assert _SPECS["health.tax_household.0.claims_dependents"].printed_label_es in (
        form.review_text
    )


def test_english_is_what_a_caller_naming_no_locale_gets():
    values = _values("austin_family_of_four")

    assert (
        generate_form("TX_H1010", values).review_text
        == generate_form("TX_H1010", values, locale="en").review_text
    )
