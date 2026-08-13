#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Which household person lands in which printed SAWS 2 PLUS row.

Every assertion names an exact PDF widget, verified against the printed Q6
tables by widget geometry on PDF pages 9 (adults) and 10 (children). Asserting
only that a name appears "somewhere on page 3" is what let people silently swap
rows, so it is never done here.

Adult rows, top to bottom (page 3 of the printed form):

    row 0  name Text5 PG 3   relationship Text6 PG 3   dob Text7 PG 3
    row 1  name Text22 PG 3  relationship Text23 PG 3  dob Text24 PG 3
    row 2  name Text40 PG 3  relationship Text41 PG 3  dob Text42 PG 3
    row 3  name Text58 PG 3  relationship Text59 PG 3  dob Text60 PG 3
    row 4  name Text76 PG 3  relationship Text77 PG 3  dob Text78 PG 3
"""

from __future__ import annotations

import pytest

from benefits_navigator.pdf_generator import Saws2PlusFieldAdapter

# Adult name/relationship destinations by printed row.
ADULT_NAME = (
    "Text5 PG 3",
    "Text22 PG 3",
    "Text40 PG 3",
    "Text58 PG 3",
    "Text76 PG 3",
)

ADULT_RELATIONSHIP = (
    "Text6 PG 3",
    "Text23 PG 3",
    "Text41 PG 3",
    "Text59 PG 3",
    "Text77 PG 3",
)

ADULT_DOB = (
    "Text7 PG 3",
    "Text24 PG 3",
    "Text42 PG 3",
    "Text60 PG 3",
    "Text78 PG 3",
)

CHILD_NAME = (
    "Text5 PG 4",
    "Text24 PG 4",
    "Text43 PG 4",
    "Text62 PG 4",
    "Text81 PG 4",
)


@pytest.fixture(scope="module")
def available_fields() -> set[str]:
    """Every field the real template actually has."""
    from benefits_navigator.pdf_generator import _FORMS_DIR, inspect_pdf_form

    return {
        field["name"]
        for field in inspect_pdf_form(_FORMS_DIR / "CA-SAWS-2-PLUS.pdf")
        if field.get("name")
    }


def _map(plan: dict, available_fields: set[str]) -> dict[str, str]:
    """Run the real adapter over a canonical plan."""
    return Saws2PlusFieldAdapter().map_values(plan, available_fields)


def _applicant(**overrides) -> dict:
    base = {
        "applicant.first_name": "Maria",
        "applicant.last_name": "Delgado",
        "applicant.date_of_birth": "1993-04-12",
        "applicant.table": "adult",
        "applicant.table_row": 0,
    }
    base.update(overrides)

    return base


def _member(index: int, **overrides) -> dict:
    prefix = f"household.members.{index}"
    base = {
        f"{prefix}.present": True,
        f"{prefix}.table": "adult",
        f"{prefix}.table_row": index + 1,
    }
    base.update({f"{prefix}.{key}": value for key, value in overrides.items()})

    return base


def _counts(members: int) -> dict:
    return {"household.members.count": members}


# ---------------------------------------------------------------------------
# Applicant + spouse
# ---------------------------------------------------------------------------


def test_applicant_takes_the_first_adult_row(available_fields):
    values = _map(
        {**_applicant(), **_counts(0)},
        available_fields,
    )

    assert values[ADULT_NAME[0]] == "Delgado, Maria"
    assert values[ADULT_RELATIONSHIP[0]] == "self"
    assert values[ADULT_DOB[0]] == "04/12/1993"


def test_spouse_takes_the_second_adult_row_not_the_first(available_fields):
    plan = {
        **_applicant(),
        **_counts(1),
        **_member(
            0,
            first_name="Luis",
            last_name="Delgado",
            date_of_birth="1991-09-02",
            relationship_to_applicant="Spouse",
        ),
    }

    values = _map(plan, available_fields)

    assert values[ADULT_NAME[0]] == "Delgado, Maria"
    assert values[ADULT_NAME[1]] == "Delgado, Luis"
    # The spouse's own details never bleed into the applicant's row.
    assert values[ADULT_RELATIONSHIP[0]] == "self"
    assert values[ADULT_RELATIONSHIP[1]] == "Spouse"
    assert values[ADULT_DOB[0]] == "04/12/1993"
    assert values[ADULT_DOB[1]] == "09/02/1991"


def test_an_unnamed_applicant_still_keeps_row_one(available_fields):
    """Regression: the applicant used to be dropped when they had no name yet,
    which handed row 1 to the spouse."""
    plan = {
        "applicant.date_of_birth": "1993-04-12",
        "applicant.table": "adult",
        "applicant.table_row": 0,
        **_counts(1),
        **_member(
            0,
            first_name="Luis",
            last_name="Delgado",
            date_of_birth="1991-09-02",
            relationship_to_applicant="Spouse",
        ),
    }

    values = _map(plan, available_fields)

    assert ADULT_NAME[0] not in values  # blank, not borrowed from the spouse
    assert values[ADULT_DOB[0]] == "04/12/1993"
    assert values[ADULT_NAME[1]] == "Delgado, Luis"


# ---------------------------------------------------------------------------
# Multiple adults
# ---------------------------------------------------------------------------


def test_three_adults_occupy_three_consecutive_rows(available_fields):
    plan = {
        **_applicant(),
        **_counts(2),
        **_member(0, first_name="Luis", last_name="Delgado", date_of_birth="1991-09-02"),
        **_member(1, first_name="Rosa", last_name="Marin", date_of_birth="1962-01-20"),
    }

    values = _map(plan, available_fields)

    assert values[ADULT_NAME[0]] == "Delgado, Maria"
    assert values[ADULT_NAME[1]] == "Delgado, Luis"
    assert values[ADULT_NAME[2]] == "Marin, Rosa"
    # Nothing spilled into the unused rows.
    assert ADULT_NAME[3] not in values
    assert ADULT_NAME[4] not in values


def test_a_member_without_a_name_does_not_delete_later_members(available_fields):
    """Regression: the adapter discovered members by probing for a non-empty
    first name and stopped at the first gap, silently dropping everyone after
    an unnamed member."""
    plan = {
        **_applicant(),
        **_counts(2),
        # Member 0 exists but has not been named yet.
        **_member(0, date_of_birth="1991-09-02"),
        **_member(1, first_name="Rosa", last_name="Marin", date_of_birth="1962-01-20"),
    }

    values = _map(plan, available_fields)

    assert ADULT_NAME[1] not in values
    assert values[ADULT_DOB[1]] == "09/02/1991"
    assert values[ADULT_NAME[2]] == "Marin, Rosa"


def test_adults_beyond_the_printed_table_do_not_overwrite_row_one(available_fields):
    """Six adults: the sixth has no printed row and must not wrap."""
    plan = {
        **_applicant(),
        **_counts(5),
    }

    for index in range(5):
        plan.update(
            _member(
                index,
                first_name=f"Extra{index}",
                last_name="Person",
                date_of_birth="1980-01-01",
            )
        )

    values = _map(plan, available_fields)

    assert values[ADULT_NAME[0]] == "Delgado, Maria"
    assert values[ADULT_NAME[4]] == "Person, Extra3"
    # Extra4 was assigned row 5, which the form does not have.
    assert "Person, Extra4" not in values.values()


def test_two_people_may_never_share_an_adult_row(available_fields):
    plan = {
        **_applicant(),
        **_counts(1),
        **_member(0, first_name="Luis", last_name="Delgado"),
    }

    # Force a collision the canonical layer would never produce.
    plan["household.members.0.table_row"] = 0

    with pytest.raises(RuntimeError, match="same adult row"):
        _map(plan, available_fields)


# ---------------------------------------------------------------------------
# Adults and children never cross tables
# ---------------------------------------------------------------------------


def test_a_child_never_appears_in_the_adult_table(available_fields):
    plan = {
        **_applicant(),
        **_counts(1),
        **_member(
            0,
            first_name="Sofia",
            last_name="Delgado",
            date_of_birth="2024-06-15",
        ),
    }

    plan["household.members.0.table"] = "child"
    plan["household.members.0.table_row"] = 0

    values = _map(plan, available_fields)

    assert values[CHILD_NAME[0]] == "Delgado, Sofia"
    # The child occupies no adult row at all.
    for destination in ADULT_NAME[1:]:
        assert destination not in values
    assert values[ADULT_NAME[0]] == "Delgado, Maria"


def test_a_child_between_two_adults_does_not_shift_the_second_adult(
    available_fields,
):
    """Array order must not leak into row semantics: the child sits at member
    index 0 but takes child row 1, and the adult at index 1 takes adult row 2."""
    plan = {
        **_applicant(),
        **_counts(2),
        **_member(0, first_name="Sofia", last_name="Delgado", date_of_birth="2024-06-15"),
        **_member(1, first_name="Luis", last_name="Delgado", date_of_birth="1991-09-02"),
    }

    plan["household.members.0.table"] = "child"
    plan["household.members.0.table_row"] = 0
    plan["household.members.1.table_row"] = 1

    values = _map(plan, available_fields)

    assert values[ADULT_NAME[0]] == "Delgado, Maria"
    assert values[ADULT_NAME[1]] == "Delgado, Luis"
    assert values[CHILD_NAME[0]] == "Delgado, Sofia"
    assert ADULT_NAME[2] not in values


def test_an_adult_never_appears_in_the_child_table(available_fields):
    plan = {
        **_applicant(),
        **_counts(1),
        **_member(0, first_name="Luis", last_name="Delgado", date_of_birth="1991-09-02"),
    }

    values = _map(plan, available_fields)

    for destination in CHILD_NAME:
        assert destination not in values


# ---------------------------------------------------------------------------
# Per-row detail columns stay with their own person
# ---------------------------------------------------------------------------


def test_each_adults_details_stay_in_their_own_row(available_fields):
    """Gender, marital status, citizenship and program boxes must not migrate."""
    plan = {
        **_applicant(),
        **_counts(1),
        "applicant.household.sex": "female",
        "applicant.household.marital_status": "married",
        "applicant.household.citizen_or_national": True,
        "applicant.household.applying_for.calfresh": True,
        **_member(
            0,
            first_name="Luis",
            last_name="Delgado",
            date_of_birth="1991-09-02",
        ),
        "household.members.0.adult.sex": "male",
        "household.members.0.adult.marital_status": "married",
        "household.members.0.adult.citizen_or_national": False,
        "household.members.0.applying_for.medi_cal": True,
    }

    values = _map(plan, available_fields)

    rows = Saws2PlusFieldAdapter.ADULT_ROWS
    married = Saws2PlusFieldAdapter.ADULT_STATUS_INDEX["married"]

    # Gender column.
    assert values[rows[0]["sex"]] == "F"
    assert values[rows[1]["sex"]] == "M"

    # Marital status is set for both, in their own rows only.
    assert values[rows[0]["statuses"][married]] == "/Yes"
    assert values[rows[1]["statuses"][married]] == "/Yes"

    # Citizenship: applicant Yes, spouse No — never the other way round.
    assert values[rows[0]["citizen_yes"]] == "/Yes"
    assert rows[0]["citizen_no"] not in values
    assert values[rows[1]["citizen_no"]] == "/Yes"
    assert rows[1]["citizen_yes"] not in values

    # Program boxes: CalFresh for the applicant, Medi-Cal for the spouse.
    calfresh = Saws2PlusFieldAdapter.PERSON_PROGRAM_INDEX["calfresh"]
    medi_cal = Saws2PlusFieldAdapter.PERSON_PROGRAM_INDEX["medi_cal"]

    assert values[rows[0]["programs"][calfresh]] == "/Yes"
    assert rows[0]["programs"][medi_cal] not in values
    assert values[rows[1]["programs"][medi_cal]] == "/Yes"
    assert rows[1]["programs"][calfresh] not in values


def test_a_person_with_no_row_assignment_is_not_written_anywhere(
    available_fields,
):
    """No assignment means no row. Guessing one is what caused misplacement."""
    plan = {
        "applicant.first_name": "Maria",
        "applicant.last_name": "Delgado",
        **_counts(0),
    }

    values = _map(plan, available_fields)

    for destination in ADULT_NAME + CHILD_NAME:
        assert destination not in values


def test_never_writes_an_ssn_destination_for_any_row(available_fields):
    plan = {
        **_applicant(),
        **_counts(1),
        **_member(0, first_name="Luis", last_name="Delgado", date_of_birth="1991-09-02"),
    }

    values = _map(plan, available_fields)

    for destination in (
        "Text17B PG 3",
        "Text35 PG 3",
        "Text53 PG 3",
        "Text71 PG 3",
        "Text89 PG 3",
    ):
        assert destination not in values
        assert destination not in Saws2PlusFieldAdapter.SAFE_FIELDS
