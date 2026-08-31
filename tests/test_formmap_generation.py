#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The vertical slice: canonical data in, a real PDF out with values in it.

Deliberately a small file. Mapping correctness is asserted in
``test_formmap_mapping.py`` without any PDF, because that is where 38 fields can
be checked individually and cheaply. What only a generated document can prove is
the part after mapping:

* the bytes are a PDF a reader can open,
* the pages are the size the definition declared,
* the values are actually *in* the content stream — not merely resolved,
* the placements are inside their boxes at a legible size,
* nothing sensitive reached the page,
* the document says plainly that it is not the official form.

The rendering-defect tests near the end each pin a bug found by generating this
document and reading it back, which is why they are here rather than in the
mapping file.
"""

from __future__ import annotations

import pytest

from benefits_navigator.formmap import (
    Box,
    FieldKind,
    FieldMapping,
    FormDefinition,
    OverlayTarget,
    definition_for_form,
    generate_form,
    output_filename,
    plan_render,
    resolve_mappings,
)
from benefits_navigator.formmap.render import SimplePdf, content_stream
from benefits_navigator.formmap.textfit import MIN_FONT_SIZE

from tests.test_formmap_mapping import AUSTIN_CANONICAL

pypdf = pytest.importorskip("pypdf")


@pytest.fixture(scope="module")
def generated():
    return generate_form("TX_H1010", AUSTIN_CANONICAL)


@pytest.fixture(scope="module")
def pages(generated):
    import io

    reader = pypdf.PdfReader(io.BytesIO(generated.pdf_bytes))

    return [page.extract_text() for page in reader.pages]


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------


class TestGeneratedDocument:
    def test_produces_a_readable_pdf(self, generated):
        assert generated.pdf_bytes.startswith(b"%PDF-")
        assert generated.pdf_bytes.rstrip().endswith(b"%%EOF")

    def test_pypdf_can_open_it(self, generated):
        import io

        reader = pypdf.PdfReader(io.BytesIO(generated.pdf_bytes))

        definition = definition_for_form("TX_H1010")

        # The page count the definition declares, not a literal. The form grew
        # from two pages to five when the household, income and expense tables
        # were added, and a literal here made that a test failure rather than
        # the fact it is.
        assert len(reader.pages) == definition.page_count

    def test_pages_are_the_declared_size(self, generated):
        import io

        definition = definition_for_form("TX_H1010")
        reader = pypdf.PdfReader(io.BytesIO(generated.pdf_bytes))

        for page in reader.pages:
            assert float(page.mediabox.width) == definition.page_width
            assert float(page.mediabox.height) == definition.page_height

    def test_is_not_presented_as_the_official_form(self, generated, pages):
        """We do not hold the government PDF, and must not imply we do."""
        assert generated.is_official_document is False

        first = pages[0]

        assert "Not the official Texas HHSC form" in first
        assert "YourTexasBenefits.com" in first

    def test_names_the_form_it_corresponds_to(self, pages):
        assert "H1010" in pages[0]
        assert "Texas Works Application for Assistance" in pages[0]

    def test_document_language_is_the_form_language_not_a_ui_locale(
        self, generated
    ):
        assert generated.document_language == "en"


# ---------------------------------------------------------------------------
# The values are on the page
# ---------------------------------------------------------------------------


class TestRenderedValues:
    @pytest.mark.parametrize(
        "value",
        [
            "Marisol",
            "Elena",
            "Ramirez",
            "03/14/1991",
            "(512) 555-1234",
            "marisol.ramirez@example.com",
            "2100 Nueces Street",
            "Apt 4B",
            "Austin",
            "Travis",
            "TX",
            "78705",
            "W-2 employee",
            "20,000",
        ],
    )
    def test_value_appears_in_the_document(self, pages, value):
        assert any(value in page for page in pages), value

    def test_the_transformed_form_is_used_not_the_canonical_one(self, pages):
        text = "\n".join(pages)

        # The date and phone as the form prints them...
        assert "03/14/1991" in text
        assert "(512) 555-1234" in text

        # ...and never the canonical storage form.
        assert "1991-03-14" not in text
        assert "5125551234" not in text

    def test_a_zip_plus_four_is_not_printed_in_a_five_wide_box(self, pages):
        text = "\n".join(pages)

        assert "78705" in text
        assert "78705-1234" not in text

    def test_every_filled_value_is_actually_drawn(self, generated):
        """Resolved is not the same as rendered; assert the stronger one."""
        drawn = {drawn.text for drawn in generated.render_plan.draws}

        for resolved in generated.resolution.fields:
            if resolved.kind in (FieldKind.CHECKBOX, FieldKind.CHOICE):
                continue

            if resolved.kind is FieldKind.MULTILINE:
                # Wrapped into lines, so the whole string need not appear.
                continue

            assert resolved.rendered in drawn, resolved.key

    def test_nothing_is_left_unfitted_for_this_household(self, generated):
        assert generated.render_plan.unfitted == []

    def test_nothing_is_left_unplaced(self, generated):
        assert generated.render_plan.unplaced == []

    def test_one_mark_is_drawn_per_answered_box(self, generated):
        marks = [
            drawn for drawn in generated.render_plan.draws if drawn.text == "X"
        ]

        # Derived rather than hardcoded: a literal count here has to be
        # recalculated by hand every time the sample household changes, and
        # getting it wrong is a failing test that says nothing useful.
        expected = [
            resolved
            for resolved in generated.resolution.fields
            if resolved.kind in (FieldKind.CHECKBOX, FieldKind.CHOICE)
        ]

        assert len(marks) == len(expected)

        # The two selected programs are among them; the two unselected are not.
        filled = generated.filled_keys

        assert "programs.tx_snap" in filled
        assert "programs.tx_medicaid" in filled
        assert "programs.tx_chip" not in filled
        assert "programs.tx_tanf" not in filled


class TestPlacement:
    def test_every_draw_sits_inside_its_own_box(self, generated):
        """The assertion a visual check would be making, made mechanically."""
        definition = definition_for_form("TX_H1010")
        report = resolve_mappings(definition, AUSTIN_CANONICAL)

        for resolved in report.fields:
            box = resolved.box()

            assert box is not None, resolved.key

            plan = plan_render([resolved])

            for drawn in plan.draws:
                assert drawn.page == box.page, resolved.key
                assert box.x - 0.01 <= drawn.x, resolved.key
                assert drawn.x <= box.right + 0.01, resolved.key
                # The baseline sits inside the box, allowing for the descender.
                assert box.y - drawn.size <= drawn.y <= box.top + 0.01, (
                    resolved.key
                )

    def test_no_value_is_drawn_below_the_legible_minimum(self, generated):
        for drawn in generated.render_plan.draws:
            assert drawn.size >= MIN_FONT_SIZE, drawn.text

    def test_marks_are_centred_in_their_boxes(self, generated):
        definition = definition_for_form("TX_H1010")
        report = resolve_mappings(definition, AUSTIN_CANONICAL)

        for resolved in report.fields:
            if resolved.kind not in (FieldKind.CHECKBOX, FieldKind.CHOICE):
                continue

            box = resolved.box()
            plan = plan_render([resolved])

            assert len(plan.draws) == 1, resolved.key

            drawn = plan.draws[0]
            centre = box.x + box.width / 2

            # Within a point of the box's horizontal centre.
            assert abs((drawn.x + 2.9) - centre) < 2.0, resolved.key


# ---------------------------------------------------------------------------
# Safety
# ---------------------------------------------------------------------------


class TestSafety:
    def test_no_signature_or_ssn_reaches_the_page(self, pages):
        text = "\n".join(pages).lower()

        # The printed prompts exist; no *value* may.
        assert "123-45-6789" not in text
        assert "social security number" not in text

    def test_the_signature_area_is_present_but_empty(self, pages):
        text = "\n".join(pages)

        assert "Your signature" in text
        assert "We never fill in a signature" in text

    def test_a_sensitive_value_in_the_data_stops_generation(self):
        from benefits_navigator.formmap import SensitiveFieldRefused

        with pytest.raises(SensitiveFieldRefused):
            generate_form(
                "TX_H1010",
                {**AUSTIN_CANONICAL, "applicant.ssn": "123-45-6789"},
            )


# ---------------------------------------------------------------------------
# The review sheet
# ---------------------------------------------------------------------------


class TestReviewSheet:
    def test_lists_what_was_filled_in(self, generated):
        review = generated.review_text

        assert "Filled in for you:" in review
        assert "Marisol" in review
        assert "03/14/1991" in review

    def test_says_what_was_left_blank_on_purpose(self, generated):
        review = generated.review_text

        assert "Left blank on purpose:" in review
        assert "signature" in review.lower()
        assert "Social Security" in review

    def test_names_what_the_applicant_still_has_to_answer(self, generated):
        review = generated.review_text

        assert "Still yours to fill in:" in review
        # Not supplied by this household.
        assert "Other names you have used" in review

    def test_the_still_to_fill_list_is_grouped_so_labels_are_unambiguous(self):
        """Regression: a flat list repeated "City" with nothing to tell them apart.

        The home and mailing address sections share label wording, so an
        ungrouped list named "City", "County", "State" and "ZIP code" once each
        and the applicant could not tell which address was still blank.

        Built from a household that gets its mail elsewhere but has not given
        the address yet, which is the only way both blocks are outstanding at
        once — for everyone else the mailing block is not applicable rather
        than missing, which is a different heading and a different message.
        """
        partial = {
            key: value
            for key, value in AUSTIN_CANONICAL.items()
            if not key.startswith("applicant.home_address.")
        }
        partial["applicant.mailing_address_same_as_home"] = False

        review = generate_form("TX_H1010", partial).review_text
        remaining = review.split("Still yours to fill in:")[1]

        assert "  Where you live" in remaining
        assert "  Where you get your mail" in remaining

        # The mailing-address labels appear under their own section heading.
        mailing = remaining.split("  Where you get your mail")[1]

        # Not "County": a mailing county is optional, so it is listed under
        # the heading for answers a blank completes rather than this one.
        for label in ("City", "State", "ZIP code"):
            assert label in mailing, label

    def test_warns_that_this_is_not_the_official_form(self, generated):
        assert "THIS IS NOT THE OFFICIAL FORM." in generated.review_text

    def test_explains_why_there_is_no_official_document(self, generated):
        """Not "unavailable" — the actual reason, in the applicant's copy."""
        review = generated.review_text

        assert "YourTexasBenefits" in review
        assert "does not publish Form H1010 as a retrievable PDF" in review

    def test_groups_by_the_forms_own_sections(self, generated):
        review = generated.review_text

        for section in ("About you", "Where you live", "Money you get"):
            assert section in review


