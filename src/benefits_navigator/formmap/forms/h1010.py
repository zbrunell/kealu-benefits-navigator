#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Texas H1010 — Texas Works Application for Assistance.

The first overlay-based form in this project, and the reason the overlay
mechanism exists.

── What we hold, and what we do not ───────────────────────────────────────
We do **not** hold the official H1010 PDF, and this was re-verified against
HHSC's own systems on 30 August 2026 rather than taken on trust from the last
person who tried:

* ``fhb.hhs.texas.gov``'s form page for H1010 (effective 6/2026) links to
  ``yourtexasbenefits.com/Learn/GetPaperForm?lang=en_US`` for both the English
  and the Spanish edition. That URL returns an Angular application, not a
  document — there is no PDF behind it to fetch.
* ``www.hhs.texas.gov/regulations/forms/...`` answers with HTTP 403 to every
  request, browser headers included.
* ``www.hhs.texas.gov/sites/default/files/...`` is reachable but holds no H1010
  under any path we could find; it answers 404.

That constraint decides the honest design, and it is worth being explicit about
what was *not* done: no coordinate in this file is a guess at where a box sits
on the government form. Inventing coordinates for a document nobody here has
opened would produce a PDF that looks authoritative and prints values across the
wrong printed labels — the same class of failure as the fabricated benefit
amounts this codebase already removed.

So this definition declares ``base_document=None``. The renderer then draws onto
Navigator-authored pages whose geometry is defined right here, which means every
coordinate below is one we own and can verify by opening the output. The result
is a genuine prefilled worksheet the applicant can transcribe from or attach —
it is labelled as such, and never presented as the official form.

── What the questions are drawn from ──────────────────────────────────────
The *scope* is not invented either. HHSC's published purpose for Form H1010,
read from the page above, states that the form is used to apply for SNAP food
benefits, TANF cash help and health care (children, adults caring for a child,
adults not caring for a child, pregnant women, and former foster youth); that it
serves as the **screening document for SNAP applicants who may be entitled to
expedited service**; that it carries an **authorized representative's
acknowledgement of their responsibilities**; and that it offers voter
registration. Every section below exists because that description says the form
covers it and because the Navigator's canonical intake can actually answer it.

The wording of each question is the Navigator's own plain-English phrasing of
that topic — it is not a transcription of HHSC's printed wording, which we have
not seen, and the document says on its first page that it is not the official
form. Where the published purpose names something we do not collect (voter
registration, race and ethnicity), no box is printed at all rather than an empty
one implying we asked. ``docs/h1010-mapping-audit.md`` lists those and why.

── The upgrade path this buys ─────────────────────────────────────────────
When the official PDF is obtained and its boxes measured, the change is:

1. drop the file into ``forms/TX-H1010.pdf``,
2. set ``base_document="TX-H1010.pdf"`` and ``page_count`` to its real count,
3. replace the ``Box`` in each mapping with the measured one.

The canonical keys, the transforms, the field kinds, the fitting behaviour, the
review sheet and every test keep working untouched. That is the whole point of
separating canonical data from PDF representation: obtaining the asset becomes a
data change, not a rewrite.

── Layout ────────────────────────────────────────────────────────────────
Coordinates are not written by hand. :class:`_Layout` computes them from a
declared grid — margins, row height, column fractions — and emits the printed
label and the value box together in one call, so a label and the box it
describes cannot drift apart. Adding a field is adding a line to the section
builders below.

Repeated blocks — the people, the jobs, the bills — are not written out row by
row either. They are declared once as a :class:`~benefits_navigator.formmap.repeat.RepeatingGroup`
and a list of columns, and :meth:`_Layout.table` prints the header, the rows and
the row numbers. That is what keeps row 3's date of birth beside row 3's name.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field

from benefits_navigator.formmap.definition import (
    Condition,
    FieldMapping,
    FormDefinition,
)
from benefits_navigator.formmap.render import StaticText
from benefits_navigator.formmap.repeat import RepeatingGroup
from benefits_navigator.formmap.targets import (
    Box,
    FieldKind,
    OverlayTarget,
)

# ---------------------------------------------------------------------------
# Page geometry
# ---------------------------------------------------------------------------

PAGE_WIDTH = 612.0
PAGE_HEIGHT = 792.0

_MARGIN_X = 45.0
_MARGIN_TOP = 54.0
_MARGIN_BOTTOM = 72.0

_CONTENT_WIDTH = PAGE_WIDTH - _MARGIN_X * 2

#: Height of a value box, sized for 10pt text with room for descenders.
_ROW_HEIGHT = 16.0

#: Blank space left below a row's box before the next label starts.
#:
#: A gap rather than a fixed row-to-row pitch. A pitch has to be at least as
#: tall as the tallest row, and subtracting a tall row from it goes negative —
#: which walked the cursor back *up* the page and printed the next label on top
#: of the multiline box that had just been placed.
_ROW_GAP = 14.0

#: The tighter gap between rows of a table, which shares one header.
_TABLE_ROW_GAP = 4.0

#: Gap between a printed label and the box beneath it.
_LABEL_GAP = 3.0

_LABEL_SIZE = 7.5
_VALUE_SIZE = 10.0
_SECTION_TITLE_SIZE = 11.0
_TITLE_SIZE = 14.0

#: Side of a printed checkbox, and the mark box that sits on it.
_CHECKBOX_SIDE = 10.0

#: The glyph that prints an empty box.
#:
#: Brackets and spaces rather than "☐": the page declares WinAnsiEncoding, which
#: has no ballot-box glyph, so U+2610 rendered as "?" on every checkbox. Drawing
#: a real square would mean emitting vector operators, and the renderer draws
#: text only — deliberately, so a page needs no resources beyond one base-14
#: font.
_EMPTY_BOX_GLYPH = "[  ]"

