#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Canonical data in, prefilled document out.

The whole vertical slice, in one function::

    canonical values
        → resolve_mappings()      (definition.py — no PDF touched)
        → plan_render()           (render.py — boxes, fitting, no file touched)
        → overlay or author pages (here)
        → PDF bytes + a review sheet

Each stage is separately testable and none of them knows which state it is
serving. The only thing this module decides is whether there is an official
template to draw *onto* — and that is read from the definition, not from a
state code.

── The review sheet ───────────────────────────────────────────────────────
Produced alongside every document, and not optional. Three things have to be
said in writing every time, because the alternative is an applicant discovering
them at a county office:

* what we filled in,
* what we deliberately left blank and why (a signature, an SSN),
* what would not fit in its printed box.

``pdf_generator`` writes an equivalent ``.review.txt`` for SAWS 2 PLUS. This is
the same promise, kept by the same kind of file, for every form this layer
renders.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from benefits_navigator.formmap.definition import (
    FormDefinition,
    NotApplicable,
    ResolutionReport,
    ResolvedField,
    SensitiveFieldRefused,
    is_sensitive_key,
    resolve_mappings,
)
from benefits_navigator.formmap.registry import definition_for_form
from benefits_navigator.formmap.review_words import ReviewWords, words_for
from benefits_navigator.formmap.render import (
    DrawnText,
    RenderPlan,
    SimplePdf,
    content_stream,
    plan_render,
)
from benefits_navigator.formmap.targets import FieldKind

_FORMS_DIR = Path(__file__).resolve().parent.parent / "forms"


class NativeFieldFormNotRenderable(RuntimeError):
    """This layer cannot generate a form whose fields are all native.

    Writing to a native AcroForm field is not drawing — it means cloning the
    template, setting field values, regenerating appearances, and re-running the
    shrink-to-fit pass over the widget rectangles. For SAWS 2 PLUS all of that
    exists already in ``pdf_generator``, behind a reviewed destination
    allowlist, and this layer deliberately does not duplicate it.

    Raised rather than falling through, because the fall-through was worse than
    an error: a definition with no overlay fields produced a completely blank
    document that claimed to be a prefilled application. A test caught it; an
    applicant would have caught it at the county office.
    """


@dataclass
class GeneratedForm:
    """What generation produced, and everything a caller must be able to say."""

    form_id: str
    form_code: str

    #: The finished document.
    pdf_bytes: bytes

    #: Whether the values sit on the official government form.
    #:
    #: False means the output is a Navigator-authored worksheet carrying the
    #: same answers. Every user-facing surface has to distinguish the two, so
    #: this is a required part of the result rather than something inferred.
    is_official_document: bool

    #: Language of the produced document — never the UI locale.
    document_language: str

    resolution: ResolutionReport
    render_plan: RenderPlan

    #: Human-readable review text, for a sibling ``.review.txt``.
    review_text: str

    #: The locale generation was asked for. The applicant's UI language.
    requested_locale: str = "en"

    #: Which official asset was chosen and why, for a form with editions.
    #:
    #: ``None`` for a form describing exactly one document — California, and
    #: the Texas worksheet. Present for anything with variants, and it is the
    #: *only* thing a caller should read to describe the document's language:
    #: it distinguishes "the Spanish edition" from "the bilingual document that
    #: includes Spanish" from "English, because your language is not
    #: published", which no locale string can.
    document: Any | None = None

    @property
    def filled_keys(self) -> tuple[str, ...]:
        return tuple(sorted(resolved.key for resolved in self.resolution.fields))

    @property
    def page_count(self) -> int:
        return max(self.render_plan.pages_used(), default=0)

    @property
    def source_filename(self) -> str | None:
        """The canonical asset drawn on, for logs and developer surfaces.

        Deliberately named ``source_filename`` rather than anything an
        applicant-facing template would reach for by accident:
        ``TX-H1049-BI-2001-12.pdf`` is a storage detail and never appears in
        the interface. :func:`download_name` is what a person sees.
        """
        if self.document is not None:
            return self.document.document.filename

        return None

    def write(self, path: Path) -> Path:
        """Write the PDF and its review sheet. Returns the PDF path."""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.pdf_bytes)
        path.with_suffix(".review.txt").write_text(
            self.review_text, encoding="utf-8"
        )

        return path


