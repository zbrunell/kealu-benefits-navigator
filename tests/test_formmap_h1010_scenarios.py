#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Texas H1010, generated from what a real Benefits Navigator intake emits.

The plans here are not written in Python. They come from
``web/tests/fixtures/tx-h1010-scenarios.json``, which the TypeScript suite
produces by running the production ``buildApplicationFieldPlan`` over four
Austin households (see ``web/tests/fixtures/tx-h1010-scenarios.ts``). That is
the whole point of the file: a hand-written dictionary of canonical keys proves
only that the mapping works on the keys its author remembered, and a key the
mapper does not actually emit is indistinguishable from one it does.

So if the mapper stops emitting a key H1010 draws — or starts emitting it under
a different name — these tests fail, in Python, on the Texas form. That is a
guarantee the two runtimes can only give each other.

── What is asserted here, and what is not ─────────────────────────────────
Mapping semantics on synthetic values are in ``test_formmap_mapping.py`` and
``test_formmap_primitives.py``, where they are cheap. What only a rendered
document can show is here:

* every value that resolved is actually drawn, inside its own declared box;
* nothing drawn collides with anything else on the page — the defect class that
  put a question mark through a Yes box and printed two table headers on top of
  each other;
* a conditional block is blank when it should be and filled when it should not;
* a table row carries its own person's answers and nobody else's;
* people the printed table cannot hold are reported rather than dropped.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import pytest

from benefits_navigator.formmap import (
    FieldKind,
    definition_for_form,
    generate_form,
    resolve_mappings,
)
from benefits_navigator.formmap.forms.h1010 import BILLS, JOBS, PEOPLE
from benefits_navigator.formmap.render import DrawnText
from benefits_navigator.formmap.textfit import helvetica_width

pypdf = pytest.importorskip("pypdf")

_FIXTURE = (
    Path(__file__).resolve().parent.parent
    / "web"
    / "tests"
    / "fixtures"
    / "tx-h1010-scenarios.json"
)


def _scenarios() -> dict[str, dict[str, Any]]:
    if not _FIXTURE.exists():  # pragma: no cover - a checked-in fixture
        pytest.skip(
            f"{_FIXTURE} is missing; run the web suite to emit it "
            "(UPDATE_SCENARIOS=1 npx vitest run tests/unit/tx-h1010-scenarios)"
        )

    return {item["id"]: item for item in json.loads(_FIXTURE.read_text())}


SCENARIOS = _scenarios()

SCENARIO_IDS = tuple(SCENARIOS)


def canonical_values(scenario_id: str) -> dict[str, Any]:
    """The scenario's field plan, normalized exactly as production does it."""
    from benefits_navigator.formmap import canonical_values_from_field_plan

    return canonical_values_from_field_plan(SCENARIOS[scenario_id]["fieldPlan"])


@pytest.fixture(scope="module")
def h1010():
    return definition_for_form("TX_H1010")


@pytest.fixture(scope="module")
def generated() -> dict[str, Any]:
    return {
        scenario_id: generate_form("TX_H1010", canonical_values(scenario_id))
        for scenario_id in SCENARIO_IDS
    }


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

#: The mark glyph, and the empty box printed under it.
#:
#: These two are *meant* to occupy the same place — that is what ticking a box
#: is — so the collision check has to know about them by name.
_MARK = "X"
_EMPTY_BOX = "[  ]"


def _rect(drawn: DrawnText) -> tuple[float, float, float, float]:
    """A drawn string's bounding box: left, bottom, right, top."""
    return (
        drawn.x,
        drawn.y,
        drawn.x + helvetica_width(drawn.text, drawn.size),
        # Cap height plus a descender's worth, which is what a reader sees.
        drawn.y + drawn.size * 0.75,
    )


def _overlaps(a: DrawnText, b: DrawnText, *, slack: float = 0.6) -> bool:
    if a.page != b.page:
        return False

    a_left, a_bottom, a_right, a_top = _rect(a)
    b_left, b_bottom, b_right, b_top = _rect(b)

    return (
        a_left < b_right - slack
        and b_left < a_right - slack
        and a_bottom < b_top - slack
        and b_bottom < a_top - slack
    )


