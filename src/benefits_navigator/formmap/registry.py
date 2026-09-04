#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Form id → definition. The one place that knows which forms exist.

The point of this module is what it lets callers *stop* doing. Selecting a form
is now::

    definition = definition_for_form(form_id)

rather than::

    if state == "CA":
        ...
    elif state == "TX":
        ...

The form id already travels through the TypeScript side as
``SupportedApplicationForm`` (``CA_SAWS_2_PLUS``, ``TX_H1010``) and is chosen
there from the household's resolved jurisdiction. So by the time this layer is
reached the jurisdiction decision has already been made once, in the place that
owns it, and nothing here re-derives it.

Definitions are built lazily and cached. ``CA_SAWS_2_PLUS`` reads the SAWS
adapter, which imports pypdf and a 5,000-line module; a caller listing form ids
should not pay for that.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

from benefits_navigator.formmap.definition import FormDefinition


@dataclass(frozen=True)
class _Entry:
    """How to build one form, and the state it serves.

    The state is repeated here — the definition declares it too — for one
    reason: :func:`form_id_for_state` must answer without building anything.
    Building ``CA_SAWS_2_PLUS`` imports the California generator and pypdf, so
    asking "which form does a Texas household file?" pulled a 5,000-line
    California module and a PDF library into a code path that draws its own
    pages and needs neither.

    A repeated fact is a fact that can disagree with itself, so
    ``test_formmap_jurisdiction_isolation`` asserts the two always match.
    """

    state: str
    load: Callable[[], FormDefinition]


def _load_h1010() -> FormDefinition:
    from benefits_navigator.formmap.forms.h1010 import H1010_DEFINITION

    return H1010_DEFINITION


def _load_saws2_plus() -> FormDefinition:
    from benefits_navigator.formmap.forms.saws2_plus import SAWS2_PLUS_DEFINITION

    return SAWS2_PLUS_DEFINITION


#: Every form this layer can map, by id.
#:
#: Adding a form is adding an entry here and a module under ``forms/``. Nothing
#: else in the codebase needs to change for the mapping and rendering pipeline
#: to accept it.
_FORMS: dict[str, _Entry] = {
    "TX_H1010": _Entry(state="TX", load=_load_h1010),
    "CA_SAWS_2_PLUS": _Entry(state="CA", load=_load_saws2_plus),
}


class UnknownForm(KeyError):
    """A form id no definition exists for."""


@lru_cache(maxsize=None)
def definition_for_form(form_id: str) -> FormDefinition:
    """The definition for `form_id`.

    Raises :class:`UnknownForm` rather than returning None: a caller that has
    reached this point already believes the form exists, and a silent None
    becomes a blank PDF several frames later.
    """
    try:
        entry = _FORMS[form_id]
    except KeyError:
        raise UnknownForm(
            f"no form definition for {form_id!r}; known forms: "
            + ", ".join(sorted(_FORMS))
        ) from None

    return entry.load()


def form_id_for_state(state: str) -> str | None:
    """The form a household in `state` files, or None if we describe none.

    The state-to-form question asked once, in the place that already knows
    which forms exist. The TypeScript side answers it too
    (``applicationForState``), and the two agree because both read a declared
    state code rather than a branch — but a Python caller reached from the draft
    helper has only the household's state in hand, and should not have to be
    told the form id in order to look one up.

    Answers without building anything. See :class:`_Entry`.
    """
    wanted = state.strip().upper()

    if not wanted:
        return None

    for form_id, entry in sorted(_FORMS.items()):
        if entry.state == wanted:
            return form_id

    return None


def declared_state_for(form_id: str) -> str:
    """The state the registry records for `form_id`, without building it."""
    try:
        return _FORMS[form_id].state
    except KeyError:
        raise UnknownForm(f"no form definition for {form_id!r}") from None


def known_form_ids() -> tuple[str, ...]:
    """Every mappable form id. Cheap — does not build the definitions."""
    return tuple(sorted(_FORMS))


def definitions() -> tuple[FormDefinition, ...]:
    """Every definition, built. For registry-wide tests."""
    return tuple(definition_for_form(form_id) for form_id in known_form_ids())
