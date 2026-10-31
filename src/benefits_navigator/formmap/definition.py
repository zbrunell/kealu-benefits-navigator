#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""A form definition: canonical key → target, and the resolution that uses it.

This is the layer the brief's requirement 6 is about — *"verify that a canonical
value maps to the expected form target without visually inspecting every
generated PDF"*. :func:`resolve_mappings` does the whole mapping job and touches
no PDF at all. It takes canonical values in and returns
:class:`ResolvedField` objects out, each naming its canonical key, its target,
and the exact string that will be drawn. Every mapping test in
``tests/test_formmap_*.py`` runs against that, in memory, with no template file
and no pypdf.

The rendering stage is then deliberately dumb: it draws what it is handed. It
cannot pick a different destination, reformat a value, or decide a field is
sensitive, because by the time it runs all of those decisions are already
recorded in the resolved fields.

── The safety boundary ────────────────────────────────────────────────────
Sensitive keys are refused *here*, before rendering, and the refusal is a raise
rather than a filter. ``pdf_generator`` already does this for the canonical
plan (``_is_sensitive_semantic_key``) and this layer re-checks rather than
trusting its caller: an SSN written onto a government form we hand back to an
applicant is not a bug we get to discover in production, and the second check
costs nothing.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, TYPE_CHECKING

from benefits_navigator.formmap.targets import (
    AcroFormTarget,
    Box,
    FieldKind,
    FieldTarget,
    OverlayTarget,
    TEXTUAL_KINDS,
)
from benefits_navigator.formmap.transforms import transform_for

if TYPE_CHECKING:  # pragma: no cover - typing only
    from benefits_navigator.formmap.repeat import RepeatingGroup


class SensitiveFieldRefused(ValueError):
    """A definition tried to place a value this project never prefills."""


class FormDefinitionError(ValueError):
    """A definition is internally inconsistent. Raised at import/validate."""


#: Substrings that mark a canonical key as never-prefillable.
#:
#: Mirrors ``pdf_generator._SENSITIVE_FIELD_MARKERS`` in intent. Kept as its own
#: list because this layer is reached by forms that path never sees, and a
#: shared import would make the Texas renderer depend on the California
#: generator's module-private constant.
SENSITIVE_KEY_MARKERS: tuple[str, ...] = (
    "ssn",
    "social_security",
    "signature",
    "signed",
    "alien_number",
    "alien_registration",
    "immigration_document",
    "uscis",
    "i94",
    "passport",
    "driver_license",
    "drivers_license",
    "bank_account",
    "account_number",
    "routing",
)


def is_sensitive_key(key: str) -> bool:
    """Whether this canonical key must never be written to a form."""
    normalized = key.strip().lower()

    return any(marker in normalized for marker in SENSITIVE_KEY_MARKERS)


class Responsibility(str, Enum):
    """Who completes a printed field.

    A packet is only useful if it tells someone what is left to do, and "what
    is left" is not one thing. Six boxes on H3037 are the clinician's, one is
    the applicant's signature, and two are the agency's own — telling an
    applicant they have "nine remaining items" is worse than saying nothing,
    because they will try to answer all nine.

    Every value except :attr:`NAVIGATOR` describes a field we deliberately
    leave blank. They are declared as :class:`DeclaredBlank`, which carries no
    canonical key at all — so the refusal is structural. There is nothing to
    fill a signature line *from*, which is a stronger guarantee than a filter
    that decides not to.
    """

    #: Navigator fills it from canonical data. The only value a
    #: :class:`FieldMapping` can have.
    NAVIGATOR = "navigator"

    #: The applicant must write it. Either we do not collect it yet, or it is
    #: something only they can decide in the moment.
    APPLICANT = "applicant"

    #: Someone else must complete it — an employer, a clinician.
    THIRD_PARTY = "third_party"

    #: A signature or dated attestation. Never rendered, by anyone, ever.
    SIGNATURE = "signature"

    #: We refuse to collect it. SSNs, immigration numbers, account numbers.
    SENSITIVE_REFUSED = "sensitive_refused"

    #: The agency's own box — "Agency Use Only" blocks and caseworker fields.
    AGENCY = "agency"

    @property
    def is_navigator(self) -> bool:
        return self is Responsibility.NAVIGATOR


