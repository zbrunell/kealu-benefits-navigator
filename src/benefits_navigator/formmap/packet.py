#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Which documents belong in a household's application packet, and why.

The question this layer answers is::

    given this household, its selected programs and its known circumstances,
    which documents belong in its packet?

and the thing it must never do is answer "all of them". A form being in the
catalog means the agency publishes it. It does not mean this household needs it,
and handing someone a pregnancy verification form because pregnancy appears
somewhere in their intake is how a packet becomes noise.

── Applicability is not requirement ───────────────────────────────────────
These are different questions and conflating them produces confident wrong
advice:

*Applicability* asks whether the form has anything to do with this household.
*Requirement* asks whether HHSC will refuse the application without it.

A household with self-employment income makes H1049 **applicable**. It does not
make H1049 **required** — HHSC's own instruction on that form says the applicant
"may attach a copy of the latest income tax forms in place of this form", so
whether it is needed depends on records we have not seen. Reporting that as
REQUIRED would be telling an applicant to do work they may not have to do, on
our authority rather than the agency's.

So :class:`Requirement` has four values and the middle one carries the weight:

:attr:`Requirement.REQUIRED`
    HHSC's published instruction says this household files this form. Only
    used where the guidance is unambiguous.

:attr:`Requirement.NEEDS_CONFIRMATION`
    Applicable, and whether it is required turns on something we do not know —
    what records the household already has, what the caseworker asks for. The
    applicant is told what the form is for and what decides it, not told to
    fill it in.

:attr:`Requirement.OPTIONAL`
    Applicable and genuinely the applicant's choice.

:attr:`Requirement.NOT_APPLICABLE`
    Nothing about this household engages the form. Never silently included.

── Every decision carries its reason ──────────────────────────────────────
:class:`Applicability` holds the canonical keys that were consulted and a
citation for the guidance the rule came from. Two things fall out of that: a
test can assert that a planned form has an explainable reason rather than
merely a truthy rule, and a counselor reading the packet can see *why* a form
is in it and disagree with us if we are wrong.

── What is deliberately not here ──────────────────────────────────────────
Language. The planner decides which forms; the resolver in
:mod:`benefits_navigator.formmap.documents` decides which official edition of
each. Keeping them apart is what lets one packet hold a Spanish H1010 and an
English H1028-MBIC without either decision reaching into the other.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field as dataclass_field
from enum import Enum
from typing import Any


class FormCategory(str, Enum):
    """What role a document plays in a packet.

    Distinguished because they are handled differently by the applicant, and a
    checklist that mixes them tells someone to sign a form their doctor has to
    complete.
    """

    #: The application itself.
    MAIN_APPLICATION = "main_application"

    #: An addendum to the main application, filed with it.
    SUPPLEMENTAL_APPLICATION = "supplemental_application"

    #: Evidence the applicant writes and signs themselves.
    APPLICANT_VERIFICATION = "applicant_verification"

    #: Evidence someone else must complete — an employer, a clinician.
    THIRD_PARTY_VERIFICATION = "third_party_verification"

    #: A release or consent, signed by the applicant to let the agency ask
    #: someone else for information.
    AUTHORIZATION_RELEASE = "authorization_release"

    #: Useful, not part of the filing.
    OPTIONAL_SUPPORTING = "optional_supporting"


class Requirement(str, Enum):
    """How strongly this household needs this form. See the module docstring."""

    REQUIRED = "required"
    NEEDS_CONFIRMATION = "needs_confirmation"
    OPTIONAL = "optional"
    NOT_APPLICABLE = "not_applicable"

    @property
    def belongs_in_packet(self) -> bool:
        return self is not Requirement.NOT_APPLICABLE


@dataclass(frozen=True)
class Applicability:
    """Whether a form belongs in one household's packet, and on what grounds."""

    requirement: Requirement

    #: Message key for the applicant-facing explanation.
    #:
    #: A key rather than a sentence because the applicant reads it in their own
    #: language. The *document* may be English-only; the explanation never is.
    reason_key: str

    #: The canonical keys this decision read.
    #:
    #: Recorded so a test can assert a decision is grounded in intake data
    #: rather than in a constant, and so an audit can replay it.
    evidence: tuple[str, ...] = ()

    #: Where the rule comes from, in the agency's own words. For review.
    #:
    #: Not shown to applicants — it exists so that someone checking whether we
    #: have encoded HHSC policy correctly can find the source without digging
    #: through commit history.
    citation: str = ""

    @property
    def belongs_in_packet(self) -> bool:
        return self.requirement.belongs_in_packet


def not_applicable(reason_key: str, *, evidence: tuple[str, ...] = ()) -> Applicability:
    """The common case, spelled once."""
    return Applicability(
        requirement=Requirement.NOT_APPLICABLE,
        reason_key=reason_key,
        evidence=evidence,
    )


@dataclass(frozen=True)
class PacketContext:
    """What the planner is allowed to decide from.

    Deliberately narrow. The planner sees the selected programs and the
    canonical answers, and nothing else — no locale, no UI state, no request.
    That is what makes :func:`plan_packet` deterministic and testable, and what
    stops language leaking into a decision it has no business in.
    """

    #: Two-letter state code the household is applying in.
    state: str

    #: Program ids the household selected, e.g. ``{"tx_snap", "tx_medicaid"}``.
    selected_programs: frozenset[str]

    #: The canonical field values, as the mapping layer consumes them.
    values: Mapping[str, Any] = dataclass_field(default_factory=dict)

    def answered_yes(self, key: str) -> bool:
        """Whether `key` is an explicit yes.

        Explicitly not truthiness. ``False`` is an answer — "no, nobody here is
        self-employed" — and ``None`` is the absence of one, and a planner that
        treats them alike will quietly promote "we never asked" into "no". This
        is the same three-state rule the intake and the mapping layer keep, for
        the same reason.
        """
        value = self.values.get(key)

        if isinstance(value, bool):
            return value

        if isinstance(value, str):
            return value.strip().casefold() in {"yes", "true", "y"}

        return False

    def was_asked(self, key: str) -> bool:
        """Whether `key` has any answer at all, including an explicit no."""
        value = self.values.get(key)

        if value is None:
            return False

        if isinstance(value, str):
            return value.strip() != ""

        return True

    def any_program(self, programs: frozenset[str]) -> bool:
        return bool(self.selected_programs & programs)


