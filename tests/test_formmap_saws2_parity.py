#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""California must not be disturbed by the new mapping layer.

Two separate promises, and they are worth stating apart because only one of them
is about the abstraction:

**Generation is untouched.** ``pdf_generator.generate_saws2_plus_pdf`` and
``Saws2PlusFieldAdapter`` still produce the California draft. They were built
against the real 1,444-field AcroForm with every destination reviewed against
the printed pages, and they carry a write allowlist. The mapping layer does not
generate SAWS 2 PLUS and must never start doing so by accident — asserted here.

**The description cannot drift.** ``formmap.forms.saws2_plus`` reads the
adapter's own tables at import time rather than retyping 276 destinations, so a
correction to the adapter reaches the description automatically. These tests
assert that derivation actually holds, because the failure mode of a duplicated
mapping table is silent: it keeps passing its own tests while disagreeing with
the generator.

The California behaviour tests proper are unchanged and live where they always
did (``test_saws2_plus_*.py``, 17 scenarios plus text fitting). Nothing here
duplicates them.
"""

from __future__ import annotations

import pytest

from benefits_navigator.formmap import (
    AcroFormTarget,
    FieldKind,
    OverlayTarget,
    definition_for_form,
    resolve_mappings,
)
from benefits_navigator.pdf_generator import Saws2PlusFieldAdapter


@pytest.fixture(scope="module")
def saws():
    return definition_for_form("CA_SAWS_2_PLUS")


@pytest.fixture(scope="module")
def adapter():
    return Saws2PlusFieldAdapter()


class TestDescribesTheRealForm:
    def test_identifies_itself_as_the_california_form(self, saws):
        assert saws.form_id == "CA_SAWS_2_PLUS"
        assert saws.form_code == "SAWS 2 PLUS"
        assert saws.state == "CA"
        assert saws.page_count == 29

    def test_holds_the_official_fillable_template(self, saws):
        """The reason it needs no overlay: the real form has real fields."""
        assert saws.has_official_base_document is True
        assert saws.base_document == "CA-SAWS-2-PLUS.pdf"

    def test_uses_native_fields_and_never_a_coordinate(self, saws):
        assert saws.is_overlay is False

        for mapping in saws.fields:
            assert isinstance(mapping.target, AcroFormTarget), mapping.key
            assert not isinstance(mapping.target, OverlayTarget), mapping.key

    def test_the_bundled_template_exists(self, saws):
        from benefits_navigator.form_templates import _FORMS_DIR

        assert (_FORMS_DIR / saws.base_document).exists()


class TestDerivedFromTheLiveAdapter:
    def test_every_text_destination_matches_the_adapter(self, saws, adapter):
        for key, field_name in adapter.TEXT_FIELDS.items():
            mapping = saws.mapping_for(key)

            assert mapping is not None, key
            assert mapping.target.name == field_name, key

    def test_every_program_checkbox_matches_the_adapter(self, saws, adapter):
        for key, field_name in adapter.PROGRAM_FIELDS.items():
            mapping = saws.mapping_for(key)

            assert mapping is not None, key
            assert mapping.target.name == field_name, key
            assert mapping.kind is FieldKind.CHECKBOX, key

    def test_every_single_checkbox_matches_the_adapter(self, saws, adapter):
        for key, field_name in adapter.SINGLE_CHECKBOX_FIELDS.items():
            mapping = saws.mapping_for(key)

            assert mapping is not None, key
            assert mapping.target.name == field_name, key

    def test_every_yes_no_question_is_described_as_a_choice(self, saws, adapter):
        for key, pair in adapter.YES_NO_FIELDS.items():
            mapping = saws.mapping_for(key)

            assert mapping is not None, key
            assert mapping.kind is FieldKind.CHOICE, key
            # The affirmative destination, which is the one recorded here.
            assert mapping.target.name == pair[0], key

    def test_describes_no_destination_the_adapter_does_not_have(
        self, saws, adapter
    ):
        """A field here with no adapter counterpart is an invented mapping."""
        adapter_keys = (
            set(adapter.TEXT_FIELDS)
            | set(adapter.PROGRAM_FIELDS)
            | set(adapter.SINGLE_CHECKBOX_FIELDS)
            | set(adapter.YES_NO_FIELDS)
        )

        assert set(saws.keys()) <= adapter_keys

    def test_every_described_destination_is_on_the_adapters_allowlist(
        self, saws, adapter
    ):
        """The generator refuses to write outside SAFE_FIELDS.

        Describing a destination that is not on that list would document a write
        the generator would reject at runtime.
        """
        for mapping in saws.fields:
            assert mapping.target.name in adapter.SAFE_FIELDS, mapping.key

    def test_describes_a_useful_number_of_fields(self, saws):
        # Not an exact count — the adapter's tables are edited as destinations
        # are re-verified, and pinning a number here would make that a test
        # failure rather than a review. A floor catches the derivation silently
        # returning nothing.
        assert len(saws.fields) >= 40


class TestCaliforniaGenerationIsUntouched:
    def test_the_mapping_layer_does_not_generate_saws2_plus(self):
        """The layer describes California; ``pdf_generator`` produces it.

        Generating here would bypass the reviewed destination allowlist, the
        29-page template handling and the shrink-to-fit pass that the real
        generator performs.
        """
        from benefits_navigator.formmap import (
            NativeFieldFormNotRenderable,
            generate_form,
        )

        with pytest.raises(
            NativeFieldFormNotRenderable, match="generate_saws2_plus_pdf"
        ):
            generate_form("CA_SAWS_2_PLUS", {"applicant.phone": "5125551234"})

    def test_a_native_field_form_is_refused_rather_than_rendered_blank(self):
        """Regression: it produced a blank two-object PDF instead of refusing.

        A definition with no overlay fields fell through to the
        Navigator-authored page path, which had nothing to draw — so the layer
        emitted an empty document that presented itself as a prefilled
        application.
        """
        from benefits_navigator.formmap import (
            NativeFieldFormNotRenderable,
            generate_form,
        )

        with pytest.raises(NativeFieldFormNotRenderable):
            generate_form("CA_SAWS_2_PLUS", {})

    def test_the_generator_still_owns_the_shrink_to_fit_helpers(self):
        """They moved to ``formmap.textfit`` and are re-bound, not removed."""
        from benefits_navigator import pdf_generator

        for name in (
            "_helvetica_width",
            "_wrap_to_width",
            "_fits",
            "_largest_size_that_fits",
            "_MIN_FONT_SIZE",
            "_FIELD_PADDING",
        ):
            assert hasattr(pdf_generator, name), name

    def test_the_moved_helpers_are_the_same_objects(self):
        """One implementation, so the two renderers cannot disagree."""
        from benefits_navigator import pdf_generator
        from benefits_navigator.formmap import textfit

        assert pdf_generator._helvetica_width is textfit.helvetica_width
        assert pdf_generator._fits is textfit.fits
        assert (
            pdf_generator._largest_size_that_fits is textfit.largest_size_that_fits
        )

    def test_the_documented_narrow_date_box_still_shrinks_identically(self):
        """The case named in the metrics' own docstring, pinned in both homes."""
        from benefits_navigator import pdf_generator
        from benefits_navigator.formmap import textfit

        # Q6 "DATE OF BIRTH" is 47.9pt wide with /Helv 10 Tf set.
        assert pdf_generator._helvetica_width("01/01/1990", 10) == pytest.approx(
            50.0, abs=0.05
        )
        assert not textfit.fits("01/01/1990", 10, 47.9, 12, False)

        shrunk = textfit.largest_size_that_fits("01/01/1990", 10, 47.9, 12, False)

        assert shrunk is not None
        assert shrunk < 10.0
        assert shrunk >= textfit.MIN_FONT_SIZE


