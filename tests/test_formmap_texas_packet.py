#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The Texas packet: provenance, applicability, language, and refusal.

What these tests are for, stated once so the individual cases read as
consequences of it rather than as a list:

A prefilled government form is a document someone hands to a caseworker
believing it is right. Every failure mode in this file produces a form that
*looks* right — a value at the previous revision's coordinates, a Spanish
applicant's answers on an English layout, a clinician's box filled in by us, a
pregnancy verification in a packet that never needed one. None of them raise on
their own. So each one is pinned here.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from benefits_navigator.formmap.definition import (
    DeclaredBlank,
    FormDefinitionError,
    Responsibility,
    is_sensitive_key,
    resolve_mappings,
)
from benefits_navigator.formmap.documents import (
    DocumentVariant,
    LanguageMatch,
    VariantError,
    resolve_document,
    validate_variant,
)
from benefits_navigator.formmap.forms.h1010_official import (
    PLACED_KEYS,
    PLACEMENTS_EN,
    PLACEMENTS_ES,
    PREGNANCY_DUE_DATE,
    PREGNANCY_PERSON,
)
from benefits_navigator.formmap.forms.h1010_coverage import (
    NOT_ON_THIS_FORM,
    NOT_ON_THIS_FORM_KEYS,
)
from benefits_navigator.formmap.forms.tx_catalog import TX_CATALOG
from benefits_navigator.formmap.forms.tx_documents import (
    TX_DOCUMENTS,
    TX_H1010_EN,
    TX_H1010_ES,
    TX_H1028_MBIC_EN,
    TX_H1049_BILINGUAL,
    TX_H3037_BILINGUAL,
    check_no_duplicate_assets,
)
from benefits_navigator.formmap.measurements import (
    MeasurementsOutOfDate,
    load_measurements,
    measurements_path,
)
from benefits_navigator.formmap.packet import (
    FormCategory,
    PacketContext,
    Requirement,
    plan_packet,
)
from benefits_navigator.formmap.provenance import (
    DocumentIntegrityError,
    Fillability,
    load_document,
)
from benefits_navigator.formmap.registry import definition_for_form
from benefits_navigator.formmap.targets import Box, OverlayTarget

SNAP = frozenset({"tx_snap"})
SNAP_AND_MEDICAID = frozenset({"tx_snap", "tx_medicaid"})


def context(programs=SNAP, **values) -> PacketContext:
    return PacketContext(state="TX", selected_programs=programs, values=values)


# ---------------------------------------------------------------------------
# Provenance — we hold the document we say we hold
# ---------------------------------------------------------------------------


class TestProvenance:
    def test_every_bundled_document_matches_its_recorded_digest(self):
        """Requirement 11: official-document provenance is known and checked."""
        for document in TX_DOCUMENTS:
            assert load_document(document) == document.path

    def test_every_document_records_where_and_when_it_came_from(self):
        for document in TX_DOCUMENTS:
            assert document.source_url.startswith("https://"), document.filename
            assert document.retrieved_on is not None, document.filename
            assert document.downloaded_as, document.filename
            assert document.printed_revision, document.filename

    def test_a_changed_document_is_refused_rather_than_rendered(self, tmp_path):
        """Requirement 12, half of it: new bytes cannot pass as the old ones.

        The failure this prevents is silent. A newer HHSC revision renders
        perfectly against last revision's coordinates — the overlay still
        draws, no exception is raised, and the values land four points off,
        across the printed labels.
        """
        import dataclasses

        tampered = dataclasses.replace(TX_H3037_BILINGUAL, sha256="0" * 64)

        with pytest.raises(DocumentIntegrityError, match="not the document"):
            load_document(tampered)

    def test_a_missing_document_names_itself(self):
        import dataclasses

        missing = dataclasses.replace(
            TX_H3037_BILINGUAL, filename="TX-NOT-A-REAL-FORM.pdf"
        )

        with pytest.raises(DocumentIntegrityError, match="TX-NOT-A-REAL-FORM"):
            load_document(missing)

    def test_the_h1010_editions_are_genuinely_different_documents(self):
        """Two files, two hashes. Not one file served from two links."""
        assert TX_H1010_EN.sha256 != TX_H1010_ES.sha256
        assert TX_H1010_EN.languages == ("en",)
        assert TX_H1010_ES.languages == ("es",)

    def test_the_bilingual_documents_declare_both_languages(self):
        """H1049 and H3037 are one document that serves both readers.

        Recorded as bilingual rather than as an English edition with a missing
        Spanish sibling, because the two are not the same claim: the second
        would have every Spanish applicant told they are receiving a fallback
        they are not receiving.
        """
        for document in (TX_H1049_BILINGUAL, TX_H3037_BILINGUAL):
            assert document.languages == ("en", "es")
            assert document.is_bilingual
            assert document.serves_language("es")

    def test_no_two_canonical_documents_are_the_same_bytes(self):
        """The duplicate-asset invariant. This is the bug, pinned.

        The catalog used to keep ``TX-H1049-ES-2001-12.pdf`` beside
        ``TX-H1049-BI-2001-12.pdf``, and ``TX-H3037-ES-`` beside
        ``TX-H3037-BI-``, because Texas offers each form through an English and
        a Spanish catalog link. Both links serve the same bilingual PDF, so the
        two files were byte-identical and the second one asserted an edition
        that does not exist as a separate document.

        Two records over one set of bytes is not merely redundant. It invites a
        locale-to-filename rule — ``es`` means the ``-ES-`` file — which is
        wrong for exactly these forms, and it gives two metadata objects that
        can drift apart about page counts, revisions and which languages are
        served while pointing at identical content.

        Deliberately scoped to these document declarations rather than to the
        repository. A recursive duplicate-file scan would be disproportionate,
        would flag legitimate coincidences, and would not have caught this
        earlier: the duplicate was declared in metadata before it was a
        problem, which is where this looks.
        """
        assert check_no_duplicate_assets() == ()

    def test_a_bilingual_form_keeps_exactly_one_physical_asset(self):
        """One file per bilingual form, and it is the one the resolver hands over.

        The positive half of the invariant above. Both forms are officially
        bilingual, both are retained once, and no ``-ES-`` sibling is left on
        disk for a future reader to mistake for a separate Spanish edition.
        """
        forms_dir = TX_H1049_BILINGUAL.path.parent

        for document in (TX_H1049_BILINGUAL, TX_H3037_BILINGUAL):
            code = document.filename.split("-")[1]
            held = sorted(path.name for path in forms_dir.glob(f"TX-{code}-*.pdf"))

            assert held == [document.filename], (
                f"{code} should be one canonical bilingual asset; found "
                f"{held}. A byte-identical language-suffixed copy models an "
                f"edition Texas does not publish separately."
            )

    def test_the_removed_spanish_duplicates_are_gone_from_disk(self):
        """Named explicitly, so a re-added copy fails rather than lingers."""
        forms_dir = TX_H1049_BILINGUAL.path.parent

        for name in ("TX-H1049-ES-2001-12.pdf", "TX-H3037-ES-2003-04.pdf"):
            assert not (forms_dir / name).exists(), (
                f"{name} is byte-identical to its bilingual canonical asset. "
                f"Texas serves one bilingual PDF from both its English and "
                f"Spanish catalog links; declare every language the document "
                f"prints in one OfficialDocument's `languages` tuple instead."
            )

    def test_the_superseded_document_is_recorded_as_superseded(self):
        """H1028-MBIC prints 12/2015 against HHSC's current 9/2024."""
        assert TX_H1028_MBIC_EN.printed_revision != (
            TX_H1028_MBIC_EN.catalog_revision
        )
        assert "SUPERSEDED" in TX_H1028_MBIC_EN.notes

    def test_the_xfa_documents_are_not_treated_as_natively_fillable(self):
        """H1010 is a print-by-hand form; its AcroForm layer is nearly empty.

        Recorded so nobody spends a day wiring AcroFormTarget to it before
        discovering that the Spanish edition has zero usable text fields.
        """
        assert TX_H1010_EN.fillability is Fillability.XFA_PARTIAL
        assert TX_H1010_ES.fillability is Fillability.XFA_PARTIAL
        assert TX_H1049_BILINGUAL.fillability is Fillability.FLAT


# ---------------------------------------------------------------------------
# Measurements — coordinates belong to one specific document
# ---------------------------------------------------------------------------


class TestMeasurements:
    def test_measurements_carry_the_digest_of_what_they_measured(self):
        for document in (TX_H1010_EN, TX_H1010_ES, TX_H3037_BILINGUAL):
            raw = json.loads(measurements_path(document).read_text())

            assert raw["document_sha256"] == document.sha256, document.filename

    def test_measurements_from_a_different_document_are_refused(self):
        """Requirement 12, the other half: coordinates cannot outlive a revision.

        Together with the digest check on the document itself, this is what
        makes "update the PDF" a loud operation. Replacing the asset fails the
        provenance check; updating the digest without re-measuring fails here.
        """
        import dataclasses

        moved_on = dataclasses.replace(TX_H3037_BILINGUAL, sha256="f" * 64)

        with pytest.raises(MeasurementsOutOfDate, match="different document"):
            load_measurements(moved_on)

    def test_every_measured_box_sits_on_its_document(self):
        for document in (TX_H1010_EN, TX_H1010_ES, TX_H3037_BILINGUAL):
            for key, boxes in load_measurements(document).items():
                for box in boxes:
                    assert 1 <= box.page <= document.page_count, key
                    assert box.right <= document.page_width, key
                    assert box.top <= document.page_height, key
                    assert box.width > 0 and box.height > 0, key


# ---------------------------------------------------------------------------
# Language — which official edition an applicant is handed
# ---------------------------------------------------------------------------


