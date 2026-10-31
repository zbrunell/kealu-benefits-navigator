#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Reading printed text off an official document, so boxes can be measured.

Every coordinate that lands on a government form has to come from somewhere.
There are three ways to get one and only the third is safe:

1. **Guess it.** Produces a form that looks authoritative and prints an income
   figure across a printed label. The previous milestone refused to do this and
   was right to; nothing here changes that judgement.
2. **Measure it once by eye and paste the number in.** Better, but the number
   is then an unverifiable constant. Nobody reviewing the diff can tell a
   correct 431.7 from a mistyped one, and when HHSC moves the question four
   points down, nothing notices.
3. **Anchor it to text the document actually prints.** ``Middle name`` is on
   page 5 at a position the PDF itself will tell us. A box declared as "the
   line under the words *Middle name*" is checkable by anyone, survives a
   reflow that moves the whole block, and fails loudly when the words go away.

This module does (3). It reads word geometry out of a document with
``pdftotext -bbox-layout`` and exposes it in PDF user space, so a form
definition can say where a value goes by naming the printed question next to it.

── Coordinate systems ─────────────────────────────────────────────────────
``pdftotext`` reports boxes from the **top-left** with y increasing downward.
The rest of this layer -- :class:`~benefits_navigator.formmap.targets.Box`
included -- works from the **bottom-left** with y increasing upward, because
that is PDF user space and it is what a PDF inspector shows. The flip happens
once, in :meth:`_TextExtractor._to_user_space`, and nowhere else.

── Why this is a build-time tool, not a render-time one ───────────────────
Resolving anchors means shelling out to ``pdftotext`` and parsing a 34-page
document. Doing that on every render would be slow, would make rendering depend
on a binary that may not be installed, and would mean a form's geometry could
change under it between runs.

So anchors are resolved **once**, offline, by ``tools/measure_texas_forms.py``,
into a committed measurement file that is reviewed in a diff like any other
source. The measurement file records the document's SHA-256 alongside the
boxes, and loading it checks that digest -- so a measurement can never be read
against a document it was not taken from.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from benefits_navigator.formmap.targets import Box


class MeasurementError(RuntimeError):
    """A printed anchor could not be found, or was found ambiguously."""


@dataclass(frozen=True)
class PrintedText:
    """A run of text the document prints, and where it sits in user space."""

    page: int
    text: str

    #: Left edge, points from the left of the page.
    x: float

    #: **Bottom** edge, points from the bottom of the page.
    y: float

    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def top(self) -> float:
        return self.y + self.height

    def as_box(self) -> Box:
        return Box(
            page=self.page, x=self.x, y=self.y, width=self.width, height=self.height
        )

    def normalized(self) -> str:
        """Whitespace-collapsed, case-folded text, for matching."""
        return _normalize(self.text)


def _normalize(value: str) -> str:
    """What two pieces of printed text have to share to count as the same.

    Case and whitespace are collapsed. So are the several dash and quote
    characters HHSC's forms mix -- an anchor written with a hyphen in a source
    file should still match an en dash on the page, because the difference is
    invisible to the person writing the anchor.
    """
    text = value.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = re.sub(r"[‐-―]", "-", text)

    # The forms pad questions out to their answer box with runs of dots.
    text = text.replace("…", ".")
    text = re.sub(r"\.{2,}", "", text)

    return re.sub(r"\s+", " ", text).strip().casefold()


#: Baselines within this many points of each other count as the same line.
#:
#: Not zero. Two glyphs set on one printed row routinely differ by a fraction of
#: a point — the two slashes in the Spanish edition's birth-date template differ
#: by 0.06 — and ordering strictly by y then put the *right-hand* slash first.
#: Anything reading positions by occurrence index silently got them backwards,
#: which is how a date's month cell ended up to the right of its year cell.
_SAME_LINE_TOLERANCE = 3.0


def _reading_order(printed: "PrintedText") -> tuple[int, float, float]:
    """Sort key putting printed text in the order a person reads it."""
    row = -round(printed.y / _SAME_LINE_TOLERANCE)

    return (printed.page, row, printed.x)