# ---------------------------------------------------------------------------
# Writing to disk
# ---------------------------------------------------------------------------


class TestWriting:
    def test_writes_the_pdf_and_its_review_sheet(self, generated, tmp_path):
        target = tmp_path / "h1010.pdf"
        written = generated.write(target)

        assert written == target
        assert target.exists()

        review = target.with_suffix(".review.txt")

        assert review.exists()
        assert "H1010" in review.read_text(encoding="utf-8")

    def test_filename_names_the_form_and_place_but_never_the_applicant(self):
        from datetime import datetime, timezone

        name = output_filename(
            "TX_H1010",
            zip_code="78705",
            now=datetime(2026, 8, 28, 12, 0, 0, tzinfo=timezone.utc),
        )

        assert name == "worksheet-tx-h1010-78705-20260828-120000.pdf"
        assert "ramirez" not in name.lower()

    def test_a_form_with_an_official_template_is_named_official(self):
        from datetime import datetime, timezone

        name = output_filename(
            "CA_SAWS_2_PLUS",
            zip_code="90001",
            now=datetime(2026, 8, 28, 12, 0, 0, tzinfo=timezone.utc),
        )

        assert name.startswith("official-ca-saws-2-plus-")


# ---------------------------------------------------------------------------
# Rendering defects, each found by generating and reading back
# ---------------------------------------------------------------------------