def _is_mark(drawn: DrawnText) -> bool:
    return drawn.text in (_MARK, _EMPTY_BOX)


def _is_rule(drawn: DrawnText) -> bool:
    return bool(drawn.text) and set(drawn.text) == {"_"}


# ---------------------------------------------------------------------------
# Every scenario
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
class TestEveryScenario:
    def test_the_fixture_says_why_it_exists(self, scenario_id):
        assert len(SCENARIOS[scenario_id]["purpose"]) > 20

    def test_produces_a_pdf_a_reader_can_open(self, scenario_id, generated):
        document = generated[scenario_id]

        assert document.pdf_bytes.startswith(b"%PDF-")

        reader = pypdf.PdfReader(io.BytesIO(document.pdf_bytes))

        assert len(reader.pages) == definition_for_form("TX_H1010").page_count

    def test_is_never_presented_as_the_official_form(self, scenario_id, generated):
        document = generated[scenario_id]

        assert document.is_official_document is False
        assert "THIS IS NOT THE OFFICIAL FORM." in document.review_text

    def test_fills_something(self, scenario_id, generated):
        """A scenario that renders an empty document proves nothing."""
        assert len(generated[scenario_id].resolution.fields) > 20

    def test_every_resolved_value_is_actually_drawn_in_its_own_box(
        self, scenario_id, generated, h1010
    ):
        """The join between "mapped correctly" and "printed in the right place".

        Mapping tests prove a value reached the right *target*. This proves it
        reached that target's coordinates — every textual value has a drawn
        string of exactly its text, at a point inside the box the definition
        declared for it.
        """
        document = generated[scenario_id]
        draws = document.render_plan.draws

        for resolved in document.resolution.fields:
            if resolved.kind not in (
                FieldKind.TEXT,
                FieldKind.DATE,
                FieldKind.MULTILINE,
            ):
                continue

            if resolved.key in document.render_plan.unfitted:
                # Deliberately not drawn. Asserted separately.
                continue

            box = resolved.box()

            assert box is not None, resolved.key

            placed = [
                drawn
                for drawn in draws
                if drawn.page == box.page
                and drawn.text in resolved.rendered
                and box.x - 0.5 <= drawn.x
                and drawn.x <= box.right + 0.5
                and box.y - 1.5 <= drawn.y <= box.top
            ]

            assert placed, (
                f"{scenario_id}: {resolved.key} = {resolved.rendered!r} was "
                f"resolved but nothing was drawn inside its box {box}"
            )

    def test_no_two_values_are_printed_on_top_of_each_other(
        self, scenario_id, generated
    ):
        values = [
            drawn
            for drawn in generated[scenario_id].render_plan.draws
            if not _is_mark(drawn)
        ]

        for index, first in enumerate(values):
            for second in values[index + 1 :]:
                assert not _overlaps(first, second), (
                    f"{scenario_id}: {first.text!r} and {second.text!r} "
                    f"overlap on page {first.page}"
                )

    def test_no_value_is_printed_over_a_printed_label(
        self, scenario_id, generated
    ):
        """The defect this catches, in the form it was found in.

        A value drawn at an absolute coordinate has no widget border to clip
        it, so an overlong one runs across the label beside it and both become
        unreadable. The renderer shrinks and reports rather than allowing that,
        and this is the assertion that says so about the whole document.
        """
        from benefits_navigator.formmap.forms.h1010 import H1010_STATIC_TEXT

        labels = [
            item.as_drawn()
            for item in H1010_STATIC_TEXT
            if not _is_mark(item.as_drawn()) and not _is_rule(item.as_drawn())
        ]
        values = [
            drawn
            for drawn in generated[scenario_id].render_plan.draws
            if not _is_mark(drawn)
        ]

        for value in values:
            for label in labels:
                assert not _overlaps(value, label), (
                    f"{scenario_id}: value {value.text!r} overlaps printed "
                    f"label {label.text!r} on page {value.page}"
                )

    def test_nothing_is_drawn_outside_the_page(self, scenario_id, generated, h1010):
        for drawn in generated[scenario_id].render_plan.draws:
            left, bottom, right, top = _rect(drawn)

            assert left >= 0 and bottom >= 0, drawn
            assert right <= h1010.page_width + 0.5, drawn
            assert top <= h1010.page_height + 0.5, drawn
            assert 1 <= drawn.page <= h1010.page_count, drawn

    def test_no_value_is_rendered_below_the_legible_floor(
        self, scenario_id, generated
    ):
        from benefits_navigator.formmap.textfit import MIN_FONT_SIZE

        for drawn in generated[scenario_id].render_plan.draws:
            assert drawn.size >= MIN_FONT_SIZE - 0.001, drawn

    def test_nothing_sensitive_reaches_the_page(self, scenario_id, generated):
        text = " ".join(
            drawn.text for drawn in generated[scenario_id].render_plan.draws
        ).lower()

        for marker in ("ssn", "social security number", "signature"):
            assert marker not in text

    def test_every_mapped_value_is_placed_somewhere(self, scenario_id, generated):
        """`unplaced` is a definition defect, never a data one."""
        assert generated[scenario_id].render_plan.unplaced == []

    def test_a_value_too_long_for_its_box_is_reported_rather_than_smeared(
        self, scenario_id, generated
    ):
        document = generated[scenario_id]

        for key in document.render_plan.unfitted:
            mapping = definition_for_form("TX_H1010").mapping_for(key)

            assert mapping is not None
            assert mapping.printed_label in document.review_text