@dataclass(frozen=True)
class CatalogEntry:
    """One form the catalog knows about, and the rule for when it applies."""

    #: Matches the form id in :mod:`benefits_navigator.formmap.registry` when
    #: the form is mapped; a catalog-only entry may name a form we cannot fill.
    form_id: str

    #: The agency's own designation, e.g. ``"H1049"``. Never translated.
    form_code: str

    #: The agency's own title, in the document's language.
    title: str

    state: str

    category: FormCategory

    #: Programs the form serves. Empty means "not program-specific".
    programs: frozenset[str] = frozenset()

    #: The rule. Given a household, says whether this form belongs and why.
    applies: Callable[[PacketContext], Applicability] = dataclass_field(
        default=lambda context: not_applicable("form_not_applicable_default")
    )

    #: Whether we hold a document good enough to fill and hand over.
    #:
    #: False keeps the form in the catalog — so a packet can still tell an
    #: applicant the form exists and that they may be asked for it — while
    #: keeping it out of the "here is your prefilled paperwork" path. See
    #: :attr:`unavailable_reason_key`.
    fillable: bool = True

    #: Message key explaining why a non-fillable entry cannot be prepared.
    unavailable_reason_key: str | None = None


@dataclass(frozen=True)
class PlannedForm:
    """One form, decided for one household."""

    entry: CatalogEntry
    applicability: Applicability

    @property
    def form_id(self) -> str:
        return self.entry.form_id

    @property
    def requirement(self) -> Requirement:
        return self.applicability.requirement

    @property
    def can_be_prepared(self) -> bool:
        """Whether Navigator can actually produce this document."""
        return self.entry.fillable


@dataclass(frozen=True)
class Packet:
    """Every form a household needs, in the order they should be presented."""

    state: str
    forms: tuple[PlannedForm, ...]

    #: Forms that were considered and excluded, with their reasons.
    #:
    #: Kept rather than dropped: "we looked at the pregnancy verification form
    #: and it does not apply to you" is a useful thing to be able to say, and a
    #: test asserting a form was *deliberately* excluded needs something to
    #: assert against.
    excluded: tuple[PlannedForm, ...] = ()

    def by_category(self, category: FormCategory) -> tuple[PlannedForm, ...]:
        return tuple(form for form in self.forms if form.entry.category is category)

    def form_ids(self) -> tuple[str, ...]:
        return tuple(form.form_id for form in self.forms)

    def main_application(self) -> PlannedForm | None:
        found = self.by_category(FormCategory.MAIN_APPLICATION)

        return found[0] if found else None

    def requiring_confirmation(self) -> tuple[PlannedForm, ...]:
        return tuple(
            form
            for form in self.forms
            if form.requirement is Requirement.NEEDS_CONFIRMATION
        )


#: Presentation order. The main application first, then what supports it.
#:
#: Fixed rather than derived from the catalog's declaration order, because the
#: order a packet is presented in is a product decision and should not change
#: because someone added a catalog entry in the middle of the list.
_CATEGORY_ORDER: tuple[FormCategory, ...] = (
    FormCategory.MAIN_APPLICATION,
    FormCategory.SUPPLEMENTAL_APPLICATION,
    FormCategory.APPLICANT_VERIFICATION,
    FormCategory.THIRD_PARTY_VERIFICATION,
    FormCategory.AUTHORIZATION_RELEASE,
    FormCategory.OPTIONAL_SUPPORTING,
)

#: Within a category, the more certainly needed comes first.
_REQUIREMENT_ORDER: tuple[Requirement, ...] = (
    Requirement.REQUIRED,
    Requirement.NEEDS_CONFIRMATION,
    Requirement.OPTIONAL,
)


def plan_packet(
    catalog: tuple[CatalogEntry, ...], context: PacketContext
) -> Packet:
    """The documents `context` needs, and the ones it does not.

    Deterministic: the same household and the same catalog produce the same
    packet in the same order, every time. That is asserted by a test rather
    than assumed, because a packet that reshuffles between two renders is a
    packet a counselor cannot check against the one they printed.
    """
    wanted = context.state.strip().upper()
    included: list[PlannedForm] = []
    excluded: list[PlannedForm] = []

    for entry in catalog:
        if entry.state.upper() != wanted:
            continue

        applicability = entry.applies(context)
        planned = PlannedForm(entry=entry, applicability=applicability)

        if applicability.belongs_in_packet:
            included.append(planned)
        else:
            excluded.append(planned)

    included.sort(key=_ordering)
    excluded.sort(key=_ordering)

    return Packet(state=wanted, forms=tuple(included), excluded=tuple(excluded))


def _ordering(form: PlannedForm) -> tuple[int, int, str]:
    category = (
        _CATEGORY_ORDER.index(form.entry.category)
        if form.entry.category in _CATEGORY_ORDER
        else len(_CATEGORY_ORDER)
    )
    requirement = (
        _REQUIREMENT_ORDER.index(form.requirement)
        if form.requirement in _REQUIREMENT_ORDER
        else len(_REQUIREMENT_ORDER)
    )

    return (category, requirement, form.entry.form_code)