#: Horizontal gap between two columns of a table, as a fraction of the content.
_COLUMN_GAP = 0.015

#: Width of a table's row-number column, as a fraction of the content.
_NUMBER_COLUMN = 0.035


@dataclass(frozen=True)
class _Column:
    """One column of a printed table.

    ``suffix`` is appended to the repeating group's row prefix, so a column
    names a canonical field rather than a coordinate:
    ``("first_name", "First name", 0.20)`` reads
    ``household.members.<row>.first_name`` for every row.
    """

    suffix: str
    header: str
    width: float
    kind: FieldKind = FieldKind.TEXT
    transform: str | None = None

    #: Other suffixes that answer the same column, tried in order.
    #:
    #: The household table asks everyone's sex in one column; the canonical
    #: model keeps it under ``adult.sex`` or ``child.sex`` depending on the
    #: person. Both are the same printed question.
    alternates: tuple[str, ...] = ()

    #: Whether a blank cell is a complete answer for this column.
    optional: bool = False

    #: The column's name in full, when the printed header has to be short.
    #:
    #: A narrow column gets an abbreviated header — "This month ($)" — because
    #: that is what fits above it. The review sheet has a whole line, and
    #: "Job 1 — This month ($)" is a worse thing to read there than
    #: "Job 1 — Gross pay this month".
    full_name: str = ""

    @property
    def review_name(self) -> str:
        return self.full_name or self.header


