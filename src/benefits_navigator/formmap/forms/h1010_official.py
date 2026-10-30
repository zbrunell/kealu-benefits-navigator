#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""H1010 on HHSC's own paper, in both official editions.

This module replaces the thing the previous milestone could not have: a real
government form. What it maps is the same canonical data as before — the keys,
transforms and conditions are unchanged — but it lands on pages HHSC printed
rather than on pages we drew.

── One set of facts, two layouts ──────────────────────────────────────────
:data:`FIELD_SPECS` says what each canonical value *is*: its kind, its
transform, the printed question it answers, the section it belongs to.
:data:`PLACEMENTS_EN` and :data:`PLACEMENTS_ES` say where it goes on each
official edition, and they are written out separately because the editions are
genuinely different documents:

* the same question sits at a different y — ``First name`` is at 548.2 on the
  English page 1, ``Nombre`` at 530.1 on the Spanish one;
* the Spanish edition's phone template emits ``(`` and ``)`` as separate text
  runs where the English emits one ``( )``;
* the English edition has three usable AcroForm text fields and the Spanish has
  none;
* the footers differ — the Spanish edition prints ``H1010-S``, which is HHSC's
  own designation for it.

Nothing is shared between the two placement maps, and
:func:`~benefits_navigator.formmap.documents.validate_variant` fails a variant
that omits a key rather than letting it fall back to the other edition's
coordinates. That is the whole safety property: a Spanish applicant cannot be
handed a form filled at English coordinates.

── What is mapped ─────────────────────────────────────────────────────────
Every answer the Texas intake collects that H1010 has a box for. Across the
form that is Sections A through G on printed pages 1 to 3, Section H's four
person blocks, Sections K, N, O, P, Q, R and V, and Appendix C's authorized
representative; and, for a household applying for Medicaid or CHIP, the
Medicaid / CHIP addendum on PDF pages 26 to 34 — its Sections 1 to 6 and
Appendices A to C. See "The Medicaid / CHIP addendum" below.

What is *not* mapped is no longer a work queue. It is a classification, with a
concrete reason per answer, in
:mod:`benefits_navigator.formmap.forms.h1010_coverage`: either H1010 does not
ask the question, or it asks something adjacent enough to be a different
question. Those reasons reach the applicant through the review sheet, which
names each answer the form has no box for and what to do about it.

── Three shapes the form asks in ──────────────────────────────────────────
Not every answer lands in a box named after it, and the ones that do not are
handled by declared :class:`~benefits_navigator.formmap.definition.Derivation`
re-projections rather than by special cases:

* **Section P** prints one labelled amount box per *kind* of housing cost,
  where the intake collects an indexed list of bills each carrying its kind.
  ``PivotByKind`` re-keys them, and marks the circle beside each box it filled.
* **Sections B, N, O and Q** ask broader questions than the intake does — "any
  of these types of items", "working for someone else *or* for yourself".
  ``AnyYes`` answers them, and only when the answer is entailed: some No and
  the rest unanswered leaves the question blank rather than answering No.
* **Addresses and the payer line** get one printed box where the intake
  collects two answers. ``JoinValues`` writes both, which is what a person
  would do — an apartment number used to be dropped silently.

None of them invents a value. See ``Derivation`` for the line they may not
cross, and ``h1010_coverage`` for the one field where holding that line means
leaving a box blank.

── A note on the Medicaid / CHIP circles ──────────────────────────────────
Section A prints five circles under "Medicaid or CHIP": Children, Adult Caring
for a Child, Adult not Caring for a Child, Pregnant Women, Healthy Texas Women.
Our canonical model has ``programs.tx_medicaid`` and ``programs.tx_chip``, and
neither corresponds to any one of those circles — the circles divide by *who is
applying*, not by which of the two programs it is.

Marking one anyway would be choosing an eligibility category on an applicant's
behalf, on a Medicaid application, from data that does not determine it. So the
block is a :class:`~benefits_navigator.formmap.definition.DeclaredBlank` the
applicant completes, and the checklist tells them which programs they picked so
they can mark the right circle. One circle by hand beats the wrong circle
printed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from benefits_navigator.formmap.measure import (
    Above,
    AfterMarker,
    Anchor,
    Below,
    CellGrid,
    Over,
    PhoneSlots,
    RightOf,
    SameRow,
    SnapToCircle,
    SnapToSquare,
)
from benefits_navigator.formmap.definition import (
    AllOf,
    AnyYes,
    Condition,
    Derivation,
    JoinValues,
    PivotByKind,
)
from benefits_navigator.formmap.forms.h1010_coverage import NOT_ON_THIS_FORM
from benefits_navigator.formmap.repeat import RepeatingGroup
from benefits_navigator.formmap.targets import FieldKind

# ---------------------------------------------------------------------------
# What each canonical value is
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Spec:
    """The language-neutral half of a mapping: what this answer is."""

    key: str
    kind: FieldKind

    #: The printed question, in the English edition's own wording.
    #:
    #: Never translated for the review sheet: an applicant holding the Spanish
    #: form needs the Spanish wording, which is why a variant may override it.
    printed_label: str

    section: str

    transform: str | None = None

    #: For CHOICE: the canonical option values, in the order their boxes are
    #: measured. Zipped with the placement's boxes, so declaring three options
    #: and measuring two is caught at build time rather than marking the wrong
    #: circle.
    options: tuple[str, ...] = ()

    #: For a value split across printed cells: ``(start, end)`` per cell, over
    #: the rendered string with :attr:`segment_strip` removed.
    segments: tuple[tuple[int, int | None], ...] = ()

    segment_strip: str = ""

    optional: bool = False

    #: The Spanish edition's own wording for the same printed question.
    printed_label_es: str = ""

    #: Other canonical keys that answer the same printed question.
    #:
    #: H1010 prints one household table where the canonical model splits a
    #: person's details by whether they are an adult or a child. Either key
    #: answers this printed column — see ``FieldMapping.alternate_keys``.
    alternate_keys: tuple[str, ...] = ()

    #: When this printed box applies at all — see ``FieldMapping.applies_when``.
    #:
    #: Pages 1 to 25 declare none, which is unchanged. The Medicaid / CHIP
    #: addendum declares one on every box, because the whole addendum is for a
    #: household applying for health coverage.
    applies_when: Any = None

    #: Draw only beside this key's printed value — see
    #: ``FieldMapping.drawn_only_with``.
    drawn_only_with: str | None = None


_A = "Section A — Your Facts"
_B = "Section B — Food Benefits"
_C = "Section C — Pregnant Women"
_D = "Section D — Military Service"
_E = "Section E — Interview Help"
_F = "Section F — Contacting You"
_G = "Section G — Person 1"

#: The pregnant person's name.
#:
#: Canonical because H1010's Section C asks it ("If yes, who?") and H3037 asks
#: it twice, not because any form is named in it. It is the fact that makes the
#: packet's "tell us once" promise true across two documents: answered on the
#: Texas intake's pregnancy screen, it fills three printed boxes on two
#: different government forms without being asked again.
PREGNANCY_PERSON = "household.pregnancy.person_name"

#: The expected delivery date, as the *applicant* reports it.
#:
#: Prefilled on H1010, where the applicant is the one answering. Deliberately
#: left blank on H3037, where the same fact sits above a clinician's signature
#: attesting to it — see :mod:`benefits_navigator.formmap.forms.h3037`.
PREGNANCY_DUE_DATE = "household.pregnancy.due_date"


#: The address line as H1010 prints it: street and apartment in one box.
#:
#: The form prints "Home address" and "Mailing address" as single lines with no
#: separate apartment box, so an apartment number written into the street key
#: alone had nowhere to go and was silently dropped. Joined, it lands where a
#: person would write it.
HOME_ADDRESS_LINE = "applicant.home_address.street_line"
MAILING_ADDRESS_LINE = "applicant.mailing_address.street_line"


def payer_line(row: int) -> str:
    """Section O's one line for "the person or place that paid the money"."""
    return f"income.earned.{row}.payer"


#: One segment per printed cell of a ``MM / DD / YYYY`` grid.
#:
#: Eight cells, eight single characters, taken from the rendered date with the
#: separators stripped. Three segments — one per group — was the first attempt,
#: and it printed each digit half over the divider between its cells, because a
#: two-digit month centred across a two-cell group lands on the boundary. See
#: ``measure.CellGrid``.
DATE_CELL_SEGMENTS: tuple[tuple[int, int | None], ...] = tuple(
    (index, index + 1) for index in range(8)
)

#: The same, for a grid that prints only two year cells.
#:
#: Section C's due date is ``MM / DD / YY``. Positions 4 and 5 of the rendered
#: ``MMDDYYYY`` — the century — are skipped rather than truncated from the
#: right, so 2027 prints as ``27`` and not as ``20``.
DATE_CELL_SEGMENTS_SHORT_YEAR: tuple[tuple[int, int | None], ...] = (
    (0, 1), (1, 2), (2, 3), (3, 4), (6, 7), (7, 8),
)


FIELD_SPECS: tuple[Spec, ...] = (
    # --- Section A: who you are -------------------------------------------
    Spec("applicant.first_name", FieldKind.TEXT, "First name", _A,
         printed_label_es="Nombre"),
    Spec("applicant.middle_name", FieldKind.TEXT, "Middle name", _A,
         optional=True, printed_label_es="Segundo nombre"),
    Spec("applicant.last_name", FieldKind.TEXT, "Last name", _A,
         printed_label_es="Apellido"),
    Spec("applicant.date_of_birth", FieldKind.DATE,
         "Birth date (month/day/year)", _A, transform="us_date",
         segments=DATE_CELL_SEGMENTS, segment_strip="/",
         printed_label_es="Fecha de nacimiento (mes/día/año)"),
    # --- Section A: where your mail goes ----------------------------------
    Spec(MAILING_ADDRESS_LINE, FieldKind.TEXT, "Mailing address",
         _A, printed_label_es="Dirección postal"),
    Spec("applicant.mailing_address.city", FieldKind.TEXT, "City (mailing)", _A,
         printed_label_es="Ciudad (dirección postal)"),
    Spec("applicant.mailing_address.state", FieldKind.TEXT, "State (mailing)",
         _A, transform="state_code", printed_label_es="Estado (dirección postal)"),
    Spec("applicant.mailing_address.zip_code", FieldKind.TEXT, "Zip (mailing)",
         _A, transform="zip5", printed_label_es="Código postal (dirección postal)"),
    # --- Section A: phones -------------------------------------------------
    Spec("applicant.phone", FieldKind.TEXT, "Home phone", _A,
         transform="digits", segments=((0, 3), (3, 6), (6, 10)),
         printed_label_es="Teléfono de la casa"),
    Spec("applicant.alternate_phone", FieldKind.TEXT,
         "Cell or daytime phone", _A, transform="digits",
         segments=((0, 3), (3, 6), (6, 10)), optional=True,
         printed_label_es="Celular o teléfono durante el día"),
    # --- Section A: where you live ----------------------------------------
    Spec(HOME_ADDRESS_LINE, FieldKind.TEXT, "Home address", _A,
         printed_label_es="Dirección de la casa"),
    Spec("applicant.home_address.county", FieldKind.TEXT, "County", _A,
         printed_label_es="Condado"),
    Spec("applicant.home_address.city", FieldKind.TEXT, "City (home)", _A,
         printed_label_es="Ciudad (dirección de la casa)"),
    Spec("applicant.home_address.state", FieldKind.TEXT, "State (home)", _A,
         transform="state_code",
         printed_label_es="Estado (dirección de la casa)"),
    Spec("applicant.home_address.zip_code", FieldKind.TEXT, "Zip (home)", _A,
         transform="zip5",
         printed_label_es="Código postal (dirección de la casa)"),
    # --- Section A: which benefits ----------------------------------------
    Spec("programs.tx_snap", FieldKind.CHECKBOX, "SNAP Food Benefits", _A,
         printed_label_es="Beneficios de comida del programa SNAP"),
    Spec("programs.tx_tanf", FieldKind.CHECKBOX, "TANF Cash Help for Families",
         _A, printed_label_es="Ayuda de dinero en efectivo de TANF para familias"),
    # --- Section B: expedited screening -----------------------------------
    Spec("household.expedited.migrant_or_seasonal_farm_worker",
         FieldKind.CHOICE,
         "1. Is anyone in the home a migrant worker or seasonal farm worker?",
         _B, transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "1. ¿Hay alguien en su hogar que sea trabajador agrícola migrante "
             "o de temporada?"
         )),
    Spec("resources.has_accounts", FieldKind.CHOICE,
         "2. Does anyone in the home have money in the bank or cash?", _B,
         transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "2. ¿Tiene alguien en la casa dinero en el banco o en efectivo?"
         )),
    Spec("expenses.has_household_expenses", FieldKind.CHOICE,
         "4. Does anyone in the home pay costs for housing and utilities?", _B,
         transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "4. ¿Paga alguien en el hogar los gastos de vivienda y servicios "
             "públicos?"
         )),
    # --- Section C: pregnancy ---------------------------------------------
    Spec("household.anyone_pregnant", FieldKind.CHOICE,
         "Is anyone in your home pregnant?", _C, transform="yes_no",
         options=("yes", "no"),
         printed_label_es="¿Está embarazada alguien en su hogar?"),
    Spec(PREGNANCY_PERSON, FieldKind.TEXT, "If yes, who? (pregnancy)", _C,
         printed_label_es='Si contesta "Sí", ¿quién? (embarazo)'),
    Spec(PREGNANCY_DUE_DATE, FieldKind.DATE, "Due date", _C,
         transform="us_date", segments=DATE_CELL_SEGMENTS_SHORT_YEAR,
         segment_strip="/", optional=True, printed_label_es="Fecha de parto"),
    # --- Section D: military ----------------------------------------------
    Spec("household.military_service", FieldKind.CHOICE,
         "Is anyone a veteran, including being discharged or released from "
         "military service?", _D, transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "¿Es alguien veterano, incluso si ha sido dado de baja o ha "
             "salido del servicio militar?"
         )),
    # --- Section E: interview ---------------------------------------------
    Spec("applicant.preferred_language", FieldKind.TEXT,
         "3. What language do you want to speak during the interview?", _E,
         printed_label_es="3. ¿Qué idioma quiere hablar durante la entrevista?"),
    # --- Section F: contacting you ----------------------------------------
    Spec("applicant.email", FieldKind.TEXT, "E-mail", _F, optional=True,
         printed_label_es="Correo electrónico"),
    # --- Section G: person 1 details --------------------------------------
    Spec("applicant.household.marital_status", FieldKind.CHOICE,
         "Marital status", _G,
         options=("married", "single", "divorced", "separated", "widowed"),
         printed_label_es="Estado civil"),
    Spec("applicant.household.sex", FieldKind.CHOICE, "Male / Female", _G,
         options=("male", "female"), printed_label_es="Hombre / Mujer"),
    Spec("applicant.household.citizen_or_national", FieldKind.CHOICE,
         "Are you a U.S. citizen?", _G, transform="yes_no",
         options=("yes", "no"),
         printed_label_es="¿Es ciudadano de EE. UU.?"),
)


# ---------------------------------------------------------------------------
# The repeated blocks
# ---------------------------------------------------------------------------
#
# H1010 prints four person blocks (Section H, "Person 2" to "Person 5"), three
# job blocks (Section O), four money blocks (Section O, continued) and eight
# labelled housing-cost boxes (Section P). The *specs* for those are generated,
# because they are genuinely identical row to row and writing them out four
# times invites a transcription error that reads as a deliberate difference.
#
# Their *placements* are not generated: see PLACEMENTS_EN and PLACEMENTS_ES.

_H = "Section H — People Applying"
_K = "Section K — Other Facts"
_N = "Section N — Things Anyone Owns"
_O_JOBS = "Section O — Money from Jobs"
_O_OTHER = "Section O — Other Money"
_P = "Section P — Housing Costs"
_Q = "Section Q — Costs to Take Care of Others"
_R = "Section R — Medical Costs"
_V = "Section V — Someone Acting for You"
_APPENDIX_C = "Appendix C — Authorized Representative"

#: Form "Person N+2" is our ``household.members.N``.
#:
#: The applicant is Person 1, in Sections F and G. ``household.members`` holds
#: the *additional* people, so member 0 is the form's Person 2. Off by one in
#: either direction writes a child's details on their parent's line, so the
#: offset is named rather than spelled inline.
PERSON_BLOCK_OFFSET = 2

#: How many of each repeated block the official form actually prints.
#:
#: Smaller than the worksheet's capacity in two places, and that is the point of
#: recording it: the intake collects up to six household members and five bills,
#: and the official form has room for four and eight-by-kind. A household past
#: the limit is told to attach a sheet — ``resolution.overflow`` reports it and
#: the review sheet prints it — rather than having a row silently dropped.
OFFICIAL_PERSON_ROWS = 4
OFFICIAL_JOB_ROWS = 3
OFFICIAL_OTHER_MONEY_ROWS = 3

#: Where the pivoted housing amounts live.
#:
#: A namespace of its own rather than a suffix on the indexed keys, so nothing
#: can confuse ``expenses.household.0.amount_monthly`` (bill row 0, whatever
#: kind it is) with ``expenses.household.by_kind.rent_or_mortgage`` (the rent
#: box on the page).
HOUSING_AMOUNTS = "expenses.household.by_kind"

#: Housing-cost kinds Section P prints a labelled box for.
#:
#: ``trash`` is deliberately absent: the intake offers it, Section P has no box
#: for it, and folding it into "Other" alongside a genuine other-cost row would
#: overstate one of the two. A trash row stays in the review sheet as a cost the
#: applicant must write in themselves.
HOUSING_KINDS: tuple[str, ...] = (
    "rent_or_mortgage",
    "property_tax",
    "water",
    "electricity",
    "gas",
    "telephone",
    "home_insurance",
    "other",
)

#: Marital-status values, in the order their circles are measured.
#:
#: Exactly the five H1010 prints, in the order it prints them. Our canonical
#: model happens to offer the same five, which is why this is a mapping and not
#: a translation table — if the form ever printed a sixth, a CHOICE with five
#: declared options and six measured boxes fails at build time.
MARITAL_STATUS_OPTIONS: tuple[str, ...] = (
    "married",
    "single",
    "divorced",
    "separated",
    "widowed",
)