def _static_text_for(definition: FormDefinition) -> tuple[DrawnText, ...]:
    """The printed labels a Navigator-authored page draws for itself.

    Read off the definition, so adding a second overlay form needs no change
    here. Empty for a form with an official base document: the government form
    already has its own printed labels, and drawing ours over them would be
    unreadable.
    """
    if definition.has_official_base_document:
        return ()

    return tuple(item.as_drawn() for item in definition.static_text)


def _build_review_text(
    definition: FormDefinition,
    resolution: ResolutionReport,
    plan: RenderPlan,
    chosen: Any | None = None,
    locale: str = "en",
) -> str:
    """The review sheet, in the applicant's language.

    The sheet's own sentences come from
    :mod:`benefits_navigator.formmap.review_words`; the printed labels and the
    applicant's answers do not, and that module says why.

    ``chosen`` lets the sheet open by naming *which* official document is in the
    reader's hands and in what language — which is the difference between "the
    Spanish edition", "the agency's own bilingual form" and "English, because
    your language is not published". Saying nothing was the previous behaviour
    and left a Spanish reader of a bilingual form unable to tell whether they
    had been quietly given the English one.
    """
    from benefits_navigator.formmap.documents import LanguageMatch

    words = words_for(locale)

    lines: list[str] = [
        f"{definition.form_code} — {definition.title}",
        "",
    ]

    if not definition.has_official_base_document:
        lines += [
            words.not_official_heading,
            "",
            words.not_official_body,
            "",
            f"{words.not_official_why}: {_worksheet_reason(definition, words)}",
            "",
        ]
    elif chosen is not None:
        banner = {
            LanguageMatch.EXACT: words.official_language_exact,
            LanguageMatch.BILINGUAL: words.official_language_bilingual,
            LanguageMatch.FALLBACK: words.official_language_fallback,
        }[chosen.match]

        lines += [banner, ""]

        scope = _bilingual_scope_note(chosen, locale)

        if scope:
            lines += [scope, ""]

    lines.append(words.filled_in)

    if resolution.fields:
        by_section: dict[str, list[str]] = {}

        for resolved in resolution.fields:
            label = resolved.mapping.printed_label or resolved.key

            by_section.setdefault(resolved.mapping.section, []).append(
                f"    {label}: {_shown(resolved)}"
            )

        for section in definition.sections():
            if section in by_section:
                lines.append(f"  {section}")
                lines.extend(by_section[section])
    else:
        lines.append(f"    {words.nothing_supplied}")

    lines += [
        "",
        words.left_blank_heading,
        f"    {words.left_blank_signature}",
        f"    {words.left_blank_sensitive}",
    ]

    # Two lists, not one. "Still yours to fill in" and "only if it applies to
    # you" are different instructions, and a list that mixes them teaches an
    # applicant to skim past both.
    required_blank: list[str] = []
    optional_blank: list[str] = []

    for key in resolution.skipped:
        mapping = definition.mapping_for(key)

        if mapping is None:
            required_blank.append(key)
            continue

        # A checkbox is never *missing* an answer. An unticked box on a paper
        # form is the answer "no", and telling a food-benefits applicant that
        # they still have to fill in the three programmes they chose not to
        # apply for is worse than telling them nothing.
        if mapping.optional or mapping.kind is FieldKind.CHECKBOX:
            optional_blank.append(key)
        else:
            required_blank.append(key)

    _append_by_section(
        lines,
        definition,
        required_blank,
        heading=words.still_yours,
    )

    _append_by_section(
        lines,
        definition,
        optional_blank,
        heading=words.only_if_applies,
    )

    _append_not_applicable(lines, definition, resolution, words)
    _append_declared_blanks(lines, definition, words)
    _append_no_box(lines, definition, resolution, words)

    if plan.unfitted:
        lines += ["", words.too_long]

        for key in sorted(plan.unfitted):
            mapping = definition.mapping_for(key)
            label = (mapping.printed_label if mapping else "") or key
            lines.append(f"    {label}")

    if plan.unplaced:
        lines += ["", words.unplaced]
        lines.extend(f"    {key}" for key in sorted(plan.unplaced))

    lines.append("")
    lines.append(words.review_before_submitting)

    return "\n".join(lines) + "\n"


