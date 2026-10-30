#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""H1010's Medicaid / CHIP addendum on HHSC's own pages, in both editions.

The addendum ("H1010-M", PDF pages 26 to 34) is filled only for a household
applying for Medicaid or CHIP. Everything else about the official H1010 is the
regression baseline these tests protect:

* a household that is not applying for health coverage gets exactly the form
  and review sheet it got before — no addendum box filled, none listed;
* a household that is, gets every addendum answer in the box that prints its
  question, on the edition in its language, over no printed text;
* and the mapping is reachable: every addendum box has a question in the
  Texas intake behind it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from benefits_navigator.formmap import (
    AllOf,
    Condition,
    canonical_values_from_field_plan,
    definition_for_form,
    generate_form,
    resolve_mappings,
)
from benefits_navigator.formmap.forms.h1010_official import (
    ADDENDUM_KEYS,
    APPLYING_FOR_HEALTH,
)
from benefits_navigator.formmap.forms.tx_documents import TX_H1010_EN, TX_H1010_ES
from benefits_navigator.formmap.measurements import load_measurements

_FIXTURES = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures"

#: The addendum's pages, as the PDF numbers them.
ADDENDUM_PAGES = range(26, 35)


def _scenario(scenario_id: str) -> dict[str, Any]:
    scenarios = json.loads((_FIXTURES / "tx-h1010-scenarios.json").read_text())
    plan = next(item for item in scenarios if item["id"] == scenario_id)["fieldPlan"]

    return canonical_values_from_field_plan(plan)


def _people() -> dict[str, Any]:
    names = [
        ("María", "Elena", "Rodríguez"),
        ("Diego", "", "Rodríguez"),
        ("Sofía", "Ana", "Rodríguez"),
        ("Mateo", "", "Rodríguez"),
        ("Lucía", "", "Rodríguez"),
    ]
    values: dict[str, Any] = {}

    for slot, (first, middle, last) in enumerate(names):
        prefix = f"health.tax_household.{slot}"
        values.update(
            {
                f"{prefix}.present": True,
                f"{prefix}.first_name": first,
                f"{prefix}.middle_name": middle,
                f"{prefix}.last_name": last,
                f"{prefix}.plans_to_file": slot < 2,
                f"{prefix}.claims_dependents": slot == 0,
                f"{prefix}.claimed_as_dependent": slot >= 2,
            }
        )

        if slot < 2:
            values[f"{prefix}.files_jointly"] = True
            values[f"{prefix}.fears_harm_from_disclosure"] = False
            values[f"{prefix}.spouse_name"] = (
                "Diego Rodríguez" if slot == 0 else "María Elena Rodríguez"
            )

        if slot == 0:
            values[f"{prefix}.dependent_names"] = "Sofía, Mateo, Lucía Rodríguez"

        if slot >= 2:
            values[f"{prefix}.tax_filer_name"] = "María Elena Rodríguez"
            values[f"{prefix}.relationship_to_tax_filer"] = "Mother"

        if slot > 0:
            values[f"{prefix}.lives_with_applicant"] = True

    return values