#: The per-person programme circles H1010 prints that we can mark.
#:
#: SNAP and TANF only, and the omission is the point. Each person block also
#: prints five "Medicaid or CHIP for:" circles — Children, Adult Caring for a
#: Child, Adult not Caring for a Child, Pregnant Women, Healthy Texas Women —
#: which divide by *eligibility category*, not by programme. Knowing that
#: someone is applying for Medicaid does not say which of those five they fall
#: under, and age alone does not settle it either: "Adult caring for a child"
#: against "Adult not caring for a child" turns on caretaker status, and
#: Healthy Texas Women is a separate programme with its own rules.
#:
#: So those circles stay the applicant's to fill, per person, and the review
#: sheet says so by name. See ``h1010_coverage``.
PERSON_PROGRAM_CIRCLES: tuple[str, ...] = ("tx_snap", "tx_tanf")

#: Our frequency values, in the order their circles are measured.
#:
#: The form also prints "daily", which the intake does not offer. A CHOICE only
#: needs a box per option it declares, so the unused circle is simply never
#: marked.
FREQUENCY_OPTIONS: tuple[str, ...] = (
    "weekly",
    "every_two_weeks",
    "twice_a_month",
    "monthly",
    "irregular",
)


#: What each markable programme circle is printed as, per edition.
_PROGRAM_CIRCLE_LABELS: dict[str, tuple[str, str]] = {
    "tx_snap": ("SNAP Food Benefits", "Beneficios de comida del SNAP"),
    "tx_tanf": ("TANF Cash Help for Families", "Ayuda en efectivo de TANF"),
}


def _person_specs(row: int) -> tuple[Spec, ...]:
    """One Section H person block, as language-neutral facts."""
    person = row + PERSON_BLOCK_OFFSET
    prefix = f"household.members.{row}"

    return (
        Spec(f"{prefix}.first_name", FieldKind.TEXT,
             f"First name (Person {person})", _H,
             printed_label_es=f"Nombre (Persona {person})"),
        Spec(f"{prefix}.middle_name", FieldKind.TEXT,
             f"Middle name (Person {person})", _H, optional=True,
             printed_label_es=f"Segundo nombre (Persona {person})"),
        Spec(f"{prefix}.last_name", FieldKind.TEXT,
             f"Last name (Person {person})", _H,
             printed_label_es=f"Apellido (Persona {person})"),
        Spec(f"{prefix}.relationship_to_applicant", FieldKind.TEXT,
             f"This person's relationship to you (Person {person})", _H,
             printed_label_es=(
                 f"Relación de esta persona con usted (Persona {person})"
             )),
        Spec(f"{prefix}.date_of_birth", FieldKind.DATE,
             f"Birth date (month/day/year) (Person {person})", _H,
             transform="us_date", segments=DATE_CELL_SEGMENTS,
             segment_strip="/",
             printed_label_es=(
                 f"Fecha de nacimiento (mes/día/año) (Persona {person})"
             )),
        # Adult and child rows keep separate canonical homes because
        # California's form prints two tables; H1010 prints one, so either key
        # answers this printed column. See FieldMapping.alternate_keys.
        Spec(f"{prefix}.adult.sex", FieldKind.CHOICE,
             f"Male / Female (Person {person})", _H,
             options=("male", "female"),
             alternate_keys=(f"{prefix}.child.sex",),
             printed_label_es=f"Hombre / Mujer (Persona {person})"),
        Spec(f"{prefix}.adult.citizen_or_national", FieldKind.CHOICE,
             f"Is this person a U.S. citizen? (Person {person})", _H,
             transform="yes_no", options=("yes", "no"),
             alternate_keys=(f"{prefix}.child.citizen_or_national",),
             printed_label_es=(
                 f"¿Es esta persona ciudadana de EE. UU.? (Persona {person})"
             )),
        # Marital status has no child counterpart: the intake asks it of
        # adults only, and a nine-year-old's marital status is not a question
        # HHSC expects answered. The printed circles simply stay blank.
        Spec(f"{prefix}.adult.marital_status", FieldKind.CHOICE,
             f"Marital status (Person {person})", _H,
             options=MARITAL_STATUS_OPTIONS,
             printed_label_es=f"Estado civil (Persona {person})"),
        Spec(f"{prefix}.adult.lives_in_texas", FieldKind.CHOICE,
             f"Live in Texas? (Person {person})", _H,
             transform="yes_no", options=("yes", "no"),
             alternate_keys=(f"{prefix}.child.lives_in_texas",),
             printed_label_es=f"¿Vive en Texas? (Persona {person})"),
        Spec(f"{prefix}.adult.plans_to_stay_in_texas", FieldKind.CHOICE,
             f"Plan to stay in Texas? (Person {person})", _H,
             transform="yes_no", options=("yes", "no"),
             alternate_keys=(f"{prefix}.child.plans_to_stay_in_texas",),
             printed_label_es=(
                 f"¿Piensa quedarse en Texas? (Persona {person})"
             )),
        Spec(f"{prefix}.adult.attends_school", FieldKind.CHOICE,
             f"Is this person going to school? (Person {person})", _H,
             transform="yes_no", options=("yes", "no"),
             alternate_keys=(f"{prefix}.child.attends_school",),
             printed_label_es=(
                 f"¿Va a la escuela esta persona? (Persona {person})"
             )),
        Spec(f"{prefix}.adult.full_time_student", FieldKind.CHOICE,
             f"If yes, is this person going full-time? (Person {person})", _H,
             transform="yes_no", options=("yes", "no"),
             alternate_keys=(f"{prefix}.child.full_time_student",),
             # Optional rather than gated on the school answer.
             #
             # A `Condition` names one key, and this answer has two homes —
             # `adult.` and `child.` — so a gate could only ever guard one of
             # them. It does not need one: the intake asks about full-time
             # study only when the person is in school, so there is no value to
             # place otherwise, and `optional` is what tells the review sheet
             # that the blank is a complete answer rather than outstanding
             # work.
             optional=True,
             printed_label_es=(
                 f'Si contesta "Sí", ¿va esta persona a tiempo completo? '
                 f"(Persona {person})"
             )),
        # Which benefits *this person* is applying for. Never filled from the
        # household's selection — see PERSON_PROGRAM_CIRCLES.
        *(
            Spec(f"{prefix}.programs.{program}", FieldKind.CHECKBOX,
                 f"{_PROGRAM_CIRCLE_LABELS[program][0]} (Person {person})", _H,
                 optional=True,
                 printed_label_es=(
                     f"{_PROGRAM_CIRCLE_LABELS[program][1]} "
                     f"(Persona {person})"
                 ))
            for program in PERSON_PROGRAM_CIRCLES
        ),
    )


def _job_specs(row: int) -> tuple[Spec, ...]:
    """One Section O job block.

    ``gross_received_this_month`` is **not** here, and its absence is the most
    considered decision in this module. See ``h1010_coverage.NOT_MAPPABLE``.
    """
    prefix = f"income.earned.{row}"
    job = row + 1

    return (
        Spec(f"{prefix}.person_name", FieldKind.TEXT,
             f"Name of person who got money (Job {job})", _O_JOBS,
             printed_label_es=(
                 f"Nombre de la persona que recibió el dinero (Trabajo {job})"
             )),
        Spec(payer_line(row), FieldKind.TEXT,
             f"The person or place that paid the money (Job {job})", _O_JOBS,
             printed_label_es=(
                 f"La persona o el lugar que pagó el dinero (Trabajo {job})"
             )),
        Spec(f"{prefix}.hours_per_week", FieldKind.TEXT,
             f"Hours worked (Job {job})", _O_JOBS,
             printed_label_es=f"Horas trabajadas (Trabajo {job})"),
        Spec(f"{prefix}.pay_frequency", FieldKind.CHOICE,
             f"How often are you paid? (Job {job})", _O_JOBS,
             options=FREQUENCY_OPTIONS,
             printed_label_es=f"¿Con qué frecuencia le pagan? (Trabajo {job})"),
    )


def _other_money_specs(row: int) -> tuple[Spec, ...]:
    """One Section O "other money" block."""
    prefix = f"income.unearned.{row}"
    money = row + 1

    return (
        Spec(f"{prefix}.source", FieldKind.TEXT,
             f"Type of money (Money type {money})", _O_OTHER,
             printed_label_es=f"Tipo de dinero (Tipo de dinero {money})"),
        Spec(f"{prefix}.person_name", FieldKind.TEXT,
             f"Name of person getting this money (Money type {money})",
             _O_OTHER,
             printed_label_es=(
                 f"Nombre de la persona que recibe este dinero "
                 f"(Tipo de dinero {money})"
             )),
        Spec(f"{prefix}.reported_amount", FieldKind.TEXT,
             f"Amount you get paid (Money type {money})", _O_OTHER,
             transform="currency_whole",
             printed_label_es=(
                 f"Cantidad que recibe (Tipo de dinero {money})"
             )),
        # The field plan sends the words ("Monthly"), not the option key.
        Spec(f"{prefix}.reported_frequency", FieldKind.CHOICE,
             f"How often are you paid? (Money type {money})", _O_OTHER,
             options=FREQUENCY_OPTIONS, transform="frequency_option",
             printed_label_es=(
                 f"¿Con qué frecuencia le pagan? (Tipo de dinero {money})"
             )),
    )


#: The printed labels of Section P's amount boxes, by our kind value.
_HOUSING_LABELS: dict[str, tuple[str, str]] = {
    "rent_or_mortgage": ("Rent or home payment $", "Renta o pago de la casa $"),
    "property_tax": ("Tax on home $", "Impuestos de la casa $"),
    "water": ("Water and sewer $", "Agua y drenaje $"),
    "electricity": ("Electricity $", "Electricidad $"),
    "gas": ("Natural gas/propane $", "Gas natural o propano $"),
    "telephone": ("Phone $", "Teléfono $"),
    "home_insurance": ("Home insurance $", "Seguro de la casa $"),
    "other": ("Other $", "Otro $"),
}


#: Where the "mark the costs they have" flags live.
HOUSING_MARKS = "expenses.household.marked"


def _housing_mark_specs() -> tuple[Spec, ...]:
    """Section P's circle beside each labelled amount box.

    The form's own instruction is "mark the costs they have and list the
    amount", so an amount beside an unmarked circle answers half the question.
    Driven by ``HasValue`` off the pivoted amount — the mark claims nothing the
    amount does not already say.
    """
    return tuple(
        Spec(f"{HOUSING_MARKS}.{kind}", FieldKind.CHECKBOX,
             f"{_HOUSING_LABELS[kind][0].rstrip(' $')} (marked)", _P,
             optional=True,
             printed_label_es=(
                 f"{_HOUSING_LABELS[kind][1].rstrip(' $')} (marcado)"
             ))
        for kind in HOUSING_KINDS
    )


def _housing_specs() -> tuple[Spec, ...]:
    """Section P's eight labelled amount boxes, keyed by cost kind.

    Fed by ``PivotByKind``: the intake collects an indexed list of bills, each
    with a kind and a monthly amount, and this form asks for one amount per
    kind. Same facts, different shape — see ``Derivation``.
    """
    return tuple(
        Spec(f"{HOUSING_AMOUNTS}.{kind}", FieldKind.TEXT,
             f"{_HOUSING_LABELS[kind][0].rstrip(' $')} (monthly amount)", _P,
             transform="currency_whole", optional=True,
             printed_label_es=(
                 f"{_HOUSING_LABELS[kind][1].rstrip(' $')} (cantidad mensual)"
             ))
        for kind in HOUSING_KINDS
    )


#: Derived gateway: any of the three narrower resource questions is Yes.
OWNS_LISTED_ITEMS = "resources.owns_listed_items"

#: Derived gateway: money from a job or from working for yourself.
HAS_JOB_OR_SELF_EMPLOYMENT = "income.has_job_or_self_employment"

#: Derived gateway: any money at all expected this month.
EXPECTS_MONEY_THIS_MONTH = "income.expects_money_this_month"

#: Derived gateway: dependent care or child support paid.
HAS_CARE_COSTS = "expenses.has_care_costs"

_GATEWAY_SPECS: tuple[Spec, ...] = (
    # --- Section B, the fourth screening question ------------------------
    Spec(EXPECTS_MONEY_THIS_MONTH, FieldKind.CHOICE,
         "3. Does anyone in the home expect to receive money this month?", _B,
         transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "3. ¿Espera alguien en el hogar recibir dinero este mes?"
         )),
    # --- Section K, other facts ------------------------------------------
    Spec("household.disability_limits_activities", FieldKind.CHECKBOX,
         "1. Does anyone have a disability? — Yes", _K,
         printed_label_es="1. ¿Tiene alguien una discapacidad? — Sí"),
    Spec("household.institutional_living", FieldKind.CHOICE,
         "3. Is anyone living in a place of care?", _K, transform="yes_no",
         options=("yes", "no"),
         printed_label_es="3. ¿Vive alguien en un lugar de atención?"),
    Spec("household.homeless", FieldKind.CHOICE, "Homeless?", _K,
         transform="yes_no", options=("yes", "no"),
         printed_label_es="¿Es una persona sin hogar?"),
    # --- Section N, things anyone owns -----------------------------------
    Spec("resources.has_vehicles", FieldKind.CHOICE,
         "Does anyone own or is anyone paying for a car, truck, boat, "
         "motorcycle or other vehicle?", _N, transform="yes_no",
         options=("yes", "no"),
         printed_label_es=(
             "¿Es alguien dueño de un carro, camioneta, bote, motocicleta u "
             "otro vehículo, o está pagando por uno?"
         )),
    Spec(OWNS_LISTED_ITEMS, FieldKind.CHOICE,
         "Does anyone own or is anyone paying for these types of items?", _N,
         transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "¿Paga alguien o es dueño de estos tipos de artículos?"
         )),
    # --- Section O gateways ----------------------------------------------
    Spec(HAS_JOB_OR_SELF_EMPLOYMENT, FieldKind.CHOICE,
         "Did anyone get money in the past 3 months from working for someone "
         "else, training, or working for themself?", _O_JOBS,
         transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "¿Recibió alguien dinero en los últimos 3 meses por trabajar "
             "para otra persona, por entrenamiento o por trabajar por su "
             "cuenta?"
         )),
    Spec("income.has_unearned_income", FieldKind.CHOICE,
         "Does anyone get, or expect to get, any of the types of money listed "
         "below?", _O_OTHER, transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "¿Recibe alguien, o espera recibir, alguno de los tipos de "
             "dinero de la lista?"
         )),
    # --- Section P / Q / R -----------------------------------------------
    Spec(HAS_CARE_COSTS, FieldKind.CHOICE,
         "Does anyone have costs to take care of others?", _Q,
         transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "¿Tiene alguien gastos por el cuidado de otras personas?"
         )),
    Spec("expenses.has_medical_expenses", FieldKind.CHOICE,
         "Does anyone age 60 or older, or anyone with a disability, pay "
         "medical costs?", _R, transform="yes_no", options=("yes", "no"),
         printed_label_es=(
             "¿Paga costos médicos alguien de 60 años o más, o alguien con "
             "una discapacidad?"
         )),
    # --- Section V, someone acting for you --------------------------------
    Spec("household.authorized_representative", FieldKind.CHOICE,
         "Do you want to give someone the right to act for you — to be your "
         "authorized representative?", _V, transform="yes_no",
         options=("yes", "no"),
         printed_label_es=(
             "¿Quiere darle a alguien el derecho de actuar por usted, para "
             "ser su representante autorizado?"
         )),
)

#: Person 1's own answers to the questions every person block asks.
#:
#: The applicant is Person 1 on the printed form and Section G asks them the
#: same things Section H asks everyone else. Their marital status, sex and
#: citizenship are already in FIELD_SPECS above; these are the rest.
#:
#: ``applicant.programs.*`` is deliberately *not* ``programs.*``. The latter is
#: the household's selection and belongs to Section A's "mark the benefits
#: anyone on your case is applying for"; this is Person 1's own answer to
#: "mark the benefits Person 1 is applying for". Filling one from the other
#: would file a claim for the applicant because their household made one.
_APPLICANT_PERSON_SPECS: tuple[Spec, ...] = (
    Spec("applicant.household.lives_in_texas", FieldKind.CHOICE,
         "Live in Texas? (Person 1)", _G, transform="yes_no",
         options=("yes", "no"),
         printed_label_es="¿Vive en Texas? (Persona 1)"),
    Spec("applicant.household.plans_to_stay_in_texas", FieldKind.CHOICE,
         "Plan to stay in Texas? (Person 1)", _G, transform="yes_no",
         options=("yes", "no"),
         printed_label_es="¿Piensa quedarse en Texas? (Persona 1)"),
    Spec("applicant.household.attends_school", FieldKind.CHOICE,
         "Are you going to school? (Person 1)", _G, transform="yes_no",
         options=("yes", "no"),
         printed_label_es="¿Va a la escuela? (Persona 1)"),
    Spec("applicant.household.full_time_student", FieldKind.CHOICE,
         "If yes, are you going full-time? (Person 1)", _G,
         transform="yes_no", options=("yes", "no"), optional=True,
         printed_label_es=(
             'Si contesta "Sí", ¿va a tiempo completo? (Persona 1)'
         )),
    *(
        Spec(f"applicant.programs.{program}", FieldKind.CHECKBOX,
             f"{_PROGRAM_CIRCLE_LABELS[program][0]} (Person 1)", _G,
             optional=True,
             printed_label_es=(
                 f"{_PROGRAM_CIRCLE_LABELS[program][1]} (Persona 1)"
             ))
        for program in PERSON_PROGRAM_CIRCLES
    ),
)


#: Appendix C, the authorized representative's own details.
#:
#: Section V asks the yes/no and says "tell us about that person by filling out
#: Appendix C", so this is where the details belong for every program rather
#: than Section S, which asks the different question "did someone help you fill
#: out this form?" — one the intake does not ask.
_REPRESENTATIVE_SPECS: tuple[Spec, ...] = (
    Spec("household.authorized_representative.0.name", FieldKind.TEXT,
         "1. Name of authorized representative", _APPENDIX_C,
         printed_label_es="1. Nombre del representante autorizado"),
    Spec("household.authorized_representative.0.address.street",
         FieldKind.TEXT, "2. Address", _APPENDIX_C, optional=True,
         printed_label_es="2. Dirección"),
    Spec("household.authorized_representative.0.address.city",
         FieldKind.TEXT, "4. City", _APPENDIX_C, optional=True,
         printed_label_es="4. Ciudad"),
    Spec("household.authorized_representative.0.address.state",
         FieldKind.TEXT, "5. State", _APPENDIX_C, transform="state_code",
         optional=True, printed_label_es="5. Estado"),
    Spec("household.authorized_representative.0.address.zip_code",
         FieldKind.TEXT, "6. ZIP code", _APPENDIX_C, transform="zip5",
         optional=True, printed_label_es="6. Código postal"),
    Spec("household.authorized_representative.0.phone", FieldKind.TEXT,
         "7. Phone number", _APPENDIX_C, transform="digits",
         segments=((0, 3), (3, 6), (6, 10)), optional=True,
         printed_label_es="7. Número de teléfono"),
    Spec("household.authorized_representative.0.organization",
         FieldKind.TEXT, "8. Organization name", _APPENDIX_C, optional=True,
         printed_label_es="8. Nombre de la organización"),
)


