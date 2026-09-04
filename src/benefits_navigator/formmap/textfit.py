#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Will this value actually be readable in that box?

Shared by every form the mapping layer renders, native-field or overlay, for a
reason that is the same in both cases: a value too wide for its box is not
reported by any PDF API. It simply renders clipped, so a name becomes "Maria
Guadalupe Fernandez de la C" on a document the applicant signs, and nothing
anywhere says so.

An overlay makes that worse, not better. Writing into a native AcroForm field
at least clips at the widget border; text drawn at an absolute coordinate runs
straight over the printed label beside it. So the overlay renderer measures
before it draws, shrinks to fit, and reports what still will not fit rather
than rendering something illegible and calling the field filled.

These metrics and the fitting logic were previously private to
``pdf_generator``, where the SAWS 2 PLUS path used them. They moved here
unchanged — ``pdf_generator`` imports them back under its old private names —
so the two renderers cannot disagree about whether a value fits.
"""

from __future__ import annotations

import math

#: Widths of the Helvetica glyphs, in 1/1000 em, for printable ASCII.
#:
#: From the Adobe Core 14 AFM metrics. Needed because the form declares a fixed
#: point size per field and several of its boxes are too narrow for the value
#: that belongs in them — the Q6 "DATE OF BIRTH" column is 47.9pt wide with
#: "/Helv 10 Tf" set, and "01/01/1990" needs 50.0pt at that size, so the year
#: was being cut in half on a form the applicant signs.
HELVETICA_WIDTHS: tuple[int, ...] = (
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333,  # 32-45
    278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278,  # 46-59
    584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,  # 60-73
    500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,  # 74-87
    667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556,  # 88-101
    278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,  # 102-115
    278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,                 # 116-126
)

#: Points of horizontal inset an AcroForm text field keeps inside its border.
FIELD_PADDING = 2.0

#: Points of vertical inset, top and bottom.
FIELD_PADDING_Y = 1.5

#: Line spacing as a multiple of the font size, for wrapped multiline fields.
LINE_HEIGHT = 1.15

#: The smallest size still legible in print, and the floor for shrinking.
#:
#: A county worker reads this on paper, often photocopied. Below about six
#: points that stops being reliable, so the fitter refuses to go further and
#: reports the value as not fitting instead of rendering something unreadable
#: and calling it filled.
MIN_FONT_SIZE = 6.0


def helvetica_width(text: str, size: float) -> float:
    """Rendered width of `text` in Helvetica at `size` points."""
    total = 0

    for character in text:
        code = ord(character)
        # Anything outside printable ASCII falls back to the digit width, which
        # is Helvetica's most common advance.
        total += (
            HELVETICA_WIDTHS[code - 32]
            if 32 <= code <= 126
            else 556
        )

    return total / 1000 * size


def wrap_to_width(text: str, size: float, usable: float) -> list[str]:
    """Break `text` into lines that each fit `usable` points at `size`.

    Wraps on spaces like a PDF viewer does, and falls back to breaking inside a
    word only when a single word is itself wider than the box — a 40-character
    street name in a narrow column has to break somewhere, and breaking it is
    better than letting it run past the border.
    """
    lines: list[str] = []

    for paragraph in text.split("\n"):
        current = ""

        for word in paragraph.split():
            candidate = f"{current} {word}".strip()

            if helvetica_width(candidate, size) <= usable:
                current = candidate
                continue

            if current:
                lines.append(current)
                current = ""

            # A word too wide for the box on its own.
            while helvetica_width(word, size) > usable and len(word) > 1:
                cut = len(word)

                while cut > 1 and helvetica_width(word[:cut], size) > usable:
                    cut -= 1

                lines.append(word[:cut])
                word = word[cut:]

            current = word

        lines.append(current)

    return lines


def fits(text: str, size: float, width: float, height: float, multiline: bool) -> bool:
    """Whether `text` renders inside a box of this size at this font size."""
    usable_width = width - FIELD_PADDING * 2
    usable_height = height - FIELD_PADDING_Y * 2

    if usable_width <= 0 or usable_height <= 0:
        return False

    if not multiline:
        return (
            helvetica_width(text, size) <= usable_width
            and size <= usable_height
        )

    lines = wrap_to_width(text, size, usable_width)

    return len(lines) * size * LINE_HEIGHT <= usable_height


def largest_size_that_fits(
    text: str,
    declared: float,
    width: float,
    height: float,
    multiline: bool,
) -> float | None:
    """The biggest size up to `declared` at which the whole value fits.

    Returns None when even `MIN_FONT_SIZE` overflows, which is the caller's
    signal to report the value rather than render it illegibly. Searched in
    hundredth-point steps downward from the declared size so the result is the
    largest that fits rather than merely one that does.
    """
    if fits(text, declared, width, height, multiline):
        return declared

    size = declared

    while size > MIN_FONT_SIZE:
        size = max(MIN_FONT_SIZE, math.floor((size - 0.05) * 100) / 100)

        if fits(text, size, width, height, multiline):
            return size

    return None
