#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""What the applicant is getting, described once, for the interface to render.

The bridge between the two halves of this product. Python owns which forms a
household needs (:mod:`benefits_navigator.formmap.packet`) and which official
asset answers each one for a given locale
(:mod:`benefits_navigator.formmap.documents`). TypeScript owns what a person
sees. This module is how the first tells the second, and its whole purpose is
that the interface never re-derives any of it.

── Why this exists rather than a TypeScript catalog ───────────────────────
The alternative was to describe the Texas forms a second time in
``web/src/lib``, which is where the bug this module was written for would have
reappeared. The interface needs to say "English & Spanish" for H1049 and
"Español" for H1010, and the only honest source for that distinction is what
each ``OfficialDocument`` declares it prints. A TypeScript copy would have had
to encode it — and the obvious encoding is exactly the one now known to be
wrong::

    locale === 'es' ? fileWith('-ES-') : fileWith('-EN-')

which silently hands a Spanish applicant the English H1049, or nothing at all,
because the Spanish H1049 is a file named ``-BI-``. So the asset decision is
made once, here, and travels as data.

── What crosses the boundary, and what deliberately does not ──────────────
Every field below is either a **message key** the interface translates or a
**fact about the document** it displays. Two things are absent on purpose:

* **Sentences.** The interface renders in the applicant's language and owns its
  own wording; a Spanish string arriving from Python could only disagree with
  the catalog. Message keys travel; prose does not. The exception is the
  agency's own ``title`` and ``form_code``, which are never translated because
  they are what a county office recognises.
* **Storage names.** ``source_filename`` is present and is marked, in the
  interface's own types, as developer-only. Nothing an applicant reads is built
  from it. What they see when they save the file is ``download_name``, which is
  computed here so the two cannot diverge.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field as dataclass_field
from typing import Any

from benefits_navigator.formmap.documents import (
    BILINGUAL_DOCUMENT_MESSAGE_KEY,
    LanguageMatch,
    resolve_for_definition,
)
from benefits_navigator.formmap.packet import (
    Packet,
    PacketContext,
    PlannedForm,
    plan_packet,
)
from benefits_navigator.formmap.pipeline import download_name
from benefits_navigator.formmap.registry import UnknownForm, definition_for_form


@dataclass(frozen=True)
class DocumentDescriptor:
    """The physical asset an applicant receives for one form, described.

    Everything a card needs in order to be truthful about language without the
    reader ever meeting a locale code or a filename.
    """

    #: Every language the document itself prints, as BCP-47 tags.
    #:
    #: The list, not the matched one. ``("en", "es")`` is what lets a card say
    #: "English & Spanish" instead of picking one and implying the other is
    #: missing.
    languages: tuple[str, ...]

    #: True when one asset serves several languages.
    is_bilingual: bool

    #: ``exact`` | ``bilingual`` | ``fallback``. Never shown raw.
    language_match: str

    #: Whether the applicant can read the paper they were handed.
    is_in_applicants_language: bool

    #: Message key naming a limitation, or None when there is none.
    #:
    #: Set only for a genuine fallback. A bilingual document carries
    #: :data:`~benefits_navigator.formmap.documents.BILINGUAL_DOCUMENT_MESSAGE_KEY`
    #: in :attr:`note_key` instead, because "the agency publishes this in both
    #: languages" is information, not a shortfall, and reusing the fallback key
    #: would have told a Spanish reader their form is English-only while handing
    #: them HHSC's Spanish text.
    limitation_key: str | None

    #: Message key for a positive statement about the document's language.
    note_key: str | None

    #: Message key qualifying a partly-bilingual document, or None.
    #:
    #: H3037's page 1 is the clinician's and is English only. A card that said
    #: "English & Spanish" flat would overstate it.
    scope_note_key: str | None

    #: The filename the applicant sees when they save it.
    download_name: str

    #: The canonical storage name. **Developer surfaces only.**
    source_filename: str

    #: What the document prints about its own revision, e.g. ``"12/2001"``.
    printed_revision: str

    #: The first-party page it was retrieved from, for a "see the official
    #: source" affordance.
    source_url: str


@dataclass(frozen=True)
class FormEntry:
    """One form in a household's packet, ready for the interface to render."""

    form_id: str

    #: The agency's own designation. Never translated: "H1010", not
    #: "Formulario H1010" — a county website search for the latter finds
    #: nothing. The interface composes its own localized label *around* it.
    form_code: str

    #: The agency's own title, in the document's language.
    title: str

    state: str

    #: ``main_application`` | ``applicant_verification`` | …
    category: str

    #: ``required`` | ``needs_confirmation`` | ``optional``
    requirement: str

    #: Message key for why this form is in the packet.
    reason_key: str

    #: Message key for what the form is for, in plain language.
    purpose_key: str

    #: The household's own selected programmes that this form serves.
    #:
    #: The *intersection*, not the form's full coverage. H1010 covers five
    #: Texas programmes; a card listing all five for a household applying for
    #: two would be telling them about benefits they did not ask for, on a card
    #: whose job is to explain the paperwork they did ask for.
    programs: tuple[str, ...]

    #: Whether we can produce a prepared copy of this document at all.
    can_be_prepared: bool

    #: Message key explaining why not, when we cannot.
    unavailable_reason_key: str | None

    #: The asset, or None for a catalog-only form we hold no document for.
    document: DocumentDescriptor | None

    #: How much of the form our answers filled, when we prepared it.
    prefill: PrefillStatus | None = None