@dataclass
class _Layout:
    """Turns a declared grid into boxes, and keeps labels attached to them.

    The single place in this module that does arithmetic. Every mapping below
    asks for a column span and gets a box; none of them contains a literal
    coordinate, so a change to the margins or the row pitch moves the whole
    form consistently instead of leaving half of it behind.
    """

    page: int = 1
    y: float = PAGE_HEIGHT - _MARGIN_TOP

    fields: list[FieldMapping] = dataclass_field(default_factory=list)
    labels: list[StaticText] = dataclass_field(default_factory=list)
    page_count: int = 1

    # -- page and section flow ---------------------------------------------

    def new_page(self) -> None:
        self.page += 1
        self.page_count = max(self.page_count, self.page)
        self.y = PAGE_HEIGHT - _MARGIN_TOP

    def _row_height(self, height: float) -> float:
        """Total vertical space one labelled row consumes."""
        return _LABEL_SIZE + _LABEL_GAP + height + _ROW_GAP

    def _ensure_room(self, needed: float) -> None:
        if self.y - needed < _MARGIN_BOTTOM:
            self.new_page()

    def title(self, text: str, subtitle: str = "") -> None:
        self.labels.append(
            StaticText(self.page, _MARGIN_X, self.y, _TITLE_SIZE, text)
        )
        self.y -= _TITLE_SIZE + 6

        for line in _wrap_note(subtitle):
            self.labels.append(
                StaticText(self.page, _MARGIN_X, self.y, _LABEL_SIZE + 1, line)
            )
            self.y -= _LABEL_SIZE + 4

        if subtitle:
            self.y -= 6

    def section(
        self,
        text: str,
        note: str = "",
        *,
        first_row_height: float = _ROW_HEIGHT,
        reserve_rows: int = 1,
    ) -> None:
        """Start a section, reserving room for its heading and first row.

        Reserved as one block on purpose. Reserving only the heading let the
        heading print at the bottom of a page and its first field break to the
        next one, so "Money you get" appeared on page 1 with both its boxes on
        page 2 — a section header with nothing under it.
        """
        note_lines = _wrap_note(note)

        needed = (
            8
            + _SECTION_TITLE_SIZE
            + 6
            + sum((_LABEL_SIZE + 4) for _ in note_lines)
            + (4 if note_lines else 0)
            + self._row_height(first_row_height) * reserve_rows
        )

        self._ensure_room(needed)

        self.y -= 8
        self.labels.append(
            StaticText(self.page, _MARGIN_X, self.y, _SECTION_TITLE_SIZE, text)
        )
        self.y -= _SECTION_TITLE_SIZE + 6

        for line in note_lines:
            self.labels.append(
                StaticText(self.page, _MARGIN_X, self.y, _LABEL_SIZE, line)
            )
            self.y -= _LABEL_SIZE + 4

        if note_lines:
            self.y -= 4

    # -- geometry ----------------------------------------------------------

    def _empty_box(self, x: float, row_y: float) -> float:
        """Print an empty box at `x`, and return where its caption starts.

        Sized so the printed glyph is exactly ``_CHECKBOX_SIDE`` wide, and the
        caption offset is measured from the glyph rather than assumed. Both were
        guessed before, at 11pt and a fixed +3/+4 offset, which drew a 13.4pt
        bracket box under a 10pt mark box — the "X" sat left of centre and the
        caption printed hard against the closing bracket ("[  ]Yes").
        """
        from benefits_navigator.formmap.textfit import helvetica_width

        unit = helvetica_width(_EMPTY_BOX_GLYPH, 1.0)
        size = _CHECKBOX_SIDE / unit

        self.labels.append(
            StaticText(self.page, x, row_y + 1.5, size, _EMPTY_BOX_GLYPH)
        )

        return x + _CHECKBOX_SIDE + 4.0

    def _column(self, start: float, width: float) -> tuple[float, float]:
        """Absolute x and width from column fractions of the content width."""
        return (
            _MARGIN_X + _CONTENT_WIDTH * start,
            _CONTENT_WIDTH * width,
        )

    def keep_together(self, rows: int, height: float = _ROW_HEIGHT) -> None:
        """Break the page now if the next `rows` rows will not all fit.

        An address is one thing to read, not four boxes that happen to be
        adjacent. Split across a page break its second half arrives at the top
        of the next page under no heading at all: "Mailing street address" and
        four empty rules, with nothing saying whose address it is.
        """
        self._ensure_room(rows * self._row_height(height))

    def row(self, height: float = _ROW_HEIGHT) -> float:
        """Start a labelled row and return the bottom y of its value boxes."""
        self._ensure_room(self._row_height(height))
        self.y -= _LABEL_SIZE + _LABEL_GAP + height
        bottom = self.y
        self.y -= _ROW_GAP

        return bottom

    # -- field placement ---------------------------------------------------

    def text_field(
        self,
        row_y: float,
        key: str,
        label: str,
        section: str,
        *,
        start: float,
        width: float,
        kind: FieldKind = FieldKind.TEXT,
        transform: str | None = None,
        height: float = _ROW_HEIGHT,
        multiline: bool = False,
        applies_when: Condition | None = None,
        optional: bool = False,
        alternate_keys: tuple[str, ...] = (),
        row: tuple[str, int] | None = None,
        with_label: bool = True,
    ) -> None:
        x, box_width = self._column(start, width)

        # The label sits immediately above its own box, so the two move together.
        if with_label:
            self.labels.append(
                StaticText(
                    self.page,
                    x,
                    row_y + height + _LABEL_GAP,
                    _LABEL_SIZE,
                    label,
                )
            )

        self.fields.append(
            FieldMapping(
                key=key,
                kind=kind,
                transform=transform,
                printed_label=label,
                section=section,
                applies_when=applies_when,
                optional=optional,
                alternate_keys=alternate_keys,
                row=row,
                target=OverlayTarget(
                    box=Box(
                        page=self.page,
                        x=x,
                        y=row_y,
                        width=box_width,
                        height=height,
                    ),
                    font_size=_VALUE_SIZE,
                    multiline=multiline,
                ),
            )
        )

        # An underline makes the worksheet readable as a form rather than as
        # text floating on a page. Drawn as a rule of underscores because the
        # renderer draws text only — no vector operators, no extra resources.
        #
        # Not under a multiline box: the rule lands at the bottom of a two-line
        # box, a full page width away from the one line of text above it, and
        # reads as a section divider rather than as the field's own line.
        if not multiline:
            self._rule(x, row_y - 2.0, box_width)

    def checkbox(
        self,
        row_y: float,
        key: str,
        label: str,
        section: str,
        *,
        start: float,
        applies_when: Condition | None = None,
        optional: bool = False,
    ) -> None:
        x, _ = self._column(start, 0.0)

        self.fields.append(
            FieldMapping(
                key=key,
                kind=FieldKind.CHECKBOX,
                printed_label=label,
                section=section,
                applies_when=applies_when,
                optional=optional,
                target=OverlayTarget(
                    box=Box(
                        page=self.page,
                        x=x,
                        y=row_y,
                        width=_CHECKBOX_SIDE,
                        height=_CHECKBOX_SIDE,
                    ),
                    font_size=9.0,
                    mark="X",
                ),
            )
        )

        caption_x = self._empty_box(x, row_y)

        self.labels.append(
            StaticText(self.page, caption_x, row_y + 2.0, _LABEL_SIZE + 1, label)
        )

    def yes_no(
        self,
        key: str,
        label: str,
        section: str,
        *,
        start: float = 0.0,
        options_start: float = 0.72,
        applies_when: Condition | None = None,
        optional: bool = False,
    ) -> None:
        """A printed yes/no pair as one CHOICE field.

        One field with two boxes, not two checkboxes — so an unanswered question
        marks neither, which a pair of independent checkboxes cannot express.

        The row is allocated here rather than by the caller because the question
        decides how tall it is. A long one — "Does anyone get money from
        anywhere else (child support, unemployment, Social Security,
        retirement)?" — is wider than the space before the Yes box, and drawn as
        one line it ran straight through it. It now wraps, and the row grows.
        """
        from benefits_navigator.formmap.textfit import wrap_to_width

        question_size = _LABEL_SIZE + 1
        available = (options_start - start) * _CONTENT_WIDTH - 8.0
        lines = wrap_to_width(label, question_size, available) or [label]

        line_pitch = question_size + 3.0
        height = _CHECKBOX_SIDE + (len(lines) - 1) * line_pitch
        row_y = self.row(height)

        # The boxes sit level with the *first* line of the question, so a
        # two-line question reads down from its own answer rather than up.
        box_y = row_y + height - _CHECKBOX_SIDE

        label_x, _ = self._column(start, 0.0)
        yes_x, _ = self._column(options_start, 0.0)
        no_x, _ = self._column(options_start + 0.14, 0.0)

        for index, line in enumerate(lines):
            self.labels.append(
                StaticText(
                    self.page,
                    label_x,
                    box_y + 2.0 - index * line_pitch,
                    question_size,
                    line,
                )
            )

        for option_x, caption in ((yes_x, "Yes"), (no_x, "No")):
            caption_x = self._empty_box(option_x, box_y)

            self.labels.append(
                StaticText(
                    self.page, caption_x, box_y + 2.0, question_size, caption
                )
            )

        self.fields.append(
            FieldMapping(
                key=key,
                kind=FieldKind.CHOICE,
                transform="yes_no",
                printed_label=label,
                section=section,
                applies_when=applies_when,
                optional=optional,
                target=OverlayTarget(
                    option_boxes={
                        "yes": Box(
                            page=self.page,
                            x=yes_x,
                            y=box_y,
                            width=_CHECKBOX_SIDE,
                            height=_CHECKBOX_SIDE,
                        ),
                        "no": Box(
                            page=self.page,
                            x=no_x,
                            y=box_y,
                            width=_CHECKBOX_SIDE,
                            height=_CHECKBOX_SIDE,
                        ),
                    },
                    font_size=9.0,
                    mark="X",
                ),
            )
        )

    def yes_no_list(
        self,
        section: str,
        questions: tuple[tuple[str, str], ...],
        *,
        applies_when: Condition | None = None,
        optional: bool = False,
    ) -> None:
        """A run of Yes/No questions, one per row."""
        for key, label in questions:
            self.yes_no(
                key,
                label,
                section,
                applies_when=applies_when,
                optional=optional,
            )

    # -- tables ------------------------------------------------------------

    def table(
        self,
        group: RepeatingGroup,
        section: str,
        columns: tuple[_Column, ...],
        *,
        note: str = "",
        heading: str = "",
    ) -> None:
        """Print a header once and then `group.rows` identical rows.

        Every row is gated on the group's own presence marker, so a household of
        two leaves rows three to six blank *and says why*, rather than reporting
        four imaginary people as work the applicant still owes.
        """
        spans = _spans_for(columns)

        header_block = _LABEL_SIZE + _LABEL_GAP
        row_block = _ROW_HEIGHT + _TABLE_ROW_GAP

        self.section(
            # The printed heading and the review sheet's grouping are two
            # different things. A table inside "Bills you pay" belongs under
            # that section on the review sheet, but printing the words again
            # over the table gave the page the same heading twice in a row.
            heading or section,
            note,
            # Keep the heading with its header row and its first data row.
            first_row_height=_ROW_HEIGHT + row_block,
        )

        self._table_header(group, columns, spans)

        for index in group.indexes():
            if self.y - row_block < _MARGIN_BOTTOM:
                self.new_page()
                # A table that breaks across a page needs its header again;
                # a column of bare boxes on page 4 names nothing.
                self.y -= header_block
                self._table_header(group, columns, spans)

            self.y -= _ROW_HEIGHT
            row_y = self.y
            self.y -= _TABLE_ROW_GAP

            number_x, _ = self._column(0.0, 0.0)
            self.labels.append(
                StaticText(
                    self.page, number_x, row_y + 4.0, _LABEL_SIZE, f"{index + 1}."
                )
            )

            for column, (start, width) in zip(columns, spans):
                self.text_field(
                    row_y,
                    group.key(index, column.suffix),
                    group.label(index, column.review_name),
                    section,
                    start=start,
                    width=width,
                    kind=column.kind,
                    transform=column.transform,
                    applies_when=group.presence(index),
                    optional=column.optional,
                    alternate_keys=tuple(
                        group.key(index, alternate)
                        for alternate in column.alternates
                    ),
                    row=(group.prefix, index),
                    with_label=False,
                )

        self.y -= _ROW_GAP - _TABLE_ROW_GAP

    def _table_header(
        self,
        group: RepeatingGroup,
        columns: tuple[_Column, ...],
        spans: tuple[tuple[float, float], ...],
    ) -> None:
        from benefits_navigator.formmap.textfit import helvetica_width

        header_y = self.y - _LABEL_SIZE

        for column, (start, width) in zip(columns, spans):
            x, box_width = self._column(start, width)

            # A header wider than its own column runs into the next one, and
            # two collided into "Gross this month ($)How often paid" before
            # this measured them. Values are fitted by the renderer; a static
            # label has no box to be fitted inside, so it is fitted here.
            size = _LABEL_SIZE

            while size > 5.0 and helvetica_width(column.header, size) > box_width:
                size -= 0.25

            self.labels.append(
                StaticText(self.page, x, header_y, size, column.header)
            )

        self.y = header_y - _LABEL_GAP

    def _rule(self, x: float, y: float, width: float) -> None:
        """A horizontal rule, drawn with underscores at a measured pitch."""
        from benefits_navigator.formmap.textfit import helvetica_width

        unit = helvetica_width("_", 8.0)
        count = max(1, int(width / unit))

        self.labels.append(
            StaticText(self.page, x, y, 8.0, "_" * count)
        )

    def signature_block(self, section: str) -> None:
        """The signature area, deliberately left for the applicant.

        Present as printed labels only. There is no mapping and no canonical
        key, so no value can ever be placed here — the refusal is structural,
        not a filter that could be bypassed.
        """
        self.section(
            section,
            "Sign and date this yourself. We never fill in a signature, and an "
            "unsigned application cannot be processed.",
        )

        row_y = self.row()
        sign_x, sign_w = self._column(0.0, 0.60)
        date_x, date_w = self._column(0.66, 0.34)

        self.labels.append(
            StaticText(self.page, sign_x, row_y + _ROW_HEIGHT + _LABEL_GAP, _LABEL_SIZE, "Your signature")
        )
        self._rule(sign_x, row_y - 2.0, sign_w)

        self.labels.append(
            StaticText(self.page, date_x, row_y + _ROW_HEIGHT + _LABEL_GAP, _LABEL_SIZE, "Date signed")
        )
        self._rule(date_x, row_y - 2.0, date_w)