class DocumentText:
    """Every word and line an official document prints, with geometry.

    Built once per document. Lines are assembled from words because an anchor is
    usually a printed phrase -- ``Birth date (month/day/year)`` -- rather than a
    single word, and matching phrases against a line is far more legible in a
    form definition than matching a word sequence.
    """

    def __init__(
        self,
        words: tuple[PrintedText, ...],
        lines: tuple[PrintedText, ...],
        rects: tuple[Box, ...] = (),
        ink: "PageInk | None" = None,
    ):
        self.words = words
        self.lines = lines
        #: The rendered pages, for placements that measure ink rather than text.
        #:
        #: ``None`` when the document was built without a path to render —
        #: a hand-made ``DocumentText`` in a test. ``SnapToCircle`` falls back
        #: to its inner placement rather than failing, so a text-only document
        #: still measures everything that does not need pixels.
        self.ink = ink
        #: Every rectangle the document *draws*, in user space.
        #:
        #: The character grids on these forms — the date cells, the phone
        #: template, the Social Security cells — are drawn as vector rectangles
        #: and carry no text at all. Anchoring to text and guessing the grid's
        #: outer edges was the alternative, and it was wrong by up to 25 points
        #: when tried: the cell pitch is not uniform across the month, day and
        #: year groups, so the year cells cannot be derived from the day cells.
        #:
        #: Reading the rectangles the form itself draws removes the guess. See
        #: :class:`CellGrid`.
        self.rects = rects

    @classmethod
    def of(cls, path: Path) -> "DocumentText":
        text = _TextExtractor(path).extract()

        return DocumentText(
            words=text.words,
            lines=text.lines,
            rects=_drawn_rects(path),
            ink=PageInk(path),
        )

    def find(
        self,
        phrase: str,
        *,
        page: int | None = None,
        occurrence: int = 0,
        within: tuple[float, float] | None = None,
    ) -> PrintedText:
        """The printed run matching `phrase`, as a measurement.

        Matching is on normalized text and prefers an exact line match before a
        containment match, because ``City`` appears inside ``City, State, ZIP``
        on several of these forms and the shorter question is the one an anchor
        naming ``City`` means.

        `occurrence` selects among repeats -- H1010 prints ``First name`` once
        per person -- and is deliberately explicit: a silent "first match wins"
        would put person 3's name on person 1's line without complaint.

        `within` restricts to a vertical band ``(bottom, top)`` in user space,
        which is how a repeated question is pinned to the block it belongs to
        when counting occurrences would be fragile.

        Raises rather than returning None. An anchor that does not resolve means
        the document is not the one the definition was written against, and
        continuing would draw at a default coordinate.
        """
        wanted = _normalize(phrase)

        if not wanted:
            raise MeasurementError("an anchor phrase cannot be empty")

        candidates = [
            line
            for line in self.lines
            if (page is None or line.page == page)
            and (within is None or (within[0] <= line.y <= within[1]))
        ]

        exact = [line for line in candidates if line.normalized() == wanted]
        matches = exact or [line for line in candidates if wanted in line.normalized()]

        if not matches:
            where = f" on page {page}" if page is not None else ""
            raise MeasurementError(
                f"no printed text matching {phrase!r}{where}. The document does "
                f"not print this question, or prints it differently -- check "
                f"the extracted text before adjusting the anchor."
            )

        matches.sort(key=_reading_order)

        if occurrence >= len(matches):
            raise MeasurementError(
                f"{phrase!r} occurs {len(matches)} time(s); asked for "
                f"occurrence {occurrence}. Occurrences are ordered down the "
                f"page then left to right."
            )

        return matches[occurrence]

    def find_phrase(
        self,
        phrase: str,
        *,
        page: int | None = None,
        occurrence: int = 0,
        within: tuple[float, float] | None = None,
    ) -> PrintedText:
        """The phrase as its own bounding box, found among words not lines.

        For a label the extractor merged into a line with unrelated text. See
        :attr:`Anchor.by_phrase` for the case on H1010 that needs it.

        Matches a consecutive run of words on one printed row, left to right.
        "One row" is within 60% of a word's height, the same tolerance the
        column-width helper uses, so a baseline that drifts a point does not
        split a phrase in two.
        """
        wanted = [_normalize(part) for part in phrase.split()]

        if not wanted:
            raise MeasurementError("an anchor phrase cannot be empty")

        candidates = [
            word
            for word in self.words
            if (page is None or word.page == page)
            and (within is None or (within[0] <= word.y <= within[1]))
        ]
        candidates.sort(key=_reading_order)

        matches: list[PrintedText] = []

        for index, word in enumerate(candidates):
            if word.normalized() != wanted[0]:
                continue

            run = [word]
            tolerance = word.height * 0.6

            for offset in range(1, len(wanted)):
                position = index + offset

                if position >= len(candidates):
                    break

                following = candidates[position]

                if (
                    following.page != word.page
                    or abs(following.y - word.y) > tolerance
                    or following.normalized() != wanted[offset]
                ):
                    break

                run.append(following)

            if len(run) != len(wanted):
                continue

            left = min(part.x for part in run)
            right = max(part.right for part in run)
            bottom = min(part.y for part in run)
            top = max(part.top for part in run)

            matches.append(
                PrintedText(
                    page=word.page,
                    text=phrase,
                    x=left,
                    y=bottom,
                    width=right - left,
                    height=top - bottom,
                )
            )

        if not matches:
            where = f" on page {page}" if page is not None else ""

            raise MeasurementError(
                f"no printed words spelling {phrase!r}{where}. Check the "
                f"extracted words before adjusting the anchor."
            )

        matches.sort(key=_reading_order)

        if occurrence >= len(matches):
            raise MeasurementError(
                f"{phrase!r} occurs {len(matches)} time(s) as a phrase; asked "
                f"for occurrence {occurrence}."
            )

        return matches[occurrence]

    def count(self, phrase: str, *, page: int | None = None) -> int:
        """How many printed runs match `phrase`. For checking an anchor is sane."""
        wanted = _normalize(phrase)
        candidates = [
            line for line in self.lines if page is None or line.page == page
        ]
        exact = [line for line in candidates if line.normalized() == wanted]

        if exact:
            return len(exact)

        return len([line for line in candidates if wanted in line.normalized()])

    def page_lines(self, page: int) -> tuple[PrintedText, ...]:
        """Every line on `page`, top to bottom. For eyeballing a layout."""
        lines = [line for line in self.lines if line.page == page]
        lines.sort(key=_reading_order)

        return tuple(lines)


class _TextExtractor:
    """Runs ``pdftotext -bbox-layout`` and parses its XHTML into user space."""

    _PAGE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">')
    _LINE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">')
    _WORD = re.compile(
        r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">'
        r"(.*?)</word>",
        re.S,
    )

    def __init__(self, path: Path):
        self.path = path
        self.page_height = 792.0

    def extract(self) -> DocumentText:
        try:
            result = subprocess.run(
                ["pdftotext", "-bbox-layout", str(self.path), "-"],
                capture_output=True,
                check=True,
                text=True,
            )
        except FileNotFoundError:
            raise MeasurementError(
                "pdftotext is not installed. It is a build-time dependency of "
                "the measurement tool only -- rendering does not need it, "
                "because measurements are committed. Install poppler."
            ) from None
        except subprocess.CalledProcessError as error:
            raise MeasurementError(
                f"pdftotext failed on {self.path.name}: {error.stderr}"
            ) from None

        return self._parse(result.stdout)

    def _parse(self, xhtml: str) -> DocumentText:
        words: list[PrintedText] = []
        lines: list[PrintedText] = []

        # Split on page boundaries, keeping each page's own height: the flip to
        # user space needs the height of the page the text is actually on, and
        # a document is not obliged to make them all the same.
        #
        # parts alternates: [prefix, width, height, body, width, height, body...]
        parts = self._PAGE.split(xhtml)
        page_number = 0

        for index in range(1, len(parts), 3):
            width = float(parts[index])
            height = float(parts[index + 1])
            body = parts[index + 2]
            page_number += 1

            for match in self._LINE.finditer(body):
                x0, y0, x1, y1 = (float(v) for v in match.groups())
                # The words belonging to this line run until the next <line>.
                start = match.end()
                end = body.find("<line", start)
                segment = body[start:] if end == -1 else body[start:end]

                text = " ".join(
                    _unescape(word.group(5)) for word in self._WORD.finditer(segment)
                )

                if text.strip():
                    lines.append(
                        self._to_user_space(page_number, height, text, x0, y0, x1, y1)
                    )

            for match in self._WORD.finditer(body):
                x0, y0, x1, y1 = (float(v) for v in match.groups()[:4])
                text = _unescape(match.group(5))

                if text.strip():
                    words.append(
                        self._to_user_space(page_number, height, text, x0, y0, x1, y1)
                    )

            del width

        return DocumentText(tuple(words), tuple(lines))

    @staticmethod
    def _to_user_space(
        page: int,
        page_height: float,
        text: str,
        x_min: float,
        y_min: float,
        x_max: float,
        y_max: float,
    ) -> PrintedText:
        """The one place top-left geometry becomes bottom-left geometry."""
        return PrintedText(
            page=page,
            text=text,
            x=x_min,
            y=page_height - y_max,
            width=max(x_max - x_min, 0.01),
            height=max(y_max - y_min, 0.01),
        )