# ---------------------------------------------------------------------------
# One adult: the empty-table case
# ---------------------------------------------------------------------------


class TestSingleAdult:
    @pytest.fixture
    def document(self, generated):
        return generated["austin_single_adult"]

    def test_the_household_table_is_entirely_empty(self, document):
        assert document.resolution.rows_filled(PEOPLE.prefix) == ()

    def test_an_empty_table_is_not_reported_as_work_still_to_do(self, document):
        """Six blank rows are not six people the applicant forgot.

        This household answered everything H1010 needs, so the review sheet has
        no "still yours to fill in" heading at all — which is the strongest
        form of the assertion: not one of the thirty-six household-table cells
        was reported as outstanding.
        """
        review = document.review_text

        assert "Still yours to fill in:" not in review

        for row in range(1, 7):
            assert f"Person {row} —" not in review

    def test_the_empty_table_is_counted_instead_of_listed(self, document):
        assert (
            "Person rows: you filled 0 of 6" in document.review_text
        )

    def test_the_mailing_block_stays_blank_because_mail_comes_home(
        self, document
    ):
        excluded = document.resolution.not_applicable_keys()

        for part in ("street", "city", "state", "zip_code"):
            assert f"applicant.mailing_address.{part}" in excluded

    def test_the_one_job_lands_in_the_first_printed_row(self, document):
        rendered = document.resolution.rendered_values()

        assert document.resolution.rows_filled(JOBS.prefix) == (0,)
        assert rendered[JOBS.key(0, "employer_name")] == "Torchy’s Tacos"

    def test_the_two_bills_land_in_the_first_two_rows_humanized(self, document):
        rendered = document.resolution.rendered_values()

        assert rendered[BILLS.key(0, "kind")] == "Rent or mortgage"
        assert rendered[BILLS.key(0, "amount_monthly")] == "1,150"
        assert rendered[BILLS.key(1, "kind")] == "Electricity"
        assert BILLS.key(2, "kind") not in rendered


# ---------------------------------------------------------------------------
# A family: the full-table case
# ---------------------------------------------------------------------------