class TestDocumentLanguage:
    @property
    def h1010(self):
        return definition_for_form("TX_H1010_OFFICIAL")

    def test_an_english_applicant_gets_the_english_edition(self):
        chosen = resolve_document(self.h1010.variants, "en")

        assert chosen.variant.document is TX_H1010_EN
        assert chosen.match is LanguageMatch.EXACT
        assert chosen.limitation_key is None

    def test_a_spanish_applicant_gets_the_official_spanish_edition(self):
        """Scenario 2: not a translation of the English one. HHSC's H1010-S."""
        chosen = resolve_document(self.h1010.variants, "es")

        assert chosen.variant.document is TX_H1010_ES
        assert chosen.match is LanguageMatch.EXACT
        assert chosen.document_language == "es"
        assert chosen.limitation_key is None

    def test_a_regional_spanish_tag_still_gets_the_spanish_edition(self):
        assert (
            resolve_document(self.h1010.variants, "es-MX").variant.document
            is TX_H1010_ES
        )

    def test_a_spanish_applicant_gets_the_bilingual_document_as_bilingual(self):
        """H3037 in Spanish is not a fallback, and must not be reported as one."""
        h3037 = definition_for_form("TX_H3037")
        chosen = resolve_document(h3037.variants, "es")

        assert chosen.match is LanguageMatch.BILINGUAL
        assert chosen.is_in_applicants_language
        assert chosen.limitation_key is None

    def test_a_language_with_no_edition_falls_back_and_says_so(self):
        """Scenario 3. The fallback is stated, never silent."""
        chosen = resolve_document(self.h1010.variants, "vi")

        assert chosen.match is LanguageMatch.FALLBACK
        assert not chosen.is_in_applicants_language
        assert chosen.document_language == "en"
        assert chosen.limitation_key == "form_document_language_fallback"

    def test_the_fallback_carries_a_message_key_not_a_sentence(self):
        """The applicant reads the explanation in *their* language.

        Translating the explanation is right. Translating the government form
        is not, which is why there is no code path that does.
        """
        chosen = resolve_document(self.h1010.variants, "vi")

        assert chosen.limitation_key is not None
        assert " " not in chosen.limitation_key

    def test_selecting_spanish_never_translates_the_english_document(self):
        """Requirement 4 of 5A, asserted structurally.

        Every variant renders onto a file HHSC published. There is nowhere for
        a Navigator-authored translation to come from, because a variant has no
        field for one — the only thing it can point at is an OfficialDocument.
        """
        for variant in self.h1010.variants:
            assert variant.document in TX_DOCUMENTS

    def test_english_and_spanish_read_exactly_the_same_canonical_facts(self):
        """Requirement 5 of 5A: no Spanish-specific canonical data exists."""
        english, spanish = self.h1010.variants

        assert set(english.targets) == set(spanish.targets)
        assert set(PLACEMENTS_EN) == set(PLACEMENTS_ES) == set(PLACED_KEYS)

    def test_the_two_editions_do_not_share_a_single_coordinate(self):
        """Requirement 6 of 5A, and the sharpest test in this file.

        The editions look alike and are not. If a Spanish variant ever silently
        inherited English geometry, every box would still render — onto a page
        where the questions sit somewhere else. So it is not enough that the
        variants *can* differ; the ones we ship must actually differ, or the
        inheritance bug is present and invisible.
        """
        english, spanish = self.h1010.variants
        identical = [
            key
            for key in english.targets
            if english.targets[key].boxes() == spanish.targets[key].boxes()
        ]

        assert identical == [], (
            f"{len(identical)} field(s) have identical geometry on both "
            f"editions, which the printed pages do not: {identical[:5]}"
        )

    def test_a_variant_missing_a_target_is_refused(self):
        """The inheritance bug, caught at build time rather than on paper."""
        english = self.h1010.variants[0]
        incomplete = DocumentVariant(
            document=english.document,
            targets={
                key: target
                for key, target in english.targets.items()
                if key != "applicant.last_name"
            },
        )

        problems = validate_variant(
            incomplete,
            form_id="TX_H1010_OFFICIAL",
            mapped_keys=self.h1010.keys(),
            page_count=self.h1010.page_count,
        )

        assert any("applicant.last_name" in problem for problem in problems)

    def test_absent_and_deferred_are_not_interchangeable(self):
        """"Not asked on this form" and "we did not fill it in" differ.

        One ends the applicant's involvement; the other is a line on their
        to-do list. A key claiming to be both is a definition that cannot say
        which.
        """
        english = self.h1010.variants[0]
        confused = DocumentVariant(
            document=english.document,
            targets=dict(english.targets),
            absent_keys={"applicant.last_name": "not printed"},
            deferred_keys={"applicant.last_name": "not measured"},
        )

        problems = validate_variant(
            confused,
            form_id="TX_H1010_OFFICIAL",
            mapped_keys=self.h1010.keys(),
            page_count=self.h1010.page_count,
        )

        assert any("cannot be both" in problem for problem in problems)

    def test_a_form_with_no_variants_raises_rather_than_returning_none(self):
        with pytest.raises(VariantError):
            resolve_document((), "en")


# ---------------------------------------------------------------------------
# Packet planning — which forms, and why
# ---------------------------------------------------------------------------


class TestPacketPlanning:
    def test_a_plain_snap_household_gets_only_the_application(self):
        """Scenario 1, and scenario 6: nothing arrives just because it exists."""
        packet = plan_packet(TX_CATALOG, context())

        assert packet.form_ids() == ("TX_H1010",)
        assert packet.main_application().requirement is Requirement.REQUIRED

    def test_forms_that_do_not_apply_are_excluded_with_a_reason(self):
        packet = plan_packet(TX_CATALOG, context())
        excluded = {form.entry.form_code: form for form in packet.excluded}

        assert set(excluded) == {"H1049", "H3037", "H1028-MBIC"}

        for form in excluded.values():
            assert form.requirement is Requirement.NOT_APPLICABLE
            assert form.applicability.reason_key

    def test_self_employment_makes_h1049_applicable_but_not_required(self):
        """Scenario 4, and the distinction the whole planner exists for.

        HHSC's own instruction on H1049 lets an applicant attach a tax return
        instead. Reporting REQUIRED here would send someone to build an expense
        ledger they may not owe anyone.
        """
        packet = plan_packet(
            TX_CATALOG, context(**{"income.has_self_employment": True})
        )
        h1049 = next(f for f in packet.forms if f.entry.form_code == "H1049")

        assert h1049.requirement is Requirement.NEEDS_CONFIRMATION
        assert h1049.applicability.evidence == ("income.has_self_employment",)
        assert "tax" in h1049.applicability.citation.lower()

    def test_pregnancy_alone_does_not_summon_the_pregnancy_form(self):
        """Scenario 6 again, in the case most likely to be got wrong.

        A SNAP-only household reporting a pregnancy has no reason to visit a
        clinician for HHSC's benefit. H3037 establishes eligibility for
        pregnancy-related *health* coverage, and the form itself notes that the
        department cannot pay the clinician for filling it in.
        """
        packet = plan_packet(
            TX_CATALOG,
            PacketContext(
                state="TX",
                selected_programs=SNAP,
                values={"household.anyone_pregnant": True},
            ),
        )

        assert "TX_H3037" not in packet.form_ids()

        excluded = next(f for f in packet.excluded if f.entry.form_code == "H3037")

        assert excluded.applicability.reason_key == (
            "tx_h3037_no_health_program_selected"
        )

    def test_pregnancy_with_health_coverage_does_summon_it(self):
        """Scenario 5."""
        packet = plan_packet(
            TX_CATALOG,
            PacketContext(
                state="TX",
                selected_programs=SNAP_AND_MEDICAID,
                values={"household.anyone_pregnant": True},
            ),
        )
        h3037 = next(f for f in packet.forms if f.entry.form_code == "H3037")

        assert h3037.requirement is Requirement.NEEDS_CONFIRMATION
        assert h3037.entry.category is FormCategory.THIRD_PARTY_VERIFICATION

    def test_an_explicit_no_is_not_an_unanswered_question(self):
        """Requirement 5: explicit false stays distinct from unanswered.

        Both keep the form out of the packet, so the packets look identical —
        which is exactly why this needs asserting rather than eyeballing. The
        risk runs the other way: a planner using truthiness would treat a
        *missing* answer as a no and stop asking.
        """
        said_no = plan_packet(
            TX_CATALOG, context(**{"income.has_self_employment": False})
        )
        never_asked = plan_packet(TX_CATALOG, context())

        assert "TX_H1049" not in said_no.form_ids()
        assert "TX_H1049" not in never_asked.form_ids()

        answered = PacketContext(
            state="TX", selected_programs=SNAP,
            values={"income.has_self_employment": False},
        )

        assert answered.was_asked("income.has_self_employment")
        assert not answered.answered_yes("income.has_self_employment")

        unanswered = PacketContext(state="TX", selected_programs=SNAP, values={})

        assert not unanswered.was_asked("income.has_self_employment")

    def test_planning_is_deterministic(self):
        """Requirement 3. A packet that reshuffles is one nobody can check."""
        household = context(
            **{
                "income.has_self_employment": True,
                "household.anyone_pregnant": True,
            }
        )
        household = PacketContext(
            state="TX",
            selected_programs=SNAP_AND_MEDICAID,
            values=household.values,
        )

        runs = [plan_packet(TX_CATALOG, household).form_ids() for _ in range(5)]

        assert len(set(runs)) == 1
        assert runs[0][0] == "TX_H1010", "the application comes first"

    def test_every_planned_form_carries_an_explainable_reason(self):
        """Requirement 4."""
        household = PacketContext(
            state="TX",
            selected_programs=SNAP_AND_MEDICAID,
            values={
                "income.has_self_employment": True,
                "household.anyone_pregnant": True,
            },
        )
        packet = plan_packet(TX_CATALOG, household)

        assert len(packet.forms) == 3

        for form in packet.forms:
            assert form.applicability.reason_key
            assert form.applicability.citation, form.entry.form_code
            assert form.applicability.evidence, form.entry.form_code

    def test_a_household_in_another_state_gets_no_texas_forms(self):
        packet = plan_packet(
            TX_CATALOG,
            PacketContext(state="CA", selected_programs=frozenset({"calfresh"})),
        )

        assert packet.forms == ()
        assert packet.excluded == ()

    def test_the_superseded_form_cannot_be_prepared(self):
        """Registered so the catalog is honest; barred from the filling path."""
        entry = next(e for e in TX_CATALOG if e.form_code == "H1028-MBIC")

        assert not entry.fillable
        assert entry.unavailable_reason_key == "tx_h1028_mbic_superseded_revision"

    def test_h1028_mbic_is_not_general_employment_verification(self):
        """The mis-application this catalog is most exposed to.

        Its title reads "Employment Verification" and every working household
        looks like a match. It is not: MBIC is a narrow program, and the
        general H1028 is an HHSC-internal fallback used when TIERS is down.
        """
        entry = next(e for e in TX_CATALOG if e.form_code == "H1028-MBIC")
        working_snap_household = context(**{"income.has_earned_income": True})

        assert entry.applies(working_snap_household).requirement is (
            Requirement.NOT_APPLICABLE
        )
        assert entry.programs == frozenset({"tx_medicaid_buy_in_children"})

    def test_planning_never_reads_a_locale(self):
        """Requirement 7 of 5A: which forms is independent of which language.

        Asserted on the type rather than by comparing two runs, because a
        PacketContext with no locale field cannot consult one however the rules
        are written later.
        """
        assert not hasattr(PacketContext(state="TX", selected_programs=SNAP), "locale")
        assert set(PacketContext.__dataclass_fields__) == {
            "state",
            "selected_programs",
            "values",
        }


# ---------------------------------------------------------------------------
# Completion responsibility — who fills what
# ---------------------------------------------------------------------------