# ---------------------------------------------------------------------------
# The Medicaid / CHIP addendum (printed "H1010-M", PDF pages 26 to 34)
# ---------------------------------------------------------------------------
#
# "Applying for or renewing Medicaid, CHIP, or Healthy Texas Women? If yes, you
# must fill out this form." Every box below is conditioned on that, through a
# key the field plan emits only for a household applying for Medicaid or CHIP.
# For anyone else the addendum is not applicable and *quiet*: nine pages a
# food-benefits household never fills in are not listed on its review sheet.
#
# The follow-ups behind a printed Yes/No are quiet too. "If yes, list the
# dependents" left blank because the answer was No is finished, and the
# reasons a Condition can give are English sentences — a Spanish review sheet
# would otherwise gain lines in English.
#
# Nothing here reads a key that already carries a note in ``h1010_coverage``:
# a key a condition reads counts as consumed for every household, which would
# silently drop that note from food-benefits households' sheets too.

#: Emitted only when the household applies for Medicaid or CHIP.
APPLYING_FOR_HEALTH = "health.applying_for_medicaid_or_chip"

#: Section 4's own condition, "only if the amount of money you get changes".
YEARLY_TOTALS_APPLY = "income.yearly_totals_apply"

_HEALTH = Condition(
    key=APPLYING_FOR_HEALTH,
    equals=True,
    because="you are not applying for Medicaid or CHIP",
    unknown_excludes=True,
    quiet=True,
)


def _gate(key: str, equals: Any = True, *, presence: bool = False) -> Condition:
    """A printed follow-up's condition, quiet like the rest of the addendum.

    An *unanswered* gate excludes its follow-ups too, unlike the default for a
    printed Yes/No. The default exists so an unanswered gate never discards an
    answer the applicant gave; here the field plan emits a follow-up only while
    its gate is Yes, so there is never such an answer to discard — and listing
    "If yes, list the dependents" as work outstanding beside an unanswered "Will
    you claim any dependents?" asks the applicant two questions for one.

    ``presence`` names a row marker rather than a question; it behaves the same
    and is kept as a word for the reader.
    """
    del presence

    return Condition(
        key=key,
        equals=equals,
        because=f"{key} is {equals!r}",
        unknown_excludes=True,
        quiet=True,
    )


def _health(*gates: Condition) -> Condition | AllOf:
    """Applies to a household applying for health coverage, and these gates."""
    return AllOf((_HEALTH, *gates)) if gates else _HEALTH


_M1 = "Medicaid Addendum, Section 1 — Your Tax Return"
_M2 = "Medicaid Addendum, Section 2 — Tax Deductions"
_M3 = "Medicaid Addendum, Section 3 — People Applying"
_M4 = "Medicaid Addendum, Section 4 — Money You Get"
_M5 = "Medicaid Addendum, Section 5 — Insurance Through a Job"
_M6 = "Medicaid Addendum, Section 6 — Read and Sign"
_APPENDIX_A = "Appendix A — Health Coverage from Jobs"
_APPENDIX_B = "Appendix B — American Indian or Alaska Native Family Member"

#: Section 1 prints five person blocks: Person 1 and Persons 2 to 5.
TAX_HOUSEHOLD_ROWS = 5

#: Appendix A prints one job; Appendix B two people; question 7 three names.
EMPLOYER_COVERAGE_ROWS = 1
TRIBAL_ROWS = 2
HTW_OPT_OUT_ROWS = 3

YES_NO: tuple[str, ...] = ("yes", "no")


def _tax_specs(slot: int) -> tuple[Spec, ...]:
    """One Section 1 person block. Person 1 is the applicant."""
    person = slot + 1
    prefix = f"health.tax_household.{slot}"
    present = _gate(f"{prefix}.present", presence=True)
    files = _gate(f"{prefix}.plans_to_file")
    claims = _gate(f"{prefix}.claims_dependents")
    claimed = _gate(f"{prefix}.claimed_as_dependent")

    specs = [
        Spec(f"{prefix}.first_name", FieldKind.TEXT,
             f"First name (Tax return, Person {person})", _M1,
             applies_when=_health(present),
             printed_label_es=f"Nombre (Declaración de impuestos, Persona {person})"),
        Spec(f"{prefix}.middle_name", FieldKind.TEXT,
             f"Middle name (Tax return, Person {person})", _M1, optional=True,
             applies_when=_health(present),
             printed_label_es=(
                 f"Segundo nombre (Declaración de impuestos, Persona {person})"
             )),
        Spec(f"{prefix}.last_name", FieldKind.TEXT,
             f"Last name (Tax return, Person {person})", _M1,
             applies_when=_health(present),
             printed_label_es=f"Apellido (Declaración de impuestos, Persona {person})"),
        # "If married" — blank is the complete answer for someone who is not.
        Spec(f"{prefix}.spouse_name", FieldKind.TEXT,
             f"If married, name of spouse (Person {person})", _M1, optional=True,
             applies_when=_health(present),
             printed_label_es=(
                 f"Si es casado(a), nombre de su esposo(a) (Persona {person})"
             )),
        Spec(f"{prefix}.plans_to_file", FieldKind.CHOICE,
             f"Do you plan to file a federal income tax return next year? "
             f"(Person {person})", _M1, transform="yes_no", options=YES_NO,
             applies_when=_health(present),
             printed_label_es=(
                 f"¿Va a presentar una declaración de impuestos del IRS el "
                 f"próximo año? (Persona {person})"
             )),
        Spec(f"{prefix}.files_jointly", FieldKind.CHOICE,
             f"a. Will you file jointly with a spouse? (Person {person})", _M1,
             transform="yes_no", options=YES_NO,
             applies_when=_health(present, files),
             printed_label_es=(
                 f"a. ¿Presentará la declaración conjuntamente con su "
                 f"esposo(a)? (Persona {person})"
             )),
        Spec(f"{prefix}.fears_harm_from_disclosure", FieldKind.CHOICE,
             f"b. Are you afraid that giving facts about this person might put "
             f"you or your children in danger? (Person {person})", _M1,
             transform="yes_no", options=YES_NO,
             applies_when=_health(present, files),
             printed_label_es=(
                 f"b. ¿Tiene miedo de que dar información sobre esta persona "
                 f"pueda ponerlo a usted o a sus hijos en peligro? "
                 f"(Persona {person})"
             )),
        Spec(f"{prefix}.claims_dependents", FieldKind.CHOICE,
             f"c. Will you claim any dependents on your tax return? "
             f"(Person {person})", _M1, transform="yes_no", options=YES_NO,
             applies_when=_health(present),
             printed_label_es=(
                 f"c. ¿Reclamará dependientes en su declaración de impuestos? "
                 f"(Persona {person})"
             )),
        Spec(f"{prefix}.dependent_names", FieldKind.TEXT,
             f"If yes, list name(s) of dependents (Person {person})", _M1,
             applies_when=_health(present, claims),
             printed_label_es=(
                 f"Si contesta “Sí”, escriba los nombres de los dependientes "
                 f"(Persona {person})"
             )),
        Spec(f"{prefix}.claimed_as_dependent", FieldKind.CHOICE,
             f"d. Will you be claimed as a dependent on someone's tax return? "
             f"(Person {person})", _M1, transform="yes_no", options=YES_NO,
             applies_when=_health(present),
             printed_label_es=(
                 f"d. ¿Lo reclamará alguien a usted como dependiente en la "
                 f"declaración de impuestos? (Persona {person})"
             )),
        Spec(f"{prefix}.tax_filer_name", FieldKind.TEXT,
             f"If yes, list the name of tax filer (Person {person})", _M1,
             applies_when=_health(present, claimed),
             printed_label_es=(
                 f"Si contesta “Sí”, escriba el nombre del declarante "
                 f"(Persona {person})"
             )),
        Spec(f"{prefix}.relationship_to_tax_filer", FieldKind.TEXT,
             f"How are you related to the tax filer? (Person {person})", _M1,
             applies_when=_health(present, claimed),
             printed_label_es=(
                 f"¿Qué relación tiene usted con el declarante? "
                 f"(Persona {person})"
             )),
    ]

    # Person 1 is the address the others are compared with.
    if slot > 0:
        specs.append(
            Spec(f"{prefix}.lives_with_applicant", FieldKind.CHOICE,
                 f"Does Person {person} live at the same address as Person 1?",
                 _M1, transform="yes_no", options=YES_NO,
                 applies_when=_health(present),
                 printed_label_es=(
                     f"¿Vive la Persona {person} en la misma dirección que la "
                     f"Persona 1?"
                 ))
        )

    return tuple(specs)


_ANY_DEDUCTION = _gate("health.tax_deductions.any")


def _deduction_specs() -> tuple[Spec, ...]:
    """Section 2. The circles are "Mark all that apply"; each opens its row."""
    alimony = _gate("health.tax_deductions.alimony")
    student = _gate("health.tax_deductions.student_loan_interest")
    other = _gate("health.tax_deductions.other")

    return (
        Spec("health.tax_deductions.alimony", FieldKind.CHECKBOX,
             "Alimony paid", _M2, optional=True,
             applies_when=_health(_ANY_DEDUCTION),
             printed_label_es="Pensión alimenticia que paga"),
        Spec("health.tax_deductions.alimony_amount", FieldKind.TEXT,
             "Alimony paid — $", _M2, transform="currency_whole",
             applies_when=_health(_ANY_DEDUCTION, alimony),
             printed_label_es="Pensión alimenticia que paga — $"),
        Spec("health.tax_deductions.alimony_frequency", FieldKind.TEXT,
             "Alimony paid — How often?", _M2,
             applies_when=_health(_ANY_DEDUCTION, alimony),
             printed_label_es="Pensión alimenticia que paga — ¿Cada cuánto?"),
        Spec("health.tax_deductions.alimony_agreement_before_2019",
             FieldKind.CHOICE,
             "Was the divorce or separation agreement executed or last "
             "modified on or before Dec. 31, 2018?", _M2,
             transform="yes_no", options=YES_NO,
             applies_when=_health(_ANY_DEDUCTION, alimony),
             printed_label_es=(
                 "¿Fue firmado o modificado el acuerdo de divorcio o separación "
                 "el 31 de diciembre de 2018 o antes?"
             )),
        Spec("health.tax_deductions.student_loan_interest", FieldKind.CHECKBOX,
             "Student loan interest", _M2, optional=True,
             applies_when=_health(_ANY_DEDUCTION),
             printed_label_es="Interés del préstamo estudiantil"),
        Spec("health.tax_deductions.student_loan_interest_amount",
             FieldKind.TEXT, "Student loan interest — $", _M2,
             transform="currency_whole",
             applies_when=_health(_ANY_DEDUCTION, student),
             printed_label_es="Interés del préstamo estudiantil — $"),
        Spec("health.tax_deductions.student_loan_interest_frequency",
             FieldKind.TEXT, "Student loan interest — How often?", _M2,
             applies_when=_health(_ANY_DEDUCTION, student),
             printed_label_es="Interés del préstamo estudiantil — ¿Cada cuánto?"),
        Spec("health.tax_deductions.other", FieldKind.CHECKBOX,
             "Other deductions", _M2, optional=True,
             applies_when=_health(_ANY_DEDUCTION),
             printed_label_es="Otras deducciones"),
        Spec("health.tax_deductions.other_amount", FieldKind.TEXT,
             "Other deductions — $", _M2, transform="currency_whole",
             applies_when=_health(_ANY_DEDUCTION, other),
             printed_label_es="Otras deducciones — $"),
        Spec("health.tax_deductions.other_frequency", FieldKind.TEXT,
             "Other deductions — How often?", _M2,
             applies_when=_health(_ANY_DEDUCTION, other),
             printed_label_es="Otras deducciones — ¿Cada cuánto?"),
        Spec("health.tax_deductions.other_types", FieldKind.TEXT,
             "Other deductions — Types", _M2,
             applies_when=_health(_ANY_DEDUCTION, other),
             printed_label_es="Otras deducciones — Tipo"),
    )


def _people_specs() -> tuple[Spec, ...]:
    """Section 3, questions 1 to 6."""
    migrant = _gate("health.child_travels_with_migrant_worker")
    special = _gate("health.child_in_special_health_care_needs")
    foster = _gate("household.foster_care_at_18_or_older")
    confidential = _gate("health.htw_confidential_contact")

    return (
        Spec("health.child_travels_with_migrant_worker", FieldKind.CHOICE,
             "1. Does a child applying for health care travel with a family "
             "member who is a migrant farm worker?", _M3,
             transform="yes_no", options=YES_NO, applies_when=_health(),
             printed_label_es=(
                 "1. ¿Viaja un niño que solicita atención médica con un "
                 "familiar que es trabajador de campo migrante?"
             )),
        Spec("health.migrant_child_names", FieldKind.TEXT,
             "If yes, what is the name of that child or children?", _M3,
             applies_when=_health(migrant),
             printed_label_es=(
                 "Si contesta sí, ¿cuál es el nombre del niño o de los niños?"
             )),
        Spec("health.child_in_special_health_care_needs", FieldKind.CHOICE,
             "2. Is a child in the Children with Special Health Care Needs "
             "program?", _M3, transform="yes_no", options=YES_NO,
             applies_when=_health(),
             printed_label_es=(
                 "2. ¿Participa un niño en el programa de Niños con "
                 "Necesidades Médicas Especiales?"
             )),
        Spec("health.special_health_care_needs_who", FieldKind.TEXT,
             "If yes, who? (Children with Special Health Care Needs)", _M3,
             applies_when=_health(special),
             printed_label_es=(
                 "Si contesta “Sí”, ¿quién? (Niños con Necesidades Médicas "
                 "Especiales)"
             )),
        Spec("health.american_indian_or_alaska_native", FieldKind.CHOICE,
             "3. Is anyone an American Indian or Native Alaskan?", _M3,
             transform="yes_no", options=YES_NO, applies_when=_health(),
             printed_label_es=(
                 "3. ¿Es alguien indio americano o nativo de Alaska?"
             )),
        Spec("household.foster_care_at_18_or_older", FieldKind.CHOICE,
             "4. Was anyone in foster care when they were age 18 or older?",
             _M3, transform="yes_no", options=YES_NO, applies_when=_health(),
             printed_label_es=(
                 "4. ¿Estuvo alguien bajo crianza temporal cuando tenía 18 "
                 "años o más?"
             )),
        Spec("household.foster_care_at_18_or_older_who", FieldKind.TEXT,
             "If yes, who? (foster care)", _M3,
             applies_when=_health(foster),
             printed_label_es="Si contesta “Sí”, ¿quién? (crianza temporal)"),
        Spec("household.foster_care_at_18_or_older_state", FieldKind.TEXT,
             "In which State?", _M3, applies_when=_health(foster),
             printed_label_es="¿En qué estado?"),
        Spec("household.absent_parents", FieldKind.CHOICE,
             "5. Does any child on this application have a parent living "
             "outside of the home?", _M3, transform="yes_no", options=YES_NO,
             applies_when=_health(),
             printed_label_es=(
                 "5. ¿Vive fuera del hogar el padre o madre de algún niño que "
                 "se menciona en esta solicitud?"
             )),
        # Question 6 prints no Yes/No: the address *is* the request. Each line
        # is optional, because a household that wants no confidential address
        # leaves the block blank and has answered.
        *(
            Spec(f"health.htw_confidential.{field}", FieldKind.TEXT,
                 f"6. Healthy Texas Women confidential {label_en}", _M3,
                 transform=transform, optional=True,
                 applies_when=_health(confidential),
                 printed_label_es=(
                     f"6. Healthy Texas Women, {label_es} confidencial"
                 ))
            for field, label_en, label_es, transform in (
                ("street", "mailing address - street", "dirección postal", None),
                ("city", "city", "ciudad", None),
                ("state", "state", "estado", "state_code"),
                ("zip_code", "zip", "código postal", "zip5"),
                ("phone", "phone number", "número de teléfono", "us_phone"),
            )
        ),
    )


def _htw_opt_out_specs(row: int) -> tuple[Spec, ...]:
    """Section 3 question 7: one "Name ___. I do not want to be tested" line."""
    prefix = f"health.htw_screening_opt_out.{row}"
    present = _gate(f"{prefix}.present", presence=True)
    declines = _gate("health.htw_declines_screening")
    line = row + 1

    return (
        Spec(f"{prefix}.name", FieldKind.TEXT,
             f"7. Name (does not want to be tested for HTW, line {line})", _M3,
             applies_when=_health(declines, present),
             printed_label_es=(
                 f"7. Nombre (no quiere la prueba de HTW, línea {line})"
             )),
        # A mark beside a blank or overflowing name line would not say whose
        # opt-out it is, so it is drawn only when the name is.
        Spec(f"{prefix}.declines", FieldKind.CHECKBOX,
             f"7. I do not want to be tested for HTW (line {line})", _M3,
             applies_when=_health(declines, present),
             drawn_only_with=f"{prefix}.name",
             printed_label_es=(
                 f"7. No quiero que me hagan la prueba para elegibilidad de "
                 f"HTW (línea {line})"
             )),
    )


#: Section 5 question 2's printed reasons, in the order the boxes are measured.
LOST_COVERAGE_REASONS: tuple[str, ...] = (
    "parent_job_ended",
    "parent_cobra_or_ers_ended",
    "parent_marital_status_changed",
    "chip_other_state_ended",
    "medicaid_other_state_ended",
    "private_coverage_ended",
    "parent_died",
    "child_special_health_care_needs",
    "medicaid_ended",
    "other",
)

#: Section 6 B's printed choices, in the order the circles are measured.
RENEWAL_YEARS: tuple[str, ...] = ("five", "four", "three", "two", "one", "none")


