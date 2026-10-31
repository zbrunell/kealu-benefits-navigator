#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The mapping layer's shared primitives, tested without any form.

Everything here is about the *architecture*, not about Texas or California, and
that is deliberate: these are the guarantees form #3 inherits for free, so they
are asserted against definitions built in the test rather than against H1010.
A guarantee only ever exercised through one form is a guarantee about that
form.

Four primitives, each of which exists because a form needed it and none of which
knows which form that was:

``Condition``
    A gateway answer that makes a printed box inapplicable rather than missing.

``RepeatingGroup``
    A printed table drawn from a canonical indexed collection.

``alternate_keys``
    One printed box, several canonical homes.

``optional``
    A box a blank answer completes.
"""

from __future__ import annotations

import pytest

from benefits_navigator.formmap import (
    AcroFormTarget,
    Box,
    Condition,
    FieldKind,
    FieldMapping,
    FormDefinition,
    OverlayTarget,
    RepeatingGroup,
    resolve_mappings,
)


def _text(key: str, **kwargs) -> FieldMapping:
    return FieldMapping(
        key=key,
        kind=FieldKind.TEXT,
        printed_label=kwargs.pop("printed_label", key),
        target=AcroFormTarget(name=f"field_{key}"),
        **kwargs,
    )


def _form(*fields: FieldMapping, groups: tuple[RepeatingGroup, ...] = ()) -> FormDefinition:
    return FormDefinition(
        form_id="XX_TEST",
        form_code="TEST",
        title="A form that is not any real form",
        state="XX",
        document_language="en",
        fields=fields,
        repeating_groups=groups,
    )


# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------


class TestCondition:
    @pytest.fixture
    def gated(self):
        return _form(
            _text(
                "applicant.mailing_address.street",
                printed_label="Mailing street address",
                applies_when=Condition(
                    key="applicant.mailing_address_same_as_home",
                    equals=False,
                    because="you get your mail where you live",
                ),
            )
        )

    def test_a_disagreeing_gateway_makes_the_field_not_applicable(self, gated):
        report = resolve_mappings(
            gated,
            {
                "applicant.mailing_address_same_as_home": True,
                "applicant.mailing_address.street": "PO Box 1",
            },
        )

        assert report.rendered_values() == {}
        assert report.skipped == []
        assert report.not_applicable_keys() == (
            "applicant.mailing_address.street",
        )

    def test_the_reason_is_carried_for_the_applicant_to_read(self, gated):
        report = resolve_mappings(
            gated, {"applicant.mailing_address_same_as_home": True}
        )

        assert report.not_applicable[0].reason == (
            "you get your mail where you live"
        )
        assert report.not_applicable[0].printed_label == "Mailing street address"

    def test_an_agreeing_gateway_lets_the_value_through(self, gated):
        report = resolve_mappings(
            gated,
            {
                "applicant.mailing_address_same_as_home": False,
                "applicant.mailing_address.street": "PO Box 1",
            },
        )

        assert report.rendered_values() == {
            "applicant.mailing_address.street": "PO Box 1"
        }

    def test_an_unanswered_gateway_never_discards_an_answer(self, gated):
        """The three-state rule, and the reason `equals` is not enough.

        An applicant who typed a mailing address and never answered the Yes/No
        has still told us their mailing address. Suppressing it would delete an
        answer on the strength of a question nobody asked.
        """
        report = resolve_mappings(
            gated, {"applicant.mailing_address.street": "PO Box 1"}
        )

        assert report.rendered_values() == {
            "applicant.mailing_address.street": "PO Box 1"
        }

    def test_unknown_excludes_flips_that_for_a_presence_marker(self):
        """A printed row exists because a person does, not by default."""
        form = _form(
            _text(
                "household.members.3.first_name",
                applies_when=Condition(
                    key="household.members.3.present",
                    because="there is no person 4",
                    unknown_excludes=True,
                ),
            )
        )

        report = resolve_mappings(form, {})

        assert report.skipped == []
        assert report.not_applicable_keys() == ("household.members.3.first_name",)

    def test_a_gateway_key_is_not_reported_as_having_nowhere_to_go(self, gated):
        """The form reads the gateway; it just does not print it here."""
        report = resolve_mappings(
            gated, {"applicant.mailing_address_same_as_home": True}
        )

        assert report.unmapped == []


# ---------------------------------------------------------------------------
# Repeating groups
# ---------------------------------------------------------------------------


class TestRepeatingGroup:
    @pytest.fixture
    def people(self):
        return RepeatingGroup(prefix="household.members", rows=3, row_noun="Person")

    def test_builds_the_canonical_key_for_a_row(self, people):
        assert people.key(0, "first_name") == "household.members.0.first_name"
        assert people.key(2, "date_of_birth") == "household.members.2.date_of_birth"

    def test_refuses_a_row_the_printed_table_does_not_have(self, people):
        with pytest.raises(IndexError, match="3 printed rows"):
            people.key(3, "first_name")

    def test_labels_rows_the_way_a_person_counts_them(self, people):
        assert people.label(0, "First name") == "Person 1 — First name"

    def test_presence_reads_the_marker_the_field_plan_emits(self, people):
        condition = people.presence(1)

        assert condition.key == "household.members.1.present"
        assert condition.unknown_excludes is True

    def test_occupants_are_the_rows_with_a_marker(self, people):
        values = {
            "household.members.0.present": True,
            "household.members.2.present": True,
        }

        assert people.occupants(values) == (0, 2)

    def test_a_half_typed_row_still_counts_as_occupied(self, people):
        """Presence is stated, never inferred from a non-empty name."""
        values = {"household.members.0.present": True}

        assert people.occupants(values) == (0,)

    def test_counts_the_subjects_the_printed_table_cannot_hold(self, people):
        values = {
            f"household.members.{index}.present": True for index in range(5)
        }

        assert people.overflow_beyond(values) == 2

    def test_a_table_needs_at_least_one_row(self):
        with pytest.raises(ValueError, match="at least one row"):
            RepeatingGroup(prefix="household.members", rows=0)

    def test_rows_do_not_drift(self, people):
        """Row 2's value lands in row 2's box, and only there."""
        form = _form(
            *[
                _text(
                    people.key(index, "first_name"),
                    printed_label=people.label(index, "First name"),
                    applies_when=people.presence(index),
                    row=(people.prefix, index),
                )
                for index in people.indexes()
            ],
            groups=(people,),
        )

        report = resolve_mappings(
            form,
            {
                "household.members.0.present": True,
                "household.members.0.first_name": "Diego",
                "household.members.2.present": True,
                "household.members.2.first_name": "Mateo",
            },
        )

        assert report.rendered_values() == {
            "household.members.0.first_name": "Diego",
            "household.members.2.first_name": "Mateo",
        }
        assert report.rows_filled("household.members") == (0, 2)
        assert report.not_applicable_keys() == (
            "household.members.1.first_name",
        )

    def test_overflow_is_reported_by_resolution(self, people):
        form = _form(
            _text(
                people.key(0, "first_name"),
                applies_when=people.presence(0),
                row=(people.prefix, 0),
            ),
            groups=(people,),
        )

        report = resolve_mappings(
            form,
            {f"household.members.{index}.present": True for index in range(5)},
        )

        assert report.overflow == {"household.members": 2}


# ---------------------------------------------------------------------------
# Alternate keys
# ---------------------------------------------------------------------------


class TestAlternateKeys:
    @pytest.fixture
    def form(self):
        return _form(
            _text(
                "household.members.0.adult.sex",
                printed_label="Sex",
                alternate_keys=("household.members.0.child.sex",),
                transform="humanize",
            )
        )

    def test_the_primary_key_answers_when_it_has_a_value(self, form):
        report = resolve_mappings(
            form, {"household.members.0.adult.sex": "female"}
        )

        assert report.rendered_values() == {
            "household.members.0.adult.sex": "Female"
        }
        assert report.fields[0].source_key == "household.members.0.adult.sex"

    def test_an_alternate_answers_when_the_primary_is_absent(self, form):
        report = resolve_mappings(
            form, {"household.members.0.child.sex": "male"}
        )

        assert report.fields[0].rendered == "Male"
        assert report.fields[0].source_key == "household.members.0.child.sex"

    def test_a_blank_primary_does_not_shadow_a_populated_alternate(self, form):
        """The bug this exists to prevent: an adult record with no sex on it
        sitting in front of the child record that has one."""
        report = resolve_mappings(
            form,
            {
                "household.members.0.adult.sex": "",
                "household.members.0.child.sex": "male",
            },
        )

        assert report.fields[0].rendered == "Male"

    def test_a_value_that_arrived_by_an_alternate_is_not_unmapped(self, form):
        report = resolve_mappings(
            form, {"household.members.0.child.sex": "male"}
        )

        assert report.unmapped == []

    def test_an_alternate_is_checked_for_sensitivity_too(self):
        from benefits_navigator.formmap import SensitiveFieldRefused

        with pytest.raises(SensitiveFieldRefused, match="ssn"):
            FieldMapping(
                key="applicant.first_name",
                kind=FieldKind.TEXT,
                alternate_keys=("applicant.ssn",),
                target=AcroFormTarget(name="Text1"),
            )

    def test_two_mappings_cannot_claim_the_same_alternate(self):
        from benefits_navigator.formmap import FormDefinitionError

        with pytest.raises(FormDefinitionError, match="duplicate"):
            _form(
                _text("a.one", alternate_keys=("shared.key",)),
                _text("a.two", alternate_keys=("shared.key",)),
            )


# ---------------------------------------------------------------------------
# Optional fields
# ---------------------------------------------------------------------------


class TestOptionalFields:
    def test_an_optional_field_is_still_reported_as_blank(self):
        form = _form(_text("applicant.middle_name", optional=True))

        report = resolve_mappings(form, {})

        assert report.skipped == ["applicant.middle_name"]

    def test_optional_is_a_property_of_the_mapping_not_of_the_report(self):
        """The report says what is blank; the definition says what that means.

        Kept apart so the review sheet decides how to phrase it and resolution
        stays a pure statement of fact.
        """
        form = _form(_text("applicant.middle_name", optional=True))

        assert form.mapping_for("applicant.middle_name").optional is True


# ---------------------------------------------------------------------------
# The overlay geometry these primitives feed
# ---------------------------------------------------------------------------


class TestOverlayValidation:
    def test_a_choice_needs_option_boxes(self):
        from benefits_navigator.formmap import FormDefinitionError

        with pytest.raises(FormDefinitionError, match="option_boxes"):
            FieldMapping(
                key="household.homeless",
                kind=FieldKind.CHOICE,
                target=OverlayTarget(box=Box(page=1, x=0, y=0, width=10, height=10)),
            )

    def test_a_text_overlay_needs_a_box(self):
        from benefits_navigator.formmap import FormDefinitionError

        with pytest.raises(FormDefinitionError, match="needs a box"):
            FieldMapping(
                key="applicant.first_name",
                kind=FieldKind.TEXT,
                target=OverlayTarget(),
            )
