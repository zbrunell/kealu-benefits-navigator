#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Texas H3037 — Report of Pregnancy.

The form that proves the packet model is worth building, because almost none of
it is ours to fill. Two pages, roughly twenty printed fields, and Navigator
legitimately knows exactly **one** of them — the patient's name, which the form
asks for twice.

A system that measured itself by boxes filled would score this form at 10% and
call it a failure. That is the wrong measure. The right one is whether the
applicant is left with less work and a clear picture of who does the rest, and
by that measure this form is a success: the applicant writes nothing on page 1,
takes it to their clinician, and signs page 2.

── The field audit ────────────────────────────────────────────────────────
Every printed field on both pages, classified. This is the whole document;
nothing is unaccounted for.

**Page 1 — the clinician's page** (printed in English only)

=================================  ================================
Printed field                      Classification
=================================  ================================
Name of Patient                    CANONICAL — the one we fill
Case Name (if different)           AGENCY
Case No.                           AGENCY
Month Pregnancy Began              THIRD_PARTY — clinician
Are multiple births anticipated?   THIRD_PARTY — clinician
If yes, number anticipated         THIRD_PARTY — clinician
Date of Expected Delivery          THIRD_PARTY — clinician
Should patient be exempt working?  THIRD_PARTY — clinician
Name (please type or print)        THIRD_PARTY — clinician
Signature - Physician / ANP / RN   SIGNATURE
Date (beside that signature)       SIGNATURE
Title, and Specify                 THIRD_PARTY — clinician
Address / Telephone No.            THIRD_PARTY — clinician
Name of Supervising Physician      THIRD_PARTY — clinician
Telephone No. (supervisor)         THIRD_PARTY — clinician
PLEASE RETURN TO: Caseworker       AGENCY
Date / Office Address and Phone    AGENCY
=================================  ================================

**Page 2 — the client's page** (printed in English *and* Spanish)

=================================  ================================
Printed field                      Classification
=================================  ================================
Patient's Name                     CANONICAL — the same fact again
I authorize [provider]             ASK_APPLICANT
This authorization expires on      ASK_APPLICANT
Client's Signature / Date          SIGNATURE
Authority to act for the client    ASK_APPLICANT (only if signing for)
Witness / Date (x2)                SIGNATURE
=================================  ================================

── Why the due date is not prefilled, even though we could ────────────────
The most interesting line in that table is the one that looks like an
oversight. H1010's Section C asks the applicant for their due date, so
``household.pregnancy.due_date`` is canonical and we could print it here.

We do not, because on *this* form the expected delivery date is not the
applicant's answer — it sits above a clinician's signature attesting that the
information is theirs. Printing our value into it would put words in a
clinician's mouth and hand them a form that is pre-agreed with. The same
real-world fact is Navigator's to fill on one form and a third party's on
another, which is why completion responsibility is declared per printed field
rather than per canonical key.

