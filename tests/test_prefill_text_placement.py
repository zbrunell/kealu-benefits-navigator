#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Every prefilled value lands inside its own box, on every form we fill.

Product testing reported values written onto the prefilled PDFs that did not
match the boxes beneath them — overlapping borders and labels, running out of
their fields. A sweep of every form the application fills found five causes,
and each has a guard here:

**Native-field forms** (SAWS 2 PLUS in English and Spanish, and the legacy
SAWS 1 / Illinois / New York / Pennsylvania fill):

* the stored appearance stream was drawn at the field's *old* size after the
  value had been shrunk to fit, so viewers that draw the stored appearance —
  Preview, print pipelines — clipped the value the shrinking had fixed;
* a multiline value's appearance was one unwrapped line, clipped at the right;
* widgets the form draws over part of their own label (the Spanish home
  address, Appendix B's phone) printed the value through the label.

**Overlay forms** (Texas H1010 in both editions, H3037):

* boxes derived from label positions ran past the printed field into the
  neighbouring column's border, and Section O's payer line through the arrow
  printed inside it;
* the phone slots were measured narrower than the printed template and then
  padded again, so every phone number printed at 6 points.

The assertions are geometric and read what a viewer will actually draw — the
stored appearance stream, or the overlay's draw list — with worst-case values:
long names, long addresses, long employers, maximum households.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

pypdf = pytest.importorskip("pypdf")

from pypdf import PdfReader  # noqa: E402

from benefits_navigator.formmap import (  # noqa: E402
    canonical_values_from_field_plan,
    definition_for_form,
    generate_form,
)
from benefits_navigator.formmap.acroform import (  # noqa: E402
    WRITING_SPACE_PATH,
    writing_spaces_for,
)
from benefits_navigator.formmap.documents import resolve_for_definition  # noqa: E402
from benefits_navigator.formmap.measure import _drawn_rects  # noqa: E402
from benefits_navigator.formmap.provenance import load_document  # noqa: E402
from benefits_navigator.formmap.targets import FieldKind, OverlayTarget  # noqa: E402
from benefits_navigator.formmap.textfit import (  # noqa: E402
    FIELD_PADDING,
    MIN_FONT_SIZE,
    helvetica_width,
)
from benefits_navigator.pdf_generator import (  # noqa: E402
    _FORMS_DIR,
    generate_saws2_plus_pdf,
)

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "web" / "tests" / "fixtures"

# ---------------------------------------------------------------------------
# Worst-case values
# ---------------------------------------------------------------------------

#: Long answers a real applicant can give, by the last segment of the key.
LONG_TEXT = {
    "first_name": "Maria Guadalupe",
    "middle_name": "Esperanza",
    "last_name": "Fernández de la Cruz Villanueva",
    "street": "12345 Rancho Santa Margarita Parkway Southeast",
    "apartment": "Apt 4821-B",
    "city": "Rancho Santa Margarita",
    "county": "San Bernardino",
    "email": "maria.guadalupe.fernandez.villanueva@example-longdomain.test",
    "employer_name": "Bright Star Community Health and Wellness Cooperative Inc.",
    "organization": "Community Health and Wellness Navigators of the Central Valley",
    "employer": (
        "Bright Star Community Health and Wellness Cooperative Inc., "
        "12345 Rancho Santa Margarita Parkway, Fresno CA 93701"
    ),
    "name": "Dr Priyanka Venkataraman-Rodriguez",
    "person_name": "Maria Guadalupe Fernández de la Cruz",
    "employee_name": "Maria Guadalupe Fernández de la Cruz",
    "owner_name": "Maria Guadalupe Fernández de la Cruz",
    "user_name": "Maria Guadalupe Fernández de la Cruz",
    "relationship_to_applicant": "Stepdaughter-in-law",
    "reason_for_leaving": (
        "The store closed permanently in November after the owner retired, and "
        "the whole team was let go with two weeks notice at the same time."
    ),
    "place_of_birth": "San Luis Obispo, California",
    "tribe_name": "Confederated Tribes of the Grand Ronde Community",
    "year_make_model": "2013 Mercedes-Benz Sprinter 2500 Cargo Van",
    "used_for": "Commuting to work and medical appointments",
    "payer": "Central Texas Regional Mobility Authority Maintenance Division",
    "employer_address": "12345 Rancho Santa Margarita Parkway Southeast, Austin TX",
    "source": "Supplemental Security Income (SSI) disability",
}

LONG_NUMBERS = {
    "fair_market_value": 123456,
    "lowest_cost_premium": 12345.67,
    "pay_amount": 1234.56,
    "tribal_income_amount": 123456,
    "amount_monthly": 123456,
    "reported_amount": 123456,
}


def _worst(plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    worst = []

    for entry in plan:
        last = entry["key"].rsplit(".", 1)[-1]
        value = entry["value"]

        if isinstance(value, str) and last in LONG_TEXT:
            value = LONG_TEXT[last]
        elif last in LONG_NUMBERS and not isinstance(value, bool):
            value = LONG_NUMBERS[last]
        elif last.endswith("_frequency") and isinstance(value, str):
            # The Texas intake has been seen to emit "Monthly"; the form's
            # options are lower-case. Not what this suite is about.
            value = value.lower()

        worst.append({"key": entry["key"], "value": value})

    return worst


def _scenarios(name: str) -> dict[str, dict[str, Any]]:
    path = FIXTURES / name

    if not path.exists():  # pragma: no cover - a checked-in fixture
        pytest.skip(f"{path} is missing; run the web unit suite to emit it")

    return {item["id"]: item for item in json.loads(path.read_text())}


# ---------------------------------------------------------------------------
# Reading what a viewer draws from a native field
# ---------------------------------------------------------------------------

_TF = re.compile(rb"([\d.]+)\s+Tf")
_TJ = re.compile(rb"\((.*?)(?<!\\)\)\s*Tj", re.S)


def _appearance(annotation) -> tuple[float, list[str]]:
    """The size and the lines a widget's *stored* appearance draws."""
    stream = annotation["/AP"]["/N"].get_object().get_data()
    sizes = [float(size) for size in _TF.findall(stream)]
    lines = [
        raw.replace(b"\\(", b"(").replace(b"\\)", b")").replace(b"\\\\", b"\\")
        .decode("cp1252", "replace")
        for raw in _TJ.findall(stream)
    ]

    return (sizes[0] if sizes else 0.0), lines


def _declared(annotation) -> float:
    node = annotation

    while node is not None:
        if "/DA" in node:
            parts = str(node["/DA"]).split()
            return float(parts[parts.index("Tf") - 1])

        parent = node.get("/Parent")
        node = parent.get_object() if parent is not None else None

    return 0.0


def _text_widgets(path: Path):
    """Every written text widget: (page, name, annotation, value, flags)."""
    for page_number, page in enumerate(PdfReader(str(path)).pages, start=1):
        for reference in page.get("/Annots") or []:
            annotation = reference.get_object()
            parent = annotation.get("/Parent")
            parent = parent.get_object() if parent is not None else {}

            if (annotation.get("/FT") or parent.get("/FT")) != "/Tx":
                continue

            value = annotation.get("/V")
            if value is None:
                value = parent.get("/V")

            if not value or "/AP" not in annotation:
                continue

            name = str(annotation.get("/T") or parent.get("/T"))
            flags = int(annotation.get("/Ff") or parent.get("/Ff") or 0)

            yield page_number, name, annotation, str(value), flags


def _rect(annotation) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = (float(value) for value in annotation["/Rect"])

    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


def _unfitted(review: str) -> set[str]:
    return set(re.findall(r"^  - (.+)$", review, re.M))


def _saws2(plan, locale: str, output: Path) -> tuple[Path, str]:
    path = generate_saws2_plus_pdf(
        {
            "state": "CA",
            "county": "Fresno",
            "zip_code": "93701",
            "locale": locale,
            "application_field_plan": plan,
        },
        "",
        output,
    )

    return path, path.with_suffix(".review.txt").read_text(encoding="utf-8")


_SAWS2_WORST = ("multiple_appendices", "max_household_rows", "appendix_d_capacity")


@pytest.fixture(scope="module")
def saws2_worst(tmp_path_factory) -> dict[tuple[str, str], tuple[Path, str]]:
    scenarios = _scenarios("saws2-e2e-scenarios.json")

    return {
        (scenario_id, locale): _saws2(
            _worst(scenarios[scenario_id]["fieldPlan"]),
            locale,
            tmp_path_factory.mktemp(f"worst-{scenario_id}-{locale}"),
        )
        for scenario_id in _SAWS2_WORST
        for locale in ("en", "es")
    }


# ---------------------------------------------------------------------------
# Native fields: what the stored appearance draws
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scenario_id", _SAWS2_WORST)
@pytest.mark.parametrize("locale", ["en", "es"])
def test_the_stored_appearance_is_drawn_at_the_fitted_size(
    saws2_worst, scenario_id, locale
):
    """``/AP`` and ``/DA`` agree, so every viewer prints the same thing.

    The defect: the date of birth was shrunk to 8.77pt in ``/DA`` while ``/AP``
    still drew it at 10pt, so Preview printed "01/01/199".
    """
    path, _ = saws2_worst[(scenario_id, locale)]
    checked = 0

    for page, name, annotation, _value, _flags in _text_widgets(path):
        size, _ = _appearance(annotation)
        checked += 1

        assert size == pytest.approx(_declared(annotation), abs=0.01), (
            f"page {page} {name}: appearance drawn at {size}pt, field declares "
            f"{_declared(annotation)}pt"
        )

    assert checked > 20


@pytest.mark.parametrize("scenario_id", _SAWS2_WORST)
@pytest.mark.parametrize("locale", ["en", "es"])
def test_every_drawn_line_fits_its_widget(saws2_worst, scenario_id, locale):
    """No line of any stored appearance runs past its widget, unless reported.

    A value that cannot fit even at the legible floor is named in the review
    sheet for attachment; everything else must be wholly visible.
    """
    path, review = saws2_worst[(scenario_id, locale)]
    reported = _unfitted(review)

    for page, name, annotation, value, flags in _text_widgets(path):
        if name in reported:
            continue

        size, lines = _appearance(annotation)
        left, bottom, right, top = _rect(annotation)
        usable = right - left - FIELD_PADDING * 2

        for line in lines:
            assert helvetica_width(line, size) <= usable + 0.05, (
                f"page {page} {name}: {line!r} at {size}pt is wider than the "
                f"{usable:.1f}pt its widget leaves"
            )

        # Wrapped lines stack inside the widget.
        assert len(lines) * size * 1.15 <= (top - bottom) + 0.5 or len(lines) == 1

        assert size >= MIN_FONT_SIZE


@pytest.mark.parametrize("locale", ["en", "es"])
def test_a_long_multiline_answer_is_wrapped_not_clipped(saws2_worst, locale):
    """Appendix D's "reason for leaving" used to be one clipped line."""
    path, _ = saws2_worst[("appendix_d_capacity", locale)]

    wrapped = [
        (name, lines)
        for _page, name, annotation, value, flags in _text_widgets(path)
        if flags & 4096 and value == LONG_TEXT["reason_for_leaving"]
        for _size, lines in [_appearance(annotation)]
    ]

    assert wrapped, "the long multiline answer was not written anywhere"

    for name, lines in wrapped:
        assert len(lines) > 1, f"{name} drew its answer as one line"
        assert " ".join(lines).split() == LONG_TEXT["reason_for_leaving"].split()


def test_the_field_value_is_the_answer_not_the_wrapped_lines(saws2_worst):
    """Wrapping belongs to the appearance; ``/V`` keeps what was answered."""
    path, _ = saws2_worst[("appendix_d_capacity", "en")]

    values = [value for *_rest, value, _flags in _text_widgets(path)]

    assert LONG_TEXT["reason_for_leaving"] in values
    assert not any("\n" in value for value in values)


def test_the_spanish_home_address_is_written_below_its_label(saws2_worst):
    """The Spanish widget covers "LLEGAR A SU HOGAR"; the address goes under it.

    Checked in both places a viewer might draw from: the stored appearance
    (drawn inside the rectangle) and the rectangle itself, which is what a
    viewer regenerating the appearance lays the value out in.
    """
    path, _ = saws2_worst[("multiple_appendices", "es")]

    address = next(
        annotation
        for page, name, annotation, _v, _f in _text_widgets(path)
        if page == 7 and name == "Text4 PG 1"
    )
    _left, _bottom, _right, top = _rect(address)

    # The label's second line sits with its descenders at about y=646.7.
    assert top <= 646.5
    size, lines = _appearance(address)
    assert lines == [LONG_TEXT["street"]]
    assert size >= MIN_FONT_SIZE


def test_the_english_home_address_keeps_its_full_widget(saws2_worst):
    """Only widgets a label actually intrudes on move."""
    path, _ = saws2_worst[("multiple_appendices", "en")]
    template = PdfReader(str(_FORMS_DIR / "CA-SAWS-2-PLUS.pdf"))

    original = next(
        _rect(reference.get_object())
        for reference in template.pages[6]["/Annots"]
        if reference.get_object().get("/T") == "Text4 PG 1"
    )
    written = next(
        _rect(annotation)
        for page, name, annotation, _v, _f in _text_widgets(path)
        if page == 7 and name == "Text4 PG 1"
    )

    assert written == pytest.approx(original)


def test_a_template_nobody_measured_gets_no_adjustments(tmp_path):
    changed = tmp_path / "CA-SAWS-2-PLUS-ES.pdf"
    changed.write_bytes((_FORMS_DIR / "CA-SAWS-2-PLUS-ES.pdf").read_bytes() + b"\n")

    assert writing_spaces_for(changed) == {}
    assert writing_spaces_for(_FORMS_DIR / "CA-SAWS-2-PLUS-ES.pdf")


def test_the_writing_space_measurements_are_in_step():
    """A template or rule changed without regenerating cannot reach main."""
    if shutil.which("pdftotext") is None:
        pytest.skip("pdftotext (poppler) is not installed")

    result = subprocess.run(
        [sys.executable, "tools/measure_acroform_writing_space.py", "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert WRITING_SPACE_PATH.exists()


@pytest.mark.parametrize("state", ["CA", "IL", "NY", "PA"])
def test_the_legacy_fill_draws_every_value_inside_its_box(state, tmp_path):
    """The no-field-plan route fills four more templates the same way.

    New York auto-sizes its language field (``/Helv 0 Tf``), which printed
    "English" at 13pt beside 10pt neighbours; Illinois declares a 10pt date in a
    12pt-tall box.
    """
    from benefits_navigator.form_filler import fill_official_form

    county, zip_code = {
        "CA": ("San Bernardino County", "92401"),
        "IL": ("Cook County", "60601"),
        "NY": ("Kings County", "11201"),
        "PA": ("Philadelphia County", "19103"),
    }[state]

    path = fill_official_form(
        {"state": state, "county": county, "zip_code": zip_code},
        "SNAP MEDICAID TANF",
        tmp_path,
    )

    assert path is not None

    drawn = 0

    for page, name, annotation, _value, _flags in _text_widgets(path):
        size, lines = _appearance(annotation)
        left, bottom, right, top = _rect(annotation)
        drawn += 1

        assert size > 0, f"{state} page {page} {name} is still auto-sized"
        assert size == pytest.approx(_declared(annotation), abs=0.01)
        assert size <= top - bottom - 3 + 0.01, f"{state} {name} too tall"

        for line in lines:
            assert helvetica_width(line, size) <= right - left - 4 + 0.05

    assert drawn


# ---------------------------------------------------------------------------
# Overlay forms: where each value is drawn
# ---------------------------------------------------------------------------


def _texas_worst() -> dict[str, Any]:
    scenarios = _scenarios("tx-h1010-scenarios.json")
    values = canonical_values_from_field_plan(
        _worst(scenarios["austin_household_overflow"]["fieldPlan"])
    )
    values.update(
        {
            "applicant.alternate_phone": "5125559876",
            "household.anyone_pregnant": True,
            "household.pregnancy.person_name": LONG_TEXT["person_name"],
            "household.authorized_representative": True,
            "household.authorized_representative.0.present": True,
            "household.authorized_representative.0.name": LONG_TEXT["name"],
            "household.authorized_representative.0.organization": (
                LONG_TEXT["organization"]
            ),
            "household.authorized_representative.0.address.street": (
                LONG_TEXT["street"]
            ),
            "household.authorized_representative.0.address.city": "Austin",
            "household.authorized_representative.0.address.state": "TX",
            "household.authorized_representative.0.address.zip_code": "78737",
            "household.authorized_representative.0.phone": "5125550199",
        }
    )

    return values


def _texas_cases():
    scenarios = _scenarios("tx-h1010-scenarios.json")
    cases = {"worst_case": _texas_worst()}

    for scenario_id, scenario in scenarios.items():
        cases[scenario_id] = canonical_values_from_field_plan(
            _worst(scenario["fieldPlan"])
            if scenario_id == "austin_single_adult"
            else [
                {
                    "key": entry["key"],
                    "value": entry["value"].lower()
                    if entry["key"].endswith("_frequency")
                    and isinstance(entry["value"], str)
                    else entry["value"],
                }
                for entry in scenario["fieldPlan"]
            ]
        )

    return cases


TEXAS_CASES = _texas_cases()

TEXAS_FORMS = [("TX_H1010", "en"), ("TX_H1010", "es"), ("TX_H3037", "en")]


_MARK_KINDS = (FieldKind.CHECKBOX, FieldKind.CHOICE)


def _owning_box(resolution, drawn):
    """The target box a draw was placed in.

    A mark and a value can share a region — Section P prints each housing
    cost's circle beside its amount — so a mark is looked up among marks and a
    value among values.
    """
    is_mark = drawn.text == "X"

    for resolved in resolution.fields:
        target = resolved.target

        if not isinstance(target, OverlayTarget):
            continue

        if (resolved.kind in _MARK_KINDS) != is_mark:
            continue

        if resolved.kind is FieldKind.CHOICE:
            boxes = (resolved.box(),) if resolved.box() is not None else ()
        else:
            boxes = target.boxes()

        for box in boxes:
            if (
                box.page == drawn.page
                and box.x - 0.01 <= drawn.x <= box.right + 0.01
                and box.y - 0.01 <= drawn.y <= box.top + 0.01
            ):
                return resolved, box

    return None, None


@pytest.fixture(scope="module")
def texas_generated():
    return {
        (case, form_id, locale): generate_form(form_id, values, locale=locale)
        for case, values in TEXAS_CASES.items()
        for form_id, locale in TEXAS_FORMS
    }


@pytest.fixture(scope="module")
def texas_cells():
    """Every writing cell each Texas edition draws, from its own content."""
    cells = {}

    for form_id, locale in TEXAS_FORMS:
        definition, chosen = resolve_for_definition(
            definition_for_form(form_id), locale
        )
        cells[(form_id, locale)] = [
            rect
            for rect in _drawn_rects(load_document(chosen.variant.document))
            if rect.width >= 15 and 8 <= rect.height <= 45
        ]

    return cells


@pytest.mark.parametrize("case", sorted(TEXAS_CASES))
@pytest.mark.parametrize("form_id, locale", TEXAS_FORMS)
def test_every_overlay_value_sits_inside_its_own_box(
    texas_generated, case, form_id, locale
):
    generated = texas_generated[(case, form_id, locale)]

    for drawn in generated.render_plan.draws:
        resolved, box = _owning_box(generated.resolution, drawn)

        assert box is not None, f"{drawn.text!r} was drawn outside every box"

        right = drawn.x + helvetica_width(drawn.text, drawn.size)

        assert drawn.x >= box.x - 0.01
        assert right <= box.right + 0.01, (
            f"{resolved.key}: {drawn.text!r} ends at {right:.1f}, past its "
            f"box's right edge {box.right:.1f}"
        )
        # Descender to cap height, inside the box.
        assert drawn.y - 0.21 * drawn.size >= box.y - 0.01
        assert drawn.y + 0.72 * drawn.size <= box.top + 0.01

        # A mark is sized to its printed circle; only text has a legible floor.
        if drawn.text != "X":
            assert drawn.size >= MIN_FONT_SIZE - 0.01


@pytest.mark.parametrize("case", sorted(TEXAS_CASES))
@pytest.mark.parametrize("form_id, locale", TEXAS_FORMS)
def test_no_overlay_value_runs_out_of_its_printed_field(
    texas_generated, texas_cells, case, form_id, locale
):
    """A value that starts in a white field ends in it too.

    Before, the H1010 home address ran five points past its field into the
    county column's border, and each person's last name past the right edge of
    their row.
    """
    generated = texas_generated[(case, form_id, locale)]
    cells = texas_cells[(form_id, locale)]

    for drawn in generated.render_plan.draws:
        if drawn.text == "X":
            continue

        middle = drawn.y + 0.25 * drawn.size
        containing = [
            cell
            for cell in cells
            if cell.page == drawn.page
            and cell.x <= drawn.x <= cell.right
            and cell.y <= middle <= cell.top
        ]

        if not containing:
            continue

        cell = min(containing, key=lambda rect: rect.width * rect.height)
        right = drawn.x + helvetica_width(drawn.text, drawn.size)

        assert right <= cell.right + 0.05, (
            f"page {drawn.page}: {drawn.text!r} runs to {right:.1f}, past its "
            f"printed field's edge at {cell.right:.1f}"
        )


@pytest.mark.parametrize("locale", ["en", "es"])
def test_a_phone_number_prints_at_a_legible_size_beside_its_dash(
    texas_generated, locale
):
    """The phone used to print at 6pt, the last four digits 20pt from the dash."""
    generated = texas_generated[("worst_case", "TX_H1010", locale)]
    definition, _ = resolve_for_definition(definition_for_form("TX_H1010"), locale)

    for key in (
        "applicant.phone",
        "applicant.alternate_phone",
        "household.authorized_representative.0.phone",
    ):
        target = definition.mapping_for(key).target
        slots = [segment.box for segment in target.segments]
        draws = [
            drawn
            for drawn in generated.render_plan.draws
            for slot in slots
            if drawn.page == slot.page
            and slot.x <= drawn.x <= slot.right
            and slot.y <= drawn.y <= slot.top
        ]

        rendered = next(
            resolved.rendered
            for resolved in generated.resolution.fields
            if resolved.key == key
        )

        assert [drawn.text for drawn in draws] == [
            rendered[0:3],
            rendered[3:6],
            rendered[6:10],
        ]

        sizes = {round(drawn.size, 2) for drawn in draws}

        assert len(sizes) == 1, f"{key} printed in {sizes}"
        assert sizes.pop() >= 8.0, f"{key} printed below 8pt"

        # The last four digits start next to the printed dash, not across the
        # column: the tail slot is only as wide as four digits need.
        assert slots[2].width <= 30.0


def test_the_area_code_cell_lies_between_the_printed_parentheses():
    """It used to cover the closing parenthesis on the English edition."""
    if shutil.which("pdftotext") is None:
        pytest.skip("pdftotext (poppler) is not installed")

    from benefits_navigator.formmap.measure import DocumentText

    for locale in ("en", "es"):
        definition, chosen = resolve_for_definition(
            definition_for_form("TX_H1010"), locale
        )
        words = DocumentText.of(load_document(chosen.variant.document)).words

        for key in ("applicant.phone", "applicant.alternate_phone"):
            area = definition.mapping_for(key).target.segments[0].box
            closes = [
                word
                for word in words
                if word.page == area.page
                and word.text.strip() == ")"
                and abs(word.y - area.y) <= 4
                and area.x < word.x < area.x + 40
            ]
            opens = [
                word
                for word in words
                if word.page == area.page
                and word.text.strip() == "("
                and abs(word.y - area.y) <= 4
                and area.x - 10 < word.right <= area.x + 1
            ]

            assert closes and opens, f"{locale} {key}: template not found"
            assert area.right <= min(word.x for word in closes)
            assert area.x >= max(word.right for word in opens)


def test_unfitted_overlay_values_are_reported_not_drawn(texas_generated):
    """What cannot fit legibly is named on the review sheet, never smeared."""
    generated = texas_generated[("worst_case", "TX_H1010", "en")]
    drawn = {drawn.text for drawn in generated.render_plan.draws}

    for key in generated.render_plan.unfitted:
        rendered = next(
            resolved.rendered
            for resolved in generated.resolution.fields
            if resolved.key == key
        )

        assert rendered not in drawn


def test_marks_are_still_centred_in_their_circles(texas_generated):
    """The overlay changes were to text; marks must not have moved."""
    generated = texas_generated[("worst_case", "TX_H1010", "en")]

    for drawn in generated.render_plan.draws:
        if drawn.text != "X":
            continue

        _resolved, box = _owning_box(generated.resolution, drawn)

        assert box is not None
        centre = drawn.x + helvetica_width("X", drawn.size) / 2

        assert abs(centre - (box.x + box.width / 2)) <= 0.05
