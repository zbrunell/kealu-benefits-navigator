#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Gateway Yes/No destinations for the expense, household, health and tax questions.

Each destination was located by matching the printed "Yes"/"No" glyph x
positions to the checkbox widget rectangles on that question's own baseline
band. These tests pin the result so a future edit cannot quietly move a box.

The behaviour that matters most here: an explicit No ticks the No box, and a
question that was never answered leaves *both* boxes blank. Those two states are
different on a government form and must stay different.
"""

from __future__ import annotations

import pytest

from benefits_navigator.pdf_generator import (
    Saws2PlusFieldAdapter,
    _FORMS_DIR,
    inspect_pdf_form,
)

#: canonical key -> (printed question, Yes destination, No destination)
EXPECTED = {
    "expenses.has_dependent_care": ("Q11", "Check Box35 pg 10", "Check Box36 pg 10"),
    "expenses.pays_child_support": ("Q12", "Check Box63 PG 10", "Check Box64 PG 10"),
    "expenses.pays_spousal_support": ("Q13", "Check Box1 PG 11", "Check Box2 PG 11"),
    "expenses.has_medical_expenses": ("Q16", "Check Box1 PG 12", "Check Box2 PG 12"),
    "expenses.other_tax_deductible": ("Q17", "Check Box28 PG 12", "Check Box29 PG 12"),
    "household.institutional_living": ("Q19", "Check Box46 PG 12", "Check Box47 PG 12"),
    "household.receives_ihss": ("Q20", "Check Box1 PG 13", "Check Box2 PG 13"),
    "household.buys_and_prepares_food_together": (
        "Q21",
        "Check Box5 PG 13",
        "Check Box6 PG 13",
    ),
    "health.has_current_coverage": ("Q22", "Check Box14 PG 13", "Check Box15 PG 13"),
    "health.has_employer_coverage": ("Q22a", "Check Box44 PG 13", "Check Box45 PG 13"),
    "health.coverage_ending": ("Q22b", "Check Box46 PG 13", "Check Box47 PG 13"),
    "health.retroactive_medical_help": (
        "Q22c",
        "Check Box56 PG 13",
        "Check Box57 PG 13",
    ),
    "health.tax_filer": ("Q23", "Check Box59 PG 13", "Check Box60 PG 13"),
    "health.spouse_filing_jointly": ("Q23c", "Check Box62 PG 13", "Check Box63 PG 13"),
    "resources.has_vehicles": ("Q26", "Check Box1 PG 15", "Check Box2 PG 15"),
    "resources.received_diversion_payment": (
        "Q28",
        "Check Box21 PG 15",
        "Check Box22 PG 15",
    ),
}


@pytest.fixture(scope="module")
def available_fields() -> set[str]:
    return {
        field["name"]
        for field in inspect_pdf_form(_FORMS_DIR / "CA-SAWS-2-PLUS.pdf")
        if field.get("name")
    }


def _map(plan: dict, available_fields: set[str]) -> dict[str, str]:
    return Saws2PlusFieldAdapter().map_values(plan, available_fields)


def test_every_expected_destination_exists_in_the_real_form(available_fields):
    for key, (question, yes, no) in EXPECTED.items():
        assert yes in available_fields, f"{key} ({question}) Yes: {yes}"
        assert no in available_fields, f"{key} ({question}) No: {no}"


def test_the_adapter_uses_exactly_these_destinations():
    actual = {
        key: (pair[0], pair[1])
        for key, pair in Saws2PlusFieldAdapter.GATEWAY_YES_NO.items()
    }
    expected = {key: (yes, no) for key, (_, yes, no) in EXPECTED.items()}

    assert actual == expected


def test_no_destination_is_shared_by_two_questions():
    seen: dict[str, str] = {}

    for key, pair in Saws2PlusFieldAdapter.GATEWAY_YES_NO.items():
        for field in pair:
            assert field not in seen, f"{field} used by both {seen.get(field)} and {key}"
            seen[field] = key


@pytest.mark.parametrize("key", sorted(EXPECTED))
def test_yes_ticks_only_the_yes_box(key, available_fields):
    _, yes, no = EXPECTED[key]
    values = _map({key: True}, available_fields)

    assert values.get(yes) == "/Yes"
    assert no not in values


@pytest.mark.parametrize("key", sorted(EXPECTED))
def test_no_ticks_only_the_no_box(key, available_fields):
    """An explicit No is an answer and must be recorded as one."""
    _, yes, no = EXPECTED[key]
    values = _map({key: False}, available_fields)

    assert values.get(no) == "/Yes"
    assert yes not in values


@pytest.mark.parametrize("key", sorted(EXPECTED))
def test_an_unanswered_question_leaves_both_boxes_blank(key, available_fields):
    """Skipped and never-asked must not look like a No."""
    _, yes, no = EXPECTED[key]
    values = _map({}, available_fields)

    assert yes not in values
    assert no not in values


@pytest.mark.parametrize("key", sorted(EXPECTED))
def test_a_non_boolean_value_is_never_written(key, available_fields):
    _, yes, no = EXPECTED[key]

    for junk in ("", "yes", 0, 1, None, []):
        values = _map({key: junk}, available_fields)

        assert yes not in values, junk
        assert no not in values, junk


def test_q22_answered_no_does_not_touch_its_three_siblings(available_fields):
    """Q22a, Q22b and Q22c are independent printed questions."""
    values = _map({"health.has_current_coverage": False}, available_fields)

    assert values.get("Check Box15 PG 13") == "/Yes"  # Q22 No
    assert "Check Box14 PG 13" not in values          # Q22 Yes

    for question in (
        "health.has_employer_coverage",
        "health.coverage_ending",
        "health.retroactive_medical_help",
    ):
        _, yes, no = EXPECTED[question]
        assert yes not in values, question
        assert no not in values, question


def test_real_property_gateway_has_no_destination():
    """Q27 is a table of rows with no gateway checkbox on the printed form, so
    the gateway is deliberately unmapped rather than pointed somewhere close."""
    assert (
        "resources.has_real_property"
        not in Saws2PlusFieldAdapter.GATEWAY_YES_NO
    )


def test_new_destinations_never_collide_with_ssn_or_signature_fields():
    from benefits_navigator.saws2_plus_inventory import (
        SIGNATURE_FIELDS,
        SSN_FIELDS,
    )

    destinations = {
        field
        for pair in Saws2PlusFieldAdapter.GATEWAY_YES_NO.values()
        for field in pair
    }

    assert not destinations & set(SSN_FIELDS)
    assert not destinations & set(SIGNATURE_FIELDS)


# ---------------------------------------------------------------------------
# Q7: reported amount and frequency, never an internal normalization
# ---------------------------------------------------------------------------

#: (person, from where, how much, how often, continuing-yes, continuing-no)
Q7_ROW_0 = Saws2PlusFieldAdapter.PAGE_8_UNEARNED_ROWS[0]


def _unearned(available_fields: set[str], **row) -> dict[str, str]:
    plan = {
        "income.has_unearned_income": True,
        "income.unearned.0.person_name": "Maria Delgado",
        "income.unearned.0.source": "Unemployment",
    }
    plan.update({f"income.unearned.0.{k}": v for k, v in row.items()})

    return _map(plan, available_fields)


@pytest.mark.parametrize(
    "amount,frequency",
    [
        (200, "Weekly"),
        (300, "Every two weeks"),
        (400, "Twice a month"),
        (650, "Monthly"),
        (1200, "Irregular"),
    ],
)
def test_q7_prints_the_reported_amount_and_frequency(
    amount, frequency, available_fields
):
    """The form asks HOW MUCH and HOW OFTEN. Both are the applicant's words."""
    values = _unearned(
        available_fields, reported_amount=amount, reported_frequency=frequency
    )

    assert values[Q7_ROW_0[2]] == str(amount)
    assert values[Q7_ROW_0[3]] == frequency


def test_q7_never_writes_the_derived_monthly_figure(available_fields):
    """$300 every two weeks is $650/month; the form must show 300, not 650."""
    values = _unearned(
        available_fields,
        reported_amount=300,
        reported_frequency="Every two weeks",
        amount_monthly=650,
    )

    assert values[Q7_ROW_0[2]] == "300"
    assert values[Q7_ROW_0[3]] == "Every two weeks"
    assert "650" not in values.values()


def test_q7_leaves_frequency_blank_when_none_was_reported(available_fields):
    """Better a blank column than an asserted 'Monthly' the applicant never said."""
    values = _unearned(available_fields, reported_amount=500)

    assert values[Q7_ROW_0[2]] == "500"
    assert Q7_ROW_0[3] not in values


def test_q7_writes_nothing_for_a_record_with_no_amount(available_fields):
    values = _unearned(available_fields)

    assert Q7_ROW_0[2] not in values
    assert Q7_ROW_0[3] not in values
    # The person and source columns still fill.
    assert values[Q7_ROW_0[0]] == "Maria Delgado"
    assert values[Q7_ROW_0[1]] == "Unemployment"