def _drawn_rects(path: Path) -> tuple[Box, ...]:
    """Every rectangle each page draws, deduplicated, in user space.

    Parsed from the content stream's ``re`` operators. A form draws each cell
    border twice — once to fill, once to stroke — so identical rectangles are
    collapsed; a caller counting cells should get the number a person counts.

    Deliberately tolerant: a page whose stream cannot be read contributes
    nothing rather than failing the whole extraction, because most placements
    do not need rectangles and a form with none is still measurable. A
    :class:`CellGrid` that finds no cells raises on its own, naming the row.
    """
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover - measurement is an offline step
        return ()

    pattern = re.compile(
        r"(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\b"
    )

    found: list[Box] = []
    seen: set[tuple[int, int, int, int, int]] = set()

    reader = PdfReader(str(path))

    for index, page in enumerate(reader.pages, start=1):
        try:
            contents = page.get_contents()

            if contents is None:
                continue

            stream = contents.get_data().decode("latin-1")
        except Exception:  # noqa: BLE001 - see the docstring
            continue

        for raw_x, raw_y, raw_w, raw_h in pattern.findall(stream):
            x, y, width, height = (
                float(raw_x),
                float(raw_y),
                float(raw_w),
                float(raw_h),
            )

            # Normalize a rectangle drawn with a negative extent.
            if width < 0:
                x, width = x + width, -width

            if height < 0:
                y, height = y + height, -height

            # A rule drawn as a degenerate rectangle — one of the two extents
            # zero — is not a cell and cannot be a Box. Skipped here rather
            # than filtered by every caller.
            if width <= 0.0 or height <= 0.0:
                continue

            # Round to a tenth of a point for the dedupe key only; the box
            # keeps full precision.
            fingerprint = (
                index,
                round(x * 10),
                round(y * 10),
                round(width * 10),
                round(height * 10),
            )

            if fingerprint in seen:
                continue

            seen.add(fingerprint)
            found.append(
                Box(page=index, x=x, y=y, width=width, height=height)
            )

    return tuple(found)


def _unescape(value: str) -> str:
    return (
        value.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
        .replace("&#39;", "'")
    )


# ---------------------------------------------------------------------------
# Placements — how a box is described relative to what the document prints
# ---------------------------------------------------------------------------
#
# H1010 prints its labels *below* the space they describe: the words "First
# name" sit under the line you write your first name on, and "Social Security
# number" sits under the dashes. So the common placement here is `Above`, and
# reading a definition means reading it the way the page is laid out rather
# than the way a screen form would be.
#
# Column widths are not written down either. "First name" starts at x=164.7 and
# "Middle name" at x=312.3, so the first column is as wide as the gap between
# them — the form's own labels define its grid, and deriving the width from
# them means a box cannot be declared wider than the space actually available.


@dataclass(frozen=True)
class Anchor:
    """A printed phrase, identified well enough to find exactly one of it."""

    phrase: str
    page: int

    #: Which occurrence, ordered down the page then left to right.
    #:
    #: Explicit rather than defaulting to "the first one" silently, because the
    #: questions that repeat on these forms are the per-person ones, and
    #: quietly taking the first match writes person 3's answer on person 1's
    #: line.
    occurrence: int = 0

    #: Restrict to a vertical band ``(bottom, top)`` in user space.
    within: tuple[float, float] | None = None

    #: Measure the phrase itself rather than the line containing it.
    #:
    #: ``pdftotext`` assembles lines by vertical position, so a label sitting
    #: level with unrelated text elsewhere on the page can be merged into one
    #: line with it. H1010 does exactly this: on English page 9, Person 5's
    #: ``First name`` label is extracted as
    #: ``"or renewing Medicaid, First name"``, merged with the left sidebar,
    #: and that merged line begins at x=22 in the margin. A placement measured
    #: from it puts the applicant's name over the sidebar.
    #:
    #: With this set, the phrase is found as a consecutive run of *words* and
    #: measured on its own bounding box, which is immune to how the extractor
    #: happened to group lines. It is not the default because line matching is
    #: what makes a multi-word question anchorable at all — the wrapped Yes/No
    #: questions are found by their line — and because a phrase match cannot
    #: prefer an exact line over a containment.
    by_phrase: bool = False

    def resolve(self, text: DocumentText) -> PrintedText:
        if self.by_phrase:
            return text.find_phrase(
                self.phrase,
                page=self.page,
                occurrence=self.occurrence,
                within=self.within,
            )

        return text.find(
            self.phrase,
            page=self.page,
            occurrence=self.occurrence,
            within=self.within,
        )


@dataclass(frozen=True)
class Above:
    """A writing space sitting directly above its printed label.

    The default placement on H1010 and H1049.
    """

    anchor: Anchor

    #: Height of the writing space, in points.
    height: float = 15.0

    #: Gap between the top of the label and the bottom of the box.
    gap: float = 1.5

    #: Explicit width. ``None`` derives it from the next column's label.
    width: float | None = None

    #: Shift the left edge, for a box that does not start where its label does.
    dx: float = 0.0

    #: Where the row ends when there is no next column, in points from the left.
    row_right: float = 583.0

    #: Horizontal gap left before the next column begins.
    column_gap: float = 8.0

    def resolve(self, text: DocumentText) -> Box:
        label = self.anchor.resolve(text)
        x = label.x + self.dx

        if self.width is not None:
            width = self.width
        else:
            width = _width_to_next_column(
                text, label, row_right=self.row_right, column_gap=self.column_gap
            ) - self.dx

        return _fit_to_writing_space(
            Box(
                page=label.page,
                x=x,
                y=label.top + self.gap,
                width=max(width, 1.0),
                height=self.height,
            ),
            text,
        )


@dataclass(frozen=True)
class RightOf:
    """A box placed to the right of a printed phrase, on the same line.

    Used for the Yes/No answer boxes, which sit at the end of the question
    rather than above a label of their own.
    """

    anchor: Anchor
    width: float = 60.0
    height: float = 13.0

    #: Gap between the right edge of the phrase and the left edge of the box.
    gap: float = 6.0

    #: Vertical nudge, for a box whose baseline differs from the phrase's.
    dy: float = 0.0

    def resolve(self, text: DocumentText) -> Box:
        printed = self.anchor.resolve(text)

        return _fit_to_writing_space(
            Box(
                page=printed.page,
                x=printed.right + self.gap,
                y=printed.y + self.dy,
                width=self.width,
                height=self.height,
            ),
            text,
        )


@dataclass(frozen=True)
class Over:
    """A box covering a printed phrase, for marking a circle or a checkbox.

    The form says "Fill in the circles ( ) like this", and the circles are
    printed glyphs. A mark is drawn over the option's own printed word — HHSC's
    circles sit immediately left of their labels — so the placement is
    expressed against the word and nudged onto the circle.
    """

    anchor: Anchor
    width: float = 9.0
    height: float = 9.0

    #: Offset from the phrase's left edge to the circle's left edge. Negative,
    #: because the circle is printed to the left of the word it labels.
    dx: float = -11.0

    dy: float = 1.5

    def resolve(self, text: DocumentText) -> Box:
        printed = self.anchor.resolve(text)

        return Box(
            page=printed.page,
            x=printed.x + self.dx,
            y=printed.y + self.dy,
            width=self.width,
            height=self.height,
        )


