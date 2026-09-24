#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Which official language edition of a form an applicant should be handed.

Two decisions get confused constantly, so this layer exists to keep them apart:

**Which forms belong in this packet?**
    Decided by :mod:`benefits_navigator.formmap.packet`, from the household's
    programs and circumstances. It has nothing to do with language.

**Which official document is each of those forms?**
    Decided here, from the applicant's locale and what the agency actually
    publishes. It has nothing to do with eligibility.

── Three ideas, kept apart on purpose ─────────────────────────────────────
Most of the bugs this layer exists to prevent come from collapsing three
things that sound like one:

1. **The application locale.** What language the interface, the explanations
   and the completion guide are in. The applicant's own choice, carried on the
   session — see ``web/src/lib/locale.ts``.
2. **The document language.** What language the paper the applicant is handed
   is printed in. Usually the same as (1), and *stated* rather than assumed
   whenever it is not.
3. **The physical source asset.** Which file on disk. Not derivable from (2):
   a bilingual document is one file answering two languages, so there is no
   one-to-one mapping between a locale and a PDF.

The rule that follows, and the one the old code broke: **never infer an asset
from a locale by pattern.** ``locale == "es"`` does not imply a filename
containing ``-ES-``; H1049 and H3037 answer Spanish from a file named ``-BI-``.
The only way to get from a locale to a file is :func:`resolve_document`, which
reads what each document declares it prints.

Keeping them separate is what makes a mixed-language packet possible. A
Spanish-speaking Texas household applying for SNAP with self-employment income
and a pregnancy receives H1010 in Spanish, H1049 in a bilingual document, H3037
in a bilingual document, and — if it applies — H1028-MBIC in English, because
HHSC has not published it in Spanish. The packet is not downgraded to English
because one form in it is English-only, and no document is machine-translated.

── Three ways a document can answer a locale ──────────────────────────────
:attr:`LanguageMatch.EXACT`
    The agency publishes a separate edition in the applicant's language and we
    hold it. H1010 is this: two files, two layouts, two sets of coordinates.

:attr:`LanguageMatch.BILINGUAL`
    One published document prints the applicant's language alongside another.
    H1049 and H3037 are this, and it is not a compromise — the Spanish reader
    gets HHSC's own Spanish wording, on HHSC's own paper. Modelling these as an
    "English edition" with a missing Spanish sibling would have reported a
    fallback that is not happening. It is worth being precise about how this
    was established: the file the catalog offers as the Spanish H1049 is
    **byte-identical** to the one it offers as English. That is not a broken
    download; it is the agency serving one bilingual document from two links.

:attr:`LanguageMatch.FALLBACK`
    No edition in the applicant's language exists in our verified catalog. The
    applicant is handed the edition that does exist, and every user-facing
    surface says which language it is in and why. What must never happen here
    is the quiet substitution — handing over an English government form while
    the interface implies it is Spanish.

There is deliberately no fourth case for "translate it ourselves". A government
form carries the agency's own legal wording; a Navigator-authored Spanish
rendering of it would be a document HHSC never published, presented as one it
did.

── Why a variant must be complete ─────────────────────────────────────────
The English and Spanish H1010 are the same form and *not* the same layout. The
same printed question sits at a different x on each, the field names differ
(``CheckBox5`` against ``CheckBox1``), and the Spanish edition has no usable
text fields at all where the English has three. A variant therefore carries its
own target for every mapping, and :func:`validate_variant` refuses one that is
missing any — with an explicit escape hatch, :attr:`DocumentVariant.absent_keys`,
for a question genuinely not printed on that edition.

The alternative — letting a variant inherit the other language's coordinates
for anything it does not override — is the exact failure this design exists to
prevent, because it fails silently and prints in the wrong place.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field as dataclass_field
from enum import Enum
from typing import Any

from benefits_navigator.formmap.provenance import OfficialDocument
from benefits_navigator.formmap.targets import FieldTarget


class VariantError(ValueError):
    """A document variant that cannot be trusted to render correctly."""


class LanguageMatch(str, Enum):
    """How well the document handed over answers the applicant's language."""

    #: A separate official edition in the applicant's own language.
    EXACT = "exact"

    #: One official document that prints the applicant's language among others.
    BILINGUAL = "bilingual"

    #: No edition in the applicant's language exists; this one is offered.
    FALLBACK = "fallback"

    @property
    def is_in_applicants_language(self) -> bool:
        """Whether the applicant can actually read the paper they were given."""
        return self is not LanguageMatch.FALLBACK