def _money_and_coverage_specs() -> tuple[Spec, ...]:
    """Sections 4, 5 and 6."""
    totals = _gate(YEARLY_TOTALS_APPLY)
    lost = _gate("health.lost_job_coverage")
    jail = _gate("household.incarcerated")

    return (
        Spec("income.total_this_year", FieldKind.TEXT,
             "Your total income this year", _M4, transform="currency_whole",
             applies_when=_health(totals),
             printed_label_es="Sus ingresos totales este año"),
        # "(if you think it will be different)".
        Spec("income.total_next_year", FieldKind.TEXT,
             "Your total income next year (if you think it will be different)",
             _M4, transform="currency_whole", optional=True,
             applies_when=_health(totals),
             printed_label_es=(
                 "Sus ingresos totales el próximo año (si cree que será "
                 "diferente)"
             )),
        Spec("health.has_employer_coverage", FieldKind.CHOICE,
             "1. Can anyone listed on this form get health insurance through a "
             "job?", _M5, transform="yes_no", options=YES_NO,
             applies_when=_health(),
             printed_label_es=(
                 "1. ¿Puede obtener seguro médico alguien mencionado en esta "
                 "solicitud por medio de un trabajo?"
             )),
        Spec("health.lost_job_coverage", FieldKind.CHOICE,
             "2. Did anyone have insurance through a job and lose it within "
             "the past 3 months?", _M5, transform="yes_no", options=YES_NO,
             applies_when=_health(),
             printed_label_es=(
                 "2. ¿Tenía seguro alguien por medio de un trabajo y lo perdió "
                 "en los últimos 3 meses?"
             )),
        Spec("health.lost_job_coverage_who", FieldKind.TEXT,
             "If yes, who? (insurance through a job)", _M5,
             applies_when=_health(lost),
             printed_label_es="Si contesta “Sí”, ¿quién? (seguro del trabajo)"),
        Spec("health.lost_job_coverage_end_date", FieldKind.TEXT,
             "If yes, end date", _M5, transform="us_date",
             applies_when=_health(lost),
             printed_label_es="Si contesta “Sí”, fecha de terminación"),
        Spec("health.lost_job_coverage_reason", FieldKind.CHOICE,
             "If yes, reason the insurance ended", _M5,
             options=LOST_COVERAGE_REASONS, applies_when=_health(lost),
             printed_label_es=(
                 "Si contesta “Sí”, razón por la que terminó el seguro"
             )),
        Spec("health.lost_job_coverage_other_reason", FieldKind.TEXT,
             "Others", _M5, optional=True,
             applies_when=_health(
                 lost, _gate("health.lost_job_coverage_reason", "other")
             ),
             printed_label_es="Otra"),
        Spec("household.incarcerated", FieldKind.CHOICE,
             "A. Is anyone who is applying for health coverage in jail "
             "(incarcerated)?", _M6, transform="yes_no", options=YES_NO,
             applies_when=_health(),
             printed_label_es=(
                 "A. ¿Está en la cárcel alguien que solicita cobertura médica?"
             )),
        Spec("household.incarcerated_who", FieldKind.TEXT,
             "If yes, who is in jail?", _M6, applies_when=_health(jail),
             printed_label_es="Si contesta “Sí”, ¿quién está en la cárcel?"),
        Spec("health.renewal_years", FieldKind.CHOICE,
             "B. Renewing your health coverage in future years", _M6,
             options=RENEWAL_YEARS, applies_when=_health(),
             printed_label_es=(
                 "B. Cómo renovar su cobertura médica en años futuros"
             )),
    )


#: Appendix A's premium frequencies, in the order their boxes are measured.
PREMIUM_FREQUENCIES: tuple[str, ...] = (
    "weekly",
    "bi_weekly",
    "twice_a_month",
    "monthly",
    "quarterly",
    "yearly",
)

#: Appendix A item 16's two printed changes. "No change" has no box.
PLAN_CHANGES: tuple[str, ...] = (
    "will_no_longer_provide",
    "will_start_offering_or_change_premium",
)


def _employer_coverage_specs(row: int) -> tuple[Spec, ...]:
    """Appendix A, one printed page per job that offers coverage.

    Item 2, the employee's Social Security number, is never placed: the model
    has nowhere to keep one. It is a declared blank instead.
    """
    prefix = f"appendices.employer_coverage.{row}"
    present = _gate(f"{prefix}.present", presence=True)
    eligible = _gate(f"{prefix}.eligible_now_or_soon")
    changes_premium = _gate(
        f"{prefix}.plan_change", "will_start_offering_or_change_premium"
    )
    item = _health(present)
    detail = _health(present, eligible)

    def spec(key: str, kind: FieldKind, label: str, label_es: str, **extra):
        return Spec(f"{prefix}.{key}", kind, label, _APPENDIX_A,
                    printed_label_es=label_es, **extra)

    return (
        spec("employee_name", FieldKind.TEXT,
             "1. Employee name (First, Middle, Last)",
             "1. Nombre del empleado (nombre, segundo nombre, apellido)",
             applies_when=item),
        spec("employer_name", FieldKind.TEXT, "3. Employer name",
             "3. Nombre del empleador", applies_when=item),
        spec("employer_ein", FieldKind.TEXT,
             "4. Employer Identification Number (EIN)",
             "4. Número de identificación del empleador (EIN)",
             optional=True, applies_when=item),
        spec("employer_address", FieldKind.TEXT, "5. Employer address",
             "5. Dirección del empleador", applies_when=item),
        spec("employer_phone", FieldKind.TEXT, "6. Employer phone number",
             "6. Teléfono del empleador", transform="digits",
             segments=((0, 3), (3, 6), (6, 10)), applies_when=item),
        spec("employer_city", FieldKind.TEXT, "7. City", "7. Ciudad",
             applies_when=item),
        spec("employer_state", FieldKind.TEXT, "8. State", "8. Estado",
             transform="state_code", applies_when=item),
        spec("employer_zip_code", FieldKind.TEXT, "9. ZIP code",
             "9. Código postal", transform="zip5", applies_when=item),
        spec("contact_name", FieldKind.TEXT,
             "10. Who can we contact about employee health coverage at this "
             "job?",
             "10. ¿Con quién podemos comunicarnos sobre cobertura médica para "
             "empleados en este trabajo?",
             applies_when=item),
        spec("contact_phone", FieldKind.TEXT,
             "11. Phone number (if different from above)",
             "11. Teléfono (si es diferente del anterior)",
             transform="digits", segments=((0, 3), (3, 6), (6, 10)),
             optional=True, applies_when=item),
        spec("employer_email", FieldKind.TEXT, "12. Email address",
             "12. Dirección de correo electrónico", optional=True,
             applies_when=item),
        spec("eligible_now_or_soon", FieldKind.CHOICE,
             "13. Are you currently eligible for coverage offered by this "
             "employer, or will you become eligible in the next 3 months?",
             "13. ¿Puede obtener la cobertura que ofrece este empleador en "
             "este momento, o podrá obtenerla en los próximos 3 meses?",
             transform="yes_no", options=YES_NO, applies_when=item),
        spec("waiting_period_enrollment_date", FieldKind.TEXT,
             "13a. If you’re in a waiting or probationary period, when can you "
             "enroll in coverage?",
             "13a. Si está en un período de espera o probatorio, ¿cuándo "
             "podrá inscribirse en la cobertura?",
             transform="us_date", optional=True, applies_when=detail),
        *(
            spec(f"other_eligible.{slot}", FieldKind.TEXT,
                 f"13a. Name of anyone else who is eligible for coverage from "
                 f"this job ({slot + 1})",
                 f"13a. Nombre de otra persona que pueda obtener la cobertura "
                 f"de este trabajo ({slot + 1})",
                 optional=True, applies_when=detail)
            for slot in range(3)
        ),
        spec("meets_minimum_value_standard", FieldKind.CHOICE,
             "14. Does the employer offer a health plan that meets the minimum "
             "value standard?",
             "14. ¿Ofrece el empleador un plan médico que satisfaga el "
             "estándar de valor mínimo?",
             transform="yes_no", options=YES_NO, applies_when=detail),
        spec("lowest_cost_premium", FieldKind.TEXT,
             "15a. How much would the employee have to pay in premiums for "
             "this plan?",
             "15a. ¿Cuánto tendría que pagar en primas el empleado para este "
             "plan?",
             transform="currency_whole", applies_when=detail),
        spec("lowest_cost_premium_frequency", FieldKind.CHOICE,
             "15b. How often?", "15b. ¿Cada cuánto?",
             options=PREMIUM_FREQUENCIES, applies_when=detail),
        # "(if known)" — leaving it blank is the answer for "I don't know".
        spec("plan_change", FieldKind.CHOICE,
             "16. What change will the employer make for the new plan year "
             "(if known)?",
             "16. ¿Qué cambio hará el empleador para el nuevo año del plan "
             "(si lo sabe)?",
             options=PLAN_CHANGES, optional=True, applies_when=detail),
        spec("changed_premium", FieldKind.TEXT,
             "16a. How much would the employee have to pay in premiums for "
             "this plan?",
             "16a. ¿Cuánto tendrá que pagar en primas el empleado para ese "
             "plan?",
             transform="currency_whole",
             applies_when=_health(present, eligible, changes_premium)),
        spec("changed_premium_frequency", FieldKind.CHOICE,
             "16b. How often?", "16b. ¿Cada cuánto?",
             options=PREMIUM_FREQUENCIES,
             applies_when=_health(present, eligible, changes_premium)),
        spec("plan_change_date", FieldKind.TEXT,
             "16. Date of change (mm/dd/yyyy)",
             "16. Fecha de cambio (mes/día/año)",
             transform="us_date", optional=True, applies_when=detail),
    )


def _tribal_specs(row: int) -> tuple[Spec, ...]:
    """Appendix B, one printed person column.

    Item 4 prints no Yes/No — only "$" and "How often?" — so whether the person
    has that money is a condition here, not a box.
    """
    prefix = f"appendices.tribal.{row}"
    column = row + 1
    present = _gate(f"{prefix}.present", presence=True)
    member = _gate(f"{prefix}.member_of_tribe")
    not_received = _gate(f"{prefix}.received_indian_health_service", False)
    has_income = _gate(f"{prefix}.has_excludable_tribal_income")
    item = _health(present)

    return (
        Spec(f"{prefix}.first_name", FieldKind.TEXT,
             f"1. Name — First (AI/AN Person {column})", _APPENDIX_B,
             applies_when=item,
             printed_label_es=f"1. Nombre — Nombre (Persona AI/AN {column})"),
        Spec(f"{prefix}.middle_name", FieldKind.TEXT,
             f"1. Name — Middle (AI/AN Person {column})", _APPENDIX_B,
             optional=True, applies_when=item,
             printed_label_es=(
                 f"1. Nombre — Segundo nombre (Persona AI/AN {column})"
             )),
        Spec(f"{prefix}.last_name", FieldKind.TEXT,
             f"1. Name — Last (AI/AN Person {column})", _APPENDIX_B,
             applies_when=item,
             printed_label_es=f"1. Nombre — Apellido (Persona AI/AN {column})"),
        Spec(f"{prefix}.member_of_tribe", FieldKind.CHOICE,
             f"2. Member of a federally recognized tribe? (AI/AN Person "
             f"{column})", _APPENDIX_B, transform="yes_no", options=YES_NO,
             applies_when=item,
             printed_label_es=(
                 f"2. ¿Es miembro de una tribu reconocida por el gobierno "
                 f"federal? (Persona AI/AN {column})"
             )),
        Spec(f"{prefix}.tribe_name", FieldKind.TEXT,
             f"2. If yes, tribe name (AI/AN Person {column})", _APPENDIX_B,
             applies_when=_health(present, member),
             printed_label_es=(
                 f"2. Si contesta “Sí”, ¿cuál es el nombre de la tribu? "
                 f"(Persona AI/AN {column})"
             )),
        Spec(f"{prefix}.received_indian_health_service", FieldKind.CHOICE,
             f"3. Has this person ever gotten a service from the Indian Health "
             f"Service, a tribal health program, or urban Indian health "
             f"program? (AI/AN Person {column})", _APPENDIX_B,
             transform="yes_no", options=YES_NO, applies_when=item,
             printed_label_es=(
                 f"3. ¿Alguna vez ha recibido esta persona un servicio del "
                 f"Servicio de Salud Indígena, un programa de salud tribal o un "
                 f"programa urbano de salud indígena? (Persona AI/AN {column})"
             )),
        # Item 3's follow-up hangs off a No, as printed.
        Spec(f"{prefix}.eligible_for_indian_health_service", FieldKind.CHOICE,
             f"3. If no, is this person eligible to get services from the "
             f"Indian Health Service, tribal health programs, or urban Indian "
             f"health programs? (AI/AN Person {column})", _APPENDIX_B,
             transform="yes_no", options=YES_NO,
             applies_when=_health(present, not_received),
             printed_label_es=(
                 f"3. Si contesta “No”, ¿puede esta persona recibir servicios "
                 f"del Servicio de Salud Indígena, programas de salud tribales "
                 f"o programas urbanos de salud indígena? (Persona AI/AN "
                 f"{column})"
             )),
        Spec(f"{prefix}.tribal_income_amount", FieldKind.TEXT,
             f"4. Income from these sources — $ (AI/AN Person {column})",
             _APPENDIX_B, transform="currency_whole",
             applies_when=_health(present, has_income),
             printed_label_es=(
                 f"4. Ingresos de estas fuentes — $ (Persona AI/AN {column})"
             )),
        Spec(f"{prefix}.tribal_income_frequency", FieldKind.TEXT,
             f"4. Income from these sources — How often? (AI/AN Person "
             f"{column})", _APPENDIX_B,
             applies_when=_health(present, has_income),
             printed_label_es=(
                 f"4. Ingresos de estas fuentes — ¿Cada cuánto? (Persona AI/AN "
                 f"{column})"
             )),
    )


_ASSISTER = _gate("household.application_assister")


def _appendix_c_specs() -> tuple[Spec, ...]:
    """Appendix C's items 3 and 9, and its block for application counselors."""
    representative = _gate(
        "household.authorized_representative.0.present", presence=True
    )

    return (
        Spec("household.authorized_representative.0.address.apartment",
             FieldKind.TEXT, "3. Apartment or suite number", _APPENDIX_C,
             optional=True, applies_when=representative,
             printed_label_es="3. Número de apartamento o lote"),
        Spec("household.authorized_representative.0.organization_id",
             FieldKind.TEXT, "9. Organization ID number (if applicable)",
             _APPENDIX_C, optional=True, applies_when=representative,
             printed_label_es=(
                 "9. Número de identificación de la organización (si aplica)"
             )),
        Spec("household.application_assister.start_date", FieldKind.TEXT,
             "1. Application start date (mm/dd/yyyy) (counselor)", _APPENDIX_C,
             transform="us_date", applies_when=_health(_ASSISTER),
             printed_label_es=(
                 "1. Application start date (mm/dd/yyyy) (consejero)"
             )),
        Spec("household.application_assister.name", FieldKind.TEXT,
             "2. First name, middle name, last name, & suffix (counselor)",
             _APPENDIX_C, applies_when=_health(_ASSISTER),
             printed_label_es=(
                 "2. First name, middle name, last name, & suffix (consejero)"
             )),
        Spec("household.application_assister.organization", FieldKind.TEXT,
             "3. Organization name (counselor)", _APPENDIX_C,
             applies_when=_health(_ASSISTER),
             printed_label_es="3. Organization name (consejero)"),
        Spec("household.application_assister.organization_id",
             FieldKind.TEXT,
             "4. Organization ID number (if applicable) (counselor)",
             _APPENDIX_C, optional=True, applies_when=_health(_ASSISTER),
             printed_label_es=(
                 "4. Organization ID number (if applicable) (consejero)"
             )),
    )


_ADDENDUM_SPECS: tuple[Spec, ...] = (
    *(spec for slot in range(TAX_HOUSEHOLD_ROWS) for spec in _tax_specs(slot)),
    *_deduction_specs(),
    *_people_specs(),
    *(spec for row in range(HTW_OPT_OUT_ROWS) for spec in _htw_opt_out_specs(row)),
    *_money_and_coverage_specs(),
    *(
        spec
        for row in range(EMPLOYER_COVERAGE_ROWS)
        for spec in _employer_coverage_specs(row)
    ),
    *(spec for row in range(TRIBAL_ROWS) for spec in _tribal_specs(row)),
    *_appendix_c_specs(),
)


FIELD_SPECS = (
    *FIELD_SPECS,
    *_GATEWAY_SPECS,
    *(spec for row in range(OFFICIAL_PERSON_ROWS) for spec in _person_specs(row)),
    *(spec for row in range(OFFICIAL_JOB_ROWS) for spec in _job_specs(row)),
    *(
        spec
        for row in range(OFFICIAL_OTHER_MONEY_ROWS)
        for spec in _other_money_specs(row)
    ),
    *_APPLICANT_PERSON_SPECS,
    *_housing_specs(),
    *_housing_mark_specs(),
    *_REPRESENTATIVE_SPECS,
    *_ADDENDUM_SPECS,
)

#: Every canonical key this form places, in printed order.
PLACED_KEYS: tuple[str, ...] = tuple(spec.key for spec in FIELD_SPECS)

#: The keys placed on the Medicaid / CHIP addendum, pages 26 to 34.
ADDENDUM_KEYS: frozenset[str] = frozenset(spec.key for spec in _ADDENDUM_SPECS)


# ---------------------------------------------------------------------------
# Where each value goes, on each official edition
# ---------------------------------------------------------------------------
#
# Written as two independent maps on purpose. The temptation is to derive one
# from the other with a translation table of printed labels, which would be
# shorter and would quietly reintroduce the assumption that the layouts match.
# They do not.


def _yes_no(
    question: str,
    page: int,
    *,
    yes: str = "Yes",
    no: str = "No",
    occurrence: int = 0,
    tolerance: float = 9.0,
):
    """The Yes and No circles beside one printed question.

    ``occurrence`` is what makes the per-person rows in Section H addressable:
    the same question is printed once per person block, and the circles beside
    the third one are the third person's answer.
    """
    anchor = Anchor(question, page=page, occurrence=occurrence)

    return (
        SameRow(anchor, yes, tolerance=tolerance),
        SameRow(anchor, no, tolerance=tolerance),
    )


def _si_no(question: str, page: int, *, occurrence: int = 0, tolerance: float = 9.0):
    """The Spanish edition's circles: ``Sí`` and ``No``.

    A separate helper rather than a defaulted argument, because forgetting the
    accent is the kind of mistake that fails loudly at measurement time but
    reads as correct on the page — and because the Spanish placement map should
    say ``Sí`` where the document says ``Sí``.
    """
    return _yes_no(
        question, page, yes="Sí", no="No", occurrence=occurrence,
        tolerance=tolerance,
    )


