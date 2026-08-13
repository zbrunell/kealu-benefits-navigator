#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Classification of every field in the official SAWS 2 PLUS AcroForm.

Why this module exists
----------------------
The official SAWS 2 PLUS PDF contains 1,444 form fields whose names carry no
semantic information whatsoever — they are sequential widget names such as
``Text3 PG 1`` and ``Check Box26 PG 1``. The PDF has no ``/TU`` tooltips, no
``/TM`` mapping names, and no other metadata describing what any field means.

That has a hard consequence: the meaning of a destination field can only be
established by reviewing the widget's page and coordinates against the printed
form. It cannot be inferred from the name. ``Text3 PG 1``, for example, is the
applicant's **Social Security Number** — nothing in the name says so.

Because a wrong destination writes an applicant's data into the wrong box of a
form they sign under penalty of perjury, the adapter refuses to write to any
field that has not been explicitly reviewed (see
``Saws2PlusFieldAdapter.SAFE_FIELDS``). This module makes the resulting coverage
explicit and machine-checkable: every field in the PDF is assigned exactly one
classification, so "not yet reviewed" can never masquerade as "not applicable".
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any


class FieldClass(str, Enum):
    """How each SAWS 2 PLUS PDF field is accounted for."""

    #: Populated from an answer the user gave in our UI.
    MAPPED_FROM_UI = "mapped_from_ui"

    #: Populated from a value derived from other answers (ZIP → county, locale
    #: → language, first/middle/last → printed full name, …).
    MAPPED_FROM_DERIVED = "mapped_from_derived"

    #: Intentionally left blank: Social Security Number.
    MANUAL_SSN = "manual_ssn"

    #: Intentionally left blank: signature, or the date attached to a signature.
    MANUAL_SIGNATURE = "manual_signature"

    #: Printed "DO NOT COMPLETE — COUNTY USE ONLY".
    COUNTY_USE_ONLY = "county_use_only"

    #: Identified but deliberately not auto-filled; see NOT_APPLICABLE_REASONS.
    NOT_APPLICABLE = "not_applicable"

    #: Not yet reviewed against the printed form, therefore never written.
    #: This bucket is the honest remainder — it is tracked, not hidden.
    UNREVIEWED = "unreviewed"


#: Destinations that hold a Social Security Number.
#:
#: Established by reviewing widget coordinates against the printed form. These
#: are listed so the invariant "no SSN destination is ever writable" can be
#: asserted by name rather than by hoping a name contains the substring "ssn".
SSN_FIELDS: frozenset[str] = frozenset(
    {
        # Page 1, "SOCIAL SECURITY NUMBER (IF YOU HAVE ONE AND ARE APPLYING
        # FOR BENEFITS)" — the third box on the applicant's name row.
        "Text3 PG 1",
        # Page 3 adult household table, one SSN column per row.
        "Text17B PG 3",
        "Text35 PG 3",
        "Text53 PG 3",
        "Text71 PG 3",
        "Text89 PG 3",
        # Page 4 child household table, one SSN column per row.
        "Text19 PG 4",
        "Text38 PG 4",
        "Text57 PG 4",
        "Text76 PG 4",
        "Text95 PG 4",
    }
)

#: Destinations that are a signature, or the date written when signing.
#:
#: A signature date is part of the act of signing: prefilling it would assert
#: when the applicant signed. Both stay blank.
SIGNATURE_FIELDS: frozenset[str] = frozenset(
    {
        # Page 1 signature block: applicant, then spouse/other adult.
        "Text61 PG 1",
        "Text62 PG 1",
    }
)

#: Checkboxes printed "DO NOT COMPLETE - COUNTY USE ONLY" (form page 17,
#: the county's expedited-service determination).
COUNTY_USE_ONLY_FIELDS: frozenset[str] = frozenset(
    {
        "Check Box 2 pg 17",
        "Check Box3 pg 17",
        "Check Box4 pg 17",
        "Check Box5 pg 17",
        "Check Box6 pg 17",
        "Check Box7 pg 17",
        "Check Box8 pg 17",
        "Check Box9 pg 17",
    }
)