@dataclass(frozen=True)
class DocumentVariant:
    """One official edition of a form, and where every answer goes on it.

    A variant is a document plus a layout. Both halves are specific to this
    edition, and neither is inherited from another one.
    """

    #: The official PDF this variant renders onto.
    document: OfficialDocument

    #: Canonical key → where that answer is drawn or written **on this
    #: edition**.
    #:
    #: Complete by construction: :func:`validate_variant` checks it against the
    #: form's mappings. A key may be omitted only by naming it in
    #: :attr:`absent_keys`, which is a statement about the printed page rather
    #: than an oversight.
    targets: Mapping[str, FieldTarget] = dataclass_field(default_factory=dict)

    #: Mapped questions this edition does not print, with the reason.
    #:
    #: Keyed by canonical key so the review sheet can tell an applicant that a
    #: question they answered has no box on the form they were handed, instead
    #: of dropping the answer without saying so.
    absent_keys: Mapping[str, str] = dataclass_field(default_factory=dict)

    #: Questions this edition *does* print that we have not measured yet.
    #:
    #: Kept strictly apart from :attr:`absent_keys`, because they mean opposite
    #: things to the person holding the form. "This form does not ask that" ends
    #: the matter; "this form asks that and we did not fill it in" is a line on
    #: their to-do list. Collapsing the two would let unfinished work disappear
    #: into a category that reads like a deliberate decision.
    #:
    #: A key here is still carried to the review sheet by name, so an applicant
    #: is told which of their answers they must copy across by hand.
    deferred_keys: Mapping[str, str] = dataclass_field(default_factory=dict)

    @property
    def languages(self) -> tuple[str, ...]:
        return self.document.languages

    def target_for(self, key: str) -> FieldTarget | None:
        """Where `key` goes on this edition, or None if it is not printed."""
        return self.targets.get(key)


@dataclass(frozen=True)
class ResolvedDocument:
    """The official document chosen for one form and one applicant locale.

    Carries the *reason* alongside the choice. Every surface that shows an
    applicant which paper they are getting needs to be able to say why it is in
    the language it is in, and recomputing that from the locale downstream is
    how the two get to disagree.
    """

    variant: DocumentVariant

    #: The locale the applicant is using Navigator in.
    requested_locale: str

    #: The language of the paper they are actually getting.
    document_language: str

    match: LanguageMatch

    #: Message key naming the limitation, or None when there is none.
    #:
    #: A key, not a sentence, because this is shown to the applicant in *their*
    #: language — a Spanish speaker is told in Spanish that the form is in
    #: English. Translating the explanation is right; translating the form is
    #: not.
    limitation_key: str | None = None

    @property
    def is_in_applicants_language(self) -> bool:
        return self.match.is_in_applicants_language

    @property
    def document(self) -> OfficialDocument:
        """The physical asset chosen. The third of the three ideas."""
        return self.variant.document

    @property
    def is_bilingual(self) -> bool:
        """Whether the chosen asset prints more than one language."""
        return self.document.is_bilingual

    @property
    def document_languages(self) -> tuple[str, ...]:
        """Every language the chosen asset prints, not just the matched one.

        What a user-facing surface needs in order to say "English & Spanish"
        rather than picking one of the two and implying the other is absent.
        """
        return self.document.languages


#: Message key for "this form is not published in your language".
LANGUAGE_FALLBACK_MESSAGE_KEY = "form_document_language_fallback"

#: Message key for "this is the agency's own bilingual document".
#:
#: Distinct from :data:`LANGUAGE_FALLBACK_MESSAGE_KEY` and never a substitute
#: for it. A bilingual document is not a limitation, and the two must not share
#: a key: a surface that reused the fallback wording would tell a Spanish reader
#: their form is not published in their language while handing them HHSC's own
#: Spanish text.
BILINGUAL_DOCUMENT_MESSAGE_KEY = "form_document_officially_bilingual"


def resolve_document(
    variants: tuple[DocumentVariant, ...],
    locale: str,
    *,
    fallback_language: str = "en",
) -> ResolvedDocument:
    """Choose the official edition of one form for one applicant locale.

    Preference order, and the reasoning behind it:

    1. **A monolingual edition in the applicant's language.** The whole page is
       theirs, with nothing to read past.
    2. **A bilingual document that includes their language.** Equally official
       and equally readable, listed second only because a reader has more to
       scan. This is not a fallback and is not reported as one.
    3. **The fallback-language edition**, with the limitation stated.

    Raises rather than returning None when nothing matches even the fallback: a
    form in a planned packet with no document behind it is a programming error,
    and returning None turns it into a blank page several frames later.
    """
    if not variants:
        raise VariantError("a form must have at least one document variant")

    wanted = _base_language(locale)

    monolingual = [
        variant
        for variant in variants
        if variant.document.serves_language(wanted)
        and not variant.document.is_bilingual
    ]

    if monolingual:
        return ResolvedDocument(
            variant=monolingual[0],
            requested_locale=locale,
            document_language=wanted,
            match=LanguageMatch.EXACT,
        )

    bilingual = [
        variant for variant in variants if variant.document.serves_language(wanted)
    ]

    if bilingual:
        return ResolvedDocument(
            variant=bilingual[0],
            requested_locale=locale,
            document_language=wanted,
            match=LanguageMatch.BILINGUAL,
        )

    for variant in variants:
        if variant.document.serves_language(fallback_language):
            return ResolvedDocument(
                variant=variant,
                requested_locale=locale,
                document_language=fallback_language,
                match=LanguageMatch.FALLBACK,
                limitation_key=LANGUAGE_FALLBACK_MESSAGE_KEY,
            )

    published = sorted({lang for v in variants for lang in v.languages})

    raise VariantError(
        f"no document variant serves {locale!r} or the {fallback_language!r} "
        f"fallback; this form publishes only {published}"
    )


