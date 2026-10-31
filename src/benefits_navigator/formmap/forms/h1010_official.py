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
representative — 115 placements on each edition.

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
)
from benefits_navigator.formmap.definition import (
    AnyYes,
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
        Spec(f"{prefix}.reported_frequency", FieldKind.CHOICE,
             f"How often are you paid? (Money type {money})", _O_OTHER,
             options=FREQUENCY_OPTIONS,
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
)

#: Every canonical key this form places, in printed order.
PLACED_KEYS: tuple[str, ...] = tuple(spec.key for spec in FIELD_SPECS)


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
        return tuple(SnapToCircle(inner) for inner in placement)

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
