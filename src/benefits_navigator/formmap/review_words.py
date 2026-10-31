#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The review sheet's own wording, in the applicant's language.

The review sheet is the completion guide for every document the mapping layer
renders — it is what the guide route serves for Texas — and it was written
entirely in English. So a Spanish applicant could reach the end of a Spanish
interface, generate a document, and be handed the one page that explains what to
do next in a language they had not chosen.

── What is translated here and what is not ────────────────────────────────
Only the sheet's **own** sentences: its headings, and the instructions we are
giving. Those are ours, and there is no reason for them to be in English.

Not translated, deliberately:

* **Printed labels.** ``mapping.printed_label`` is the agency's own wording for
  a box on the page. An applicant matching the sheet against the paper in their
  hand needs the words that are actually printed there, so a translated label
  would make the sheet harder to use, not easier.
* **The form's title and code.** ``H1010`` is what a county office recognises.
* **The applicant's own answers.** Obviously.

That split is the same one the rest of the product keeps: translate the
explanation, never the government form.

── Why a table and not gettext ────────────────────────────────────────────
There are two locales and about twenty strings, all of them read on one code
path. A catalogue keyed by an English-named constant is greppable, diffs
readably, and cannot fall out of step with a ``.po`` file nobody regenerates.
:func:`words_for` falls back to English for any locale we have no table for,
which is the honest outcome — an untranslated sheet, not a crash and not a
machine translation.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field


@dataclass(frozen=True)
class ReviewWords:
    """Every sentence the review sheet writes for itself, in one language."""

    #: Banner for a Navigator-authored worksheet.
    not_official_heading: str
    not_official_body: str
    not_official_why: str

    #: Banner naming the official document the applicant is holding.
    official_language_exact: str
    official_language_bilingual: str
    official_language_fallback: str

    #: Section headings.
    filled_in: str
    nothing_supplied: str
    left_blank_heading: str
    left_blank_signature: str
    left_blank_sensitive: str
    still_yours: str
    only_if_applies: str
    not_applicable: str
    because: str
    too_long: str
    unplaced: str
    overflow: str
    review_before_submitting: str

    #: ``{filled}``/``{rows}``/``{blank}``/``{noun}`` row summary.
    rows_summary: str

    #: ``{noun}``/``{beyond}``/``{rows}`` overflow line.
    overflow_row: str

    #: Headings for what the form leaves to someone else.
    declared_blank_heading: str
    declared_blank_agency: str
    declared_blank_third_party: str
    declared_blank_signature: str

    #: Heading and lead-in for answers the form has no box for.
    no_box_heading: str
    no_box_intro: str

    #: Instructions for a specific answer with nowhere to go, by action key.
    no_box_actions: dict[str, str] = dataclass_field(default_factory=dict)

    #: Sentences for ``FormDefinition.base_document_note_key``, by that key.
    #:
    #: Why the document in the applicant's hands is a worksheet rather than the
    #: agency's own paper, said in words they can read and without naming a
    #: module or a file.
    worksheet_reasons: dict[str, str] = dataclass_field(default_factory=dict)

    #: Sentences for ``OfficialDocument.language_scope_key``, by that key.
    #:
    #: A document that is bilingual on only some of its pages names the
    #: qualification with a key; the sentence lives here, so it is translated
    #: for the reader who needs it. Keyed rather than inlined on the document
    #: because ``provenance`` records facts about files and holds no prose.
    scope_notes: dict[str, str] = dataclass_field(default_factory=dict)