PLACEMENTS_EN: dict[str, object] = {
    # Section A — Person 1 block, printed page 1
    # Section A and Section F both ask for Person 1's name, so each mapping
    # carries both boxes. Answered once on the intake, printed twice.
    "applicant.first_name": (
        Above(Anchor("First name", page=5)),
        Above(Anchor("First name", page=7)),
    ),
    "applicant.middle_name": (
        Above(Anchor("Middle name", page=5)),
        Above(Anchor("Middle name", page=7)),
    ),
    "applicant.last_name": (
        Above(Anchor("Last name", page=5)),
        Above(Anchor("Last name", page=7)),
    ),
    "applicant.date_of_birth": CellGrid(
        Anchor("Birth date (month/day/year)", page=5), groups=(2, 2, 4)
    ),
    MAILING_ADDRESS_LINE: Above(Anchor("Mailing address", page=5)),
    "applicant.mailing_address.city": Above(Anchor("City", page=5, occurrence=0)),
    "applicant.mailing_address.state": Above(Anchor("State", page=5, occurrence=0)),
    "applicant.mailing_address.zip_code": Above(Anchor("Zip", page=5, occurrence=0)),
    "applicant.phone": PhoneSlots(
        within=(405.0, 420.0), page=5, x_from=160.0, ends_at=370.0
    ),
    "applicant.alternate_phone": PhoneSlots(
        within=(404.0, 419.0), page=5, x_from=380.0, ends_at=575.0
    ),
    HOME_ADDRESS_LINE: Above(Anchor("Home address", page=5)),
    "applicant.home_address.county": Above(Anchor("County", page=5)),
    "applicant.home_address.city": Above(Anchor("City", page=5, occurrence=1)),
    "applicant.home_address.state": Above(Anchor("State", page=5, occurrence=1)),
    "applicant.home_address.zip_code": Above(Anchor("Zip", page=5, occurrence=1)),
    # Section A — the two program circles we can safely mark
    "programs.tx_snap": SameRow(
        Anchor("Mark the benefits anyone on your case is applying for:", page=5),
        "SNAP Food",
        tolerance=45.0,
    ),
    "programs.tx_tanf": SameRow(
        Anchor("Mark the benefits anyone on your case is applying for:", page=5),
        "TANF Cash Help",
        tolerance=48.0,
    ),
    # Section B — expedited screening, printed page 1
    "household.expedited.migrant_or_seasonal_farm_worker": _yes_no(
        "1. Is anyone in the home a migrant worker or seasonal farm worker?", 5
    ),
    "resources.has_accounts": _yes_no(
        "2. Does anyone in the home have money in the bank or cash?", 5
    ),
    # Anchored on the question's *last* wrapped line: Q4 runs to three lines
    # and HHSC sets the Yes/No beside the last of them, not the first.
    "expenses.has_household_expenses": _yes_no(
        "trash, phone and property tax)", 5
    ),
    # Section C — pregnancy, printed page 2
    "household.anyone_pregnant": _yes_no("Is anyone in your home pregnant?", 6),
    PREGNANCY_PERSON: Above(
        Anchor("If yes, who?", page=6, occurrence=0), width=280.0
    ),
    PREGNANCY_DUE_DATE: CellGrid(
        Anchor("Due date", page=6), groups=(2, 2, 2), side="right"
    ),
    # Section D — military, printed page 2
    "household.military_service": _yes_no(
        "Is anyone a veteran, including being discharged or released from "
        "military service?",
        6,
    ),
    # Section E — interview, printed page 2
    # The printed answer rule starts well to the right of the question, and a
    # rule is drawn rather than typed, so there is no text to anchor to. The gap
    # is measured from the question's right edge to where the rule begins.
    "applicant.preferred_language": RightOf(
        Anchor(
            "3. What language do you want to speak during the interview?",
            page=6,
        ),
        width=110.0,
        height=13.0,
        gap=62.0,
    ),
    # Section F — contacting you, printed page 3
    "applicant.email": Above(Anchor("E-mail", page=7)),
    # Section G — person 1 details, printed page 3
    "applicant.household.marital_status": (
        SameRow(Anchor("Married", page=7), "Married"),
        SameRow(Anchor("Married", page=7), "Single"),
        SameRow(Anchor("Married", page=7), "Divorced"),
        SameRow(Anchor("Separated", page=7), "Separated"),
        SameRow(Anchor("Separated", page=7), "Widowed"),
    ),
    "applicant.household.sex": (
        SameRow(Anchor("Male", page=7), "Male"),
        SameRow(Anchor("Male", page=7), "Female"),
    ),
    "applicant.household.citizen_or_national": _yes_no(
        "Are you a U.S. citizen? If no, give facts below.", 7
    ),
}


PLACEMENTS_ES: dict[str, object] = {
    # Sección A — bloque Persona 1, página impresa 1
    # Las secciones A y F piden el nombre de la Persona 1; cada campo lleva
    # las dos casillas.
    "applicant.first_name": (
        Above(Anchor("Nombre", page=5)),
        Above(Anchor("Nombre", page=7)),
    ),
    "applicant.middle_name": (
        Above(Anchor("Segundo nombre", page=5)),
        Above(Anchor("Segundo nombre", page=7)),
    ),
    "applicant.last_name": (
        Above(Anchor("Apellido", page=5)),
        Above(Anchor("Apellido", page=7)),
    ),
    "applicant.date_of_birth": CellGrid(
        Anchor("Fecha de nacimiento (mes/día/año)", page=5), groups=(2, 2, 4)
    ),
    MAILING_ADDRESS_LINE: Above(Anchor("Dirección postal", page=5)),
    "applicant.mailing_address.city": Above(Anchor("Ciudad", page=5, occurrence=0)),
    "applicant.mailing_address.state": Above(Anchor("Estado", page=5, occurrence=0)),
    "applicant.mailing_address.zip_code": Above(
        Anchor("Código postal", page=5, occurrence=0)
    ),
    "applicant.phone": PhoneSlots(
        within=(385.0, 398.0), page=5, x_from=150.0, ends_at=368.0
    ),
    "applicant.alternate_phone": PhoneSlots(
        within=(385.0, 398.0), page=5, x_from=370.0, ends_at=572.0
    ),
    HOME_ADDRESS_LINE: Above(Anchor("Dirección de la casa", page=5)),
    "applicant.home_address.county": Above(Anchor("Condado", page=5)),
    "applicant.home_address.city": Above(Anchor("Ciudad", page=5, occurrence=1)),
    "applicant.home_address.state": Above(Anchor("Estado", page=5, occurrence=1)),
    "applicant.home_address.zip_code": Above(
        Anchor("Código postal", page=5, occurrence=1)
    ),
    "programs.tx_snap": SameRow(
        Anchor("Marque los beneficios que está solicitando cualquier", page=5),
        "Beneficios de",
        tolerance=40.0,
    ),
    "programs.tx_tanf": SameRow(
        Anchor("Marque los beneficios que está solicitando cualquier", page=5),
        "Ayuda de dinero en",
        tolerance=40.0,
    ),
    # Sección B — evaluación para servicio acelerado
    "household.expedited.migrant_or_seasonal_farm_worker": _yes_no(
        "1. ¿Hay alguien en su hogar que sea trabajador agrícola migrante o "
        "de temporada?",
        5,
        yes="Sí",
    ),
    "resources.has_accounts": _yes_no(
        "2. ¿Tiene alguien en la casa dinero en el banco o en efectivo?",
        5,
        yes="Sí",
    ),
    # Igual que en inglés: la pregunta 4 ocupa cuatro líneas y el Sí/No va
    # junto a la última.
    "expenses.has_household_expenses": _yes_no(
        "sobre la propiedad.)",
        5,
        yes="Sí",
    ),
    # Sección C — embarazo, página impresa 2
    "household.anyone_pregnant": _yes_no(
        "¿Está embarazada alguien en su hogar?", 6, yes="Sí"
    ),
    PREGNANCY_PERSON: Above(
        Anchor('Si contesta "Sí", ¿quién?', page=6, occurrence=0), width=280.0
    ),
    PREGNANCY_DUE_DATE: CellGrid(
        Anchor("Fecha de parto", page=6), groups=(2, 2, 2), side="right"
    ),
    # Sección D — servicio militar
    "household.military_service": _yes_no(
        "¿Es alguien veterano, incluso si ha sido dado de baja o ha salido "
        "del servic",
        6,
        yes="Sí",
    ),
    # Sección E — entrevista
    "applicant.preferred_language": RightOf(
        Anchor("3. ¿Qué idioma quiere hablar durante la entrevista?", page=6),
        width=190.0,
        height=13.0,
        gap=30.0,
    ),
    # Sección F — cómo comunicarnos con usted, página impresa 3
    "applicant.email": Above(Anchor("Correo electrónico", page=7)),
    # Sección G — datos de la Persona 1
    "applicant.household.marital_status": (
        SameRow(Anchor("Casado", page=7), "Casado"),
        SameRow(Anchor("Casado", page=7), "Soltero"),
        SameRow(Anchor("Casado", page=7), "Divorciado"),
        SameRow(Anchor("Separado", page=7), "Separado"),
        SameRow(Anchor("Separado", page=7), "Viudo"),
    ),
    "applicant.household.sex": (
        SameRow(Anchor("Hombre", page=7), "Hombre"),
        SameRow(Anchor("Hombre", page=7), "Mujer"),
    ),
    "applicant.household.citizen_or_national": _yes_no(
        "¿Es ciudadano de EE. UU.? Si no lo es, dé los datos a continuación.",
        7,
        yes="Sí",
    ),
}


# ---------------------------------------------------------------------------
# Building the definition
# ---------------------------------------------------------------------------

from benefits_navigator.formmap.definition import (  # noqa: E402
    DeclaredBlank,
    FieldMapping,
    FormDefinition,
    Responsibility,
)
from benefits_navigator.formmap.documents import DocumentVariant  # noqa: E402
from benefits_navigator.formmap.forms.tx_documents import (  # noqa: E402
    TX_H1010_EN,
    TX_H1010_ES,
)
from benefits_navigator.formmap.measurements import load_measurements  # noqa: E402
from benefits_navigator.formmap.targets import (  # noqa: E402
    Alignment,
    OverlayTarget,
    Segment,
)

FORM_ID = "TX_H1010"

#: Font size for drawn values. Small enough for the tightest printed cell on
#: pages 1-3, which is the two-digit month of the birth date.
_VALUE_SIZE = 9.5

#: Side of the mark drawn in one of HHSC's printed circles.
_MARK_SIZE = 8.0


# ---------------------------------------------------------------------------
# The repeated blocks, placed — once per edition
# ---------------------------------------------------------------------------
#
# Generated per row, but *not* shared between editions: each builder below is
# called separately for English and for Spanish with that edition's own anchor
# phrases, page occurrences and option words. A single builder parameterised by
# a language flag was the obvious shortening and is exactly what this design
# refuses — it would put one set of assumptions behind both documents, and the
# documents do not agree. The proof they do not is
# ``test_the_two_editions_do_not_share_a_single_coordinate``.
#
# Section H prints Person 2 and Person 3 on PDF page 8, Person 4 and Person 5
# on page 9 — so member row N lives at page 8 + N//2, occurrence N % 2.


def _person_page(row: int) -> int:
    return 8 + row // 2


def _person_occurrence(row: int) -> int:
    return row % 2


def _person_placements_en(row: int) -> dict[str, object]:
    page = _person_page(row)
    occurrence = _person_occurrence(row)
    prefix = f"household.members.{row}"

    # `by_phrase` on the three name labels, and it is load-bearing: on English
    # page 9 the extractor merges Person 5's "First name" into the left
    # sidebar's line, which begins at x=22 in the margin. Measured as a line
    # that puts the applicant's name over the sidebar; measured as a phrase it
    # lands in the right column. See Anchor.by_phrase.
    return {
        f"{prefix}.first_name": Above(
            Anchor("First name", page=page, occurrence=occurrence,
                   by_phrase=True)
        ),
        f"{prefix}.middle_name": Above(
            Anchor("Middle name", page=page, occurrence=occurrence,
                   by_phrase=True)
        ),
        f"{prefix}.last_name": Above(
            Anchor("Last name", page=page, occurrence=occurrence,
                   by_phrase=True)
        ),
        f"{prefix}.relationship_to_applicant": Above(
            Anchor("This person's relationship to you", page=page,
                   occurrence=occurrence)
        ),
        f"{prefix}.date_of_birth": CellGrid(
            Anchor("Birth date (month/day/year)", page=page,
                   occurrence=occurrence),
            groups=(2, 2, 4),
        ),
        f"{prefix}.adult.sex": (
            Over(Anchor("Male", page=page, occurrence=occurrence)),
            Over(Anchor("Female", page=page, occurrence=occurrence)),
        ),
        f"{prefix}.adult.citizen_or_national": _yes_no(
            "Is this person a U.S. citizen? If no, give facts below",
            page, occurrence=occurrence,
        ),
        f"{prefix}.adult.marital_status": tuple(
            Over(Anchor(word, page=page, occurrence=occurrence))
            for word in (
                "Married", "Single", "Divorced", "Separated", "Widowed",
            )
        ),
        f"{prefix}.adult.lives_in_texas": _yes_no(
            "Live in Texas?", page, occurrence=occurrence
        ),
        f"{prefix}.adult.plans_to_stay_in_texas": _yes_no(
            "Plan to stay in Texas?", page, occurrence=occurrence
        ),
        f"{prefix}.adult.attends_school": _yes_no(
            "Is this person going to school?", page, occurrence=occurrence
        ),
        f"{prefix}.adult.full_time_student": _yes_no(
            "If yes, is this person going full-time?",
            page, occurrence=occurrence,
        ),
        f"{prefix}.programs.tx_snap": Over(
            Anchor("SNAP Food Benefits", page=page, occurrence=occurrence),
            dx=_PROGRAM_CIRCLE_DX,
        ),
        f"{prefix}.programs.tx_tanf": Over(
            Anchor("TANF", page=page, occurrence=occurrence),
            dx=_PROGRAM_CIRCLE_DX,
        ),
    }


def _person_placements_es(row: int) -> dict[str, object]:
    page = _person_page(row)
    occurrence = _person_occurrence(row)
    prefix = f"household.members.{row}"

    return {
        f"{prefix}.first_name": Above(
            Anchor("Nombre", page=page, occurrence=occurrence)
        ),
        f"{prefix}.middle_name": Above(
            Anchor("Segundo nombre", page=page, occurrence=occurrence)
        ),
        f"{prefix}.last_name": Above(
            Anchor("Apellido", page=page, occurrence=occurrence)
        ),
        f"{prefix}.relationship_to_applicant": Above(
            Anchor("Relación de esta persona con usted", page=page,
                   occurrence=occurrence)
        ),
        f"{prefix}.date_of_birth": CellGrid(
            Anchor("Fecha de nacimiento (mes/día/año)", page=page,
                   occurrence=occurrence),
            groups=(2, 2, 4),
        ),
        f"{prefix}.adult.sex": (
            Over(Anchor("Hombre", page=page, occurrence=occurrence)),
            Over(Anchor("Mujer", page=page, occurrence=occurrence)),
        ),
        f"{prefix}.adult.citizen_or_national": _si_no(
            "¿Es esta persona ciudadana de EE. UU.? Si no lo es, dé los datos",
            page, occurrence=occurrence,
        ),
        f"{prefix}.adult.marital_status": tuple(
            Over(Anchor(word, page=page, occurrence=occurrence))
            for word in (
                "Casado", "Soltero", "Divorciado", "Separado", "Viudo",
            )
        ),
        f"{prefix}.adult.lives_in_texas": _si_no(
            "¿Vive en Texas?", page, occurrence=occurrence
        ),
        f"{prefix}.adult.plans_to_stay_in_texas": _si_no(
            "¿Piensa quedarse en Texas?", page, occurrence=occurrence
        ),
        f"{prefix}.adult.attends_school": _si_no(
            "¿Va a la escuela esta persona?", page, occurrence=occurrence
        ),
        f"{prefix}.adult.full_time_student": _si_no(
            'Si contesta "Sí", ¿va esta persona a tiempo completo?',
            page, occurrence=occurrence,
        ),
        f"{prefix}.programs.tx_snap": Over(
            Anchor("Beneficios de comida", page=page, occurrence=occurrence),
            dx=_PROGRAM_CIRCLE_DX,
        ),
        f"{prefix}.programs.tx_tanf": Over(
            Anchor("TANF", page=page, occurrence=occurrence),
            dx=_PROGRAM_CIRCLE_DX,
        ),
    }


#: The frequency circles, in FREQUENCY_OPTIONS order, per edition.
#:
#: The form also prints "daily" / "diario", which the intake does not collect,
#: so no box is measured for it and no circle is ever marked there.
_FREQUENCY_WORDS_EN: tuple[str, ...] = (
    "once a week", "every 2 weeks", "twice a month", "once a month", "other:",
)
_FREQUENCY_WORDS_ES: tuple[str, ...] = (
    "cada semana", "cada 2 semanas", "dos veces al mes",
    "una vez al mes", "otro:",
)

#: The Spanish edition words the same question two ways, one per block.
#:
#: Section O's job blocks print "¿Cada cuánto tiempo le pagan?" and its
#: other-money blocks print "¿Cada cuánto le pagan?". The English edition
#: prints "How often are you paid?" in both. Two constants rather than one
#: anchor loose enough to match both, so a wording that changes on one page
#: fails loudly on that page.
_ES_JOB_FREQUENCY = "¿Cada cuánto tiempo le pagan?"
_ES_MONEY_FREQUENCY = "¿Cada cuánto le pagan?"


def _job_placements_en(row: int) -> dict[str, object]:
    prefix = f"income.earned.{row}"

    return {
        f"{prefix}.person_name": Above(
            Anchor("Name of person who got money", page=17, occurrence=row)
        ),
        f"{prefix}.hours_per_week": Above(
            Anchor("Hours worked", page=17, occurrence=row)
        ),
        payer_line(row): Below(
            Anchor("If no, list the person or place that paid the money",
                   page=17, occurrence=row),
            height=16.0,
        ),
        f"{prefix}.pay_frequency": tuple(
            SameRow(
                Anchor("How often are you paid?", page=17, occurrence=row),
                word,
                tolerance=45.0,
            )
            for word in _FREQUENCY_WORDS_EN
        ),
    }


def _job_placements_es(row: int) -> dict[str, object]:
    prefix = f"income.earned.{row}"

    return {
        f"{prefix}.person_name": Above(
            Anchor("Nombre de la persona que recibió el", page=17,
                   occurrence=row)
        ),
        f"{prefix}.hours_per_week": Above(
            Anchor("Horas trabajadas", page=17, occurrence=row)
        ),
        payer_line(row): Below(
            Anchor(
                "escriba el nombre de la persona o empresa que pagó el dinero",
                page=17, occurrence=row,
            ),
            height=16.0,
        ),
        f"{prefix}.pay_frequency": tuple(
            SameRow(
                Anchor(_ES_JOB_FREQUENCY, page=17, occurrence=row),
                word,
                tolerance=45.0,
            )
            for word in _FREQUENCY_WORDS_ES
        ),
    }


