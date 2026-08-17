#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Cross-runtime parity for how much the printed SAWS 2 PLUS form can hold.

The TypeScript side decides what to *tell the applicant* about records that will
not fit; the Python adapter decides what actually reaches the page. If those two
disagree the product either promises a row that does not exist or silently drops
an answer while reporting the draft complete.

So the capacities are asserted against the adapter's own destination tables
here. A row added to or removed from ``pdf_generator.py`` fails this test until
``web/src/lib/printed-capacity.ts`` is updated to match.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from benefits_navigator.pdf_generator import Saws2PlusFieldAdapter as Adapter

REGISTRY = (
    Path(__file__).resolve().parents[1]
    / "web"
    / "src"
    / "lib"
    / "printed-capacity.ts"
)

#: TypeScript block id -> the adapter attribute that defines its printed rows.
SEQUENTIAL_BLOCKS = {
    "income.unearned": "PAGE_8_UNEARNED_ROWS",
    "income.earned": "PAGE_9_EARNED_ROWS",
    "income.self_employment": "PAGE_9_SELF_EMPLOYMENT_ROWS",
    "resources.accounts": "PAGE_14_RESOURCE_ROWS",
    "resources.personal_property": "PAGE_14_PERSONAL_PROPERTY_ROWS",
    "household.disability_detail": "PAGE_6_DISABILITY_BLOCKS",
    "appendices.tribal": "APPENDIX_B_PEOPLE",
    "appendices.vehicle": "APPENDIX_E_VEHICLES",
}

#: Keyed blocks: the printed rows are named, not numbered.
KEYED_BLOCKS = {
    "income.in_kind": "PAGE_10_OTHER_INCOME_ROWS",
    "expenses.household": "PAGE_11_EXPENSE_ROWS",
}


@pytest.fixture(scope="module")
def registry_source() -> str:
    return REGISTRY.read_text(encoding="utf-8")


def _declared_capacity(source: str, block_id: str) -> int:
    """The `capacity:` declared for one block id in the TypeScript registry."""
    match = re.search(
        rf"id: '{re.escape(block_id)}',.*?capacity: (\d+),",
        source,
        re.DOTALL,
    )

    assert match, f"no capacity declared for {block_id}"

    return int(match.group(1))


def _declared_categories(source: str, block_id: str) -> set[str]:
    """The category keys declared in one keyed block's `rowByCategory`."""
    match = re.search(
        rf"id: '{re.escape(block_id)}',.*?rowByCategory: \{{(.*?)\}},",
        source,
        re.DOTALL,
    )

    assert match, f"no rowByCategory declared for {block_id}"

    return set(re.findall(r"^\s*(\w+):", match.group(1), re.MULTILINE))


@pytest.mark.parametrize(("block_id", "attribute"), sorted(SEQUENTIAL_BLOCKS.items()))
def test_sequential_capacity_matches_the_adapter(
    block_id: str, attribute: str, registry_source: str
) -> None:
    assert _declared_capacity(registry_source, block_id) == len(
        getattr(Adapter, attribute)
    ), f"{block_id} disagrees with {attribute}"


def test_household_table_capacity_matches_the_adapter(registry_source: str) -> None:
    match = re.search(r"PRINTED_HOUSEHOLD_ROWS = (\d+);", registry_source)

    assert match
    assert int(match.group(1)) == len(Adapter.ADULT_ROWS)
    assert int(match.group(1)) == len(Adapter.CHILD_ROWS)


def test_appendix_a_holds_exactly_one_employer(registry_source: str) -> None:
    """Appendix A is one printed page per employer, so its capacity is 1."""
    assert _declared_capacity(registry_source, "appendices.employer_coverage") == 1


def test_in_kind_categories_match_the_adapters_printed_rows(
    registry_source: str,
) -> None:
    assert _declared_categories(registry_source, "income.in_kind") == set(
        Adapter.PAGE_10_OTHER_INCOME_ROWS
    )


def test_expense_categories_match_the_adapters_kind_mapping(
    registry_source: str,
) -> None:
    """Every expense kind the adapter can place must be declared, and no more.

    "other" is deliberately absent from both: Q15 prints no row for it, which is
    exactly the case the registry reports as `category_has_no_printed_row`.
    """
    assert _declared_categories(registry_source, "expenses.household") == set(
        Adapter.EXPENSE_KIND_TO_ROW
    )


def test_expense_rows_named_in_the_registry_exist_on_the_form(
    registry_source: str,
) -> None:
    """Two expense kinds may share one printed row; the pairs must agree."""
    match = re.search(
        r"id: 'expenses\.household',.*?rowByCategory: \{(.*?)\},",
        registry_source,
        re.DOTALL,
    )
    assert match

    declared = dict(
        re.findall(r"^\s*(\w+): '([^']+)',", match.group(1), re.MULTILINE)
    )

    # Kinds the adapter sends to the same printed row must share a label here.
    for left, left_row in Adapter.EXPENSE_KIND_TO_ROW.items():
        for right, right_row in Adapter.EXPENSE_KIND_TO_ROW.items():
            assert (left_row == right_row) == (
                declared[left] == declared[right]
            ), f"{left} and {right} disagree about sharing a printed row"


def test_every_registered_block_names_a_real_pdf_page(registry_source: str) -> None:
    """Page numbers are printed in the completion guide, so they must be real."""
    from pypdf import PdfReader

    from benefits_navigator.pdf_generator import _FORMS_DIR

    pages = len(PdfReader(str(_FORMS_DIR / "CA-SAWS-2-PLUS.pdf")).pages)

    for page in re.findall(r"^\s*page: (\d+),", registry_source, re.MULTILINE):
        assert 1 <= int(page) <= pages, page