def _base_language(locale: str) -> str:
    """``es-MX`` → ``es``. The script subtag is deliberately kept for Chinese.

    ``zh-Hans`` and ``zh-Hant`` are different scripts and a reader of one
    cannot necessarily read the other, so folding them together would hand
    someone a document in a script they do not read and call it an exact match.
    """
    tag = (locale or "en").strip().replace("_", "-")

    if tag.lower().startswith("zh"):
        return tag

    return tag.split("-")[0].lower() or "en"


def resolve_for_definition(
    definition: Any,
    locale: str,
    *,
    fallback_language: str = "en",
) -> tuple[Any, ResolvedDocument | None]:
    """The definition to render, and which official document it renders onto.

    **The single place a locale turns into an asset.** Everything downstream —
    generation, the review sheet, the download name, the packet manifest, the
    UI card — reads the returned :class:`ResolvedDocument` rather than
    re-deriving a choice from the locale. That is the whole point: the previous
    arrangement had the resolver, its tests, and a production path that ignored
    both, so ``h1010_official`` pinned ``base_document`` to the English file and
    a Spanish applicant's answers were drawn on English coordinates.

    Returns the definition unchanged, and ``None``, for a form with no
    variants — California and the Texas worksheet, which each describe exactly
    one document and have nothing to choose between.

    For a form *with* variants, the returned definition has:

    * ``base_document`` set to the chosen edition's filename, so the overlay
      merges onto the right file, and
    * every mapping's target replaced by the chosen edition's own target, so
      the coordinates belong to the file being drawn on.

    Both halves matter and swapping only one is worse than swapping neither: the
    Spanish document with English coordinates renders without error, onto a page
    where the questions sit somewhere else.
    """
    import dataclasses

    variants: tuple[DocumentVariant, ...] = tuple(
        getattr(definition, "variants", ()) or ()
    )

    if not variants:
        return definition, None

    chosen = resolve_document(
        variants, locale, fallback_language=fallback_language
    )

    document = chosen.variant.document

    fields = tuple(
        dataclasses.replace(mapping, target=chosen.variant.targets[mapping.key])
        for mapping in definition.fields
        if mapping.key in chosen.variant.targets
    )

    swapped = dataclasses.replace(
        definition,
        fields=fields,
        base_document=document.filename,
        page_count=document.page_count,
        page_width=document.page_width,
        page_height=document.page_height,
        document_language="+".join(document.languages),
        source_url=document.source_url,
    )

    return swapped, chosen


def validate_variant(
    variant: DocumentVariant,
    *,
    form_id: str,
    mapped_keys: tuple[str, ...],
    page_count: int,
) -> tuple[str, ...]:
    """Problems that would make `variant` render wrongly. Empty means sound.

    Returns rather than raises so a test can report every problem in one run;
    the registry raises on a non-empty result at build time.
    """
    problems: list[str] = []
    label = f"{form_id}/{variant.document.filename}"

    if variant.document.page_count != page_count:
        problems.append(
            f"{label}: the definition declares {page_count} pages but the "
            f"document has {variant.document.page_count}"
        )

    for key in mapped_keys:
        if key in variant.targets:
            continue

        if key in variant.absent_keys or key in variant.deferred_keys:
            continue

        problems.append(
            f"{label}: no target for {key!r}. A variant never inherits another "
            f"edition's coordinates — give this edition its own target, or "
            f"record the key in absent_keys with the reason it is not printed "
            f"on this edition, or in deferred_keys if it is printed and simply "
            f"not measured yet."
        )

    overlap = set(variant.absent_keys) & set(variant.deferred_keys)

    for key in sorted(overlap):
        problems.append(
            f"{label}: {key!r} is in both absent_keys and deferred_keys. A "
            f"question is either not printed on this edition or printed and "
            f"unmeasured; it cannot be both."
        )

    mapped = set(mapped_keys)

    for key in variant.targets:
        if key not in mapped:
            problems.append(f"{label}: target for {key!r}, which the form does not map")

    for name, group in (
        ("absent_keys", variant.absent_keys),
        ("deferred_keys", variant.deferred_keys),
    ):
        for key, reason in group.items():
            if key not in mapped:
                problems.append(
                    f"{label}: {name} names {key!r}, which the form does not map"
                )
            elif not reason.strip():
                problems.append(f"{label}: {name}[{key!r}] has no reason")

    for key, target in variant.targets.items():
        for box in getattr(target, "boxes", lambda: ())():
            if box.page > variant.document.page_count:
                problems.append(
                    f"{label}: {key!r} is drawn on page {box.page} but the "
                    f"document has {variant.document.page_count} pages"
                )

            if (
                box.right > variant.document.page_width
                or box.top > variant.document.page_height
            ):
                problems.append(
                    f"{label}: {key!r} extends past the page "
                    f"({box.right:.1f}x{box.top:.1f} vs "
                    f"{variant.document.page_width:.0f}x"
                    f"{variant.document.page_height:.0f})"
                )

    return tuple(problems)
