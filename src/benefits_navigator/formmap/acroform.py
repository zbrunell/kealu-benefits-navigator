#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Making a value written into a native AcroForm field *look* the way it fits.

A native text field is drawn from two different places, and they can disagree:

``/DA``
    The field's declared font and size. A viewer that regenerates appearances
    (Acrobat, and anything honouring ``/NeedAppearances``) draws from this.

``/AP``
    The appearance stream stored in the file — the actual drawing. Every
    viewer that does *not* regenerate (macOS Preview, iOS, most print and
    fax pipelines, many county scanning systems) draws exactly this and
    nothing else.

The California generator used to shrink an overflowing value by editing
``/DA`` *after* pypdf had already written ``/AP`` at the old size. The file
therefore carried two answers. Acrobat showed the shrunk, fitting value; Preview
showed the original 10pt one clipped at the widget border — Q6's date of birth
printed as ``01/01/199`` on the document the applicant signs, the very defect
the shrinking existed to prevent. Nothing reported it, because every check read
``/DA``.

pypdf also does not wrap a multiline value when the field declares an explicit
size: it draws each ``\\n``-separated line as one run and lets the widget clip
it. A 150-character "reason for leaving" in a three-line box became one line cut
off after forty characters.

So this module owns the whole sequence, for every native-field form the
application fills:

1. decide the size each written value renders at, with the same
   :mod:`~benefits_navigator.formmap.textfit` metrics the overlay renderer uses;
2. write that size into the widget's own ``/DA`` (never a parent shared by
   widgets of different sizes);
3. rebuild the appearance stream from that ``/DA``, with multiline values
   wrapped to the widget width first; and
4. put the applicant's value back into ``/V`` unwrapped, so the data is the
   answer they gave and a regenerating viewer wraps it itself.

``/Helv 0 Tf`` — "auto size" — is replaced with an explicit size too. Viewers
that honour it grow a short value to the height of its box, so on New York's
LDSS-4826 an auto-sized "English" rendered at 13pt beside 10pt neighbours.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from benefits_navigator.formmap.textfit import (
    FIELD_PADDING,
    FIELD_PADDING_Y,
    helvetica_width,
    largest_size_that_fits,
    wrap_to_width,
)

#: The size an auto-sized (``0 Tf``) field is given before fitting.
#:
#: Ten points is what every explicitly sized field on SAWS 2 PLUS and SAWS 1
#: declares, so an auto-sized field lands at the same size as its neighbours
#: when it has room, and smaller only when it must.
AUTO_SIZE_DEFAULT = 10.0

#: Field flag bits (PDF 32000-1, table 228).
_FLAG_MULTILINE = 1 << 12
_FLAG_COMB = 1 << 24


@dataclass
class _Widget:
    """One written text widget, and what it needs to be redrawn."""

    page_index: int
    name: str
    annotation: Any
    field: Any
    value: str
    width: float
    height: float
    multiline: bool
    comb: bool
    da_parts: list[str]
    size_index: int
    declared: float

    #: The widget rectangle, normalized: left, bottom, right, top.
    rect: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)

    #: Whether the rectangle was cut down to clear a printed label.
    shortened: bool = False

    #: Every name the widget answers to — partial and fully qualified.
    names: tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Printed labels inside a widget
# ---------------------------------------------------------------------------
#
# A form author draws a widget over "the space for the answer", and on these
# forms that space often includes part of the printed question. The Spanish
# SAWS 2 PLUS home address widget covers the second line of its own label,
# "LLEGAR A SU HOGAR", so every Spanish application printed the street address
# through it. Appendix B's phone widget starts under its printed "(", so the
# area code was set on top of the parenthesis; the Appendix C/D amount and date
# widgets start under their "$" and "From".
#
# A viewer lays the value out in the widget rectangle and knows nothing about
# the page beneath it. So the rectangle of a *written* widget is reduced to the
# part of it the page leaves free, and the value is fitted and drawn there —
# by us and by any viewer that regenerates the appearance. Widgets this run
# does not write are left exactly as the agency drew them.
#
# Where the printed words are is measured offline, by
# ``tools/measure_acroform_writing_space.py`` with ``pdftotext``, and committed
# with the SHA-256 of the template it was measured on — the same arrangement as
# the Texas overlay measurements, for the same reason: reading glyph positions
# is a build-time job, and pypdf's text visitor reports positions that are
# wrong by twenty points on these very pages. A template whose bytes differ
# (a newer CDSS download) simply gets no adjustments.

