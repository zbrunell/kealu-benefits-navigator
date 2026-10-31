#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The Texas forms catalog, and when each form applies to a household.

Every rule below cites the HHSC page it came from, read on 4 September 2026
from ``fhb.hhs.texas.gov/forms``. Rules that could not be grounded in published
guidance are :attr:`~benefits_navigator.formmap.packet.Requirement.NEEDS_CONFIRMATION`
rather than REQUIRED, and the difference is the point of this module.

── The temptation this module exists to resist ────────────────────────────
It is very easy to write::

    if household reports self-employment: require H1049
    if household reports pregnancy:       require H3037
    if household reports a job:           require an employment verification

Each of those is wrong, and wrong in a way that costs an applicant real work:

* **H1049** is HHSC's method for reporting self-employment income *when tax or
  business records are not available*. The form's own instructions say "you may
  attach a copy of the latest income tax forms in place of this form". Whether
  it is needed depends on records nobody here has seen.
* **H3037** is prepared by an HHSC *advisor* to have a clinician verify a
  pregnancy. It is not an attachment an applicant is expected to bring, and
  pregnancy can be verified other ways. Putting it in a packet marked REQUIRED
  would send someone to a doctor's office they may not need to visit.
* **H1028**, the general Employment Verification, is used "when TIERS is down
  and a person cannot furnish sufficient verification of income" — an internal
  fallback, with HHSC staff completing page 1. It is not an applicant's form at
  all, which is why it is not in this catalog as an applicant deliverable.