@dataclass(frozen=True)
class DeclaredBlank:
    """A printed field this form deliberately does not fill, and who must.

    The counterpart to :class:`FieldMapping`. A mapping says "this canonical
    answer goes here"; a declared blank says "this box exists, we are not
    filling it, and here is who does".

    Deliberately carries **no canonical key and no target**. A signature has
    nothing to render from and no box we would ever draw in, and giving it
    either would create a path — however unused — from data to a forged
    signature. The absence is the safety property.
    """

    #: The printed question, in the form's own language.
    printed_label: str

    #: The form's own section, for grouping the checklist.
    section: str

    responsibility: Responsibility

    #: Who must complete it, as an applicant-facing message key.
    #:
    #: ``"completed_by_employer"``, ``"completed_by_medical_provider"``. A key
    #: because the applicant reads it in their own language even when the
    #: document is not in that language.
    completed_by_key: str = ""

    #: Why it is blank, as a message key, when that is not obvious.
    reason_key: str = ""

    #: Page it is printed on, so a checklist can point at it.
    page: int = 0

    def __post_init__(self) -> None:
        if self.responsibility.is_navigator:
            raise FormDefinitionError(
                f"{self.printed_label!r}: a declared blank cannot be the "
                f"Navigator's responsibility — if we fill it, it is a "
                f"FieldMapping."
            )


#: Sentinel for "this canonical key was not supplied at all".
_ABSENT = object()


@dataclass(frozen=True)
class Condition:
    """A gateway answer that decides whether a printed field applies at all.

    Printed forms are full of these: *"Do you get your mail at the address
    above? If No, give the mailing address."* The six mailing-address boxes are
    not optional and not missing when the answer is Yes — they are **not
    applicable**, and a form that fills them anyway has answered a question the
    applicant did not ask it to answer.

    That distinction has to reach the review sheet, which is the whole reason
    this is a first-class part of a mapping rather than a filter the form
    builder applies to its own data. "Still yours to fill in: Mailing street
    address" sends an applicant looking for a box they should leave alone.

    ── The three-state rule ───────────────────────────────────────────────
    A field is suppressed only when the gateway is **present and disagrees**.
    An unanswered gateway suppresses nothing: if the applicant typed a mailing
    address and never answered the Yes/No, the address is theirs and it prints.
    Suppressing on unknown would silently discard an answer, which is the one
    outcome worse than printing a redundant one.
    """

    #: Canonical key of the gateway question.
    key: str

    #: The gateway value that makes this field apply.
    equals: Any = True

    #: Why the field is blank, in the applicant's own terms.
    #:
    #: Printed on the review sheet under "Not applicable to your household",
    #: so it is a sentence, not a debugging string.
    because: str = ""

    #: What an *unanswered* gateway means for the fields it guards.
    #:
    #: ``False`` — the default and the right answer for a printed Yes/No —
    #: keeps the field, because an unanswered question must never discard an
    #: answer the applicant did give.
    #:
    #: ``True`` is for a *presence* marker rather than a question: printed row
    #: four of a household table exists only because a fourth person does, and
    #: no marker means no person. Without this the four unused rows of every
    #: table would be reported to a single applicant as work still to do.
    unknown_excludes: bool = False

    def applies(self, values: Mapping[str, Any]) -> bool:
        """Whether the gated field should be filled, given the answers."""
        gateway = values.get(self.key, _ABSENT)

        if gateway is _ABSENT or gateway is None:
            return not self.unknown_excludes

        return bool(gateway == self.equals)

    def explain(self) -> str:
        return self.because or f"{self.key} says this does not apply"


@dataclass(frozen=True)
class NotApplicable:
    """A mapped field left blank because a gateway answer excluded it."""

    key: str
    printed_label: str
    section: str
    reason: str