── Language ───────────────────────────────────────────────────────────────
One bilingual document, so the same file serves an English and a Spanish
applicant and the resolver reports ``BILINGUAL`` rather than a fallback. The
split matters and is worth stating plainly: page 2 — the authorization the
client signs — is printed in both languages, so a Spanish reader can read what
they are agreeing to. Page 1 is English only, which is defensible only because
page 1 is not theirs to complete; it is a clinician's page, and the form itself
says so ("Client complete page 2 / El cliente debe llenar la página 2").
"""

from __future__ import annotations

from benefits_navigator.formmap.definition import (
    DeclaredBlank,
    FieldMapping,
    FormDefinition,
    Responsibility,
)
from benefits_navigator.formmap.documents import DocumentVariant
from benefits_navigator.formmap.forms.tx_documents import TX_H3037_BILINGUAL
from benefits_navigator.formmap.measure import Anchor, Below, RightOf
from benefits_navigator.formmap.measurements import load_measurements
from benefits_navigator.formmap.targets import FieldKind, OverlayTarget

FORM_ID = "TX_H3037"

#: The patient's name, printed once on each page.
#:
#: One canonical fact, two printed boxes. The second is declared as an
#: alternate placement of the same mapping rather than as a second mapping with
#: a suffixed key, because a review sheet listing "Patient's name" twice is a
#: review sheet that has confused the form's layout for the applicant's work.
_PATIENT_NAME = "household.pregnancy.person_name"

_PAGE_1 = "Report of Pregnancy (clinician)"
_PAGE_2 = "Authorization to Release Medical Information (client)"


#: Where each canonical value sits on the official document.
#:
#: Read by ``tools/measure_texas_forms.py``; the boxes it derives are committed
#: to ``forms/measurements/`` and loaded below. Anchors, not coordinates —
#: see :mod:`benefits_navigator.formmap.measure`.
PLACEMENTS = {
    _PATIENT_NAME: (
        Below(Anchor("Name of Patient", page=1), height=15.0, gap=2.0),
        RightOf(
            Anchor("Patient’s Name/Nombre del paciente:", page=2),
            width=330.0,
            height=13.0,
            gap=8.0,
        ),
    ),
}


def _mappings() -> tuple[FieldMapping, ...]:
    """The one mapping this form has.

    The patient's name is printed twice — once on the clinician's page and once
    on the authorization the client signs — and both boxes are on this single
    mapping via ``also_draw_at``. One canonical fact, one question, two printed
    boxes: the applicant answers it once on the Texas intake and never sees it
    again.
    """
    boxes = load_measurements(TX_H3037_BILINGUAL)
    page_1_box, page_2_box = boxes[_PATIENT_NAME]

    return (
        FieldMapping(
            key=_PATIENT_NAME,
            kind=FieldKind.TEXT,
            target=OverlayTarget(
                box=page_1_box,
                also_draw_at=(page_2_box,),
                font_size=10.0,
            ),
            printed_label=(
                "Name of Patient (page 1), and Patient's Name / Nombre del "
                "paciente (page 2)"
            ),
            section=_PAGE_1,
        ),
    )


#: Every printed field we deliberately leave blank, and who must complete it.
#:
#: The list is the whole form minus the two boxes above. That completeness is
#: the point: a checklist assembled from it can tell an applicant exactly what
#: is left and who does it, and a test can assert that no printed field on this
#: document is unaccounted for.
BLANKS: tuple[DeclaredBlank, ...] = (
    DeclaredBlank(
        printed_label="Case Name (if different)",
        section=_PAGE_1,
        responsibility=Responsibility.AGENCY,
        reason_key="blank_agency_completes",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Case No.",
        section=_PAGE_1,
        responsibility=Responsibility.AGENCY,
        reason_key="blank_agency_completes",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Month Pregnancy Began",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Are multiple births anticipated?",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="If yes, indicate the number anticipated",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Date of Expected Delivery",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        # Not an oversight — see the module docstring.
        reason_key="blank_provider_must_attest_even_though_known",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Should patient be exempt from working?",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Name (please type or print)",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label=(
            "Signature — Physician, Advanced Nurse Practitioner, RN, or Other "
            "Medical Professional"
        ),
        section=_PAGE_1,
        responsibility=Responsibility.SIGNATURE,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Date (beside the medical professional's signature)",
        section=_PAGE_1,
        responsibility=Responsibility.SIGNATURE,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Title, and Specify",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Address and Telephone No.",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="Name of Supervising Physician, and Telephone No.",
        section=_PAGE_1,
        responsibility=Responsibility.THIRD_PARTY,
        completed_by_key="completed_by_medical_provider",
        page=1,
    ),
    DeclaredBlank(
        printed_label="PLEASE RETURN TO: Caseworker, Date, Office Address",
        section=_PAGE_1,
        responsibility=Responsibility.AGENCY,
        reason_key="blank_agency_completes",
        page=1,
    ),
    DeclaredBlank(
        printed_label=(
            "I authorize / Yo autorizo a — doctor, medical facility or other "
            "health care provider"
        ),
        section=_PAGE_2,
        responsibility=Responsibility.APPLICANT,
        reason_key="blank_applicant_names_their_provider",
        page=2,
    ),
    DeclaredBlank(
        printed_label="This authorization expires on / Esta autorización se vence el",
        section=_PAGE_2,
        responsibility=Responsibility.APPLICANT,
        page=2,
    ),
    DeclaredBlank(
        printed_label="Client or Personal Representative's Signature, and Date",
        section=_PAGE_2,
        responsibility=Responsibility.SIGNATURE,
        page=2,
    ),
    DeclaredBlank(
        printed_label="If you are signing for the client, describe your authority",
        section=_PAGE_2,
        responsibility=Responsibility.APPLICANT,
        reason_key="blank_only_if_signing_for_someone_else",
        page=2,
    ),
    DeclaredBlank(
        printed_label="Witness and Date (two, only if the client signs with a mark)",
        section=_PAGE_2,
        responsibility=Responsibility.SIGNATURE,
        reason_key="blank_only_if_client_signs_with_a_mark",
        page=2,
    ),
)


def build() -> FormDefinition:
    """The H3037 definition, measured against the official document."""
    fields = _mappings()

    variant = DocumentVariant(
        document=TX_H3037_BILINGUAL,
        targets={mapping.key: mapping.target for mapping in fields},
    )

    return FormDefinition(
        form_id=FORM_ID,
        form_code="H3037",
        title="Report of Pregnancy",
        state="TX",
        # Both, in one document. Not "en with an es sibling".
        document_language="en+es",
        page_count=TX_H3037_BILINGUAL.page_count,
        base_document=TX_H3037_BILINGUAL.filename,
        source_url=TX_H3037_BILINGUAL.source_url,
        fields=fields,
        blanks=BLANKS,
        variants=(variant,),
    )