#: Where the committed writing-space measurements live.
WRITING_SPACE_PATH = (
    Path(__file__).resolve().parent
    / "forms"
    / "measurements"
    / "acroform-writing-space.json"
)

#: How much of a widget's width may be given up to step sideways past a
#: printed glyph. A "$" or "(" at one end of the box costs a few points and is
#: stepped past; a label running across the top costs most of the width and is
#: stepped under instead.
_SIDEWAYS_LIMIT = 0.25

#: Clearance kept between printed ink and the writing space, in points.
_CLEARANCE = 0.5

#: The smallest writing space worth adjusting to. Anything smaller means the
#: measurement is not describing a label, and the widget is left alone.
_MIN_FREE_WIDTH = 10.0
_MIN_FREE_HEIGHT = 7.0

#: Helvetica's descender and cap height as fractions of the size: the part of
#: a line of text that actually carries ink.
_DESCENT = 0.21
_CAP = 0.72

Rect = tuple[float, float, float, float]


@dataclass(frozen=True)
class WritingSpace:
    """The free part of one widget, as measured against its template."""

    page: int
    field: str
    rect: Rect
    free: Rect
    shortened: bool


def _document_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def writing_spaces_for(template: Path) -> dict[tuple[int, str], WritingSpace]:
    """The committed adjustments for `template`, keyed by (page, field name).

    Found by the template's SHA-256 rather than its name, because the generator
    fills a copy placed beside the output under a different name. Empty —
    never an error — for a template nobody measured, a newer CDSS download
    among them: an unadjusted widget is the old behaviour, and a stale
    adjustment would move a value on a layout nobody measured.
    """
    try:
        raw = json.loads(WRITING_SPACE_PATH.read_text(encoding="utf-8"))
        digest = _document_sha256(template)
    except (OSError, ValueError):
        return {}

    entry = next(
        (
            document
            for document in raw.get("documents", {}).values()
            if document.get("sha256") == digest
        ),
        None,
    )

    if entry is None:
        return {}

    spaces: dict[tuple[int, str], WritingSpace] = {}

    for item in entry.get("widgets", []):
        space = WritingSpace(
            page=int(item["page"]),
            field=str(item["field"]),
            rect=tuple(item["rect"]),  # type: ignore[arg-type]
            free=tuple(item["free"]),  # type: ignore[arg-type]
            shortened=bool(item["shortened"]),
        )
        spaces[(space.page, space.field)] = space

    return spaces


def printed_runs(words: Any, page: int) -> list[Rect]:
    """The ink boxes of the phrases a page prints, from ``pdftotext`` words.

    Words set on one line with ordinary spacing are joined into one phrase
    first. A label is avoided as a whole — "LLEGAR A SU HOGAR" is one thing
    running across the top of a box, not four small things at its left end —
    and deciding word by word stepped the value sideways past each of them in
    turn before stepping under the last.

    A writing rule printed as underscores — ``Name of Tribe:________`` — is the
    place the answer goes, not something to avoid, so only the part of a word
    before its rule counts, measured in proportion with Helvetica widths.
    """
    boxes: list[Rect] = []

    for word in words:
        if word.page != page:
            continue

        text = word.text.strip()
        label = text.split("_", 1)[0]

        if not label:
            continue

        right = word.right

        if label != text:
            whole = helvetica_width(text, 10.0) or 1.0
            right = word.x + word.width * helvetica_width(label, 10.0) / whole

        boxes.append((word.x, word.y, right, word.top))

    boxes.sort(key=lambda box: (round(box[1]), box[0]))

    runs: list[Rect] = []

    for box in boxes:
        if runs:
            left, bottom, right, top = runs[-1]
            height = top - bottom
            same_line = abs(box[1] - bottom) <= 1.0 and abs(box[3] - top) <= 1.0
            # A word space is about a third of the line height; anything much
            # wider is a gap between two different things on one row.
            if same_line and 0 <= box[0] - right <= height * 0.6:
                runs[-1] = (left, min(bottom, box[1]), box[2], max(top, box[3]))
                continue

        runs.append(box)

    return runs