class TestRenderingRegressions:
    def test_a_choice_draws_a_mark_not_its_option_key(self):
        """Regression: "yes" was drawn as the glyph and never fit a 10pt box.

        ``resolved.rendered`` for a CHOICE is the option key, whose only job is
        to pick which box the mark goes in. Drawing it put the word "yes" inside
        a checkbox; it did not fit, so all three yes/no questions were reported
        as unfitted and silently left blank.
        """
        definition = definition_for_form("TX_H1010")
        report = resolve_mappings(definition, {"household.homeless": True})
        plan = plan_render(report.fields)

        assert plan.unfitted == []
        assert [drawn.text for drawn in plan.draws] == ["X"]

    def test_the_content_stream_encodes_winansi_not_latin1(self):
        """Regression: the em dash became "?" on every page.

        The font resource declares WinAnsiEncoding, which has an em dash at
        0x97. Encoding the stream as latin-1 instead replaced it — and every
        other WinAnsi-only character — with "?".
        """
        from benefits_navigator.formmap.render import DrawnText

        stream = content_stream(
            [DrawnText(page=1, x=10, y=10, size=10, text="H1010 — Texas")]
        )

        assert b"?" not in stream
        assert stream.decode("cp1252").count("—") == 1

    def test_the_em_dash_survives_into_the_document(self, pages):
        assert "Form H1010 — Texas Works Application for Assistance" in pages[0]

    def test_no_section_heading_is_orphaned_from_its_fields(self, generated):
        """Regression: "Money you get" printed with both its boxes overleaf.

        A section reserved room for its heading only, so the heading could sit
        at the bottom of a page and its first field break to the next.
        """
        definition = definition_for_form("TX_H1010")

        pages_of: dict[str, set[int]] = {}

        for mapping in definition.fields:
            for box in mapping.target.boxes():
                pages_of.setdefault(mapping.section, set()).add(box.page)

        from benefits_navigator.formmap.forms.h1010 import H1010_STATIC_TEXT

        headings = {
            item.text: item.page
            for item in H1010_STATIC_TEXT
            if item.text in definition.sections()
        }

        for section, heading_page in headings.items():
            assert heading_page in pages_of[section], (
                f"{section!r} heading is on page {heading_page} but its fields "
                f"are on {sorted(pages_of[section])}"
            )

    def test_a_tall_row_does_not_walk_the_cursor_back_up_the_page(self):
        """Regression: a fixed row pitch went negative for a tall row.

        The multiline "Benefits anyone already gets" box is double height.
        Subtracting it from a fixed 30pt pitch moved the cursor *up*, so the
        next label printed on top of the box just placed.
        """
        definition = definition_for_form("TX_H1010")

        multiline = definition.mapping_for("household.existing_benefits")
        military = definition.mapping_for("household.military_service")

        multiline_box = multiline.target.box
        military_box = next(iter(military.target.option_boxes.values()))

        if multiline_box.page == military_box.page:
            # The multiline field is declared after the military question, so it
            # must sit strictly below it.
            assert multiline_box.top < military_box.y

    def test_the_empty_box_glyph_is_exactly_the_checkbox_width(self):
        """Regression: an 11pt "[  ]" was drawn under a 10pt mark box.

        The bracket glyph was 13.4pt wide while the mark box was 10pt, so the
        "X" sat left of centre and the caption printed against the bracket.
        """
        from benefits_navigator.formmap.forms.h1010 import (
            _CHECKBOX_SIDE,
            _EMPTY_BOX_GLYPH,
            H1010_STATIC_TEXT,
        )
        from benefits_navigator.formmap.textfit import helvetica_width

        boxes = [
            item for item in H1010_STATIC_TEXT if item.text == _EMPTY_BOX_GLYPH
        ]

        assert boxes, "no empty checkbox glyphs were emitted"

        for item in boxes:
            width = helvetica_width(_EMPTY_BOX_GLYPH, item.size)

            assert abs(width - _CHECKBOX_SIDE) < 0.01

    def test_no_checkbox_caption_overlaps_its_box(self):
        from benefits_navigator.formmap.forms.h1010 import (
            _CHECKBOX_SIDE,
            _EMPTY_BOX_GLYPH,
            H1010_STATIC_TEXT,
        )

        by_page: dict[int, list] = {}

        for item in H1010_STATIC_TEXT:
            by_page.setdefault(item.page, []).append(item)

        for items in by_page.values():
            boxes = [i for i in items if i.text == _EMPTY_BOX_GLYPH]

            for box in boxes:
                for other in items:
                    if other is box or other.text == _EMPTY_BOX_GLYPH:
                        continue

                    # Same line, to the right of the box.
                    if abs(other.y - box.y) > 2.0 or other.x < box.x:
                        continue

                    assert other.x >= box.x + _CHECKBOX_SIDE, other.text


