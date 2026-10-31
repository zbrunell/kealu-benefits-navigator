#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Every answer the Texas intake collects, and where it lands on H1010.

This module is the audit. For each of the canonical answers the Texas intake
collects, exactly one of four things is true, and this file says which:

``DIRECT``
    The official form prints a box for it and we write into that box. Not
    listed here — it is read off
    :data:`~benefits_navigator.formmap.forms.h1010_official.PLACED_KEYS`, so
    the classification cannot drift from the implementation.

``INDIRECT``
    The form asks for the same fact in a different shape, and a
    :class:`~benefits_navigator.formmap.definition.Derivation` re-projects it.
    ``expenses.household.0.kind`` has no box of its own; it decides which of
    Section P's eight labelled amount boxes row 0's amount goes in. Read off
    the definition's derivations, for the same reason.

``BEYOND_PRINTED_ROWS``
    Mappable, and this household has more of them than the form prints rows
    for. Reported as overflow, and the applicant is told to attach a sheet.
    Read off the repeating groups.

:data:`NOT_ON_THIS_FORM`
    The form does not ask it, or asks something adjacent but *different*. This is
    the only category written out by hand, because it is the only one that is a
    judgement rather than a fact about the code — and each entry carries the
    concrete reason, because "unmapped" without a reason is indistinguishable
    from "we did not get to it".

── Why this replaced a list of deferred keys ──────────────────────────────
``h1010_worksheet_keys.WORKSHEET_ONLY_KEYS`` held 127 keys under the heading
"printed on pages 4 to 21, not yet measured", and shrinking it to empty was
described as the remaining work. Two things were wrong with that:

* **It conflated two very different situations.** "H1010 asks this and we have
  not measured the box" and "H1010 does not ask this at all" were in one list,
  so the list could never reach empty and its size said nothing useful. Of the
  127: **83** turned out to be the first and now reach the form (59 in a box of
  their own, 24 read by a derivation); 12 are answers beyond the rows the form
  prints; and 32 are the second kind and always were.
* **Nothing read it.** It was declared as each variant's ``deferred_keys``, and
  ``deferred_keys`` is consulted only by ``validate_variant``. The comment said
  the review sheet named these answers for the applicant. It did not — no code
  path rendered them. See :func:`uncollected_notes`, which now does.

── The one entry worth reading twice ──────────────────────────────────────
``income.earned.N.gross_received_this_month``. The intake asks for "everything
received this month before deductions — not one paycheck". Section O's box is
labelled "Amount paid before taxes and deductions are taken out" and sits
directly above "How often are you paid?", which makes it a *per-pay-period*
amount. Writing a monthly total there would misstate the household's income to
HHSC — and combined with the frequency circle beside it, would misstate it by a
factor of two to four. Deriving the per-period figure would mean dividing by a
number the applicant never gave.

So it stays blank, and :func:`uncollected_notes` tells the applicant which
figure to write and where. A blank box with an instruction beats a filled box
with the wrong number on a benefits application.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class NotOnThisForm:
    """One canonical answer the official H1010 has no place for.

    Carries what the applicant answered and why the form cannot take it, so
    both the audit and the review sheet can say something specific.
    """

    #: The canonical key.
    key: str

    #: What the applicant answered, in the intake's own words.
    #:
    #: Plain English, and not a message key. It names the question *we* asked,
    #: for a reader matching this line against their own answers, and the
    #: sentence that matters — what to do about it — is the translated one.
    answer_label: str

    #: Why the official form has no box for it. Concrete, never "unsupported".
    reason: str

    #: Message key for the applicant-facing instruction, when there is
    #: something for them to do about it.
    action_key: str | None = None


#: HHSC's own designation for the section a note belongs to, where there is one.
_SECTION_A = "Section A"
_SECTION_B = "Section B"
_SECTION_K = "Section K"
_SECTION_O = "Section O"
_SECTION_P = "Section P"


