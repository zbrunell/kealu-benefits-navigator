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
    # Household circumstances. Several field names carry the form's own
    # typography errors and are reproduced exactly.
    "household.authorized_representative": ("Q2", "Check Box1 PG 2", "Check Box2 PG 2"),
    "health.american_indian_or_alaska_native": (
        "Q3",
        "Check Box15 PG 2",
        "Check Box16 PG 2",
    ),
    "household.prior_public_assistance": ("Q5", "Check Box47 PG 2", "Check Box48 PG 2"),
    "household.military_service": ("Q6d", "Check Box1 PG 5", "Check Box2 PG 5"),
    "household.absent_parents": ("Q6g", "Check Box17 PG 6", "Check Box18 PG 6"),
    "household.caretaker_relative": ("Q6h", "Check Box23 PG 6", "Check Box24 PG 6"),
    # Note the spaces inside the field name, exactly as the form defines them.
    "household.students": ("Q6l", "Check Box 1 PG 7", "Check Box 2 PG 7"),
    "household.foster_care": ("Q6p", "Check Box1 PG 8", "Check Box2 PG 8"),
    # Note the double space before "PG 8".
    "household.california_resident": ("Q6q", "Check Box8 PG 8", "Check Box9  PG 8"),
    "household.planned_absence": ("Q6r", "Check Box11 PG 8", "Check Box12 PG 8"),
    # Note the lower-case "pg 10".
    "income.varies_during_year": ("Q10", "Check Box27 pg 10", "Check Box28 pg 10"),
    "household.other_food_program": ("Q18", "Check Box40 PG 12", "Check Box41 PG 12"),
    # Newly modeled household circumstances.
    "household.health_coverage_representative": (
        "Q2a",
        "Check Box13 PG 2",
        "Check Box14 PG 2",
    ),
    "household.disability_limits_activities": (
        "Q6i",
        "Check Box26 PG 6",
        "Check Box27 PG 6",
    ),
    "household.needs_care_from_member": ("Q6k", "Check Box56 PG 6", "Check Box57 PG 6"),
    "household.pregnant_or_teen_parent": (
        "Q6m",
        "Check Box 13 PG 7",
        "Check Box 14 PG 7",
    ),
    "household.cal_learn_history": ("Q6n", "Check Box 42 PG 7", "Check Box 43 PG 7"),
    "household.ever_in_foster_care": ("Q6o", "Check Box 50 PG 7", "Check Box 51 PG 7"),
    "household.elderly_unable_to_prepare_meals": (
        "Q21a",
        "Check Box11 PG 13",
        "Check Box12 PG 13",
    ),
    "health.has_tax_dependents": ("Q23d", "Check Box65 PG 13", "Check Box66 PG 13"),
    # Q14: six independent printed questions under one heading.
    "expenses.special_need.diet": ("Q14", "Check Box9 PG 11", "Check Box10 PG 11"),
    "expenses.special_need.phone_or_equipment": (
        "Q14",
        "Check Box11 PG 11",
        "Check Box12 PG 11",
    ),
    "expenses.special_need.housework": ("Q14", "Check Box13 PG 11", "Check Box14 PG 11"),
    "expenses.special_need.high_utility_use": (
        "Q14",
        "Check Box15 PG 11",
        "Check Box16 PG 11",
    ),
    "expenses.special_need.laundry": ("Q14", "Check Box17 PG 11", "Check Box18 PG 11"),
    "expenses.special_need.other": ("Q14", "Check Box19 PG 11", "Check Box20 PG 11"),
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


def test_q23f_consent_box_is_never_written(available_fields):
    """Q23f offers two opposite choices but the AcroForm has one checkbox.

    Printed page 13 shows "Yes, renew my eligibility automatically ..." at
    y=61.8 and "No, don't use information from tax returns ..." at y=51.8, both
    marked at x~83.7. The form contains exactly one box, Check Box74 PG 13, at
    x=83.5 mid_y=56.6 — equidistant from both lines. Ticking it could tell the
    county either thing, so it stays unwritten and unwritable.
    """
    box = Saws2PlusFieldAdapter.Q23F_AMBIGUOUS_CONSENT_BOX

    assert box in available_fields, "the box does exist on the form"
    assert box not in Saws2PlusFieldAdapter.SAFE_FIELDS

    for value in (True, False):
        values = _map({"health.renewal_authorization": value}, available_fields)
        assert box not in values, value


def test_field_names_preserve_the_forms_own_typography(available_fields):
    """The AcroForm key is whatever the form author typed, spaces and all."""
    for odd in ("Check Box 1 PG 7", "Check Box9  PG 8", "Check Box27 pg 10"):
        assert odd in available_fields, odd
        assert odd in Saws2PlusFieldAdapter.SAFE_FIELDS, odd