ENGLISH = ReviewWords(
    not_official_heading="THIS IS NOT THE OFFICIAL FORM.",
    not_official_body=(
        "It is a prefilled worksheet carrying your answers. Submit the "
        "official application through the agency's own channel and copy "
        "these answers across."
    ),
    not_official_why="Why",
    official_language_exact=(
        "This is the agency's own form, published in your language, with your "
        "answers added where possible."
    ),
    official_language_bilingual=(
        "This is the agency's own form. It is an official bilingual document — "
        "the agency prints every question in English and Spanish in this one "
        "form — with your answers added where possible."
    ),
    official_language_fallback=(
        "This is the agency's own form, with your answers added where "
        "possible. The agency does not publish it in your language, so the "
        "form itself is in English. This page is in your language."
    ),
    filled_in="Filled in for you:",
    nothing_supplied="(nothing — no answers were supplied)",
    left_blank_heading="Left blank on purpose:",
    left_blank_signature=(
        "Your signature and the date you sign. We never fill these in."
    ),
    left_blank_sensitive=(
        "Social Security numbers and immigration document numbers. We do not "
        "ask for them and never write them onto a form."
    ),
    still_yours="Still yours to fill in:",
    only_if_applies=(
        "Only if it applies to you — blank is a complete answer:"
    ),
    not_applicable="Not applicable to your household — leave these blank:",
    because="Because",
    too_long=(
        'Too long for the printed box — write "see attached" and attach the '
        "full answer:"
    ),
    unplaced=(
        "Mapped but with nowhere to render (a definition defect — please "
        "report):"
    ),
    overflow=(
        "More than this form has room for — attach a separate sheet with the "
        "rest:"
    ),
    review_before_submitting="Review every page before submitting.",
    declared_blank_heading="Left for someone else to complete:",
    declared_blank_agency="The benefits office fills this in.",
    declared_blank_third_party=(
        "Someone other than you fills this in — an employer, a doctor or a "
        "nurse."
    ),
    declared_blank_signature="You sign this yourself, after you read the form.",
    no_box_heading="You told us this, and the form has no box for it:",
    no_box_intro=(
        "None of these is lost. Each one is either something the benefits "
        "office asks you in person, or something you write in yourself where "
        "the note below says."
    ),
    no_box_actions={
        "uncollected_tx_h1010_medicaid_category": (
            "On printed page 1, under \"Medicaid or CHIP\", fill in the "
            "circle for who is applying: Children, Adult Caring for a Child, "
            "Adult not Caring for a Child, Pregnant Women, or Healthy Texas "
            "Women. We do not choose this for you."
        ),
        "uncollected_tx_h1010_your_medicaid_category": (
            "In your own block on printed page 3, under \"Medicaid or CHIP\", "
            "fill in the one circle that describes you: Children, Adult "
            "Caring for a Child, Adult not Caring for a Child, Pregnant "
            "Women, or Healthy Texas Women. Your food and cash-help circles "
            "are already marked."
        ),
        "uncollected_tx_h1010_person_medicaid_category": (
            "In this person's block, under \"Medicaid or CHIP\", fill in the "
            "one circle that describes them: Children, Adult Caring for a "
            "Child, Adult not Caring for a Child, Pregnant Women, or Healthy "
            "Texas Women. Their food and cash-help circles are already "
            "marked."
        ),
        "uncollected_tx_h1010_ask_at_interview": (
            "The benefits office will ask you this at your interview. Nothing "
            "to write on the form."
        ),
        "uncollected_tx_h1010_mark_the_person": (
            "The form asks this once per person. In Section H, mark it for "
            "the person it is true of."
        ),
        "uncollected_tx_h1010_foster_care_age": (
            "The form asks a narrower question — whether anyone was in foster "
            "care at age 18 or older. Answer that one yourself on the "
            "Medicaid/CHIP pages."
        ),
        "uncollected_tx_h1010_expedited_at_interview": (
            "This is one of the things that can get you food benefits by the "
            "next work day. The form has no box for it; tell the benefits "
            "office when you apply."
        ),
        "uncollected_tx_h1010_pay_per_period": (
            "Section O asks how much you are paid *each payday*, not for the "
            "month. We have your monthly total, which is a different number, "
            "so we left the box blank rather than write the wrong figure. "
            "Write what one paycheck is, before taxes."
        ),
    },
    rows_summary=(
        "rows: you filled {filled} of {rows}. Leave the other {blank} "
        "blank — there is no {noun} to put in them."
    ),
    overflow_row="{noun}: {beyond} more than the {rows} printed rows.",
    scope_notes={
        "form_document_bilingual_scope_signature_page_only": (
            "The authorization you sign (page 2) is printed in English and "
            "Spanish. Page 1 is completed by a medical professional and is "
            "printed in English only."
        ),
    },
    worksheet_reasons={
        "worksheet_reason_tx_h1010_partial_coverage": (
            "Texas HHSC's own H1010 is designed to be completed by hand, and "
            "we can currently fill only its first few pages. This worksheet "
            "carries every answer you gave instead. The official form, in "
            "your language, is here too -- copy your answers onto it."
        ),
    },
)