@dataclass(frozen=True)
class PrefillStatus:
    """How far a prepared document got, for a "what's done" line on the card.

    Counts rather than a percentage. "We filled 24 of 29 boxes" is checkable
    against the review sheet; "83% complete" invites an applicant to believe the
    remaining 17% is ours to finish when some of it is a signature only they can
    give.
    """

    #: Boxes our answers filled.
    filled: int

    #: Boxes this form maps in total.
    mapped: int

    #: Whether the values sit on the agency's own paper.
    is_official_document: bool

    #: Boxes we deliberately left for someone else, by responsibility.
    #:
    #: Keyed by message key so the card can say "your doctor completes 14 of
    #: these" in the applicant's language.
    left_for_others: dict[str, int] = dataclass_field(default_factory=dict)


#: Plain-language purpose, by form code, as a message key.
#:
#: Keyed by the agency's code rather than our form id so the same key serves the
#: worksheet and the official definition of one form — they are the same form to
#: an applicant, and two keys could drift into describing it two ways.
_PURPOSE_KEYS: dict[str, str] = {
    "H1010": "form_purpose_tx_h1010",
    "H1049": "form_purpose_tx_h1049",
    "H3037": "form_purpose_tx_h3037",
    "H1028-MBIC": "form_purpose_tx_h1028_mbic",
    "SAWS 2 PLUS": "form_purpose_ca_saws2plus",
}

#: What each form is, for its download filename. "" leaves it out.
#:
#: The main application earns the word; a two-page self-employment ledger does
#: not need ``Texas-H1049-Clients-Statement-Of-Self-Employment-Income-…``.
_DOWNLOAD_KINDS: dict[str, str] = {
    "H1010": "Application",
    "SAWS 2 PLUS": "Application",
}

#: Catalog form id → the registry definition whose variants name its editions.
#:
#: Separate from the catalog because they are separate questions. The catalog
#: knows H1049 is a form a household may need; the registry only holds
#: definitions for forms we can *map*.
#:
#: ── Why H1010 points at the *official* definition ──────────────────────────
#: ``TX_H1010`` is the Navigator worksheet, and it is what a household is
#: served today, because the official definition places 29 of 156 answers and a
#: government form with three pages filled and eighteen blank helps nobody. But
#: the worksheet is a transcription aid *for* a specific official edition, and
#: which edition that is depends on the applicant's language. So the card
#: describes ``TX_H1010_OFFICIAL`` — the two verified HHSC editions — because
#: that is the paper the applicant will actually file, and a Spanish applicant
#: needs to be handed the Spanish one.
#:
#: The prefilled artifact and the official document are therefore two separate
#: things on the same card, which is what they are. Reporting the worksheet's
#: own (English-only, Navigator-authored) language as the applicant's document
#: language would have been the quiet substitution this layer exists to prevent.
_DEFINITION_FOR_CATALOG_FORM: dict[str, str] = {
    "TX_H1010": "TX_H1010_OFFICIAL",
    "TX_H3037": "TX_H3037",
}

#: Catalog form id → an official document we hold but map no fields onto.
#:
#: These are handed over blank, in the right language, which is a genuinely
#: useful thing to be able to do: the applicant gets the agency's own paper
#: instead of hunting a catalog that cannot be linked to directly.
_UNMAPPED_DOCUMENTS: dict[str, str] = {
    "TX_H1049": "TX_H1049_BILINGUAL",
    "TX_H1028_MBIC": "TX_H1028_MBIC_EN",
}


def _document_by_name(name: str) -> Any:
    from benefits_navigator.formmap.forms import tx_documents

    return getattr(tx_documents, name)


def _descriptor_from_document(
    document: Any,
    *,
    locale: str,
    state: str,
    form_code: str,
) -> DocumentDescriptor:
    """A descriptor for an asset with no variants to choose between.

    Used for the documents we hold but have not measured. The language answer is
    still read off the document rather than off the locale — which is the whole
    point, and the reason H1049 reports bilingual for both an English and a
    Spanish applicant instead of one of them getting a fallback notice.
    """
    from benefits_navigator.formmap.documents import _base_language

    wanted = _base_language(locale)
    serves = document.serves_language(wanted)

    if serves and document.is_bilingual:
        match = LanguageMatch.BILINGUAL
    elif serves:
        match = LanguageMatch.EXACT
    else:
        match = LanguageMatch.FALLBACK

    return _build_descriptor(
        document=document,
        match=match,
        state=state,
        form_code=form_code,
    )