def _other_money_placements_en(row: int) -> dict[str, object]:
    prefix = f"income.unearned.{row}"

    return {
        f"{prefix}.source": Above(
            Anchor("Type of money (item you marked above)", page=18,
                   occurrence=row),
            width=172.0,
        ),
        f"{prefix}.person_name": Above(
            Anchor("Name of person getting this money", page=18,
                   occurrence=row),
            width=286.0,
        ),
        f"{prefix}.reported_amount": Above(
            Anchor("Amount you get paid", page=18, occurrence=row),
            dx=12.0,
            width=92.0,
        ),
        f"{prefix}.reported_frequency": tuple(
            SameRow(
                Anchor("How often are you paid?", page=18, occurrence=row),
                word,
                tolerance=45.0,
            )
            for word in _FREQUENCY_WORDS_EN
        ),
    }


def _other_money_placements_es(row: int) -> dict[str, object]:
    prefix = f"income.unearned.{row}"

    return {
        f"{prefix}.source": Above(
            Anchor("Tipo de dinero (artículo que marcó antes)", page=18,
                   occurrence=row),
            width=170.0,
        ),
        f"{prefix}.person_name": Above(
            Anchor("Nombre de la persona que recibe el dinero", page=18,
                   occurrence=row),
            width=286.0,
        ),
        f"{prefix}.reported_amount": Above(
            Anchor("Cantidad que recibe", page=18, occurrence=row,
                   by_phrase=True),
            dx=12.0,
            width=88.0,
        ),
        f"{prefix}.reported_frequency": tuple(
            SameRow(
                Anchor(_ES_MONEY_FREQUENCY, page=18, occurrence=row),
                word,
                # The Spanish column sets all five circles under the question
                # rather than two-by-two, so the last of them — "otro:" — is
                # 57 points below it. The next block's question is 122 points
                # away, so this reach cannot stray into it.
                tolerance=62.0,
            )
            for word in _FREQUENCY_WORDS_ES
        ),
    }


def _housing_placements(labels: dict[str, tuple[str, str]], index: int):
    """Section P's eight amount boxes, measured from each row's printed ``$``.

    ``AfterMarker`` rather than ``Above`` or ``RightOf``: the two editions
    typeset these rows differently — the English line ends at the ``$``, the
    Spanish continues through the underscore rule that *is* the writing space —
    so the line's right edge means different things. Both print a ``$``, which
    is the landmark a person filling the form in uses too.
    """
    return {
        **{
            f"{HOUSING_AMOUNTS}.{kind}": AfterMarker(
                Anchor(labels[kind][index], page=19), width=54.0
            )
            for kind in HOUSING_KINDS
        },
        **{
            f"{HOUSING_MARKS}.{kind}": Over(
                Anchor(labels[kind][index], page=19),
                # Section P sets its labels in a smaller face than Section H's
                # and leaves a wider gap to the circle, so `Over`'s default
                # offset — tuned on the person blocks — lands the mark between
                # the circle and the word. Measured off the rendered page: the
                # circle's centre is 12 points left of its label's left edge.
                dx=-15.2,
            )
            for kind in HOUSING_KINDS
        },
    }


def _representative_placements_en() -> dict[str, object]:
    prefix = "household.authorized_representative.0"

    # Appendix C is part of the H1010-M addendum and uses the marketplace
    # layout: the writing space sits *below* its numbered label, the opposite
    # of the main form's Section A. Hence Below, not Above.
    return {
        f"{prefix}.name": Below(
            Anchor("1. Name of authorized representative", page=34)
        ),
        f"{prefix}.address.street": Below(Anchor("2. Address", page=34)),
        f"{prefix}.address.city": Below(Anchor("4. City", page=34)),
        f"{prefix}.address.state": Below(Anchor("5. State", page=34)),
        f"{prefix}.address.zip_code": Below(Anchor("6. ZIP code", page=34)),
        f"{prefix}.phone": PhoneSlots(
            within=(344.0, 356.0), page=34, x_from=57.0, ends_at=200.0
        ),
        f"{prefix}.organization": Below(
            Anchor("8. Organization name", page=34)
        ),
    }


def _representative_placements_es() -> dict[str, object]:
    prefix = "household.authorized_representative.0"

    return {
        f"{prefix}.name": Below(
            Anchor("1. Nombre del representante autorizado", page=34)
        ),
        f"{prefix}.address.street": Below(Anchor("2. Dirección", page=34)),
        f"{prefix}.address.city": Below(Anchor("4. Ciudad", page=34)),
        f"{prefix}.address.state": Below(Anchor("5. Estado", page=34)),
        f"{prefix}.address.zip_code": Below(
            Anchor("6. Código postal", page=34)
        ),
        f"{prefix}.phone": PhoneSlots(
            within=(322.0, 334.0), page=34, x_from=58.0, ends_at=200.0
        ),
        f"{prefix}.organization": Below(
            Anchor("8. Nombre de la organización", page=34)
        ),
    }


#: How far left of its label a programme circle sits, in Section G and H.
#:
#: These blocks indent the circle further from its word than the marital-status
#: and Yes/No circles do, so `Over`'s default offset lands the mark between the
#: circle and the label. Measured off the rendered page; see the geometry test
#: that asserts every mark stays inside its circle.
_PROGRAM_CIRCLE_DX = -11.0

#: Person 1's own per-person answers, on printed page 3.
#:
#: The applicant has a person block like everyone else and it asks the same
#: questions. Section A's household block ("mark the benefits anyone on your
#: case is applying for") is a *different* question and is mapped separately
#: from `selectedPrograms`.
_APPLICANT_PERSON_PLACEMENTS_EN: dict[str, object] = {
    "applicant.household.lives_in_texas": _yes_no("Live in Texas?", 7),
    "applicant.household.plans_to_stay_in_texas": _yes_no(
        "Plan to stay in Texas?", 7
    ),
    "applicant.household.attends_school": _yes_no(
        "Are you going to school?", 7
    ),
    "applicant.household.full_time_student": _yes_no(
        "If yes, are you going full-time?", 7
    ),
    "applicant.programs.tx_snap": Over(
        Anchor("SNAP Food Benefits", page=7), dx=_PROGRAM_CIRCLE_DX
    ),
    "applicant.programs.tx_tanf": Over(
        Anchor("TANF", page=7), dx=_PROGRAM_CIRCLE_DX
    ),
}

_APPLICANT_PERSON_PLACEMENTS_ES: dict[str, object] = {
    "applicant.household.lives_in_texas": _si_no("¿Vive en Texas?", 7),
    "applicant.household.plans_to_stay_in_texas": _si_no(
        "¿Piensa quedarse en Texas?", 7
    ),
    "applicant.household.attends_school": _si_no("¿Va a la escuela?", 7),
    "applicant.household.full_time_student": _si_no(
        'Si contesta "Sí", ¿va a tiempo completo?', 7
    ),
    "applicant.programs.tx_snap": Over(
        Anchor("Beneficios de comida", page=7), dx=_PROGRAM_CIRCLE_DX
    ),
    "applicant.programs.tx_tanf": Over(
        Anchor("TANF", page=7), dx=_PROGRAM_CIRCLE_DX
    ),
}


_GATEWAY_PLACEMENTS_EN: dict[str, object] = {
    EXPECTS_MONEY_THIS_MONTH: _yes_no(
        "month? (This includes money you get from jobs, child", 5
    ),
    "household.disability_limits_activities": SameRow(
        Anchor("1. Does anyone have a disability?", page=12), "Yes"
    ),
    "household.institutional_living": _yes_no(
        "• A homeless shelter.", 12
    ),
    "household.homeless": _yes_no("Homeless?", 12),
    "resources.has_vehicles": _yes_no(
        "• car • truck • boat • motorcycle • other", 15
    ),
    OWNS_LISTED_ITEMS: _yes_no(
        "Does anyone own or is anyone paying for these types of items?", 16
    ),
    HAS_JOB_OR_SELF_EMPLOYMENT: _yes_no(
        "(a) working for someone else (b) training, or (c) working for themself?",
        17,
    ),
    "income.has_unearned_income": _yes_no(
        "Does anyone get, or expect to get, any of the types of money listed below?",
        18,
    ),
    HAS_CARE_COSTS: _yes_no("to take care of others?", 19),
    "expenses.has_medical_expenses": _yes_no("pay medical costs?", 20),
    "household.authorized_representative": _yes_no(
        "authorized representative? ...", 22
    ),
}

_GATEWAY_PLACEMENTS_ES: dict[str, object] = {
    EXPECTS_MONEY_THIS_MONTH: _si_no(
        "3. ¿Espera alguien en la casa recibir dinero este mes?", 5,
        tolerance=20.0,
    ),
    "household.disability_limits_activities": SameRow(
        Anchor("1. ¿Tiene alguien una discapacidad?", page=12), "Sí"
    ),
    "household.institutional_living": _si_no(
        "• Un refugio para personas sin hogar.", 12
    ),
    "household.homeless": _si_no("¿Es una persona sin hogar?", 12),
    "resources.has_vehicles": _si_no(
        "• un auto • una camioneta • una lancha • una motocicleta • otro", 15
    ),
    OWNS_LISTED_ITEMS: _si_no(
        "¿Paga alguien o es dueño de estos tipos de artículos?", 16
    ),
    HAS_JOB_OR_SELF_EMPLOYMENT: _si_no(
        "En los últimos 3 meses, ¿recibió alguien dinero…?", 17, tolerance=20.0
    ),
    "income.has_unearned_income": _si_no(
        "¿Recibe alguien, o espera recibir, uno de los siguientes tipos de ingresos?",
        18,
    ),
    HAS_CARE_COSTS: _si_no("cuidado de otros? ...", 19),
    "expenses.has_medical_expenses": _si_no(
        "o alguien con una discapacidad? ...", 20
    ),
    "household.authorized_representative": _si_no(
        "representante autorizado? ...", 22
    ),
}


# ---------------------------------------------------------------------------
# The Medicaid / CHIP addendum, placed — once per edition
# ---------------------------------------------------------------------------
#
# Written per edition for the same reason as everything above, and here the
# editions disagree inside the addendum itself: the Spanish "name of tax filer"
# label wraps onto two lines for Persons 1, 3 and 5 and not for 2 and 4, its
# Appendix A sets the premium frequencies in two rows where the English sets
# one, and its Section 2 squeezes "How often?" and "Type" onto the line the
# English gives a line of their own.
#
# Section 1 prints Person 1 on PDF page 26, Persons 2 and 3 on page 27, and
# Persons 4 and 5 on page 28: slot N lives at the page and occurrence below.


def _tax_page(slot: int) -> int:
    return 26 + (slot + 1) // 2


def _tax_occurrence(slot: int) -> int:
    return 0 if slot == 0 else (slot - 1) % 2


def _square(placements: object) -> tuple[SnapToSquare, ...]:
    """Mark placements for printed squares rather than circles.

    Appendices A and B print square checkboxes. ``_merge`` snaps every other
    mark to the circle nearest it; these are snapped to their square instead,
    and ``_snapped`` leaves them alone.
    """
    group = placements if isinstance(placements, tuple) else (placements,)

    return tuple(SnapToSquare(placement) for placement in group)


def _tax_placements_en(slot: int) -> dict[str, object]:
    prefix = f"health.tax_household.{slot}"
    page, occ = _tax_page(slot), _tax_occurrence(slot)

    def at(phrase: str) -> Anchor:
        return Anchor(phrase, page=page, occurrence=occ)

    placements: dict[str, object] = {
        f"{prefix}.first_name": Above(at("First name")),
        f"{prefix}.middle_name": Above(at("Middle name")),
        f"{prefix}.last_name": Above(at("Last name")),
        f"{prefix}.spouse_name": Below(at("If married, name of spouse:")),
        f"{prefix}.plans_to_file": _yes_no(
            "Do you plan to file a federal income tax return next year?",
            page, occurrence=occ,
        ),
        f"{prefix}.files_jointly": _yes_no(
            "a. Will you file jointly with a spouse?", page, occurrence=occ
        ),
        # Question b wraps; its circles sit beside the second line.
        f"{prefix}.fears_harm_from_disclosure": _yes_no(
            "or your children in danger?", page, occurrence=occ
        ),
        f"{prefix}.claims_dependents": _yes_no(
            "c. Will you claim any dependents on your tax return?",
            page, occurrence=occ,
        ),
        f"{prefix}.dependent_names": Below(
            at("If yes, list name(s) of dependents:")
        ),
        f"{prefix}.claimed_as_dependent": _yes_no(
            "d. Will you be claimed as a dependent on someone's tax return?",
            page, occurrence=occ,
        ),
        f"{prefix}.tax_filer_name": Below(
            at("If yes, list the name of tax filer:")
        ),
        f"{prefix}.relationship_to_tax_filer": Below(
            at("How are you related to the tax filer?")
        ),
    }

    if slot > 0:
        placements[f"{prefix}.lives_with_applicant"] = _yes_no(
            f"Does Person {slot + 1} live at the same address as Person 1?",
            page,
        )

    return placements


#: The Spanish "name of tax filer" and "relationship" labels, per block.
#:
#: Persons 1, 3 and 5 print each label on two lines and the writing space sits
#: under the second ("declarante:" / "declarante?"); Persons 2 and 4 print each
#: on one. Anchored on the line the space sits under, per block, rather than on
#: a phrase that happens to be shared.
_ES_TAX_FILER_LABELS: dict[int, tuple[Anchor, Anchor]] = {
    0: (
        Anchor("declarante:", page=26),
        Anchor("declarante?", page=26),
    ),
    1: (
        Anchor("Si contesta “Sí”, escriba el nombre de declarante:", page=27),
        Anchor("¿Qué relación tiene usted con el declarante?", page=27),
    ),
    2: (
        Anchor("declarante:", page=27),
        Anchor("declarante?", page=27),
    ),
    3: (
        Anchor("Si contesta “Sí”, escriba el nombre del declarante:", page=28),
        Anchor("¿Qué relación tiene usted con el declarante?", page=28),
    ),
    4: (
        Anchor("declarante:", page=28),
        Anchor("declarante?", page=28),
    ),
}


def _tax_placements_es(slot: int) -> dict[str, object]:
    prefix = f"health.tax_household.{slot}"
    page, occ = _tax_page(slot), _tax_occurrence(slot)
    filer, relationship = _ES_TAX_FILER_LABELS[slot]

    def at(phrase: str) -> Anchor:
        return Anchor(phrase, page=page, occurrence=occ)

    placements: dict[str, object] = {
        f"{prefix}.first_name": Above(at("Nombre")),
        f"{prefix}.middle_name": Above(at("Segundo nombre")),
        f"{prefix}.last_name": Above(at("Apellido")),
        f"{prefix}.spouse_name": Below(
            at("Si es casado(a), nombre de su esposo(a):")
        ),
        f"{prefix}.plans_to_file": _si_no(
            "¿Va a presentar una declaración de impuestos del IRS el próximo "
            "año?",
            page, occurrence=occ,
        ),
        f"{prefix}.files_jointly": _si_no(
            "a. ¿Presentará la declaración conjuntamente con su esposo(a)?",
            page, occurrence=occ,
        ),
        f"{prefix}.fears_harm_from_disclosure": _si_no(
            "pueda ponerlo a usted o a sus hijos en peligro?",
            page, occurrence=occ,
        ),
        f"{prefix}.claims_dependents": _si_no(
            "c. ¿Reclamará dependientes en su declaración de impuestos?",
            page, occurrence=occ,
        ),
        f"{prefix}.dependent_names": Below(
            at("Si contesta “Sí”, escriba los nombres de los dependientes:")
        ),
        # Question d wraps. Person 1's circles sit level with its second line,
        # everyone else's with its first.
        f"{prefix}.claimed_as_dependent": (
            _si_no("de impuestos?", page, occurrence=occ)
            if slot == 0
            else _si_no(
                "d. ¿Lo reclamará alguien a usted como dependiente en la "
                "declaración",
                page,
                occurrence=occ,
            )
        ),
        f"{prefix}.tax_filer_name": Below(filer),
        f"{prefix}.relationship_to_tax_filer": Below(relationship),
    }

    if slot > 0:
        placements[f"{prefix}.lives_with_applicant"] = _si_no(
            f"¿Vive la Persona {slot + 1} en la misma dirección que la "
            f"Persona 1?",
            page,
        )

    return placements


