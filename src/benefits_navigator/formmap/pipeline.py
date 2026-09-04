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

    @property
    def filled_keys(self) -> tuple[str, ...]:
        return tuple(sorted(resolved.key for resolved in self.resolution.fields))

    @property
    def page_count(self) -> int:
        return max(self.render_plan.pages_used(), default=0)

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
) -> str:
    lines: list[str] = [
        f"{definition.form_code} — {definition.title}",
        "",
    ]

    if not definition.has_official_base_document:
        lines += [
            "THIS IS NOT THE OFFICIAL FORM.",
            "",
            "It is a prefilled worksheet carrying your answers. Submit the "
            "official application through the agency's own channel and copy "
            "these answers across.",
            "",
            f"Why: {definition.base_document_note}",
            "",
        ]

    lines.append("Filled in for you:")

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
        lines.append("    (nothing — no answers were supplied)")

    lines += [
        "",
        "Left blank on purpose:",
        "    Your signature and the date you sign. We never fill these in.",
        "    Social Security numbers and immigration document numbers. We do "
        "not ask for them and never write them onto a form.",
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
        heading="Still yours to fill in:",
    )

    _append_by_section(
        lines,
        definition,
        optional_blank,
        heading="Only if it applies to you — blank is a complete answer:",
    )

    _append_not_applicable(lines, definition, resolution)

    if plan.unfitted:
        lines += [
            "",
            "Too long for the printed box — write \"see attached\" and attach "
            "the full answer:",
        ]

        for key in sorted(plan.unfitted):
            mapping = definition.mapping_for(key)
            label = (mapping.printed_label if mapping else "") or key
            lines.append(f"    {label}")

    if plan.unplaced:
        lines += [
            "",
            "Mapped but with nowhere to render (a definition defect — please "
            "report):",
        ]
        lines.extend(f"    {key}" for key in sorted(plan.unplaced))

    lines.append("")
    lines.append("Review every page before submitting.")

    return "\n".join(lines) + "\n"


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

    lines += ["", "Not applicable to your household — leave these blank:"]

    by_reason: dict[str, list[str]] = {}

    for item in plain:
        by_reason.setdefault(item.reason, []).append(item.printed_label)

    for reason, labels in by_reason.items():
        lines.append(f"  Because {reason}:")
        lines.extend(f"    {label}" for label in labels)

    for group in definition.repeating_groups:
        empty = blank_rows.get(group.prefix)

        if not empty:
            continue

        used = group.rows - len(empty)
        noun = group.row_noun.lower()

        lines.append(
            f"  {group.row_noun} rows: you filled {used} of "
            f"{group.rows}. Leave the other {len(empty)} blank — "
            f"there is no {noun} to put in them."
        )

    if resolution.overflow:
        lines += [
            "",
            "More than this form has room for — attach a separate sheet with "
            "the rest:",
        ]

        for group in definition.repeating_groups:
            beyond = resolution.overflow.get(group.prefix)

            if not beyond:
                continue

            lines.append(
                f"    {group.row_noun}: {beyond} more than the "
                f"{group.rows} printed rows."
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
) -> bytes:
    """Merge the drawing onto the bundled official template.

    Only reached for a definition that both holds a base document and has
    overlay fields. SAWS 2 PLUS holds a base document but has no overlay
    fields, so it never arrives here — its values go into native fields via the
    existing generator.
    """
    import io

    from pypdf import PdfReader, PdfWriter

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
) -> GeneratedForm:
    """Map canonical values onto `form_id` and render the document.

    Pure with respect to the filesystem unless the form has a bundled template:
    nothing is written until :meth:`GeneratedForm.write` is called, so a test
    can assert on the result without a temp directory.
    """
    definition = definition_for_form(form_id)

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
        pdf_bytes = _render_over_template(definition, plan)
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
        review_text=_build_review_text(definition, resolution, plan),
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