def _append_declared_blanks(
    lines: list[str],
    definition: FormDefinition,
    words: ReviewWords,
) -> None:
    """Printed fields somebody other than the applicant completes.

    Declared on the definition as :class:`DeclaredBlank` and, until now,
    rendered nowhere — so an applicant holding a form with a clinician's page
    and an "Agency Use Only" block had no way to learn that those blanks were
    not theirs. "Nine remaining items" that includes two the office fills and
    one the doctor fills is worse than saying nothing, because they will try to
    answer all nine.

    The applicant's own blanks are omitted here: they are already listed under
    "still yours to fill in", and repeating them under a heading about other
    people would move work off their list that is on it.
    """
    from benefits_navigator.formmap.definition import Responsibility

    groups = (
        (Responsibility.AGENCY, words.declared_blank_agency),
        (Responsibility.THIRD_PARTY, words.declared_blank_third_party),
        (Responsibility.SIGNATURE, words.declared_blank_signature),
    )

    shown = [
        (blanks, note)
        for responsibility, note in groups
        if (blanks := definition.blanks_for(responsibility))
    ]

    if not shown:
        return

    lines += ["", words.declared_blank_heading]

    for blanks, note in shown:
        lines.append(f"  {note}")
        # The agency's own wording for the box, so it can be found on the page.
        lines.extend(f"    {blank.printed_label}" for blank in blanks)


def _append_no_box(
    lines: list[str],
    definition: FormDefinition,
    resolution: ResolutionReport,
    words: ReviewWords,
) -> None:
    """Answers the applicant gave that this form has no box for.

    The section the review sheet was missing, and the one requirement it could
    not meet without: an applicant who answered every question and receives a
    form with some of those answers nowhere on it needs to be told which, and
    what to do instead.

    Driven by ``resolution.unmapped`` intersected with the form's own recorded
    classification, so it lists only answers this household actually gave and
    only ones whose absence is explained. An unmapped key with no recorded
    reason is a gap in the classification rather than something to show an
    applicant, and the registry-wide test is what catches those.
    """
    notes = definition.no_box_notes

    if not notes:
        return

    answered = frozenset(resolution.unmapped)
    applicable = [note for note in notes if note.key in answered]

    if not applicable:
        return

    lines += ["", words.no_box_heading, f"  {words.no_box_intro}"]

    for note in applicable:
        lines.append(f"    {note.answer_label}")

        action = (
            words.no_box_actions.get(note.action_key)
            if note.action_key
            else None
        )

        if action:
            lines.append(f"      {action}")


def _worksheet_reason(definition: FormDefinition, words: ReviewWords) -> str:
    """Why this is a worksheet, in the applicant's language.

    Prefers the definition's message key so the sentence is translated and free
    of internal vocabulary. Falls back to the engineering note, which is
    English and may name a module — worse, but better than an empty "Why:" on
    a form whose definition has not been given a key yet.
    """
    key = definition.base_document_note_key

    if key:
        translated = words.worksheet_reasons.get(key)

        if translated:
            return translated

    return definition.base_document_note


def _shown(resolved: ResolvedField) -> str:
    """What the review sheet prints as the value.

    A CHOICE resolves to its *option key* — "yes", "no" — because that key's job
    is to pick which printed box gets the mark. On the page that is invisible;
    on the review sheet it was printed literally, so an applicant read "Are you
    a U.S. citizen or U.S. national?: yes" in the same document that prints
    "Yes" beside the box.
    """
    if resolved.kind is FieldKind.CHOICE:
        return resolved.rendered[:1].upper() + resolved.rendered[1:]

    return resolved.rendered


def _append_by_section(
    lines: list[str],
    definition: FormDefinition,
    keys: list[str],
    *,
    heading: str,
) -> None:
    """List canonical keys under their printed section, in the form's order.

    Grouped rather than flat. A flat list repeated "City", "County", "State"
    and "ZIP code" once for the home address and once for the mailing address
    with nothing to tell them apart, so the applicant could not know which one
    was still blank.
    """
    if not keys:
        return

    by_section: dict[str, list[str]] = {}

    for key in keys:
        mapping = definition.mapping_for(key)
        label = (mapping.printed_label if mapping else "") or key
        section = mapping.section if mapping else ""

        by_section.setdefault(section, []).append(label)

    lines += ["", heading]

    for section in definition.sections():
        if section in by_section:
            lines.append(f"  {section}")
            lines.extend(f"    {label}" for label in by_section[section])