def _ink_band(rect: Rect, size: float, multiline: bool) -> tuple[float, float]:
    """The vertical span a value drawn in `rect` at `size` puts ink in.

    A label that only reaches into the part of the box the value never uses —
    the top of a tall single-line box — is not in the value's way, and moving
    the box for it would shrink the value for nothing. Mirrors how the
    appearance is laid out: one line centred on its cap height, or lines hung
    from the top.
    """
    left, bottom, right, top = rect

    if multiline:
        return bottom + 1.0, top - 1.0

    baseline = bottom + 1.0 + (top - bottom - 2.0 - _CAP * size) / 2

    return baseline - _DESCENT * size, baseline + _CAP * size


def _free_rect(
    rect: Rect, runs: list[Rect], size: float, multiline: bool
) -> tuple[Rect, bool]:
    """The part of `rect` a value at `size` can use without touching print.

    Returns the rectangle and whether its height was reduced — a box stepped
    under a label is shorter than the form drew it, and is fitted as such.
    """
    left, bottom, right, top = rect
    width = right - left
    shortened = False

    for run_left, run_bottom, run_right, run_top in runs:
        band_bottom, band_top = _ink_band((left, bottom, right, top), size, multiline)

        overlap_x = min(right, run_right) - max(left, run_left)
        overlap_y = min(band_top, run_top) - max(band_bottom, run_bottom)

        # Touching is not intruding: a label printed just outside the widget,
        # whose descenders graze its edge, is the ordinary case.
        if overlap_x <= _CLEARANCE or overlap_y <= _CLEARANCE:
            continue

        # Step sideways past a glyph at one end, when that is cheap ...
        if (run_left + run_right) / 2 <= (left + right) / 2:
            sideways = (max(left, run_right + _CLEARANCE), right)
        else:
            sideways = (left, min(right, run_left - _CLEARANCE))

        if sideways[1] - sideways[0] >= width * (1 - _SIDEWAYS_LIMIT):
            left, right = sideways
            continue

        # ... and otherwise under (or over) a label running across the box.
        if (run_bottom + run_top) / 2 >= (bottom + top) / 2:
            top = min(top, run_bottom - _CLEARANCE)
        else:
            bottom = max(bottom, run_top + _CLEARANCE)

        shortened = True

    if right - left < _MIN_FREE_WIDTH or top - bottom < _MIN_FREE_HEIGHT:
        return rect, False

    return (left, bottom, right, top), shortened


def measure_writing_space(
    rect: Rect, runs: list[Rect], size: float, multiline: bool
) -> tuple[Rect, bool]:
    """The free part of one widget. Used offline by the measurement tool."""
    return _free_rect(rect, runs, size, multiline)


def _clear_of_labels(
    widgets: list["_Widget"],
    spaces: Mapping[tuple[int, str], WritingSpace],
) -> None:
    """Move each written widget into the part of it its page leaves free."""
    from pypdf.generic import FloatObject, NameObject, RectangleObject

    for widget in widgets:
        space = next(
            (
                spaces[(widget.page_index + 1, name)]
                for name in widget.names
                if (widget.page_index + 1, name) in spaces
            ),
            None,
        )

        # The rectangle must still be the one measured: a widget the template
        # has since moved is not the widget the measurement describes.
        if space is None or any(
            abs(a - b) > 0.05 for a, b in zip(space.rect, widget.rect)
        ):
            continue

        widget.annotation[NameObject("/Rect")] = RectangleObject(
            [FloatObject(round(value, 3)) for value in space.free]
        )
        widget.rect = space.free
        widget.width = space.free[2] - space.free[0]
        widget.height = space.free[3] - space.free[1]
        widget.shortened = space.shortened


