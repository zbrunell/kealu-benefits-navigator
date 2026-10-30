#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Section O's "How often are you paid?" for other money, on HHSC's H1010.

The field plan sends a reported frequency as the words California's form prints
("Monthly"), while the official H1010 marks a circle chosen by option key
("monthly"). Before ``frequency_option`` existed, any Texas household that
reported other money with a frequency failed to generate at all:

    income.unearned.0.reported_frequency: value 'Monthly' has no option on the
    form

The scenario suite only generated the worksheet, so nothing caught it. These
tests run the production field plans through the official form in both
editions, and keep the Python copy of the words in step with the TypeScript
one.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from benefits_navigator.formmap import (
    FormDefinitionError,
    canonical_values_from_field_plan,
    generate_form,
)
from benefits_navigator.formmap.forms.h1010_official import FREQUENCY_OPTIONS
from benefits_navigator.formmap.transforms import frequency_option

_ROOT = Path(__file__).resolve().parent.parent
_SCENARIOS = json.loads(
    (_ROOT / "web" / "tests" / "fixtures" / "tx-h1010-scenarios.json").read_text()
)
_LABELS_SOURCE = _ROOT / "web" / "src" / "lib" / "reported-amounts.ts"

_KEY = "income.unearned.0.reported_frequency"


def _values(scenario_id: str) -> dict:
    scenario = next(s for s in _SCENARIOS if s["id"] == scenario_id)

    return canonical_values_from_field_plan(scenario["fieldPlan"])


def _frequency_labels() -> dict[str, str]:
    """``FREQUENCY_LABELS`` from the TypeScript source, option key → words."""
    source = _LABELS_SOURCE.read_text()
    block = re.search(
        r"FREQUENCY_LABELS[^=]*=\s*\{(.*?)\};", source, re.DOTALL
    )

    assert block, "FREQUENCY_LABELS not found in reported-amounts.ts"

    return dict(re.findall(r"(\w+):\s*'([^']*)'", block.group(1)))


def _resolved(generated, key: str) -> str | None:
    for field in generated.resolution.fields:
        if field.mapping.key == key:
            return field.rendered

    return None


@pytest.mark.parametrize("locale", ["en", "es"])
@pytest.mark.parametrize("scenario_id", [s["id"] for s in _SCENARIOS])
def test_every_production_plan_generates_the_official_form(scenario_id, locale):
    generated = generate_form("TX_H1010", _values(scenario_id), locale=locale)

    assert generated.pdf_bytes.startswith(b"%PDF-")


@pytest.mark.parametrize("locale", ["en", "es"])
def test_a_monthly_payment_marks_the_once_a_month_circle(locale):
    values = _values("austin_family_of_four")

    # The scenario that used to fail, as the field plan really sends it.
    assert values[_KEY] == "Monthly"

    generated = generate_form("TX_H1010", values, locale=locale)

    assert _resolved(generated, _KEY) == "monthly"


@pytest.mark.parametrize("locale", ["en", "es"])
@pytest.mark.parametrize("option", FREQUENCY_OPTIONS)
def test_every_frequency_the_intake_offers_marks_a_circle(option, locale):
    values = _values("austin_family_of_four")
    values[_KEY] = _frequency_labels()[option]

    generated = generate_form("TX_H1010", values, locale=locale)

    assert _resolved(generated, _KEY) == option


def test_the_python_words_match_the_field_plans():
    labels = _frequency_labels()

    assert set(labels) == set(FREQUENCY_OPTIONS)

    for option, words in labels.items():
        assert frequency_option(words) == option
        # An option key already in that form passes through.
        assert frequency_option(option) == option


def test_a_frequency_with_no_circle_still_fails_loudly():
    values = _values("austin_family_of_four")
    values[_KEY] = "Daily"

    with pytest.raises(FormDefinitionError, match="no option on the form"):
        generate_form("TX_H1010", values, locale="en")