class TestFamilyOfFour:
    @pytest.fixture
    def document(self, generated):
        return generated["austin_family_of_four"]

    def test_all_four_texas_programmes_are_ticked(self, document):
        rendered = document.resolution.rendered_values()

        for program in ("tx_snap", "tx_medicaid", "tx_chip", "tx_tanf"):
            assert rendered[f"programs.{program}"] == "X"

    def test_no_california_programme_reaches_the_texas_form(self, document):
        for key in document.resolution.rendered_values():
            assert key not in (
                "programs.medi_cal",
                "programs.calfresh",
                "programs.calworks",
            )

    def test_each_household_row_carries_its_own_person(self, document):
        rendered = document.resolution.rendered_values()

        assert document.resolution.rows_filled(PEOPLE.prefix) == (0, 1, 2)

        assert rendered[PEOPLE.key(0, "first_name")] == "Diego"
        assert rendered[PEOPLE.key(0, "date_of_birth")] == "07/19/1989"

        assert rendered[PEOPLE.key(2, "first_name")] == "Mateo"
        assert rendered[PEOPLE.key(2, "date_of_birth")] == "11/30/2020"

    def test_a_relationship_prints_as_a_word_not_as_a_stored_value(self, document):
        """Regression: the roster stores `spouse`, and the form printed it.

        The relationship is an enumeration the roster's select writes, so the
        canonical value is lowercase and underscored. Printed as stored it puts
        a database value in a box on a government form.
        """
        rendered = document.resolution.rendered_values()

        assert rendered[PEOPLE.key(0, "relationship_to_applicant")] == "Spouse"
        assert rendered[PEOPLE.key(1, "relationship_to_applicant")] == "Child"

    def test_a_childs_details_answer_the_same_column_as_an_adults(
        self, document
    ):
        """One printed column, two canonical homes — see `alternate_keys`.

        Row 0 is an adult and rows 1 and 2 are children, so the sex column is
        answered from ``adult.sex`` for one and ``child.sex`` for the others.
        The applicant sees one column.
        """
        by_key = document.resolution.by_key()

        adult_row = by_key[PEOPLE.key(0, "adult.sex")]
        child_row = by_key[PEOPLE.key(1, "adult.sex")]

        assert adult_row.source_key == PEOPLE.key(0, "adult.sex")
        assert child_row.source_key == PEOPLE.key(1, "child.sex")

        assert adult_row.rendered == "Male"
        assert child_row.rendered == "Female"

    def test_citizenship_prints_a_word_and_not_an_option_key(self, document):
        """Regression: the column printed the literal string "yes"."""
        rendered = document.resolution.rendered_values()

        assert rendered[PEOPLE.key(0, "adult.citizen_or_national")] == "Yes"

    def test_the_mailing_block_is_filled_when_mail_goes_elsewhere(
        self, document
    ):
        rendered = document.resolution.rendered_values()

        assert rendered["applicant.mailing_address.street"] == "PO Box 4477"
        assert rendered["applicant.mailing_address.zip_code"] == "78765"
        assert (
            "applicant.mailing_address.street"
            not in document.resolution.not_applicable_keys()
        )

    def test_both_jobs_land_in_their_own_rows(self, document):
        rendered = document.resolution.rendered_values()

        assert document.resolution.rows_filled(JOBS.prefix) == (0, 1)
        assert (
            rendered[JOBS.key(0, "employer_name")]
            == "Austin Independent School District"
        )
        assert rendered[JOBS.key(1, "employer_name")] == "H-E-B"
        assert rendered[JOBS.key(1, "person_name")].startswith("Diego")

    def test_money_is_rendered_as_the_printed_box_wants_it(self, document):
        rendered = document.resolution.rendered_values()

        assert rendered["household.annual_income"] == "41,000"
        assert rendered[JOBS.key(0, "gross_received_this_month")] == "1,600"
        # No second dollar sign: the form prints its own.
        assert "$" not in rendered[JOBS.key(0, "gross_received_this_month")]

    def test_the_representative_block_is_filled_and_carries_no_signature(
        self, document
    ):
        rendered = document.resolution.rendered_values()

        assert (
            rendered["household.authorized_representative.0.name"]
            == "Ana Villarreal"
        )
        assert (
            rendered["household.authorized_representative.0.phone"]
            == "(512) 555-6677"
        )

        for key in rendered:
            assert "signature" not in key


# ---------------------------------------------------------------------------
# Overflow and long values
# ---------------------------------------------------------------------------