@dataclass(frozen=True)
class AfterMarker:
    """A writing space beginning just right of a marker inside a printed line.

    H1010's Section P prints eight labelled amount boxes — "Rent or home
    payment $", "Electricity $" — and the two editions typeset them
    differently. The English edition's extracted line ends at the ``$``; the
    Spanish edition's continues through the underscore rule that *is* the
    writing space, so the line's right edge sits past where a value should be
    written.

    Anchoring on the line and measuring from its right edge therefore gives two
    different answers, one of them wrong. Both editions do print a ``$``, so
    this finds that word inside the anchor's own line and measures from it —
    which is the same landmark a person filling the form in uses.

    Restricting the search to the anchor's line matters: a page with eight
    amount boxes prints eight dollar signs, and a document-wide occurrence
    index over them would be unreadable and would break the moment HHSC
    reflowed a column.
    """

    anchor: Anchor

    #: The word to measure from, inside the anchor's line.
    marker: str = "$"

    width: float = 62.0
    height: float = 11.0

    #: Gap between the marker's right edge and the box's left edge.
    gap: float = 2.0

    #: Vertical nudge from the marker's own bottom edge.
    dy: float = 0.0

    def resolve(self, text: DocumentText) -> Box:
        line = self.anchor.resolve(text)
        wanted = _normalize(self.marker)

        # The marker must be on this line, not merely near it: a tolerance of
        # half a line height keeps a neighbouring row's dollar sign out.
        tolerance = line.height * 0.6

        candidates = [
            word
            for word in text.words
            if word.page == line.page
            and abs(word.y - line.y) <= tolerance
            and word.x >= line.x - 0.5
            and word.right <= line.right + 0.5
            and word.normalized() == wanted
        ]

        if not candidates:
            raise MeasurementError(
                f"no {self.marker!r} on the line {self.anchor.phrase!r} on page "
                f"{line.page}. The edition prints this row differently — check "
                f"the extracted words before adjusting the marker."
            )

        candidates.sort(key=lambda word: word.x)
        marker = candidates[0]

        return _fit_to_writing_space(
            Box(
                page=line.page,
                x=marker.right + self.gap,
                y=marker.y + self.dy,
                width=self.width,
                height=self.height,
            ),
            text,
        )


@dataclass(frozen=True)
class CellGrid:
    """The character cells a form draws above one printed label.

    The exact answer where :class:`Slots` was an estimate. A date grid is eight
    drawn rectangles in three groups — ``MM / DD / YYYY`` — and this finds those
    rectangles rather than inferring their outer edges from the printed
    separators. When that inference was tried on H1010's Section H it put the
    year group's right edge 25 points past the last cell, because the year cells
    are narrower than the day cells and nothing in the text says so.

    Returns one box per **cell**, in printed order. Per *group* was the first
    attempt and it printed badly: a two-digit month centred across its pair of
    cells put each digit half over the divider between them, and a four-digit
    year did the same across four. A form designed as a character grid is
    filled one character per cell, and a digit sitting on a printed rule is a
    keying error waiting to happen on a benefits application.

    ``groups`` is therefore a *check* rather than a layout instruction: it says
    how many cells to expect and in what grouping, so a grid that gained or
    lost a cell fails here instead of silently shifting every digit one place.
    """

    #: The printed label directly below the grid.
    anchor: Anchor

    #: Cells per group, left to right. ``(2, 2, 4)`` for a date.
    groups: tuple[int, ...]

    #: Where the grid sits relative to its label.
    #:
    #: ``"above"`` is the main form's convention. ``"right"`` is Section C's
    #: due date, which prints ``Due date [__][__] / [__][__] / [__][__]`` on one
    #: row — and note that grid is six cells, not eight: HHSC asks for a
    #: two-digit year there. Writing a four-digit year into it would put the
    #: century in the day cells.
    side: str = "above"

    #: How far above the label's top the grid may sit.
    reach: float = 26.0

    #: Ignore cells left of the label's own left edge, less this slack.
    left_slack: float = 8.0

    #: Ignore cells narrower or shorter than this — rules, not cells.
    min_size: float = 4.0

    #: Two cells whose left edges are within this are the same cell, drawn
    #: twice. See the collapse step in :meth:`resolve`.
    same_cell: float = 2.0

    #: Inset applied inside each group, so a digit does not touch a border.
    inset: float = 1.5

    def resolve(self, text: DocumentText) -> tuple[Box, ...]:
        label = self.anchor.resolve(text)
        wanted = sum(self.groups)

        if self.side == "right":
            # On the same printed row, to the right of the label.
            in_place = (
                lambda rect: rect.x >= label.right - self.left_slack
                and abs(rect.y - label.y) <= self.reach
            )
        elif self.side == "above":
            in_place = (
                lambda rect: label.top - 1.0 <= rect.y <= label.top + self.reach
                and rect.x >= label.x - self.left_slack
            )
        else:
            raise MeasurementError(
                f"unknown cell-grid side {self.side!r}; use 'above' or 'right'"
            )

        cells = [
            rect
            for rect in text.rects
            if rect.page == label.page
            and rect.width >= self.min_size
            and rect.height >= self.min_size
            and in_place(rect)
        ]

        cells.sort(key=lambda rect: rect.x)

        # Collapse a cell the document draws twice at almost the same place.
        # The Spanish edition's due-date grid has two borders 0.6 points apart
        # on its last cell, which the byte-level dedupe cannot see and which
        # would otherwise read as a seventh cell.
        distinct: list[Box] = []

        for cell in cells:
            if distinct and abs(cell.x - distinct[-1].x) <= self.same_cell:
                continue

            distinct.append(cell)

        cells = distinct

        if len(cells) != wanted:
            raise MeasurementError(
                f"expected {wanted} drawn cells {self.side} "
                f"{self.anchor.phrase!r} on page {label.page}, found "
                f"{len(cells)}"
                + (
                    " at x=" + ", ".join(f"{cell.x:.1f}" for cell in cells)
                    if cells
                    else ""
                )
                + ". The grid moved, or the label is not the one directly "
                "below it."
            )

        return tuple(
            Box(
                page=label.page,
                x=cell.x + self.inset,
                y=cell.y + self.inset,
                width=max(cell.width - self.inset * 2, 1.0),
                height=max(cell.height - self.inset * 2, 1.0),
            )
            for cell in cells
        )


# ---------------------------------------------------------------------------
# Printed circles, measured from ink
# ---------------------------------------------------------------------------
#
# H1010 says "Fill in the circles ( ) like this", and its circles are drawn as
# bezier subpaths placed by a transformation matrix — so their coordinates are
# not readable from the content stream without replaying the graphics state,
# and they carry no text to anchor to.
#
# The first approach was to offset from the option's printed *word*: the circle
# sits a fixed distance to its left. That works until it does not. Measuring
# all 165 mark targets against the circle they land in showed offsets with a
# standard deviation of 1.3 points and a mean that differs between the two
# editions — Section B's Yes/No circles sit 4 points below where a
# label-relative offset puts them, and the Spanish edition's programme circles
# 4 points to the right. One offset cannot serve them, and picking a single
# average would move most marks off centre to make a few better.
#
# So a mark is placed on the circle itself. The page is rendered once, the
# circle nearest the label-derived guess is found by looking for what makes a
# circle — a small, square, *hollow* run of connected ink — and the mark box is
# centred on it. Rendering happens offline in tools/measure_texas_forms.py, and
# only the resulting coordinates are committed; nothing on the render path does
# this.


