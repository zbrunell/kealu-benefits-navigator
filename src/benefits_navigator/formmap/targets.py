#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Where a value goes on a form, and what kind of thing it is.

Two target kinds, because government PDFs come in two kinds and pretending
otherwise is what forces a state-specific branch into the generator:

:class:`AcroFormTarget`
    The PDF carries a real, usable form field and we write to it by name. The
    viewer owns the geometry, the appearance stream, and the clipping.
    California's SAWS 2 PLUS is this: 29 pages, 1,444 fields.

:class:`OverlayTarget`
    The PDF has no usable field for this answer, so we draw the value at a
    coordinate we hold ourselves. Texas H1010 is this.

The distinction is deliberately *per field*, not per form. A form can be
half-fillable — several of the ones in ``forms/`` have fields on some pages and
flat scans on others — and a mixed form should need one definition with two
kinds of target in it, not two code paths.

What is emphatically **not** here: any canonical business key, any applicant
data, or any knowledge of what a "household" is. A target knows a page, a box,
and how to render. That separation is what lets the same canonical data drive a
native-field form and an overlay form without the canonical layer ever learning
what a coordinate is.

── A note on the coordinate system ────────────────────────────────────────
PDF user space has its origin at the **bottom-left** of the page and y
increasing upward. Every box here is expressed in that space, in points, so the
numbers can be checked directly against what a PDF inspector reports rather
than being mentally flipped first. :meth:`Box.baseline` is the only place the
conversion to a text baseline happens.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class FieldKind(str, Enum):
    """What sort of answer this is, which decides how it renders.

    A ``str`` enum so a definition can be written with plain strings and still
    compare and serialize readably in a test failure message.
    """

    #: One line of text, shrunk to fit if necessary.
    TEXT = "text"

    #: Several lines, wrapped to the box width.
    MULTILINE = "multiline"

    #: A date, formatted by the form's own convention before rendering.
    DATE = "date"

    #: A box that is either marked or left alone.
    CHECKBOX = "checkbox"

    #: One of a fixed set of options, each with its own box.
    #:
    #: Distinct from CHECKBOX because the *selection* picks which box gets
    #: marked, so the target holds several boxes and the value chooses among
    #: them. A yes/no pair on a paper form is this, not two checkboxes.
    CHOICE = "choice"

    #: Digits written one per printed cell, as SSN and ZIP grids demand.
    #:
    #: Declared here because a form that has them cannot be rendered correctly
    #: without them, and discovering that after the renderer is written means
    #: rewriting it. Nothing in H1010's first pass uses it yet.
    CHARACTER_GRID = "character_grid"


#: Kinds whose value is rendered as drawn text rather than as a mark.
TEXTUAL_KINDS: frozenset[FieldKind] = frozenset(
    {
        FieldKind.TEXT,
        FieldKind.MULTILINE,
        FieldKind.DATE,
        FieldKind.CHARACTER_GRID,
    }
)


class Alignment(str, Enum):
    """Horizontal placement of text inside its box."""

    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


@dataclass(frozen=True)
class Box:
    """A rectangle on a page, in PDF points from the bottom-left origin.

    Frozen because a box is a measurement of a printed form. If one is wrong it
    should be corrected in the definition where it can be reviewed, never
    adjusted at render time — that is precisely the "magic coordinates
    scattered through rendering code" this layer exists to prevent.
    """

    #: 1-based page number, matching how a person refers to a printed page.
    page: int

    #: Distance from the left edge of the page to the left edge of the box.
    x: float

    #: Distance from the **bottom** of the page to the bottom of the box.
    y: float

    width: float
    height: float

    def __post_init__(self) -> None:
        if self.page < 1:
            raise ValueError(f"page is 1-based; got {self.page}")

        if self.width <= 0 or self.height <= 0:
            raise ValueError(
                f"box on page {self.page} has non-positive size: "
                f"{self.width}x{self.height}"
            )

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def top(self) -> float:
        return self.y + self.height

    def baseline(self, font_size: float, *, line_index: int = 0) -> float:
        """The y coordinate to place text at so it sits inside the box.

        The one place the box-to-baseline conversion lives. Text is set from its
        baseline, not its top, so a value placed naively at ``box.y`` hangs
        below the box and one placed at ``box.top`` sits above it. Descenders
        need room too, which is why the offset is a fraction of the size rather
        than the whole of it.
        """
        from benefits_navigator.formmap.textfit import (
            FIELD_PADDING_Y,
            LINE_HEIGHT,
        )

        # Top of the text area, then down one line per wrapped line.
        top = self.top - FIELD_PADDING_Y
        offset = font_size * LINE_HEIGHT * line_index

        # 0.78 of the size puts the baseline below the cap height with the
        # descender still inside the box.
        return top - offset - font_size * 0.78

    def inset(self, amount: float) -> "Box":
        """A box `amount` points smaller on every side. For drawing marks."""
        return Box(
            page=self.page,
            x=self.x + amount,
            y=self.y + amount,
            width=max(0.01, self.width - amount * 2),
            height=max(0.01, self.height - amount * 2),
        )

    def as_tuple(self) -> tuple[int, float, float, float, float]:
        """Comparable form, for assertions that read cleanly in a diff."""
        return (self.page, self.x, self.y, self.width, self.height)