#: A household applying for Medicaid and CHIP that answered every addendum
#: question, with values sized to fit the shortest printed spaces.
MEDICAID_HOUSEHOLD: dict[str, Any] = {
    APPLYING_FOR_HEALTH: True,
    "income.yearly_totals_apply": True,
    "programs.tx_medicaid": True,
    "programs.tx_chip": True,
    **_people(),
    "health.tax_deductions.any": True,
    "health.tax_deductions.alimony": True,
    "health.tax_deductions.alimony_amount": 450,
    "health.tax_deductions.alimony_frequency": "Monthly",
    "health.tax_deductions.alimony_agreement_before_2019": True,
    "health.tax_deductions.student_loan_interest": True,
    "health.tax_deductions.student_loan_interest_amount": 85,
    "health.tax_deductions.student_loan_interest_frequency": "Monthly",
    "health.tax_deductions.other": True,
    "health.tax_deductions.other_amount": 300,
    "health.tax_deductions.other_frequency": "Yearly",
    "health.tax_deductions.other_types": "Tuition",
    "health.child_travels_with_migrant_worker": True,
    "health.migrant_child_names": "Mateo Rodríguez",
    "health.child_in_special_health_care_needs": True,
    "health.special_health_care_needs_who": "Lucía Rodríguez",
    "health.american_indian_or_alaska_native": True,
    "household.foster_care_at_18_or_older": True,
    "household.foster_care_at_18_or_older_who": "Diego Rodríguez",
    "household.foster_care_at_18_or_older_state": "Oklahoma",
    "household.absent_parents": True,
    "health.htw_confidential_contact": True,
    "health.htw_confidential.street": "PO Box 2201",
    "health.htw_confidential.city": "Austin",
    "health.htw_confidential.state": "TX",
    "health.htw_confidential.zip_code": "78768",
    "health.htw_confidential.phone": "5125550199",
    "health.htw_declines_screening": True,
    "health.htw_screening_opt_out.0.present": True,
    "health.htw_screening_opt_out.0.name": "Sofía Rodríguez",
    "health.htw_screening_opt_out.0.declines": True,
    "income.total_this_year": 31200,
    "income.total_next_year": 36000,
    "health.has_employer_coverage": True,
    "health.lost_job_coverage": True,
    "health.lost_job_coverage_who": "Diego Rodríguez",
    "health.lost_job_coverage_end_date": "2026-09-30",
    "health.lost_job_coverage_reason": "other",
    "health.lost_job_coverage_other_reason": "Hours cut",
    "household.incarcerated": False,
    "health.renewal_years": "five",
    "appendices.employer_coverage.0.present": True,
    "appendices.employer_coverage.0.employee_name": "Diego Rodríguez",
    "appendices.employer_coverage.0.employer_name": "H-E-B Grocery",
    "appendices.employer_coverage.0.employer_ein": "74-1234567",
    "appendices.employer_coverage.0.employer_address": "646 S Flores St",
    "appendices.employer_coverage.0.employer_phone": "2109388000",
    "appendices.employer_coverage.0.employer_city": "San Antonio",
    "appendices.employer_coverage.0.employer_state": "TX",
    "appendices.employer_coverage.0.employer_zip_code": "78204",
    "appendices.employer_coverage.0.contact_name": "Benefits Office",
    "appendices.employer_coverage.0.contact_phone": "2109388111",
    "appendices.employer_coverage.0.employer_email": "benefits@example.com",
    "appendices.employer_coverage.0.eligible_now_or_soon": True,
    "appendices.employer_coverage.0.waiting_period_enrollment_date": "2026-12-01",
    "appendices.employer_coverage.0.other_eligible.0": "María Rodríguez",
    "appendices.employer_coverage.0.meets_minimum_value_standard": True,
    "appendices.employer_coverage.0.lowest_cost_premium": 120,
    "appendices.employer_coverage.0.lowest_cost_premium_frequency": "monthly",
    "appendices.employer_coverage.0.plan_change": (
        "will_start_offering_or_change_premium"
    ),
    "appendices.employer_coverage.0.changed_premium": 135,
    "appendices.employer_coverage.0.changed_premium_frequency": "bi_weekly",
    "appendices.employer_coverage.0.plan_change_date": "2027-01-01",
    "appendices.tribal.0.present": True,
    "appendices.tribal.0.first_name": "Diego",
    "appendices.tribal.0.last_name": "Rodríguez",
    "appendices.tribal.0.member_of_tribe": True,
    "appendices.tribal.0.tribe_name": "Kickapoo",
    "appendices.tribal.0.received_indian_health_service": True,
    "appendices.tribal.0.has_excludable_tribal_income": True,
    "appendices.tribal.0.tribal_income_amount": 1200,
    "appendices.tribal.0.tribal_income_frequency": "Yearly",
    "appendices.tribal.1.present": True,
    "appendices.tribal.1.first_name": "Mateo",
    "appendices.tribal.1.middle_name": "José",
    "appendices.tribal.1.last_name": "Rodríguez",
    "appendices.tribal.1.member_of_tribe": False,
    "appendices.tribal.1.received_indian_health_service": False,
    "appendices.tribal.1.eligible_for_indian_health_service": True,
    "household.authorized_representative": True,
    "household.authorized_representative.0.present": True,
    "household.authorized_representative.0.name": "Rosa Delgado",
    "household.authorized_representative.0.address.apartment": "Suite 400",
    "household.authorized_representative.0.organization_id": "FC-2231",
    "household.application_assister": True,
    "household.application_assister.start_date": "2026-10-28",
    "household.application_assister.name": "Rosa M. Delgado",
    "household.application_assister.organization": "Foundation Communities",
    "household.application_assister.organization_id": "CAC-55821",
}