class TestHouseholdOverflow:
    @pytest.fixture
    def document(self, generated):
        return generated["austin_household_overflow"]

    def test_the_printed_table_fills_completely(self, document):
        assert document.resolution.rows_filled(PEOPLE.prefix) == (0, 1, 2, 3, 4, 5)

    def test_the_people_it_cannot_hold_are_counted(self, document):
        assert document.resolution.overflow[PEOPLE.prefix] == 2

    def test_the_overflow_is_told_to_the_applicant(self, document):
        review = document.review_text

        assert "More than this form has room for" in review
        assert "2 more than the 6 printed rows" in review

    def test_the_jobs_table_overflows_too(self, document):
        assert document.resolution.overflow[JOBS.prefix] == 1

    def test_no_row_beyond_the_printed_table_is_drawn(self, document, h1010):
        """Overflow is reported, never rendered off the edge of the table."""
        for resolved in document.resolution.fields:
            if resolved.mapping.row is None:
                continue

            group_prefix, index = resolved.mapping.row
            group = h1010.group_for(group_prefix)

            assert group is not None
            assert index < group.rows

    def test_a_value_too_long_for_its_column_is_left_blank_and_named(
        self, document
    ):
        """The documented policy, exercised: report rather than smear.

        A 61-character employer name has no legible rendering inside a 99-point
        column. Drawing it anyway would run it across two neighbouring columns;
        drawing nothing and saying so leaves the applicant able to write it in.
        """
        unfitted = document.render_plan.unfitted

        assert JOBS.key(0, "employer_name") in unfitted
        assert "Too long for the printed box" in document.review_text
        assert "Job 1 — Employer" in document.review_text

    def test_the_rest_of_that_row_is_still_printed(self, document):
        """One value that does not fit does not cost the applicant the row."""
        rendered = document.resolution.rendered_values()

        assert rendered[JOBS.key(0, "gross_received_this_month")] == "1,600"
        assert JOBS.key(0, "gross_received_this_month") not in (
            document.render_plan.unfitted
        )

    def test_a_long_value_is_shrunk_before_it_is_ever_reported(self, document):
        """Shrink-to-fit comes first; reporting is the last resort.

        The employer address is thirty characters in a hundred-point column, so
        it is set smaller and printed in full. Only a value that cannot be made
        to fit at the legible floor is left blank — which is the previous test.
        """
        drawn = [
            item
            for item in document.render_plan.draws
            if item.text.startswith("100 Congress Avenue")
        ]

        assert drawn, "the employer address was not drawn at all"
        assert 6.0 <= drawn[0].size < 10.0

    def test_a_long_street_address_is_printed_whole_in_a_wide_box(
        self, document
    ):
        """A wide box needs no shrinking, and must not get any."""
        rendered = document.resolution.rendered_values()

        assert rendered["applicant.home_address.street"] == (
            "18200 Farm-to-Market Road 1826, Building C, Southwest Parkway"
        )
        assert "applicant.home_address.street" not in (
            document.render_plan.unfitted
        )

    def test_a_zip_plus_four_is_trimmed_to_the_five_the_box_holds(
        self, document
    ):
        rendered = document.resolution.rendered_values()

        assert rendered["applicant.home_address.zip_code"] == "78737"


# ---------------------------------------------------------------------------
# Explicit No
# ---------------------------------------------------------------------------


class TestNoIncome:
    @pytest.fixture
    def document(self, generated):
        return generated["austin_no_income"]

    def test_an_explicit_no_selects_the_no_box(self, document, h1010):
        by_key = document.resolution.by_key()

        for key in (
            "income.has_earned_income",
            "income.has_unearned_income",
            "expenses.has_household_expenses",
            "resources.has_vehicles",
        ):
            resolved = by_key[key]
            options = h1010.mapping_for(key).target.option_boxes

            assert resolved.rendered == "no", key
            assert resolved.box() == options["no"], key

    def test_no_row_is_written_into_any_table(self, document):
        for group in (PEOPLE, JOBS, BILLS):
            assert document.resolution.rows_filled(group.prefix) == (), group.prefix

    def test_an_unanswered_question_marks_neither_box(self, document):
        """`household.homeless` is never asked in this scenario."""
        rendered = document.resolution.rendered_values()

        assert "household.students" not in rendered
        assert "household.students" in document.resolution.skipped

    def test_the_representative_block_is_excluded_not_missing(self, document):
        excluded = document.resolution.not_applicable_keys()

        assert "household.authorized_representative.0.name" in excluded


