#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""End-to-end scenario matrix against the real SAWS 2 PLUS form.

The scenarios themselves are defined in TypeScript, where the application model
lives, and compiled to ``web/tests/fixtures/saws2-e2e-scenarios.json`` by
``tests/unit/saws2-e2e-scenarios.test.ts``. This module reads that file and puts
each plan through the real adapter and the real AcroForm, so the two runtimes
are tested against one set of inputs rather than two that can drift.

Every scenario asserts the same four safety invariants, because they are the
ones that make a generated document safe to sign:

  * every destination written is on the reviewed allowlist
  * no Social Security destination is written, ever
  * no signature destination is written, ever
  * generating twice produces the same document

The scenarios are chosen for the structural boundaries they cross — an empty
table, a table exactly full, a table with one record too many, a conditional
answered No — and the per-scenario tests below assert what each one exists to
prove.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from benefits_navigator.pdf_generator import (
    Saws2PlusFieldAdapter,
    _FORMS_DIR,
    generate_saws2_plus_pdf,
    inspect_pdf_form,
)
from benefits_navigator.saws2_plus_inventory import (
    SIGNATURE_FIELDS,
    SSN_FIELDS,
)

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "web"
    / "tests"
    / "fixtures"
    / "saws2-e2e-scenarios.json"
)

#: Regression floors for how much of the form each scenario fills.
#:
#: A floor rather than an exact count: adding a mapping should not break the
#: matrix, but losing one silently should. The pairs that share a number are
#: doing so on purpose — see the capacity tests at the bottom.
EXPECTED_WRITES = {
    "single_person": 20,
    "multi_person": 49,
    "max_household_rows": 86,
    "household_overflow": 86,
    "no_employment": 18,
    "one_job": 21,
    "earned_income_at_capacity": 30,
    "earned_income_overflow": 30,
    "appendix_d_capacity": 79,
    "appendix_d_overflow": 67,
    "employer_coverage": 32,
    "tribal_membership": 33,
    "appendix_e_overflow": 39,
    "q25_personal_property_overflow": 18,
    "all_conditionals_no": 33,
    "multiple_appendices": 77,
}


@pytest.fixture(scope="module")
def available_fields() -> set[str]:
    return {
        field["name"]
        for field in inspect_pdf_form(_FORMS_DIR / "CA-SAWS-2-PLUS.pdf")
        if field.get("name")
    }


@pytest.fixture(scope="module")
def safe_fields() -> frozenset[str]:
    return frozenset(Saws2PlusFieldAdapter.SAFE_FIELDS)


@pytest.fixture(scope="module")
def scenarios() -> dict[str, dict[str, Any]]:
    assert FIXTURE.exists(), (
        f"{FIXTURE} is missing. Generate it by running the web unit suite: "
        "npx vitest run tests/unit/saws2-e2e-scenarios.test.ts"
    )

    return {
        scenario["id"]: scenario
        for scenario in json.loads(FIXTURE.read_text(encoding="utf-8"))
    }


def _plan(scenario: dict[str, Any]) -> dict[str, Any]:
    return {entry["key"]: entry["value"] for entry in scenario["fieldPlan"]}


def _written(scenario: dict[str, Any], available: set[str]) -> dict[str, str]:
    return Saws2PlusFieldAdapter().map_values(_plan(scenario), available)


SCENARIO_IDS = sorted(EXPECTED_WRITES)


@pytest.fixture(scope="module")
def written_by_scenario(
    scenarios: dict[str, dict[str, Any]], available_fields: set[str]
) -> dict[str, dict[str, str]]:
    return {
        scenario_id: _written(scenarios[scenario_id], available_fields)
        for scenario_id in scenarios
    }


# ---------------------------------------------------------------------------
# Coverage of the matrix itself
# ---------------------------------------------------------------------------


def test_every_scenario_in_the_fixture_is_expected(scenarios):
    """A scenario added in TypeScript must be given a floor here."""
    assert set(scenarios) == set(EXPECTED_WRITES)


def test_the_matrix_covers_the_structural_boundaries(scenarios):
    """Named so a future edit cannot quietly drop a boundary case."""
    for required in (
        "single_person",
        "multi_person",
        "max_household_rows",
        "household_overflow",
        "no_employment",
        "one_job",
        "earned_income_at_capacity",
        "earned_income_overflow",
        "appendix_d_capacity",
        "appendix_d_overflow",
        "employer_coverage",
        "tribal_membership",
        "appendix_e_overflow",
        "q25_personal_property_overflow",
        "all_conditionals_no",
        "multiple_appendices",
    ):
        assert required in scenarios