def test_q2a_is_independent_of_q2(available_fields):
    """Q2 appoints a CalFresh representative; Q2a a health-coverage one.

    The printed form asks them as two separate questions with separate
    checkboxes, so answering one must never tick the other's box.
    """
    values = _map({"household.authorized_representative": False}, available_fields)

    assert values.get("Check Box2 PG 2") == "/Yes"      # Q2 No
    assert "Check Box13 PG 2" not in values            # Q2a untouched
    assert "Check Box14 PG 2" not in values

    values = _map({"household.health_coverage_representative": True}, available_fields)

    assert values.get("Check Box13 PG 2") == "/Yes"     # Q2a Yes
    assert "Check Box1 PG 2" not in values              # Q2 untouched
    assert "Check Box2 PG 2" not in values


def test_q21a_who_line_is_written_only_with_a_value(available_fields):
    who = Saws2PlusFieldAdapter.PAGE_13_ELDERLY_SEPARATE_MEALS_WHO

    values = _map(
        {
            "household.elderly_unable_to_prepare_meals": True,
            "household.elderly_unable_to_prepare_meals_who": "Rosa Marin",
        },
        available_fields,
    )
    assert values[who] == "Rosa Marin"
    assert values.get("Check Box11 PG 13") == "/Yes"

    # No name given: the Yes box still ticks, the line stays blank.
    values = _map({"household.elderly_unable_to_prepare_meals": True}, available_fields)
    assert who not in values


def test_q6o_and_q6p_are_distinct_questions(available_fields):
    """Past foster care versus a foster child living in the home now."""
    values = _map(
        {"household.ever_in_foster_care": True, "household.foster_care": False},
        available_fields,
    )

    assert values.get("Check Box 50 PG 7") == "/Yes"   # Q6o Yes
    assert values.get("Check Box2 PG 8") == "/Yes"     # Q6p No
    assert "Check Box 51 PG 7" not in values
    assert "Check Box1 PG 8" not in values


# ---------------------------------------------------------------------------
# Q23b-Q23e — the tax household
# ---------------------------------------------------------------------------


def test_tax_text_destinations_exist_and_are_distinct(available_fields):
    table = Saws2PlusFieldAdapter.PAGE_13_TAX_TEXT

    assert set(table) == {
        "health.tax_filer_name",
        "health.spouse_name",
        "health.tax_dependent_names",
        "health.tax_dependent_relationships",
    }
    assert len(set(table.values())) == len(table)

    for field in table.values():
        assert field in available_fields, field


def test_tax_household_lines_are_written(available_fields):
    values = _map(
        {
            "health.tax_filer": True,
            "health.tax_filer_name": "Maria Delgado",
            "health.spouse_filing_jointly": True,
            "health.spouse_name": "Luis Delgado",
            "health.has_tax_dependents": True,
            "health.tax_dependent_names": "Sofia Delgado, Mateo Ruiz",
            "health.tax_dependent_relationships": "Daughter, Nephew",
        },
        available_fields,
    )

    assert values["Text61 PG 13"] == "Maria Delgado"
    assert values["Text64 PG 13"] == "Luis Delgado"
    assert values["Text67 PG 13"] == "Sofia Delgado, Mateo Ruiz"
    assert values["Text68 PG 13"] == "Daughter, Nephew"
    assert values.get("Check Box65 PG 13") == "/Yes"


def test_no_tax_dependents_ticks_no_and_leaves_the_name_lines_blank(
    available_fields,
):
    values = _map(
        {"health.tax_filer": True, "health.has_tax_dependents": False},
        available_fields,
    )

    assert values.get("Check Box66 PG 13") == "/Yes"
    assert "Check Box65 PG 13" not in values
    assert "Text67 PG 13" not in values
    assert "Text68 PG 13" not in values


def test_a_household_that_does_not_file_writes_no_tax_lines(available_fields):
    """The canonical layer suppresses these when Q23 is No; nothing stale
    can reach the adapter."""
    values = _map({"health.tax_filer": False}, available_fields)

    assert values.get("Check Box60 PG 13") == "/Yes"  # Q23 No
    for field in Saws2PlusFieldAdapter.PAGE_13_TAX_TEXT.values():
        assert field not in values, field


# ---------------------------------------------------------------------------
# Q4 — interview preference (standalone checkboxes, not Yes/No pairs)
# ---------------------------------------------------------------------------


def test_q4_boxes_tick_only_on_an_explicit_yes(available_fields):
    table = Saws2PlusFieldAdapter.PAGE_2_INTERVIEW_PREFERENCE

    for key, field in table.items():
        assert field in available_fields, field

        assert _map({key: True}, available_fields).get(field) == "/Yes"
        # The form has no "no" box: False and unanswered both leave it blank.
        assert field not in _map({key: False}, available_fields)
        assert field not in _map({}, available_fields)


def test_q4_boxes_are_independent(available_fields):
    values = _map({"applicant.prefers_in_person_interview": True}, available_fields)

    assert values.get("Check Box45 PG 2") == "/Yes"
    assert "Check Box46 PG 2" not in values