#: Dots per inch to render at when measuring ink. 300 gives ~0.25pt precision.
_INK_DPI = 300

#: Grey level at or below which a pixel counts as ink.
_INK_THRESHOLD = 150


class PageInk:
    """One rendered page, as a grid of grey levels, for measuring ink.

    Rendered lazily and cached per page: a form's marks cluster on a handful of
    pages, and rendering all 34 to place a dozen circles would make the
    measurement step slow enough to skip.
    """

    def __init__(self, path: Path):
        self._path = path
        self._pages: dict[int, tuple[tuple[bytes, ...], int, int]] = {}

    def _render(self, page: int) -> tuple[tuple[bytes, ...], int, int]:
        cached = self._pages.get(page)

        if cached is not None:
            return cached

        result = subprocess.run(
            [
                "pdftoppm",
                "-f", str(page),
                "-l", str(page),
                "-r", str(_INK_DPI),
                "-gray",
                str(self._path),
            ],
            capture_output=True,
            check=True,
        )

        rendered = _parse_pgm(result.stdout)
        self._pages[page] = rendered

        return rendered

    def ink_columns(
        self, page: int, left: float, right: float, bottom: float, top: float
    ) -> list[bool]:
        """For each pixel column across ``left..right``, whether it has ink.

        Only the rows between ``bottom`` and ``top`` (user space) are looked
        at, so a caller can ask about the band text will occupy and ignore the
        rule below it.
        """
        rows, width, height = self._render(page)
        scale = _INK_DPI / 72.0
        page_height = height / scale

        x0 = max(0, int(left * scale))
        x1 = min(width, int(right * scale))
        y0 = max(0, int((page_height - top) * scale))
        y1 = min(height, int((page_height - bottom) * scale))

        if x1 <= x0 or y1 <= y0:
            return []

        band = rows[y0:y1]

        return [
            any(row[x] <= _INK_THRESHOLD for row in band) for x in range(x0, x1)
        ]

    def circle_near(
        self,
        box: Box,
        *,
        reach: float = 9.0,
        min_size: float = 7.0,
        max_size: float = 9.5,
    ) -> Box | None:
        """The printed circle nearest `box`'s centre, or None if there is none.

        None is informative rather than an error: it means the guess is not
        near a circle at all, which a caller should report instead of silently
        snapping to whatever ink it found.
        """
        rows, width, height = self._render(box.page)
        scale = _INK_DPI / 72.0
        page_height = height / scale

        centre_x = box.x + box.width / 2
        centre_y = box.y + box.height / 2

        left = max(0, int((centre_x - reach) * scale))
        right = min(width, int((centre_x + reach) * scale))
        top = max(0, int((page_height - centre_y - reach) * scale))
        bottom = min(height, int((page_height - centre_y + reach) * scale))

        best: tuple[float, Box] | None = None

        for pixels in _components(rows, left, top, right, bottom):
            xs = [x for x, _ in pixels]
            ys = [y for _, y in pixels]
            span_x = (max(xs) - min(xs) + 1) / scale
            span_y = (max(ys) - min(ys) + 1) / scale

            # The size band is deliberately tight: these circles measure 7.9
            # to 8.2 points across. A looser one also admits printed letters —
            # "C" and "e" are about 6 points and hollow enough to pass every
            # other test here — and marking a letter is worse than finding
            # nothing, because the mark lands on the word instead of a few
            # points off centre.
            if not (min_size <= span_x <= max_size):
                continue

            if not (min_size <= span_y <= max_size):
                continue

            # About as wide as tall.
            if abs(span_x - span_y) > 2.0:
                continue

            # Hollow. A ring's ink is its outline and covers well under half
            # its bounding box; a filled glyph of the same size covers most of
            # it, which is how "O" is told from a printed circle.
            if len(pixels) > span_x * span_y * scale * scale * 0.62:
                continue

            found_x = (min(xs) + max(xs) + 1) / 2 / scale
            found_y = page_height - (min(ys) + max(ys) + 1) / 2 / scale
            distance = abs(found_x - centre_x) + abs(found_y - centre_y)

            candidate = Box(
                page=box.page,
                x=found_x - span_x / 2,
                y=found_y - span_y / 2,
                width=span_x,
                height=span_y,
            )

            if best is None or distance < best[0]:
                best = (distance, candidate)

        if best is not None:
            return best[1]

        # A circle touching other ink is one component with it, so the shape
        # test rejects it. That is not rare: several option circles sit against
        # a table border, and the merged component is 8 by 18 points rather
        # than 8 by 8.
        #
        # So fall back to looking for the *shape* instead of the run: a ring of
        # ink around an empty middle. Slower, and only ever reached for the
        # handful of circles the component pass cannot separate.
        return self._ring_near(rows, width, height, box, reach=reach)

    def _ring_near(
        self,
        rows: tuple[bytes, ...],
        width: int,
        height: int,
        box: Box,
        *,
        reach: float,
        step: float = 0.4,
    ) -> Box | None:
        """The best ring-shaped ink in reach, scored against a circle template.

        A circle is ink on a ring and paper inside it. Both halves matter: the
        ring alone also matches the inside of a printed letter, and the empty
        middle alone matches blank paper.

        Two tolerances, both learned from getting it wrong. The radius is swept
        rather than assumed, because these circles measure 7.9 to 8.2 points
        across and a fixed radius half a point out samples clean paper just
        outside a stroke half a point wide. And each sample checks a
        one-pixel neighbourhood, which at 300 DPI forgives a quarter-point of
        positioning error — without it the test was as brittle as the fixed
        radius it replaced.
        """
        import math

        scale = _INK_DPI / 72.0
        page_height = height / scale

        centre_x = box.x + box.width / 2
        centre_y = box.y + box.height / 2

        def inked(x: float, y: float) -> bool:
            px = int(x * scale)
            py = int((page_height - y) * scale)

            for offset_y in (-1, 0, 1):
                row_y = py + offset_y

                if not 0 <= row_y < height:
                    continue

                row = rows[row_y]

                for offset_x in (-1, 0, 1):
                    column = px + offset_x

                    if 0 <= column < width and row[column] < _INK_THRESHOLD:
                        return True

            return False

        best: tuple[float, float, float, float] | None = None
        steps = int(reach / step)

        # Radii matching the circles this form actually prints: measured at
        # 7.9 to 8.2 points across. Deliberately narrow. A wider sweep also
        # matches printed letters — "C" and "e" are about 6 points and hollow
        # enough to score well — and matching a letter is worse than finding
        # nothing, because it puts a mark on top of the word.
        for radius in (3.7, 3.9, 4.1):
            ring = [
                (
                    math.cos(angle * math.pi / 8) * radius,
                    math.sin(angle * math.pi / 8) * radius,
                )
                for angle in range(16)
            ]
            # The interior, sampled at two depths. A printed circle's inside is
            # blank paper; a letter has a stroke crossing it somewhere, and one
            # ring of samples can slip between strokes.
            inside = [
                (
                    math.cos(angle * math.pi / 6) * radius * depth,
                    math.sin(angle * math.pi / 6) * radius * depth,
                )
                for depth in (0.35, 0.6)
                for angle in range(12)
            ]

            for index_x in range(-steps, steps + 1):
                for index_y in range(-steps, steps + 1):
                    x = centre_x + index_x * step
                    y = centre_y + index_y * step

                    on_ring = sum(
                        1 for dx, dy in ring if inked(x + dx, y + dy)
                    )

                    # Closed, not merely curved: a printed circle has no gap,
                    # where "C" does. Checked before the interior samples so
                    # the common case costs 16 lookups rather than 40.
                    if on_ring < len(ring) * 0.9:
                        continue

                    if any(inked(x + dx, y + dy) for dx, dy in inside):
                        continue

                    # Every survivor is a closed, hollow ring of the right
                    # size, so proximity is the only thing left to choose on.
                    distance = abs(x - centre_x) + abs(y - centre_y)

                    if best is None or -distance > best[0]:
                        best = (-distance, x, y, radius * 2)

        if best is None:
            return None

        _, x, y, span = best

        return Box(
            page=box.page,
            x=x - span / 2,
            y=y - span / 2,
            width=span,
            height=span,
        )