class TestCompletionResponsibility:
    def test_a_third_party_field_has_nothing_to_fill_it_from(self):
        """Requirement 6: third-party fields stay third-party.

        Structural rather than filtered. A DeclaredBlank has no canonical key
        and no target, so there is no path from applicant data to a clinician's
        box — not a path that is checked and refused, but no path.
        """
        h3037 = definition_for_form("TX_H3037")
        clinician = h3037.blanks_for(Responsibility.THIRD_PARTY)

        assert len(clinician) >= 8

        for blank in clinician:
            assert not hasattr(blank, "key")
            assert not hasattr(blank, "target")
            assert blank.completed_by_key == "completed_by_medical_provider"

    def test_signatures_are_never_fabricated(self):
        """Requirement 8, across every registered form."""
        for form_id in ("TX_H1010_OFFICIAL", "TX_H3037"):
            definition = definition_for_form(form_id)

            assert definition.blanks_for(Responsibility.SIGNATURE)

            for key in definition.keys():
                assert "signature" not in key.lower()
                assert not is_sensitive_key(key)

    def test_sensitive_information_is_structurally_unavailable(self):
        """Requirement 7. The refusal is the absence of a field."""
        h1010 = definition_for_form("TX_H1010_OFFICIAL")
        refused = h1010.blanks_for(Responsibility.SENSITIVE_REFUSED)

        assert any("Social Security" in blank.printed_label for blank in refused)

        for blank in refused:
            assert blank.reason_key == "blank_sensitive_never_collected"

        with pytest.raises(Exception):
            from benefits_navigator.formmap.definition import FieldMapping
            from benefits_navigator.formmap.targets import Box, FieldKind

            FieldMapping(
                key="applicant.ssn",
                kind=FieldKind.TEXT,
                target=OverlayTarget(box=Box(page=1, x=1, y=1, width=10, height=10)),
            )

    def test_a_blank_cannot_claim_navigator_fills_it(self):
        with pytest.raises(FormDefinitionError, match="FieldMapping"):
            DeclaredBlank(
                printed_label="x",
                section="y",
                responsibility=Responsibility.NAVIGATOR,
            )

    def test_the_agency_only_blocks_belong_to_the_agency(self):
        h3037 = definition_for_form("TX_H3037")
        agency = h3037.blanks_for(Responsibility.AGENCY)

        assert any("Case No." in blank.printed_label for blank in agency)
        assert any("Caseworker" in blank.printed_label for blank in agency)

    def test_the_same_fact_is_ours_on_one_form_and_a_clinicians_on_another(self):
        """The reason responsibility is per printed field, not per fact.

        The expected delivery date is the applicant's answer on H1010 and a
        clinician's attestation on H3037. Prefilling it on H3037 would hand a
        clinician a form that is pre-agreed with above their own signature.
        """
        h1010 = definition_for_form("TX_H1010_OFFICIAL")
        h3037 = definition_for_form("TX_H3037")

        assert PREGNANCY_DUE_DATE in h1010.keys()
        assert PREGNANCY_DUE_DATE not in h3037.keys()

        deferred = h3037.blanks_for(Responsibility.THIRD_PARTY)

        assert any(
            "Date of Expected Delivery" in blank.printed_label for blank in deferred
        )

    def test_h3037_accounts_for_every_printed_field(self):
        """One filled box and nineteen declared blanks is the whole form.

        The completeness matters more than the ratio: a checklist built from
        this can tell an applicant everything that is left, and a form reported
        as "complete" because our one box filled would be a confident lie.
        """
        h3037 = definition_for_form("TX_H3037")

        assert len(h3037.fields) == 1
        assert len(h3037.blanks) == 19

        responsibilities = {blank.responsibility for blank in h3037.blanks}

        assert responsibilities == {
            Responsibility.THIRD_PARTY,
            Responsibility.SIGNATURE,
            Responsibility.APPLICANT,
            Responsibility.AGENCY,
        }


# ---------------------------------------------------------------------------
# Canonical reuse — tell us once
# ---------------------------------------------------------------------------


class TestCanonicalReuse:
    def test_one_answer_fills_several_printed_boxes_on_one_form(self):
        """H1010 asks Person 1's name in Section A and again in Section F."""
        h1010 = definition_for_form("TX_H1010_OFFICIAL")
        first_name = h1010.mapping_for("applicant.first_name")

        boxes = first_name.target.boxes()

        assert len(boxes) == 2
        assert {box.page for box in boxes} == {5, 7}

    def test_one_answer_fills_boxes_on_two_different_forms(self):
        """Requirement 1, and scenario 7.

        The pregnant person's name is asked once on the Texas intake. It prints
        on H1010's Section C and twice on H3037 — three boxes on two government
        forms, from one answer.
        """
        h1010 = definition_for_form("TX_H1010_OFFICIAL")
        h3037 = definition_for_form("TX_H3037")

        assert PREGNANCY_PERSON in h1010.keys()
        assert PREGNANCY_PERSON in h3037.keys()

        values = {PREGNANCY_PERSON: "María Elena Rodríguez"}

        for definition in (h1010, h3037):
            report = resolve_mappings(definition, values)
            rendered = report.rendered_values()

            assert rendered[PREGNANCY_PERSON] == "María Elena Rodríguez"

        assert len(h3037.mapping_for(PREGNANCY_PERSON).target.boxes()) == 2

    #: Keys that legitimately name Texas, because Texas is part of the fact.
    #:
    #: The rule below forbids a state's vocabulary in a canonical key, so a
    #: field describes a fact rather than the box a form prints it in. Texas
    #: *residency* is a fact — H1010 asks whether a person lives here and
    #: whether they plan to stay, and both would still be true facts about a
    #: person if no form existed. Renaming them to hide the word would make
    #: them less clear, not more portable.
    #:
    #: Listed one by one rather than by dropping "texas" from the token list,
    #: so the guard keeps its force: a key called `texas_box_3` still fails.
    TEXAS_IS_PART_OF_THE_FACT = frozenset(
        {
            "applicant.household.lives_in_texas",
            "applicant.household.plans_to_stay_in_texas",
            *(
                f"household.members.{row}.{record}.{field}"
                for row in range(6)
                for record in ("adult", "child")
                for field in ("lives_in_texas", "plans_to_stay_in_texas")
            ),
        }
    )

    def test_no_canonical_key_is_named_after_a_texas_form(self):
        """A canonical field describes a fact, not the box a state prints it in."""
        for form_id in ("TX_H1010_OFFICIAL", "TX_H3037"):
            for key in definition_for_form(form_id).keys():
                lowered = key.lower()

                for token in ("h1010", "h3037", "h1049", "h1028", "hhsc"):
                    assert token not in lowered, key

                if key in self.TEXAS_IS_PART_OF_THE_FACT:
                    continue

                assert "texas" not in lowered, key

    def test_every_intake_answer_is_classified(self):
        """The audit, asserted rather than described.

        Every canonical answer the Texas intake collects is either placed on
        the official form, read by a derivation that places something, beyond
        the printed rows of a table the form does have, or recorded in
        ``NOT_ON_THIS_FORM`` with a concrete reason. Nothing falls through.

        This replaces ``WORKSHEET_ONLY_KEYS``, which held "printed on pages 4
        to 21, not yet measured" and "H1010 does not ask this" in one list of
        127. Those are different situations and only the first was work; the
        list could therefore never reach empty, and its length said nothing.
        """
        from benefits_navigator.formmap.forms.h1010_official import (
            DERIVATIONS,
            OFFICIAL_GROUPS,
        )

        official = definition_for_form("TX_H1010")
        worksheet = definition_for_form("TX_H1010_WORKSHEET")

        placed = set(official.keys())
        read_by_derivation = {
            key for derivation in DERIVATIONS for key in derivation.reads()
        }
        beyond_printed_rows = {
            key
            for key in worksheet.keys()
            for group in OFFICIAL_GROUPS
            if key.startswith(f"{group.prefix}.")
            and key[len(group.prefix) + 1 :].split(".")[0].isdigit()
            and int(key[len(group.prefix) + 1 :].split(".")[0]) >= group.rows
        }

        classified = (
            placed
            | read_by_derivation
            | beyond_printed_rows
            | NOT_ON_THIS_FORM_KEYS
        )

        unclassified = sorted(set(worksheet.keys()) - classified)

        assert unclassified == [], (
            f"{len(unclassified)} intake answer(s) are neither placed on "
            f"H1010, read by a derivation, beyond a printed row limit, nor "
            f"recorded in h1010_coverage.NOT_ON_THIS_FORM with a reason: "
            f"{unclassified}"
        )

    def test_nothing_is_classified_as_absent_and_also_placed(self):
        """A key with a box cannot also be recorded as having none."""
        placed = set(definition_for_form("TX_H1010").keys())

        assert placed.isdisjoint(NOT_ON_THIS_FORM_KEYS)

    def test_every_absent_answer_carries_a_concrete_reason(self):
        """"Unmapped" without a reason reads as "we did not get to it"."""
        for note in NOT_ON_THIS_FORM:
            assert note.answer_label.strip(), note.key
            assert len(note.reason) > 60, (
                f"{note.key}: the reason is too short to be concrete — "
                f"{note.reason!r}"
            )

    def test_the_pay_period_refusal_is_recorded_and_explained(self):
        """The one field left blank on purpose rather than for lack of a box.

        Section O's amount box is a per-pay-period figure; the intake collects
        a monthly total and says so ("not one paycheck"). Writing the monthly
        total there would overstate the household's income to HHSC by however
        many pay periods a month holds. Deriving the per-period figure would
        mean dividing by a number the applicant never gave.
        """
        from benefits_navigator.formmap.forms.h1010_coverage import note_for

        for row in range(3):
            note = note_for(f"income.earned.{row}.gross_received_this_month")

            assert note is not None
            assert "per-pay-period" in note.reason
            assert note.action_key == "uncollected_tx_h1010_pay_per_period"

    def test_no_texas_form_consumes_a_california_key(self):
        """Requirement 2."""
        california = definition_for_form("CA_SAWS_2_PLUS")

        for form_id in ("TX_H1010_OFFICIAL", "TX_H3037"):
            texas = definition_for_form(form_id)
            shared = set(texas.keys()) & set(california.keys())

            assert "household.california_resident" not in texas.consumed_keys()
            assert all(not key.startswith("ca_") for key in shared)

    def test_california_is_untouched_by_any_of_this(self):
        """Requirement 13.

        The one number that must not move. California fills 1,444 native
        AcroForm fields through a separate 4,900-line generator, and nothing in
        the Texas work has any business changing it.
        """
        california = definition_for_form("CA_SAWS_2_PLUS")

        assert california.state == "CA"
        assert california.base_document == "CA-SAWS-2-PLUS.pdf"
        assert california.variants == ()
        assert california.blanks == ()

    def test_every_texas_form_declares_texas(self):
        for form_id in ("TX_H1010", "TX_H1010_OFFICIAL", "TX_H3037"):
            assert definition_for_form(form_id).state == "TX"


# ---------------------------------------------------------------------------
# Rendering onto the official document
# ---------------------------------------------------------------------------


AUSTIN_HOUSEHOLD = {
    "applicant.first_name": "María",
    "applicant.middle_name": "Elena",
    "applicant.last_name": "Rodríguez",
    "applicant.date_of_birth": "1991-09-14",
    "applicant.mailing_address.street": "1204 E Cesar Chavez St Apt 3",
    "applicant.mailing_address.city": "Austin",
    "applicant.mailing_address.state": "TX",
    "applicant.mailing_address.zip_code": "78702",
    "applicant.phone": "5125550143",
    "applicant.alternate_phone": "5125559981",
    "applicant.home_address.street": "1204 E Cesar Chavez St Apt 3",
    "applicant.home_address.county": "Travis",
    "applicant.home_address.city": "Austin",
    "applicant.home_address.state": "TX",
    "applicant.home_address.zip_code": "78702",
    "programs.tx_snap": True,
    "programs.tx_tanf": True,
    "household.expedited.migrant_or_seasonal_farm_worker": False,
    "resources.has_accounts": True,
    "expenses.has_household_expenses": True,
    "household.anyone_pregnant": True,
    PREGNANCY_PERSON: "María Elena Rodríguez",
    PREGNANCY_DUE_DATE: "2027-02-08",
    "household.military_service": False,
    "applicant.preferred_language": "Spanish",
    "applicant.email": "maria.rodriguez@example.com",
    "applicant.household.marital_status": "married",
    "applicant.household.sex": "female",
    "applicant.household.citizen_or_national": True,
}