def _addendum_placements_en() -> dict[str, object]:
    def at(phrase: str, page: int, occurrence: int = 0, **extra) -> Anchor:
        return Anchor(phrase, page=page, occurrence=occurrence, **extra)

    other_line = at("How often? ____", 29)

    placements: dict[str, object] = {
        # --- Section 2, page 29 --------------------------------------------
        "health.tax_deductions.alimony": Over(at("Alimony paid", 29)),
        "health.tax_deductions.alimony_amount": RightOf(
            at("$", 29, 0), width=108.0, gap=2.0
        ),
        "health.tax_deductions.alimony_frequency": RightOf(
            at("How often?", 29, 0), width=125.0, gap=3.0
        ),
        "health.tax_deductions.alimony_agreement_before_2019": _yes_no(
            "on or before Dec. 31, 2018?", 29
        ),
        "health.tax_deductions.student_loan_interest": Over(
            at("Student loan interest", 29)
        ),
        "health.tax_deductions.student_loan_interest_amount": RightOf(
            at("$", 29, 1), width=56.0, gap=2.0
        ),
        "health.tax_deductions.student_loan_interest_frequency": RightOf(
            at("How often?", 29, 1), width=125.0, gap=3.0
        ),
        # The circle sits beside the first of the item's three lines.
        "health.tax_deductions.other": Over(
            at("Other deductions, such as educator expenses", 29)
        ),
        "health.tax_deductions.other_amount": AfterMarker(
            at("tuition and fees $", 29), width=60.0, height=13.0
        ),
        "health.tax_deductions.other_frequency": AfterMarker(
            other_line, marker="often?", width=110.0, height=13.0
        ),
        "health.tax_deductions.other_types": AfterMarker(
            other_line, marker="Types", width=110.0, height=13.0
        ),
        # --- Section 3, page 29 --------------------------------------------
        "health.child_travels_with_migrant_worker": _yes_no(
            "who is a migrant farm worker?", 29
        ),
        "health.migrant_child_names": Below(
            at("If yes, what is the name of that child or children?", 29),
            width=400.0,
        ),
        "health.child_in_special_health_care_needs": _yes_no(
            "2. Is a child in the Children with Special Health Care Needs "
            "program?",
            29,
        ),
        "health.special_health_care_needs_who": Below(
            at("If yes, who?", 29, 0), width=400.0
        ),
        "health.american_indian_or_alaska_native": _yes_no(
            "3. Is anyone an American Indian or Native Alaskan?", 29
        ),
        "household.foster_care_at_18_or_older": _yes_no(
            "4. Was anyone in foster care when they were", 29
        ),
        "household.foster_care_at_18_or_older_who": RightOf(
            at("If yes, who?", 29, 1), width=130.0, gap=8.0
        ),
        "household.foster_care_at_18_or_older_state": RightOf(
            at("In which State?", 29), width=150.0, gap=8.0
        ),
        "household.absent_parents": _yes_no("outside of the home?", 29),
        "health.htw_confidential.street": RightOf(
            at("Mailing Address - Street.", 29), width=250.0
        ),
        "health.htw_confidential.city": RightOf(at("City:", 29), width=200.0),
        "health.htw_confidential.state": RightOf(at("State:", 29), width=60.0),
        "health.htw_confidential.zip_code": RightOf(at("Zip:", 29), width=60.0),
        "health.htw_confidential.phone": RightOf(
            at("Phone number:", 29), width=110.0
        ),
        **{
            key: placement
            for row in range(HTW_OPT_OUT_ROWS)
            for key, placement in (
                (
                    f"health.htw_screening_opt_out.{row}.name",
                    AfterMarker(
                        at("I do not want to be tested for HTW.", 29, row),
                        marker="Name",
                        width=170.0,
                        height=13.0,
                    ),
                ),
                # The box is printed after the sentence, not before it.
                (
                    f"health.htw_screening_opt_out.{row}.declines",
                    RightOf(
                        at("I do not want to be tested for HTW.", 29, row),
                        width=9.0,
                        height=9.0,
                        gap=4.0,
                    ),
                ),
            )
        },
        # --- Section 4, page 30 --------------------------------------------
        "income.total_this_year": RightOf(at("$", 30, 0), width=150.0),
        "income.total_next_year": RightOf(at("$", 30, 1), width=220.0),
        # --- Section 5 ------------------------------------------------------
        "health.has_employer_coverage": _yes_no(
            "coverage is from someone else's job, such as a parent or spouse.)",
            30,
        ),
        "health.lost_job_coverage": _yes_no("within the past 3 months?", 30),
        "health.lost_job_coverage_who": Below(at("If yes, who?", 30)),
        "health.lost_job_coverage_end_date": Below(at("If yes, end date:", 30)),
        "health.lost_job_coverage_reason": tuple(
            Over(at(label, 30))
            for label in (
                "Parent’s job ended due to",
                "Parent’s COBRA or ERS",
                "Change in parent’s",
                "CHIP benefits from another",
                "Medicaid benefits from",
                "Private health coverage",
                "Death of a parent.",
                "The child has special",
                "Medicaid benefits ended",
                "Others",
            )
        ),
        "health.lost_job_coverage_other_reason": RightOf(
            at("Others", 30), width=60.0, gap=2.0
        ),
        # --- Section 6 ------------------------------------------------------
        "household.incarcerated": _yes_no("in jail (incarcerated)?", 30),
        "household.incarcerated_who": Below(
            at("If yes, who is in jail?", 30), width=400.0
        ),
        "health.renewal_years": tuple(
            Over(at(label, 30))
            for label in (
                "5 years (the maximum",
                "4 years",
                "3 years",
                "2 years",
                "1 years",
                "Don’t use information from",
            )
        ),
        # --- Appendix A, page 31 -------------------------------------------
        **_employer_coverage_placements(
            page=31,
            employee=at("1. Employee name (First, Middle, Last)", 31),
            employer=at("3. Employer name", 31),
            ein=at("4. Employer Identification Number (EIN)", 31),
            address=at("5. Employer address", 31),
            phone_band=(505.0, 520.0),
            city=at("7. City", 31),
            state=at("8. State", 31),
            zip_code=at("9. ZIP code", 31),
            contact=at(
                "10. Who can we contact about employee health coverage at this "
                "job?",
                31,
            ),
            contact_phone_band=(424.0, 439.0),
            email=at("12. Email address", 31),
            eligible_yes=at("Yes (Continue)", 31),
            eligible_no=at("No (Stop here and go to page 9, Section L)", 31),
            waiting=at(
                "13a. If you’re in a waiting or probationary period, when can "
                "you enroll in coverage?",
                31,
            ),
            other_names=tuple(at("Name:", 31, slot) for slot in range(3)),
            minimum_value=_yes_no(
                "14. Does the employer offer a health plan that meets the "
                "minimum value standard*?",
                31,
            ),
            premium=at(
                "a. How much would the employee have to pay in premiums for "
                "this plan? $",
                31,
                0,
            ),
            frequencies=tuple(
                SameRow(at("b. How often?", 31, 0), word)
                for word in (
                    "Weekly",
                    "Every 2 weeks",
                    "Twice a month",
                    "Once a month",
                    "Quarterly",
                    "Yearly",
                )
            ),
            changes=(
                Over(at("Employer won’t offer health coverage", 31)),
                Over(
                    at(
                        "Employer will start offering health coverage to "
                        "employees",
                        31,
                    )
                ),
            ),
            changed_premium=at(
                "a. How much would the employee have to pay in premiums for "
                "this plan? $",
                31,
                1,
            ),
            changed_frequencies=tuple(
                SameRow(at("b. How often?", 31, 1), word)
                for word in (
                    "Weekly",
                    "Every 2 weeks",
                    "Twice a month",
                    "Once a month",
                    "Quarterly",
                    "Yearly",
                )
            ),
            change_date=at("Date of change (mm/dd/yyyy):", 31),
        ),
        # --- Appendix B, page 33 -------------------------------------------
        **{
            key: placement
            for row in range(TRIBAL_ROWS)
            for key, placement in _tribal_placements(
                row,
                first=at("First", 33, row),
                middle=at("Middle", 33, row),
                last=at("Last", 33, row),
                member=(
                    Over(at("Yes", 33, row, within=(524.0, 535.0))),
                    Over(at("No", 33, row, within=(470.0, 480.0))),
                ),
                tribe=at("If yes, tribe name", 33, row),
                tribe_gap=6.0,
                received=(
                    Over(at("Yes", 33, row, within=(442.0, 452.0))),
                    Over(at("No", 33, row, within=(425.0, 435.0))),
                ),
                eligible=(
                    Over(at("Yes", 33, row, within=(360.0, 370.0))),
                    Over(at("No", 33, row, within=(360.0, 370.0))),
                ),
                amount=at("$", 33, row, within=(322.0, 330.0)),
                often=at("How often?", 33, row),
            ).items()
        },
        # --- Appendix C, page 34 -------------------------------------------
        "household.authorized_representative.0.address.apartment": Below(
            at("3. Apartment or suite number", 34)
        ),
        "household.authorized_representative.0.organization_id": Below(
            at("9. Organization ID number (if applicable)", 34)
        ),
        "household.application_assister.start_date": Below(
            at("1. Application start date (mm/dd/yyyy)", 34), width=200.0
        ),
        "household.application_assister.name": Below(
            at("2. First name, middle name, last name, & suffix", 34),
            width=340.0,
        ),
        "household.application_assister.organization": Below(
            at("3. Organization name", 34)
        ),
        "household.application_assister.organization_id": Below(
            at("4. Organization ID number (if applicable)", 34)
        ),
    }

    return placements


def _employer_coverage_placements(
    *,
    page: int,
    employee: Anchor,
    employer: Anchor,
    ein: Anchor,
    address: Anchor,
    phone_band: tuple[float, float],
    city: Anchor,
    state: Anchor,
    zip_code: Anchor,
    contact: Anchor,
    contact_phone_band: tuple[float, float],
    email: Anchor,
    eligible_yes: Anchor,
    eligible_no: Anchor,
    waiting: Anchor,
    other_names: tuple[Anchor, ...],
    minimum_value: object,
    premium: Anchor,
    frequencies: tuple[object, ...],
    changes: tuple[object, ...],
    changed_premium: Anchor,
    changed_frequencies: tuple[object, ...],
    change_date: Anchor,
) -> dict[str, object]:
    """Appendix A's one printed page, from one edition's own anchors.

    A layout helper, not a shared map: every anchor is passed in by the
    edition's builder, in that edition's words.
    """
    prefix = "appendices.employer_coverage.0"

    return {
        f"{prefix}.employee_name": Below(employee),
        f"{prefix}.employer_name": Below(employer),
        # Written as the applicant typed it, just above the printed template.
        # The two editions group that template differently — the English one
        # prints three groups, like the Social Security number above it — so
        # splitting the digits into its cells would put them in the wrong ones
        # on one edition or the other.
        f"{prefix}.employer_ein": Below(ein, gap=0.5, height=12.0),
        f"{prefix}.employer_address": Below(address),
        f"{prefix}.employer_phone": PhoneSlots(
            within=phone_band, page=page, x_from=350.0, ends_at=520.0
        ),
        f"{prefix}.employer_city": Below(city),
        f"{prefix}.employer_state": Below(state),
        f"{prefix}.employer_zip_code": Below(zip_code),
        f"{prefix}.contact_name": Below(contact, width=520.0),
        f"{prefix}.contact_phone": PhoneSlots(
            within=contact_phone_band, page=page, x_from=50.0, ends_at=225.0
        ),
        f"{prefix}.employer_email": Below(email),
        f"{prefix}.eligible_now_or_soon": _square(
            (Over(eligible_yes), Over(eligible_no))
        ),
        f"{prefix}.waiting_period_enrollment_date": RightOf(
            waiting, width=120.0, gap=6.0
        ),
        **{
            f"{prefix}.other_eligible.{slot}": RightOf(
                anchor, width=110.0, gap=3.0
            )
            for slot, anchor in enumerate(other_names)
        },
        f"{prefix}.meets_minimum_value_standard": _square(minimum_value),
        f"{prefix}.lowest_cost_premium": AfterMarker(
            premium, width=110.0, height=13.0
        ),
        f"{prefix}.lowest_cost_premium_frequency": _square(frequencies),
        f"{prefix}.plan_change": _square(changes),
        f"{prefix}.changed_premium": AfterMarker(
            changed_premium, width=110.0, height=13.0
        ),
        f"{prefix}.changed_premium_frequency": _square(changed_frequencies),
        f"{prefix}.plan_change_date": RightOf(change_date, width=120.0, gap=6.0),
    }


def _tribal_placements(
    row: int,
    *,
    first: Anchor,
    middle: Anchor,
    last: Anchor,
    member: tuple[object, object],
    tribe: Anchor,
    tribe_gap: float,
    received: tuple[object, object],
    eligible: tuple[object, object],
    amount: Anchor,
    often: Anchor,
) -> dict[str, object]:
    """One Appendix B person column, from one edition's own anchors."""
    prefix = f"appendices.tribal.{row}"

    return {
        f"{prefix}.first_name": Below(first),
        f"{prefix}.middle_name": Below(middle),
        f"{prefix}.last_name": Below(last),
        f"{prefix}.member_of_tribe": _square(member),
        f"{prefix}.tribe_name": Below(tribe, gap=tribe_gap, height=12.0),
        f"{prefix}.received_indian_health_service": _square(received),
        f"{prefix}.eligible_for_indian_health_service": _square(eligible),
        f"{prefix}.tribal_income_amount": RightOf(amount, width=90.0, gap=2.0),
        f"{prefix}.tribal_income_frequency": RightOf(often, width=95.0, gap=3.0),
    }


def _addendum_placements_es() -> dict[str, object]:
    def at(phrase: str, page: int, occurrence: int = 0, **extra) -> Anchor:
        return Anchor(phrase, page=page, occurrence=occurrence, **extra)

    placements: dict[str, object] = {
        # --- Sección 2, página 29 ------------------------------------------
        "health.tax_deductions.alimony": Over(
            at("Pensión alimenticia que paga $", 29)
        ),
        "health.tax_deductions.alimony_amount": AfterMarker(
            at("Pensión alimenticia que paga $", 29), width=70.0, height=13.0
        ),
        "health.tax_deductions.alimony_frequency": RightOf(
            at("¿Cada cuánto?", 29, 0), width=120.0, gap=3.0
        ),
        "health.tax_deductions.alimony_agreement_before_2019": _si_no(
            "el 31 de diciembre de 2018", 29
        ),
        "health.tax_deductions.student_loan_interest": Over(
            at("Interés del préstamo estudiantil $", 29)
        ),
        "health.tax_deductions.student_loan_interest_amount": AfterMarker(
            at("Interés del préstamo estudiantil $", 29), width=70.0, height=13.0
        ),
        "health.tax_deductions.student_loan_interest_frequency": RightOf(
            at("¿Cada cuánto?", 29, 1), width=120.0, gap=3.0
        ),
        "health.tax_deductions.other": Over(
            at("Otras deducciones, como gastos de educador", 29)
        ),
        # The Spanish line gives the amount, how often and the type one row.
        "health.tax_deductions.other_amount": AfterMarker(
            at("para los militares en servicio activo, matrícula y tarifas $", 29),
            width=24.0,
            height=13.0,
        ),
        "health.tax_deductions.other_frequency": RightOf(
            at("¿Cada cuánto?", 29, 2), width=42.0, gap=2.0
        ),
        "health.tax_deductions.other_types": RightOf(
            at("Tipo :", 29), width=44.0, gap=2.0
        ),
        # --- Sección 3, página 29 ------------------------------------------
        "health.child_travels_with_migrant_worker": _si_no(
            "1. ¿Viaja un niño que solicita atención médica con un familiar que "
            "es",
            29,
        ),
        "health.migrant_child_names": Below(
            at("Si contesta sí, ¿cuál es el nombre del niño o de los niños?", 29),
            width=400.0,
        ),
        "health.child_in_special_health_care_needs": _si_no(
            "2. ¿Participa un niño en el programa de Niños con Necesidades", 29
        ),
        "health.special_health_care_needs_who": Below(
            at("Si contesta “Sí”, ¿quién?", 29, 0), width=400.0
        ),
        "health.american_indian_or_alaska_native": _si_no(
            "3. ¿Es alguien indio americano o nativo de Alaska?", 29
        ),
        "household.foster_care_at_18_or_older": _si_no(
            "4. ¿Estuvo alguien bajo crianza temporal cuando tenía 18 años o "
            "más?",
            29,
        ),
        # The Spanish edition sets the writing space above these two labels,
        # where the English sets it beside them.
        "household.foster_care_at_18_or_older_who": Above(
            at("Si contesta “Sí”, ¿quién?", 29, 1), width=190.0
        ),
        "household.foster_care_at_18_or_older_state": Above(
            at("¿En qué estado?", 29), width=210.0
        ),
        "household.absent_parents": _si_no("en esta solicitud?", 29),
        "health.htw_confidential.street": RightOf(
            at("Dirección postal - Calle:", 29), width=250.0
        ),
        "health.htw_confidential.city": RightOf(at("Ciudad:", 29), width=165.0),
        "health.htw_confidential.state": RightOf(at("Estado:", 29), width=60.0),
        "health.htw_confidential.zip_code": RightOf(
            at("Código postal:", 29), width=60.0
        ),
        "health.htw_confidential.phone": RightOf(
            at("Número de teléfono:", 29), width=100.0
        ),
        **{
            key: placement
            for row in range(HTW_OPT_OUT_ROWS)
            for key, placement in (
                (
                    f"health.htw_screening_opt_out.{row}.name",
                    AfterMarker(
                        at(
                            "No quiero que me hagan la prueba para elegibilidad "
                            "de HTW",
                            29,
                            row,
                        ),
                        marker="Nombre:",
                        width=64.0,
                        height=13.0,
                    ),
                ),
                (
                    f"health.htw_screening_opt_out.{row}.declines",
                    RightOf(
                        at(
                            "No quiero que me hagan la prueba para elegibilidad "
                            "de HTW",
                            29,
                            row,
                        ),
                        width=9.0,
                        height=9.0,
                        # The Spanish box sits well past the end of the line.
                        gap=29.0,
                    ),
                ),
            )
        },
        # --- Sección 4, página 30 ------------------------------------------
        "income.total_this_year": RightOf(at("$", 30, 0), width=150.0),
        "income.total_next_year": RightOf(at("$", 30, 1), width=220.0),
        # --- Sección 5 -----------------------------------------------------
        "health.has_employer_coverage": _si_no(
            "otra persona, por ejemplo, de un padre o esposo).", 30
        ),
        "health.lost_job_coverage": _si_no("últimos 3 meses?", 30),
        "health.lost_job_coverage_who": Below(
            at("Si contesta “Sí”, ¿quién?", 30)
        ),
        "health.lost_job_coverage_end_date": Below(
            at("Si contesta “Sí”, fecha de terminación:", 30)
        ),
        # The same order as the English: parent's job, COBRA, marital status,
        # CHIP in another state, Medicaid in another state, private coverage,
        # a parent's death, special health-care needs, Medicaid ended, other.
        "health.lost_job_coverage_reason": (
            Over(at("Terminó el empleo del", 30)),
            Over(at("Terminó la cobertura de", 30)),
            Over(at("Cambió el estado civil", 30)),
            Over(at("Terminaron los beneficios", 30, 0)),
            Over(at("Terminaron los beneficios de", 30)),
            Over(at("Terminó la cobertura médica", 30)),
            Over(at("Murió uno de los padres", 30)),
            Over(at("El niño tiene necesidades", 30)),
            Over(at("Terminaron los beneficios", 30, 1)),
            Over(at("Otra:", 30)),
        ),
        "health.lost_job_coverage_other_reason": RightOf(
            at("Otra:", 30), width=70.0, gap=2.0
        ),
        # --- Sección 6 -----------------------------------------------------
        "household.incarcerated": _si_no(
            "A. ¿Está en la cárcel alguien que solicita cobertura médica?", 30
        ),
        "household.incarcerated_who": Below(
            at("Si contesta “Sí”, ¿quién está en la cárcel?", 30), width=400.0
        ),
        "health.renewal_years": tuple(
            Over(at(label, 30))
            for label in (
                "5 años (el máximo",
                "4 años",
                "3 años",
                "2 años",
                "1 año",
                "No use información de las",
            )
        ),
        # --- Apéndice A, página 31 -----------------------------------------
        **_employer_coverage_placements(
            page=31,
            employee=at(
                "1. Nombre del empleado (nombre, segundo nombre, apellido)", 31
            ),
            employer=at("3. Nombre del empleador", 31),
            ein=at("4. Número de identificación del empleador (EIN)", 31),
            address=at("5. Dirección del empleador", 31),
            phone_band=(505.0, 520.0),
            city=at("7. Ciudad", 31),
            state=at("8. Estado", 31),
            zip_code=at("9. Código postal", 31),
            contact=at(
                "10. ¿Con quién podemos comunicarnos sobre cobertura médica para "
                "empleados en este trabajo?",
                31,
            ),
            contact_phone_band=(424.0, 439.0),
            email=at("12. Dirección de correo electrónico", 31),
            eligible_yes=at("Sí (Continúe)", 31),
            eligible_no=at("No (Pare aquí y vaya a la página 9, Sección L)", 31),
            waiting=at(
                "13a. Si está en un período de espera o probatorio, ¿cuándo "
                "podrá inscribirse en la cobertura?",
                31,
            ),
            other_names=tuple(at("Nombre:", 31, slot) for slot in range(3)),
            minimum_value=_si_no(
                "14. ¿Ofrece el empleador un plan médico que satisfaga el "
                "estándar de valor mínimo*?",
                31,
            ),
            premium=at(
                "a. ¿Cuánto tendría que pagar en primas el empleado para este "
                "plan? $",
                31,
            ),
            # Two rows of three, so each option is found by its own words.
            frequencies=tuple(
                Over(at(word, 31, 0))
                for word in (
                    "Cada semana",
                    "Cada dos semanas",
                    "Dos veces al mes",
                    "Una vez al mes",
                    "Cada 3 meses",
                    "Una vez al año",
                )
            ),
            changes=(
                Over(at("El empleador no ofrecerá cobertura médica.", 31)),
                Over(at("El empleador empezará a ofrecer cobertura médica", 31)),
            ),
            changed_premium=at(
                "a. ¿Cuánto tendrá que pagar en primas el empleado para ese "
                "plan? $",
                31,
            ),
            changed_frequencies=tuple(
                Over(at(word, 31, 1))
                for word in (
                    "Cada semana",
                    "Cada dos semanas",
                    "Dos veces al mes",
                    "Una vez al mes",
                    "Cada 3 meses",
                    "Una vez al año",
                )
            ),
            change_date=at("Fecha de cambio (mes/día/año):", 31),
        ),
        # --- Apéndice B, página 33 -----------------------------------------
        **{
            key: placement
            for row in range(TRIBAL_ROWS)
            for key, placement in _tribal_placements(
                row,
                first=at("Nombre", 33, row),
                middle=at("Segundo nombre", 33, row),
                last=at("Apellido", 33, row),
                member=(
                    Over(at("Sí", 33, row, within=(524.0, 535.0))),
                    Over(at("No", 33, row, within=(470.0, 480.0))),
                ),
                # The label wraps; the space sits under "de la tribu?".
                tribe=at("de la tribu?", 33, row),
                # Closer to its rule than the English label is to its own.
                tribe_gap=0.5,
                received=(
                    Over(at("Sí", 33, row, within=(442.0, 452.0))),
                    Over(at("No", 33, row, within=(425.0, 435.0))),
                ),
                eligible=(
                    Over(at("Sí", 33, row, within=(337.0, 347.0))),
                    Over(at("No", 33, row, within=(337.0, 347.0))),
                ),
                amount=at("$", 33, row, within=(300.0, 308.0)),
                # The two "¿Cada cuánto?" sit 0.7 points apart, on either side
                # of a reading-order band, so the right-hand column reads first.
                often=at("¿Cada cuánto?", 33, 1 - row),
            ).items()
        },
        # --- Apéndice C, página 34 -----------------------------------------
        "household.authorized_representative.0.address.apartment": Below(
            at("3. Número de apartamento o lote", 34)
        ),
        # The label wraps to a second line that fills the cell, so the value
        # goes beside it.
        "household.authorized_representative.0.organization_id": RightOf(
            at("organización (si aplica)", 34), width=90.0, height=10.5, gap=6.0
        ),
        # This block is printed in English on the Spanish edition too.
        "household.application_assister.start_date": Below(
            at("1. Application start date (mm/dd/yyyy)", 34), width=200.0
        ),
        "household.application_assister.name": Below(
            at("2. First name, middle name, last name, & suffix", 34),
            width=340.0,
        ),
        "household.application_assister.organization": Below(
            at("3. Organization name", 34)
        ),
        "household.application_assister.organization_id": Below(
            at("4. Organization ID number (if applicable)", 34)
        ),
    }

    return placements