SPANISH = ReviewWords(
    not_official_heading="ESTE NO ES EL FORMULARIO OFICIAL.",
    not_official_body=(
        "Es una hoja de trabajo llena con sus respuestas. Presente la "
        "solicitud oficial por el canal de la agencia y copie estas "
        "respuestas."
    ),
    not_official_why="Por qué",
    official_language_exact=(
        "Este es el formulario oficial de la agencia, publicado en su idioma, "
        "con sus datos agregados donde fue posible."
    ),
    official_language_bilingual=(
        "Este es el formulario oficial de la agencia. Es un documento oficial "
        "bilingüe — la agencia imprime cada pregunta en inglés y en español en "
        "este mismo formulario — con sus datos agregados donde fue posible."
    ),
    official_language_fallback=(
        "Este es el formulario oficial de la agencia, con sus datos agregados "
        "donde fue posible. La agencia no lo publica en su idioma, así que el "
        "formulario está en inglés. Esta página sí está en su idioma."
    ),
    filled_in="Lo que llenamos por usted:",
    nothing_supplied="(nada — no se dieron respuestas)",
    left_blank_heading="Dejado en blanco a propósito:",
    left_blank_signature=(
        "Su firma y la fecha en que firma. Nunca las llenamos nosotros."
    ),
    left_blank_sensitive=(
        "Números de Seguro Social y números de documentos de inmigración. No "
        "los pedimos y nunca los escribimos en un formulario."
    ),
    still_yours="Le toca llenar esto:",
    only_if_applies=(
        "Solo si le corresponde — dejarlo en blanco es una respuesta "
        "completa:"
    ),
    not_applicable=(
        "No corresponde a su hogar — deje esto en blanco:"
    ),
    because="Porque",
    too_long=(
        'Demasiado largo para el espacio impreso — escriba "see attached" y '
        "adjunte la respuesta completa:"
    ),
    unplaced=(
        "Asignado pero sin lugar donde imprimirse (un defecto de la "
        "definición — favor de reportarlo):"
    ),
    overflow=(
        "Más de lo que cabe en este formulario — adjunte una hoja aparte con "
        "el resto:"
    ),
    review_before_submitting="Revise cada página antes de presentarla.",
    declared_blank_heading="Lo que otra persona debe llenar:",
    declared_blank_agency="La oficina de beneficios llena esto.",
    declared_blank_third_party=(
        "Alguien que no es usted llena esto: un empleador, un médico o una "
        "enfermera."
    ),
    declared_blank_signature=(
        "Usted firma esto, después de leer el formulario."
    ),
    no_box_heading=(
        "Usted nos dijo esto y el formulario no tiene espacio para ello:"
    ),
    no_box_intro=(
        "No se pierde nada. Cada cosa es algo que la oficina de beneficios le "
        "pregunta en persona, o algo que usted escribe donde le indica la "
        "nota."
    ),
    no_box_actions={
        "uncollected_tx_h1010_medicaid_category": (
            "En la página 1 impresa, debajo de \"Medicaid o CHIP\", llene el "
            "círculo de quién solicita: Niños, Adulto que cuida a un niño, "
            "Adulto que no cuida a un niño, Mujeres embarazadas, o Healthy "
            "Texas Women. Nosotros no elegimos esto por usted."
        ),
        "uncollected_tx_h1010_your_medicaid_category": (
            "En su propio bloque, en la página 3 impresa, debajo de "
            "\"Medicaid o CHIP\", llene el círculo que le corresponde: Niños, "
            "Adulto que cuida a un niño, Adulto que no cuida a un niño, "
            "Mujeres embarazadas, o Healthy Texas Women. Sus círculos de "
            "comida y ayuda en efectivo ya están marcados."
        ),
        "uncollected_tx_h1010_person_medicaid_category": (
            "En el bloque de esta persona, debajo de \"Medicaid o CHIP\", "
            "llene el círculo que le corresponde: Niños, Adulto que cuida a un "
            "niño, Adulto que no cuida a un niño, Mujeres embarazadas, o "
            "Healthy Texas Women. Sus círculos de comida y ayuda en efectivo "
            "ya están marcados."
        ),
        "uncollected_tx_h1010_ask_at_interview": (
            "La oficina de beneficios le preguntará esto en su entrevista. No "
            "hay nada que escribir en el formulario."
        ),
        "uncollected_tx_h1010_mark_the_person": (
            "El formulario pregunta esto una vez por persona. En la Sección "
            "H, márquelo para la persona a quien le corresponde."
        ),
        "uncollected_tx_h1010_foster_care_age": (
            "El formulario hace una pregunta más específica: si alguien "
            "estuvo en cuidado de crianza a los 18 años o más. Contéstela "
            "usted en las páginas de Medicaid/CHIP."
        ),
        "uncollected_tx_h1010_expedited_at_interview": (
            "Esto es una de las cosas que pueden darle beneficios de comida "
            "el siguiente día de trabajo. El formulario no tiene espacio para "
            "ello; dígaselo a la oficina de beneficios cuando solicite."
        ),
        "uncollected_tx_h1010_pay_per_period": (
            "La Sección O pregunta cuánto le pagan *cada día de pago*, no en "
            "el mes. Tenemos su total del mes, que es un número distinto, así "
            "que dejamos el espacio en blanco en vez de escribir la cifra "
            "equivocada. Escriba cuánto es un cheque, antes de impuestos."
        ),
    },
    rows_summary=(
        "filas: llenó {filled} de {rows}. Deje las otras {blank} en blanco — "
        "no hay más {noun} que poner."
    ),
    overflow_row="{noun}: {beyond} más de las {rows} filas impresas.",
    scope_notes={
        "form_document_bilingual_scope_signature_page_only": (
            "La autorización que usted firma (página 2) está impresa en "
            "inglés y español. La página 1 la completa un profesional médico "
            "y está impresa solo en inglés."
        ),
    },
    worksheet_reasons={
        "worksheet_reason_tx_h1010_partial_coverage": (
            "El formulario H1010 de HHSC de Texas está hecho para llenarse a "
            "mano, y por ahora solo podemos llenar sus primeras páginas. En "
            "su lugar, esta hoja de trabajo lleva todas las respuestas que "
            "usted dio. El formulario oficial, en su idioma, también está "
            "aquí: copie sus respuestas en él."
        ),
    },
)


_TABLES: dict[str, ReviewWords] = {"en": ENGLISH, "es": SPANISH}


def words_for(locale: str) -> ReviewWords:
    """The review sheet's wording for `locale`, falling back to English.

    Falls back rather than raising: an English review sheet beside a correctly
    filled form is a real limitation and worth being visible, but it is much
    better than refusing to produce the document at all.
    """
    tag = (locale or "en").strip().replace("_", "-").split("-")[0].lower()

    return _TABLES.get(tag, ENGLISH)


def supported_locales() -> tuple[str, ...]:
    """Locales the review sheet has its own wording for."""
    return tuple(sorted(_TABLES))
