#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Printed tables: the same question asked once per person, job, or bill.

Almost every benefits form has them. "Who lives with you" is six identical rows
of name/relationship/date of birth; "money you get" is four identical rows of
employer/amount/how often. The canonical layer already stores these as indexed
collections — ``household.members.0.first_name``,
``household.members.1.first_name`` — because that is what the TypeScript field
plan emits.

What was missing was a way to say *"this printed table draws that canonical
collection"* without writing the loop by hand in every form module. Written by
hand it goes wrong in three specific ways, all of which this module exists to
prevent:

**Row drift.** A loop that builds keys with its own f-string can put row 2's
date of birth beside row 3's name. :meth:`RepeatingGroup.key` is the only place
an index becomes a key, so a row is wrong in one place or right in all of them.

**Phantom people.** A form with six printed rows and a household of two must
leave four rows blank — and must not then tell the applicant they have four
people left to enter. :meth:`RepeatingGroup.presence` returns a
:class:`~benefits_navigator.formmap.definition.Condition` on the collection's
own ``present`` marker, with ``unknown_excludes=True``, so unused rows resolve
as *not applicable* rather than as missing.

**Discovery by probing.** The marker is read, never inferred from whether a name
happens to be non-empty. ``pdf_generator`` learned that the hard way: probing
for a non-empty first name and stopping at the first gap deleted every member
after an unnamed one.

Nothing here knows what a household is, or what a form is. A group is a prefix,
a row count, and the arithmetic that turns the two into keys — which is why the
same class carries H1010's people table, its jobs table and its bills table, and
will carry whatever form #3 prints.
"""

from __future__ import annotations

from dataclasses import dataclass

from benefits_navigator.formmap.definition import Condition


@dataclass(frozen=True)
class RepeatingGroup:
    """A canonical indexed collection, drawn as a fixed number of printed rows.

    ``rows`` is a property of the *paper*, not of the household: it is how many
    blocks the agency printed. A household larger than the table overflows, and
    saying so is :meth:`overflow_beyond`'s job — the applicant needs to know
    before they hand the form in, not after.
    """

    #: Canonical prefix of the collection, without a trailing dot.
    #:
    #: ``"household.members"`` addresses ``household.members.0.first_name``.
    prefix: str

    #: How many rows the printed form has room for.
    rows: int

    #: How this group is named on the review sheet: "Person", "Job", "Bill".
    #:
    #: Singular, and in the form's own language, because it is printed next to
    #: the row number: "Person 2 — Date of birth".
    row_noun: str = "Row"

    #: The suffix of the marker that says a row's subject exists.
    #:
    #: The TypeScript field plan emits ``household.members.0.present`` for every
    #: member it knows about, so presence is stated by the source of truth
    #: rather than guessed at by whoever reads it.
    presence_suffix: str = "present"

    def __post_init__(self) -> None:
        if self.rows < 1:
            raise ValueError(f"{self.prefix}: a table needs at least one row")

        if self.prefix.endswith("."):
            raise ValueError(f"{self.prefix}: prefix must not end with a dot")

    # -- keys --------------------------------------------------------------

    def key(self, index: int, suffix: str) -> str:
        """The canonical key for one field of one row. 0-based index."""
        if not 0 <= index < self.rows:
            raise IndexError(
                f"{self.prefix} has {self.rows} printed rows; asked for row "
                f"{index}"
            )

        return f"{self.prefix}.{index}.{suffix}"

    def presence_key(self, index: int) -> str:
        return self.key(index, self.presence_suffix)

    def indexes(self) -> tuple[int, ...]:
        return tuple(range(self.rows))

    # -- conditions --------------------------------------------------------

    def presence(self, index: int) -> Condition:
        """The condition that row `index` has a subject at all.

        ``unknown_excludes=True``: no marker means no person, and the printed
        row stays blank without being reported as unfinished work.
        """
        return Condition(
            key=self.presence_key(index),
            equals=True,
            because=(
                f"there is no {self.row_noun.lower()} {index + 1} in what you "
                "told us"
            ),
            unknown_excludes=True,
        )

    # -- reporting ---------------------------------------------------------

    def label(self, index: int, question: str) -> str:
        """The printed label for one field of one row, 1-based for humans."""
        return f"{self.row_noun} {index + 1} — {question}"

    def occupants(self, canonical_values: dict[str, object]) -> tuple[int, ...]:
        """Rows the data actually has a subject for, printed rows only."""
        return tuple(
            index
            for index in self.indexes()
            if canonical_values.get(self.presence_key(index)) is True
        )

    def overflow_beyond(self, canonical_values: dict[str, object]) -> int:
        """How many subjects the data has that the printed table cannot hold.

        Counted by walking the collection past the end of the table rather than
        from a declared total, because the total and the rows are two different
        facts and a form should trust neither over the data it was handed.
        """
        extra = 0
        index = self.rows

        while canonical_values.get(f"{self.prefix}.{index}.{self.presence_suffix}") is True:
            extra += 1
            index += 1

        return extra