def _plan_for(locale: str):
    import dataclasses

    from benefits_navigator.formmap.render import plan_render

    definition = definition_for_form("TX_H1010_OFFICIAL")
    chosen = resolve_document(definition.variants, locale)
    fields = tuple(
        dataclasses.replace(field, target=chosen.variant.targets[field.key])
        for field in definition.fields
    )
    swapped = dataclasses.replace(definition, fields=fields)
    report = resolve_mappings(swapped, AUSTIN_HOUSEHOLD)

    return chosen, report, plan_render(list(report.fields))


class TestRenderingOnTheOfficialDocument:
    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_every_answer_fits_inside_its_printed_box(self, locale):
        """Nothing overflows onto a printed label, in either edition."""
        _, report, plan = _plan_for(locale)

        assert plan.unfitted == []
        assert plan.unplaced == []

        # Every answer this household gave reached a box. Not "as many fields
        # as the form has specs" — that only held while the fixture answered
        # every one of them, and the form now maps four person blocks, three
        # jobs and eight housing costs this household does not have.
        assert report.fields
        assert {resolved.key for resolved in report.fields} <= set(PLACED_KEYS)

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_nothing_sensitive_reaches_the_page(self, locale):
        _, _, plan = _plan_for(locale)
        drawn = " ".join(item.text for item in plan.draws).lower()

        for forbidden in ("ssn", "social security", "-88-", "alien"):
            assert forbidden not in drawn

    def test_the_two_editions_draw_the_same_values_in_different_places(self):
        """The proof that one household's answers reach both official layouts."""
        _, english_report, english_plan = _plan_for("en")
        _, spanish_report, spanish_plan = _plan_for("es")

        assert english_report.rendered_values() == spanish_report.rendered_values()

        english_at = {(d.text, round(d.x, 1)) for d in english_plan.draws}
        spanish_at = {(d.text, round(d.x, 1)) for d in spanish_plan.draws}

        assert english_at != spanish_at

    def test_the_date_is_written_one_digit_per_printed_cell(self):
        """The form prints a character grid, and is filled one char per cell.

        Three draws — ``09``, ``14``, ``1991`` — was the previous behaviour and
        it printed each digit half over the divider between its cells, because
        a two-digit month centred across a two-cell group lands on the
        boundary. The grid is eight cells; the date is eight draws.
        """
        _, _, plan = _plan_for("en")

        definition = definition_for_form("TX_H1010")
        target = definition.mapping_for("applicant.date_of_birth").target

        assert len(target.segments) == 8

        on_page = [d for d in plan.draws if d.page == 5]
        digits = [d.text for d in on_page]

        # One character per draw, and the separators are the form's own.
        for piece in ("09", "14", "1991", "09/14/1991"):
            assert piece not in digits

        # The date's own cells, left to right, spell it back.
        cells = sorted(
            (
                draw
                for draw in on_page
                if draw.text.isdigit() and len(draw.text) == 1
            ),
            key=lambda draw: draw.x,
        )
        spelled = "".join(draw.text for draw in cells)

        assert "09141991" in spelled

    def test_the_phone_is_split_around_the_printed_punctuation(self):
        _, _, plan = _plan_for("en")
        pieces = [d.text for d in plan.draws if d.page == 5]

        assert "512" in pieces and "0143" in pieces
        assert "(512) 555-0143" not in pieces

    def test_marks_land_on_the_chosen_option_only(self):
        """A yes/no answer marks one circle, never both."""
        _, _, plan = _plan_for("en")

        definition = definition_for_form("TX_H1010_OFFICIAL")
        citizen = definition.mapping_for("applicant.household.citizen_or_national")
        yes_box = citizen.target.option_boxes["yes"]
        no_box = citizen.target.option_boxes["no"]

        marks = [d for d in plan.draws if d.text == "X" and d.page == yes_box.page]
        near_yes = [d for d in marks if abs(d.x - yes_box.x) < 6]
        near_no = [d for d in marks if abs(d.x - no_box.x) < 6]

        assert len(near_yes) == 1
        assert near_no == []

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_rendered_bytes_open_and_keep_the_official_page_count(self, locale):
        """The output is HHSC's document with values on it, not a new document."""
        import io

        from pypdf import PdfReader, PdfWriter

        from benefits_navigator.formmap.render import (
            SimplePdf,
            content_stream,
        )

        chosen, _, plan = _plan_for(locale)
        document = chosen.variant.document
        reader = PdfReader(str(load_document(document)))
        writer = PdfWriter()

        for index, page in enumerate(reader.pages, start=1):
            draws = plan.for_page(index)

            if draws:
                stamp = SimplePdf(width=612.0, height=792.0)
                stamp.add_page(content_stream(draws))
                page.merge_page(PdfReader(io.BytesIO(stamp.to_bytes())).pages[0])

            writer.add_page(page)

        buffer = io.BytesIO()
        writer.write(buffer)
        rendered = PdfReader(io.BytesIO(buffer.getvalue()))

        assert len(rendered.pages) == document.page_count == 34

        text = rendered.pages[4].extract_text()

        assert "Rodríguez" in text

        # HHSC's own printed content survives the overlay untouched — in the
        # edition's own language, which is the point: the Spanish page carries
        # HHSC's Spanish wording because it is HHSC's Spanish document, not a
        # translation of the English one.
        agency = {
            "en": "Texas Health and Human Services Commission",
            "es": "Comisión de Salud y Servicios Humanos de Texas",
        }[locale]

        assert agency in text


# ---------------------------------------------------------------------------
# The measurement tool and its committed output stay in step
# ---------------------------------------------------------------------------