def _append_not_applicable(
    lines: list[str],
    definition: FormDefinition,
    resolution: ResolutionReport,
    words: ReviewWords,
) -> None:
    """Say which boxes the applicant's own answers make inapplicable.

    The third state, and the one an applicant most needs stated. A box left
    empty because their own answer excluded it is finished work, not outstanding
    work, and listing it with the rest would send them looking for a question
    they were right to skip.

    Empty table rows are *counted*, never listed. Enumerating them is what the
    first version did, and a two-person household got eighty-four lines telling
    it that people three to six, jobs one to three and bills one to five were
    blank — true, useless, and long enough to bury the six lines that mattered.
    """
    blank_rows: dict[str, set[int]] = {}
    plain: list[NotApplicable] = []

    for item in resolution.not_applicable:
        mapping = definition.mapping_for(item.key)

        group = (
            definition.group_for(mapping.row[0])
            if mapping is not None and mapping.row is not None
            else None
        )

        # A one-row "table" is a block, not a table. "Helper rows: you filled 0
        # of 1" says less than naming the six boxes and the answer that
        # excluded them, and it repeats the Yes/No the applicant already gave.
        if group is not None and group.rows > 1:
            blank_rows.setdefault(group.prefix, set()).add(mapping.row[1])
        else:
            plain.append(item)

    if not plain and not blank_rows and not resolution.overflow:
        return

    lines += ["", words.not_applicable]

    by_reason: dict[str, list[str]] = {}

    for item in plain:
        by_reason.setdefault(item.reason, []).append(item.printed_label)

    for reason, labels in by_reason.items():
        lines.append(f"  {words.because} {reason}:")
        lines.extend(f"    {label}" for label in labels)

    for group in definition.repeating_groups:
        empty = blank_rows.get(group.prefix)

        if not empty:
            continue

        used = group.rows - len(empty)
        noun = group.row_noun.lower()

        lines.append(
            f"  {group.row_noun} "
            + words.rows_summary.format(
                filled=used, rows=group.rows, blank=len(empty), noun=noun
            )
        )

    if resolution.overflow:
        lines += ["", words.overflow]

        for group in definition.repeating_groups:
            beyond = resolution.overflow.get(group.prefix)

            if not beyond:
                continue

            lines.append(
                "    "
                + words.overflow_row.format(
                    noun=group.row_noun, beyond=beyond, rows=group.rows
                )
            )


def _render_authored_pages(
    definition: FormDefinition,
    plan: RenderPlan,
    static: tuple[DrawnText, ...],
) -> bytes:
    """Draw values and labels onto pages we generate ourselves."""
    pdf = SimplePdf(width=definition.page_width, height=definition.page_height)

    pages = set(plan.pages_used()) | {drawn.page for drawn in static}
    last_page = max(pages, default=1)

    for page in range(1, last_page + 1):
        # Labels first so a value is never hidden behind its own rule.
        drawn = [item for item in static if item.page == page]
        drawn += plan.for_page(page)

        pdf.add_page(content_stream(drawn))

    return pdf.to_bytes()


def _render_over_template(
    definition: FormDefinition,
    plan: RenderPlan,
    chosen: Any | None = None,
) -> bytes:
    """Merge the drawing onto the bundled official template.

    Only reached for a definition that both holds a base document and has
    overlay fields. SAWS 2 PLUS holds a base document but has no overlay
    fields, so it never arrives here — its values go into native fields via the
    existing generator.

    When ``chosen`` is present the file is opened through
    :func:`~benefits_navigator.formmap.provenance.load_document`, which refuses
    it unless the bytes are the ones its coordinates were measured against.
    That check belongs on this path rather than in a test: the risk is a file
    that changes *after* CI ran, and this is the line that reads it for
    rendering.
    """
    import io

    from pypdf import PdfReader, PdfWriter

    if chosen is not None:
        from benefits_navigator.formmap.provenance import load_document

        template = load_document(chosen.variant.document)
    else:
        template = _FORMS_DIR / str(definition.base_document)

    if not template.exists():
        raise FileNotFoundError(
            f"{definition.form_id} declares base document "
            f"{definition.base_document!r}, which is not present at {template}"
        )

    reader = PdfReader(str(template))
    writer = PdfWriter()

    for index, page in enumerate(reader.pages, start=1):
        draws = plan.for_page(index)

        if draws:
            stamp = SimplePdf(
                width=float(page.mediabox.width),
                height=float(page.mediabox.height),
            )
            stamp.add_page(content_stream(draws))

            overlay = PdfReader(io.BytesIO(stamp.to_bytes())).pages[0]
            page.merge_page(overlay)

        writer.add_page(page)

    buffer = io.BytesIO()
    writer.write(buffer)

    return buffer.getvalue()