@dataclass(frozen=True)
class FieldMapping:
    """One canonical answer, and where it belongs on one form."""

    #: Dotted canonical key, e.g. ``applicant.home_address.city``.
    #:
    #: The same key space the TypeScript field plan emits and
    #: ``pdf_generator._canonical_values_from_plan`` normalizes, so a value that
    #: already reaches SAWS 2 PLUS needs no new plumbing to reach another form.
    key: str

    kind: FieldKind

    target: FieldTarget

    #: Named transform applied to the canonical value. None means ``plain``.
    transform: str | None = None

    #: Human-readable name of the printed question, for the review sheet.
    #:
    #: Not a catalog key: this names a question printed on a government form in
    #: that form's own language, and translating it would send an applicant
    #: looking for a label that is not on their page.
    printed_label: str = ""

    #: The form's own section, for grouping the review sheet.
    section: str = ""

    #: A gateway answer that makes this field applicable, if any.
    #:
    #: Held on the mapping rather than applied by the form builder so that
    #: resolution — the layer every mapping test runs against — can report the
    #: field as *not applicable* rather than as missing. See :class:`Condition`.
    applies_when: Condition | None = None

    #: Other canonical keys that answer the same printed question.
    #:
    #: One printed box, several canonical homes. The household table asks every
    #: person's sex in one column, but the canonical model splits a person's
    #: details by whether they are an adult or a child
    #: (``…adult.sex`` / ``…child.sex``) because California's form prints two
    #: separate tables. Neither key is wrong and neither is preferred — whichever
    #: one this person has is the answer.
    #:
    #: Tried in order after :attr:`key`; the first that yields a non-empty value
    #: wins. Declared rather than resolved by the form builder so a mapping test
    #: can assert *which* source answered, and so the review sheet still names
    #: one printed question rather than two.
    alternate_keys: tuple[str, ...] = ()

    #: Whether leaving this blank is a complete answer.
    #:
    #: Marks a printed box that is genuinely "only if it applies to you" — a
    #: middle name, an apartment number, a second phone. The review sheet still
    #: names it, but under its own heading rather than under "still yours to
    #: fill in", because a list that mixes *you must do this* with *you probably
    #: need not* teaches an applicant to skim past both.
    optional: bool = False

    #: The repeating group and row this mapping belongs to, if any.
    #:
    #: ``("household.members", 2)`` for the third printed person row. Used to
    #: group the review sheet by person instead of listing forty loose labels,
    #: and to let a test assert that row 2 draws row 2's data.
    row: tuple[str, int] | None = None

    def __post_init__(self) -> None:
        for key in self.candidate_keys():
            if is_sensitive_key(key):
                raise SensitiveFieldRefused(
                    f"{key} is a sensitive field and cannot be mapped to a form"
                )

        if isinstance(self.target, OverlayTarget):
            self._validate_overlay(self.target)

    def candidate_keys(self) -> tuple[str, ...]:
        """Every canonical key that may answer this printed question."""
        return (self.key, *self.alternate_keys)

    def _validate_overlay(self, target: OverlayTarget) -> None:
        if self.kind is FieldKind.CHOICE:
            if not target.option_boxes:
                raise FormDefinitionError(
                    f"{self.key}: a CHOICE field needs option_boxes"
                )

            return

        if target.box is None:
            raise FormDefinitionError(
                f"{self.key}: a {self.kind.value} overlay field needs a box"
            )

        if target.option_boxes:
            raise FormDefinitionError(
                f"{self.key}: option_boxes only apply to a CHOICE field"
            )


@dataclass(frozen=True)
class ResolvedField:
    """A mapping with a concrete value attached, ready to render.

    The unit of assertion for mapping tests: it says what came in, where it is
    going, and exactly what text will appear — all without a PDF existing.
    """

    mapping: FieldMapping

    #: The string that will be drawn, or the selected option key for a CHOICE.
    rendered: str

    #: The canonical value before transformation, for diagnostics.
    source_value: Any

    #: The canonical key the value actually came from.
    #:
    #: Usually ``mapping.key``; an :attr:`FieldMapping.alternate_keys` entry
    #: when the mapping's primary key was absent. Recorded so a test can pin
    #: *which* source answered a shared printed box rather than only that
    #: something did.
    source_key: str = ""

    @property
    def key(self) -> str:
        return self.mapping.key

    @property
    def kind(self) -> FieldKind:
        return self.mapping.kind

    @property
    def target(self) -> FieldTarget:
        return self.mapping.target

    def box(self) -> Box | None:
        """The box this value lands in, resolving a CHOICE selection."""
        target = self.mapping.target

        if not isinstance(target, OverlayTarget):
            return None

        if self.mapping.kind is FieldKind.CHOICE:
            return target.option_boxes.get(self.rendered)

        return target.box


# ---------------------------------------------------------------------------
# Derived values: re-projecting answers the applicant already gave
# ---------------------------------------------------------------------------
#
# A form sometimes asks for the *same facts* in a different shape than the one
# the intake collects them in. Texas H1010's Section P is the clearest case: it
# prints one labelled amount box per kind of housing cost — "Rent or home
# payment $", "Electricity $" — where the intake collects an indexed list of
# bills, each with a kind and an amount. The facts are identical; the shape is
# not, and no key-to-box mapping can bridge that on its own, because which box
# a bill's amount belongs in is decided by a *different* key's value.
#
# ── The line these must not cross ──────────────────────────────────────────
# A derivation may only **re-project or logically entail** what the applicant
# actually said. It may not estimate, average, annualize, or fill a gap.
#
# That line is what separates this from the thing this codebase refuses to do.
# Re-projecting "bill 0 is rent, and its amount is $900" into "the rent box
# holds $900" adds nothing and loses nothing. Dividing a monthly total by 4.33
# to guess a weekly pay rate would invent a number the applicant never gave and
# print it on a government form, and no derivation here is allowed to do it.
#
# Both derivations below are total functions of values already present, and
# both preserve the three-state rule: unanswered stays unanswered.