@pytest.fixture(scope="module")
def generated() -> dict[str, Any]:
    return {
        locale: generate_form("TX_H1010", MEDICAID_HOUSEHOLD, locale=locale)
        for locale in ("en", "es")
    }


# ---------------------------------------------------------------------------
# Not applying for health coverage: nothing changes
# ---------------------------------------------------------------------------


class TestAHouseholdNotApplyingForHealthCoverage:
    @pytest.fixture(scope="class")
    def snap_only(self) -> dict[str, Any]:
        return {
            locale: generate_form(
                "TX_H1010", _scenario("austin_single_adult"), locale=locale
            )
            for locale in ("en", "es")
        }

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_no_addendum_box_is_filled(self, snap_only, locale):
        placed = {resolved.mapping.key for resolved in snap_only[locale].resolution.fields}

        assert placed.isdisjoint(ADDENDUM_KEYS)

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_nothing_is_drawn_on_the_medicaid_pages(self, snap_only, locale):
        drawn = {draw.page for draw in snap_only[locale].render_plan.draws}

        assert drawn.isdisjoint(ADDENDUM_PAGES)

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_addendum_is_not_listed_on_the_review_sheet(self, snap_only, locale):
        """Nine pages a food-benefits household never fills in stay quiet."""
        review = snap_only[locale].review_text

        assert "Medicaid Addendum" not in review
        assert "Appendix A" not in review
        assert "Appendix B" not in review

    def test_every_addendum_box_is_recorded_as_not_applicable(self, snap_only):
        resolution = snap_only["en"].resolution
        excluded = {item.key for item in resolution.not_applicable if item.quiet}

        # The representative's two new Appendix C boxes are gated on there
        # being a representative, not on health coverage; this household has
        # none, so they are excluded quietly too.
        assert ADDENDUM_KEYS <= excluded


# ---------------------------------------------------------------------------
# Applying for Medicaid or CHIP: every answer, in its own box
# ---------------------------------------------------------------------------