#: Reviewed destinations we deliberately do not auto-fill, with the reason.
#:
#: These have been identified against the printed page — their semantics are
#: known — but no answer in our model can fill them, so they stay blank rather
#: than being guessed.
NOT_APPLICABLE_REASONS: dict[str, str] = {
    "Text1 pg 17": (
        "Form page 17 'Additional Writing Space' — free-text overflow for "
        "answers that did not fit elsewhere. Our UI collects structured "
        "answers, so there is no overflow text to place here."
    ),
    # ---- Form page 9, reviewed but not collectable ----
    "Text39 PG 9": (
        "Page 9 'If this income is not expected to continue, please explain:' — "
        "we collect whether income is expected to continue but not a free-text "
        "explanation for it."
    ),
    "Check Box42 PG 9": (
        "Page 9 'In the last year?' follow-up to the job-change question. We "
        "collect the change date but not this separate yes/no window."
    ),
    "Check Box43 PG 9": "Page 9 'In the last year?' — No box; see Check Box42.",
    "Check Box44 PG 9": (
        "Page 9 'Did the County help the person get this job?' — not collected."
    ),
    "Check Box45 PG 9": (
        "Page 9 'Did the County help the person get this job?' — No box."
    ),
    "Text48 PG 9": (
        "Page 9 job-change 'DATE OF LAST PAY' — we collect the date of the "
        "change but not the date of the final paycheck."
    ),
    "Check Box50 PG 9": "Page 9 'IS ANYONE ON STRIKE?' — not collected.",
    "Check Box51 PG 9": "Page 9 'IS ANYONE ON STRIKE?' — No box.",
    "Text52 PG 9": "Page 9 strike row 'IF YES, WHO?' — not collected.",
    "Text53 PG 9": "Page 9 strike row 'DATE WENT ON STRIKE' — not collected.",
    "Text54 PG 9": "Page 9 strike row 'DATE OF LAST PAY' — not collected.",
    "Text55 PG 9": "Page 9 strike row 'REASON?' — not collected.",
}

#: Destinations whose value is derived rather than typed by the user.
DERIVED_FIELDS: frozenset[str] = frozenset(
    {
        # Composed from the separate first/middle/last inputs.
        "Text1 PG 1",
        # Resolved from the intake ZIP code.
        "Text6 PG 1",
        "Text7 PG 1",
        "Text8 PG 1",
        "Text12 PG 1",
        "Text13 PG 1",
        "Text14 PG 1",
        # Resolved from the session locale / preferred-language answer.
        "Text30 PG 1",
        "Text31 PG 1",
    }
)


def _page_label(field_name: str) -> str | None:
    """Return the ``PG n`` page label embedded in a field name, if any.

    Matching is case-insensitive because the form mixes ``PG 1`` and ``pg 17``.
    """
    import re

    match = re.search(r"PG\s*(\d+)\s*$", field_name, re.IGNORECASE)

    return match.group(1) if match else None


def classify_field(field_name: str, safe_fields: frozenset[str]) -> FieldClass:
    """Classify one SAWS 2 PLUS field.

    Privacy classifications win over everything else so that a destination can
    never be reported as writable and sensitive at the same time.
    """
    if field_name in SSN_FIELDS:
        return FieldClass.MANUAL_SSN

    if field_name in SIGNATURE_FIELDS:
        return FieldClass.MANUAL_SIGNATURE

    if field_name in NOT_APPLICABLE_REASONS:
        return FieldClass.NOT_APPLICABLE

    if field_name in COUNTY_USE_ONLY_FIELDS:
        return FieldClass.COUNTY_USE_ONLY

    if field_name in safe_fields:
        return (
            FieldClass.MAPPED_FROM_DERIVED
            if field_name in DERIVED_FIELDS
            else FieldClass.MAPPED_FROM_UI
        )

    return FieldClass.UNREVIEWED


def classify_form(pdf_path: Path | None = None) -> dict[str, FieldClass]:
    """Classify every field in the official SAWS 2 PLUS PDF."""
    from benefits_navigator.pdf_generator import (
        _FORMS_DIR,
        Saws2PlusFieldAdapter,
        inspect_pdf_form,
    )

    path = pdf_path or (_FORMS_DIR / "CA-SAWS-2-PLUS.pdf")
    safe_fields = frozenset(Saws2PlusFieldAdapter.SAFE_FIELDS)

    return {
        field["name"]: classify_field(field["name"], safe_fields)
        for field in inspect_pdf_form(path)
        if field.get("name")
    }


def coverage_summary(pdf_path: Path | None = None) -> dict[str, Any]:
    """Counts per classification, for reporting and tests."""
    classified = classify_form(pdf_path)
    counts: dict[str, int] = {member.value: 0 for member in FieldClass}

    for classification in classified.values():
        counts[classification.value] += 1

    writable = {
        name
        for name, classification in classified.items()
        if classification
        in {FieldClass.MAPPED_FROM_UI, FieldClass.MAPPED_FROM_DERIVED}
    }

    return {
        "total": len(classified),
        "counts": counts,
        "writable": writable,
    }