def _parse_pgm(data: bytes) -> tuple[tuple[bytes, ...], int, int]:
    """A binary PGM (P5) as rows of grey levels.

    Parsed by hand because the alternative is an image dependency for reading
    fifteen bytes of header and one byte per pixel.
    """
    if data[:2] != b"P5":
        raise MeasurementError(
            "pdftoppm did not return a binary PGM; is poppler installed?"
        )

    fields: list[int] = []
    index = 2

    while len(fields) < 3:
        while data[index : index + 1].isspace():
            index += 1

        if data[index : index + 1] == b"#":
            while data[index : index + 1] not in (b"\n", b""):
                index += 1
            continue

        start = index

        while not data[index : index + 1].isspace():
            index += 1

        fields.append(int(data[start:index]))

    index += 1
    width, height, _ = fields

    rows = tuple(
        data[index + y * width : index + (y + 1) * width] for y in range(height)
    )

    return rows, width, height


def _components(
    rows: tuple[bytes, ...],
    left: int,
    top: int,
    right: int,
    bottom: int,
    limit: int = 4000,
) -> list[list[tuple[int, int]]]:
    """Four-connected runs of ink inside a pixel window.

    `limit` caps one component, so a mark box that happens to sit over a large
    filled shape cannot walk the whole page.
    """
    seen: set[tuple[int, int]] = set()
    found: list[list[tuple[int, int]]] = []

    for y in range(top, bottom):
        row = rows[y]

        for x in range(left, right):
            if (x, y) in seen or row[x] >= _INK_THRESHOLD:
                continue

            stack = [(x, y)]
            seen.add((x, y))
            pixels: list[tuple[int, int]] = []

            while stack and len(pixels) < limit:
                current_x, current_y = stack.pop()
                pixels.append((current_x, current_y))

                for next_x, next_y in (
                    (current_x + 1, current_y),
                    (current_x - 1, current_y),
                    (current_x, current_y + 1),
                    (current_x, current_y - 1),
                ):
                    if (
                        left <= next_x < right
                        and top <= next_y < bottom
                        and (next_x, next_y) not in seen
                        and rows[next_y][next_x] < _INK_THRESHOLD
                    ):
                        seen.add((next_x, next_y))
                        stack.append((next_x, next_y))

            found.append(pixels)

    return found


@dataclass(frozen=True)
class SnapToCircle:
    """A mark centred on the printed circle nearest an approximate placement.

    Wraps whatever placement gets close — ``Over`` a printed word, ``SameRow``
    as a question — and replaces its guess with the circle's own geometry. That
    is what keeps the two editions independent without either carrying a table
    of hand-tuned offsets: each is measured against its own document, and a
    circle HHSC moves is followed rather than missed.

    Falls back to the inner placement when no circle is found within reach, and
    the measurement tool reports that so it is visible rather than silent. A
    fallback is the old behaviour, which is worse than snapping and better than
    no box at all.
    """

    inner: "Placement"

    #: Size of the mark box, as a fraction of the circle it fills.
    #:
    #: Slightly smaller than the circle so the glyph does not touch the printed
    #: outline. The renderer shrinks a mark that still does not fit.
    fill: float = 0.92

    #: How far from the inner placement's centre to look, in points.
    #:
    #: 14 rather than a tighter number because the gap between a circle and
    #: its label is not constant even within one edition: the Spanish marital
    #: status circles sit about 20 points left of their word where the English
    #: ones sit 11, so a 9-point reach found nothing for two of the five and
    #: fell back to the label offset.
    #:
    #: Safe at this size because the nearest match wins and every candidate
    #: has already been shape-checked — the closest pair of circles on either
    #: edition is 36 points apart, so a 14-point reach cannot cross from one to
    #: its neighbour. The alignment sweep over all 332 mark targets is what
    #: establishes that rather than the arithmetic.
    reach: float = 14.0

    def resolve(self, text: DocumentText) -> Box:
        guess = self.inner.resolve(text)

        if isinstance(guess, tuple):  # pragma: no cover - inner is single-box
            raise MeasurementError(
                "SnapToCircle wraps a placement that returns one box"
            )

        ink = text.ink

        if ink is None:
            return guess

        circle = ink.circle_near(guess, reach=self.reach)

        if circle is None:
            return guess

        width = circle.width * self.fill
        height = circle.height * self.fill

        return Box(
            page=circle.page,
            x=circle.x + (circle.width - width) / 2,
            y=circle.y + (circle.height - height) / 2,
            width=width,
            height=height,
        )


#: Any way of describing where a box is, relative to the printed page.
Placement = Above | RightOf | Over | AfterMarker | CellGrid | SnapToCircle


def _width_to_next_column(
    text: DocumentText,
    label: PrintedText,
    *,
    row_right: float,
    column_gap: float,
) -> float:
    """How wide the column starting at `label` is.

    The next label printed on the same line — within half a line-height, so a
    baseline that drifts a point does not count as a different row — bounds this
    one. With nothing to its right, the column runs to `row_right`.
    """
    tolerance = label.height * 0.6

    to_the_right = [
        other.x
        for other in text.lines
        if other.page == label.page
        and other.x > label.right
        and abs(other.y - label.y) <= tolerance
    ]

    boundary = min(to_the_right, default=row_right)

    return max(boundary - label.x - column_gap, 1.0)


#: Cells narrower or shorter than this are rules or character cells, not the
#: white writing space a line of text is written into.
_WRITING_CELL_MIN_WIDTH = 15.0
_WRITING_CELL_HEIGHTS = (8.0, 45.0)