class TestCrossFormIsolation:
    def test_a_texas_canonical_key_has_nowhere_to_go_on_the_california_form(
        self, saws
    ):
        report = resolve_mappings(saws, {"programs.tx_snap": True})

        assert "programs.tx_snap" in report.unmapped
        assert report.fields == []

    def test_a_california_canonical_key_has_nowhere_to_go_on_h1010(self):
        h1010 = definition_for_form("TX_H1010")
        report = resolve_mappings(h1010, {"programs.calfresh": True})

        assert "programs.calfresh" in report.unmapped
        assert report.fields == []

    def test_the_two_forms_share_the_canonical_keys_that_are_genuinely_shared(
        self, saws
    ):
        """An applicant's address is the same answer on both forms.

        This is the property that makes the canonical layer worth having: the
        keys the TypeScript field plan already emits reach a second state's form
        with no new plumbing.
        """
        h1010 = definition_for_form("TX_H1010")
        shared = set(saws.keys()) & set(h1010.keys())

        for key in (
            "applicant.home_address.street",
            "applicant.home_address.city",
            "applicant.home_address.zip_code",
            "applicant.phone",
            "applicant.email",
        ):
            assert key in shared, key

    def test_the_same_canonical_data_maps_to_different_targets_per_form(
        self, saws
    ):
        h1010 = definition_for_form("TX_H1010")
        values = {"applicant.home_address.city": "Austin"}

        ca_target = resolve_mappings(saws, values).fields[0].target
        tx_target = resolve_mappings(h1010, values).fields[0].target

        # Same answer, same canonical key, two entirely different destinations —
        # one a named PDF field, one a coordinate box.
        assert isinstance(ca_target, AcroFormTarget)
        assert isinstance(tx_target, OverlayTarget)
