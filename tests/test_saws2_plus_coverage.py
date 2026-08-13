#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Coverage and safety invariants for the SAWS 2 PLUS field inventory.

Every field in the official PDF must be accounted for by exactly one
classification, and no Social Security Number or signature destination may ever
be writable.
"""

from __future__ import annotations

import pytest

from benefits_navigator.pdf_generator import (
    Saws2PlusFieldAdapter,
    _FORMS_DIR,
    inspect_pdf_form,
)
from benefits_navigator.saws2_plus_inventory import (
    COUNTY_USE_ONLY_FIELDS,
    DERIVED_FIELDS,
    NOT_APPLICABLE_REASONS,
    SIGNATURE_FIELDS,
    SSN_FIELDS,
    FieldClass,
    classify_form,
    coverage_summary,
)

PDF = _FORMS_DIR / "CA-SAWS-2-PLUS.pdf"


@pytest.fixture(scope="module")
def classified() -> dict[str, FieldClass]:
    return classify_form(PDF)


@pytest.fixture(scope="module")
def safe_fields() -> frozenset[str]:
    return frozenset(Saws2PlusFieldAdapter.SAFE_FIELDS)


# ---------------------------------------------------------------------------
# Full coverage
# ---------------------------------------------------------------------------


def test_every_pdf_field_has_exactly_one_classification(classified):
    """No field may be missing from the inventory."""
    all_names = {
        field["name"] for field in inspect_pdf_form(PDF) if field.get("name")
    }

    assert set(classified) == all_names
    assert len(classified) == len(all_names)

    for name, classification in classified.items():
        assert isinstance(classification, FieldClass), name


def test_no_field_is_left_unclassified(classified):
    summary = coverage_summary(PDF)

    assert summary["total"] == len(classified)
    assert sum(summary["counts"].values()) == summary["total"]


def test_unreviewed_fields_are_tracked_not_writable(classified, safe_fields):
    """"Unreviewed" must mean "never written", not "silently blank"."""
    unreviewed = {
        name
        for name, classification in classified.items()
        if classification is FieldClass.UNREVIEWED
    }

    assert unreviewed, "the inventory should report the remaining review backlog"
    assert not (unreviewed & safe_fields)


# ---------------------------------------------------------------------------
# Privacy invariants
# ---------------------------------------------------------------------------


def test_ssn_destinations_are_never_writable(safe_fields):
    assert not (SSN_FIELDS & safe_fields)


def test_signature_destinations_are_never_writable(safe_fields):
    assert not (SIGNATURE_FIELDS & safe_fields)


def test_ssn_and_signature_fields_exist_in_the_real_form():
    """Guard against the lists drifting away from the actual PDF."""
    all_names = {
        field["name"] for field in inspect_pdf_form(PDF) if field.get("name")
    }

    assert SSN_FIELDS <= all_names
    assert SIGNATURE_FIELDS <= all_names
    assert COUNTY_USE_ONLY_FIELDS <= all_names
    assert set(NOT_APPLICABLE_REASONS) <= all_names


def test_ssn_classification_wins_over_every_other_bucket(classified):
    for name in SSN_FIELDS:
        assert classified[name] is FieldClass.MANUAL_SSN


def test_signature_classification_wins_over_every_other_bucket(classified):
    for name in SIGNATURE_FIELDS:
        assert classified[name] is FieldClass.MANUAL_SIGNATURE


def test_page_one_ssn_field_is_the_reviewed_destination(classified):
    """Text3 PG 1 is the applicant SSN box despite its opaque name."""
    assert classified["Text3 PG 1"] is FieldClass.MANUAL_SSN


def test_adapter_refuses_to_write_an_unreviewed_destination(monkeypatch):
    """A mapping that points at an unreviewed destination must fail loudly.

    This is the guard that keeps the 1,186 not-yet-reviewed fields unwritable:
    adding a destination to a mapping table without adding it to SAFE_FIELDS
    raises rather than quietly writing to an unknown box on the form.
    """
    adapter = Saws2PlusFieldAdapter()

    monkeypatch.setitem(
        Saws2PlusFieldAdapter.TEXT_FIELDS,
        "applicant.first_name",
        "Text999 PG 9",
    )

    with pytest.raises(RuntimeError, match="Unreviewed SAWS 2 PLUS field"):
        adapter.map_values(
            {"applicant.first_name": "Ada"},
            available_fields=set(Saws2PlusFieldAdapter.SAFE_FIELDS) | {"Text999 PG 9"},
        )


def test_map_values_only_ever_returns_reviewed_destinations(safe_fields):
    adapter = Saws2PlusFieldAdapter()

    values = adapter.map_values(
        {
            "applicant.first_name": "Maria",
            "applicant.last_name": "Delgado",
            "applicant.other_names": "Maria Ruiz",
            "applicant.phone": "323-555-0142",
            "applicant.alternate_phone": "323-555-9911",
            "applicant.email": "maria@example.com",
            "applicant.home_address.street": "1420 E 41st St",
            "applicant.home_address.city": "Los Angeles",
            "applicant.preferred_language": "Spanish",
            "programs.calfresh": True,
            "programs.other": True,
            "programs.other_description": "General Relief",
            "household.homeless": False,
            "household.anyone_pregnant": True,
        },
        available_fields=set(Saws2PlusFieldAdapter.SAFE_FIELDS),
    )

    assert set(values) <= safe_fields


# ---------------------------------------------------------------------------
# Writable set integrity
# ---------------------------------------------------------------------------


def test_writable_set_matches_the_adapter_allowlist(safe_fields):
    summary = coverage_summary(PDF)

    # Everything the inventory calls writable must be an allowlisted destination
    # that actually exists in the PDF.
    assert summary["writable"] <= safe_fields


def test_derived_fields_are_all_writable(safe_fields):
    assert DERIVED_FIELDS <= safe_fields


def test_classifications_are_mutually_exclusive():
    buckets = [
        SSN_FIELDS,
        SIGNATURE_FIELDS,
        COUNTY_USE_ONLY_FIELDS,
        frozenset(NOT_APPLICABLE_REASONS),
    ]

    for i, left in enumerate(buckets):
        for right in buckets[i + 1 :]:
            assert not (left & right)


def test_not_applicable_fields_document_a_reason():
    for name, reason in NOT_APPLICABLE_REASONS.items():
        assert reason.strip(), name


# ---------------------------------------------------------------------------
# Newly reviewed page-1 destinations
# ---------------------------------------------------------------------------


NEW_PAGE_ONE_FIELDS = {
    "Text2 PG 1": "applicant.other_names",
    "Text21 PG 1": "applicant.alternate_phone",
    "Text26B PG 1": "programs.other_description",
    "Check Box26 PG 1": "programs.other",
}


def test_new_page_one_destinations_are_reviewed(safe_fields, classified):
    for destination in NEW_PAGE_ONE_FIELDS:
        assert destination in safe_fields, destination
        assert classified[destination] is FieldClass.MAPPED_FROM_UI, destination


def test_new_page_one_answers_reach_the_pdf_values():
    adapter = Saws2PlusFieldAdapter()
    available = set(Saws2PlusFieldAdapter.SAFE_FIELDS)

    values = adapter.map_values(
        {
            "applicant.first_name": "Maria",
            "applicant.last_name": "Delgado",
            "applicant.other_names": "Maria Ruiz",
            "applicant.phone": "323-555-0142",
            "applicant.alternate_phone": "323-555-9911",
            "programs.other": True,
            "programs.other_description": "General Relief",
        },
        available_fields=available,
    )

    assert values["Text2 PG 1"] == "Maria Ruiz"
    assert values["Text21 PG 1"] == "323-555-9911"
    assert values["Text26B PG 1"] == "General Relief"
    assert values["Check Box26 PG 1"] == "/Yes"


def test_unanswered_values_are_left_blank_not_fabricated():
    """Absent answers must produce no value at all."""
    adapter = Saws2PlusFieldAdapter()

    values = adapter.map_values(
        {"applicant.first_name": "Maria", "applicant.last_name": "Delgado"},
        available_fields=set(Saws2PlusFieldAdapter.SAFE_FIELDS),
    )

    for destination in ("Text2 PG 1", "Text21 PG 1", "Text26B PG 1", "Check Box26 PG 1"):
        assert destination not in values

    # And no SSN or signature destination is present under any circumstances.
    assert not (SSN_FIELDS & set(values))
    assert not (SIGNATURE_FIELDS & set(values))


def test_other_program_checkbox_requires_an_explicit_request():
    adapter = Saws2PlusFieldAdapter()

    values = adapter.map_values(
        {"programs.other": False},
        available_fields=set(Saws2PlusFieldAdapter.SAFE_FIELDS),
    )

    assert "Check Box26 PG 1" not in values


# ---------------------------------------------------------------------------
# End-to-end: a household of "me and my one year old" reaches the real PDF
# ---------------------------------------------------------------------------
#
# The canonical keys below mirror what buildApplicationFieldPlan() emits for
# that household; the TypeScript side asserts the plan contents in
# web/tests/unit/household-to-pdf-pipeline.test.ts. Here we drive the real
# generator and inspect the resulting AcroForm values, so "the child reaches the
# PDF" is verified against the actual document rather than a return code.


APPLICANT_AND_ONE_YEAR_OLD = {
    "applicant.first_name": "Maria",
    "applicant.middle_name": "E",
    "applicant.last_name": "Delgado",
    "applicant.other_names": "Maria Ruiz",
    "applicant.date_of_birth": "1993-04-12",
    "applicant.phone": "323-555-0142",
    "applicant.alternate_phone": "323-555-9911",
    "applicant.email": "maria@example.com",
    "applicant.preferred_language": "Spanish",
    "applicant.home_address.street": "1420 E 41st St",
    "applicant.home_address.apartment": "3",
    "applicant.home_address.city": "Los Angeles",
    "applicant.home_address.county": "Los Angeles",
    "applicant.home_address.state": "CA",
    "applicant.home_address.zip_code": "90001",
    "applicant.mailing_address_same_as_home": True,
    "applicant.household.sex": "female",
    "applicant.household.citizen_or_national": True,
    "applicant.household.marital_status": "married",
    "applicant.household.applying_for.medi_cal": True,
    "applicant.household.applying_for.calfresh": True,
    "applicant.email_application_information": True,
    "household.homeless": False,
    # Printed-row assignment, exactly as the canonical mapper emits it.
    "applicant.table": "adult",
    "applicant.table_row": 0,
    "household.members.count": 1,
    "household.members.0.present": True,
    "household.members.0.table": "child",
    "household.members.0.table_row": 0,
    # The child parsed from "me and my one year old", completed in the UI.
    "household.members.0.first_name": "Sofia",
    "household.members.0.last_name": "Delgado",
    "household.members.0.date_of_birth": "2024-06-15",
    "household.members.0.relationship_to_applicant": "Daughter",
    "household.members.0.age": 1,
    "household.members.0.child.sex": "female",
    "household.members.0.child.place_of_birth": "Los Angeles, CA",
    "household.members.0.child.citizen_or_national": True,
    "household.members.0.child.immunizations_up_to_date": True,
    "household.members.0.child.parent_status.none": True,
    "household.members.0.applying_for.medi_cal": True,
    "household.size": 2,
    "programs.medi_cal": True,
    "programs.calfresh": True,
}


@pytest.fixture(scope="module")
def one_year_old_pdf_values(tmp_path_factory):
    """Generate a real SAWS 2 PLUS PDF and read back its AcroForm values."""
    from pypdf import PdfReader

    from benefits_navigator.pdf_generator import generate_saws2_plus_pdf

    field_plan = [
        {"key": key, "value": value}
        for key, value in APPLICANT_AND_ONE_YEAR_OLD.items()
    ]

    args = {
        "state": "CA",
        "county": "Los Angeles",
        "zip_code": "90001",
        "application_field_plan": field_plan,
    }

    output_dir = tmp_path_factory.mktemp("saws-one-year-old")
    path = generate_saws2_plus_pdf(args, "", output_dir)

    fields = PdfReader(str(path)).get_fields() or {}

    return {
        name: str(spec.get("/V"))
        for name, spec in fields.items()
        if spec.get("/V") not in (None, "")
    }


def test_generated_pdf_contains_the_applicant_details(one_year_old_pdf_values):
    values = one_year_old_pdf_values

    assert "Maria" in values["Text1 PG 1"]
    assert values["Text2 PG 1"] == "Maria Ruiz"
    assert values["Text20 PG 1"] == "323-555-0142"
    assert values["Text21 PG 1"] == "323-555-9911"
    assert values["Text22 PG 1"] == "maria@example.com"
    assert values["Text4 PG 1"] == "1420 E 41st St"
    assert values["Text6 PG 1"] == "Los Angeles"
    assert values["Text7 PG 1"] == "Los Angeles"
    assert values["Text9 PG 1"] == "90001"
    assert values["Text30 PG 1"] == "Spanish"


def test_generated_pdf_contains_the_child_row(one_year_old_pdf_values):
    """The 1-year-old must appear in the page-4 child table."""
    values = one_year_old_pdf_values

    page_four = {
        name: value for name, value in values.items() if name.endswith("PG 4")
    }

    assert page_four, "the child table must not be empty"
    assert any("Delgado" in value for value in page_four.values())
    assert any("Daughter" in value for value in page_four.values())
    assert any("2024" in value or "06/15/2024" in value for value in page_four.values())
    assert any(value == "F" for value in page_four.values())


def test_generated_pdf_places_the_applicant_in_the_adult_table(one_year_old_pdf_values):
    values = one_year_old_pdf_values

    page_three = {
        name: value for name, value in values.items() if name.endswith("PG 3")
    }

    assert any("Delgado" in value for value in page_three.values())


def test_generated_pdf_leaves_every_ssn_and_signature_blank(one_year_old_pdf_values):
    written = set(one_year_old_pdf_values)

    assert not (SSN_FIELDS & written)
    assert not (SIGNATURE_FIELDS & written)


def test_generated_pdf_writes_a_substantial_number_of_fields(one_year_old_pdf_values):
    """Guard against a regression that silently stops filling the form."""
    assert len(one_year_old_pdf_values) >= 30


def test_generated_pdf_never_writes_an_unreviewed_destination(
    one_year_old_pdf_values, safe_fields
):
    assert set(one_year_old_pdf_values) <= safe_fields


# ---------------------------------------------------------------------------
# Realistic fixtures: generate the official PDF and inspect AcroForm values
# ---------------------------------------------------------------------------
#
# Each fixture mirrors what buildApplicationFieldPlan() emits for a completed
# questionnaire. Page-16 destinations were reviewed against the printed page and
# the widget coordinates (see Saws2PlusFieldAdapter.PAGE_16_YES_NO).


def _generate(field_plan_dict, tmp_path):
    """Generate a real SAWS 2 PLUS PDF and read back its filled AcroForm values."""
    from pypdf import PdfReader

    from benefits_navigator.pdf_generator import generate_saws2_plus_pdf

    args = {
        "state": "CA",
        "county": "Los Angeles",
        "zip_code": "90001",
        "application_field_plan": [
            {"key": key, "value": value} for key, value in field_plan_dict.items()
        ],
    }

    path = generate_saws2_plus_pdf(args, "", tmp_path)
    fields = PdfReader(str(path)).get_fields() or {}

    return {
        name: str(spec.get("/V"))
        for name, spec in fields.items()
        if spec.get("/V") not in (None, "")
    }


_APPLICANT_CORE = {
    "applicant.first_name": "Maria",
    "applicant.last_name": "Delgado",
    "applicant.date_of_birth": "1993-04-12",
    "applicant.phone": "323-555-0142",
    "applicant.email": "maria@example.com",
    "applicant.home_address.street": "1420 E 41st St",
    "applicant.home_address.city": "Los Angeles",
    "applicant.home_address.county": "Los Angeles",
    "applicant.home_address.state": "CA",
    "applicant.home_address.zip_code": "90001",
    "applicant.mailing_address_same_as_home": True,
    "applicant.household.sex": "female",
    "applicant.household.citizen_or_national": True,
    "applicant.table": "adult",
    "applicant.table_row": 0,
}


# ── Fixture 1: working family ──────────────────────────────────────────────


@pytest.fixture(scope="module")
def working_family_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "applicant.household.marital_status": "married",
        "applicant.household.applying_for.calfresh": True,
        "applicant.household.applying_for.medi_cal": True,
        "programs.calfresh": True,
        "programs.medi_cal": True,
        # Spouse and a 1-year-old child.
        "household.members.count": 2,
        "household.members.0.present": True,
        "household.members.0.table": "adult",
        "household.members.0.table_row": 1,
        "household.members.1.present": True,
        "household.members.1.table": "child",
        "household.members.1.table_row": 0,
        "household.members.0.first_name": "Luis",
        "household.members.0.last_name": "Delgado",
        "household.members.0.date_of_birth": "1991-09-02",
        "household.members.0.relationship_to_applicant": "Spouse",
        "household.members.0.adult.sex": "male",
        "household.members.0.adult.marital_status": "married",
        "household.members.0.adult.citizen_or_national": True,
        "household.members.0.applying_for.calfresh": True,
        "household.members.1.first_name": "Sofia",
        "household.members.1.last_name": "Delgado",
        "household.members.1.date_of_birth": "2024-06-15",
        "household.members.1.relationship_to_applicant": "Daughter",
        "household.members.1.child.sex": "female",
        "household.members.1.child.citizen_or_national": True,
        "household.members.1.child.immunizations_up_to_date": True,
        "household.members.1.applying_for.medi_cal": True,
        # Questionnaire answers.
        "income.has_earned_income": True,
        "income.earned.0.member_id": "applicant",
        "income.earned.0.employer_name": "Acme Diner",
        "expenses.has_household_expenses": True,
        "expenses.household.0.kind": "rent_or_mortgage",
        "expenses.household.0.amount_monthly": 1400,
        "resources.has_accounts": True,
        "resources.accounts.0.kind": "checking",
        "resources.has_vehicles": True,
        "resources.vehicles.0.make": "Toyota",
        "health.has_current_coverage": True,
        "health.tax_filer": True,
        "health.spouse_filing_jointly": True,
        # Explicit No answers to the legal questions.
        "integrity.fleeing_felon": False,
        "integrity.probation_or_parole_violation": False,
        "services.third_party_liability": False,
        "services.immunization_information": True,
    }

    return _generate(plan, tmp_path_factory.mktemp("saws-working-family"))


def test_working_family_fills_applicant_and_both_members(working_family_pdf):
    values = working_family_pdf

    assert "Maria" in values["Text1 PG 1"]
    # Spouse in the adult table, child in the child table.
    page_three = [v for k, v in values.items() if k.endswith("PG 3")]
    page_four = [v for k, v in values.items() if k.endswith("PG 4")]

    assert any("Luis" in v for v in page_three)
    assert any("Sofia" in v for v in page_four)


def test_working_family_writes_page_16_answers(working_family_pdf):
    values = working_family_pdf

    # Explicit No ticks the No box.
    assert values.get("Check Box2 PG 16") == "/Yes"   # fleeing felon: No
    assert values.get("Check Box5 PG 16") == "/Yes"   # probation: No
    assert values.get("Check Box30 PG 16") == "/Yes"  # third-party liability: No
    # Explicit Yes ticks the Yes box.
    assert values.get("Check Box19 PG 16") == "/Yes"  # immunization info: Yes

    # The opposite box in each pair stays blank.
    assert "Check Box1 PG 16" not in values
    assert "Check Box4 PG 16" not in values
    assert "Check Box29 PG 16" not in values
    assert "Check Box20 PG 16" not in values


def test_working_family_leaves_unasked_page_16_questions_blank(working_family_pdf):
    values = working_family_pdf

    # Never asked: both boxes blank.
    for destination in (
        "Check Box7 PG 16", "Check Box8 PG 16",     # special-need payment
        "Check Box11 PG 16", "Check Box12 PG 16",   # CHDP information
        "Check Box27 PG 16", "Check Box28 PG 16",   # family planning
    ):
        assert destination not in values, destination


def test_working_family_never_writes_ssn_or_signature(working_family_pdf):
    written = set(working_family_pdf)

    assert not (SSN_FIELDS & written)
    assert not (SIGNATURE_FIELDS & written)


def test_working_family_only_writes_reviewed_destinations(
    working_family_pdf, safe_fields
):
    assert set(working_family_pdf) <= safe_fields


def test_working_family_field_count(working_family_pdf):
    # Regression floor: a working family with two members and page-16 answers.
    assert len(working_family_pdf) >= 35


# ── Fixture 2: self-employed household ─────────────────────────────────────


@pytest.fixture(scope="module")
def self_employed_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "applicant.household.marital_status": "single",
        "programs.calfresh": True,
        "household.members.count": 1,
        "household.members.0.present": True,
        "household.members.0.table": "child",
        "household.members.0.table_row": 0,
        "household.members.0.first_name": "Sofia",
        "household.members.0.last_name": "Delgado",
        "household.members.0.date_of_birth": "2024-06-15",
        "household.members.0.relationship_to_applicant": "Daughter",
        "household.members.0.child.sex": "female",
        # Self-employment answered, wage employment explicitly No.
        "income.has_earned_income": False,
        "income.has_self_employment": True,
        "income.self_employment.0.business_name": "Delgado Cleaning",
        "income.self_employment.0.business_type": "House cleaning",
        "income.self_employment.0.start_date": "2023-05-01",
        "income.self_employment.0.gross_monthly": 2200,
        "income.self_employment.0.net_monthly": 1500,
        "income.self_employment.0.expense_method": "standard_40_percent",
        # Explicit No gateways.
        "income.has_unearned_income": False,
        "resources.has_accounts": False,
        "resources.has_vehicles": False,
        "integrity.fleeing_felon": False,
        "integrity.probation_or_parole_violation": False,
    }

    return _generate(plan, tmp_path_factory.mktemp("saws-self-employed"))


def test_self_employed_records_explicit_no_answers(self_employed_pdf):
    values = self_employed_pdf

    assert values.get("Check Box2 PG 16") == "/Yes"
    assert values.get("Check Box5 PG 16") == "/Yes"
    assert "Check Box1 PG 16" not in values


def test_self_employed_child_row_is_populated(self_employed_pdf):
    page_four = [v for k, v in self_employed_pdf.items() if k.endswith("PG 4")]

    assert any("Sofia" in v for v in page_four)


def test_self_employed_never_writes_ssn_or_signature(self_employed_pdf):
    written = set(self_employed_pdf)

    assert not (SSN_FIELDS & written)
    assert not (SIGNATURE_FIELDS & written)


# ── Fixture 3: explicit No versus never asked ──────────────────────────────


@pytest.fixture(scope="module")
def explicit_no_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "programs.medi_cal": True,
        "services.chdp_more_information": False,
        "services.chdp_medical": False,
        "services.family_planning": False,
        "services.breastfeeding": False,
        "integrity.fleeing_felon": False,
    }

    return _generate(plan, tmp_path_factory.mktemp("saws-explicit-no"))


@pytest.fixture(scope="module")
def never_asked_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "programs.medi_cal": True,
    }

    return _generate(plan, tmp_path_factory.mktemp("saws-never-asked"))


def test_explicit_no_ticks_the_no_box(explicit_no_pdf):
    values = explicit_no_pdf

    assert values.get("Check Box12 PG 16") == "/Yes"  # CHDP info: No
    assert values.get("Check Box14 PG 16") == "/Yes"  # CHDP medical: No
    assert values.get("Check Box28 PG 16") == "/Yes"  # family planning: No
    assert values.get("Check Box24 PG 16") == "/Yes"  # breastfeeding: No
    assert values.get("Check Box2 PG 16") == "/Yes"   # fleeing felon: No


def test_explicit_no_leaves_the_yes_box_blank(explicit_no_pdf):
    for destination in (
        "Check Box11 PG 16",
        "Check Box13 PG 16",
        "Check Box27 PG 16",
        "Check Box23 PG 16",
        "Check Box1 PG 16",
    ):
        assert destination not in explicit_no_pdf, destination


def test_never_asked_leaves_both_boxes_blank(never_asked_pdf):
    """Unknown must be visually different from an explicit No."""
    for destination in (
        "Check Box1 PG 16", "Check Box2 PG 16",
        "Check Box11 PG 16", "Check Box12 PG 16",
        "Check Box13 PG 16", "Check Box14 PG 16",
        "Check Box23 PG 16", "Check Box24 PG 16",
        "Check Box27 PG 16", "Check Box28 PG 16",
    ):
        assert destination not in never_asked_pdf, destination


def test_unknown_and_no_produce_different_documents(explicit_no_pdf, never_asked_pdf):
    assert set(explicit_no_pdf) != set(never_asked_pdf)
    assert len(explicit_no_pdf) > len(never_asked_pdf)


# ── Explanations follow their gateway ──────────────────────────────────────


def test_explanation_text_is_written_only_alongside_a_yes(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "integrity.fleeing_felon": True,
            "integrity.fleeing_felon_who": "Household member 2",
            "services.third_party_liability": True,
            "services.third_party_liability_who": "Applicant",
        },
        tmp_path_factory.mktemp("saws-explanations"),
    )

    assert values.get("Check Box1 PG 16") == "/Yes"
    assert values.get("Text3 PG 16") == "Household member 2"
    assert values.get("Check Box29 PG 16") == "/Yes"
    assert values.get("Text31 PG 16") == "Applicant"


# ---------------------------------------------------------------------------
# Page 9 — earned income (Q8), job-change block, self-employment (Q8a)
# ---------------------------------------------------------------------------
#
# Column semantics were verified by matching printed header x-positions to widget
# column bands; see Saws2PlusFieldAdapter.PAGE_9_EARNED_ROWS.

#: Column order within each Q8 row, for readable assertions.
Q8_PERSON, Q8_EMPLOYER, Q8_PHONE, Q8_HOURLY, Q8_HOURS, Q8_FREQUENCY, Q8_MONTH, \
    Q8_CONTINUE_YES, Q8_CONTINUE_NO = range(9)

Q8A_PERSON, Q8A_BUSINESS, Q8A_TYPE, Q8A_STARTED, Q8A_GROSS, Q8A_NET, \
    Q8A_FLAT, Q8A_ACTUAL, Q8A_AVERAGE, Q8A_ACTUAL_AMOUNT, Q8A_AVERAGE_AMOUNT = range(11)


def _q8(row: int, column: int) -> str:
    return Saws2PlusFieldAdapter.PAGE_9_EARNED_ROWS[row][column]


def _q8a(row: int, column: int) -> str:
    return Saws2PlusFieldAdapter.PAGE_9_SELF_EMPLOYMENT_ROWS[row][column]


_ONE_JOB = {
    "income.has_earned_income": True,
    "income.earned.0.person_name": "Maria Delgado",
    "income.earned.0.employer_name": "Acme Diner",
    "income.earned.0.employer_address": "88 Main St, Los Angeles",
    "income.earned.0.employer_phone": "323-555-7000",
    "income.earned.0.hourly_rate": 17.5,
    "income.earned.0.hours_per_week": 30,
    "income.earned.0.pay_frequency": "every_two_weeks",
    "income.earned.0.gross_received_this_month": 2100,
    "income.earned.0.expected_to_continue": True,
    # Deliberately present but unmapped: there is no printed per-period column.
    "income.earned.0.gross_per_period": 800,
    "income.earned.0.start_date": "2024-01-15",
}


@pytest.fixture(scope="module")
def one_job_pdf(tmp_path_factory):
    return _generate(
        {**_APPLICANT_CORE, "programs.calfresh": True, **_ONE_JOB},
        tmp_path_factory.mktemp("saws-one-job"),
    )


def test_one_earned_record_populates_the_first_row(one_job_pdf):
    values = one_job_pdf

    assert values[_q8(0, Q8_PERSON)] == "Maria Delgado"
    assert values[_q8(0, Q8_EMPLOYER)] == "Acme Diner, 88 Main St, Los Angeles"
    assert values[_q8(0, Q8_PHONE)] == "323-555-7000"
    assert values[_q8(0, Q8_HOURLY)] == "17.5"
    assert values[_q8(0, Q8_HOURS)] == "30"
    assert values[_q8(0, Q8_FREQUENCY)] == "Every two weeks"
    assert values[_q8(0, Q8_MONTH)] == "2100"


def test_one_earned_record_ticks_expect_to_continue_yes(one_job_pdf):
    assert one_job_pdf[_q8(0, Q8_CONTINUE_YES)] == "/Yes"
    assert _q8(0, Q8_CONTINUE_NO) not in one_job_pdf


def test_earned_gateway_yes_is_written(one_job_pdf):
    yes_field, no_field = Saws2PlusFieldAdapter.PAGE_9_EARNED_GATEWAY

    assert one_job_pdf[yes_field] == "/Yes"
    assert no_field not in one_job_pdf


def test_one_earned_record_leaves_later_rows_untouched(one_job_pdf):
    for row in (1, 2, 3):
        for column in range(9):
            assert _q8(row, column) not in one_job_pdf, (row, column)


def test_per_period_gross_is_never_written_to_the_monthly_column(one_job_pdf):
    """The month column holds only the month total, never a per-period amount."""
    assert one_job_pdf[_q8(0, Q8_MONTH)] == "2100"

    # 800 was collected as gross-per-period; it must appear nowhere on page 9.
    page_nine = {k: v for k, v in one_job_pdf.items() if k.endswith("PG 9")}
    assert "800" not in page_nine.values()


def test_values_land_in_distinct_columns(one_job_pdf):
    """Guard against everything being written into one column."""
    row_values = [
        one_job_pdf.get(_q8(0, column))
        for column in (Q8_PERSON, Q8_EMPLOYER, Q8_PHONE, Q8_HOURLY, Q8_HOURS,
                       Q8_FREQUENCY, Q8_MONTH)
    ]

    assert all(value for value in row_values)
    assert len(set(row_values)) == len(row_values)


def test_one_job_writes_only_reviewed_destinations(one_job_pdf, safe_fields):
    assert set(one_job_pdf) <= safe_fields


def test_one_job_never_writes_ssn_or_signature(one_job_pdf):
    written = set(one_job_pdf)

    assert not (SSN_FIELDS & written)
    assert not (SIGNATURE_FIELDS & written)


# ── Multiple jobs land in distinct rows ────────────────────────────────────


@pytest.fixture(scope="module")
def three_jobs_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "programs.calfresh": True,
        "income.has_earned_income": True,
        "income.earned.0.person_name": "Maria Delgado",
        "income.earned.0.employer_name": "Acme Diner",
        "income.earned.0.hours_per_week": 30,
        "income.earned.0.pay_frequency": "weekly",
        "income.earned.0.gross_received_this_month": 2100,
        "income.earned.0.expected_to_continue": True,
        "income.earned.1.person_name": "Luis Delgado",
        "income.earned.1.employer_name": "Night Shift Co",
        "income.earned.1.hours_per_week": 20,
        "income.earned.1.pay_frequency": "monthly",
        "income.earned.1.gross_received_this_month": 950,
        "income.earned.1.expected_to_continue": False,
        "income.earned.2.person_name": "Luis Delgado",
        "income.earned.2.employer_name": "Weekend Market",
        "income.earned.2.hours_per_week": 8,
        "income.earned.2.pay_frequency": "irregular",
        "income.earned.2.gross_received_this_month": 300,
    }

    return _generate(plan, tmp_path_factory.mktemp("saws-three-jobs"))


def test_multiple_records_populate_distinct_rows(three_jobs_pdf):
    values = three_jobs_pdf

    assert values[_q8(0, Q8_EMPLOYER)] == "Acme Diner"
    assert values[_q8(1, Q8_EMPLOYER)] == "Night Shift Co"
    assert values[_q8(2, Q8_EMPLOYER)] == "Weekend Market"

    assert values[_q8(0, Q8_PERSON)] == "Maria Delgado"
    assert values[_q8(1, Q8_PERSON)] == "Luis Delgado"
    assert values[_q8(2, Q8_PERSON)] == "Luis Delgado"

    assert values[_q8(0, Q8_HOURS)] == "30"
    assert values[_q8(1, Q8_HOURS)] == "20"
    assert values[_q8(2, Q8_HOURS)] == "8"

    assert values[_q8(0, Q8_FREQUENCY)] == "Weekly"
    assert values[_q8(1, Q8_FREQUENCY)] == "Monthly"
    assert values[_q8(2, Q8_FREQUENCY)] == "Irregular"


def test_per_row_expect_to_continue_is_independent(three_jobs_pdf):
    values = three_jobs_pdf

    # Row 1 Yes, row 2 No, row 3 never answered.
    assert values[_q8(0, Q8_CONTINUE_YES)] == "/Yes"
    assert _q8(0, Q8_CONTINUE_NO) not in values

    assert values[_q8(1, Q8_CONTINUE_NO)] == "/Yes"
    assert _q8(1, Q8_CONTINUE_YES) not in values

    assert _q8(2, Q8_CONTINUE_YES) not in values
    assert _q8(2, Q8_CONTINUE_NO) not in values


def test_fourth_row_stays_empty_with_three_records(three_jobs_pdf):
    for column in range(9):
        assert _q8(3, column) not in three_jobs_pdf


def test_three_jobs_only_writes_reviewed_destinations(three_jobs_pdf, safe_fields):
    assert set(three_jobs_pdf) <= safe_fields


# ── Gateway states ─────────────────────────────────────────────────────────


def test_unknown_earned_gateway_writes_nothing_on_page_nine(tmp_path_factory):
    values = _generate(
        {**_APPLICANT_CORE, "programs.calfresh": True},
        tmp_path_factory.mktemp("saws-earned-unknown"),
    )

    page_nine = {name for name in values if name.endswith("PG 9")}
    assert page_nine == set()


def test_explicit_no_writes_the_no_box_and_no_detail(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.has_earned_income": False,
        },
        tmp_path_factory.mktemp("saws-earned-no"),
    )

    yes_field, no_field = Saws2PlusFieldAdapter.PAGE_9_EARNED_GATEWAY

    assert values[no_field] == "/Yes"
    assert yes_field not in values

    # No detail row is touched.
    for row in range(4):
        for column in range(9):
            assert _q8(row, column) not in values, (row, column)


def test_stale_records_write_nothing(tmp_path_factory):
    """A No gateway with leftover records must not populate any row.

    The TypeScript field plan omits inactive records, so the canonical values
    reaching the adapter contain the gateway only. This asserts the adapter does
    not resurrect a row from anything else.
    """
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.has_earned_income": False,
        },
        tmp_path_factory.mktemp("saws-earned-stale"),
    )

    assert _q8(0, Q8_EMPLOYER) not in values
    assert _q8(0, Q8_PERSON) not in values


def test_unnamed_person_leaves_the_person_column_blank(tmp_path_factory):
    """A record whose person has no typed name must not print a placeholder."""
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.has_earned_income": True,
            "income.earned.0.employer_name": "Acme Diner",
        },
        tmp_path_factory.mktemp("saws-earned-unnamed"),
    )

    assert values[_q8(0, Q8_EMPLOYER)] == "Acme Diner"
    assert _q8(0, Q8_PERSON) not in values


# ── Q8 job-change block ────────────────────────────────────────────────────


def test_job_change_block_is_populated(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.recent_job_change": True,
            "income.recent_job_change.0.person_name": "Luis Delgado",
            "income.recent_job_change.0.change_date": "2025-11-30",
            "income.recent_job_change.0.reason": "Hours reduced",
        },
        tmp_path_factory.mktemp("saws-job-change"),
    )

    yes_field, no_field = Saws2PlusFieldAdapter.PAGE_9_JOB_CHANGE_GATEWAY

    assert values[yes_field] == "/Yes"
    assert no_field not in values
    assert values[Saws2PlusFieldAdapter.PAGE_9_JOB_CHANGE_WHO] == "Luis Delgado"
    assert values[Saws2PlusFieldAdapter.PAGE_9_JOB_CHANGE_DATE] == "2025-11-30"
    assert values[Saws2PlusFieldAdapter.PAGE_9_JOB_CHANGE_REASON] == "Hours reduced"


def test_job_change_explicit_no_ticks_no_only(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.recent_job_change": False,
        },
        tmp_path_factory.mktemp("saws-job-change-no"),
    )

    yes_field, no_field = Saws2PlusFieldAdapter.PAGE_9_JOB_CHANGE_GATEWAY

    assert values[no_field] == "/Yes"
    assert yes_field not in values
    assert Saws2PlusFieldAdapter.PAGE_9_JOB_CHANGE_WHO not in values


# ── Q8a self-employment ────────────────────────────────────────────────────


def test_self_employment_row_is_populated(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.has_self_employment": True,
            "income.self_employment.0.person_name": "Maria Delgado",
            "income.self_employment.0.business_name": "Delgado Cleaning",
            "income.self_employment.0.business_type": "House cleaning",
            "income.self_employment.0.start_date": "2023-05-01",
            "income.self_employment.0.gross_monthly": 2200,
            "income.self_employment.0.net_monthly": 1500,
            "income.self_employment.0.expense_method": "standard_40_percent",
        },
        tmp_path_factory.mktemp("saws-self-employment"),
    )

    assert values[_q8a(0, Q8A_PERSON)] == "Maria Delgado"
    assert values[_q8a(0, Q8A_BUSINESS)] == "Delgado Cleaning"
    assert values[_q8a(0, Q8A_TYPE)] == "House cleaning"
    assert "2023" in values[_q8a(0, Q8A_STARTED)]
    assert values[_q8a(0, Q8A_GROSS)] == "2200"
    assert values[_q8a(0, Q8A_NET)] == "1500"

    # The 40% flat-rate option is checked and the other two are not.
    assert values[_q8a(0, Q8A_FLAT)] == "/Yes"
    assert _q8a(0, Q8A_ACTUAL) not in values
    assert _q8a(0, Q8A_AVERAGE) not in values


def test_self_employment_actual_expenses_writes_the_amount(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.self_employment.0.business_name": "Delgado Cleaning",
            "income.self_employment.0.expense_method": "actual_expenses",
            "income.self_employment.0.expense_amount": 410,
        },
        tmp_path_factory.mktemp("saws-self-employment-actual"),
    )

    assert values[_q8a(0, Q8A_ACTUAL)] == "/Yes"
    assert values[_q8a(0, Q8A_ACTUAL_AMOUNT)] == "410"
    assert _q8a(0, Q8A_FLAT) not in values
    assert _q8a(0, Q8A_AVERAGE_AMOUNT) not in values


def test_self_employment_multiple_rows_are_distinct(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "programs.calfresh": True,
            "income.self_employment.0.business_name": "Delgado Cleaning",
            "income.self_employment.1.business_name": "Weekend Catering",
        },
        tmp_path_factory.mktemp("saws-self-employment-rows"),
    )

    assert values[_q8a(0, Q8A_BUSINESS)] == "Delgado Cleaning"
    assert values[_q8a(1, Q8A_BUSINESS)] == "Weekend Catering"
    assert _q8a(2, Q8A_BUSINESS) not in values


def test_page_nine_row_capacity_is_respected(tmp_path_factory):
    """A fifth job has no printed row; it must not overwrite row 4."""
    plan = {**_APPLICANT_CORE, "programs.calfresh": True, "income.has_earned_income": True}

    for index, employer in enumerate(
        ["First", "Second", "Third", "Fourth", "Fifth"]
    ):
        plan[f"income.earned.{index}.employer_name"] = employer

    values = _generate(plan, tmp_path_factory.mktemp("saws-earned-overflow"))

    assert values[_q8(0, Q8_EMPLOYER)] == "First"
    assert values[_q8(3, Q8_EMPLOYER)] == "Fourth"
    # "Fifth" has nowhere to go and is not written anywhere on the page.
    page_nine = {k: v for k, v in values.items() if k.endswith("PG 9")}
    assert "Fifth" not in page_nine.values()


def test_page_nine_earned_fixture_field_count(one_job_pdf):
    page_nine = {name for name in one_job_pdf if name.endswith("PG 9")}

    # Gateway + 7 text columns + expect-to-continue for one row.
    assert len(page_nine) >= 9


# ---------------------------------------------------------------------------
# Q7 / Q9 / Q15 / Q24 — high-priority destinations
# ---------------------------------------------------------------------------
#
# Column identity for each of these was established by matching printed header
# and glyph coordinates to widget rectangles; see the tables on
# Saws2PlusFieldAdapter.

A = Saws2PlusFieldAdapter


def _q7(row, col):
    return A.PAGE_8_UNEARNED_ROWS[row][col]


Q7_PERSON, Q7_FROM, Q7_AMOUNT, Q7_OFTEN, Q7_CONT_YES, Q7_CONT_NO = range(6)
Q9_FREE, Q9_FOR_WORK, Q9_WHO_GETS, Q9_VALUE, Q9_WHO_GIVES = range(5)
Q15_YES, Q15_NO, Q15_WHO_PAYS, Q15_AMOUNT, Q15_OFTEN = range(5)
Q24_NAME, Q24_TYPE, Q24_WORTH, Q24_WHERE = range(4)


# ── Q7 Unearned Income ─────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def q7_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "programs.calfresh": True,
        "income.has_unearned_income": True,
        # SSI arrives monthly, so the reported pair says so.
        "income.unearned.0.person_name": "Maria Delgado",
        "income.unearned.0.source": "SSI",
        "income.unearned.0.reported_amount": 943,
        "income.unearned.0.reported_frequency": "Monthly",
        "income.unearned.0.amount_monthly": 943,
        # Unemployment is paid every two weeks. The printed columns must show
        # what was reported — 400 every two weeks — not the 866.67 monthly
        # equivalent the budget uses.
        "income.unearned.1.person_name": "Luis Delgado",
        "income.unearned.1.source": "Unemployment Insurance",
        "income.unearned.1.reported_amount": 400,
        "income.unearned.1.reported_frequency": "Every two weeks",
        "income.unearned.1.amount_monthly": 866.67,
    }
    return _generate(plan, tmp_path_factory.mktemp("saws-q7"))


def test_q7_gateway_yes(q7_pdf):
    yes_field, no_field = A.PAGE_8_UNEARNED_GATEWAY
    assert q7_pdf[yes_field] == "/Yes"
    assert no_field not in q7_pdf


def test_q7_first_row_columns(q7_pdf):
    assert q7_pdf[_q7(0, Q7_PERSON)] == "Maria Delgado"
    assert q7_pdf[_q7(0, Q7_FROM)] == "SSI"
    assert q7_pdf[_q7(0, Q7_AMOUNT)] == "943"
    # HOW OFTEN is the applicant's reported frequency, not a restatement of an
    # internal monthly normalization.
    assert q7_pdf[_q7(0, Q7_OFTEN)] == "Monthly"


def test_q7_second_row_is_distinct(q7_pdf):
    assert q7_pdf[_q7(1, Q7_PERSON)] == "Luis Delgado"
    assert q7_pdf[_q7(1, Q7_FROM)] == "Unemployment Insurance"
    assert q7_pdf[_q7(1, Q7_AMOUNT)] == "400"
    assert q7_pdf[_q7(1, Q7_OFTEN)] == "Every two weeks"
    # The monthly equivalent used for budgeting never reaches the page.
    assert "866.67" not in q7_pdf.values()


def test_q7_unused_rows_stay_blank(q7_pdf):
    for row in (2, 3):
        for col in range(6):
            assert _q7(row, col) not in q7_pdf, (row, col)


def test_q7_expect_to_continue_never_written(q7_pdf):
    """Not collected for unearned income, so both boxes stay blank."""
    for row in range(4):
        assert _q7(row, Q7_CONT_YES) not in q7_pdf
        assert _q7(row, Q7_CONT_NO) not in q7_pdf


def test_q7_income_type_grid_never_written(q7_pdf):
    """The 27 category boxes are unmapped: a free-text source cannot pick one."""
    for number in range(25, 52):
        assert f"Check Box{number} PG 8" not in q7_pdf


def test_q7_explicit_no_writes_no_rows(tmp_path_factory):
    values = _generate(
        {**_APPLICANT_CORE, "income.has_unearned_income": False},
        tmp_path_factory.mktemp("saws-q7-no"),
    )
    yes_field, no_field = A.PAGE_8_UNEARNED_GATEWAY

    assert values[no_field] == "/Yes"
    assert yes_field not in values
    assert _q7(0, Q7_PERSON) not in values


def test_q7_does_not_touch_q8(q7_pdf):
    """Q7 lives on page 8; the Q8 earned-income table is on page 9."""
    assert not [name for name in q7_pdf if name.endswith("PG 9")]


# ── Q9 Other Income ────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def q9_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "programs.calfresh": True,
        "income.has_in_kind_support": True,
        "income.in_kind.0.kind": "housing",
        "income.in_kind.0.person_name": "Maria Delgado",
        "income.in_kind.0.provided_by": "Aunt Rosa",
        "income.in_kind.0.estimated_monthly_value": 500,
        "income.in_kind.1.kind": "food",
        "income.in_kind.1.person_name": "Luis Delgado",
        "income.in_kind.1.provided_by": "Community pantry",
        "income.in_kind.1.estimated_monthly_value": 120,
    }
    return _generate(plan, tmp_path_factory.mktemp("saws-q9"))


def test_q9_gateway_yes(q9_pdf):
    yes_field, no_field = A.PAGE_10_OTHER_INCOME_GATEWAY
    assert q9_pdf[yes_field] == "/Yes"
    assert no_field not in q9_pdf


def test_q9_rows_are_keyed_by_printed_item_type(q9_pdf):
    housing = A.PAGE_10_OTHER_INCOME_ROWS["housing"]
    food = A.PAGE_10_OTHER_INCOME_ROWS["food"]

    assert q9_pdf[housing[Q9_WHO_GETS]] == "Maria Delgado"
    assert q9_pdf[housing[Q9_VALUE]] == "500"
    assert q9_pdf[housing[Q9_WHO_GIVES]] == "Aunt Rosa"

    assert q9_pdf[food[Q9_WHO_GETS]] == "Luis Delgado"
    assert q9_pdf[food[Q9_VALUE]] == "120"
    assert q9_pdf[food[Q9_WHO_GIVES]] == "Community pantry"


def test_q9_unused_item_rows_stay_blank(q9_pdf):
    for kind in ("utilities", "clothing"):
        for field in A.PAGE_10_OTHER_INCOME_ROWS[kind]:
            assert field not in q9_pdf, (kind, field)


def test_q9_free_vs_for_work_never_guessed(q9_pdf):
    """One combined question is asked, so neither box may be ticked."""
    for row in A.PAGE_10_OTHER_INCOME_ROWS.values():
        assert row[Q9_FREE] not in q9_pdf
        assert row[Q9_FOR_WORK] not in q9_pdf


def test_q9_does_not_cross_write_into_q7_or_q8(q9_pdf):
    assert not [name for name in q9_pdf if name.endswith("PG 8")]
    assert not [name for name in q9_pdf if name.endswith("PG 9")]


# ── Q15 Household Expenses ─────────────────────────────────────────────────


@pytest.fixture(scope="module")
def q15_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "programs.calfresh": True,
        "expenses.has_household_expenses": True,
        "expenses.household.0.kind": "rent_or_mortgage",
        "expenses.household.0.amount_monthly": 1400,
        "expenses.household.1.kind": "electricity",
        "expenses.household.1.amount_monthly": 90,
        "expenses.household.2.kind": "telephone",
        "expenses.household.2.amount_monthly": 45,
        # "other" has no printed row on Q15.
        "expenses.household.3.kind": "other",
        "expenses.household.3.amount_monthly": 60,
    }
    return _generate(plan, tmp_path_factory.mktemp("saws-q15"))


def test_q15_gateway_yes(q15_pdf):
    yes_field, no_field = A.PAGE_11_EXPENSES_GATEWAY
    assert q15_pdf[yes_field] == "/Yes"
    assert no_field not in q15_pdf


def test_q15_rent_row_carries_amount_and_frequency(q15_pdf):
    row = A.PAGE_11_EXPENSE_ROWS["rent_or_house_payment"]

    assert q15_pdf[row[Q15_YES]] == "/Yes"
    assert row[Q15_NO] not in q15_pdf
    assert q15_pdf[row[Q15_AMOUNT]] == "1400"
    assert q15_pdf[row[Q15_OFTEN]] == "Monthly"


def test_q15_allowance_rows_have_no_amount_box(q15_pdf):
    """The form says heating, phone, shelter and water are set allowances."""
    for name in (
        "heating_or_cooling",
        "telephone",
        "homeless_shelter",
        "water_sewage_garbage",
    ):
        assert A.PAGE_11_EXPENSE_ROWS[name][Q15_AMOUNT] is None, name


def test_q15_utility_rows_marked_without_inventing_an_amount(q15_pdf):
    heating = A.PAGE_11_EXPENSE_ROWS["heating_or_cooling"]
    phone = A.PAGE_11_EXPENSE_ROWS["telephone"]

    # Marked as an expense the household has, with a frequency, but no amount —
    # there is no amount box on these rows at all.
    assert q15_pdf[heating[Q15_YES]] == "/Yes"
    assert q15_pdf[heating[Q15_OFTEN]] == "Monthly"
    assert q15_pdf[phone[Q15_YES]] == "/Yes"

    written = set(q15_pdf)
    assert "90" not in {q15_pdf.get(f) for f in written if f.endswith("PG 11")} - {None}


def test_q15_unanswered_rows_stay_blank(q15_pdf):
    for name in ("property_taxes_and_insurance", "homeless_shelter", "water_sewage_garbage"):
        row = A.PAGE_11_EXPENSE_ROWS[name]
        assert row[Q15_YES] not in q15_pdf, name
        assert row[Q15_NO] not in q15_pdf, name


def test_q15_who_pays_never_written(q15_pdf):
    """Household expenses are collected at household level; no payer is known."""
    for row in A.PAGE_11_EXPENSE_ROWS.values():
        assert row[Q15_WHO_PAYS] not in q15_pdf


def test_q15_liheap_and_outside_help_stay_blank(q15_pdf):
    for field in ("Check Box54 PG 11", "Check Box55 PG 11", "Text51 PG 11",
                  "Text52 PG 11", "Text53 PG 11"):
        assert field not in q15_pdf, field


def test_q15_does_not_touch_q14_or_q16(q15_pdf):
    # Q14 special-needs boxes are Check Box9-20 PG 11; Q16 is on page 12.
    for number in range(9, 23):
        assert f"Check Box{number} PG 11" not in q15_pdf
    assert not [name for name in q15_pdf if name.endswith("PG 12")]


# ── Q24 Household's Resources ──────────────────────────────────────────────


@pytest.fixture(scope="module")
def q24_pdf(tmp_path_factory):
    plan = {
        **_APPLICANT_CORE,
        "programs.calfresh": True,
        "resources.has_accounts": True,
        "resources.accounts.0.person_name": "Maria Delgado",
        "resources.accounts.0.kind": "checking",
        "resources.accounts.0.institution": "Community Bank",
        "resources.accounts.0.balance": 250,
        "resources.accounts.1.person_name": "Luis Delgado",
        "resources.accounts.1.kind": "savings",
        "resources.accounts.1.institution": "Credit Union",
        "resources.accounts.1.balance": 1200,
        "resources.accounts.2.person_name": "Maria Delgado",
        "resources.accounts.2.kind": "cash_on_hand",
        "resources.accounts.2.balance": 40,
    }
    return _generate(plan, tmp_path_factory.mktemp("saws-q24"))


def test_q24_gateway_yes(q24_pdf):
    yes_field, no_field = A.PAGE_14_RESOURCES_GATEWAY
    assert q24_pdf[yes_field] == "/Yes"
    assert no_field not in q24_pdf


def test_q24_rows_carry_name_type_worth_and_location(q24_pdf):
    row0 = A.PAGE_14_RESOURCE_ROWS[0]

    assert q24_pdf[row0[Q24_NAME]] == "Maria Delgado"
    assert q24_pdf[row0[Q24_TYPE]] == "Bank/Credit Union account (Checking)"
    assert q24_pdf[row0[Q24_WORTH]] == "250"
    assert q24_pdf[row0[Q24_WHERE]] == "Community Bank"


def test_q24_repeated_resources_use_distinct_rows(q24_pdf):
    row1 = A.PAGE_14_RESOURCE_ROWS[1]
    row2 = A.PAGE_14_RESOURCE_ROWS[2]

    assert q24_pdf[row1[Q24_NAME]] == "Luis Delgado"
    assert q24_pdf[row1[Q24_WORTH]] == "1200"
    assert q24_pdf[row2[Q24_TYPE]] == "Cash on hand"
    assert q24_pdf[row2[Q24_WORTH]] == "40"
    # The fourth printed row is untouched.
    for field in A.PAGE_14_RESOURCE_ROWS[3]:
        assert field not in q24_pdf


def test_q24_type_grid_ticked_for_mapped_categories(q24_pdf):
    assert q24_pdf[A.PAGE_14_RESOURCE_TYPE_BOXES["checking"]] == "/Yes"
    assert q24_pdf[A.PAGE_14_RESOURCE_TYPE_BOXES["savings"]] == "/Yes"
    assert q24_pdf[A.PAGE_14_RESOURCE_TYPE_BOXES["cash_on_hand"]] == "/Yes"


def test_q24_combined_stocks_or_bonds_category_is_not_guessed(tmp_path_factory):
    """The form separates Stocks and Bonds; our single category cannot pick one."""
    values = _generate(
        {
            **_APPLICANT_CORE,
            "resources.has_accounts": True,
            "resources.accounts.0.person_name": "Maria Delgado",
            "resources.accounts.0.kind": "stocks_or_bonds",
            "resources.accounts.0.balance": 500,
        },
        tmp_path_factory.mktemp("saws-q24-stocks"),
    )

    # The row still records the type in words and the value...
    assert values[A.PAGE_14_RESOURCE_ROWS[0][Q24_TYPE]] == "Stocks/Bonds"
    assert values[A.PAGE_14_RESOURCE_ROWS[0][Q24_WORTH]] == "500"
    # ...but neither the Stocks nor the Bonds box is ticked.
    assert "Check Box13 PG 14" not in values
    assert "Check Box14 PG 14" not in values


def test_q24_does_not_cross_write_into_q25(q24_pdf):
    """Q25 Personal Property occupies Check Box42-52 and Text53+ on page 14."""
    for number in list(range(42, 53)):
        assert f"Check Box{number} PG 14" not in q24_pdf

    for number in range(53, 83):
        assert f"Text{number} PG 14" not in q24_pdf


def test_q24_transferred_resources_block(tmp_path_factory):
    values = _generate(
        {
            **_APPLICANT_CORE,
            "resources.transferred_resources": True,
            "resources.transferred.0.description": "Sold a used trailer",
            "resources.transferred.0.estimated_value": 900,
        },
        tmp_path_factory.mktemp("saws-q24-transfer"),
    )

    yes_field, no_field = A.PAGE_14_TRANSFERRED_GATEWAY

    assert values[yes_field] == "/Yes"
    assert no_field not in values
    assert values[A.PAGE_14_TRANSFERRED_WHAT] == "Sold a used trailer"
    assert values[A.PAGE_14_TRANSFERRED_WORTH] == "900"


# ── Safety across all four sections ────────────────────────────────────────


@pytest.mark.parametrize(
    "fixture_name", ["q7_pdf", "q9_pdf", "q15_pdf", "q24_pdf"]
)
def test_new_sections_never_write_ssn_or_signature(fixture_name, request):
    values = request.getfixturevalue(fixture_name)
    written = set(values)

    assert not (SSN_FIELDS & written)
    assert not (SIGNATURE_FIELDS & written)


@pytest.mark.parametrize(
    "fixture_name", ["q7_pdf", "q9_pdf", "q15_pdf", "q24_pdf"]
)
def test_new_sections_only_write_reviewed_destinations(
    fixture_name, request, safe_fields
):
    assert set(request.getfixturevalue(fixture_name)) <= safe_fields


def test_unknown_gateways_write_nothing_in_the_new_sections(tmp_path_factory):
    values = _generate(
        {**_APPLICANT_CORE, "programs.calfresh": True},
        tmp_path_factory.mktemp("saws-new-unknown"),
    )

    for page in ("PG 8", "pg 10", "PG 11", "PG 14"):
        assert not [name for name in values if name.endswith(page)], page
