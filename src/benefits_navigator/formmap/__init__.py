#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""A reusable PDF field-mapping layer for government benefit forms.

    canonical answer  →  form definition  →  native field OR coordinate box
                      →  measured, fitted, rendered  →  prefilled document

Four modules, each with one job:

``definition``
    The mapping model and :func:`~definition.resolve_mappings`, which does the
    entire mapping job with no PDF in sight. This is where mapping correctness
    is asserted.

``targets``
    Where a value goes: :class:`~targets.AcroFormTarget` for a form with real
    fields, :class:`~targets.OverlayTarget` for one without. Per field, not per
    form, so a half-fillable PDF needs one definition rather than two paths.

``transforms``
    Named, registered value formatting. A definition says ``"us_date"``; no
    renderer ever learns what a date is.

``render``
    Measures, fits, and draws what it is handed. Contains no coordinates and no
    form names.

``repeat``
    Printed tables: one canonical indexed collection drawn as a fixed number of
    printed rows, with the unused rows reported as not applicable rather than as
    unfinished work.

``pipeline`` ties them together, and ``registry`` maps a form id to a
definition so callers select a form instead of branching on a state.

── What this layer does not do ────────────────────────────────────────────
It does not generate California's SAWS 2 PLUS draft. That remains
``pdf_generator.generate_saws2_plus_pdf``, built against the real 1,444-field
AcroForm with its destinations reviewed against the printed pages and covered by
its own scenario and text-fitting suites. SAWS 2 PLUS is *described* here (see
``forms/saws2_plus.py``, derived from the live adapter tables) so the
abstraction is exercised by a native-field form and so form selection has one
entry point — but generation was left where it works.
"""

from __future__ import annotations

from benefits_navigator.formmap.definition import (
    Condition,
    FieldMapping,
    FormDefinition,
    FormDefinitionError,
    NotApplicable,
    ResolutionReport,
    ResolvedField,
    SensitiveFieldRefused,
    is_sensitive_key,
    resolve_mappings,
    validate_definition,
)
from benefits_navigator.formmap.pipeline import (
    GeneratedForm,
    NativeFieldFormNotRenderable,
    canonical_values_from_field_plan,
    generate_form,
    output_filename,
)
from benefits_navigator.formmap.registry import (
    UnknownForm,
    definition_for_form,
    declared_state_for,
    definitions,
    form_id_for_state,
    known_form_ids,
)
from benefits_navigator.formmap.repeat import RepeatingGroup
from benefits_navigator.formmap.render import (
    DrawnText,
    RenderPlan,
    plan_render,
)
from benefits_navigator.formmap.targets import (
    AcroFormTarget,
    Alignment,
    Box,
    FieldKind,
    FieldTarget,
    OverlayTarget,
)
from benefits_navigator.formmap.transforms import (
    registered_transforms,
    transform_for,
)

__all__ = [
    "AcroFormTarget",
    "Alignment",
    "Box",
    "Condition",
    "DrawnText",
    "FieldKind",
    "FieldMapping",
    "FieldTarget",
    "FormDefinition",
    "FormDefinitionError",
    "GeneratedForm",
    "NativeFieldFormNotRenderable",
    "NotApplicable",
    "OverlayTarget",
    "RenderPlan",
    "RepeatingGroup",
    "ResolutionReport",
    "ResolvedField",
    "SensitiveFieldRefused",
    "UnknownForm",
    "canonical_values_from_field_plan",
    "declared_state_for",
    "definition_for_form",
    "definitions",
    "form_id_for_state",
    "generate_form",
    "is_sensitive_key",
    "known_form_ids",
    "output_filename",
    "plan_render",
    "registered_transforms",
    "resolve_mappings",
    "transform_for",
    "validate_definition",
]