@dataclass(frozen=True)
class AcroFormTarget:
    """A native PDF form field, addressed by name.

    Deliberately thin. The whole value of a real AcroForm field is that the
    viewer already knows where it is and how big it is, so a target that also
    carried coordinates would be inviting the two to disagree.
    """

    #: The field name exactly as it appears in the PDF's AcroForm dictionary.
    name: str

    #: On-state to write for a checkbox or radio, when the field is one.
    #:
    #: Not "/Yes" universally: forms name their on-states arbitrarily, and
    #: writing the wrong one leaves the box visually unticked while the field
    #: reports a value.
    on_state: str = "/Yes"

    @property
    def kind_hint(self) -> str:
        return "acroform"


@dataclass(frozen=True)
class Segment:
    """One printed slot of a value the form breaks into pieces.

    Government forms rarely give a date or a phone number a single line. They
    print ``(   )    -`` and expect an area code between the parentheses, or
    ``__ / __ / ____`` with the month, day and year in their own cells. Writing
    ``(512) 555-0143`` across that template prints two sets of parentheses.

    So a value can be declared as several slots, each taking a slice of the
    rendered string. The slice is expressed over the *rendered* value — after
    the field's transform has run — because that is the string the form's
    template was designed around: ``09/14/1991`` has its month at ``[0:2]``
    whatever the canonical value looked like.
    """

    #: Where this piece is drawn.
    box: Box

    #: Start index into the rendered value, inclusive.
    start: int

    #: End index, exclusive. ``None`` means "to the end".
    end: int | None = None

    #: Characters to drop before slicing, e.g. the separators the form prints.
    #:
    #: A date renders as ``09/14/1991``; the form prints its own slashes. With
    #: ``strip="/"`` the value becomes ``09141991`` and the slots are ``[0:2]``,
    #: ``[2:4]``, ``[4:8]`` — indices into the digits, which is how someone
    #: reading the definition thinks about a character grid.
    strip: str = ""

    def slice_of(self, rendered: str) -> str:
        """The piece of `rendered` this slot prints."""
        value = rendered

        for character in self.strip:
            value = value.replace(character, "")

        return value[self.start : self.end]


@dataclass(frozen=True)
class OverlayTarget:
    """A value drawn onto the page at coordinates we hold.

    Used when the PDF has no usable field for this answer. Everything the
    renderer needs is here and nothing else is: the renderer never decides
    where something goes, only how to draw what it was told.
    """

    #: The box to render inside. For CHOICE, see `option_boxes`.
    box: Box | None = None

    #: Printed slots this value is split across, when the form provides them.
    #:
    #: When set, `box` is still required and still bounds the whole field — it
    #: is what the review sheet reports and what overlap checks measure against
    #: — but the value is drawn into these slots rather than across it.
    segments: tuple[Segment, ...] = ()

    #: Further boxes that receive the **same** value, unsliced.
    #:
    #: Government forms repeat themselves. H1010 asks for Person 1's name in
    #: Section A and again in Section F; H3037 asks for the patient's name on
    #: page 1 and again on page 2. That is one canonical fact and one question
    #: the applicant answers once.
    #:
    #: The alternatives are both worse. A second mapping needs a second
    #: canonical key, and a suffixed key like ``…first_name.section_f`` is a key
    #: nothing ever populates — the box stays blank while the definition claims
    #: to fill it. Listing the extra boxes here keeps one mapping, one printed
    #: question on the review sheet, and one place for an applicant to answer.
    also_draw_at: tuple[Box, ...] = ()

    #: Per-option boxes for a CHOICE field, keyed by the canonical option value.
    #:
    #: A mapping rather than a list so a definition reads as
    #: ``{"yes": Box(...), "no": Box(...)}`` and a test can assert the option
    #: name it expects rather than an index.
    option_boxes: dict[str, Box] = field(default_factory=dict)

    #: Point size to render at, before any shrink-to-fit.
    font_size: float = 10.0

    alignment: Alignment = Alignment.LEFT

    #: Whether the value may wrap. Set from the field kind, but overridable for
    #: a single-line box that is genuinely tall enough for two.
    multiline: bool = False

    #: Whether to shrink the font when the value overflows.
    #:
    #: True is almost always right. False means "render at exactly this size or
    #: report it as not fitting", which is correct for a character grid whose
    #: cells are a fixed pitch.
    shrink_to_fit: bool = True

    #: How a marked checkbox or selected choice is drawn.
    #:
    #: A glyph rather than a vector shape so it uses the same font as the rest
    #: of the page and needs no extra PDF resources.
    mark: str = "X"

    def boxes(self) -> tuple[Box, ...]:
        """Every box this target may draw into. For validation and tests."""
        if self.option_boxes:
            return tuple(self.option_boxes.values())

        if self.segments:
            return tuple(segment.box for segment in self.segments) + self.also_draw_at

        primary = (self.box,) if self.box is not None else ()

        return primary + self.also_draw_at

    @property
    def kind_hint(self) -> str:
        return "overlay"


#: Either kind of destination.
FieldTarget = AcroFormTarget | OverlayTarget