def canonical_values_from_field_plan(
    field_plan: list[dict[str, Any]],
) -> dict[str, Any]:
    """Normalize the TypeScript field plan into canonical values.

    The plan is a list of ``{"key": ..., "value": ...}`` because that is what
    crosses the process boundary as JSON; every consumer here wants a mapping.
    Nulls and blank strings are dropped — a blank is not an answer — while
    ``False`` is kept, because an explicit No is one.

    Mirrors ``pdf_generator._canonical_values_from_plan``, which serves the
    California path and stays where it is. Two small readers of the same shape
    is the lesser evil: sharing one would make the Texas worksheet import a
    5,000-line module and pypdf to read a list of dictionaries.
    """
    values: dict[str, Any] = {}

    for item in field_plan:
        if not isinstance(item, dict):
            continue

        key = str(item.get("key") or "").strip()

        if not key:
            continue

        value = item.get("value")

        if value is None:
            continue

        if isinstance(value, str):
            value = value.strip()

            if not value:
                continue

        values[key] = value

    # The refusal, again, at the boundary the plan actually arrives through.
    # ``resolve_mappings`` re-checks; this one names the plan in the message.
    for key in sorted(values):
        if is_sensitive_key(key):
            raise SensitiveFieldRefused(
                f"sensitive canonical key in the application field plan: {key}"
            )

    return values


def generate_form(
    form_id: str,
    canonical_values: dict[str, Any],
    *,
    locale: str = "en",
) -> GeneratedForm:
    """Map canonical values onto `form_id` in `locale` and render the document.

    Pure with respect to the filesystem unless the form has a bundled template:
    nothing is written until :meth:`GeneratedForm.write` is called, so a test
    can assert on the result without a temp directory.

    ``locale`` is the applicant's own choice and decides **which official
    edition is drawn on**, through
    :func:`benefits_navigator.formmap.documents.resolve_for_definition`. It was
    previously not a parameter at all, which is the defect this signature
    fixes: the resolver, its ``LanguageMatch`` values and its tests all existed,
    and nothing on the generation path called any of them, so a Spanish
    applicant got whichever file ``base_document`` happened to name — the
    English H1010.

    It does **not** decide the language of the document's own printed wording.
    That is the agency's, and a locale with no edition is told so rather than
    served a translation nobody published. See :attr:`GeneratedForm.document`.
    """
    from benefits_navigator.formmap.documents import resolve_for_definition

    declared = definition_for_form(form_id)

    # The locale becomes an asset here and nowhere else downstream.
    definition, chosen = resolve_for_definition(declared, locale)

    resolution = resolve_mappings(definition, canonical_values)
    plan = plan_render(resolution.fields)
    static = _static_text_for(definition)

    if not definition.is_overlay:
        raise NativeFieldFormNotRenderable(
            f"{definition.form_id} maps only native PDF fields, which this "
            "layer describes but does not write. Generate it through its own "
            "generator — for CA_SAWS_2_PLUS that is "
            "pdf_generator.generate_saws2_plus_pdf."
        )

    if definition.has_official_base_document:
        pdf_bytes = _render_over_template(definition, plan, chosen)
    else:
        pdf_bytes = _render_authored_pages(definition, plan, static)

    return GeneratedForm(
        form_id=definition.form_id,
        form_code=definition.form_code,
        pdf_bytes=pdf_bytes,
        is_official_document=definition.has_official_base_document,
        document_language=definition.document_language,
        resolution=resolution,
        render_plan=plan,
        review_text=_build_review_text(
            definition, resolution, plan, chosen, locale
        ),
        requested_locale=locale,
        document=chosen,
    )


def output_filename(
    form_id: str,
    *,
    zip_code: str = "",
    now: datetime | None = None,
) -> str:
    """A stable, non-identifying filename for a generated document.

    The form code and the ZIP, never a name: a file in a downloads folder
    should not announce whose benefits application it is.
    """
    definition = definition_for_form(form_id)
    stamp = (now or datetime.now(tz=timezone.utc)).strftime("%Y%m%d-%H%M%S")

    prefix = "official" if definition.has_official_base_document else "worksheet"
    place = zip_code.strip() or "unknown"
    code = definition.form_code.lower().replace(" ", "-")

    return f"{prefix}-{definition.state.lower()}-{code}-{place}-{stamp}.pdf"