def _build_descriptor(
    *,
    document: Any,
    match: LanguageMatch,
    state: str,
    form_code: str,
) -> DocumentDescriptor:
    from benefits_navigator.formmap.documents import (
        LANGUAGE_FALLBACK_MESSAGE_KEY,
    )

    return DocumentDescriptor(
        languages=tuple(document.languages),
        is_bilingual=document.is_bilingual,
        language_match=match.value,
        is_in_applicants_language=match.is_in_applicants_language,
        limitation_key=(
            LANGUAGE_FALLBACK_MESSAGE_KEY
            if match is LanguageMatch.FALLBACK
            else None
        ),
        note_key=(
            BILINGUAL_DOCUMENT_MESSAGE_KEY
            if match is LanguageMatch.BILINGUAL
            else None
        ),
        # Read off the document, which is the only thing that knows how far
        # its own bilingual printing goes. Only meaningful for a bilingual
        # match: on a fallback the document's Spanish coverage is not what the
        # applicant needs told, and on an exact match there is nothing to
        # qualify.
        scope_note_key=(
            (getattr(document, "language_scope_key", "") or None)
            if match is LanguageMatch.BILINGUAL
            else None
        ),
        download_name=download_name(
            state=state,
            form_code=form_code,
            languages=tuple(document.languages),
            kind=_DOWNLOAD_KINDS.get(form_code, ""),
        ),
        source_filename=document.filename,
        printed_revision=document.printed_revision,
        source_url=document.source_url,
    )


def _descriptor_for_planned(
    planned: PlannedForm, locale: str
) -> DocumentDescriptor | None:
    """The asset for one planned form, in `locale`, or None if we hold none."""
    form_id = planned.form_id
    code = planned.entry.form_code
    state = planned.entry.state

    definition_id = _DEFINITION_FOR_CATALOG_FORM.get(form_id)

    if definition_id is not None:
        try:
            definition = definition_for_form(definition_id)
        except UnknownForm:
            return None

        _, chosen = resolve_for_definition(definition, locale)

        if chosen is None:
            # A definition describing one document and no official asset — the
            # Texas worksheet. Its language story belongs to the worksheet, not
            # to an HHSC edition, so there is nothing to describe here.
            return None

        return _build_descriptor(
            document=chosen.document,
            match=chosen.match,
            state=state,
            form_code=code,
        )

    unmapped = _UNMAPPED_DOCUMENTS.get(form_id)

    if unmapped is not None:
        return _descriptor_from_document(
            _document_by_name(unmapped),
            locale=locale,
            state=state,
            form_code=code,
        )

    return None


def _entry_for(
    planned: PlannedForm, locale: str, selected: frozenset[str]
) -> FormEntry:
    code = planned.entry.form_code

    return FormEntry(
        form_id=planned.form_id,
        form_code=code,
        title=planned.entry.title,
        state=planned.entry.state,
        category=planned.entry.category.value,
        requirement=planned.requirement.value,
        reason_key=planned.applicability.reason_key,
        purpose_key=_PURPOSE_KEYS.get(code, "form_purpose_unknown"),
        programs=tuple(sorted(planned.entry.programs & selected)),
        can_be_prepared=planned.can_be_prepared,
        unavailable_reason_key=planned.entry.unavailable_reason_key,
        document=_descriptor_for_planned(planned, locale),
    )


def build_manifest(
    *,
    catalog: tuple[Any, ...],
    context: PacketContext,
    locale: str,
) -> tuple[FormEntry, ...]:
    """Every form this household needs, with the document each one resolves to.

    The packet decides *which* forms from the household's circumstances; the
    document resolver decides *which edition* of each from the locale. Neither
    reaches into the other, which is what allows one packet to hold a Spanish
    H1010, a bilingual H1049 and an English-only H1028-MBIC while telling the
    applicant the truth about each.
    """
    packet: Packet = plan_packet(catalog, context)

    return tuple(
        _entry_for(planned, locale, context.selected_programs)
        for planned in packet.forms
    )


def manifest_as_json(entries: tuple[FormEntry, ...]) -> list[dict[str, Any]]:
    """The manifest as plain JSON, for the subprocess boundary."""
    return [asdict(entry) for entry in entries]


def attach_prefill(
    entries: tuple[FormEntry, ...],
    form_id: str,
    status: PrefillStatus,
) -> tuple[FormEntry, ...]:
    """Record how far the prepared document for `form_id` got.

    Applied after generation rather than during planning, because "what this
    household needs" and "how much of it we managed to fill" are answers from
    different stages and only one of them depends on the answers given.
    """
    import dataclasses

    return tuple(
        dataclasses.replace(entry, prefill=status)
        if entry.form_id == form_id
        else entry
        for entry in entries
    )