class TestAHouseholdApplyingForMedicaid:
    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_every_answer_is_placed_and_fits(self, generated, locale):
        form = generated[locale]

        assert form.render_plan.unplaced == []
        assert form.render_plan.unfitted == []

        placed = {resolved.mapping.key for resolved in form.resolution.fields}
        answered = {
            key
            for key, value in MEDICAID_HOUSEHOLD.items()
            if key in ADDENDUM_KEYS and value not in (None, "", False)
            # A checkbox prints only an explicit True; False is not a box.
        } | {
            key
            for key, value in MEDICAID_HOUSEHOLD.items()
            if key in ADDENDUM_KEYS
            and value is False
            and definition_for_form("TX_H1010").mapping_for(key).kind.name
            == "CHOICE"
        }

        assert answered - placed == set()

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_addendum_is_drawn_on_the_addendum_pages_only(
        self, generated, locale
    ):
        definition = definition_for_form("TX_H1010")
        measured = load_measurements(TX_H1010_EN if locale == "en" else TX_H1010_ES)

        for key in ADDENDUM_KEYS:
            mapping = definition.mapping_for(key)

            for box in measured[mapping.key]:
                assert box.page in ADDENDUM_PAGES, (key, box.page)

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_no_value_is_drawn_over_printed_text(self, generated, locale):
        """The same word-level check the main form's pages are held to."""
        from benefits_navigator.formmap.measure import DocumentText
        from benefits_navigator.formmap.provenance import load_document

        text = DocumentText.of(
            load_document(TX_H1010_EN if locale == "en" else TX_H1010_ES)
        )
        allowed = {"$", "(", ")", "-", "/"}
        collisions: list[str] = []

        for draw in generated[locale].render_plan.draws:
            if draw.page not in ADDENDUM_PAGES:
                continue

            for word in text.words:
                if word.page != draw.page:
                    continue

                stripped = word.text.strip()

                if stripped in allowed or set(stripped) <= set("_ ."):
                    continue

                width = len(draw.text) * draw.size * 0.55
                overlap_x = min(draw.x + width, word.right) - max(draw.x, word.x)
                overlap_y = min(draw.y + draw.size, word.top) - max(draw.y, word.y)

                if overlap_x > 3.0 and overlap_y > 3.0:
                    collisions.append(f"{draw.text!r} on page {draw.page} over {stripped!r}")

        assert collisions == [], collisions[:8]

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_each_person_lands_in_their_own_tax_block(self, generated, locale):
        """Person 1 on page 26; Persons 2-3 on 27; Persons 4-5 on 28, in order."""
        draws = generated[locale].render_plan.draws

        def where(name: str) -> tuple[int, float]:
            found = [d for d in draws if d.text == name and d.page in (26, 27, 28)]
            assert len(found) == 1, (name, found)
            return found[0].page, found[0].y

        assert where("María")[0] == 26
        diego, sofia = where("Diego"), where("Sofía")
        mateo, lucia = where("Mateo"), where("Lucía")

        assert diego[0] == sofia[0] == 27 and diego[1] > sofia[1]
        assert mateo[0] == lucia[0] == 28 and mateo[1] > lucia[1]

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_appendix_b_columns_are_not_swapped(self, generated, locale):
        """Two near-level rows of printed words; the left column is Person 1."""
        definition = definition_for_form("TX_H1010")
        measured = load_measurements(TX_H1010_EN if locale == "en" else TX_H1010_ES)

        for field in (
            "first_name",
            "middle_name",
            "last_name",
            "member_of_tribe",
            "tribe_name",
            "received_indian_health_service",
            "eligible_for_indian_health_service",
            "tribal_income_amount",
            "tribal_income_frequency",
        ):
            left = measured[definition.mapping_for(f"appendices.tribal.0.{field}").key]
            right = measured[definition.mapping_for(f"appendices.tribal.1.{field}").key]

            assert max(box.x for box in left) < 390.0 < min(box.x for box in right), field

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_spanish_applicant_gets_the_spanish_addendum(self, generated, locale):
        form = generated[locale]

        assert form.document_language == locale

    def test_a_follow_up_behind_a_no_is_not_applicable_and_quiet(self):
        values = {
            **MEDICAID_HOUSEHOLD,
            "health.lost_job_coverage": False,
            "health.lost_job_coverage_who": "stale",
        }
        report = resolve_mappings(definition_for_form("TX_H1010"), values)
        placed = {resolved.mapping.key for resolved in report.fields}
        excluded = {item.key: item for item in report.not_applicable}

        assert "health.lost_job_coverage" in placed
        assert "health.lost_job_coverage_who" not in placed
        assert excluded["health.lost_job_coverage_who"].quiet

    def test_an_unanswered_question_lists_itself_not_its_follow_ups(self):
        """"Will you claim dependents?" outstanding — not the names behind it."""
        values = dict(MEDICAID_HOUSEHOLD)
        values.pop("health.tax_household.0.claims_dependents")
        form = generate_form("TX_H1010", values)

        outstanding = form.review_text.split("Still yours to fill in:")[1]

        assert "c. Will you claim any dependents on your tax return? (Person 1)" in outstanding
        assert "If yes, list name(s) of dependents (Person 1)" not in outstanding

    def test_a_long_spanish_name_leaves_its_whole_line_to_the_applicant(self):
        """Question 7's Spanish name lines are short. A mark beside a blank
        line would not say whose opt-out it is, so neither is printed and the
        review sheet names both, with the name to write."""
        name = "María Elena Rodríguez Villanueva"
        values = {**MEDICAID_HOUSEHOLD, "health.htw_screening_opt_out.0.name": name}
        form = generate_form("TX_H1010", values, locale="es")
        plan = form.render_plan
        declines = "health.htw_screening_opt_out.0.declines"

        assert plan.unfitted == ["health.htw_screening_opt_out.0.name"]
        assert plan.withheld == {declines: "health.htw_screening_opt_out.0.name"}
        assert not _drawn_in(form, declines)

        sheet = form.review_text
        filled, rest = sheet.split("Se dejó en blanco para que quede claro")

        assert "HTW (línea 1)" not in filled
        assert f"7. Nombre (no quiere la prueba de HTW, línea 1): {name}" in rest
        assert "7. No quiero que me hagan la prueba para elegibilidad de HTW (línea 1)" in rest
        # Named once, with what to do, not also as "see attached".
        assert "Demasiado largo para el espacio impreso" not in sheet

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_name_that_fits_is_printed_with_its_mark(self, locale):
        form = generate_form("TX_H1010", MEDICAID_HOUSEHOLD, locale=locale)

        assert form.render_plan.withheld == {}
        assert _drawn_in(form, "health.htw_screening_opt_out.0.declines")

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_mark_with_no_name_is_not_printed(self, locale):
        values = dict(MEDICAID_HOUSEHOLD)
        values.pop("health.htw_screening_opt_out.0.name")
        form = generate_form("TX_H1010", values, locale=locale)
        declines = "health.htw_screening_opt_out.0.declines"

        assert form.render_plan.withheld == {
            declines: "health.htw_screening_opt_out.0.name"
        }
        assert not _drawn_in(form, declines)

    def test_only_the_line_that_does_not_fit_is_withheld(self):
        values = {
            **MEDICAID_HOUSEHOLD,
            "health.htw_screening_opt_out.0.name": "María Elena Rodríguez Villanueva",
            "health.htw_screening_opt_out.1.present": True,
            "health.htw_screening_opt_out.1.name": "Ana Ruiz",
            "health.htw_screening_opt_out.1.declines": True,
        }
        form = generate_form("TX_H1010", values, locale="es")

        assert list(form.render_plan.withheld) == [
            "health.htw_screening_opt_out.0.declines"
        ]
        assert _drawn_in(form, "health.htw_screening_opt_out.1.declines")