def _spans_for(columns: tuple[_Column, ...]) -> tuple[tuple[float, float], ...]:
    """Left edge and width of each table column, as content-width fractions."""
    spans: list[tuple[float, float]] = []
    start = _NUMBER_COLUMN

    for column in columns:
        spans.append((start, column.width))
        start += column.width + _COLUMN_GAP

    if start - _COLUMN_GAP > 1.0001:
        raise ValueError(
            f"table columns overflow the page: {start - _COLUMN_GAP:.3f} of the "
            "content width"
        )

    return tuple(spans)


#: How many characters of note text fit on one line at ``_LABEL_SIZE``.
#:
#: Notes were single-line strings drawn at whatever length they happened to be,
#: which ran the longer ones off the right edge of the page. The renderer wraps
#: *values*; a static label has no box to wrap inside, so it is wrapped here.
_NOTE_WIDTH = 118


def _wrap_note(note: str) -> tuple[str, ...]:
    if not note:
        return ()

    lines: list[str] = []
    current = ""

    for word in note.split():
        candidate = f"{current} {word}".strip()

        if len(candidate) > _NOTE_WIDTH and current:
            lines.append(current)
            current = word
        else:
            current = candidate

    if current:
        lines.append(current)

    return tuple(lines)


# ---------------------------------------------------------------------------
# The form
# ---------------------------------------------------------------------------