class TestMeasurementToolIsInStep:
    def test_committed_measurements_match_a_fresh_run(self):
        """An anchor edited without regenerating cannot reach main.

        Skipped where poppler is absent, because measuring is a build-time job
        and rendering deliberately does not need it.
        """
        pytest.importorskip("subprocess")

        import shutil
        import subprocess

        if shutil.which("pdftotext") is None:
            pytest.skip("pdftotext (poppler) is not installed")

        root = Path(__file__).resolve().parent.parent
        result = subprocess.run(
            [str(root / ".venv/bin/python"), "tools/measure_texas_forms.py", "--check"],
            cwd=root,
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# Generation is locale-aware — the resolver reaches production
# ---------------------------------------------------------------------------


class TestGenerationChoosesTheAssetFromTheLocale:
    """The gap this suite used to leave open, closed.

    Every test above proved ``resolve_document`` picks correctly. None of them
    proved anything *called* it: ``generate_form`` took no locale, and
    ``h1010_official`` pinned ``base_document`` to the English file with a
    comment claiming ``generate_form(..., locale="es")`` would swap it. There
    was no such parameter. So the whole language layer was reachable only from
    tests, and a Spanish applicant's answers were drawn on English coordinates.

    These tests assert on the **asset identity** — the digest of the bytes the
    document was rendered onto — rather than on a filename. A filename
    assertion passes if somebody re-adds a byte-identical ``-ES-`` copy and
    points the Spanish variant at it, which is precisely the mistake this
    change removed.
    """

    VALUES = {
        "applicant.first_name": "Marisol",
        "applicant.last_name": "Rivera",
        "applicant.home_address.zip_code": "78702",
        "programs.tx_snap": True,
    }

    def _generated(self, locale: str):
        from benefits_navigator.formmap import generate_form

        return generate_form("TX_H1010_OFFICIAL", self.VALUES, locale=locale)

    def test_an_english_applicant_is_rendered_onto_the_english_asset(self):
        chosen = self._generated("en").document

        assert chosen.document.sha256 == TX_H1010_EN.sha256
        assert chosen.match is LanguageMatch.EXACT

    def test_a_spanish_applicant_is_rendered_onto_the_spanish_asset(self):
        """The requirement, at the layer that actually produces the document.

        Not "a Spanish-named file" — the Spanish document's own bytes.
        """
        chosen = self._generated("es").document

        assert chosen.document.sha256 == TX_H1010_ES.sha256
        assert chosen.match is LanguageMatch.EXACT
        assert chosen.document_language == "es"

    def test_the_two_locales_do_not_receive_the_same_bytes(self):
        """H1010 is two real documents, so the outputs cannot coincide."""
        english = self._generated("en")
        spanish = self._generated("es")

        assert english.document.document.sha256 != (
            spanish.document.document.sha256
        )
        assert english.pdf_bytes != spanish.pdf_bytes

    def test_a_spanish_applicant_never_receives_the_english_h1010(self):
        """Stated as its own case because it is the requirement's sharp edge."""
        for locale in ("es", "es-MX", "es_ES", "ES"):
            chosen = self._generated(locale).document

            assert chosen.document.sha256 != TX_H1010_EN.sha256, locale
            assert chosen.document.sha256 == TX_H1010_ES.sha256, locale

    def test_the_spanish_render_uses_spanish_coordinates(self):
        """Half a swap is worse than none: the same file, the wrong geometry.

        Swapping ``base_document`` without swapping the targets renders every
        box without error onto a page where the questions sit elsewhere. So the
        drawn positions must differ between the editions, not just the file.
        """
        english = self._generated("en").render_plan
        spanish = self._generated("es").render_plan

        english_at = {(d.text, round(d.x, 1)) for d in english.draws}
        spanish_at = {(d.text, round(d.x, 1)) for d in spanish.draws}

        assert english.draws and spanish.draws
        assert english_at != spanish_at

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_bilingual_form_gives_both_locales_the_one_canonical_asset(
        self, locale
    ):
        """H3037: one document, two languages, no fallback reported."""
        from benefits_navigator.formmap import generate_form

        chosen = generate_form("TX_H3037", self.VALUES, locale=locale).document

        assert chosen.document.sha256 == TX_H3037_BILINGUAL.sha256
        assert chosen.match is LanguageMatch.BILINGUAL
        assert chosen.is_in_applicants_language
        assert chosen.limitation_key is None

    def test_the_bilingual_asset_is_identical_across_locales(self):
        from benefits_navigator.formmap import generate_form

        english = generate_form("TX_H3037", self.VALUES, locale="en")
        spanish = generate_form("TX_H3037", self.VALUES, locale="es")

        assert (
            english.document.document is spanish.document.document
        ), "a bilingual form must resolve to one asset, not two records"
        assert english.pdf_bytes == spanish.pdf_bytes

    def test_rendering_verifies_the_asset_digest_before_drawing_on_it(self):
        """The provenance check is on the rendering path, not only in a test.

        A file that changes after CI ran is the risk, so the check has to be on
        the line that opens it for drawing.
        """
        import dataclasses

        from benefits_navigator.formmap.pipeline import _render_over_template
        from benefits_navigator.formmap.render import RenderPlan

        definition = definition_for_form("TX_H3037")
        chosen = resolve_document(definition.variants, "en")
        tampered = dataclasses.replace(
            chosen,
            variant=dataclasses.replace(
                chosen.variant,
                document=dataclasses.replace(
                    TX_H3037_BILINGUAL, sha256="0" * 64
                ),
            ),
        )

        with pytest.raises(DocumentIntegrityError):
            _render_over_template(definition, RenderPlan(), tampered)

    def test_the_review_sheet_is_written_in_the_applicants_language(self):
        """Requirement: the guide explains the form in Spanish.

        The review sheet *is* the completion guide the Texas guide route
        serves, and it was English regardless of locale — so a Spanish
        applicant reached the end of a Spanish flow and was handed the one page
        of instructions in a language they had not chosen.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.review_words import ENGLISH, SPANISH

        spanish = generate_form("TX_H3037", self.VALUES, locale="es")
        english = generate_form("TX_H3037", self.VALUES, locale="en")

        assert SPANISH.filled_in in spanish.review_text
        assert ENGLISH.filled_in not in spanish.review_text

        assert ENGLISH.filled_in in english.review_text

    def test_a_bilingual_form_is_never_described_as_a_fallback(self):
        """The wording bug the requirement calls out by name.

        "We could not find it in your language, here is English" and "the
        agency publishes this in both languages" are opposite messages, and
        H3037 gets the second one.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.review_words import SPANISH

        sheet = generate_form(
            "TX_H3037", self.VALUES, locale="es"
        ).review_text

        assert SPANISH.official_language_bilingual in sheet
        assert SPANISH.official_language_fallback not in sheet

    def test_a_partly_bilingual_document_says_where_the_spanish_stops(self):
        """H3037 page 1 is the clinician's and is English only.

        "English & Spanish" flat would overstate it to the reader who most
        needs the detail, so the qualification travels with the document and is
        printed in their language.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.review_words import SPANISH

        key = TX_H3037_BILINGUAL.language_scope_key

        assert key, "H3037 is bilingual on only one page and must say so"

        sheet = generate_form(
            "TX_H3037", self.VALUES, locale="es"
        ).review_text

        assert SPANISH.scope_notes[key] in sheet

    def test_an_unpublished_language_falls_back_and_says_so(self):
        chosen = self._generated("vi").document

        assert chosen.document.sha256 == TX_H1010_EN.sha256
        assert chosen.match is LanguageMatch.FALLBACK
        assert chosen.limitation_key == "form_document_language_fallback"

    def test_the_worksheet_explains_itself_in_the_applicants_language(self):
        """"Why is this not the official form" is read by the applicant.

        It was printed verbatim from ``base_document_note``, which is
        engineering prose: it was English regardless of locale, and naming
        modules and PDF filenames put internal vocabulary on the one page whose
        job is to make the paperwork comprehensible.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.review_words import ENGLISH, SPANISH

        key = "worksheet_reason_tx_h1010_partial_coverage"

        spanish = generate_form(
            "TX_H1010_WORKSHEET", self.VALUES, locale="es"
        ).review_text

        assert SPANISH.worksheet_reasons[key] in spanish
        assert ENGLISH.worksheet_reasons[key] not in spanish

        english = generate_form(
            "TX_H1010_WORKSHEET", self.VALUES, locale="en"
        ).review_text

        assert ENGLISH.worksheet_reasons[key] in english

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_review_sheet_names_no_internal_file_or_module(self, locale):
        """The applicant never meets our storage names or our module names."""
        from benefits_navigator.formmap import generate_form

        for form_id in ("TX_H1010_WORKSHEET", "TX_H3037"):
            sheet = generate_form(form_id, self.VALUES, locale=locale).review_text

            for leak in (
                "TX-H1010-EN",
                "TX-H1010-ES",
                "TX-H1049-BI",
                "TX-H3037-BI",
                ".pdf",
                "h1010_official",
                "base_document",
            ):
                assert leak not in sheet, f"{leak} leaked into {form_id}/{locale}"

    def test_the_worksheet_has_no_edition_to_choose_and_does_not_pretend_to(
        self,
    ):
        """The production Texas document is Navigator-authored, not HHSC's.

        Its language story belongs to the worksheet rather than to an HHSC
        edition, so ``document`` is None rather than a fabricated descriptor.
        """
        from benefits_navigator.formmap import generate_form

        generated = generate_form(
            "TX_H1010_WORKSHEET", self.VALUES, locale="es"
        )

        assert generated.document is None
        assert not generated.is_official_document
        assert generated.source_filename is None


# ---------------------------------------------------------------------------
# What the applicant's downloads folder shows them
# ---------------------------------------------------------------------------


class TestDownloadNames:
    """No internal name, no language code, and bilingual said as bilingual."""

    def test_the_language_editions_are_named_by_their_language(self):
        from benefits_navigator.formmap.pipeline import download_name

        assert (
            download_name(
                state="TX",
                form_code="H1010",
                languages=TX_H1010_EN.languages,
                kind="Application",
            )
            == "Texas-H1010-Application-English.pdf"
        )
        assert (
            download_name(
                state="TX",
                form_code="H1010",
                languages=TX_H1010_ES.languages,
                kind="Application",
            )
            == "Texas-H1010-Application-Spanish.pdf"
        )

    def test_a_bilingual_document_is_named_bilingual_not_english(self):
        """Naming it "-English" would tell a Spanish reader, in their downloads
        folder, that they had been handed the English one."""
        from benefits_navigator.formmap.pipeline import download_name

        for document, expected in (
            (TX_H1049_BILINGUAL, "Texas-H1049-Bilingual.pdf"),
            (TX_H3037_BILINGUAL, "Texas-H3037-Bilingual.pdf"),
        ):
            assert (
                download_name(
                    state="TX",
                    form_code=document.filename.split("-")[1],
                    languages=document.languages,
                )
                == expected
            )

    def test_no_download_name_leaks_a_canonical_storage_name(self):
        from benefits_navigator.formmap.manifest import build_manifest

        for locale in ("en", "es"):
            for entry in build_manifest(
                catalog=TX_CATALOG,
                context=context(
                    SNAP_AND_MEDICAID,
                    **{
                        "income.has_self_employment": True,
                        "household.anyone_pregnant": True,
                    },
                ),
                locale=locale,
            ):
                if entry.document is None:
                    continue

                shown = entry.document.download_name

                assert entry.document.source_filename not in shown
                for leak in ("-BI-", "-ES-", "-EN-", "2001-12", "2026-08"):
                    assert leak not in shown, shown


# ---------------------------------------------------------------------------
# The manifest the interface renders
# ---------------------------------------------------------------------------


def _manifest(locale: str):
    from benefits_navigator.formmap.manifest import build_manifest

    return {
        entry.form_code: entry
        for entry in build_manifest(
            catalog=TX_CATALOG,
            context=context(
                SNAP_AND_MEDICAID,
                **{
                    "income.has_self_employment": True,
                    "household.anyone_pregnant": True,
                },
            ),
            locale=locale,
        )
    }


class TestPacketManifest:
    """One source of truth for what the cards say about language."""

    def test_the_spanish_packet_names_the_spanish_h1010(self):
        document = _manifest("es")["H1010"].document

        assert document is not None
        assert document.source_filename == TX_H1010_ES.filename
        assert document.languages == ("es",)
        assert not document.is_bilingual
        assert document.download_name == "Texas-H1010-Application-Spanish.pdf"

    def test_the_english_packet_names_the_english_h1010(self):
        document = _manifest("en")["H1010"].document

        assert document is not None
        assert document.source_filename == TX_H1010_EN.filename
        assert document.download_name == "Texas-H1010-Application-English.pdf"

    @pytest.mark.parametrize("locale", ["en", "es"])
    @pytest.mark.parametrize("code", ["H1049", "H3037"])
    def test_both_locales_get_the_one_bilingual_asset(self, locale, code):
        document = _manifest(locale)[code].document

        assert document is not None
        assert document.is_bilingual
        assert document.languages == ("en", "es")
        assert document.language_match == "bilingual"
        assert document.is_in_applicants_language

        # The distinction the requirement is explicit about: information, not a
        # shortfall. A card must never imply we fell back to English.
        assert document.limitation_key is None
        assert document.note_key == "form_document_officially_bilingual"

    def test_the_bilingual_descriptor_is_identical_across_locales(self):
        """Same document, same description — nothing locale-dependent leaks."""
        for code in ("H1049", "H3037"):
            assert _manifest("en")[code].document == _manifest("es")[code].document

    def test_every_entry_carries_keys_rather_than_sentences(self):
        """The interface renders in the applicant's language, so prose here
        could only disagree with the message catalog."""
        for locale in ("en", "es"):
            for entry in _manifest(locale).values():
                for key in (entry.reason_key, entry.purpose_key):
                    assert key and " " not in key, key

                if entry.document and entry.document.limitation_key:
                    assert " " not in entry.document.limitation_key

    def test_a_card_lists_only_the_programmes_the_household_chose(self):
        entry = _manifest("en")["H1010"]

        assert set(entry.programs) == {"tx_snap", "tx_medicaid"}

    def test_a_form_we_cannot_prepare_says_why(self):
        """H1028-MBIC is superseded, and the catalog is honest about it."""
        from benefits_navigator.formmap.manifest import build_manifest

        entries = build_manifest(
            catalog=TX_CATALOG,
            context=context(
                frozenset({"tx_medicaid_buy_in_children"}),
                **{"income.has_earned_income": True},
            ),
            locale="en",
        )

        mbic = {entry.form_code: entry for entry in entries}["H1028-MBIC"]

        assert not mbic.can_be_prepared
        assert mbic.unavailable_reason_key == "tx_h1028_mbic_superseded_revision"

    def test_an_english_only_form_reports_a_fallback_for_a_spanish_reader(self):
        """H1028-MBIC has no Spanish edition, and that is said rather than hidden.

        The opposite case to H1049: here English genuinely *is* a fallback, and
        collapsing the two would make one of them a lie.
        """
        from benefits_navigator.formmap.manifest import build_manifest

        entries = build_manifest(
            catalog=TX_CATALOG,
            context=context(
                frozenset({"tx_medicaid_buy_in_children"}),
                **{"income.has_earned_income": True},
            ),
            locale="es",
        )

        mbic = {entry.form_code: entry for entry in entries}["H1028-MBIC"]

        assert mbic.document is not None
        assert mbic.document.language_match == "fallback"
        assert not mbic.document.is_in_applicants_language
        assert mbic.document.limitation_key == "form_document_language_fallback"
        assert mbic.document.note_key is None

    def test_the_manifest_survives_the_subprocess_boundary_as_json(self):
        import json

        from benefits_navigator.form_filler import packet_manifest_for

        plan = [
            {"key": "programs.tx_snap", "value": True},
            {"key": "programs.tx_medicaid", "value": True},
            {"key": "income.has_self_employment", "value": True},
            {"key": "household.anyone_pregnant", "value": True},
        ]

        payload = packet_manifest_for({"state": "TX", "locale": "es"}, plan)

        # Serializes and survives the pipe. Read back from the *round-tripped*
        # value rather than the original, so this asserts what the interface
        # actually receives — tuples arrive as arrays, and a test comparing the
        # two directly would fail on that alone while proving nothing.
        received = json.loads(json.dumps(payload))

        assert received and len(received) == len(payload)

        by_code = {entry["form_code"]: entry for entry in received}

        assert by_code["H1010"]["document"]["source_filename"] == (
            TX_H1010_ES.filename
        )
        assert by_code["H1049"]["document"]["is_bilingual"] is True

    def test_a_state_with_no_catalog_gets_an_empty_manifest_not_an_error(self):
        from benefits_navigator.form_filler import packet_manifest_for

        assert packet_manifest_for({"state": "CA", "locale": "en"}, []) == []


# ---------------------------------------------------------------------------
# Semantic placement — the right value, in the right box, on the right edition
# ---------------------------------------------------------------------------


def _drawn(locale: str):
    """Every draw the official form produces for one representative household.

    Rendered through ``generate_form`` rather than a hand-swapped definition,
    so what is asserted is what an applicant receives.
    """
    from benefits_navigator.formmap import generate_form

    generated = generate_form("TX_H1010", SEMANTIC_HOUSEHOLD, locale=locale)

    return generated, generated.render_plan.draws


#: A household that exercises every repeated block and every derivation.
#:
#: Deliberately not minimal: four other people, two jobs, two other-money
#: sources, three kinds of housing cost, an authorized representative. A
#: fixture that fills one of each cannot catch a row-index error, which is the
#: mistake this form is most exposed to — every person block prints the same
#: questions.
SEMANTIC_HOUSEHOLD: dict = {
    "applicant.first_name": "Marisol",
    "applicant.last_name": "Rivera",
    "applicant.date_of_birth": "1991-03-14",
    "applicant.home_address.street": "2100 Nueces Street",
    "applicant.home_address.apartment": "Apt 3",
    "applicant.home_address.city": "Austin",
    "applicant.home_address.state": "TX",
    "applicant.home_address.zip_code": "78705",
    "applicant.home_address.county": "Travis",
    "applicant.phone": "5125550143",
    "programs.tx_snap": True,
    # Four other people, each with a distinguishable name and date.
    **{
        f"household.members.{row}.{field}": value
        for row, person in enumerate(
            (
                ("Diego", "Rivera", "Spouse", "1989-07-02", "male", True),
                ("Ana", "Rivera", "Daughter", "2015-11-30", "female", True),
                ("Luis", "Rivera", "Son", "2018-04-21", "male", True),
                ("Sofia", "Rivera", "Daughter", "2021-01-09", "female", False),
            )
        )
        for field, value in zip(
            (
                "first_name",
                "last_name",
                "relationship_to_applicant",
                "date_of_birth",
                "adult.sex",
                "adult.citizen_or_national",
            ),
            person,
        )
    },
    "income.has_earned_income": True,
    "income.has_self_employment": False,
    "income.earned.0.person_name": "Marisol Rivera",
    "income.earned.0.employer_name": "Cocina Sabor LLC",
    "income.earned.0.hours_per_week": "32",
    "income.earned.0.pay_frequency": "every_two_weeks",
    "income.earned.1.person_name": "Diego Rivera",
    "income.earned.1.employer_name": "Barton Springs Nursery",
    "income.earned.1.hours_per_week": "18",
    "income.earned.1.pay_frequency": "weekly",
    "income.has_unearned_income": True,
    "income.unearned.0.source": "Child support",
    "income.unearned.0.person_name": "Ana Rivera",
    "income.unearned.0.reported_amount": "250",
    "income.unearned.0.reported_frequency": "monthly",
    "income.unearned.1.source": "Unemployment",
    "income.unearned.1.person_name": "Diego Rivera",
    "income.unearned.1.reported_amount": "410",
    "income.unearned.1.reported_frequency": "twice_a_month",
    "expenses.has_household_expenses": True,
    "expenses.household.0.kind": "rent_or_mortgage",
    "expenses.household.0.amount_monthly": "1450",
    "expenses.household.1.kind": "electricity",
    "expenses.household.1.amount_monthly": "180",
    "expenses.household.2.kind": "telephone",
    "expenses.household.2.amount_monthly": "65",
    "expenses.has_dependent_care": True,
    "expenses.pays_child_support": False,
    "expenses.has_medical_expenses": False,
    "resources.has_accounts": True,
    "resources.has_real_property": False,
    "resources.has_personal_property": False,
    "resources.has_vehicles": True,
    "household.homeless": False,
    "household.institutional_living": False,
    "household.disability_limits_activities": True,
    "household.anyone_pregnant": False,
    "household.military_service": False,
    "household.authorized_representative": True,
    "household.authorized_representative.0.name": "Rosa Delgado",
    "household.authorized_representative.0.organization": "Austin Legal Aid",
    "household.authorized_representative.0.phone": "5125559981",
    "household.authorized_representative.0.address.street": "500 E 7th St",
    "household.authorized_representative.0.address.city": "Austin",
    "household.authorized_representative.0.address.state": "TX",
    "household.authorized_representative.0.address.zip_code": "78701",
}


def _box_for(locale: str, key: str):
    """The measured box `key` lands in on `locale`'s edition."""
    from benefits_navigator.formmap.documents import resolve_for_definition

    definition = definition_for_form("TX_H1010")
    swapped, _ = resolve_for_definition(definition, locale)
    target = swapped.mapping_for(key).target

    return target.box, target


def _draw_in(draws, box, text):
    """Whether `text` is drawn inside `box`. The semantic assertion."""
    return any(
        draw.page == box.page
        and box.x - 1.0 <= draw.x <= box.right + 1.0
        and box.y - 2.0 <= draw.y <= box.top + 2.0
        and draw.text == text
        for draw in draws
    )


class TestSemanticPlacement:
    """Values land in the box that answers their own printed question.

    Not "the file is the right size" and not "the digest matches" — those say
    the right *document* was chosen. These say the right *box* was filled, on
    the page that prints the question the value answers, which is the only
    property that makes a prefilled government form useful rather than
    dangerous.
    """

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_nothing_overflows_or_goes_unplaced(self, locale):
        generated, _ = _drawn(locale)

        assert generated.render_plan.unfitted == []
        assert generated.render_plan.unplaced == []

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_each_person_lands_in_their_own_printed_block(self, locale):
        """The row-index error this form is most exposed to.

        Section H prints four blocks asking identical questions. An off-by-one
        writes a child's name and birth date on their parent's line, and the
        rendered form looks perfectly normal.
        """
        _, draws = _drawn(locale)

        for row, first_name in enumerate(("Diego", "Ana", "Luis", "Sofia")):
            box, _ = _box_for(locale, f"household.members.{row}.first_name")

            assert _draw_in(draws, box, first_name), (
                f"{first_name} is not in person block {row + 2}'s first-name "
                f"box on the {locale} edition"
            )

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_person_blocks_are_on_the_pages_that_print_them(self, locale):
        """Persons 2-3 on PDF page 8, persons 4-5 on page 9."""
        for row in range(4):
            box, _ = _box_for(locale, f"household.members.{row}.first_name")

            assert box.page == 8 + row // 2, row

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_birth_date_is_one_digit_per_printed_cell(self, locale):
        """Eight cells, eight draws, in order, spelling the date."""
        _, draws = _drawn(locale)
        _, target = _box_for(locale, "household.members.0.date_of_birth")

        assert len(target.segments) == 8

        cells = sorted(target.segments, key=lambda segment: segment.box.x)
        spelled = ""

        for segment in cells:
            found = [
                draw.text
                for draw in draws
                if draw.page == segment.box.page
                and segment.box.x - 1.0 <= draw.x <= segment.box.right
                # The digit is centred and sits on a baseline inset from the
                # cell's bottom, so the cell's own extent is the right window.
                and segment.box.y - 2.0 <= draw.y <= segment.box.top
                and len(draw.text) == 1
            ]

            assert found, f"cell at x={segment.box.x:.1f} is empty"
            spelled += found[0]

        assert spelled == "07021989"

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_housing_cost_lands_in_the_box_for_its_kind(self, locale):
        """The pivot, asserted where it matters: rent in the rent box.

        The intake collects bills as an indexed list carrying a kind; the form
        prints one labelled amount box per kind. A pivot that dropped the kind
        would put the electricity bill in the rent box, and the page would look
        entirely reasonable.
        """
        _, draws = _drawn(locale)

        for kind, amount in (
            ("rent_or_mortgage", "1,450"),
            ("electricity", "180"),
            ("telephone", "65"),
        ):
            box, _ = _box_for(locale, f"expenses.household.by_kind.{kind}")

            assert _draw_in(draws, box, amount), (
                f"{amount} is not in the {kind} box on the {locale} edition"
            )

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_kind_with_no_bill_is_left_blank(self, locale):
        """The household has no gas bill, so the gas box stays empty."""
        _, draws = _drawn(locale)
        box, _ = _box_for(locale, "expenses.household.by_kind.gas")

        inside = [
            draw
            for draw in draws
            if draw.page == box.page
            and box.x - 1.0 <= draw.x <= box.right + 1.0
            and box.y - 2.0 <= draw.y <= box.top + 2.0
        ]

        assert inside == []

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_each_job_lands_in_its_own_printed_block(self, locale):
        _, draws = _drawn(locale)

        for row, name in enumerate(("Marisol Rivera", "Diego Rivera")):
            box, _ = _box_for(locale, f"income.earned.{row}.person_name")

            assert _draw_in(draws, box, name), (
                f"job {row + 1}'s earner is not in its own block ({locale})"
            )

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_apartment_number_reaches_the_address_line(self, locale):
        """One printed box, two intake answers — and the second used to vanish.

        H1010 prints "Home address" as a single line with no apartment box, so
        an apartment number written into the street key alone had nowhere to
        go. ``JoinValues`` puts both on the line a person would write them on.
        """
        _, draws = _drawn(locale)
        box, _ = _box_for(locale, "applicant.home_address.street_line")

        assert _draw_in(draws, box, "2100 Nueces Street, Apt 3")

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_derived_gateway_marks_the_circle_it_entails(self, locale):
        """"Money from a job or from working for yourself" is one question.

        The household said yes to earned income and no to self-employment, so
        the combined question is yes.
        """
        from benefits_navigator.formmap.forms.h1010_official import (
            HAS_JOB_OR_SELF_EMPLOYMENT,
        )

        _, draws = _drawn(locale)
        _, target = _box_for(locale, HAS_JOB_OR_SELF_EMPLOYMENT)

        marked = {
            option
            for option, box in target.option_boxes.items()
            if _draw_in(draws, box, "X")
        }

        assert marked == {"yes"}

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_gateway_with_an_unanswered_source_is_left_blank(self, locale):
        """Some No and the rest unanswered cannot make a No.

        The unanswered one might have been the Yes. Leaving the question blank
        asks the applicant; printing No answers for them.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.forms.h1010_official import (
            OWNS_LISTED_ITEMS,
        )

        partial = dict(SEMANTIC_HOUSEHOLD)
        partial["resources.has_accounts"] = False
        del partial["resources.has_personal_property"]

        generated = generate_form("TX_H1010", partial, locale=locale)
        _, target = _box_for(locale, OWNS_LISTED_ITEMS)

        marked = {
            option
            for option, box in target.option_boxes.items()
            if _draw_in(generated.render_plan.draws, box, "X")
        }

        assert marked == set()

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_representative_lands_in_appendix_c(self, locale):
        _, draws = _drawn(locale)

        for key, value in (
            ("household.authorized_representative.0.name", "Rosa Delgado"),
            (
                "household.authorized_representative.0.organization",
                "Austin Legal Aid",
            ),
            (
                "household.authorized_representative.0.address.city",
                "Austin",
            ),
        ):
            box, _ = _box_for(locale, key)

            assert box.page == 34, f"{key} is not on Appendix C"
            assert _draw_in(draws, box, value), f"{key} ({locale})"

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_no_value_is_drawn_over_printed_text(self, locale):
        """A value on a printed label is unreadable and cannot be keyed.

        The check that caught three real defects while this form was being
        mapped: the employer line measured above its label instead of below
        it, and two columns ran to the page margin over their neighbours.

        Word-level, not line-level: the extractor reports a Spanish amount row
        as one run containing the label, the ``$`` and the underscore rule that
        *is* the writing space, and a value belongs on that rule.
        """
        from benefits_navigator.formmap.measure import DocumentText
        from benefits_navigator.formmap.provenance import load_document

        document = TX_H1010_EN if locale == "en" else TX_H1010_ES
        text = DocumentText.of(load_document(document))
        _, draws = _drawn(locale)

        # The glyphs a value is meant to sit beside or over.
        allowed = {"$", "(", ")", "-", "/"}

        collisions: list[str] = []

        for draw in draws:
            for word in text.words:
                if word.page != draw.page:
                    continue

                stripped = word.text.strip()

                if stripped in allowed or set(stripped) <= set("_ ."):
                    continue

                # A drawn string's own extent, approximated by its font size:
                # enough to catch a box measured against the wrong row.
                width = len(draw.text) * draw.size * 0.55
                overlap_x = min(draw.x + width, word.right) - max(
                    draw.x, word.x
                )
                overlap_y = min(draw.y + draw.size, word.top) - max(
                    draw.y, word.y
                )

                if overlap_x > 3.0 and overlap_y > 3.0:
                    collisions.append(
                        f"{draw.text!r} on page {draw.page} over "
                        f"{stripped!r}"
                    )

        assert collisions == [], collisions[:8]


class TestTheEditionsCannotBeConfused:
    """English coordinates cannot be used on the Spanish form, or vice versa.

    The requirement's sharpest ask, and the reason each edition carries a
    complete target map rather than overriding a shared one. A Spanish
    applicant filled at English coordinates gets a form that renders without
    error, onto a page where every question sits somewhere else.
    """

    def test_no_mapped_field_shares_a_box_between_the_editions(self):
        """Not one of them. If any did, it would be the one that goes wrong."""
        from benefits_navigator.formmap.documents import resolve_for_definition

        definition = definition_for_form("TX_H1010")
        english, _ = resolve_for_definition(definition, "en")
        spanish, _ = resolve_for_definition(definition, "es")

        shared: list[str] = []

        for key in definition.keys():
            en_target = english.mapping_for(key).target
            es_target = spanish.mapping_for(key).target

            if _boxes_of_target(en_target) == _boxes_of_target(es_target):
                shared.append(key)

        assert shared == [], (
            f"{len(shared)} field(s) resolve to identical boxes on both "
            f"editions, which means one of them is measured against the wrong "
            f"document: {shared[:6]}"
        )

    def test_english_boxes_land_on_printed_text_of_the_spanish_form(self):
        """The positive proof that the two layouts are incompatible.

        Swapping the editions is not a cosmetic difference: drawing the English
        placements onto the Spanish document puts values over printed Spanish
        questions. This asserts that, so nobody can conclude the two maps are
        interchangeable because both "look fine".
        """
        from benefits_navigator.formmap.documents import resolve_for_definition
        from benefits_navigator.formmap.measure import DocumentText
        from benefits_navigator.formmap.provenance import load_document

        definition = definition_for_form("TX_H1010")
        english, _ = resolve_for_definition(definition, "en")
        spanish_text = DocumentText.of(load_document(TX_H1010_ES))

        from benefits_navigator.formmap.render import plan_render

        report = resolve_mappings(english, SEMANTIC_HOUSEHOLD)
        plan = plan_render(list(report.fields))

        collisions = 0

        for draw in plan.draws:
            for word in spanish_text.words:
                if word.page != draw.page:
                    continue

                stripped = word.text.strip()

                if len(stripped) < 3 or set(stripped) <= set("_ ."):
                    continue

                width = len(draw.text) * draw.size * 0.55

                if (
                    min(draw.x + width, word.right) - max(draw.x, word.x) > 3.0
                    and min(draw.y + draw.size, word.top)
                    - max(draw.y, word.y)
                    > 3.0
                ):
                    collisions += 1
                    break

        assert collisions > 5, (
            "the English placements sit cleanly on the Spanish document, "
            "which would mean the two editions share a layout — they do not, "
            "so this test is measuring the wrong thing"
        )

    @pytest.mark.parametrize(
        "key",
        [
            "applicant.first_name",
            "household.members.0.first_name",
            "household.members.3.date_of_birth",
            "income.earned.0.person_name",
            "expenses.household.by_kind.rent_or_mortgage",
            "household.authorized_representative.0.name",
        ],
    )
    def test_a_representative_field_differs_by_more_than_rounding(self, key):
        """Named fields across the form, each measurably in a different place."""
        from benefits_navigator.formmap.documents import resolve_for_definition

        definition = definition_for_form("TX_H1010")
        english, _ = resolve_for_definition(definition, "en")
        spanish, _ = resolve_for_definition(definition, "es")

        en_boxes = _boxes_of_target(english.mapping_for(key).target)
        es_boxes = _boxes_of_target(spanish.mapping_for(key).target)

        assert en_boxes and es_boxes
        assert en_boxes != es_boxes, key


def _boxes_of_target(target) -> tuple:
    """Every box a target draws into, as comparable numbers."""
    return tuple(
        (box.page, round(box.x, 2), round(box.y, 2))
        for box in target.boxes()
    )


# ---------------------------------------------------------------------------
# Marks land inside the circles the form prints
# ---------------------------------------------------------------------------


class TestMarksAreCentredInTheirCircles:
    """A mark belongs inside its printed circle, not beside it.

    H1010 says "Fill in the circles ( ) like this", and a caseworker reads a
    mark that sits between two circles as either or neither. Before the marks
    were placed on the circles themselves they were offset from the option's
    printed *word*, and measuring all 332 targets showed the error was neither
    small nor uniform: up to 4.2 points on the English edition and 5.6 on the
    Spanish, with a standard deviation of 1.3 — in a circle 8 points across.

    So a single corrective offset was never available, which is why these tests
    assert against the circle each mark actually lands in rather than against a
    remembered coordinate.

    ── Why this reads pixels ──────────────────────────────────────────────────
    The circles are bezier subpaths placed by a transformation matrix and carry
    no text, so neither the extracted words nor the drawn rectangles can find
    them. Rendering the page and looking for a closed, hollow ring of the right
    size is what ``PageInk`` does for the measurement step, and this asserts on
    the same measurement the placements were derived from — which is the point:
    if the detector and the placements ever disagree, that is a real defect.
    """

    @staticmethod
    def _mark_targets(definition):
        from benefits_navigator.formmap.targets import FieldKind

        return [
            mapping
            for mapping in definition.fields
            if mapping.kind in (FieldKind.CHOICE, FieldKind.CHECKBOX)
        ]

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_every_mark_sits_inside_a_printed_circle(self, locale):
        """All 166 of them, on the edition they belong to."""
        from benefits_navigator.formmap.measure import DocumentText
        from benefits_navigator.formmap.provenance import load_document

        document = TX_H1010_EN if locale == "en" else TX_H1010_ES
        text = DocumentText.of(load_document(document))
        boxes = load_measurements(document)

        assert text.ink is not None, "measuring circles needs a rendered page"

        checked = 0
        strays: list[str] = []

        for mapping in self._mark_targets(definition_for_form("TX_H1010")):
            for box in boxes[mapping.key]:
                circle = text.ink.circle_near(box)

                if circle is None:
                    strays.append(
                        f"{mapping.key} on page {box.page}: no printed circle "
                        f"within reach of the mark box"
                    )
                    continue

                checked += 1

                mark_x = box.x + box.width / 2
                mark_y = box.y + box.height / 2
                circle_x = circle.x + circle.width / 2
                circle_y = circle.y + circle.height / 2

                # Within a tenth of a point of the circle's own centre. The
                # tolerance is this tight because the mark box *is* derived
                # from the circle: anything larger would mean the derivation
                # and the detector disagree.
                offset = max(abs(mark_x - circle_x), abs(mark_y - circle_y))

                if offset > 0.15:
                    strays.append(
                        f"{mapping.key} on page {box.page}: mark centre is "
                        f"{offset:.2f}pt from the circle's"
                    )

        assert strays == [], strays[:8]
        assert checked > 160, f"only {checked} mark targets were checked"

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_mark_never_extends_beyond_its_circle(self, locale):
        """The glyph is drawn inside the box; the box must be inside the ring.

        Centred is not sufficient: a mark box wider than the circle would be
        centred and still print over the printed outline.
        """
        from benefits_navigator.formmap.measure import DocumentText
        from benefits_navigator.formmap.provenance import load_document

        document = TX_H1010_EN if locale == "en" else TX_H1010_ES
        text = DocumentText.of(load_document(document))
        boxes = load_measurements(document)

        oversized: list[str] = []

        for mapping in self._mark_targets(definition_for_form("TX_H1010")):
            for box in boxes[mapping.key]:
                circle = text.ink.circle_near(box)

                if circle is None:
                    continue

                if box.width > circle.width or box.height > circle.height:
                    oversized.append(
                        f"{mapping.key} on page {box.page}: mark box is "
                        f"{box.width:.2f}x{box.height:.2f} in a "
                        f"{circle.width:.2f}x{circle.height:.2f} circle"
                    )

        assert oversized == [], oversized[:8]

    def test_the_two_editions_mark_different_circles(self):
        """The circles are not in the same place, so neither are the marks.

        The guarantee that makes independent measurement worth the effort: if
        any mark resolved to the same coordinates on both documents, one of
        them would be measured against the wrong page.
        """
        english = load_measurements(TX_H1010_EN)
        spanish = load_measurements(TX_H1010_ES)

        shared: list[str] = []

        for mapping in self._mark_targets(definition_for_form("TX_H1010")):
            en_boxes = [
                (b.page, round(b.x, 2), round(b.y, 2))
                for b in english[mapping.key]
            ]
            es_boxes = [
                (b.page, round(b.x, 2), round(b.y, 2))
                for b in spanish[mapping.key]
            ]

            if en_boxes == es_boxes:
                shared.append(mapping.key)

        assert shared == [], shared[:6]

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_drawn_mark_lands_within_its_circle(self, locale):
        """End to end: the glyph the renderer emits, against the printed ring.

        The tests above check the *boxes*. This checks what is actually drawn
        for a real household, because the renderer centres and shrinks a mark
        inside its box and a bug there would not move a single coordinate.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.measure import DocumentText
        from benefits_navigator.formmap.provenance import load_document

        document = TX_H1010_EN if locale == "en" else TX_H1010_ES
        text = DocumentText.of(load_document(document))

        generated = generate_form("TX_H1010", SEMANTIC_HOUSEHOLD, locale=locale)
        marks = [draw for draw in generated.render_plan.draws if draw.text == "X"]

        assert len(marks) > 12, f"only {len(marks)} marks drawn"

        strays: list[str] = []

        for mark in marks:
            # The glyph's own extent, from its font size.
            width = mark.size * 0.6
            centre_x = mark.x + width / 2
            centre_y = mark.y + mark.size * 0.36

            probe = Box(
                page=mark.page,
                x=centre_x - 1.0,
                y=centre_y - 1.0,
                width=2.0,
                height=2.0,
            )
            circle = text.ink.circle_near(probe, reach=6.0)

            if circle is None:
                strays.append(
                    f"a mark on page {mark.page} at x={mark.x:.1f} "
                    f"y={mark.y:.1f} is not inside any printed circle"
                )
                continue

            if not (
                circle.x <= centre_x <= circle.x + circle.width
                and circle.y <= centre_y <= circle.y + circle.height
            ):
                strays.append(
                    f"a mark on page {mark.page} sits outside the circle "
                    f"nearest it"
                )

        assert strays == [], strays[:6]


# ---------------------------------------------------------------------------
# Who is applying for what
# ---------------------------------------------------------------------------

#: One household where every person has a different answer.
#:
#: The applicant wants food benefits, the spouse wants cash help, the child
#: wants CHIP, and the fourth person is applying for nothing. A fixture where
#: everyone wants the same thing cannot tell a correct mapping from one that
#: marks every circle it can find.
MIXED_PROGRAMS: dict = {
    "applicant.first_name": "Marisol",
    "applicant.last_name": "Rivera",
    "applicant.home_address.zip_code": "78702",
    # The household's own selection, which Section A asks about the case as a
    # whole. Deliberately a superset of any one person's.
    "programs.tx_snap": True,
    "programs.tx_tanf": True,
    # Person 1: food benefits only.
    "applicant.programs.tx_snap": True,
    # Person 2, the spouse: cash help only.
    "household.members.0.first_name": "Diego",
    "household.members.0.last_name": "Rivera",
    "household.members.0.relationship_to_applicant": "Spouse",
    "household.members.0.programs.tx_tanf": True,
    # Person 3, a child: CHIP, which has no markable circle.
    "household.members.1.first_name": "Ana",
    "household.members.1.last_name": "Rivera",
    "household.members.1.relationship_to_applicant": "Daughter",
    "household.members.1.programs.tx_chip": True,
    # Person 4: not applying for anything.
    "household.members.2.first_name": "Rosa",
    "household.members.2.last_name": "Rivera",
    "household.members.2.relationship_to_applicant": "Mother",
}


class TestPerPersonPrograms:
    """H1010 asks who is applying, not only what the household wants.

    Every person block prints its own "mark the benefits Person N is applying
    for" circles. Filling them from the household's selection would file a
    claim for a grandmother who is not applying, on a form she signs — so each
    person's circles come from their own answer and from nothing else.
    """

    @staticmethod
    def _marked(locale: str, key: str) -> bool:
        from benefits_navigator.formmap import generate_form

        generated = generate_form("TX_H1010", MIXED_PROGRAMS, locale=locale)

        return key in generated.filled_keys

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_each_person_gets_only_the_circles_they_asked_for(self, locale):
        expected = {
            "applicant.programs.tx_snap": True,
            "applicant.programs.tx_tanf": False,
            "household.members.0.programs.tx_tanf": True,
            "household.members.0.programs.tx_snap": False,
            "household.members.1.programs.tx_snap": False,
            "household.members.1.programs.tx_tanf": False,
            "household.members.2.programs.tx_snap": False,
            "household.members.2.programs.tx_tanf": False,
        }

        for key, should_be_marked in expected.items():
            assert self._marked(locale, key) is should_be_marked, (
                f"{key} on the {locale} edition"
            )

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_person_applying_for_nothing_has_no_circle_marked(self, locale):
        """The case that makes silent inference visible.

        Person 4 lives in the home and is not applying. The household *is*
        applying for SNAP and TANF, so a mapping that read the household answer
        would mark both of her circles.
        """
        from benefits_navigator.formmap.forms.h1010_official import (
            PERSON_PROGRAM_CIRCLES,
        )

        for program in PERSON_PROGRAM_CIRCLES:
            assert not self._marked(
                locale, f"household.members.2.programs.{program}"
            )

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_the_household_block_is_still_marked_from_the_household(
        self, locale
    ):
        """Section A asks a different question, and keeps its own answer.

        "Mark the benefits anyone on your case is applying for" is true of the
        household even when no single person asked for all of them.
        """
        assert self._marked(locale, "programs.tx_snap")
        assert self._marked(locale, "programs.tx_tanf")

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_health_programme_marks_no_circle_and_is_reported(self, locale):
        """CHIP has no markable circle, and the applicant is told which to fill.

        The person block's five "Medicaid or CHIP for:" circles divide by
        eligibility category. Ana's CHIP answer does not choose among them and
        her age does not either, so the circle stays hers to fill — and the
        review sheet names her rather than leaving a blank nobody explains.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.review_words import words_for

        generated = generate_form("TX_H1010", MIXED_PROGRAMS, locale=locale)

        assert "household.members.1.programs.tx_chip" not in (
            generated.filled_keys
        )

        sheet = generated.review_text
        action = words_for(locale).no_box_actions[
            "uncollected_tx_h1010_person_medicaid_category"
        ]

        assert "Person 3 is applying for CHIP" in sheet
        assert action in sheet

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_each_persons_circles_are_in_their_own_printed_block(self, locale):
        """The right circles, and on the right person's page.

        Person 1 is in Section G on printed page 3; persons 2 and 3 are in
        Section H on printed page 4. A mapping that placed everyone's circles
        in one block would mark the right number of them in the wrong places.
        """
        from benefits_navigator.formmap.documents import resolve_for_definition

        definition = definition_for_form("TX_H1010")
        swapped, _ = resolve_for_definition(definition, locale)

        pages = {
            "applicant.programs.tx_snap": 7,
            "household.members.0.programs.tx_tanf": 8,
            "household.members.1.programs.tx_snap": 8,
            "household.members.2.programs.tx_snap": 9,
            "household.members.3.programs.tx_snap": 9,
        }

        for key, page in pages.items():
            box = swapped.mapping_for(key).target.box

            assert box.page == page, key

    def test_the_two_editions_place_the_circles_differently(self):
        from benefits_navigator.formmap.documents import resolve_for_definition

        definition = definition_for_form("TX_H1010")
        english, _ = resolve_for_definition(definition, "en")
        spanish, _ = resolve_for_definition(definition, "es")

        for row in range(4):
            for program in ("tx_snap", "tx_tanf"):
                key = f"household.members.{row}.programs.{program}"
                en_box = english.mapping_for(key).target.box
                es_box = spanish.mapping_for(key).target.box

                assert (round(en_box.x, 2), round(en_box.y, 2)) != (
                    round(es_box.x, 2),
                    round(es_box.y, 2),
                ), key


class TestPerPersonQuestions:
    """Marital status, Texas residency and school, asked once per person."""

    ANSWERS: dict = {
        **MIXED_PROGRAMS,
        "applicant.household.lives_in_texas": True,
        "applicant.household.plans_to_stay_in_texas": True,
        "applicant.household.marital_status": "married",
        "household.members.0.adult.marital_status": "married",
        "household.members.0.adult.lives_in_texas": True,
        "household.members.0.adult.plans_to_stay_in_texas": True,
        "household.members.0.adult.attends_school": False,
        "household.members.1.child.lives_in_texas": True,
        "household.members.1.child.plans_to_stay_in_texas": True,
        "household.members.1.child.attends_school": True,
        "household.members.1.child.full_time_student": True,
        "household.members.2.adult.marital_status": "widowed",
        "household.members.2.adult.lives_in_texas": False,
        "household.members.2.adult.plans_to_stay_in_texas": False,
    }

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_every_per_person_answer_reaches_the_form(self, locale):
        from benefits_navigator.formmap import generate_form

        filled = set(
            generate_form("TX_H1010", self.ANSWERS, locale=locale).filled_keys
        )

        for key in (
            "applicant.household.lives_in_texas",
            "applicant.household.plans_to_stay_in_texas",
            "applicant.household.marital_status",
            "household.members.0.adult.marital_status",
            "household.members.0.adult.lives_in_texas",
            "household.members.0.adult.attends_school",
            "household.members.1.adult.lives_in_texas",
            "household.members.1.adult.attends_school",
            "household.members.1.adult.full_time_student",
            "household.members.2.adult.marital_status",
        ):
            assert key in filled, f"{key} on the {locale} edition"

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_a_child_answer_reaches_the_same_printed_column(self, locale):
        """One printed table, two canonical homes.

        Ana's residency is stored under `child.` and Diego's under `adult.`,
        because California prints two household tables. H1010 prints one, so
        either key answers the same column — through `alternate_keys`.
        """
        from benefits_navigator.formmap import generate_form

        generated = generate_form("TX_H1010", self.ANSWERS, locale=locale)
        answered = {
            resolved.key: resolved.source_key
            for resolved in generated.resolution.fields
        }

        assert (
            answered["household.members.1.adult.lives_in_texas"]
            == "household.members.1.child.lives_in_texas"
        )

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_marital_status_marks_one_circle_of_five(self, locale):
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.documents import resolve_for_definition

        generated = generate_form("TX_H1010", self.ANSWERS, locale=locale)
        swapped, _ = resolve_for_definition(
            definition_for_form("TX_H1010"), locale
        )
        target = swapped.mapping_for(
            "household.members.2.adult.marital_status"
        ).target

        marked = [
            option
            for option, box in target.option_boxes.items()
            if any(
                draw.page == box.page
                and box.x - 1 <= draw.x <= box.right + 1
                and box.y - 2 <= draw.y <= box.top + 2
                and draw.text == "X"
                for draw in generated.render_plan.draws
            )
        ]

        assert marked == ["widowed"]

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_an_explicit_no_is_printed_as_no(self, locale):
        """Rosa does not live in Texas, and the form says so.

        A blank would read as unanswered, and HHSC would have to ask.
        """
        from benefits_navigator.formmap import generate_form
        from benefits_navigator.formmap.documents import resolve_for_definition

        generated = generate_form("TX_H1010", self.ANSWERS, locale=locale)
        swapped, _ = resolve_for_definition(
            definition_for_form("TX_H1010"), locale
        )
        target = swapped.mapping_for(
            "household.members.2.adult.lives_in_texas"
        ).target

        marked = [
            option
            for option, box in target.option_boxes.items()
            if any(
                draw.page == box.page
                and box.x - 1 <= draw.x <= box.right + 1
                and box.y - 2 <= draw.y <= box.top + 2
                and draw.text == "X"
                for draw in generated.render_plan.draws
            )
        ]

        assert marked == ["no"]

    @pytest.mark.parametrize("locale", ["en", "es"])
    def test_full_time_study_is_blank_for_someone_not_in_school(self, locale):
        """Diego is not in school, so the follow-up has no answer to print."""
        from benefits_navigator.formmap import generate_form

        generated = generate_form("TX_H1010", self.ANSWERS, locale=locale)

        assert "household.members.0.adult.full_time_student" not in (
            generated.filled_keys
        )