def _drawn_in(form, key: str) -> bool:
    """Whether anything was drawn inside this key's printed box."""
    mapping = next(f.mapping for f in form.resolution.fields if f.key == key)
    box = mapping.target.box

    return any(
        drawn.page == box.page
        and box.x <= drawn.x <= box.x + box.width
        and box.y - 2 <= drawn.y <= box.y + box.height
        for drawn in form.render_plan.draws
    )


# ---------------------------------------------------------------------------
# What the review sheet says about foster care
# ---------------------------------------------------------------------------


class TestTheFosterCareNote:
    """"Answer the narrower question yourself" is only true until we have."""

    NOTE = "Someone in your home was in foster care"

    def test_a_food_benefits_household_keeps_the_note(self):
        values = {**_scenario("austin_single_adult"), "household.ever_in_foster_care": True}

        assert self.NOTE in generate_form("TX_H1010", values).review_text

    def test_a_medicaid_household_with_the_narrower_answer_does_not(self):
        values = {
            **MEDICAID_HOUSEHOLD,
            "household.ever_in_foster_care": True,
        }

        assert self.NOTE not in generate_form("TX_H1010", values).review_text

    def test_a_medicaid_household_without_it_keeps_the_note(self):
        values = {**MEDICAID_HOUSEHOLD, "household.ever_in_foster_care": True}
        values.pop("household.foster_care_at_18_or_older")
        values.pop("household.foster_care_at_18_or_older_who")
        values.pop("household.foster_care_at_18_or_older_state")

        assert self.NOTE in generate_form("TX_H1010", values).review_text


# ---------------------------------------------------------------------------
# Reachability: every addendum box has a question behind it
# ---------------------------------------------------------------------------


def test_every_addendum_box_can_be_reached_from_the_texas_intake():
    """The addendum's half of the join `tx-intake-coverage.test.ts` commits.

    Rows are compared at the row the intake probe fills: every printed row of
    a block draws the same fields, so a reachable row is a reachable block.
    """
    reachable = set(json.loads((_FIXTURES / "tx-intake-canonical-keys.json").read_text()))

    def shape(key: str) -> str:
        return re.sub(r"\.\d+(?=\.|$)", ".N", key)

    reachable_shapes = {shape(key) for key in reachable}
    unreachable = sorted(
        key for key in ADDENDUM_KEYS if shape(key) not in reachable_shapes
    )

    assert unreachable == []