def _field_name(annotation: Any) -> tuple[list[str], Any]:
    """The names a widget answers to, and the dictionary holding its value.

    Both the partial name (``/T``) and the fully qualified one
    (``Form[0].#subform[0].City[0]``), because callers address fields either
    way — Illinois' mapping uses the qualified names its XFA-derived form
    carries — and pypdf accepts both.
    """
    node = annotation if annotation.get("/T") is not None else None

    if node is None:
        parent = annotation.get("/Parent")

        if parent is None:
            return [], annotation

        node = parent.get_object()

    field = node
    parts: list[str] = []

    while node is not None:
        if node.get("/T") is not None:
            parts.append(str(node["/T"]))

        parent = node.get("/Parent")
        node = parent.get_object() if parent is not None else None

    if not parts:
        return [], field

    return [parts[0], ".".join(reversed(parts))], field


def _inherited(annotation: Any, key: str, acro_form: Any = None) -> Any:
    node = annotation

    while node is not None:
        if key in node:
            return node[key]

        parent = node.get("/Parent")
        node = parent.get_object() if parent is not None else None

    if acro_form is not None and key in acro_form:
        return acro_form[key]

    return None


def _written_widgets(
    writer: Any, written: Mapping[str, str]
) -> list[_Widget]:
    """Every text widget on every page that this run wrote a value into."""
    acro_form = writer._root_object.get("/AcroForm")
    acro_form = acro_form.get_object() if acro_form is not None else None

    found: list[_Widget] = []

    for page_index, page in enumerate(writer.pages):
        for reference in page.get("/Annots") or []:
            annotation = reference.get_object()

            if annotation.get("/Subtype") != "/Widget":
                continue

            names, field = _field_name(annotation)
            name = next((each for each in names if each in written), None)

            if name is None:
                continue

            if str(_inherited(annotation, "/FT")) != "/Tx":
                continue

            value = written[name]

            if not isinstance(value, str) or not value:
                continue

            appearance = _inherited(annotation, "/DA", acro_form)

            if appearance is None:
                continue

            parts = str(appearance).split()

            try:
                size_index = parts.index("Tf") - 1
                declared = float(parts[size_index])
            except (ValueError, IndexError):
                continue

            flags = int(_inherited(annotation, "/Ff") or 0)
            rectangle = [float(bound) for bound in annotation["/Rect"]]
            normalized = (
                min(rectangle[0], rectangle[2]),
                min(rectangle[1], rectangle[3]),
                max(rectangle[0], rectangle[2]),
                max(rectangle[1], rectangle[3]),
            )

            found.append(
                _Widget(
                    page_index=page_index,
                    name=name,
                    annotation=annotation,
                    field=field,
                    value=value,
                    width=abs(rectangle[2] - rectangle[0]),
                    height=abs(rectangle[3] - rectangle[1]),
                    multiline=bool(flags & _FLAG_MULTILINE),
                    comb=bool(flags & _FLAG_COMB),
                    da_parts=parts,
                    size_index=size_index,
                    declared=declared,
                    rect=normalized,
                    names=tuple(names),
                )
            )

    return found


def starting_size(declared: float, height: float, multiline: bool) -> float:
    """The size to fit from: the declared one, or a sane one for auto-size."""
    if declared > 0:
        return declared

    if multiline:
        return AUTO_SIZE_DEFAULT

    # A single-line auto-sized box: never taller than the box allows, never
    # larger than its explicitly sized neighbours.
    return max(1.0, min(AUTO_SIZE_DEFAULT, height - FIELD_PADDING_Y * 2))


def _starting_size(widget: _Widget) -> float:
    return starting_size(widget.declared, widget.height, widget.multiline)


