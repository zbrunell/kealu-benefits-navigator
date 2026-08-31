#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Does the right value reach the right place on the form?

Every test here runs without opening a PDF. That is the point: verifying a
mapping by generating a document and looking at it does not scale past a handful
of fields, and it cannot distinguish "the value is missing" from "the value is
in the wrong box" without a human reading the page.

``resolve_mappings`` answers both questions in memory — which canonical key went
where, and exactly what string will be drawn — so a wrong destination or a wrong
format is a failing assertion rather than something noticed later on paper.

The PDF-touching tests live in ``test_formmap_generation.py`` and are
deliberately few.
"""

from __future__ import annotations

import pytest

from benefits_navigator.formmap import (
    AcroFormTarget,
    Box,
    FieldKind,
    FieldMapping,
    FormDefinition,
    FormDefinitionError,
    OverlayTarget,
    SensitiveFieldRefused,
    definition_for_form,
    definitions,
    known_form_ids,
    registered_transforms,
    resolve_mappings,
    transform_for,
    validate_definition,
)
from benefits_navigator.formmap.registry import UnknownForm

# ---------------------------------------------------------------------------
# Sample canonical data
# ---------------------------------------------------------------------------

#: An Austin household, using only canonical keys the TypeScript field plan
#: already emits (see web/src/lib/application-mapper.ts). Nothing here is a new
#: key invented for this layer.
AUSTIN_CANONICAL: dict[str, object] = {
    "programs.tx_snap": True,
    "programs.tx_medicaid": True,
    "applicant.first_name": "Marisol",
    "applicant.middle_name": "Elena",
    "applicant.last_name": "Ramirez",
    "applicant.date_of_birth": "1991-03-14",
    "applicant.phone": "5125551234",
    "applicant.email": "marisol.ramirez@example.com",
    "applicant.preferred_language": "Spanish",
    "applicant.home_address.street": "2100 Nueces Street",
    "applicant.home_address.apartment": "Apt 4B",
    "applicant.home_address.city": "Austin",
    "applicant.home_address.county": "Travis",
    "applicant.home_address.state": "tx",
    "applicant.home_address.zip_code": "78705-1234",
    "applicant.mailing_address_same_as_home": True,
    "household.size": 2,
    "household.adult_rows.count": 2,
    "household.child_rows.count": 0,
    "household.homeless": False,
    "household.anyone_pregnant": False,
    "household.buys_and_prepares_food_together": True,
    "household.military_service": False,
    "household.annual_income": 20000,
    "household.income_type": "W-2 employee",
    "household.existing_benefits": "None",
}


@pytest.fixture
def h1010():
    return definition_for_form("TX_H1010")


@pytest.fixture
def resolved(h1010):
    return resolve_mappings(h1010, AUSTIN_CANONICAL)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_knows_both_supported_forms(self):
        assert known_form_ids() == ("CA_SAWS_2_PLUS", "TX_H1010")

    def test_form_ids_match_the_typescript_form_ids(self):
        """The two layers must agree on the id, or selection silently fails."""
        typescript_ids = {"CA_SAWS_2_PLUS", "TX_H1010"}

        assert set(known_form_ids()) == typescript_ids

    def test_unknown_form_raises_rather_than_returning_none(self):
        with pytest.raises(UnknownForm, match="ND_SOMETHING"):
            definition_for_form("ND_SOMETHING")

    def test_every_definition_is_internally_valid(self):
        for definition in definitions():
            assert validate_definition(definition) == (), definition.form_id

    def test_no_definition_maps_a_sensitive_key(self):
        for definition in definitions():
            for key in definition.keys():
                assert "ssn" not in key.lower(), definition.form_id
                assert "signature" not in key.lower(), definition.form_id

    def test_definitions_are_cached(self):
        assert definition_for_form("TX_H1010") is definition_for_form("TX_H1010")


# ---------------------------------------------------------------------------
# H1010 mapping
# ---------------------------------------------------------------------------


class TestH1010Definition:
    def test_identifies_itself_as_the_texas_form(self, h1010):
        assert h1010.form_id == "TX_H1010"
        assert h1010.form_code == "H1010"
        assert h1010.state == "TX"

    def test_is_letter_sized(self, h1010):
        assert (h1010.page_width, h1010.page_height) == (612.0, 792.0)

    def test_uses_coordinate_overlay_because_we_hold_no_official_pdf(self, h1010):
        assert h1010.is_overlay is True
        assert h1010.has_official_base_document is False
        # The reason must be recorded, not left as tribal knowledge: HHSC's own
        # forms page links to a web application rather than to a document.
        assert "YourTexasBenefits" in h1010.base_document_note

    def test_every_field_is_an_overlay_target_with_a_real_box(self, h1010):
        for mapping in h1010.fields:
            assert isinstance(mapping.target, OverlayTarget), mapping.key

            for box in mapping.target.boxes():
                assert box.width > 0 and box.height > 0, mapping.key
                assert 1 <= box.page <= h1010.page_count, mapping.key

    def test_no_box_extends_past_the_page(self, h1010):
        # FormDefinition's constructor enforces this; asserted here so the
        # guarantee is visible rather than implicit.
        for mapping in h1010.fields:
            for box in mapping.target.boxes():
                assert box.right <= h1010.page_width + 0.01, mapping.key
                assert box.top <= h1010.page_height + 0.01, mapping.key

    def test_no_two_fields_overlap_on_the_same_page(self, h1010):
        """Two values in one place is a silently unreadable document."""
        placed: list[tuple[str, Box]] = [
            (mapping.key, box)
            for mapping in h1010.fields
            for box in mapping.target.boxes()
        ]

        for index, (key_a, box_a) in enumerate(placed):
            for key_b, box_b in placed[index + 1 :]:
                if box_a.page != box_b.page:
                    continue

                overlaps = (
                    box_a.x < box_b.right
                    and box_b.x < box_a.right
                    and box_a.y < box_b.top
                    and box_b.y < box_a.top
                )

                assert not overlaps, f"{key_a} overlaps {key_b}"

    def test_declares_the_sections_the_printed_form_uses(self, h1010):
        assert h1010.sections() == (
            "What are you applying for?",
            "About you",
            "Where you live",
            "Where you get your mail",
            "People who live with you",
            "Money you get",
            "Jobs",
            "Other money you get",
            "Bills you pay",
            "Things you own",
            "If you need food benefits right away",
            "Your situation",
            "Someone helping you apply",
        )

    def test_every_field_names_its_printed_question(self, h1010):
        for mapping in h1010.fields:
            assert mapping.printed_label, mapping.key

    def test_maps_the_four_texas_programs(self, h1010):
        for program in ("tx_snap", "tx_medicaid", "tx_chip", "tx_tanf"):
            mapping = h1010.mapping_for(f"programs.{program}")

            assert mapping is not None, program
            assert mapping.kind is FieldKind.CHECKBOX

    def test_has_no_field_for_a_california_only_answer(self, h1010):
        """H1010 has no California residency box, and must not invent one."""
        assert h1010.mapping_for("household.california_resident") is None


class TestH1010Resolution:
    def test_fills_every_supplied_answer_it_has_a_box_for(self, resolved):
        assert len(resolved.fields) == 26

    def test_reports_a_california_key_as_unmapped_rather_than_rendering_it(
        self, h1010
    ):
        report = resolve_mappings(
            h1010, {**AUSTIN_CANONICAL, "household.california_resident": True}
        )

        assert "household.california_resident" in report.unmapped
        assert "household.california_resident" not in report.rendered_values()

    def test_names_what_the_applicant_still_has_to_fill_in(self, resolved):
        # Not supplied by the Austin household, so the form leaves them blank
        # and the review sheet has to say so.
        assert "applicant.other_names" in resolved.skipped
        assert "applicant.household.marital_status" in resolved.skipped

    def test_a_gateway_answer_excludes_rather_than_skips(self, resolved):
        """The mailing block is not missing; it does not apply.

        This household gets its mail at home, so the six mailing boxes are
        finished work. Reporting them as still to fill in would send the
        applicant looking for a question they were right to leave alone.
        """
        assert "applicant.mailing_address.street" not in resolved.skipped
        assert "applicant.mailing_address.street" in resolved.not_applicable_keys()

        reason = next(
            item.reason
            for item in resolved.not_applicable
            if item.key == "applicant.mailing_address.street"
        )

        assert "mail at the address where you live" in reason

    @pytest.mark.parametrize(
        "key,expected",
        [
            # The transform each field declares, proven on real values.
            ("applicant.date_of_birth", "03/14/1991"),
            ("applicant.phone", "(512) 555-1234"),
            ("applicant.home_address.state", "TX"),
            ("applicant.home_address.zip_code", "78705"),
            ("household.annual_income", "20,000"),
            ("household.size", "2"),
            ("household.child_rows.count", "0"),
            ("applicant.first_name", "Marisol"),
            ("applicant.home_address.street", "2100 Nueces Street"),
        ],
    )
    def test_renders_the_value_the_form_asks_for(self, resolved, key, expected):
        assert resolved.rendered_values()[key] == expected

    def test_zip_plus_four_is_trimmed_to_the_five_the_box_holds(self, resolved):
        assert resolved.rendered_values()["applicant.home_address.zip_code"] == "78705"

    def test_a_checked_program_marks_its_box(self, resolved):
        rendered = resolved.rendered_values()

        assert rendered["programs.tx_snap"] == "X"
        assert rendered["programs.tx_medicaid"] == "X"

    def test_an_unselected_program_leaves_its_box_alone(self, resolved):
        """A form this project produces never answers for the applicant."""
        assert "programs.tx_chip" not in resolved.rendered_values()
        assert "programs.tx_tanf" in resolved.skipped

    def test_a_false_checkbox_is_not_marked(self, h1010):
        report = resolve_mappings(h1010, {"programs.tx_snap": False})

        assert "programs.tx_snap" in report.skipped
        assert report.fields == []

    def test_yes_and_no_select_different_boxes(self, resolved, h1010):
        by_key = resolved.by_key()

        yes_field = by_key["applicant.mailing_address_same_as_home"]
        no_field = by_key["household.homeless"]

        assert yes_field.rendered == "yes"
        assert no_field.rendered == "no"

        mapping = h1010.mapping_for("household.homeless")
        options = mapping.target.option_boxes

        assert no_field.box() == options["no"]
        assert no_field.box() != options["yes"]

    def test_an_unanswered_yes_no_marks_neither_box(self, h1010):
        """The reason a yes/no pair is one CHOICE and not two checkboxes."""
        report = resolve_mappings(h1010, {"household.homeless": None})

        assert "household.homeless" in report.skipped
        assert report.fields == []

    def test_a_multiline_answer_keeps_its_multiline_target(self, h1010):
        mapping = h1010.mapping_for("household.existing_benefits")

        assert mapping.kind is FieldKind.MULTILINE
        assert mapping.target.multiline is True
        # Tall enough for more than one line, or wrapping is pointless.
        assert mapping.target.box.height > 16.0


# ---------------------------------------------------------------------------
# The safety boundary
# ---------------------------------------------------------------------------


class TestSensitiveFields:
    @pytest.mark.parametrize(
        "key",
        [
            "applicant.ssn",
            "applicant.social_security_number",
            "applicant.signature",
            "applicant.alien_number",
            "household.member.0.immigration_document_number",
            "applicant.bank_account_number",
            "applicant.drivers_license",
        ],
    )
    def test_a_sensitive_key_cannot_be_declared_in_a_definition(self, key):
        with pytest.raises(SensitiveFieldRefused):
            FieldMapping(
                key=key,
                kind=FieldKind.TEXT,
                target=AcroFormTarget(name="Text1"),
            )

    def test_a_sensitive_key_in_the_data_is_refused_not_filtered(self, h1010):
        """A raise, so it cannot be quietly dropped and forgotten."""
        with pytest.raises(SensitiveFieldRefused, match="ssn"):
            resolve_mappings(h1010, {"applicant.ssn": "123-45-6789"})

    def test_h1010_has_no_signature_field_at_all(self, h1010):
        """Structural, not filtered: there is nowhere for a signature to go."""
        for mapping in h1010.fields:
            assert "signature" not in mapping.key.lower()


# ---------------------------------------------------------------------------
# Transforms
# ---------------------------------------------------------------------------


class TestTransforms:
    def test_every_transform_a_definition_names_exists(self):
        available = set(registered_transforms())

        for definition in definitions():
            for mapping in definition.fields:
                if mapping.transform is not None:
                    assert mapping.transform in available, mapping.key

    def test_an_unknown_transform_name_raises(self):
        with pytest.raises(KeyError, match="not_a_transform"):
            transform_for("not_a_transform")

    @pytest.mark.parametrize(
        "name,value,expected",
        [
            ("us_date", "1991-03-14", "03/14/1991"),
            # Unparseable input passes through rather than being dropped.
            ("us_date", "March 1991", "March 1991"),
            ("us_date", "", ""),
            ("us_phone", "5125551234", "(512) 555-1234"),
            ("us_phone", "15125551234", "(512) 555-1234"),
            ("us_phone", "512-555-1234", "(512) 555-1234"),
            ("us_phone", "555", "555"),
            ("zip5", "78705-1234", "78705"),
            ("zip5", "78705", "78705"),
            ("state_code", "tx", "TX"),
            ("state_code", "texas", "TE"),
            ("integer", 2, "2"),
            ("integer", 0, "0"),
            ("integer", "3.0", "3"),
            ("currency_whole", 20000, "20,000"),
            ("currency_whole", "20000.49", "20,000"),
            ("currency_whole", "$1,200", "1,200"),
            ("yes_no", True, "yes"),
            ("yes_no", False, "no"),
            ("yes_no", None, ""),
            ("upper", "austin", "AUSTIN"),
            ("digits", "(512) 555-1234", "5125551234"),
        ],
    )
    def test_transform(self, name, value, expected):
        assert transform_for(name)(value) == expected

    def test_a_boolean_never_renders_as_text(self):
        """"True" printed in a name box would be worse than a blank one."""
        assert transform_for("plain")(True) == ""
        assert transform_for("integer")(True) == ""

    def test_transform_output_does_not_change_with_the_ui_locale(
        self, monkeypatch
    ):
        """A form is printed in the agency's language, not the applicant's.

        Guarded because the temptation is real: a Spanish-speaking applicant
        filing the English H1010 still needs 03/14/1991 and 20,000 in the boxes,
        because that is what the English form's printed labels ask for. A
        transform that consulted the environment would render 14/03/1991 or
        20.000 for that applicant and quietly produce a form the agency reads
        wrong.

        Asserted behaviourally rather than by grepping the source — an earlier
        version of this test searched for the string "locale" and failed on the
        docstring explaining that locales are not read.
        """
        cases = [
            ("us_date", "1991-03-14"),
            ("currency_whole", 20000),
            ("us_phone", "5125551234"),
            ("integer", 2),
        ]

        baseline = {name: transform_for(name)(value) for name, value in cases}

        for locale_value in ("es_ES.UTF-8", "de_DE.UTF-8", "zh_CN.UTF-8"):
            for variable in ("LANG", "LC_ALL", "LC_TIME", "LC_NUMERIC"):
                monkeypatch.setenv(variable, locale_value)

            for name, value in cases:
                assert transform_for(name)(value) == baseline[name], (
                    name,
                    locale_value,
                )

    def test_transforms_import_nothing_locale_aware(self):
        """The import list is the part a grep can check honestly."""
        import inspect

        from benefits_navigator.formmap import transforms

        imports = [
            line
            for line in inspect.getsource(transforms).splitlines()
            if line.startswith(("import ", "from "))
        ]

        for line in imports:
            for forbidden in ("locale", "gettext", "babel"):
                assert forbidden not in line, line


# ---------------------------------------------------------------------------
# The definition model itself
# ---------------------------------------------------------------------------


class TestDefinitionModel:
    def test_a_duplicate_canonical_key_is_rejected(self):
        mapping = FieldMapping(
            key="applicant.first_name",
            kind=FieldKind.TEXT,
            printed_label="First name",
            target=AcroFormTarget(name="Text1"),
        )

        with pytest.raises(FormDefinitionError, match="duplicate"):
            FormDefinition(
                form_id="XX_TEST",
                form_code="TEST",
                title="Test",
                state="XX",
                document_language="en",
                fields=(mapping, mapping),
            )

    def test_a_box_off_the_page_is_rejected(self):
        with pytest.raises(FormDefinitionError, match="past the"):
            FormDefinition(
                form_id="XX_TEST",
                form_code="TEST",
                title="Test",
                state="XX",
                document_language="en",
                page_count=1,
                fields=(
                    FieldMapping(
                        key="applicant.first_name",
                        kind=FieldKind.TEXT,
                        printed_label="First name",
                        target=OverlayTarget(
                            box=Box(page=1, x=600, y=10, width=100, height=12)
                        ),
                    ),
                ),
            )

    def test_a_box_on_a_page_the_form_does_not_have_is_rejected(self):
        with pytest.raises(FormDefinitionError, match="page 5"):
            FormDefinition(
                form_id="XX_TEST",
                form_code="TEST",
                title="Test",
                state="XX",
                document_language="en",
                page_count=2,
                fields=(
                    FieldMapping(
                        key="applicant.first_name",
                        kind=FieldKind.TEXT,
                        printed_label="First name",
                        target=OverlayTarget(
                            box=Box(page=5, x=10, y=10, width=100, height=12)
                        ),
                    ),
                ),
            )

    def test_a_choice_without_option_boxes_is_rejected(self):
        with pytest.raises(FormDefinitionError, match="option_boxes"):
            FieldMapping(
                key="household.homeless",
                kind=FieldKind.CHOICE,
                printed_label="Homeless?",
                target=OverlayTarget(box=Box(page=1, x=10, y=10, width=10, height=10)),
            )

    def test_a_text_overlay_without_a_box_is_rejected(self):
        with pytest.raises(FormDefinitionError, match="needs a box"):
            FieldMapping(
                key="applicant.first_name",
                kind=FieldKind.TEXT,
                printed_label="First name",
                target=OverlayTarget(),
            )

    def test_a_zero_sized_box_is_rejected(self):
        with pytest.raises(ValueError, match="non-positive"):
            Box(page=1, x=10, y=10, width=0, height=12)

    def test_page_numbers_are_one_based(self):
        with pytest.raises(ValueError, match="1-based"):
            Box(page=0, x=10, y=10, width=10, height=10)

    def test_a_choice_value_with_no_option_on_the_form_raises(self):
        definition = FormDefinition(
            form_id="XX_TEST",
            form_code="TEST",
            title="Test",
            state="XX",
            document_language="en",
            fields=(
                FieldMapping(
                    key="household.homeless",
                    kind=FieldKind.CHOICE,
                    printed_label="Homeless?",
                    target=OverlayTarget(
                        option_boxes={
                            "yes": Box(page=1, x=10, y=10, width=10, height=10),
                            "no": Box(page=1, x=30, y=10, width=10, height=10),
                        }
                    ),
                ),
            ),
        )

        with pytest.raises(FormDefinitionError, match="no option on the form"):
            resolve_mappings(definition, {"household.homeless": "maybe"})