# ---------------------------------------------------------------------------
# The two condition primitives the addendum introduced
# ---------------------------------------------------------------------------


class TestConditionPrimitives:
    def test_all_of_reports_the_first_condition_that_fails(self):
        first = Condition(key="a", equals=True, quiet=True)
        second = Condition(key="b", equals=True)
        both = AllOf((first, second))

        assert both.applies({"a": True, "b": True})
        assert both.first_failure({"a": False, "b": False}) is first
        assert both.first_failure({"a": True, "b": False}) is second
        assert both.keys() == ("a", "b")

    def test_a_condition_is_loud_unless_it_says_otherwise(self):
        assert Condition(key="a").quiet is False


# ---------------------------------------------------------------------------
# Rows a printed addendum table cannot hold
# ---------------------------------------------------------------------------


class TestRowsBeyondThePrintedTables:
    """Each addendum list overflows with the form's own instruction."""

    @pytest.mark.parametrize(
        ("prefix", "rows", "english", "spanish"),
        [
            (
                "appendices.employer_coverage", 1,
                "copy of Appendix A for each job",
                "copia del Apéndice A para cada trabajo",
            ),
            (
                "appendices.tribal", 2,
                "Appendix B: the form has room for 2 people",
                "Apéndice B: el formulario tiene espacio para 2 personas",
            ),
            (
                "health.tax_household", 5,
                "Section 1: the form has room for 5 people",
                "Sección 1: el formulario tiene espacio para 5 personas",
            ),
            (
                "health.htw_screening_opt_out", 3,
                "question 7: the form has 3 name lines",
                "pregunta 7: el formulario tiene 3 líneas",
            ),
        ],
    )
    def test_the_review_sheet_says_what_to_do_with_the_rest(
        self, prefix, rows, english, spanish
    ):
        values = {
            **MEDICAID_HOUSEHOLD,
            **{f"{prefix}.{row}.present": True for row in range(rows + 2)},
        }

        for locale, words in (("en", english), ("es", spanish)):
            form = generate_form("TX_H1010", values, locale=locale)

            assert form.resolution.overflow[prefix] == 2
            assert words in form.review_text

    def test_a_household_within_the_tables_has_no_overflow(self):
        form = generate_form("TX_H1010", MEDICAID_HOUSEHOLD)

        assert form.resolution.overflow == {}

    def test_both_languages_carry_every_overflow_note(self):
        from benefits_navigator.formmap.forms.h1010_official import OFFICIAL_GROUPS
        from benefits_navigator.formmap.review_words import ENGLISH, SPANISH

        notes = {group.overflow_note for group in OFFICIAL_GROUPS} - {""}

        assert notes <= set(ENGLISH.overflow_notes)
        assert set(ENGLISH.overflow_notes) == set(SPANISH.overflow_notes)


# ---------------------------------------------------------------------------
# Appendix C, for every household that names a representative
# ---------------------------------------------------------------------------


class TestAppendixCForAFoodBenefitsHousehold:
    """Section V sends any household with a representative to Appendix C."""

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_apartment_and_organization_id_are_printed(self, locale):
        values = {
            **_scenario("austin_single_adult"),
            "household.authorized_representative": True,
            "household.authorized_representative.0.present": True,
            "household.authorized_representative.0.name": "Rosa Delgado",
            "household.authorized_representative.0.address.apartment": "Suite 400",
            "household.authorized_representative.0.organization_id": "FC-2231",
        }
        form = generate_form("TX_H1010", values, locale=locale)
        drawn = form.render_plan.text_on_page(34)

        assert "Suite 400" in drawn
        assert "FC-2231" in drawn
        # Still nothing from the Medicaid part of the addendum.
        assert not ({f.key for f in form.resolution.fields} & (ADDENDUM_KEYS - {
            "household.authorized_representative.0.address.apartment",
            "household.authorized_representative.0.organization_id",
        }))
