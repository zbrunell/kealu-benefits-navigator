from __future__ import annotations

from benefits_navigator.pdf_generator import (
    Saws2PlusFieldAdapter,
    _canonical_values_from_plan,
)


def test_canonical_plan_rejects_sensitive_semantic_keys() -> None:
    try:
        _canonical_values_from_plan(
            [
                {
                    "key": "applicant.ssn",
                    "value": "123",
                }
            ]
        )
    except ValueError as exc:
        assert (
            "Sensitive application field"
            in str(exc)
        )
    else:
        raise AssertionError(
            "SSN semantic key was accepted"
        )


def test_adapter_maps_reviewed_applicant_fields_only() -> None:
    adapter = Saws2PlusFieldAdapter()

    canonical = {
        "applicant.first_name": "Ada",
        "applicant.middle_name": "M",
        "applicant.last_name": "Lovelace",
        "applicant.date_of_birth": "1990-12-10",
        "applicant.phone": "555-111-2222",
        "applicant.email": "ada@example.test",
        "applicant.preferred_language": "Spanish",

        "applicant.home_address.street": "1 Main St",
        "applicant.home_address.city": "Los Angeles",
        "applicant.home_address.county": "Los Angeles",
        "applicant.home_address.state": "CA",
        "applicant.home_address.zip_code": "90001",

        "applicant.mailing_address_same_as_home": True,

        "programs.medi_cal": True,
    }

    values = adapter.map_values(
        canonical,
        set(adapter.SAFE_FIELDS),
    )

    assert (
        values["Text1 PG 1"]
        == "Ada M Lovelace"
    )

    assert (
        values["Text4 PG 1"]
        == "1 Main St"
    )

    assert (
        values["Text22 PG 1"]
        == "ada@example.test"
    )

    assert (
        values["Text30 PG 1"]
        == "Spanish"
    )

    assert (
        values["Check Box25 PG 1"]
        == "/Yes"
    )

    # Applicant SSN
    assert "Text3 PG 1" not in values

    # Signature date
    assert "Text61 PG 1" not in values


def test_adapter_leaves_same_mailing_address_blank() -> None:
    adapter = Saws2PlusFieldAdapter()

    canonical = {
        "applicant.first_name": "Ada",
        "applicant.last_name": "Lovelace",

        "applicant.home_address.street":
            "1 Main St",

        "applicant.mailing_address_same_as_home":
            True,

        "applicant.mailing_address.street":
            "1 Main St",
    }

    values = adapter.map_values(
        canonical,
        set(adapter.SAFE_FIELDS),
    )

    assert (
        values["Text4 PG 1"]
        == "1 Main St"
    )

    assert (
        "Text10 PG 1"
        not in values
    )


def test_adapter_maps_adults_and_children_without_ssn_columns() -> None:
    adapter = Saws2PlusFieldAdapter()

    canonical = {
        "applicant.first_name":
            "Ada",

        "applicant.last_name":
            "Lovelace",

        "applicant.date_of_birth":
            "1990-12-10",

        "household.members.0.first_name":
            "Adult",

        "household.members.0.last_name":
            "Member",

        "household.members.0.date_of_birth":
            "1988-01-01",

        "household.members.0.relationship_to_applicant":
            "spouse",

        "household.members.1.first_name":
            "Child",

        "household.members.1.last_name":
            "Member",

        "household.members.1.date_of_birth":
            "2015-01-01",

        "household.members.1.relationship_to_applicant":
            "child",
    }

    values = adapter.map_values(
        canonical,
        set(adapter.SAFE_FIELDS),
    )

    assert (
        values["Text5 PG 3"]
        == "Lovelace, Ada"
    )

    assert (
        values["Text22 PG 3"]
        == "Member, Adult"
    )

    assert (
        values["Text5 PG 4"]
        == "Member, Child"
    )

    # Adult SSN column
    assert (
        "Text17B PG 3"
        not in values
    )

    # Child SSN column
    assert (
        "Text19 PG 4"
        not in values
    )


def test_final_allowlist_rejects_unreviewed_destination() -> None:
    adapter = Saws2PlusFieldAdapter()

    try:
        adapter.assert_safe(
            {
                # Applicant SSN field
                "Text3 PG 1":
                    "should never write",
            }
        )
    except RuntimeError as exc:
        assert (
            "Unreviewed SAWS 2 PLUS fields"
            in str(exc)
        )
    else:
        raise AssertionError(
            "Unreviewed destination was accepted"
        )