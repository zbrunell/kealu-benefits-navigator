#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Turning a canonical value into the string a particular form wants.

The canonical layer stores a date of birth as ``"1990-01-01"`` because that is
unambiguous and sorts. A US benefits form prints ``01/01/1990``. Somewhere that
conversion has to happen, and the only place it must *not* happen is inside the
renderer — a renderer that formats dates has to know which form it is drawing,
which is the state-specific branch this layer exists to remove.

So transforms are named, registered, and referenced by name from a form
definition. ``H1010_FIELDS`` says ``transform="us_date"`` and that is the whole
of H1010's date knowledge. Another form that prints ``1990-01-01`` says
``transform="iso_date"`` and no code changes.

── Why names and not callables ────────────────────────────────────────────
A definition could hold a lambda. Names are used instead because a definition
is data we want to be able to inspect, diff, and eventually serialize: a test
can assert that the applicant's DOB uses ``us_date`` without invoking anything,
and a review of a definition file shows what will happen to each value without
having to read code.

── Localization ───────────────────────────────────────────────────────────
Nothing here reads a UI locale. A form is printed in the language the agency
publishes it in, and a Spanish-speaking applicant filing an English form still
needs ``01/01/1990`` in the box because that is what the English form's printed
label asks for. The UI locale and the document language are separate values and
are kept separate — see ``form_templates.FormTemplate.document_language``. A
form whose *printed* convention differs gets its own named transform.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any

#: A transform takes the canonical value and returns what to render.
Transform = Callable[[Any], str]

_REGISTRY: dict[str, Transform] = {}


def register(name: str) -> Callable[[Transform], Transform]:
    """Register a named transform. Duplicate names are a programming error."""

    def decorate(function: Transform) -> Transform:
        if name in _REGISTRY:
            raise ValueError(f"transform already registered: {name}")

        _REGISTRY[name] = function

        return function

    return decorate


def transform_for(name: str | None) -> Transform:
    """Look a transform up by name. ``None`` means :func:`plain`."""
    if name is None:
        return plain

    try:
        return _REGISTRY[name]
    except KeyError:
        raise KeyError(
            f"unknown transform {name!r}; registered: "
            + ", ".join(sorted(_REGISTRY))
        ) from None


def registered_transforms() -> tuple[str, ...]:
    """Every registered name, for tests and diagnostics."""
    return tuple(sorted(_REGISTRY))


# ---------------------------------------------------------------------------
# The transforms
# ---------------------------------------------------------------------------


@register("plain")
def plain(value: Any) -> str:
    """The value as a trimmed string. Booleans and None become empty.

    A bool reaching a *text* field means the definition has the wrong kind, and
    rendering "True" into a printed box would be worse than rendering nothing —
    so it renders nothing and the mapping test catches the mismatch.
    """
    if value is None or isinstance(value, bool):
        return ""

    return str(value).strip()


@register("upper")
def upper(value: Any) -> str:
    return plain(value).upper()


@register("us_date")
def us_date(value: Any) -> str:
    """``1990-01-01`` → ``01/01/1990``.

    An unparseable value passes through unchanged rather than being dropped: a
    date the applicant typed in some other form is still their answer, and
    silently discarding it would leave a box blank with no explanation. The
    review sheet is where a malformed value gets flagged.
    """
    text = plain(value)

    if not text:
        return ""

    try:
        return datetime.strptime(text, "%Y-%m-%d").strftime("%m/%d/%Y")
    except ValueError:
        return text


@register("iso_date")
def iso_date(value: Any) -> str:
    """Canonical ISO form, for a document that prints dates that way."""
    return plain(value)


@register("us_phone")
def us_phone(value: Any) -> str:
    """Ten digits → ``(512) 555-1234``. Anything else passes through.

    Formatted rather than stored formatted, because the canonical layer keeps
    the digits and different forms print them differently — some want the
    parentheses, some want three separate boxes.
    """
    digits = re.sub(r"\D", "", plain(value))

    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]

    if len(digits) != 10:
        return plain(value)

    return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"


@register("digits")
def digits(value: Any) -> str:
    """Only the digits, for a grid or a strict numeric box."""
    return re.sub(r"\D", "", plain(value))


@register("zip5")
def zip5(value: Any) -> str:
    """The five-digit ZIP, dropping any +4.

    A ZIP+4 written into a five-cell printed grid overflows into the next
    printed element, so a form whose box is five wide gets five.
    """
    found = digits(value)

    return found[:5]


@register("state_code")
def state_code(value: Any) -> str:
    """Two-letter uppercase state code."""
    return plain(value).upper()[:2]


@register("yes_no")
def yes_no(value: Any) -> str:
    """A boolean as the option key a CHOICE target selects by.

    Returns ``"yes"``, ``"no"``, or ``""`` for unknown — and unknown is a real
    third state here. This project does not answer a question on a government
    form that the applicant did not answer, so an absent boolean must select
    *neither* printed box rather than defaulting to "no".
    """
    if value is True:
        return "yes"

    if value is False:
        return "no"

    return ""


@register("integer")
def integer(value: Any) -> str:
    """A whole number, for a household count or similar."""
    if isinstance(value, bool) or value is None:
        return ""

    if isinstance(value, int):
        return str(value)

    text = plain(value)

    try:
        return str(int(float(text)))
    except ValueError:
        return text


@register("currency_whole")
def currency_whole(value: Any) -> str:
    """A dollar amount to the whole dollar, without a symbol.

    No symbol because printed forms put the ``$`` on the page, and rendering a
    second one produces ``$$1,200``.
    """
    if isinstance(value, bool) or value is None:
        return ""

    text = plain(value).replace("$", "").replace(",", "")

    if not text:
        return ""

    try:
        return f"{round(float(text)):,}"
    except ValueError:
        return plain(value)


@register("humanize")
def humanize(value: Any) -> str:
    """``rent_or_mortgage`` → ``Rent or mortgage``.

    The canonical layer stores small enumerations as snake_case identifiers,
    which is right for a value that has to compare and serialize. A printed form
    is read by a county worker, and "rent_or_mortgage" in a box on a signed
    application looks like a leaked database value — because it is one.

    Leaves anything that is not an identifier alone: a description the applicant
    typed is already prose, and title-casing it would rewrite their words.
    """
    text = plain(value)

    if not text or " " in text:
        return text

    if not re.fullmatch(r"[a-z0-9]+(?:_[a-z0-9]+)*", text):
        return text

    words = text.split("_")

    return " ".join([words[0].capitalize(), *words[1:]])


@register("yes_no_text")
def yes_no_text(value: Any) -> str:
    """A boolean as the word a printed *text* box wants: ``Yes`` or ``No``.

    Distinct from :func:`yes_no`, which returns the lowercase option key a
    CHOICE target selects a box by. The two look interchangeable and are not:
    ``yes_no`` on a text field printed the literal string "yes" into a column of
    a household table, which is what a database says and not what a form says.

    Unknown stays empty. A column with no answer is left for the applicant, not
    filled in with a guess.
    """
    if value is True:
        return "Yes"

    if value is False:
        return "No"

    return ""