def _fitting_height(widget: _Widget) -> float:
    """The height to fit a value against.

    Normally the widget's own. A single-line widget cut down to clear a label
    is already exactly the free space — its clearance is built in — so the
    usual top and bottom padding would be subtracted twice. Its limit is
    instead what the appearance needs: a line of Helvetica, cap height plus
    descender, inside the one-point margin the appearance keeps.
    """
    if not widget.shortened or widget.multiline:
        return widget.height

    ink_limit = (widget.height - 1.0) / (_CAP + _DESCENT + 0.2)

    return ink_limit + FIELD_PADDING_Y * 2


def _display_text(widget: _Widget, size: float) -> str:
    """What the appearance stream should draw — wrapped, for a multiline box."""
    if not widget.multiline or widget.comb:
        return widget.value

    usable = widget.width - FIELD_PADDING * 2

    return "\n".join(wrap_to_width(widget.value, size, usable))


def fit_text_widgets(
    writer: Any,
    written: Mapping[str, str],
    template: Path | None = None,
) -> list[str]:
    """Fit every written text value to its widget and redraw its appearance.

    ``writer`` is a pypdf ``PdfWriter`` whose fields have already been given
    their values. ``written`` is the name → value mapping that was written;
    only those fields are touched, so a field the template prefilled keeps
    whatever it had.

    Returns the names of values that cannot render legibly even at
    :data:`~benefits_navigator.formmap.textfit.MIN_FONT_SIZE`. Those are left
    at their starting size — the caller reports them for attachment rather
    than presenting an unreadable value as filled.
    """
    from pypdf.generic import NameObject, TextStringObject

    widgets = _written_widgets(writer, written)
    unfitted: list[str] = []

    # 0. Keep each value off the printed words its widget was drawn over.
    if template is not None:
        _clear_of_labels(widgets, writing_spaces_for(template))

    # 1-2. Choose each widget's size and write it into the widget's own /DA.
    #
    # Always the widget, never a parent: /DA is inheritable, and a parent's
    # /DA is shared by every widget under it. Writing a shrunk size there
    # shrinks the siblings too — or, with widgets of different widths, leaves
    # whichever was processed last deciding for all of them.
    chosen: dict[int, float] = {}

    for index, widget in enumerate(widgets):
        start = _starting_size(widget)

        if widget.comb:
            # A comb field places one character per cell; its width is fixed by
            # the cell pitch, not by the value. Only the height constrains it.
            fitted: float | None = min(
                start, widget.height - FIELD_PADDING_Y * 2
            )
        else:
            fitted = largest_size_that_fits(
                widget.value,
                start,
                widget.width,
                _fitting_height(widget),
                widget.multiline,
            )

        if fitted is None:
            if widget.name not in unfitted:
                unfitted.append(widget.name)

            fitted = start

        chosen[index] = fitted

        if fitted != widget.declared:
            parts = list(widget.da_parts)
            parts[widget.size_index] = f"{fitted:.2f}"
            widget.annotation[NameObject("/DA")] = TextStringObject(" ".join(parts))

    # 3. Rebuild each appearance from the /DA just written. pypdf draws the
    # value it finds in /V line by line without wrapping, so a multiline value
    # is handed to it already wrapped at the chosen size ...
    by_page: dict[int, dict[str, str]] = {}

    for index, widget in enumerate(widgets):
        display = _display_text(widget, chosen[index])
        page_values = by_page.setdefault(widget.page_index, {})

        # Two widgets of one field on one page share a value; wrap for the
        # narrower so the text fits both.
        previous = page_values.get(widget.name)

        if previous is None or display.count("\n") > previous.count("\n"):
            page_values[widget.name] = display

    for page_index, values in by_page.items():
        writer.update_page_form_field_values(
            writer.pages[page_index], values, auto_regenerate=None
        )

    # 4. ... and then /V is put back to exactly what the applicant answered.
    # The line breaks belong to this appearance at this width, not to the data.
    for widget in widgets:
        widget.field[NameObject("/V")] = TextStringObject(widget.value)

    return unfitted