_S_PROGRAMS = "What are you applying for?"
_S_ABOUT = "About you"
_S_WHERE = "Where you live"
_S_MAILING = "Where you get your mail"
_S_HOUSEHOLD = "People who live with you"
_S_MONEY = "Money you get"
_S_JOBS = "Jobs"
_S_OTHER_MONEY = "Other money you get"
_S_BILLS = "Bills you pay"
_S_OWN = "Things you own"
_S_EXPEDITED = "If you need food benefits right away"
_S_CIRCUMSTANCES = "Your situation"
_S_HELPER = "Someone helping you apply"
_S_SIGNATURE = "Signature"

# ---------------------------------------------------------------------------
# Printed tables
# ---------------------------------------------------------------------------

#: The household table. Six rows because a worksheet we print ourselves should
#: hold an ordinary household without an attachment; the seventh person and
#: beyond is reported as overflow rather than dropped.
PEOPLE = RepeatingGroup(prefix="household.members", rows=6, row_noun="Person")

JOBS = RepeatingGroup(prefix="income.earned", rows=3, row_noun="Job")

OTHER_INCOME = RepeatingGroup(
    prefix="income.unearned", rows=3, row_noun="Other income"
)

BILLS = RepeatingGroup(prefix="expenses.household", rows=5, row_noun="Bill")

HELPERS = RepeatingGroup(
    prefix="household.authorized_representative", rows=1, row_noun="Helper"
)

_MAIL_ELSEWHERE = Condition(
    key="applicant.mailing_address_same_as_home",
    equals=False,
    because="you get your mail at the address where you live",
)

#: The representative block applies only when there is a representative.
#:
#: Gated on the record's own presence marker rather than on the Yes/No above
#: it, so that answering Yes and then naming nobody leaves the block blank
#: instead of reporting six boxes as missing. The wording still refers to the
#: question the applicant actually answered, because that is what they will
#: remember doing.
_HAS_HELPER = Condition(
    key=HELPERS.presence_key(0),
    equals=True,
    because="you told us nobody else is applying on your behalf",
    unknown_excludes=True,
)


def _build() -> tuple[FormDefinition, tuple[StaticText, ...]]:
    layout = _Layout()

    layout.title(
        "Form H1010 — Texas Works Application for Assistance",
        "Prefilled worksheet prepared by Kealu Benefits Navigator. "
        "Not the official Texas HHSC form. Submit at YourTexasBenefits.com.",
    )

    _programs(layout)
    _about_you(layout)
    _where_you_live(layout)
    _mailing_address(layout)
    _household(layout)
    _money(layout)
    _bills(layout)
    _things_you_own(layout)
    _expedited(layout)
    _circumstances(layout)
    _helper(layout)

    layout.signature_block(_S_SIGNATURE)

    definition = FormDefinition(
        form_id="TX_H1010",
        form_code="H1010",
        title="Texas Works Application for Assistance",
        state="TX",
        document_language="en",
        page_width=PAGE_WIDTH,
        page_height=PAGE_HEIGHT,
        page_count=layout.page_count,
        base_document=None,
        base_document_note=(
            "HHSC does not publish Form H1010 as a retrievable PDF: its own "
            "forms page links to a YourTexasBenefits web application for both "
            "the English and the Spanish edition, and direct file requests to "
            "hhs.texas.gov are refused or return nothing. Rather than guess "
            "where the boxes sit on a document we have not inspected, this "
            "renders a Navigator-authored worksheet whose coordinates we own. "
            "Replace base_document and the boxes once the official PDF is "
            "obtained."
        ),
        source_url=(
            "https://fhb.hhs.texas.gov/forms/1000-1999/"
            "form-h1010-texas-works-application-assistance-your-texas-benefits"
        ),
        fields=tuple(layout.fields),
        static_text=tuple(layout.labels),
        repeating_groups=(PEOPLE, JOBS, OTHER_INCOME, BILLS, HELPERS),
    )

    return definition, tuple(layout.labels)


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------


def _programs(layout: _Layout) -> None:
    layout.section(
        _S_PROGRAMS,
        "Mark every benefit you want to apply for. One form covers all four.",
    )

    row = layout.row()
    layout.checkbox(
        row, "programs.tx_snap", "Food benefits (SNAP)", _S_PROGRAMS, start=0.0
    )
    layout.checkbox(
        row, "programs.tx_medicaid", "Healthcare (Medicaid)", _S_PROGRAMS, start=0.27
    )
    layout.checkbox(
        row, "programs.tx_chip", "Healthcare (CHIP)", _S_PROGRAMS, start=0.54
    )
    layout.checkbox(
        row, "programs.tx_tanf", "Cash help for families (TANF)", _S_PROGRAMS, start=0.78
    )