class Derivation:
    """Re-project canonical values into the shape one form asks for.

    Subclasses implement :meth:`apply`, which returns *new* keys only. A
    derivation never overwrites an answer the applicant gave: ``resolve_mappings``
    applies derived values under the originals, so a real answer always wins.
    """

    def apply(self, values: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def produces(self) -> tuple[str, ...]:
        """The keys this derivation can create. For registry-wide checks."""
        raise NotImplementedError

    def reads(self) -> tuple[str, ...]:
        """The keys this derivation consults, so they count as consumed."""
        raise NotImplementedError


@dataclass(frozen=True)
class AnyYes(Derivation):
    """A gateway that is Yes when any of several answers is Yes.

    H1010 asks broader questions than the intake does. Section N page 12 asks
    "Does anyone own or is anyone paying for these types of items?" over cash,
    bank accounts, property, insurance and stocks at once, where the intake
    asks three narrower questions. Section O asks about money from working for
    someone else *or* for yourself in one question.

    The truth table is the three-state one, and getting it right is the whole
    point:

    * **any source Yes → Yes.** Entailed: owning property means owning one of
      the listed items.
    * **every source answered and all No → No.** Also entailed.
    * **otherwise → absent.** Some No and the rest unanswered cannot make a No:
      the unanswered one might have been the Yes. Leaving it blank asks the
      applicant, which is correct; printing No would answer for them.
    """

    into: str
    sources: tuple[str, ...]

    def apply(self, values: dict[str, Any]) -> dict[str, Any]:
        answers = [_tri(values.get(key)) for key in self.sources]

        if any(answer is True for answer in answers):
            return {self.into: True}

        if answers and all(answer is False for answer in answers):
            return {self.into: False}

        return {}

    def produces(self) -> tuple[str, ...]:
        return (self.into,)

    def reads(self) -> tuple[str, ...]:
        return self.sources


@dataclass(frozen=True)
class PivotByKind(Derivation):
    """An indexed collection re-keyed by the value of one of its fields.

    ``expenses.household.0.kind = "electricity"`` with
    ``expenses.household.0.amount_monthly = "120"`` becomes
    ``expenses.household.by_kind.electricity = "120"``, which is the shape
    Section P's labelled amount boxes need.

    Two behaviours worth stating, because both are decisions rather than
    conveniences:

    * **A kind not in** :attr:`allowed` **is dropped**, not folded into a
      neighbouring box. The form has no box for it, and putting a trash bill in
      the phone box would be a false statement about a household's expenses.
      The row stays in ``deferred``/the review sheet, so the applicant is told.
    * **Two rows of the same kind are summed** only when :attr:`sum_repeats` is
      set, and it is not set by default. Two electricity bills in one month is
      more likely a data-entry repeat than a household with two meters, and
      silently adding them would overstate an expense. Left unset, the second
      row is reported as unplaced rather than merged.
    """

    prefix: str
    rows: int
    kind_field: str
    value_field: str
    into: str
    allowed: tuple[str, ...]
    sum_repeats: bool = False

    #: Also emit ``<mark_into>.<kind> = True`` for each kind that got a value.
    #:
    #: Section P's instruction is "mark the costs they have and list the
    #: amount", so each amount box has a circle beside it and an amount next to
    #: an unmarked circle answers half the question. The mark is emitted here
    #: rather than by a second derivation reading this one's output, because
    #: derivations deliberately do not chain: each sees the applicant's answers
    #: and nothing another derivation invented, so no declaration order can
    #: change what a form prints.
    mark_into: str | None = None

    def apply(self, values: dict[str, Any]) -> dict[str, Any]:
        derived: dict[str, Any] = {}

        for row in range(self.rows):
            kind = values.get(f"{self.prefix}.{row}.{self.kind_field}")
            amount = values.get(f"{self.prefix}.{row}.{self.value_field}")

            if not isinstance(kind, str) or kind not in self.allowed:
                continue

            if amount is None or (isinstance(amount, str) and not amount.strip()):
                continue

            target = f"{self.into}.{kind}"

            if target not in derived:
                derived[target] = amount
                continue

            if not self.sum_repeats:
                continue

            try:
                derived[target] = str(
                    float(str(derived[target]).replace(",", ""))
                    + float(str(amount).replace(",", ""))
                )
            except ValueError:
                # Not a number after all. Keep the first, and let the review
                # sheet report the row rather than guessing at arithmetic.
                continue

        if self.mark_into is not None:
            for target in list(derived):
                kind = target.rsplit(".", 1)[-1]
                derived[f"{self.mark_into}.{kind}"] = True

        return derived

    def produces(self) -> tuple[str, ...]:
        placed = tuple(f"{self.into}.{kind}" for kind in self.allowed)

        if self.mark_into is None:
            return placed

        return placed + tuple(
            f"{self.mark_into}.{kind}" for kind in self.allowed
        )

    def reads(self) -> tuple[str, ...]:
        return tuple(
            f"{self.prefix}.{row}.{field}"
            for row in range(self.rows)
            for field in (self.kind_field, self.value_field)
        )


@dataclass(frozen=True)
class JoinValues(Derivation):
    """Several answers written onto one printed line, in printed order.

    H1010 gives one box for "Home address" where the intake collects a street
    and an apartment number separately, and one line for "the person or place
    that paid the money" where the intake collects an employer's name and
    address. The form asks for both on one line; the intake asks for them
    apart. Joining them is the same re-projection as a pivot, in one dimension.

    Only non-empty sources are joined, in declared order, so a household with
    no apartment number gets ``"2100 Nueces Street"`` and not
    ``"2100 Nueces Street, "``. Absent when every source is empty.

    A joined value that will not fit its printed box is reported as *unfitted*
    by the renderer and left blank with a note, which is the same treatment any
    over-long value gets — never truncated onto a government form.
    """

    into: str
    sources: tuple[str, ...]
    separator: str = ", "

    def apply(self, values: dict[str, Any]) -> dict[str, Any]:
        parts: list[str] = []

        for key in self.sources:
            value = values.get(key)

            if value is None or isinstance(value, bool):
                continue

            text = str(value).strip()

            if text:
                parts.append(text)

        if not parts:
            return {}

        return {self.into: self.separator.join(parts)}

    def produces(self) -> tuple[str, ...]:
        return (self.into,)

    def reads(self) -> tuple[str, ...]:
        return self.sources


def _tri(value: Any) -> bool | None:
    """A canonical yes/no answer as a tri-state. Absent and blank are None."""
    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        folded = value.strip().casefold()

        if folded in {"yes", "true", "y"}:
            return True

        if folded in {"no", "false", "n"}:
            return False

    return None


def apply_derivations(
    definition: "FormDefinition", values: dict[str, Any]
) -> dict[str, Any]:
    """`values` plus whatever this form derives from them.

    A real answer always wins over a derived one: derived keys are written
    underneath, so a form that both derives ``X`` and receives ``X`` from the
    intake uses the intake's.

    Every derivation sees the *original* values, never another derivation's
    output. That is deliberate: chaining would make the declaration order of
    ``definition.derived`` change what a government form prints, and a reader
    checking one derivation would have to know which others ran first. A
    derivation that needs a second output emits both itself — see
    :attr:`PivotByKind.mark_into`.
    """
    if not definition.derived:
        return values

    merged = dict(values)

    for derivation in definition.derived:
        for key, derived_value in derivation.apply(values).items():
            merged.setdefault(key, derived_value)

    return merged


@dataclass(frozen=True)
class FormDefinition:
    """Everything needed to map canonical data onto one specific form."""

    #: Stable id, matching the TypeScript ``SupportedApplicationForm`` where one
    #: exists (``TX_H1010``, ``CA_SAWS_2_PLUS``) so the two layers agree.
    form_id: str

    #: The agency's own designation, printed on the page. Never translated.
    form_code: str

    #: Descriptive title, as the agency prints it.
    title: str

    #: Two-letter state code, or "" for a federal form.
    state: str

    #: The language of the printed document — *not* the UI locale.
    document_language: str

    #: Page size in points. Letter unless the agency publishes otherwise.
    page_width: float = 612.0
    page_height: float = 792.0

    #: How many pages the rendered output has.
    page_count: int = 1

    #: The bundled official template this definition overlays, if we hold one.
    #:
    #: ``None`` means we do not have the government PDF. The renderer then
    #: produces Navigator-authored pages instead of overlaying, and everything
    #: downstream is told the output is a worksheet rather than the official
    #: form. See :attr:`base_document_note`.
    base_document: str | None = None

    #: Why :attr:`base_document` is None. **For a reader of this code.**
    #:
    #: Engineering prose: it may name modules, filenames and the condition that
    #: would end the situation. It is not shown to an applicant — see
    #: :attr:`base_document_note_key`, which is.
    base_document_note: str = ""

    #: Message key for the applicant-facing version of the same explanation.
    #:
    #: Two fields rather than one because they have different readers and the
    #: single field was serving neither. It was printed verbatim on the review
    #: sheet, so an applicant read a sentence naming ``h1010_official`` and
    #: ``TX-H1010-ES-2026-08.pdf`` — internal vocabulary on the one page meant
    #: to make their paperwork comprehensible — and read it in English no matter
    #: what language they had chosen, because prose on a definition cannot be
    #: translated.
    #:
    #: A key can be. The sentence lives in
    #: :mod:`benefits_navigator.formmap.review_words` beside the rest of the
    #: sheet's wording. Empty falls back to :attr:`base_document_note`, which is
    #: better than nothing for a form that has not been given a key yet.
    base_document_note_key: str = ""

    #: Where the form and its rules were read from, for audit.
    source_url: str = ""

    fields: tuple[FieldMapping, ...] = ()

    #: Printed labels the renderer draws when there is no base document.
    #:
    #: Carried by the definition rather than looked up by form id. The pipeline
    #: previously asked ``if definition.form_id == "TX_H1010"`` to find these,
    #: which is exactly the per-state branch this layer exists to remove — the
    #: second overlay form would have added a second branch.
    #:
    #: Typed loosely to avoid a circular import with ``render``; the renderer
    #: reads ``.page/.x/.y/.size/.text`` off each item.
    static_text: tuple[Any, ...] = ()

    #: The printed tables this form has, for capacity reporting.
    #:
    #: A form with a four-row bills table cannot print a fifth bill, and the one
    #: thing an applicant must not do is hand in a form that silently omits it.
    #: Declared here so the review sheet can count the overflow for any form
    #: without knowing what a household or a bill is — see
    #: :mod:`benefits_navigator.formmap.repeat`.
    repeating_groups: tuple["RepeatingGroup", ...] = ()

    #: Printed fields deliberately left blank, and who must complete them.
    #:
    #: The other half of the packet's answer to "what is left to do". A form is
    #: not finished because every :attr:`fields` mapping resolved — H3037 is
    #: mostly a clinician's page, and a form reported as complete because our
    #: three boxes filled would be a lie told confidently. See
    #: :class:`DeclaredBlank`.
    blanks: tuple[DeclaredBlank, ...] = ()

    #: The official language editions of this form, when it has more than one
    #: layout.
    #:
    #: Empty means this definition describes a single document, and
    #: :attr:`base_document` plus each mapping's own target is the whole story —
    #: which is where California and the pre-official Texas worksheet sit.
    #:
    #: When present, each variant carries its own complete target map, and the
    #: document resolver picks one from the applicant's locale. Loosely typed to
    #: avoid a circular import with :mod:`documents`; the registry validates
    #: them at build time.
    variants: tuple[Any, ...] = ()

    #: Re-projections of the applicant's answers into the shape this form asks
    #: for. See :class:`Derivation` — and the line it may not cross.
    derived: tuple[Derivation, ...] = ()

    #: Answers this form has no printed box for, each with a reason.
    #:
    #: The review sheet lists the ones a given household actually answered, so
    #: they learn which of their answers are not on the paper and what to do
    #: instead. Loosely typed to keep this module free of any one state's
    #: catalogue; the renderer reads ``.key``, ``.answer_label`` and
    #: ``.action_key`` off each item. See
    #: ``benefits_navigator.formmap.forms.h1010_coverage``.
    #:
    #: A form that declares none simply gets no such section — which is the
    #: right default, because "this form asks nothing we cannot place" and "we
    #: have not audited this form" should not produce the same output, and the
    #: second is caught by a registry-wide test rather than by a blank list.
    no_box_notes: tuple[Any, ...] = ()

    def blanks_for(self, responsibility: "Responsibility") -> tuple[DeclaredBlank, ...]:
        """Every deliberately-blank field someone in particular must complete."""
        return tuple(
            blank for blank in self.blanks if blank.responsibility is responsibility
        )

    def __post_init__(self) -> None:
        seen: set[str] = set()

        for mapping in self.fields:
            for key in mapping.candidate_keys():
                if key in seen:
                    raise FormDefinitionError(
                        f"{self.form_id}: duplicate canonical key {key}"
                    )

                seen.add(key)

            for box in _boxes_of(mapping):
                if box.page > self.page_count:
                    raise FormDefinitionError(
                        f"{self.form_id}: {mapping.key} is on page {box.page} "
                        f"but the form has {self.page_count} pages"
                    )

                if box.right > self.page_width or box.top > self.page_height:
                    raise FormDefinitionError(
                        f"{self.form_id}: {mapping.key} box extends past the "
                        f"page ({box.right:.1f}x{box.top:.1f} vs "
                        f"{self.page_width:.0f}x{self.page_height:.0f})"
                    )

    @property
    def is_overlay(self) -> bool:
        """Whether any field is drawn rather than written to a native field."""
        return any(
            isinstance(mapping.target, OverlayTarget) for mapping in self.fields
        )

    @property
    def has_official_base_document(self) -> bool:
        return self.base_document is not None

    def mapping_for(self, key: str) -> FieldMapping | None:
        for mapping in self.fields:
            if key in mapping.candidate_keys():
                return mapping

        return None

    def keys(self) -> tuple[str, ...]:
        """The primary canonical key of every mapping, in printed order."""
        return tuple(mapping.key for mapping in self.fields)

    def consumed_keys(self) -> frozenset[str]:
        """Every canonical key this form reads, for any purpose.

        What "unmapped" is measured against, and it is deliberately wider than
        "every key with a box". A value that reached the page through an
        alternate key is mapped. So is a gateway a condition consults: the
        household-member presence markers are *the reason* the people table
        prints the rows it prints, and reporting them as answers this form has
        no place for would be exactly backwards.
        """
        keys: set[str] = set()

        for mapping in self.fields:
            keys.update(mapping.candidate_keys())

            if mapping.applies_when is not None:
                keys.add(mapping.applies_when.key)

        # A key a derivation reads is consumed by this form even though no box
        # names it: `expenses.household.0.kind` is what decides which printed
        # amount box row 0 lands in. Reporting it as unmapped would say the
        # form has no place for an answer it is in fact using.
        for derivation in self.derived:
            keys.update(derivation.reads())
            keys.update(derivation.produces())

        return frozenset(keys)

    def group_for(self, prefix: str) -> "RepeatingGroup | None":
        for group in self.repeating_groups:
            if group.prefix == prefix:
                return group

        return None

    def sections(self) -> tuple[str, ...]:
        """Distinct sections in declaration order."""
        ordered: list[str] = []

        for mapping in self.fields:
            if mapping.section and mapping.section not in ordered:
                ordered.append(mapping.section)

        return tuple(ordered)


def _boxes_of(mapping: FieldMapping) -> tuple[Box, ...]:
    target = mapping.target

    return target.boxes() if isinstance(target, OverlayTarget) else ()


# ---------------------------------------------------------------------------
# Resolution — the testable core
# ---------------------------------------------------------------------------


@dataclass
class ResolutionReport:
    """What resolution produced, including what it deliberately did not.

    ``skipped`` matters as much as ``fields``. A form field left blank because
    the applicant never answered is correct behaviour, and naming it here is
    what lets the review sheet tell them what is still theirs to fill in —
    rather than the applicant discovering it at the county office.
    """

    fields: list[ResolvedField] = field(default_factory=list)

    #: Canonical keys the definition maps but the data did not supply.
    skipped: list[str] = field(default_factory=list)

    #: Canonical keys present in the data that this form has no place for.
    #:
    #: Not an error. H1010 has no box for several answers SAWS 2 PLUS collects,
    #: and that is a fact about the two forms, not a defect.
    unmapped: list[str] = field(default_factory=list)

    #: Rows a printed table has no room for, by repeating-group prefix.
    #:
    #: The count of subjects past the end of the table. A form with a four-row
    #: bills table and five bills has to say so *before* it is handed in, and
    #: this is the number the review sheet says it with.
    overflow: dict[str, int] = field(default_factory=dict)

    #: Fields a gateway answer excluded, each with the reason.
    #:
    #: Kept apart from :attr:`skipped` because the two say opposite things to
    #: the applicant. Skipped means *you still have to fill this in*; this means
    #: *leave it alone, your answers say it does not apply to you*.
    not_applicable: list[NotApplicable] = field(default_factory=list)

    def by_key(self) -> dict[str, ResolvedField]:
        return {resolved.key: resolved for resolved in self.fields}

    def rendered_values(self) -> dict[str, str]:
        """Canonical key → the string that will appear. For assertions."""
        return {resolved.key: resolved.rendered for resolved in self.fields}

    def not_applicable_keys(self) -> tuple[str, ...]:
        return tuple(item.key for item in self.not_applicable)

    def rows_filled(self, group: str) -> tuple[int, ...]:
        """Which printed rows of a repeating group got any value at all."""
        return tuple(
            sorted(
                {
                    resolved.mapping.row[1]
                    for resolved in self.fields
                    if resolved.mapping.row is not None
                    and resolved.mapping.row[0] == group
                }
            )
        )


def resolve_mappings(
    definition: FormDefinition,
    canonical_values: dict[str, Any],
) -> ResolutionReport:
    """Map canonical values onto a form's targets. No PDF involved.

    Pure and total: the same definition and the same values always give the
    same report, and nothing here reads the filesystem, the clock, or a locale.
    """
    report = ResolutionReport()

    for key in sorted(canonical_values):
        if is_sensitive_key(key):
            raise SensitiveFieldRefused(
                f"sensitive canonical key reached form mapping: {key}"
            )

    # Re-project into the shape this form asks its questions in, before
    # anything reads a value. Nothing is invented here — see `Derivation`.
    canonical_values = apply_derivations(definition, canonical_values)

    for group in definition.repeating_groups:
        beyond = group.overflow_beyond(canonical_values)

        if beyond:
            report.overflow[group.prefix] = beyond

    mapped_keys = definition.consumed_keys()

    for key in sorted(canonical_values):
        if key not in mapped_keys:
            report.unmapped.append(key)

    for mapping in definition.fields:
        condition = mapping.applies_when

        if condition is not None and not condition.applies(canonical_values):
            # Excluded by a gateway answer. Recorded, not silently dropped:
            # the review sheet has to be able to say *why* the box is empty.
            report.not_applicable.append(
                NotApplicable(
                    key=mapping.key,
                    printed_label=mapping.printed_label or mapping.key,
                    section=mapping.section,
                    reason=condition.explain(),
                )
            )
            continue

        source_key, source, rendered = _first_answer(mapping, canonical_values)

        if source_key is None:
            report.skipped.append(mapping.key)
            continue

        if mapping.kind is FieldKind.CHECKBOX:
            # A checkbox is marked only by an explicit True. Absent, None and
            # False all leave the printed box alone, because a form this
            # project produces never answers a question on the applicant's
            # behalf.
            if source is not True:
                report.skipped.append(mapping.key)
                continue

            rendered = _mark_for(mapping)

        elif mapping.kind is FieldKind.CHOICE:
            if not rendered:
                report.skipped.append(mapping.key)
                continue

            if not _choice_has_option(mapping, rendered):
                raise FormDefinitionError(
                    f"{mapping.key}: value {rendered!r} has no option on the "
                    f"form; options are "
                    + ", ".join(sorted(_choice_options(mapping)))
                )

        elif not rendered:
            report.skipped.append(mapping.key)
            continue

        report.fields.append(
            ResolvedField(
                mapping=mapping,
                rendered=rendered,
                source_value=source,
                source_key=source_key,
            )
        )

    return report


def _first_answer(
    mapping: FieldMapping,
    canonical_values: dict[str, Any],
) -> tuple[str | None, Any, str]:
    """The first of a mapping's candidate keys that actually has a value.

    Returns ``(None, None, "")`` when none of them do. A key that is present but
    transforms to nothing — an empty string, a ``None`` — does not count as an
    answer, so a blank ``…adult.sex`` never shadows a populated ``…child.sex``.
    """
    transform = transform_for(mapping.transform)
    first_present: tuple[str, Any, str] | None = None

    for key in mapping.candidate_keys():
        if key not in canonical_values:
            continue

        source = canonical_values[key]
        rendered = transform(source)

        if rendered:
            return key, source, rendered

        if first_present is None:
            first_present = (key, source, rendered)

    if first_present is not None:
        # Present but empty. Returned so a CHECKBOX mapping can still see an
        # explicit False, which every transform renders as "".
        return first_present

    return None, None, ""


def _mark_for(mapping: FieldMapping) -> str:
    target = mapping.target

    if isinstance(target, OverlayTarget):
        return target.mark

    return target.on_state


def _choice_options(mapping: FieldMapping) -> tuple[str, ...]:
    target = mapping.target

    if isinstance(target, OverlayTarget):
        return tuple(target.option_boxes)

    # A native radio group's options are in the PDF, not here; accept any.
    return ()


def _choice_has_option(mapping: FieldMapping, value: str) -> bool:
    options = _choice_options(mapping)

    return not options or value in options


def validate_definition(definition: FormDefinition) -> tuple[str, ...]:
    """Problems with a definition, as a list rather than a raise.

    Complements the constructor's checks, which fail fast on structural errors.
    This reports the softer ones a registry test should surface all at once.
    """
    problems: list[str] = []

    for mapping in definition.fields:
        target = mapping.target

        if isinstance(target, OverlayTarget):
            if mapping.kind in TEXTUAL_KINDS and target.font_size <= 0:
                problems.append(f"{mapping.key}: font_size must be positive")

            if (
                mapping.kind is FieldKind.MULTILINE
                and target.box is not None
                and not target.multiline
            ):
                problems.append(
                    f"{mapping.key}: MULTILINE field has multiline=False, so "
                    "it will render as one clipped line"
                )

        if not mapping.printed_label:
            problems.append(
                f"{mapping.key}: no printed_label, so the review sheet cannot "
                "name the question"
            )

    if definition.is_overlay and definition.base_document is None:
        if not definition.base_document_note:
            problems.append(
                f"{definition.form_id}: overlays with no base document must "
                "explain why in base_document_note"
            )

    return tuple(problems)
