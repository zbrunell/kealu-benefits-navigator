#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Drawing resolved fields onto pages.

This module is deliberately the least clever one in the layer. It receives
:class:`ResolvedField` objects that already know their box, their font size and
their exact text, and it draws them. It contains no coordinates, no form names,
no date formatting and no eligibility knowledge — so there is nothing in here
that would need a Texas branch or a California branch.

What it *does* own is the one thing a mapping cannot decide on its own: whether
the value physically fits, and what to do when it does not. Text drawn at an
absolute coordinate has no widget border to clip it, so an overlong value runs
across the printed label beside it. So every value is measured first
(``textfit``), shrunk if the target allows it, and reported as unfitted if even
the minimum legible size overflows. An unfitted value is never drawn — a box
left blank with a note beside it is honest, and an unreadable smear over a
printed question is not.

── Why a hand-built content stream ────────────────────────────────────────
The same reason ``pdf_generator._PdfWriter`` exists: this project has no
reportlab dependency and pypdf does not draw. A text-only content stream in
Helvetica is a few hundred bytes and needs no font embedding, because Helvetica
is one of the PDF base-14 fonts every viewer already has.

── Two output modes, one code path ────────────────────────────────────────
``overlay_pages`` builds the drawing for each page. When the definition holds a
bundled official template, those drawings are merged onto its pages with pypdf
and the result is the real government form with our values on it. When it does
not, the same drawings are written onto Navigator-authored pages. The values,
the coordinates and the fitting are identical either way; only what sits
underneath changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from benefits_navigator.formmap.definition import ResolvedField
from benefits_navigator.formmap.targets import (
    Alignment,
    Box,
    FieldKind,
    OverlayTarget,
    TEXTUAL_KINDS,
)
from benefits_navigator.formmap.textfit import (
    FIELD_PADDING,
    MIN_FONT_SIZE,
    fits,
    helvetica_width,
    largest_size_that_fits,
    wrap_to_width,
)


@dataclass(frozen=True)
class DrawnText:
    """One string, positioned and sized, ready to serialize."""

    page: int
    x: float
    y: float
    size: float
    text: str


@dataclass
class RenderPlan:
    """Everything to draw, plus what could not be drawn and why.

    Returned rather than written straight to a file so a test can assert on
    placements — a mapping test proves the value reaches the right *target*, and
    this proves it reaches the right *coordinates at a legible size*, still
    without opening a PDF.
    """

    draws: list[DrawnText] = field(default_factory=list)

    #: Canonical keys whose value could not be made to fit legibly.
    unfitted: list[str] = field(default_factory=list)

    #: Canonical keys with an overlay target but no box for the chosen value.
    unplaced: list[str] = field(default_factory=list)

    def pages_used(self) -> tuple[int, ...]:
        return tuple(sorted({drawn.page for drawn in self.draws}))

    def for_page(self, page: int) -> list[DrawnText]:
        return [drawn for drawn in self.draws if drawn.page == page]

    def text_on_page(self, page: int) -> str:
        """All text on a page, joined. For coarse assertions."""
        return " ".join(drawn.text for drawn in self.for_page(page))


def _aligned_x(box: Box, text: str, size: float, alignment: Alignment) -> float:
    usable = box.width - FIELD_PADDING * 2
    width = helvetica_width(text, size)

    if alignment is Alignment.CENTER:
        return box.x + FIELD_PADDING + max(0.0, (usable - width) / 2)

    if alignment is Alignment.RIGHT:
        return box.x + FIELD_PADDING + max(0.0, usable - width)

    return box.x + FIELD_PADDING


def plan_render(resolved_fields: list[ResolvedField]) -> RenderPlan:
    """Turn resolved fields into positioned draw operations.

    Native AcroForm targets are ignored here on purpose: the viewer draws those,
    and a value written both into a field and onto the page would print twice.
    """
    plan = RenderPlan()

    for resolved in resolved_fields:
        target = resolved.target

        if not isinstance(target, OverlayTarget):
            continue

        box = resolved.box()

        if box is None:
            plan.unplaced.append(resolved.key)
            continue

        if resolved.kind in (FieldKind.CHECKBOX, FieldKind.CHOICE):
            _plan_mark(plan, resolved, box, target)
            continue

        if resolved.kind in TEXTUAL_KINDS:
            _plan_text(plan, resolved, box, target)

    return plan


#: How much of a checkbox a mark glyph may occupy before it is shrunk.
#:
#: A mark is centred in its box rather than set as text inside a padded field,
#: so ``FIELD_PADDING`` does not apply to it — using the text-field padding here
#: forced an "X" in a 10pt box down to 6pt for no reason. A little headroom is
#: still wanted so the glyph does not touch the printed border.
_MARK_BOX_FRACTION = 0.86


def _plan_mark(
    plan: RenderPlan,
    resolved: ResolvedField,
    box: Box,
    target: OverlayTarget,
) -> None:
    """Centre a mark glyph in its printed box.

    ``resolved.rendered`` is not the glyph. For a CHOICE field it is the option
    key — "yes" / "no" — whose only job is to pick *which* box this mark goes
    in, and it has already done that by the time we get here (``resolved.box()``
    resolved it). Drawing it would put the literal word "yes" inside a 10-point
    checkbox, which is exactly what it did before this was fixed: the value did
    not fit, so all three yes/no questions were silently reported as unfitted
    and left blank on the form.
    """
    mark = target.mark

    if not mark:
        return

    # Fit the glyph to the box rather than trusting the declared size: printed
    # checkboxes are often smaller than body text, and an "X" that overflows
    # its box reads as a stray mark on the form.
    usable_width = box.width * _MARK_BOX_FRACTION
    usable_height = box.height * _MARK_BOX_FRACTION

    size = min(target.font_size, usable_height)

    while size > MIN_FONT_SIZE and helvetica_width(mark, size) > usable_width:
        size = max(MIN_FONT_SIZE, size - 0.25)

    if helvetica_width(mark, size) > usable_width:
        # Even the smallest legible glyph is wider than the printed box. Report
        # it rather than drawing over the border.
        plan.unfitted.append(resolved.key)
        return

    width = helvetica_width(mark, size)

    plan.draws.append(
        DrawnText(
            page=box.page,
            x=box.x + (box.width - width) / 2,
            # Centre on the box rather than using the text baseline helper,
            # which insets by the text-field padding.
            y=box.y + (box.height - size * 0.72) / 2,
            size=size,
            text=mark,
        )
    )