# ---------------------------------------------------------------------------
# The review sheet, as a committed golden file
# ---------------------------------------------------------------------------

_REVIEW_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.mark.parametrize("scenario_id", SCENARIO_IDS)
def test_the_review_sheet_matches_its_committed_copy(scenario_id, generated):
    """The applicant-facing text, diffable.

    Everything else in this file asserts a property. This asserts the actual
    words, because the review sheet is the only part of the output most
    applicants will read closely, and its failure mode is not an exception —
    it is prose that is technically true and useless.

    The first version of the not-applicable section enumerated every blank
    table row, and a one-person household got eighty-four lines telling it that
    people three to six, jobs one to three and bills one to five were empty. No
    property-based assertion would have called that wrong. Reading the diff
    did.

    Regenerate with ``UPDATE_REVIEW_SHEETS=1 pytest`` and read what moved.
    """
    import os

    path = _REVIEW_DIR / f"h1010-{scenario_id}.review.txt"
    produced = generated[scenario_id].review_text

    if os.environ.get("UPDATE_REVIEW_SHEETS") == "1" or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(produced, encoding="utf-8")

    assert path.read_text(encoding="utf-8") == produced, (
        f"{path.name} is stale. Review the change, then rerun with "
        "UPDATE_REVIEW_SHEETS=1 to accept it."
    )


# ---------------------------------------------------------------------------
# Can an applicant actually reach every box?
# ---------------------------------------------------------------------------

_REACHABLE_KEYS = (
    Path(__file__).resolve().parent.parent
    / "web"
    / "tests"
    / "fixtures"
    / "tx-intake-canonical-keys.json"
)

#: Mappings no Texas applicant can fill from the intake, and why.
#:
#: A printed box that is mapped, tested and rendered correctly and that nothing
#: asks the applicant for is a box that stays blank forever — the most
#: expensive kind of defect here, because every other signal says it works.
#: Each entry is therefore a decision someone wrote down, not a gap.
#: Empty, and that is the assertion. Every printed box on the Texas worksheet
#: has a question behind it that a Texas applicant is actually asked.
UNREACHABLE_FROM_THE_INTAKE: dict[str, str] = {}


def test_every_h1010_mapping_can_be_reached_from_the_texas_intake(h1010):
    """The join the two runtimes can only make together.

    TypeScript emits the canonical keys the Texas screens can produce (see
    ``web/tests/unit/tx-intake-coverage.test.ts``); this asserts H1010 reads
    nothing outside that set. Table rows are checked at row 0: every row of a
    printed table draws the same fields, so a reachable first row is a reachable
    table.
    """
    if not _REACHABLE_KEYS.exists():  # pragma: no cover - a checked-in fixture
        pytest.skip(f"{_REACHABLE_KEYS} is missing; run the web suite to emit it")

    reachable = set(json.loads(_REACHABLE_KEYS.read_text()))

    unreachable: list[str] = []

    for mapping in h1010.fields:
        # Every candidate counts: a column answered by an alternate key is
        # reachable if either source is.
        if any(key in reachable for key in mapping.candidate_keys()):
            continue

        row = mapping.row

        # Rows beyond the first repeat row 0's fields exactly.
        if row is not None and row[1] > 0:
            continue

        if mapping.key in UNREACHABLE_FROM_THE_INTAKE:
            continue

        unreachable.append(mapping.key)

    assert unreachable == [], (
        "these printed boxes are mapped but no Texas applicant can fill them; "
        "add the question, or record why not in UNREACHABLE_FROM_THE_INTAKE"
    )


def test_the_unreachable_list_names_only_real_mappings(h1010):
    """A stale exception is worse than none: it excuses a box that moved."""
    for key in UNREACHABLE_FROM_THE_INTAKE:
        assert h1010.mapping_for(key) is not None, key