# ---------------------------------------------------------------------------
# What the applicant's downloads folder shows them
# ---------------------------------------------------------------------------

#: Human-readable language names for a download filename, by base tag.
#:
#: English words, and deliberately so: this is a filename, and a file called
#: ``Texas-H1010-Solicitud-Español.pdf`` travels badly — non-ASCII characters in
#: a ``Content-Disposition`` header need RFC 5987 encoding that not every client
#: gets right, and the name has to survive being emailed to a caseworker,
#: attached to a portal upload and read down a phone line. What the applicant
#: reads *in the interface* is fully translated; see the ``form_card_*`` keys.
_LANGUAGE_WORDS: dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "zh-CN": "Chinese",
    "zh": "Chinese",
    "vi": "Vietnamese",
}

#: What a single asset serving several languages is called.
_BILINGUAL_WORD = "Bilingual"


def language_word(language: str) -> str:
    """A filename-safe English name for a language tag."""
    tag = (language or "").strip()

    if tag in _LANGUAGE_WORDS:
        return _LANGUAGE_WORDS[tag]

    base = tag.replace("_", "-").split("-")[0].lower()

    return _LANGUAGE_WORDS.get(base, base.upper() or "English")


def language_suffix(languages: tuple[str, ...]) -> str:
    """The language part of a download name, for the asset's own languages.

    One language gives its name; several give ``Bilingual``. That word is the
    point of this function: a document answering English and Spanish from one
    file is not "English", and naming the download ``…-English.pdf`` would tell
    a Spanish applicant, in their downloads folder, that they had been handed
    the English one.
    """
    if not languages:
        return _LANGUAGE_WORDS["en"]

    if len(languages) > 1:
        return _BILINGUAL_WORD

    return language_word(languages[0])


def download_name(
    *,
    state: str,
    form_code: str,
    languages: tuple[str, ...],
    kind: str = "",
) -> str:
    """The filename an applicant sees when they save the document.

    Built from the state, the form's own designation, what the document is, and
    the language it is printed in — never from the canonical storage name.
    ``TX-H1049-BI-2001-12.pdf`` tells the applicant nothing and leaks a naming
    scheme that is ours; ``Texas-H1049-Bilingual.pdf`` tells them exactly what
    is in the file.

    The form code is kept verbatim because it is the one string a county office
    recognises, and the language word is derived from the asset rather than
    from the applicant's locale — see :func:`language_suffix`.

    ``kind`` is empty by default and the caller opts in. Defaulting it to
    "Application" was wrong in the direction that matters: it would have named
    a two-page self-employment ledger ``Texas-H1049-Application-Bilingual.pdf``,
    telling the applicant the supporting form was the application.
    """
    parts = [
        _STATE_NAMES.get(state.strip().upper(), state.strip().upper()),
        form_code.strip().replace(" ", "-"),
        kind.strip().replace(" ", "-"),
        language_suffix(languages),
    ]

    return "-".join(part for part in parts if part) + ".pdf"


#: State names for a download filename. "TX" is a code; "Texas" is a word.
_STATE_NAMES: dict[str, str] = {
    "TX": "Texas",
    "CA": "California",
    "IL": "Illinois",
    "NY": "NewYork",
    "PA": "Pennsylvania",
}


def _bilingual_scope_note(chosen: Any, locale: str = "en") -> str:
    """Where a bilingual document's coverage stops, if it does.

    Empty for a document printed in both languages throughout. H3037 is the
    reason this exists: only page 2 is bilingual, and telling a Spanish reader
    "English & Spanish" without that qualification overstates what they can
    read.

    The document names the qualification with a message key
    (``OfficialDocument.language_scope_key``) and this looks the sentence up in
    the applicant's language. Reading the key off the document rather than a
    per-state table is what keeps this module jurisdiction-agnostic — a shared
    module importing ``formmap.forms.tx_documents`` is the coupling
    ``test_formmap_jurisdiction_isolation`` exists to reject, and it was right
    to.
    """
    from benefits_navigator.formmap.documents import LanguageMatch

    if chosen.match is not LanguageMatch.BILINGUAL:
        return ""

    key = getattr(chosen.document, "language_scope_key", "")

    if not key:
        return ""

    return words_for(locale).scope_notes.get(key, "")