def test_q14_free_text_lines(available_fields):
    values = _map(
        {
            "expenses.special_need.housework": True,
            "expenses.special_need.person": "Rosa Marin - limited mobility",
            "expenses.special_need.other": True,
            "expenses.special_need.other_description": "Wheelchair ramp",
        },
        available_fields,
    )

    assert values["Text22 PG 11"] == "Rosa Marin - limited mobility"
    assert values["Text21 PG 11"] == "Wheelchair ramp"
    assert values.get("Check Box13 PG 11") == "/Yes"
    assert values.get("Check Box19 PG 11") == "/Yes"


def test_q14_answers_are_independent(available_fields):
    """A No to one special need says nothing about the other five."""
    values = _map({"expenses.special_need.diet": False}, available_fields)

    assert values.get("Check Box10 PG 11") == "/Yes"
    for field in (
        "Check Box9 PG 11",
        "Check Box11 PG 11", "Check Box12 PG 11",
        "Check Box13 PG 11", "Check Box14 PG 11",
        "Check Box15 PG 11", "Check Box16 PG 11",
        "Check Box17 PG 11", "Check Box18 PG 11",
        "Check Box19 PG 11", "Check Box20 PG 11",
    ):
        assert field not in values, field


# ---------------------------------------------------------------------------
# Q6j — per-disabled-person detail blocks
# ---------------------------------------------------------------------------

DIS = Saws2PlusFieldAdapter.PAGE_6_DISABILITY_BLOCKS


def _detail(index: int, **fields) -> dict:
    prefix = f"household.disability_detail.{index}"
    return {f"{prefix}.{k}": v for k, v in fields.items()}


def test_q6j_every_destination_exists_and_is_unique(available_fields):
    seen: set[str] = set()

    for block in DIS:
        for value in block.values():
            for field in (value if isinstance(value, tuple) else (value,)):
                if field is None:
                    continue
                assert field in available_fields, field
                assert field not in seen, f"{field} used twice"
                seen.add(field)


def test_q6j_preserves_the_forms_literal_field_name(available_fields):
    """The second block's 30-day box is named "BOX 47 PG 6" — upper case, no
    "Check". The AcroForm key is whatever the form author typed."""
    assert DIS[1]["duration_thirty_days"] == "BOX 47 PG 6"
    assert "BOX 47 PG 6" in available_fields


def test_q6j_first_person_fills_the_first_block(available_fields):
    values = _map(
        _detail(
            0,
            person_name="Rosa Marin",
            needs_care_for_others_to_work=True,
            needs_help_daily_living=False,
            works_with_medical_expenses=True,
            works_with_medical_expenses_explanation="Wheelchair",
            in_medical_facility=False,
            expected_duration="twelve_months_or_more",
        ),
        available_fields,
    )

    assert values["Text30 PG 6"] == "Rosa Marin"
    assert values.get("Check Box39 PG 6") == "/Yes"   # needs care: Yes
    assert values.get("Check Box32 PG 6") == "/Yes"   # daily living: No
    assert "Check Box31 PG 6" not in values
    assert values.get("Check Box36 PG 6") == "/Yes"   # works+medical: Yes
    assert values["Text38 PG 6"] == "Wheelchair"
    assert values.get("Check Box42 PG 6") == "/Yes"   # in facility: No
    assert values.get("Check Box35 PG 6") == "/Yes"   # 12 months or more
    assert "Check Box34 PG 6" not in values           # 30 days unticked

    # The second block is untouched.
    assert "Text43 PG 6" not in values


def test_q6j_second_person_fills_the_second_block(available_fields):
    plan = {
        **_detail(0, person_name="Rosa Marin"),
        **_detail(1, person_name="Ana Ruiz", in_medical_facility=True,
                  medical_facility_name="Sunrise Care", expected_duration="thirty_days_or_more"),
    }

    values = _map(plan, available_fields)

    assert values["Text30 PG 6"] == "Rosa Marin"
    assert values["Text43 PG 6"] == "Ana Ruiz"
    assert values.get("Check Box54 PG 6") == "/Yes"
    assert values["Text55A PG 6"] == "Sunrise Care"
    assert values.get("BOX 47 PG 6") == "/Yes"


def test_q6j_first_block_facility_name_has_no_widget(available_fields):
    """A genuine form omission: block 1's facility-name label has no widget, so
    the value stays manual rather than being written somewhere approximate."""
    assert DIS[0]["facility_name"] is None

    values = _map(
        _detail(0, in_medical_facility=True, medical_facility_name="Sunrise Care"),
        available_fields,
    )

    assert values.get("Check Box41 PG 6") == "/Yes"
    assert "Sunrise Care" not in values.values()


def test_q6j_unanswered_sub_questions_leave_both_boxes_blank(available_fields):
    values = _map(_detail(0, person_name="Rosa Marin"), available_fields)

    for block_key in ("needs_care", "daily_living", "works_with_medical", "in_facility"):
        for field in DIS[0][block_key]:
            assert field not in values, field


def test_q6j_writes_nothing_without_a_record(available_fields):
    values = _map({}, available_fields)

    for block in DIS:
        for value in block.values():
            for field in (value if isinstance(value, tuple) else (value,)):
                if field is not None:
                    assert field not in values, field