def _about_you(layout: _Layout) -> None:
    layout.section(_S_ABOUT)

    row = layout.row()
    layout.text_field(
        row, "applicant.first_name", "First name", _S_ABOUT, start=0.0, width=0.30
    )
    layout.text_field(
        row,
        "applicant.middle_name",
        "Middle name",
        _S_ABOUT,
        start=0.32,
        width=0.20,
        optional=True,
    )
    layout.text_field(
        row, "applicant.last_name", "Last name", _S_ABOUT, start=0.54, width=0.46
    )

    row = layout.row()
    layout.text_field(
        row,
        "applicant.date_of_birth",
        "Date of birth (mm/dd/yyyy)",
        _S_ABOUT,
        start=0.0,
        width=0.26,
        kind=FieldKind.DATE,
        transform="us_date",
    )
    layout.text_field(
        row,
        "applicant.other_names",
        "Other names you have used",
        _S_ABOUT,
        start=0.28,
        width=0.72,
        optional=True,
    )

    row = layout.row()
    layout.text_field(
        row,
        "applicant.phone",
        "Home phone",
        _S_ABOUT,
        start=0.0,
        width=0.30,
        transform="us_phone",
    )
    layout.text_field(
        row,
        "applicant.alternate_phone",
        "Other phone",
        _S_ABOUT,
        start=0.32,
        width=0.30,
        transform="us_phone",
        optional=True,
    )
    layout.text_field(
        row,
        "applicant.email",
        "Email address",
        _S_ABOUT,
        start=0.64,
        width=0.36,
        optional=True,
    )

    row = layout.row()
    layout.text_field(
        row,
        "applicant.preferred_language",
        "Language you prefer",
        _S_ABOUT,
        start=0.0,
        width=0.30,
    )
    layout.text_field(
        row,
        "applicant.household.marital_status",
        "Marital status",
        _S_ABOUT,
        start=0.32,
        width=0.30,
        transform="humanize",
    )
    layout.text_field(
        row,
        "applicant.household.sex",
        "Sex",
        _S_ABOUT,
        start=0.64,
        width=0.16,
        transform="humanize",
    )

    layout.yes_no_list(
        _S_ABOUT,
        (
            (
                "applicant.household.citizen_or_national",
                "Are you a U.S. citizen or U.S. national?",
            ),
            (
                "applicant.household.disabled",
                "Do you have a disability?",
            ),
        ),
    )


def _where_you_live(layout: _Layout) -> None:
    layout.section(_S_WHERE)

    layout.keep_together(2)

    row = layout.row()
    layout.text_field(
        row,
        "applicant.home_address.street",
        "Street address",
        _S_WHERE,
        start=0.0,
        width=0.74,
    )
    layout.text_field(
        row,
        "applicant.home_address.apartment",
        "Apt or unit",
        _S_WHERE,
        start=0.76,
        width=0.24,
        optional=True,
    )

    row = layout.row()
    layout.text_field(
        row, "applicant.home_address.city", "City", _S_WHERE, start=0.0, width=0.34
    )
    layout.text_field(
        row, "applicant.home_address.county", "County", _S_WHERE, start=0.36, width=0.30
    )
    layout.text_field(
        row,
        "applicant.home_address.state",
        "State",
        _S_WHERE,
        start=0.68,
        width=0.10,
        transform="state_code",
    )
    layout.text_field(
        row,
        "applicant.home_address.zip_code",
        "ZIP code",
        _S_WHERE,
        start=0.80,
        width=0.20,
        transform="zip5",
    )

    layout.yes_no_list(
        _S_WHERE,
        (
            ("household.homeless", "Is anyone in your home homeless?"),
            (
                "household.institutional_living",
                "Does anyone live in a shelter, group home, or institution?",
            ),
        ),
    )


def _mailing_address(layout: _Layout) -> None:
    layout.section(
        _S_MAILING,
        "Answer the first question. Fill in an address below only if you "
        "answered No.",
        # The whole block, or none of it. Split across a page break, the
        # address arrived at the top of the next page with its heading and its
        # gateway question left behind — four rules under "Mailing street
        # address" and nothing saying whose address it was.
        reserve_rows=3,
    )

    layout.yes_no(
        "applicant.mailing_address_same_as_home",
        "Do you get your mail at the address above?",
        _S_MAILING,
    )

    layout.keep_together(2)

    row = layout.row()
    layout.text_field(
        row,
        "applicant.mailing_address.street",
        "Mailing street address",
        _S_MAILING,
        start=0.0,
        width=0.74,
        applies_when=_MAIL_ELSEWHERE,
    )
    layout.text_field(
        row,
        "applicant.mailing_address.apartment",
        "Apt or unit",
        _S_MAILING,
        start=0.76,
        width=0.24,
        applies_when=_MAIL_ELSEWHERE,
        optional=True,
    )

    row = layout.row()
    layout.text_field(
        row,
        "applicant.mailing_address.city",
        "City",
        _S_MAILING,
        start=0.0,
        width=0.34,
        applies_when=_MAIL_ELSEWHERE,
    )
    layout.text_field(
        row,
        "applicant.mailing_address.county",
        "County",
        _S_MAILING,
        start=0.36,
        width=0.30,
        applies_when=_MAIL_ELSEWHERE,
        optional=True,
    )
    layout.text_field(
        row,
        "applicant.mailing_address.state",
        "State",
        _S_MAILING,
        start=0.68,
        width=0.10,
        transform="state_code",
        applies_when=_MAIL_ELSEWHERE,
    )
    layout.text_field(
        row,
        "applicant.mailing_address.zip_code",
        "ZIP code",
        _S_MAILING,
        start=0.80,
        width=0.20,
        transform="zip5",
        applies_when=_MAIL_ELSEWHERE,
    )