#: Points kept between a value and printed ink it would otherwise run into.
_INK_CLEARANCE = 1.0

#: The size the ink scan assumes a value is set at, at most.
_NOMINAL_VALUE_SIZE = 10.0


def _fit_to_writing_space(box: Box, text: DocumentText) -> Box:
    """Trim a text box to the writing space the page actually leaves it.

    A box derived from labels knows where the question is, not where the
    printed field ends. ``Above`` sizes a column from the gap between two
    labels, so on H1010 the home-address box ran 5 points past the white field
    it belongs in and into the county column's border, and Section O's payer
    line ran through the printed arrow that points into it. Nothing about the
    labels says so; the drawing does.

    Two corrections, both only ever *shrinking* the box, horizontally:

    1. **The white cell.** When the box starts inside a drawn writing cell, its
       left and right edges are kept within that cell.
    2. **Ink.** Within the band a value's capitals occupy — not the descender
       band, where the underline a value sits on is printed — any ink the box
       starts on is stepped past, and the box ends before the first ink to its
       right: a border, an arrow, a printed word.

    The vertical extent is left alone: it is what the baseline is measured
    from, and moving it would move every value on the form.
    """
    left, right = box.x, box.right

    # 1. The drawn cell the box starts in.
    probe_x = box.x + min(4.0, box.width / 4)
    probe_y = box.y + box.height / 2
    low, high = _WRITING_CELL_HEIGHTS

    cells = [
        rect
        for rect in text.rects
        if rect.page == box.page
        and rect.width >= _WRITING_CELL_MIN_WIDTH
        and low <= rect.height <= high
        and rect.x <= probe_x <= rect.right
        and rect.y <= probe_y <= rect.top
    ]

    if cells:
        cell = min(cells, key=lambda rect: rect.width * rect.height)
        left = max(left, cell.x)
        right = min(right, cell.right)

    # 2. Printed ink inside the band the value's capitals will occupy.
    if text.ink is not None and right - left > 2 * _INK_CLEARANCE:
        size = max(1.0, min(_NOMINAL_VALUE_SIZE, box.height - 3.0))
        baseline = box.top - 1.5 - 0.78 * size
        columns = text.ink.ink_columns(
            box.page, left, right, baseline + 0.3, baseline + 0.72 * size
        )

        if columns:
            step = (right - left) / len(columns)

            # Ink the box starts on: a "$" or "(" printed at the left end.
            start = 0

            while start < len(columns) and columns[start]:
                start += 1

            if 0 < start and start * step <= (right - left) * 0.3:
                left = left + start * step + _INK_CLEARANCE
                columns = columns[start:]

            # The first ink to the right, past the value's own first letters.
            skip = int(8.0 / step) if step else 0

            for index in range(skip, len(columns)):
                if columns[index]:
                    candidate = left + index * step - _INK_CLEARANCE

                    if candidate - left >= (box.right - box.x) * 0.6:
                        right = candidate

                    break

    if (left, right) == (box.x, box.right) or right - left < 1.0:
        return box

    return Box(
        page=box.page,
        x=round(left, 1),
        y=box.y,
        width=round(right - left, 1),
        height=box.height,
    )


def resolve_placement(placement: Placement, text: DocumentText) -> Box:
    """The measured box a placement describes."""
    return placement.resolve(text)


@dataclass(frozen=True)
class SameRow:
    """A word on the same printed row as a question, marked over its circle.

    H1010's Yes/No pairs are the reason this exists. The words ``Yes`` and
    ``No`` appear about forty times on some pages, so an anchor naming ``Yes``
    and an occurrence index is both unreadable and fragile — inserting one
    question renumbers every answer below it.

    Anchoring instead on the *question* and then finding its options beside it
    means the declaration reads the way the page does ("the Yes next to 'Are
    you a U.S. citizen?'") and survives the page being re-flowed.
    """

    #: The question this option belongs to.
    question: Anchor

    #: The option word printed on the same row, e.g. ``"Yes"``.
    option: str

    #: How far the option's baseline may differ from the question's and still
    #: count as the same row.
    #:
    #: Generous by default: HHSC sets the question and its answer in different
    #: sizes, so their reported boxes do not share a baseline. Measured against
    #: the vertical centres rather than the bottoms for the same reason.
    tolerance: float = 9.0

    width: float = 9.0
    height: float = 9.0

    #: Offset from the option word's left edge to its circle. Negative: the
    #: circle is printed to the left of the word.
    dx: float = -12.0

    dy: float = 1.0

    def resolve(self, text: DocumentText) -> Box:
        anchor = self.question.resolve(text)
        wanted = _normalize(self.option)
        centre = anchor.y + anchor.height / 2

        on_row = [
            line
            for line in text.lines
            if line.page == anchor.page
            and line.x >= anchor.x
            and abs((line.y + line.height / 2) - centre) <= self.tolerance
        ]

        # Exact first, containment second — the same preference `find` uses,
        # and for the same reason. The Spanish edition prints its "other"
        # option as ``otro: _______``, the write-in rule included in the run,
        # so an exact-only match cannot find it; ``Yes`` must still not match
        # inside a longer sentence when a bare ``Yes`` is on the row.
        candidates = [
            line for line in on_row if line.normalized() == wanted
        ] or [line for line in on_row if wanted in line.normalized()]

        if not candidates:
            raise MeasurementError(
                f"no {self.option!r} on the same row as "
                f"{self.question.phrase!r} on page {anchor.page}. The option is "
                f"printed elsewhere, or the row tolerance is too tight."
            )

        candidates.sort(key=lambda line: line.x)
        printed = candidates[0]

        return Box(
            page=printed.page,
            x=printed.x + self.dx,
            y=printed.y + self.dy,
            width=self.width,
            height=self.height,
        )


@dataclass(frozen=True)
class Slots:
    """Evenly-pitched cells between the separators a form prints.

    Dates and phone numbers on these forms are character grids: ``__ / __ /
    ____`` and ``(   )    -``. The cells themselves are drawn as vector
    rectangles, which carry no text and so cannot be anchored to — but the
    separators *are* text, and they bound the cells exactly.

    So a slot is declared as "the space between the printed ``(`` and the
    printed ``)``", and the geometry falls out of the document.
    """

    #: The separator glyphs, in printed order, on one row.
    separators: tuple[Anchor, ...]

    #: Left edge of the first cell, when it starts before the first separator.
    starts_at: float | None = None

    #: Right edge of the last cell, when it runs past the last separator.
    ends_at: float | None = None

    height: float = 12.0

    #: Inset from each separator, so a digit does not touch it.
    inset: float = 2.0

    def resolve(self, text: DocumentText) -> tuple[Box, ...]:
        marks = [anchor.resolve(text) for anchor in self.separators]

        if not marks:
            raise MeasurementError("a slot group needs at least one separator")

        # Separators bounding cells on one printed row run left to right, so
        # order them by x rather than trusting the order they were declared in.
        # Declaration order comes from occurrence indices, and two separators on
        # the same row are exactly the case where those are least reliable.
        marks.sort(key=lambda mark: mark.x)

        page = marks[0].page
        baseline = min(mark.y for mark in marks)

        edges: list[tuple[float, float]] = []
        left = self.starts_at if self.starts_at is not None else None

        for mark in marks:
            if left is not None:
                edges.append((left + self.inset, mark.x - self.inset))

            left = mark.right

        right = self.ends_at

        if left is not None and right is not None:
            edges.append((left + self.inset, right - self.inset))

        return tuple(
            Box(
                page=page,
                x=start,
                y=baseline,
                width=max(end - start, 1.0),
                height=self.height,
            )
            for start, end in edges
            if end > start
        )


