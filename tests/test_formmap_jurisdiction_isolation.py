#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Neither state may leak into the other, or into what they share.

Three separate claims, and they fail in three different ways, so they are
asserted separately:

**A household gets its own state's form.** Asked of the registry, which reads
the state code each definition declares. If this breaks, an Austin family is
handed a California application.

**Neither form maps the other's answers.** H1010 has no box for "does everyone
applying live in California", and SAWS 2 PLUS has none for `programs.tx_snap`.
Not an error in either direction — it is a fact about two different pieces of
paper — but a form that quietly *did* map the other's key would print an answer
to a question its page does not ask.

**The shared layer branches on nothing.** The point of the whole mapping layer
is that adding Texas did not add a Texas branch, and this is where that stops
being an aspiration. The check reads the modules' syntax trees and fails on a
comparison against a form id, a state code or a programme name — the shapes a
jurisdiction branch actually takes. Comments and docstrings are exempt, because
explaining the design is the opposite of encoding it.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from benefits_navigator.formmap import (
    NativeFieldFormNotRenderable,
    definition_for_form,
    definitions,
    form_id_for_state,
    generate_form,
    known_form_ids,
)

# ---------------------------------------------------------------------------
# Which household gets which form
# ---------------------------------------------------------------------------


class TestFormSelection:
    @pytest.mark.parametrize(
        "state,form_id",
        [
            ("TX", "TX_H1010"),
            ("tx", "TX_H1010"),
            (" TX ", "TX_H1010"),
            ("CA", "CA_SAWS_2_PLUS"),
        ],
    )
    def test_a_state_resolves_to_its_own_form(self, state, form_id):
        assert form_id_for_state(state) == form_id

    @pytest.mark.parametrize("state", ["ND", "", "  ", "XX"])
    def test_a_state_we_do_not_cover_resolves_to_nothing(self, state):
        """None, not a default. A default here files the wrong application."""
        assert form_id_for_state(state) is None

    def test_no_two_forms_claim_the_same_state(self):
        states = [definition.state for definition in definitions()]

        assert len(set(states)) == len(states)

    def test_every_known_form_declares_the_state_it_serves(self):
        for form_id in known_form_ids():
            assert definition_for_form(form_id).state

    def test_the_registry_and_the_definition_agree_about_the_state(self):
        """The registry repeats the state so it can answer without building.

        A repeated fact is one that can disagree with itself, which here would
        mean routing a household to a form that serves somewhere else. Pinned
        rather than trusted.
        """
        from benefits_navigator.formmap import declared_state_for

        for form_id in known_form_ids():
            assert declared_state_for(form_id) == definition_for_form(form_id).state

    def test_asking_which_form_a_texas_household_files_builds_no_california(self):
        """Selecting Texas must not import California's generator, or pypdf.

        Building ``CA_SAWS_2_PLUS`` reads the SAWS adapter, which imports a
        5,000-line module and a PDF library. H1010 draws its own pages and
        needs neither, and a Texas draft that failed because California's
        importer did would be a coupling with no reason to exist.
        """
        import subprocess
        import sys

        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys\n"
                "from benefits_navigator.formmap import form_id_for_state\n"
                "assert form_id_for_state('TX') == 'TX_H1010'\n"
                "print('pdf_generator' in ' '.join(sys.modules))\n"
                "print('pypdf' in sys.modules)\n",
            ],
            capture_output=True,
            text=True,
            check=True,
        )

        assert result.stdout.split() == ["False", "False"], result.stdout


# ---------------------------------------------------------------------------
# Neither form maps the other's answers
# ---------------------------------------------------------------------------

#: Canonical keys that mean something only in California.
_CALIFORNIA_ONLY = (
    "household.california_resident",
    "household.cal_learn_history",
    "household.receives_ihss",
    "programs.medi_cal",
    "programs.calfresh",
    "programs.calworks",
    "services.chdp_medical",
)

#: Canonical keys that mean something only in Texas.
_TEXAS_ONLY = (
    "programs.tx_snap",
    "programs.tx_medicaid",
    "programs.tx_chip",
    "programs.tx_tanf",
)


@pytest.fixture(scope="module")
def h1010():
    return definition_for_form("TX_H1010")


@pytest.fixture(scope="module")
def saws():
    return definition_for_form("CA_SAWS_2_PLUS")