# ---------------------------------------------------------------------------
# The four safety invariants, for every scenario
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_only_reviewed_destinations_are_written(
    scenario_id, written_by_scenario, safe_fields
):
    unreviewed = set(written_by_scenario[scenario_id]) - safe_fields

    assert not unreviewed, f"{scenario_id} wrote unreviewed destinations: {unreviewed}"


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_no_social_security_destination_is_ever_written(
    scenario_id, written_by_scenario
):
    assert not set(written_by_scenario[scenario_id]) & SSN_FIELDS


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_no_signature_destination_is_ever_written(scenario_id, written_by_scenario):
    assert not set(written_by_scenario[scenario_id]) & SIGNATURE_FIELDS


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_mapping_is_deterministic(scenario_id, scenarios, available_fields):
    first = _written(scenarios[scenario_id], available_fields)
    second = _written(scenarios[scenario_id], available_fields)

    assert first == second


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_no_known_answer_is_silently_dropped(
    scenario_id, written_by_scenario
):
    """Every scenario must reach the page, not just parse."""
    assert len(written_by_scenario[scenario_id]) >= EXPECTED_WRITES[scenario_id], (
        f"{scenario_id} now writes fewer fields than before — a mapping was lost"
    )


# ---------------------------------------------------------------------------
# Real generated PDFs
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def generated_pdf_values(scenarios, tmp_path_factory):
    """Generate a real PDF per scenario and read back its AcroForm values."""
    from pypdf import PdfReader

    values: dict[str, dict[str, str]] = {}

    for scenario_id, scenario in scenarios.items():
        args = {
            "state": "CA",
            "county": scenario["county"],
            "zip_code": "93701",
            "application_field_plan": scenario["fieldPlan"],
        }

        output_dir = tmp_path_factory.mktemp(f"saws-{scenario_id}")
        path = generate_saws2_plus_pdf(args, "", output_dir)
        fields = PdfReader(str(path)).get_fields() or {}

        values[scenario_id] = {
            name: str(spec.get("/V"))
            for name, spec in fields.items()
            if spec.get("/V") not in (None, "")
        }

    return values


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_generated_pdf_leaves_every_ssn_and_signature_blank(
    scenario_id, generated_pdf_values
):
    """The invariant that matters most, checked on the actual document."""
    written = set(generated_pdf_values[scenario_id])

    assert not written & SSN_FIELDS
    assert not written & SIGNATURE_FIELDS


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_generated_pdf_only_contains_reviewed_destinations(
    scenario_id, generated_pdf_values, safe_fields
):
    assert set(generated_pdf_values[scenario_id]) <= safe_fields


# ---------------------------------------------------------------------------
# What each scenario exists to prove
# ---------------------------------------------------------------------------


def test_capacity_and_overflow_write_the_same_document(written_by_scenario):
    """Overflow is reported, never written into a row that does not exist.

    Seven adults fill the same five printed rows five adults do, and six jobs
    fill the same four printed rows four jobs do. Identical output here is the
    evidence that the extra records were surfaced rather than crammed in.
    """
    assert written_by_scenario["max_household_rows"] == (
        written_by_scenario["household_overflow"]
    )
    assert written_by_scenario["earned_income_at_capacity"] == (
        written_by_scenario["earned_income_overflow"]
    )


def test_single_person_touches_no_appendix(written_by_scenario):
    for field in written_by_scenario["single_person"]:
        assert "appx" not in field.lower()
        assert "PG 18" not in field


def test_no_employment_writes_the_gateway_and_no_row(written_by_scenario):
    written = written_by_scenario["no_employment"]

    # Q8's No box is ticked; page 9's job rows stay blank.
    assert Saws2PlusFieldAdapter.PAGE_9_EARNED_GATEWAY[1] in written

    for row in Saws2PlusFieldAdapter.PAGE_9_EARNED_ROWS:
        for field in row:
            assert field not in written


def test_all_conditionals_no_ticks_no_boxes_and_writes_no_detail(
    written_by_scenario,
):
    written = written_by_scenario["all_conditionals_no"]

    assert len(written) > 20, "the No answers themselves must reach the page"

    for row in Saws2PlusFieldAdapter.PAGE_9_EARNED_ROWS:
        for field in row:
            assert field not in written

    for row in Saws2PlusFieldAdapter.PAGE_14_RESOURCE_ROWS:
        for field in row:
            assert field not in written

    for column in Saws2PlusFieldAdapter.APPENDIX_B_PEOPLE:
        for value in column.values():
            for field in value if isinstance(value, tuple) else (value,):
                assert field not in written


def test_appendix_d_capacity_fills_both_printed_pages(written_by_scenario):
    written = written_by_scenario["appendix_d_capacity"]

    assert written.get("Text1 appx c")     # Person1's name line
    assert written.get("Text1 appx d2")    # Person 2's name line

    # All three job blocks on each page carry an employer.
    for person, employers in (
        ("appx c", ("Text4 appx c", "Text22 appx c", "Text42 appx c")),
        ("appx d2", ("Text6 appx d2", "Text26 Appx D2", "Text46 Appx D2")),
    ):
        for field in employers:
            assert written.get(field), f"{person}: {field} is blank"


def test_appendix_d_overflow_writes_only_the_printed_blocks(written_by_scenario):
    """A third worker and a fourth job must not appear anywhere on the pages."""
    written = written_by_scenario["appendix_d_overflow"]

    assert written.get("Text1 appx c")
    assert written.get("Text1 appx d2")

    # Person1 has four jobs; only three printed blocks exist, and there is no
    # fourth block to leak into.
    employers = [
        written.get(field)
        for field in ("Text4 appx c", "Text22 appx c", "Text42 appx c")
    ]

    assert all(employers)
    assert len(set(employers)) == 3, "each printed job block holds its own job"