#: Canonical keys whose target is a printed circle rather than a writing space.
#:
#: Derived from the specs, so a new CHOICE or CHECKBOX is snapped without
#: anyone remembering to add it here. That matters because a mark that is not
#: snapped is not obviously wrong — it lands a point or four off centre, which
#: reads as sloppy printing rather than as a bug.
def _mark_keys() -> frozenset[str]:
    return frozenset(
        spec.key
        for spec in FIELD_SPECS
        if spec.kind in (FieldKind.CHOICE, FieldKind.CHECKBOX)
    )


def _snapped(placement: object) -> object:
    """A mark placement, centred on the circle it is meant to fill.

    Wraps each box — a CHOICE carries one per option — in
    :class:`~benefits_navigator.formmap.measure.SnapToCircle`, which finds the
    printed circle nearest the label-relative guess and centres on it.

    Why not a per-section offset instead: measuring all 166 mark targets
    against the circles they land in gave offsets with a standard deviation of
    1.3 points, and a mean that differs between the two editions. Section B's
    Yes/No circles sit four points below where a label offset puts them; the
    Spanish programme circles sit four points to the right. There is no single
    offset, and averaging would move most marks off centre to improve a few.
    """
    if isinstance(placement, tuple):
        return tuple(_snapped(inner) for inner in placement)

    # Already snapped to the square it belongs in; see `_square`.
    if isinstance(placement, SnapToSquare):
        return placement

    return SnapToCircle(placement)


def _merge(*groups: dict[str, object]) -> dict[str, object]:
    """Combine placement groups, refusing a key declared twice.

    A silent overwrite here would mean one of two placements for the same
    canonical key wins arbitrarily — and the loser is a box that never gets
    drawn on, with nothing to say so.

    Mark placements are snapped to their printed circle on the way through; see
    :func:`_snapped`.
    """
    merged: dict[str, object] = {}
    marks = _mark_keys()

    for group in groups:
        for key, placement in group.items():
            if key in merged:
                raise ValueError(f"{key} is placed twice on this edition")

            merged[key] = _snapped(placement) if key in marks else placement

    return merged


PLACEMENTS_EN = _merge(
    PLACEMENTS_EN,
    _GATEWAY_PLACEMENTS_EN,
    _APPLICANT_PERSON_PLACEMENTS_EN,
    *(_person_placements_en(row) for row in range(OFFICIAL_PERSON_ROWS)),
    *(_job_placements_en(row) for row in range(OFFICIAL_JOB_ROWS)),
    *(
        _other_money_placements_en(row)
        for row in range(OFFICIAL_OTHER_MONEY_ROWS)
    ),
    _housing_placements(_HOUSING_LABELS, 0),
    _representative_placements_en(),
    *(_tax_placements_en(slot) for slot in range(TAX_HOUSEHOLD_ROWS)),
    _addendum_placements_en(),
)

PLACEMENTS_ES = _merge(
    PLACEMENTS_ES,
    _GATEWAY_PLACEMENTS_ES,
    _APPLICANT_PERSON_PLACEMENTS_ES,
    *(_person_placements_es(row) for row in range(OFFICIAL_PERSON_ROWS)),
    *(_job_placements_es(row) for row in range(OFFICIAL_JOB_ROWS)),
    *(
        _other_money_placements_es(row)
        for row in range(OFFICIAL_OTHER_MONEY_ROWS)
    ),
    _housing_placements(_HOUSING_LABELS, 1),
    _representative_placements_es(),
    *(_tax_placements_es(slot) for slot in range(TAX_HOUSEHOLD_ROWS)),
    _addendum_placements_es(),
)


def _target(spec: Spec, boxes: dict[str, tuple], *, mark: bool) -> OverlayTarget:
    """The target for one spec on one edition, from that edition's boxes."""
    measured = boxes[spec.key]

    if spec.options:
        if len(measured) != len(spec.options):
            raise ValueError(
                f"{spec.key}: {len(spec.options)} options declared but "
                f"{len(measured)} boxes measured. Every option needs its own "
                f"circle, or a mark lands on the wrong one."
            )

        return OverlayTarget(
            option_boxes=dict(zip(spec.options, measured)),
            font_size=_MARK_SIZE,
            mark="X",
        )

    if mark:
        return OverlayTarget(box=measured[0], font_size=_MARK_SIZE, mark="X")

    if spec.segments:
        if len(measured) != len(spec.segments):
            raise ValueError(
                f"{spec.key}: {len(spec.segments)} printed cells declared but "
                f"{len(measured)} boxes measured."
            )

        return OverlayTarget(
            box=measured[0],
            segments=tuple(
                Segment(
                    box=box, start=start, end=end, strip=spec.segment_strip
                )
                for box, (start, end) in zip(measured, spec.segments)
            ),
            font_size=_VALUE_SIZE,
            # Centred, because a printed cell group is wider than the digits it
            # holds. Left-aligned, a two-digit month sat against the left edge of
            # its pair of cells and read as straddling the boundary rather than
            # filling them.
            alignment=Alignment.CENTER,
        )

    return OverlayTarget(
        box=measured[0],
        also_draw_at=tuple(measured[1:]),
        font_size=_VALUE_SIZE,
    )


def _targets_for(boxes: dict[str, tuple]) -> dict[str, OverlayTarget]:
    return {
        spec.key: _target(
            spec, boxes, mark=spec.kind is FieldKind.CHECKBOX
        )
        for spec in FIELD_SPECS
    }


def _mappings(targets: dict[str, OverlayTarget]) -> tuple[FieldMapping, ...]:
    return tuple(
        FieldMapping(
            key=spec.key,
            kind=spec.kind,
            target=targets[spec.key],
            transform=spec.transform,
            printed_label=spec.printed_label,
            section=spec.section,
            optional=spec.optional,
            # H1010 prints one household table where the canonical model keeps
            # a person's details on an adult or a child record. Either answers
            # the printed column, so the alternates have to reach the mapping —
            # they were declared on the spec and dropped here, which left every
            # child's residency, school and sex answer unplaced while the
            # adults' worked.
            alternate_keys=spec.alternate_keys,
            applies_when=spec.applies_when,
            drawn_only_with=spec.drawn_only_with,
        )
        for spec in FIELD_SPECS
    )


#: Printed blocks on pages 1-3 that we deliberately do not fill.
BLANKS: tuple[DeclaredBlank, ...] = (
    DeclaredBlank(
        printed_label="Social Security number (Person 1, printed pages 1 and 3)",
        section=_A,
        responsibility=Responsibility.SENSITIVE_REFUSED,
        reason_key="blank_sensitive_never_collected",
        page=5,
    ),
    DeclaredBlank(
        printed_label=(
            "Medicaid or CHIP: Children / Adult Caring for a Child / Adult not "
            "Caring for a Child / Pregnant Women / Healthy Texas Women"
        ),
        section=_A,
        responsibility=Responsibility.APPLICANT,
        reason_key="blank_medicaid_category_is_yours_to_choose",
        page=5,
    ),
    DeclaredBlank(
        printed_label=(
            "Sign here (or have someone with the right to act for you sign), "
            "and Date"
        ),
        section=_B,
        responsibility=Responsibility.SIGNATURE,
        page=5,
    ),
    DeclaredBlank(
        printed_label="Agency Use Only — Expedite?, Date received, Screened by, Case",
        section=_B,
        responsibility=Responsibility.AGENCY,
        reason_key="blank_agency_completes",
        page=6,
    ),
    DeclaredBlank(
        printed_label=(
            "Social Security claim number / Railroad retirement number"
        ),
        section=_G,
        responsibility=Responsibility.SENSITIVE_REFUSED,
        reason_key="blank_sensitive_never_collected",
        page=7,
    ),
    DeclaredBlank(
        printed_label="Immigrant registration number, and sponsor's name",
        section=_G,
        responsibility=Responsibility.SENSITIVE_REFUSED,
        reason_key="blank_sensitive_never_collected",
        page=7,
    ),
    DeclaredBlank(
        printed_label=(
            "Optional Questions — race and ethnicity (Hispanic or Latino?, and "
            "Mark one or more)"
        ),
        section=_G,
        responsibility=Responsibility.APPLICANT,
        reason_key="blank_optional_and_not_collected",
        page=7,
    ),
)


#: Canonical answers the form prints somewhere we have not measured yet.
#:
#: Every one of these is carried to the review sheet by name, so the applicant
#: is told which of their own answers still has to be written on the form. The
#: list is the remaining work on this form, stated where it cannot be forgotten
#: rather than in a tracker.
#: The printed tables this form has, at the capacity it actually prints.
#:
#: Read by ``resolve_mappings`` to report overflow: a household of seven has
#: three people the form has no row for, and the review sheet says so and tells
#: them to attach a sheet. Without this the extra rows would simply not appear,
#: which is the failure a paper application cannot recover from.
OFFICIAL_GROUPS: tuple[RepeatingGroup, ...] = (
    RepeatingGroup(
        prefix="household.members",
        rows=OFFICIAL_PERSON_ROWS,
        row_noun="Person",
        presence_suffix="present",
    ),
    RepeatingGroup(
        prefix="income.earned", rows=OFFICIAL_JOB_ROWS, row_noun="Job"
    ),
    RepeatingGroup(
        prefix="income.unearned",
        rows=OFFICIAL_OTHER_MONEY_ROWS,
        row_noun="Other income",
    ),
    # The Medicaid / CHIP addendum's lists. Each says what to do with the
    # rows it cannot hold, in the form's own terms — Appendix A asks for "a
    # copy of this page for each job that offers coverage".
    RepeatingGroup(
        prefix="health.tax_household",
        rows=TAX_HOUSEHOLD_ROWS,
        row_noun="Section 1 person",
        overflow_note="h1010m_tax_people",
    ),
    RepeatingGroup(
        prefix="health.htw_screening_opt_out",
        rows=HTW_OPT_OUT_ROWS,
        row_noun="HTW name line",
        overflow_note="h1010m_htw_opt_outs",
    ),
    RepeatingGroup(
        prefix="appendices.employer_coverage",
        rows=EMPLOYER_COVERAGE_ROWS,
        row_noun="Appendix A job",
        overflow_note="h1010m_appendix_a",
    ),
    RepeatingGroup(
        prefix="appendices.tribal",
        rows=TRIBAL_ROWS,
        row_noun="Appendix B person",
        overflow_note="h1010m_appendix_b",
    ),
)

#: How the intake's answers are re-projected into the shape H1010 asks for.
#:
#: Nothing here invents a value; see ``definition.Derivation`` for the line
#: these may not cross. Each one exists because the form asks a question the
#: intake asks differently — never because a value was missing.
DERIVATIONS: tuple[Derivation, ...] = (
    # Section P prints one labelled amount box per kind of housing cost; the
    # intake collects an indexed list of bills, each carrying its kind.
    PivotByKind(
        prefix="expenses.household",
        rows=5,
        kind_field="kind",
        value_field="amount_monthly",
        into=HOUSING_AMOUNTS,
        allowed=HOUSING_KINDS,
        # "Mark the costs they have and list the amount" — the circle beside
        # each box, marked for the kinds that got one.
        mark_into=HOUSING_MARKS,
    ),
    # Section O asks about money from working for someone else *or* for
    # yourself in one question. The intake asks the two separately.
    AnyYes(
        into=HAS_JOB_OR_SELF_EMPLOYMENT,
        sources=("income.has_earned_income", "income.has_self_employment"),
    ),
    # Section B question 3 asks about any money at all expected this month.
    AnyYes(
        into=EXPECTS_MONEY_THIS_MONTH,
        sources=(
            "income.has_earned_income",
            "income.has_self_employment",
            "income.has_unearned_income",
        ),
    ),
    # Section N page 12 asks about cash, bank accounts, property, insurance
    # and stocks in one question; the intake asks three narrower ones.
    AnyYes(
        into=OWNS_LISTED_ITEMS,
        sources=(
            "resources.has_accounts",
            "resources.has_real_property",
            "resources.has_personal_property",
        ),
    ),
    # The form gives one line where the intake collects two answers.
    JoinValues(
        into=HOME_ADDRESS_LINE,
        sources=(
            "applicant.home_address.street",
            "applicant.home_address.apartment",
        ),
    ),
    JoinValues(
        into=MAILING_ADDRESS_LINE,
        sources=(
            "applicant.mailing_address.street",
            "applicant.mailing_address.apartment",
        ),
    ),
    *(
        JoinValues(
            into=payer_line(row),
            sources=(
                f"income.earned.{row}.employer_name",
                f"income.earned.{row}.employer_address",
            ),
        )
        for row in range(OFFICIAL_JOB_ROWS)
    ),
    # Section Q's "costs to take care of others" covers dependent care and
    # court-ordered child support, which the intake asks about separately.
    AnyYes(
        into=HAS_CARE_COSTS,
        sources=(
            "expenses.has_dependent_care",
            "expenses.pays_child_support",
        ),
    ),
)


def build() -> FormDefinition:
    """The H1010 definition, measured against both official editions."""
    en_boxes = load_measurements(TX_H1010_EN)
    es_boxes = load_measurements(TX_H1010_ES)

    en_targets = _targets_for(en_boxes)
    es_targets = _targets_for(es_boxes)

    # The English edition is the primary: its targets are the ones a caller
    # that never asks for a locale gets. That is a default, not a preference —
    # `generate_form(..., locale="es")` resolves the Spanish variant and swaps
    # both `base_document` and every target for the Spanish one, through
    # `documents.resolve_for_definition`.
    #
    # That claim used to be false, and it is worth saying so here because this
    # is the line that made it look true. `generate_form` had no `locale`
    # parameter at all, so nothing ever swapped anything: the English filename
    # below was what every applicant received, in every language, and the whole
    # variant mechanism was reachable only from tests.
    fields = _mappings(en_targets)

    variants = (
        DocumentVariant(
            document=TX_H1010_EN,
            targets=en_targets,
        ),
        DocumentVariant(
            document=TX_H1010_ES,
            targets=es_targets,
            # Declared on every spec; without this the Spanish review sheet
            # named each question in English.
            printed_labels={
                spec.key: spec.printed_label_es
                for spec in FIELD_SPECS
                if spec.printed_label_es
            },
        ),
    )

    return FormDefinition(
        form_id=FORM_ID,
        form_code="H1010",
        title="Texas Works Application for Assistance — Your Texas Benefits",
        state="TX",
        # The default edition, for a caller that names no locale. The resolver
        # replaces all four of these fields for the chosen variant; see
        # `documents.resolve_for_definition`.
        document_language="en",
        page_count=TX_H1010_EN.page_count,
        base_document=TX_H1010_EN.filename,
        source_url=TX_H1010_EN.source_url,
        fields=fields,
        blanks=BLANKS,
        variants=variants,
        repeating_groups=OFFICIAL_GROUPS,
        derived=DERIVATIONS,
        no_box_notes=NOT_ON_THIS_FORM,
    )