@dataclass(frozen=True)
class Below:
    """A writing space sitting directly below its printed label.

    The opposite convention to :class:`Above`, and both are in use: H1010 sets
    its labels under the line, while H3037 and H1049 use them as column
    headings with the space beneath. Which one a form uses is a fact about the
    form, so it is declared per field rather than configured per document —
    H3037 does both, with headings on page 1 and an inline prompt on page 2.
    """

    anchor: Anchor
    height: float = 15.0
    gap: float = 2.0
    width: float | None = None
    dx: float = 0.0
    row_right: float = 583.0
    column_gap: float = 8.0

    def resolve(self, text: DocumentText) -> Box:
        label = self.anchor.resolve(text)
        x = label.x + self.dx

        if self.width is not None:
            width = self.width
        else:
            width = _width_to_next_column(
                text, label, row_right=self.row_right, column_gap=self.column_gap
            ) - self.dx

        return _fit_to_writing_space(
            Box(
                page=label.page,
                x=x,
                y=label.y - self.gap - self.height,
                width=max(width, 1.0),
                height=self.height,
            ),
            text,
        )


@dataclass(frozen=True)
class PhoneSlots:
    """The three cells a printed ``(   )    -`` phone template provides.

    Worth its own type because the two H1010 editions print the same template
    with different text runs. The English edition emits the parentheses as one
    token, ``"( )"``; the Spanish edition emits ``"("`` and ``")"``
    separately. A generic separator list handles the second and silently loses
    the area code on the first, which is exactly the kind of difference between
    language editions that must not be papered over.

    So both shapes are recognised explicitly, and a row that matches neither
    raises rather than guessing.

    The value is drawn as digits only — ``5125550143`` sliced ``[0:3]``,
    ``[3:6]``, ``[6:10]`` — because the form has already printed the
    punctuation.
    """

    #: The row the template sits on, as a band ``(bottom, top)`` in user space.
    within: tuple[float, float]

    page: int

    #: Left bound. Both H1010 phone templates -- home and cell -- sit on the
    #: same printed row, so the band alone selects both and the first one wins.
    #: Naming where the column starts is what tells them apart.
    x_from: float = 0.0

    height: float = 12.0

    #: Inset from the dash, so a digit does not touch it.
    inset: float = 2.0

    #: Inset from the parentheses, which is smaller than :attr:`inset` on
    #: purpose.
    #:
    #: The area-code cell is the tightest on the form — about 15 points between
    #: the inner edges of the printed parentheses — and taking two points off
    #: each side left too little room for three digits at a legible size, so the
    #: English edition's cell-phone area code silently failed to render at all.
    #: The parentheses are thin glyphs with visual space inside them; a digit
    #: set half a point from one does not touch it.
    paren_inset: float = 0.5

    #: Right bound of the template's column. Also caps which text runs count
    #: as part of this template, so the home and cell columns stay apart.
    ends_at: float = 370.0

    #: Width of the last cell, holding the final four digits.
    #:
    #: Capped rather than running to :attr:`ends_at`, because the printed rule
    #: continues to the edge of the column and a centred four-digit group in a
    #: wide cell floats a long way from the dash it belongs to. 62 points was
    #: the first cap and still did that — "1234" sat 20 points right of its
    #: dash. Four digits at the form's 9.5-point value size are 21 points, so
    #: this is that plus the renderer's padding.
    tail_width: float = 26.0

    def resolve(self, text: DocumentText) -> tuple[Box, ...]:
        bottom, top = self.within
        on_row = [
            line
            for line in text.lines
            if line.page == self.page
            and bottom <= line.y <= top
            and line.x >= self.x_from
            and line.x <= self.ends_at
        ]

        merged = [line for line in on_row if line.text.strip() in {"( )", "()"}]
        opens = [line for line in on_row if line.text.strip() == "("]
        closes = [line for line in on_row if line.text.strip() == ")"]
        dashes = [line for line in on_row if line.text.strip() in {"-", "–", "—"}]

        if not dashes:
            raise MeasurementError(
                f"no dash in the phone template on page {self.page} between "
                f"y={bottom} and y={top}; the row is not a phone template."
            )

        dash = min(dashes, key=lambda line: line.x)

        if merged:
            token = merged[0]
            # One run holds both parentheses, so its box spans them. The cell is
            # the space *between* them: this used to run from just inside the
            # "(" to the outer edge of the ")", which set the area code's last
            # digit on top of the closing parenthesis. The extracted *words*
            # still carry each parenthesis separately, so measure from those.
            inside = [
                word
                for word in text.words
                if word.page == self.page
                and word.x >= token.x - 0.5
                and word.right <= token.right + 0.5
                and abs(word.y - token.y) <= _SAME_LINE_TOLERANCE
            ]
            open_word = next((w for w in inside if w.text.strip() == "("), None)
            close_word = next((w for w in inside if w.text.strip() == ")"), None)

            if open_word is not None and close_word is not None:
                area = (
                    open_word.right + self.paren_inset,
                    close_word.x - self.paren_inset,
                )
            else:
                area = (
                    token.x + self.paren_inset + 1.0,
                    token.right - self.paren_inset,
                )

            after_parens = token.right
        elif opens and closes:
            open_paren = min(opens, key=lambda line: line.x)
            close_paren = min(
                (c for c in closes if c.x > open_paren.x),
                key=lambda line: line.x,
                default=None,
            )

            if close_paren is None:
                raise MeasurementError(
                    f"an opening parenthesis with no closing one on page "
                    f"{self.page} between y={bottom} and y={top}"
                )

            area = (open_paren.right + self.paren_inset, close_paren.x - self.paren_inset)
            after_parens = close_paren.right
        else:
            raise MeasurementError(
                f"no parentheses in the phone template on page {self.page} "
                f"between y={bottom} and y={top}. This edition prints the "
                f"template differently -- inspect the extracted text rather "
                f"than loosening the match."
            )

        baseline = min(dash.y, *(line.y for line in on_row if line.x <= dash.x))

        cells = (
            area,
            (after_parens + self.inset, dash.x - self.inset),
            (
                dash.right + self.inset,
                min(dash.right + self.inset + self.tail_width, self.ends_at),
            ),
        )

        return tuple(
            Box(
                page=self.page,
                x=start,
                y=baseline,
                width=max(end - start, 1.0),
                height=self.height,
            )
            for start, end in cells
            if end > start
        )