class TestNoCrossContamination:
    @pytest.mark.parametrize("key", _CALIFORNIA_ONLY)
    def test_the_texas_form_has_no_box_for_a_california_answer(self, h1010, key):
        assert h1010.mapping_for(key) is None

    @pytest.mark.parametrize("key", _TEXAS_ONLY)
    def test_the_california_form_has_no_box_for_a_texas_answer(self, saws, key):
        assert saws.mapping_for(key) is None

    def test_a_california_answer_reaching_texas_is_reported_not_rendered(
        self, h1010
    ):
        from benefits_navigator.formmap import resolve_mappings

        report = resolve_mappings(
            h1010,
            {
                "household.california_resident": True,
                "applicant.first_name": "Marisol",
            },
        )

        assert "household.california_resident" in report.unmapped
        assert "household.california_resident" not in report.rendered_values()
        assert report.rendered_values()["applicant.first_name"] == "Marisol"

    def test_the_two_forms_share_the_canonical_keys_that_are_genuinely_shared(
        self, h1010, saws
    ):
        """Isolation is not the same as having nothing in common.

        A name, a date of birth and an address mean the same thing in both
        states, and if the two forms had disjoint key sets it would mean the
        canonical layer had been forked per jurisdiction — which is the failure
        this whole layer exists to prevent.
        """
        shared = set(h1010.keys()) & set(saws.keys())

        for key in (
            "applicant.phone",
            "applicant.home_address.street",
            "applicant.home_address.city",
            "applicant.home_address.zip_code",
            "household.homeless",
            "household.expedited.migrant_or_seasonal_farm_worker",
        ):
            assert key in shared, key

        # Not a handful of coincidences: a substantial slice of California's
        # declared keys are answers Texas asks for too.
        assert len(shared) >= 20

    def test_no_definition_maps_a_key_naming_another_state(self):
        """A canonical key with a state in its name belongs to one form only."""
        for definition in definitions():
            other_state_markers = {
                "CA": ("tx_",),
                "TX": ("medi_cal", "calfresh", "calworks", "california"),
            }.get(definition.state, ())

            for key in definition.keys():
                for marker in other_state_markers:
                    assert marker not in key.lower(), (
                        f"{definition.form_id} maps {key}"
                    )


# ---------------------------------------------------------------------------
# Generation stays in its own lane
# ---------------------------------------------------------------------------


class TestGenerationRoutes:
    def test_the_mapping_layer_refuses_to_generate_the_native_field_form(self):
        """It describes SAWS 2 PLUS; ``pdf_generator`` fills it.

        A fall-through here produced a completely blank document that claimed
        to be a prefilled application, which is why this is a raise.
        """
        with pytest.raises(NativeFieldFormNotRenderable, match="CA_SAWS_2_PLUS"):
            generate_form("CA_SAWS_2_PLUS", {"applicant.phone": "5125551234"})

    def test_texas_goes_through_the_mapping_layer_and_says_it_is_a_worksheet(
        self, tmp_path
    ):
        import json

        from benefits_navigator.form_filler import generate_application

        fixture = (
            Path(__file__).resolve().parent.parent
            / "web"
            / "tests"
            / "fixtures"
            / "tx-h1010-scenarios.json"
        )
        plan = json.loads(fixture.read_text())[0]["fieldPlan"]

        path, kind = generate_application(
            {"state": "TX", "application_field_plan": plan}, "", tmp_path
        )

        assert kind == "worksheet"
        assert path.name.startswith("worksheet-tx-h1010-")
        assert path.read_bytes().startswith(b"%PDF-")
        # The promise the review sheet keeps, kept here too.
        assert path.with_suffix(".review.txt").exists()

    def test_the_filename_never_names_the_applicant(self, tmp_path):
        import json

        from benefits_navigator.form_filler import generate_application

        fixture = (
            Path(__file__).resolve().parent.parent
            / "web"
            / "tests"
            / "fixtures"
            / "tx-h1010-scenarios.json"
        )
        plan = json.loads(fixture.read_text())[0]["fieldPlan"]

        path, _ = generate_application(
            {"state": "TX", "application_field_plan": plan}, "", tmp_path
        )

        assert "marisol" not in path.name.lower()
        assert "ramirez" not in path.name.lower()

    def test_a_state_with_no_definition_falls_through_to_the_old_routes(
        self, tmp_path
    ):
        """Not an error. Most states have no form we can map yet."""
        from benefits_navigator.form_filler import _generate_mapped_form

        assert _generate_mapped_form("ND", [{"key": "a.b", "value": "c"}], tmp_path) is None

    def test_california_is_not_routed_through_the_mapping_layer(self, tmp_path):
        """Its fields are native, so this layer must decline rather than draw."""
        from benefits_navigator.form_filler import _generate_mapped_form

        assert (
            _generate_mapped_form(
                "CA", [{"key": "applicant.first_name", "value": "Maria"}], tmp_path
            )
            is None
        )