# ---------------------------------------------------------------------------
# The writer
# ---------------------------------------------------------------------------


class TestSimplePdf:
    def test_takes_its_page_size_from_the_caller(self):
        import io

        pdf = SimplePdf(width=595.0, height=842.0)
        pdf.add_page(b"")

        reader = pypdf.PdfReader(io.BytesIO(pdf.to_bytes()))

        assert float(reader.pages[0].mediabox.width) == 595.0

    def test_escapes_pdf_syntax_in_a_value(self):
        """An unescaped bracket truncates the string operator."""
        from benefits_navigator.formmap.render import DrawnText

        stream = content_stream(
            [DrawnText(page=1, x=0, y=0, size=10, text="Smith (Jr) \\ Co")]
        )

        assert b"\\(Jr\\)" in stream
        assert b"\\\\" in stream

    def test_an_apostrophe_in_a_name_survives(self):
        import io

        definition = FormDefinition(
            form_id="XX_TEST",
            form_code="TEST",
            title="Test",
            state="XX",
            document_language="en",
            base_document_note="test fixture",
            fields=(
                FieldMapping(
                    key="applicant.last_name",
                    kind=FieldKind.TEXT,
                    printed_label="Last name",
                    target=OverlayTarget(
                        box=Box(page=1, x=50, y=700, width=300, height=16)
                    ),
                ),
            ),
        )

        report = resolve_mappings(definition, {"applicant.last_name": "O'Brien"})
        plan = plan_render(report.fields)

        pdf = SimplePdf()
        pdf.add_page(content_stream(plan.draws))

        text = pypdf.PdfReader(io.BytesIO(pdf.to_bytes())).pages[0].extract_text()

        assert "O'Brien" in text