#: Every intake answer the official H1010 does not ask for, with the reason.
#:
#: Ordered by the part of the intake they come from, not alphabetically, so a
#: reader works through it the way an applicant worked through the questions.
NOT_ON_THIS_FORM: tuple[NotOnThisForm, ...] = (
    # --- Programs ---------------------------------------------------------
    NotOnThisForm(
        key="programs.tx_medicaid",
        answer_label="Applying for Medicaid",
        reason=(
            "Section A divides health coverage by *who is applying* — "
            "Children, Adult Caring for a Child, Adult not Caring for a "
            "Child, Pregnant Women, Healthy Texas Women — not by whether it "
            "is Medicaid or CHIP. Neither of our two program answers "
            "corresponds to any one of those five circles, and marking one "
            "anyway would be choosing an eligibility category on the "
            "applicant's behalf from data that does not determine it."
        ),
        action_key="uncollected_tx_h1010_medicaid_category",
    ),
    NotOnThisForm(
        key="programs.tx_chip",
        answer_label="Applying for CHIP",
        reason=(
            "Same circles as Medicaid, and the same reason: they divide by "
            "applicant category, not by program."
        ),
        action_key="uncollected_tx_h1010_medicaid_category",
    ),
    # --- Per-person health-coverage categories ---------------------------
    #
    # Every person block repeats Section A's five "Medicaid or CHIP for:"
    # circles, and so repeats the same problem one person at a time. Knowing
    # that Maria is applying for Medicaid does not say which category she falls
    # under, and her age does not settle it either: "Adult caring for a child"
    # against "Adult not caring for a child" turns on caretaker status, and
    # Healthy Texas Women is a separate programme with its own rules.
    #
    # So her SNAP and TANF circles are marked from her own answer, and her
    # health-coverage circle is left for her — named, per person, in the review
    # sheet. SNAP and TANF need no category, which is why those two are mapped
    # and these are not.
    *(
        NotOnThisForm(
            key=key,
            answer_label=label,
            reason=(
                "The person block prints five 'Medicaid or CHIP for:' circles "
                "— Children, Adult Caring for a Child, Adult not Caring for a "
                "Child, Pregnant Women, Healthy Texas Women — which divide by "
                "eligibility category rather than by programme. This person's "
                "programme answer does not choose among them, and their age "
                "does not either: the two adult categories turn on caretaker "
                "status, and Healthy Texas Women is a separate programme. "
                "Their SNAP and TANF circles *are* marked from this same "
                "answer, because those need no category."
            ),
            action_key=(
                "uncollected_tx_h1010_your_medicaid_category"
                if key.startswith("applicant.")
                else "uncollected_tx_h1010_person_medicaid_category"
            ),
        )
        for key, label in (
            *(
                (f"applicant.programs.{program}", f"You are applying for {name}")
                for program, name in (
                    ("tx_medicaid", "Medicaid"),
                    ("tx_chip", "CHIP"),
                )
            ),
            *(
                (
                    f"household.members.{row}.programs.{program}",
                    f"Person {row + 2} is applying for {name}",
                )
                for row in range(6)
                for program, name in (
                    ("tx_medicaid", "Medicaid"),
                    ("tx_chip", "CHIP"),
                )
            ),
        )
    ),
    # --- Applicant identity ----------------------------------------------
    NotOnThisForm(
        key="applicant.other_names",
        answer_label="Other names you have used",
        reason=(
            "H1010 prints no box for former or alternative names anywhere on "
            "its 21 pages. The Medicaid/CHIP addendum does not either."
        ),
    ),
    NotOnThisForm(
        key="applicant.household.disabled",
        answer_label="You have a disability",
        reason=(
            f"{_SECTION_K} asks the household-level question 'Does anyone "
            f"have a disability?', which is filled from "
            f"household.disability_limits_activities. There is no per-person "
            f"disability box for Person 1, so answering it from this key "
            f"would say the same thing twice from two sources that can "
            f"disagree."
        ),
    ),
    NotOnThisForm(
        key="applicant.mailing_address.county",
        answer_label="County of your mailing address",
        reason=(
            f"{_SECTION_A} prints County once, on the home-address block. A "
            f"household whose mail goes to another county has nowhere on the "
            f"form to say so."
        ),
    ),
    NotOnThisForm(
        key="applicant.mailing_address_same_as_home",
        answer_label="You get your mail where you live",
        reason=(
            f"{_SECTION_A} prints the mailing address and the home address as "
            f"two separate blocks and asks no 'same as above' question. The "
            f"answer is expressed by both blocks being filled, which they are."
        ),
    ),
    # --- Household --------------------------------------------------------
    NotOnThisForm(
        key="household.size",
        answer_label="How many people live in your home",
        reason=(
            "H1010 has no household-size box: HHSC counts the person blocks "
            "that are filled in. Ours are filled in, so the count is stated "
            "the way the form states it."
        ),
    ),
    NotOnThisForm(
        key="household.adult_rows.count",
        answer_label="How many adults are on the application",
        reason=(
            "A count the intake keeps to lay out its own table. H1010 does "
            "not separate adult and child blocks, and prints no count."
        ),
    ),
    NotOnThisForm(
        key="household.child_rows.count",
        answer_label="How many children are on the application",
        reason=(
            "The same as the adult count: a number the intake keeps to lay "
            "out its own table. H1010 prints no count of children either — "
            "HHSC reads the person blocks that are filled in."
        ),
    ),
    NotOnThisForm(
        key="household.buys_and_prepares_food_together",
        answer_label="You buy and prepare food together",
        reason=(
            "SNAP turns on this, and H1010 does not print it. HHSC "
            "establishes it at the interview instead. Searching all 34 pages "
            "for 'buy and prepare', 'purchase and prepare' and 'eat together' "
            "finds nothing."
        ),
        action_key="uncollected_tx_h1010_ask_at_interview",
    ),
    NotOnThisForm(
        key="household.students",
        answer_label="Someone in your home is a student",
        reason=(
            "The form asks 'Is this person going to school?' once per person "
            "block. Our answer is household-level, so filling any one "
            "person's box would attribute school attendance to someone we "
            "were never told about."
        ),
        action_key="uncollected_tx_h1010_mark_the_person",
    ),
    NotOnThisForm(
        key="household.ever_in_foster_care",
        answer_label="Someone in your home was in foster care",
        reason=(
            "The Medicaid/CHIP addendum asks a narrower question: 'Was "
            "anyone in foster care when they were age 18 or older?' Someone "
            "in foster care as a young child answers yes to ours and no to "
            "theirs, so ours does not answer theirs."
        ),
        action_key="uncollected_tx_h1010_foster_care_age",
    ),
    NotOnThisForm(
        key="household.prior_public_assistance",
        answer_label="Someone in your home received benefits before",
        reason=(
            f"{_SECTION_K} question 2 asks whether anyone is getting benefits "
            f"*from another state*. Having received Texas benefits before "
            f"answers ours and not theirs."
        ),
    ),
    NotOnThisForm(
        key="household.existing_benefits",
        answer_label="Benefits anyone already gets",
        reason=(
            "Our answer is a written list. Section L asks a yes/no ('Does "
            "anyone get Medicaid, or CHIP?') which a list of arbitrary "
            "benefits does not answer, and prints no box for the list itself."
        ),
        action_key="uncollected_tx_h1010_ask_at_interview",
    ),
    # --- Expedited SNAP screening ----------------------------------------
    *(
        NotOnThisForm(
            key=f"household.expedited.{name}",
            answer_label=label,
            reason=(
                f"{_SECTION_B} prints four numbered questions with yes/no "
                f"circles, and this is not one of them. The conditions for "
                f"next-day SNAP appear on the form only as an explanatory "
                f"bullet list with no boxes; HHSC screens them at intake. Our "
                f"answer is kept for the interview rather than written into a "
                f"box that does not exist."
            ),
            action_key="uncollected_tx_h1010_expedited_at_interview",
        )
        for name, label in (
            (
                "gross_income_under_150_and_resources_under_100",
                "Income under $150 this month and $100 or less on hand",
            ),
            (
                "income_and_resources_less_than_housing_costs",
                "Housing costs are more than your income and savings",
            ),
            ("food_runs_out_within_three_days", "Food runs out within 3 days"),
            ("eviction_notice", "You have an eviction notice"),
            (
                "utilities_shut_off_or_notice",
                "Your utilities are shut off or you have a shut-off notice",
            ),
            ("needs_essential_clothing", "You need essential clothing"),
            (
                "needs_transportation_for_emergency_needs",
                "You need transportation for an emergency",
            ),
        )
    ),
    # --- Income -----------------------------------------------------------
    NotOnThisForm(
        key="household.annual_income",
        answer_label="Your household income for the year",
        reason=(
            "The main form asks for income per job and per source, never as a "
            "yearly total. The Medicaid/CHIP addendum does print a yearly "
            "total, but its own instruction limits that section to households "
            "whose income changes from month to month — so filling it for "
            "everyone would answer a question the form told most applicants "
            "to skip."
        ),
    ),
    NotOnThisForm(
        key="household.income_type",
        answer_label="What kind of income your household has",
        reason=(
            "A screening summary the intake uses to choose which questions to "
            "ask. The form asks about each job and each source individually, "
            "which is what we fill in."
        ),
    ),
    NotOnThisForm(
        key="income.varies_during_year",
        answer_label="Someone's income changes during the year",
        reason=(
            "The addendum's 'Money you get' section is introduced by an "
            "instruction — 'Fill out this section only if the amount of money "
            "you get changes' — and prints no yes/no circles to answer."
        ),
    ),
    *(
        NotOnThisForm(
            key=f"income.earned.{row}.gross_received_this_month",
            answer_label=f"Gross pay received this month (Job {row + 1})",
            reason=(
                f"{_SECTION_O}'s amount box is labelled 'Amount paid before "
                f"taxes and deductions are taken out' and sits directly above "
                f"'How often are you paid?', which makes it a per-pay-period "
                f"figure. Our answer is explicitly a whole month's total — the "
                f"intake says 'not one paycheck'. Writing the monthly total "
                f"into a per-period box would overstate this household's "
                f"income to HHSC by however many pay periods a month holds, "
                f"and deriving the per-period figure would mean dividing by a "
                f"number the applicant never gave."
            ),
            action_key="uncollected_tx_h1010_pay_per_period",
        )
        for row in range(3)
    ),
    # --- Expenses ---------------------------------------------------------
    *(
        NotOnThisForm(
            key=f"expenses.household.{row}.description",
            answer_label=f"What bill {row + 1} is for",
            reason=(
                f"{_SECTION_P} prints a labelled amount box per kind of cost "
                f"and no free-text description beside them. The kind itself "
                f"chooses the box, and the amount goes in it; the note the "
                f"applicant wrote for their own reference has nowhere to go."
            ),
        )
        for row in range(5)
    ),
)


#: Canonical keys the official form has no box for, for a quick membership test.
NOT_ON_THIS_FORM_KEYS: frozenset[str] = frozenset(
    note.key for note in NOT_ON_THIS_FORM
)


def note_for(key: str) -> NotOnThisForm | None:
    """The recorded reason this key has no box, or None if it has one."""
    for note in NOT_ON_THIS_FORM:
        if note.key == key:
            return note

    return None


def uncollected_notes(
    answered: frozenset[str],
) -> tuple[NotOnThisForm, ...]:
    """The notes that apply to a household that answered `answered`.

    Only the answers this household actually gave. A note about foster care is
    noise for a household that was never asked about it, and a review sheet
    that lists every theoretical gap teaches an applicant to skim past the ones
    that are theirs.
    """
    return tuple(note for note in NOT_ON_THIS_FORM if note.key in answered)