def _household(layout: _Layout) -> None:
    layout.section(
        _S_HOUSEHOLD,
        "Count everyone who lives with you, including yourself.",
    )

    row = layout.row()
    layout.text_field(
        row,
        "household.size",
        "How many people live in your home?",
        _S_HOUSEHOLD,
        start=0.0,
        width=0.30,
        transform="integer",
    )
    layout.text_field(
        row,
        "household.adult_rows.count",
        "Adults",
        _S_HOUSEHOLD,
        start=0.32,
        width=0.14,
        transform="integer",
    )
    layout.text_field(
        row,
        "household.child_rows.count",
        "Children",
        _S_HOUSEHOLD,
        start=0.48,
        width=0.14,
        transform="integer",
    )

    layout.yes_no_list(
        _S_HOUSEHOLD,
        (
            (
                "household.buys_and_prepares_food_together",
                "Do you buy and prepare food together?",
            ),
            ("household.anyone_pregnant", "Is anyone in your home pregnant?"),
            ("household.students", "Is anyone in your home a student?"),
        ),
    )

    layout.table(
        PEOPLE,
        _S_HOUSEHOLD,
        (
            _Column("first_name", "First name", 0.16),
            _Column("last_name", "Last name", 0.18),
            _Column(
                "relationship_to_applicant",
                "How they are related to you",
                0.18,
                # The canonical value is the enumeration the roster's select
                # writes — `spouse`, `grandchild`. Printed as stored it puts a
                # lowercase database value in a box on a government form, which
                # is what `humanize` exists to stop.
                transform="humanize",
            ),
            _Column(
                "date_of_birth",
                "Date of birth",
                0.14,
                kind=FieldKind.DATE,
                transform="us_date",
            ),
            _Column(
                "adult.sex",
                "Sex",
                0.08,
                transform="humanize",
                alternates=("child.sex",),
                optional=True,
            ),
            _Column(
                "adult.citizen_or_national",
                "U.S. citizen?",
                0.14,
                transform="yes_no_text",
                alternates=("child.citizen_or_national",),
            ),
        ),
        heading="Everyone else in your home",
        note=(
            "Everyone who lives with you, apart from yourself. Your own details "
            "are in “About you” above."
        ),
    )


def _money(layout: _Layout) -> None:
    layout.section(
        _S_MONEY,
        "Report income before taxes. HHSC will ask for proof after you apply.",
    )

    row = layout.row()
    layout.text_field(
        row,
        "household.annual_income",
        "Total yearly household income ($)",
        _S_MONEY,
        start=0.0,
        width=0.32,
        transform="currency_whole",
    )
    layout.text_field(
        row,
        "household.income_type",
        "Kind of income",
        _S_MONEY,
        start=0.34,
        width=0.66,
    )

    layout.yes_no_list(
        _S_MONEY,
        (
            ("income.has_earned_income", "Does anyone in your home have a job?"),
            (
                "income.has_self_employment",
                "Is anyone self-employed or running a business?",
            ),
            (
                "income.has_unearned_income",
                "Does anyone get money from anywhere else (child support, "
                "unemployment, Social Security, retirement)?",
            ),
            (
                "income.varies_during_year",
                "Does anyone's income change during the year?",
            ),
        ),
    )

    layout.table(
        JOBS,
        _S_JOBS,
        (
            _Column("person_name", "Who works there", 0.17),
            _Column("employer_name", "Employer", 0.19),
            _Column("employer_address", "Employer address", 0.20),
            _Column(
                "gross_received_this_month",
                "This month ($)",
                0.12,
                transform="currency_whole",
                full_name="Gross pay this month ($)",
            ),
            _Column(
                "pay_frequency", "How often paid", 0.13, transform="humanize"
            ),
            _Column(
                "hours_per_week",
                "Hours",
                0.07,
                transform="integer",
                full_name="Hours a week",
            ),
        ),
        note=(
            "One line for each job anyone in your home has. HHSC verifies pay "
            "with the employer, so give the address if you know it."
        ),
    )

    layout.table(
        OTHER_INCOME,
        _S_OTHER_MONEY,
        (
            _Column("person_name", "Who gets it", 0.22),
            _Column("source", "Where it comes from", 0.30, transform="humanize"),
            _Column(
                "reported_amount",
                "How much ($)",
                0.16,
                transform="currency_whole",
            ),
            _Column(
                "reported_frequency", "How often", 0.19, transform="humanize"
            ),
        ),
        note=(
            "Child support, unemployment, Social Security, retirement, "
            "veterans' benefits, or any other money that is not from a job."
        ),
    )


def _bills(layout: _Layout) -> None:
    layout.section(
        _S_BILLS,
        "Rent, mortgage and utility costs can raise your food benefits, so "
        "report them even if you are behind on them.",
    )

    layout.yes_no_list(
        _S_BILLS,
        (
            (
                "expenses.has_household_expenses",
                "Do you pay rent, a mortgage, or utility bills?",
            ),
            (
                "expenses.has_dependent_care",
                "Do you pay for child care or adult care so someone can work "
                "or go to school?",
            ),
            (
                "expenses.pays_child_support",
                "Does anyone pay child support to someone outside your home?",
            ),
            (
                "expenses.has_medical_expenses",
                "Does anyone 60 or older, or with a disability, have medical "
                "costs?",
            ),
        ),
    )

    layout.table(
        BILLS,
        _S_BILLS,
        (
            _Column("kind", "Kind of bill", 0.30, transform="humanize"),
            _Column("description", "Details", 0.38, optional=True),
            _Column(
                "amount_monthly",
                "Cost each month ($)",
                0.25,
                transform="currency_whole",
            ),
        ),
        heading="What you pay each month",
        note="Housing and utility costs you pay each month.",
    )