def _plan_text(
    plan: RenderPlan,
    resolved: ResolvedField,
    box: Box,
    target: OverlayTarget,
) -> None:
    text = resolved.rendered

    if not text:
        return

    multiline = target.multiline or resolved.kind is FieldKind.MULTILINE
    size = target.font_size

    if not fits(text, size, box.width, box.height, multiline):
        if not target.shrink_to_fit:
            plan.unfitted.append(resolved.key)
            return

        shrunk = largest_size_that_fits(
            text, size, box.width, box.height, multiline
        )

        if shrunk is None:
            # Even the minimum legible size overflows. Report rather than draw:
            # see the module docstring.
            plan.unfitted.append(resolved.key)
            return

        size = shrunk

    if not multiline:
        plan.draws.append(
            DrawnText(
                page=box.page,
                x=_aligned_x(box, text, size, target.alignment),
                y=box.baseline(size),
                size=size,
                text=text,
            )
        )

        return

    usable = box.width - FIELD_PADDING * 2

    for index, line in enumerate(wrap_to_width(text, size, usable)):
        if not line:
            continue

        plan.draws.append(
            DrawnText(
                page=box.page,
                x=_aligned_x(box, line, size, target.alignment),
                y=box.baseline(size, line_index=index),
                size=size,
                text=line,
            )
        )


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


def content_stream(draws: list[DrawnText]) -> bytes:
    """A PDF content stream drawing these strings in Helvetica."""
    parts = [
        f"BT /F1 {drawn.size:.2f} Tf {drawn.x:.2f} {drawn.y:.2f} Td "
        f"({_escape(drawn.text)}) Tj ET"
        for drawn in draws
    ]

    # cp1252 is WinAnsiEncoding, which is what the font resource declares.
    # Encoding as latin-1 instead silently turned every character WinAnsi has
    # but Latin-1 does not — the em dash among them — into "?" on the page.
    return "\n".join(parts).encode("cp1252", errors="replace")


@dataclass(frozen=True)
class StaticText:
    """A label the renderer draws itself, for a Navigator-authored page.

    Only used when there is no official template to overlay: with no printed
    form underneath, a page of bare values would be unreadable, so the page
    prints its own labels. These are the form's own printed wording, in the
    form's own language — never a UI translation.
    """

    page: int
    x: float
    y: float
    size: float
    text: str

    def as_drawn(self) -> DrawnText:
        return DrawnText(
            page=self.page, x=self.x, y=self.y, size=self.size, text=self.text
        )


class SimplePdf:
    """A minimal multi-page Helvetica PDF, built from content streams.

    Separate from ``pdf_generator._PdfWriter`` because that one takes
    ``(text, x, y, size)`` tuples and hardcodes Letter; this one takes a
    prepared stream per page and takes its page size from the form definition.
    Both are small; sharing one would mean widening the SAWS writer's contract,
    which is the thing most likely to disturb California.
    """

    def __init__(self, width: float = 612.0, height: float = 792.0) -> None:
        self.width = width
        self.height = height
        # Slots 0-2 reserved: 0 unused, 1 Pages, 2 Font.
        self._objects: list[bytes] = [b"", b"", b""]
        self._pages: list[int] = []

    def _add(self, data: bytes) -> int:
        self._objects.append(data)

        return len(self._objects) - 1

    def add_page(self, stream: bytes) -> None:
        stream_obj = self._add(
            b"<< /Length "
            + str(len(stream)).encode()
            + b" >>\nstream\n"
            + stream
            + b"\nendstream"
        )

        page_obj = self._add(
            b"<< /Type /Page /Parent 1 0 R /MediaBox [0 0 "
            + f"{self.width:.0f} {self.height:.0f}".encode()
            + b"] /Contents "
            + str(stream_obj).encode()
            + b" 0 R /Resources << /Font << /F1 2 0 R >> >> >>"
        )

        self._pages.append(page_obj)

    def to_bytes(self) -> bytes:
        kids = " ".join(f"{page} 0 R" for page in self._pages)

        self._objects[1] = (
            f"<< /Type /Pages /Kids [{kids}] /Count {len(self._pages)} >>".encode()
        )
        self._objects[2] = (
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
            b"/Encoding /WinAnsiEncoding >>"
        )

        catalog = self._add(b"<< /Type /Catalog /Pages 1 0 R >>")

        buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0] * len(self._objects)

        for index in range(1, len(self._objects)):
            offsets[index] = len(buf)
            buf.extend(f"{index} 0 obj\n".encode())
            buf.extend(self._objects[index])
            buf.extend(b"\nendobj\n")

        xref = len(buf)
        buf.extend(f"xref\n0 {len(self._objects)}\n".encode())
        buf.extend(b"0000000000 65535 f\r\n")

        for index in range(1, len(self._objects)):
            buf.extend(f"{offsets[index]:010d} 00000 n\r\n".encode())

        buf.extend(
            f"trailer\n<< /Size {len(self._objects)} /Root {catalog} 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n".encode()
        )

        return bytes(buf)

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.to_bytes())