So the only REQUIRED entry here is H1010, where HHSC's instruction is
unambiguous: "The household completes the form when applying or reapplying for
Medical Programs, SNAP and TANF."
"""

from __future__ import annotations

from benefits_navigator.formmap.packet import (
    Applicability,
    CatalogEntry,
    FormCategory,
    PacketContext,
    Requirement,
    not_applicable,
)

#: Every Texas program H1010 is the application for.
#:
#: Taken from HHSC's stated purpose for the form rather than from what this
#: product happens to screen for, so that adding a program to the intake does
#: not silently change which form it files.
_H1010_PROGRAMS = frozenset(
    {"tx_snap", "tx_tanf", "tx_medicaid", "tx_chip", "tx_healthy_texas_women"}
)


def _h1010_applies(context: PacketContext) -> Applicability:
    """H1010 is the application; if they are applying, they file it.

    The one rule here that is genuinely REQUIRED, and it is required because
    HHSC says so, not because it is our main form.
    """
    if not context.any_program(_H1010_PROGRAMS):
        return not_applicable("tx_h1010_no_covered_program")

    return Applicability(
        requirement=Requirement.REQUIRED,
        reason_key="tx_h1010_required_for_selected_programs",
        evidence=tuple(sorted(context.selected_programs & _H1010_PROGRAMS)),
        citation=(
            "HHSC Form H1010 procedure, 'When to Prepare': 'The household "
            "completes the form when applying or reapplying for Medical "
            "Programs, SNAP and TANF.'"
        ),
    )


def _h1049_applies(context: PacketContext) -> Applicability:
    """H1049 applies when someone is self-employed — but may not be needed.

    NEEDS_CONFIRMATION rather than REQUIRED, and the reason is printed on the
    form itself: an applicant may attach their latest tax return instead. We do
    not know whether they have one, so we say what the form is for and let them
    decide, rather than adding a ledger to their to-do list on our own say-so.
    """
    key = "income.has_self_employment"

    if not context.answered_yes(key):
        return not_applicable("tx_h1049_no_self_employment", evidence=(key,))

    return Applicability(
        requirement=Requirement.NEEDS_CONFIRMATION,
        reason_key="tx_h1049_self_employment_reported",
        evidence=(key,),
        citation=(
            "HHSC Form H1049 purpose: 'To provide a method for households to "
            "report self-employment income and expenses, if accurate tax or "
            "business records are not available.' The form's own instructions "
            "add: 'you may attach a copy of the latest income tax forms in "
            "place of this form.'"
        ),
    )


def _h3037_applies(context: PacketContext) -> Applicability:
    """H3037 applies to a pregnancy being reported for health coverage.

    Two conditions, not one. A pregnancy reported by a household applying only
    for SNAP does not engage this form — H3037 exists to establish eligibility
    for pregnancy-related Medicaid and cash assistance, and HHSC's own note
    that "the department cannot pay you for completing this form" is a reminder
    that a clinician's time is being spent. Asking for it when the programs
    selected do not turn on the pregnancy spends that time for nothing.
    """
    pregnancy = "household.anyone_pregnant"
    health_programs = frozenset(
        {"tx_medicaid", "tx_chip", "tx_healthy_texas_women"}
    )

    if not context.answered_yes(pregnancy):
        return not_applicable("tx_h3037_no_pregnancy_reported", evidence=(pregnancy,))

    if not context.any_program(health_programs):
        return not_applicable(
            "tx_h3037_no_health_program_selected", evidence=(pregnancy,)
        )

    return Applicability(
        requirement=Requirement.NEEDS_CONFIRMATION,
        reason_key="tx_h3037_pregnancy_reported_for_health_coverage",
        evidence=(pregnancy,),
        citation=(
            "HHSC Form H3037 purpose: 'to document pregnancy, the sixth to "
            "ninth months, delivery date, multiple births, and other disabling "
            "conditions related to pregnancy' and 'to obtain client's "
            "permission for information release'. Prepared by an advisor to "
            "verify a client is pregnant; a medical professional completes the "
            "clinical items. HHSC does not state it is the only acceptable "
            "verification, so this is offered rather than required."
        ),
    )


def _h1028_mbic_applies(context: PacketContext) -> Applicability:
    """H1028-MBIC applies only to Medicaid Buy-In for Children.

    Not to employment in general. This is the form most likely to be
    mis-applied, because its title reads "Employment Verification" and every
    household with a job looks like a match. It is not: MBIC is a specific
    program for children with disabilities whose family income is above regular
    Medicaid limits, and this form gathers the employer-provided health
    insurance information that program turns on.

    This product does not screen for MBIC, so the rule can only ever return
    NOT_APPLICABLE today. It is written out in full anyway, because the
    alternative — leaving the form out of the catalog — would mean a household
    that later selects MBIC silently gets no verification form at all.
    """
    program = "tx_medicaid_buy_in_children"

    if program not in context.selected_programs:
        return not_applicable(
            "tx_h1028_mbic_not_a_buy_in_application",
            evidence=("selected_programs",),
        )

    employment = "income.has_earned_income"

    if not context.answered_yes(employment):
        return not_applicable("tx_h1028_mbic_no_employment", evidence=(employment,))

    return Applicability(
        requirement=Requirement.NEEDS_CONFIRMATION,
        reason_key="tx_h1028_mbic_employment_reported_for_buy_in",
        evidence=(employment,),
        citation=(
            "HHSC Form H1028-MBIC purpose: 'an employer-completed verification "
            "of employment, wages and job-related health insurance "
            "information', given with MBIC applications and redeterminations. "
            "The employer completes it after the parent provides it to them."
        ),
    )


#: The Texas catalog.
TX_CATALOG: tuple[CatalogEntry, ...] = (
    CatalogEntry(
        form_id="TX_H1010",
        form_code="H1010",
        title="Texas Works Application for Assistance — Your Texas Benefits",
        state="TX",
        category=FormCategory.MAIN_APPLICATION,
        programs=_H1010_PROGRAMS,
        applies=_h1010_applies,
    ),
    CatalogEntry(
        form_id="TX_H1049",
        form_code="H1049",
        title="Client's Statement of Self-Employment Income",
        state="TX",
        category=FormCategory.APPLICANT_VERIFICATION,
        programs=frozenset({"tx_snap", "tx_tanf", "tx_medicaid", "tx_chip"}),
        applies=_h1049_applies,
    ),
    CatalogEntry(
        form_id="TX_H3037",
        form_code="H3037",
        title="Report of Pregnancy",
        state="TX",
        category=FormCategory.THIRD_PARTY_VERIFICATION,
        programs=frozenset({"tx_medicaid", "tx_chip", "tx_healthy_texas_women"}),
        applies=_h3037_applies,
    ),
    CatalogEntry(
        form_id="TX_H1028_MBIC",
        form_code="H1028-MBIC",
        title="Employment Verification (Medicaid Buy-In for Children)",
        state="TX",
        category=FormCategory.THIRD_PARTY_VERIFICATION,
        programs=frozenset({"tx_medicaid_buy_in_children"}),
        applies=_h1028_mbic_applies,
        # The document we hold prints 12-2015 against HHSC's current effective
        # date of 9/2024. Registered so the catalog is honest that the form
        # exists, kept out of the filling path until the current revision is in
        # hand. See tx_documents.TX_H1028_MBIC_EN.
        fillable=False,
        unavailable_reason_key="tx_h1028_mbic_superseded_revision",
    ),
)