def _things_you_own(layout: _Layout) -> None:
    layout.section(
        _S_OWN,
        "Texas does not count most savings for food benefits, but the state "
        "asks. HHSC will tell you if anything here needs proof.",
    )

    layout.yes_no_list(
        _S_OWN,
        (
            (
                "resources.has_accounts",
                "Does anyone have a bank account, cash, or savings?",
            ),
            ("resources.has_vehicles", "Does anyone own a car or truck?"),
            (
                "resources.has_real_property",
                "Does anyone own a home, land, or other property?",
            ),
            (
                "resources.has_personal_property",
                "Does anyone own anything else of value?",
            ),
        ),
    )


def _expedited(layout: _Layout) -> None:
    layout.section(
        _S_EXPEDITED,
        "Texas screens every food-benefit application for expedited service, "
        "which can mean benefits within a few days. The first three questions "
        "are the federal test; the rest are urgent needs your caseworker "
        "should know about.",
    )

    layout.yes_no_list(
        _S_EXPEDITED,
        (
            (
                "household.expedited."
                "gross_income_under_150_and_resources_under_100",
                "Is your monthly income under $150 and your cash on hand $100 "
                "or less?",
            ),
            (
                "household.expedited.income_and_resources_less_than_housing_costs",
                "Are your income and cash together less than your rent and "
                "utilities this month?",
            ),
            (
                "household.expedited.migrant_or_seasonal_farm_worker",
                "Is anyone a migrant or seasonal farm worker?",
            ),
        ),
    )

    layout.yes_no_list(
        _S_EXPEDITED,
        (
            (
                "household.expedited.food_runs_out_within_three_days",
                "Will your food run out in the next three days?",
            ),
            (
                "household.expedited.eviction_notice",
                "Have you been given an eviction notice?",
            ),
            (
                "household.expedited.utilities_shut_off_or_notice",
                "Have your utilities been shut off, or been threatened with "
                "shut-off?",
            ),
            (
                "household.expedited.needs_essential_clothing",
                "Does anyone need essential clothing?",
            ),
            (
                "household.expedited.needs_transportation_for_emergency_needs",
                "Does anyone need transportation to meet an emergency need?",
            ),
        ),
        optional=True,
    )


def _circumstances(layout: _Layout) -> None:
    layout.section(_S_CIRCUMSTANCES)

    layout.yes_no_list(
        _S_CIRCUMSTANCES,
        (
            (
                "household.military_service",
                "Has anyone in your home served in the military?",
            ),
            (
                "household.disability_limits_activities",
                "Does a disability limit anyone's daily activities?",
            ),
            (
                "household.ever_in_foster_care",
                "Was anyone in your home ever in foster care?",
            ),
            (
                "household.prior_public_assistance",
                "Has anyone in your home received benefits before?",
            ),
        ),
    )

    row = layout.row(_ROW_HEIGHT * 2)
    layout.text_field(
        row,
        "household.existing_benefits",
        "Benefits anyone already gets",
        _S_CIRCUMSTANCES,
        start=0.0,
        width=1.0,
        kind=FieldKind.MULTILINE,
        height=_ROW_HEIGHT * 2,
        multiline=True,
        optional=True,
    )


def _helper(layout: _Layout) -> None:
    layout.section(
        _S_HELPER,
        "An authorized representative can apply, be interviewed, and receive "
        "notices for you. They must sign the official form themselves.",
    )

    layout.yes_no(
        "household.authorized_representative",
        "Is someone applying on your behalf?",
        _S_HELPER,
    )

    layout.keep_together(2)

    row = layout.row()
    layout.text_field(
        row,
        HELPERS.key(0, "name"),
        "Their name",
        _S_HELPER,
        start=0.0,
        width=0.48,
        applies_when=_HAS_HELPER,
        row=(HELPERS.prefix, 0),
    )
    layout.text_field(
        row,
        HELPERS.key(0, "organization"),
        "Organization",
        _S_HELPER,
        start=0.50,
        width=0.30,
        applies_when=_HAS_HELPER,
        optional=True,
        row=(HELPERS.prefix, 0),
    )
    layout.text_field(
        row,
        HELPERS.key(0, "phone"),
        "Phone",
        _S_HELPER,
        start=0.82,
        width=0.18,
        transform="us_phone",
        applies_when=_HAS_HELPER,
        row=(HELPERS.prefix, 0),
    )

    row = layout.row()
    layout.text_field(
        row,
        HELPERS.key(0, "address.street"),
        "Street address",
        _S_HELPER,
        start=0.0,
        width=0.50,
        applies_when=_HAS_HELPER,
        row=(HELPERS.prefix, 0),
    )
    layout.text_field(
        row,
        HELPERS.key(0, "address.city"),
        "City",
        _S_HELPER,
        start=0.52,
        width=0.24,
        applies_when=_HAS_HELPER,
        row=(HELPERS.prefix, 0),
    )
    layout.text_field(
        row,
        HELPERS.key(0, "address.state"),
        "State",
        _S_HELPER,
        start=0.78,
        width=0.08,
        transform="state_code",
        applies_when=_HAS_HELPER,
        row=(HELPERS.prefix, 0),
    )
    layout.text_field(
        row,
        HELPERS.key(0, "address.zip_code"),
        "ZIP code",
        _S_HELPER,
        start=0.88,
        width=0.12,
        transform="zip5",
        applies_when=_HAS_HELPER,
        row=(HELPERS.prefix, 0),
    )


H1010_DEFINITION, H1010_STATIC_TEXT = _build()