def test_multiple_appendices_do_not_overwrite_each_other(written_by_scenario):
    written = written_by_scenario["multiple_appendices"]

    # Appendix A (PG 18), B (APPX A), D (appx c) and E (appx E) all present.
    assert any(name.endswith("PG 18") for name in written)
    assert any(name.endswith("APPX A") for name in written)
    assert any(name.endswith("appx c") for name in written)
    assert any(name.endswith("appx E") for name in written)


def test_tribal_membership_follows_the_no_conditional(written_by_scenario):
    """Appendix B item 3's follow-up hangs off a No, and must still be written."""
    written = written_by_scenario["tribal_membership"]

    assert written.get("Check Box12 APPX A") == "/Yes"   # received IHS: No
    assert written.get("Check Box13 APPX A") == "/Yes"   # eligible: Yes
    assert "Check Box11 APPX A" not in written           # received IHS: Yes


def test_employer_coverage_reaches_appendix_a(written_by_scenario):
    written = written_by_scenario["employer_coverage"]

    assert any(name.endswith("PG 18") for name in written)

    # And the employee SSN boxes beside it stay blank.
    for field in ("Text2 PG 18", "Text3 PG 18", "Text4 PG 18"):
        assert field not in written


# ---------------------------------------------------------------------------
# Values must fit the boxes the form drew for them
# ---------------------------------------------------------------------------


def _declared_font_size(field: Any) -> float | None:
    parent = field.get("/Parent")
    parent_object = parent.get_object() if parent else None
    appearance = field.get("/DA") or (
        parent_object.get("/DA") if parent_object else None
    )

    if appearance is None:
        return None

    parts = str(appearance).split()

    try:
        return float(parts[parts.index("Tf") - 1])
    except (ValueError, IndexError):
        return None


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_no_written_value_overflows_its_printed_box(
    scenario_id, scenarios, tmp_path_factory
):
    """Nothing written may be wider than the box it is written into.

    The form declares a fixed point size per field and several of its boxes are
    too narrow for the value that belongs in them: the Q6 "DATE OF BIRTH"
    column is 47.9pt wide with "/Helv 10 Tf" set, which clipped "01/01/1990" to
    "01/01/199" — a birth year cut off on a document signed under penalty of
    perjury.
    """
    from pypdf import PdfReader

    from benefits_navigator.pdf_generator import (
        _FIELD_PADDING,
        _helvetica_width,
    )

    scenario = scenarios[scenario_id]
    output_dir = tmp_path_factory.mktemp(f"fit-{scenario_id}")
    path = generate_saws2_plus_pdf(
        {
            "state": "CA",
            "county": scenario["county"],
            "zip_code": "93701",
            "application_field_plan": scenario["fieldPlan"],
        },
        "",
        output_dir,
    )

    for page in PdfReader(str(path)).pages:
        for annotation in page.get("/Annots") or []:
            field = annotation.get_object()

            value = str(field.get("/V") or "")
            if not value:
                continue

            # Checkbox states are glyphs, not text, and multiline fields wrap.
            if str(field.get("/FT")) != "/Tx":
                continue

            flags = int(field.get("/Ff") or 0)
            if flags & 4096:
                continue

            size = _declared_font_size(field)
            if size is None or size <= 0:
                continue

            rectangle = [float(bound) for bound in field["/Rect"]]
            usable = abs(rectangle[2] - rectangle[0]) - _FIELD_PADDING * 2

            assert _helvetica_width(value, size) <= usable + 0.01, (
                f"{scenario_id}: {field.get('/T')} = {value!r} is wider than "
                f"its {usable:.1f}pt box at {size}pt"
            )


def test_shrinking_leaves_values_that_already_fit_alone(scenarios, tmp_path_factory):
    """Only the overflowing field is touched; its neighbours keep their size.

    Auto-sizing the whole form (``/Helv 0 Tf``) would also stop the clipping,
    but viewers that honour it grow short values to fill the box height — a
    one-letter "F" in the GENDER column rendering three times the size of the
    name beside it.
    """
    from pypdf import PdfReader

    scenario = scenarios["multi_person"]
    output_dir = tmp_path_factory.mktemp("fit-untouched")
    path = generate_saws2_plus_pdf(
        {
            "state": "CA",
            "county": scenario["county"],
            "zip_code": "93701",
            "application_field_plan": scenario["fieldPlan"],
        },
        "",
        output_dir,
    )

    sizes: dict[str, float | None] = {}

    for page in PdfReader(str(path)).pages:
        for annotation in page.get("/Annots") or []:
            field = annotation.get_object()
            name = str(field.get("/T"))

            if name in ("Text5 PG 3", "Text7 PG 3"):
                sizes[name] = _declared_font_size(field)

    # Text5 is the NAME column, wide enough for its value at the declared size.
    assert sizes["Text5 PG 3"] == 10
    # Text7 is the narrow DATE OF BIRTH column and had to come down.
    assert sizes["Text7 PG 3"] is not None
    assert sizes["Text7 PG 3"] < 10
