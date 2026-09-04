#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""California SAWS 2 PLUS, expressed in the mapping layer's own terms.

**This module generates nothing.** California's draft is still produced by
``pdf_generator.generate_saws2_plus_pdf`` and ``Saws2PlusFieldAdapter``, which
were built against the real 1,444-field AcroForm, had every destination reviewed
against the printed pages, and carry a write allowlist plus 17 Python scenario
tests and a text-fitting suite. Replacing that with a newer abstraction would
risk the one flow that is already correct, for no gain.

What this module does is make SAWS 2 PLUS *describable* by the same layer that
describes H1010, for two concrete reasons:

1. **It proves the abstraction is not Texas-shaped.** A mapping layer that only
   models coordinate overlays would have quietly become an overlay library. The
   ``AcroFormTarget`` path exists because a real native-field form exercises it.
2. **It gives one entry point.** ``registry.definition_for_form`` answers "what
   is this form and how is it delivered" for both states, so callers select a
   form by id instead of branching on a state code.

── Derived, never retyped ─────────────────────────────────────────────────
The mappings below are read at import time from
``Saws2PlusFieldAdapter.TEXT_FIELDS``, ``PROGRAM_FIELDS``, ``YES_NO_FIELDS`` and
``SINGLE_CHECKBOX_FIELDS`` — the same dictionaries the generator writes from.
Copying those 276 destinations into a second table would guarantee the two
disagree the first time either is corrected, and a stale duplicate of a verified
mapping is worse than no duplicate at all.

So this definition cannot drift from the generator by construction. If a
destination is corrected in the adapter, it is corrected here on the next
import, and ``tests/test_formmap_saws2_parity.py`` asserts the two stay equal.
"""

from __future__ import annotations

from benefits_navigator.formmap.definition import (
    FieldMapping,
    FormDefinition,
    is_sensitive_key,
)
from benefits_navigator.formmap.targets import AcroFormTarget, FieldKind

#: Transforms the adapter applies to particular canonical keys.
#:
#: Only where the adapter demonstrably reformats a value. Everything else is
#: written through as-is, and claiming a transform where there is none would
#: make this description wrong in a way a test could not see.
_TRANSFORMS: dict[str, str] = {
    "applicant.date_of_birth": "us_date",
}


def _kind_for(key: str) -> FieldKind:
    if key.endswith("date_of_birth") or key.endswith("_date"):
        return FieldKind.DATE

    return FieldKind.TEXT


def _build() -> FormDefinition:
    # Imported here rather than at module scope: ``pdf_generator`` is a large
    # module that pulls in pypdf, and a definition registry should not force
    # that cost on a caller who only wants to look up a form id.
    from benefits_navigator.pdf_generator import Saws2PlusFieldAdapter

    adapter = Saws2PlusFieldAdapter()
    mappings: list[FieldMapping] = []
    seen: set[str] = set()

    def add(
        key: str,
        field_name: str,
        kind: FieldKind,
        *,
        on_state: str = "/Yes",
    ) -> None:
        # The adapter's tables are keyed by canonical key, but a few canonical
        # keys appear in more than one table (a program is both a checkbox and,
        # for "other", a text description). First declaration wins, and the
        # duplicate is skipped rather than raising: FormDefinition rejects
        # duplicates, and this describes an existing mapping rather than
        # policing it.
        if key in seen:
            return

        # Never describe a destination for a sensitive key, even if some future
        # edit to the adapter added one. The generator's own allowlist is the
        # real guard; this refuses to *document* one, which is how a mistake
        # there would surface in this layer's tests.
        if is_sensitive_key(key):
            return

        seen.add(key)

        mappings.append(
            FieldMapping(
                key=key,
                kind=kind,
                transform=_TRANSFORMS.get(key),
                printed_label=key.rsplit(".", 1)[-1].replace("_", " ").strip(),
                section=key.split(".", 1)[0],
                target=AcroFormTarget(name=field_name, on_state=on_state),
            )
        )

    for key, field_name in adapter.TEXT_FIELDS.items():
        add(key, field_name, _kind_for(key))

    for key, field_name in adapter.PROGRAM_FIELDS.items():
        add(key, field_name, FieldKind.CHECKBOX)

    for key, field_name in adapter.SINGLE_CHECKBOX_FIELDS.items():
        add(key, field_name, FieldKind.CHECKBOX)

    # A printed yes/no pair is one CHOICE field with two destinations. The
    # AcroForm target holds a single name, so the "yes" box is described here
    # and the pairing itself stays the adapter's business — this layer records
    # that the question exists and which field answers it affirmatively.
    for key, pair in adapter.YES_NO_FIELDS.items():
        add(key, pair[0], FieldKind.CHOICE)

    return FormDefinition(
        form_id="CA_SAWS_2_PLUS",
        form_code="SAWS 2 PLUS",
        title=(
            "Application for CalFresh, Cash Aid, and/or "
            "Medi-Cal/Health Care Programs"
        ),
        state="CA",
        document_language="en",
        page_width=612.0,
        page_height=792.0,
        page_count=29,
        # We hold the real fillable form, so there is nothing to overlay.
        base_document="CA-SAWS-2-PLUS.pdf",
        source_url=(
            "https://www.cdss.ca.gov/cdssweb/entres/forms/English/SAWS2PLUS.pdf"
        ),
        fields=tuple(mappings),
    )


SAWS2_PLUS_DEFINITION = _build()