# ---------------------------------------------------------------------------
# The shared layer branches on nothing
# ---------------------------------------------------------------------------

#: Modules every form goes through. None may know which form it is serving.
#:
#: ``registry`` is deliberately absent: knowing which forms exist is its whole
#: job, and it is the one place that should.
_SHARED_MODULES = (
    "definition",
    "targets",
    "transforms",
    "textfit",
    "render",
    "repeat",
    "pipeline",
)

#: Strings that would mean a jurisdiction had been wired into shared code.
_JURISDICTION_TOKENS = (
    "tx_h1010",
    "ca_saws",
    "h1010",
    "saws",
    "texas",
    "california",
    "medi_cal",
    "calfresh",
    "calworks",
    "tx_snap",
    "hhsc",
    "cdss",
)


def _shared_source(name: str) -> tuple[str, ast.Module]:
    import importlib

    module = importlib.import_module(f"benefits_navigator.formmap.{name}")
    source = inspect.getsource(module)

    return source, ast.parse(source)


def _decision_strings(tree: ast.Module) -> list[str]:
    """Every string literal a decision is actually made on.

    Comparisons, dict keys, and ``match`` patterns — the three shapes a
    per-jurisdiction branch takes in Python. Docstrings and comments are not
    decisions and are not collected: this layer's modules explain at length
    which forms drove which design, and they should keep doing that.
    """
    found: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            for operand in [node.left, *node.comparators]:
                if isinstance(operand, ast.Constant) and isinstance(
                    operand.value, str
                ):
                    found.append(operand.value)

        elif isinstance(node, ast.Dict):
            for key in node.keys:
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    found.append(key.value)

        elif isinstance(node, ast.MatchValue):
            if isinstance(node.value, ast.Constant) and isinstance(
                node.value.value, str
            ):
                found.append(node.value.value)

    return found


class TestSharedLayerIsJurisdictionAgnostic:
    @pytest.mark.parametrize("name", _SHARED_MODULES)
    def test_no_decision_is_made_on_a_jurisdiction(self, name):
        _, tree = _shared_source(name)

        for value in _decision_strings(tree):
            lowered = value.lower()

            for token in _JURISDICTION_TOKENS:
                assert token not in lowered, (
                    f"formmap.{name} branches on {value!r}, which names a "
                    "jurisdiction. Put the difference in the form definition."
                )

    @pytest.mark.parametrize("name", _SHARED_MODULES)
    def test_no_shared_module_imports_a_form(self, name):
        _, tree = _shared_source(name)

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert "formmap.forms" not in (node.module or ""), name

            elif isinstance(node, ast.Import):
                for alias in node.names:
                    assert "formmap.forms" not in alias.name, name

    def test_the_registry_is_the_only_place_that_lists_the_forms(self):
        """It is allowed to name them; nothing else in the layer is."""
        source, _ = _shared_source("registry")

        assert "TX_H1010" in source
        assert "CA_SAWS_2_PLUS" in source

    @pytest.mark.parametrize("name", _SHARED_MODULES)
    def test_no_shared_module_reads_a_state_code_off_a_definition_to_branch(
        self, name
    ):
        """`definition.state` is data for a filename, never a switch."""
        _, tree = _shared_source(name)

        for node in ast.walk(tree):
            if not isinstance(node, ast.Compare):
                continue

            for operand in [node.left, *node.comparators]:
                if (
                    isinstance(operand, ast.Attribute)
                    and operand.attr in ("state", "form_id", "form_code")
                ):
                    raise AssertionError(
                        f"formmap.{name} compares against "
                        f"definition.{operand.attr}"
                    )
