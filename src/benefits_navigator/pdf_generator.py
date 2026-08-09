"""Generate official state benefit application PDFs."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

_FORMS_DIR = Path(__file__).parent / "forms"

_SAWS2_PLUS_TEMPLATE = _FORMS_DIR / "CA-SAWS-2-PLUS.pdf"

_SAWS2_PLUS_URL = (
    "https://www.cdss.ca.gov/cdssweb/entres/forms/English/SAWS2_PLUS.pdf"
)

_SENSITIVE_FIELD_MARKERS = (
    "ssn",
    "social security",
    "socialsecurity",
    "signature",
    "signed",
    "sign_",
    "rep_sign",
    "date_signed",
    "alien",
    "alein",
    "imdoc__num",
    "document_number",
)


class MissingApplicationInformation(ValueError):
    """Raised when one required non-sensitive application answer is missing."""

    def __init__(self, key: str, question: str) -> None:
        self.key = key
        self.question = question
        super().__init__(question)


def _parse_programs_from_output(workflow_output: str) -> list[str]:
    known = ["Medicaid", "Medi-Cal", "SNAP", "CalFresh", "WIC"]
    output_upper = workflow_output.upper()
    return [program for program in known if program.upper() in output_upper]


def _split_name(full_name: str) -> tuple[str, str, str]:
    parts = [part for part in full_name.strip().split() if part]
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], "", ""
    if len(parts) == 2:
        return parts[0], "", parts[1]
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def _none_to_blank(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text.lower() in {"none", "n/a", "not applicable"} else text


def _is_sensitive_pdf_field(field_name: str) -> bool:
    normalized = field_name.strip().lower()
    return any(marker in normalized for marker in _SENSITIVE_FIELD_MARKERS)


def _plan_item_is_sensitive(item: dict[str, Any]) -> bool:
    if bool(item.get("sensitive")):
        return True

    semantic_text = " ".join(
        str(item.get(key) or "")
        for key in ("profile_key", "question", "label", "description")
    ).lower()
    if any(marker in semantic_text for marker in _SENSITIVE_FIELD_MARKERS):
        return True

    field_names: list[str] = []
    pdf_fields = item.get("pdf_fields") or []
    if isinstance(pdf_fields, str):
        field_names.append(pdf_fields)
    elif isinstance(pdf_fields, list):
        field_names.extend(str(field) for field in pdf_fields)

    for key in ("yes_field", "no_field"):
        field_name = item.get(key)
        if field_name:
            field_names.append(str(field_name))

    choices = item.get("choices") or {}
    if isinstance(choices, dict):
        field_names.extend(str(field) for field in choices.values())

    return any(_is_sensitive_pdf_field(name) for name in field_names)


def _json_safe_pdf_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_safe_pdf_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _json_safe_pdf_value(item)
            for key, item in value.items()
        }
    return str(value)


def load_application_profile(path: Path) -> dict[str, Any]:
    """Load saved application answers from JSON."""
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as profile_file:
        data = json.load(profile_file)
    if not isinstance(data, dict):
        raise ValueError("Application profile JSON must contain an object.")
    return data


def save_application_profile(path: Path, profile: dict[str, Any]) -> None:
    """Persist collected non-sensitive answers as JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as profile_file:
        json.dump(profile, profile_file, indent=2, ensure_ascii=False)
        profile_file.write("\n")


def _get_profile_value(profile: dict[str, Any], dotted_key: str) -> Any:
    value: Any = profile
    for part in dotted_key.split("."):
        if isinstance(value, list):
            try:
                value = value[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return None
    return value


def _set_profile_value(profile: dict[str, Any], dotted_key: str, value: Any) -> None:
    parts = dotted_key.split(".")
    target: Any = profile

    for index, part in enumerate(parts[:-1]):
        next_part = parts[index + 1]
        if isinstance(target, list):
            list_index = int(part)
            while len(target) <= list_index:
                target.append({} if not next_part.isdigit() else [])
            target = target[list_index]
        else:
            if part not in target or not isinstance(target[part], (dict, list)):
                target[part] = [] if next_part.isdigit() else {}
            target = target[part]

    final_part = parts[-1]
    if isinstance(target, list):
        list_index = int(final_part)
        while len(target) <= list_index:
            target.append(None)
        target[list_index] = value
    else:
        target[final_part] = value


def next_application_question(
    profile: dict[str, Any],
    field_plan: list[dict[str, Any]],
) -> tuple[str, str] | None:
    """Return exactly one missing required non-sensitive question."""
    for item in field_plan:
        if not isinstance(item, dict):
            continue
        if not bool(item.get("required", True)):
            continue
        if _plan_item_is_sensitive(item):
            continue

        key = str(item.get("profile_key") or "").strip()
        question = str(item.get("question") or "").strip()
        if not key or not question:
            continue

        value = _get_profile_value(profile, key)
        if value is None or value == "":
            return key, question

    return None


def record_application_answer(
    path: Path,
    key: str,
    answer: str,
    field_plan: list[dict[str, Any]],
) -> dict[str, Any]:
    """Save one answer unless its field is sensitive."""
    matching_item = next(
        (
            item
            for item in field_plan
            if isinstance(item, dict)
            and str(item.get("profile_key") or "").strip() == key
        ),
        None,
    )
    if matching_item is None:
        raise KeyError(f"Unknown application question key: {key}")
    if _plan_item_is_sensitive(matching_item):
        raise ValueError(
            "Sensitive information such as Social Security numbers, immigration "
            "document numbers, and signatures must be entered directly into the PDF."
        )

    profile = load_application_profile(path)
    _set_profile_value(profile, key, answer.strip())
    save_application_profile(path, profile)
    return profile


def require_complete_application_profile(
    profile: dict[str, Any],
    field_plan: list[dict[str, Any]],
) -> None:
    """Raise with one missing non-sensitive question."""
    missing = next_application_question(profile, field_plan)
    if missing is not None:
        key, question = missing
        raise MissingApplicationInformation(key, question)


def inspect_pdf_form(pdf_path: Path) -> list[dict[str, Any]]:
    """Inspect the real official PDF and return its fillable field inventory."""
    reader = PdfReader(str(pdf_path))
    inventory: list[dict[str, Any]] = []
    for name, field in (reader.get_fields() or {}).items():
        inventory.append(
            {
                "name": name,
                "field_type": str(field.get("/FT") or ""),
                "options": _json_safe_pdf_value(field.get("/Opt")),
                "sensitive": _is_sensitive_pdf_field(name),
            }
        )
    return inventory


def _extract_values(args: dict[str, Any]) -> dict[str, str]:
    application_data = args.get("application_data") or {}
    if not isinstance(application_data, dict):
        raise ValueError("application_data must be a dictionary.")

    merged_args = {**args, **application_data}
    profile = str(merged_args.get("household_profile") or "")
    zip_code = str(merged_args.get("zip_code") or "").strip()
    if not zip_code:
        match = re.search(r"\b(\d{5})\b", profile)
        if match:
            zip_code = match.group(1)

    return {
        "state": str(merged_args.get("state") or "CA").strip().upper(),
        "zip_code": zip_code,
    }


def _download_template(destination: Path) -> None:
    """Ensure the official CDSS SAWS 2 PLUS template exists at destination."""
    destination.parent.mkdir(parents=True, exist_ok=True)

    if _SAWS2_PLUS_TEMPLATE.exists():
        destination.write_bytes(_SAWS2_PLUS_TEMPLATE.read_bytes())
        return

    request = urllib.request.Request(
        _SAWS2_PLUS_URL,
        headers={
            "User-Agent": "Mozilla/5.0 Kealu-Benefits-Navigator/1.0",
            "Accept": "application/pdf,*/*;q=0.8",
        },
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()

    if not data.startswith(b"%PDF-"):
        raise RuntimeError(
            "CDSS SAWS 2 PLUS source did not return a valid PDF."
        )

    destination.write_bytes(data)


def _canonical_values_from_plan(
    field_plan: list[dict[str, Any]],
) -> dict[str, Any]:
    """Normalize the form-independent TypeScript field plan."""
    values: dict[str, Any] = {}

    for item in field_plan:
        if not isinstance(item, dict):
            continue

        key = str(item.get("key") or "").strip()

        if not key:
            continue

        if _is_sensitive_semantic_key(key):
            raise ValueError(
                f"Sensitive application field cannot be prefilled: {key}"
            )

        value = item.get("value")

        if value is None:
            continue

        if isinstance(value, str):
            value = _none_to_blank(value)

            if not value:
                continue

        values[key] = value

    return values


def _is_sensitive_semantic_key(key: str) -> bool:
    normalized = key.strip().lower()

    return any(
        marker in normalized
        for marker in _SENSITIVE_FIELD_MARKERS
    )


def _full_name(
    values: dict[str, Any],
    prefix: str,
    *,
    last_first: bool = False,
) -> str:
    first = str(
        values.get(f"{prefix}.first_name") or ""
    ).strip()

    middle = str(
        values.get(f"{prefix}.middle_name") or ""
    ).strip()

    last = str(
        values.get(f"{prefix}.last_name") or ""
    ).strip()

    if last_first:
        middle_initial = f" {middle[0]}." if middle else ""
        return f"{last}, {first}{middle_initial}".strip(" ,")

    return " ".join(
        part
        for part in (first, middle, last)
        if part
    )


def _format_date(date_value: str) -> str:
    try:
        parsed = datetime.strptime(
            date_value,
            "%Y-%m-%d",
        )
    except (TypeError, ValueError):
        return date_value

    return parsed.strftime("%m/%d/%Y")


def _age_on_date(
    date_of_birth: str,
    today: datetime | None = None,
) -> int | None:
    try:
        born = datetime.strptime(
            date_of_birth,
            "%Y-%m-%d",
        )
    except (TypeError, ValueError):
        return None

    today = today or datetime.now(
        tz=timezone.utc
    )

    return (
        today.year
        - born.year
        - (
            (today.month, today.day)
            < (born.month, born.day)
        )
    )


class Saws2PlusFieldAdapter:
    """Translate canonical values to the official SAWS 2 PLUS PDF.

    The SAWS PDF uses generic field names such as `Text3 PG 1`.
    Therefore security cannot rely only on names containing words such
    as `ssn` or `signature`.

    Only explicitly reviewed destination fields may ever be written.
    """

    TEXT_FIELDS: dict[str, str] = {
        "applicant.home_address.street": "Text4 PG 1",
        "applicant.home_address.apartment": "Text5 PG 1",
        "applicant.home_address.city": "Text6 PG 1",
        "applicant.home_address.county": "Text7 PG 1",
        "applicant.home_address.state": "Text8 PG 1",
        "applicant.home_address.zip_code": "Text9 PG 1",

        "applicant.mailing_address.street": "Text10 PG 1",
        "applicant.mailing_address.apartment": "Text11 PG 1",
        "applicant.mailing_address.city": "Text12 PG 1",
        "applicant.mailing_address.county": "Text13 PG 1",
        "applicant.mailing_address.state": "Text14 PG 1",
        "applicant.mailing_address.zip_code": "Text15 PG 1",

        "applicant.phone": "Text20 PG 1",
        "applicant.email": "Text22 PG 1",
    }

    PROGRAM_FIELDS: dict[str, str] = {
        "programs.calfresh": "Check Box23 PG 1",
        "programs.calworks": "Check Box24PG 1",
        "programs.medi_cal": "Check Box25 PG 1",
    }

    YES_NO_FIELDS: dict[str, tuple[str, str]] = {
        "applicant.email_application_information": (
            "Check Box16 PG 1",
            "Check Box17 PG 1",
        ),
        "applicant.email_case_messages": (
            "Check Box18 PG 1",
            "Check Box19 PG 1",
        ),
        "applicant.needs_disability_application_help": (
            "Check Box27A PG 1",
            "Check Box27B PG 1",
        ),
        "household.homeless": (
            "Check Box28 PG 1",
            "Check Box29 PG 1",
        ),

        "household.expedited.gross_income_under_150_and_resources_under_100": (
            "Check Box33 PG 1",
            "Check Bo34 PG 1",
        ),
        "household.expedited.utilities_shut_off_or_notice": (
            "Check Box35 PG 1",
            "Check Box36 PG 1",
        ),
        "household.expedited.income_and_resources_less_than_housing_costs": (
            "Check Box37 PG 1",
            "Check Box38 PG 1",
        ),
        "household.expedited.food_runs_out_within_three_days": (
            "Check Box39 PG 1",
            "Check Box40 PG 1",
        ),
        "household.expedited.migrant_or_seasonal_farm_worker": (
            "Check Box41 PG 1",
            "Check Box42 PG 1",
        ),
        "household.expedited.needs_transportation_for_emergency_needs": (
            "Check Box43 PG 1",
            "Check Box44 PG 1",
        ),
        "household.expedited.eviction_notice": (
            "Check Box45 PG 1",
            "Check Box46 PG 1",
        ),
        "household.expedited.needs_essential_clothing": (
            "Check Box47 PG 1",
            "Check Box48 PG 1",
        ),

        "household.anyone_pregnant": (
            "Check Box49 PG 1",
            "Check Box50 PG 1",
        ),
        "household.pregnancy.presumptive_eligibility_card": (
            "Check Box51 PG 1",
            "Check Box52 PG 1",
        ),

        "household.personal_emergency.has_emergency": (
            "Check Box53 PG 1",
            "Check Box54 PG 1",
        ),
    }

    SINGLE_CHECKBOX_FIELDS: dict[str, str] = {
        "applicant.deaf_or_hard_of_hearing": "Check Box32 PG 1",

        "household.personal_emergency.pregnancy": "Check Box55 PG 1",
        "household.personal_emergency.immediate_medical_need": "Check Box56 PG 1",
        "household.personal_emergency.child_abuse": "Check Box57 PG 1",
        "household.personal_emergency.domestic_abuse": "Check Box58 PG 1",
        "household.personal_emergency.elder_abuse": "Check Box59 PG 1",
        "household.personal_emergency.other": "Check Box60 PG 1",
    }

    PERSON_PROGRAM_INDEX = {
        "calfresh": 0,
        "calworks": 1,
        "medi_cal": 2,
    }

    ADULT_STATUS_INDEX = {
        "single": 0,
        "married": 1,
        "separated": 2,
        "divorced": 3,
        "widowed": 4,
        "full_time_student": 5,
        "disabled": 6,
    }

    CHILD_STATUS_INDEX = {
        "parent_not_in_home": 0,
        "parent_unemployed": 1,
        "parent_disabled": 2,
        "parent_deceased": 3,
        "parent_none": 4,
        "full_time_student": 5,
        "immunizations_up_to_date": 6,
    }

        # -----------------------------------------------------------------------
    # Household person tables — SAWS 2 PLUS Pages 3 and 4
    # -----------------------------------------------------------------------
    #
    # These mappings were reviewed against the actual AcroForm widget
    # coordinates in the official SAWS 2 PLUS PDF.
    #
    # IMPORTANT:
    # The SSN text fields are intentionally NOT represented anywhere below.
    #
    # Adult SSN fields excluded:
    #   Text17B PG 3
    #   Text35 PG 3
    #   Text53 PG 3
    #   Text71 PG 3
    #   Text89 PG 3
    #
    # Child SSN fields excluded:
    #   Text19 PG 4
    #   Text38 PG 4
    #   Text57 PG 4
    #   Text76 PG 4
    #   Text95 PG 4
    #
    # Because those destinations never enter these row definitions, they also
    # never enter SAFE_FIELDS and cannot be written through set_field().

    ADULT_ROWS = (
        {
            "programs": (
                "Check Box1 PG 3",
                "Check Box2 PG 3",
                "Check Box3 PG 3",
                "Check Box4 PG 3",
            ),
            "name": "Text5 PG 3",
            "relationship": "Text6 PG 3",
            "dob": "Text7 PG 3",
            "sex": "Text8 PG 3",
            "statuses": (
                "Check Box9 PG 3",
                "Check Box10 PG 3",
                "Check Box11 PG 3",
                "Check Box12 PG 3",
                "Check Box13 PG 3",
                "Check Box14 PG 3",
                "Check Box15 PG 3",
            ),
            "citizen_yes": "Check Box16 PG 3",
            "citizen_no": "Check Box17 PG 3",
        },
        {
            "programs": (
                "Check Box18 PG 3",
                "Check Box19 PG 3",
                "Check Box20 PG 3",
                "Check Box21 PG 3",
            ),
            "name": "Text22 PG 3",
            "relationship": "Text23 PG 3",
            "dob": "Text24 PG 3",
            "sex": "Text25 PG 3",
            "statuses": (
                "Check Box26 PG 3",
                "Check Box27 PG 3",
                "Check Box28 PG 3",
                "Check Box29 PG 3",
                "Check Box30 PG 3",
                "Check Box31 PG 3",
                "Check Box32 PG 3",
            ),
            "citizen_yes": "Check Box33 PG 3",
            "citizen_no": "Check Box34 PG 3",
        },
        {
            "programs": (
                "Check Box36 PG 3",
                "Check Box37 PG 3",
                "Check Box38 PG 3",
                "Check Box39 PG 3",
            ),
            "name": "Text40 PG 3",
            "relationship": "Text41 PG 3",
            "dob": "Text42 PG 3",
            "sex": "Text43 PG 3",
            "statuses": (
                "Check Box44 PG 3",
                "Check Box45 PG 3",
                "Check Box46 PG 3",
                "Check Box47 PG 3",
                "Check Box48 PG 3",
                "Check Box49 PG 3",
                "Check Box50 PG 3",
            ),
            "citizen_yes": "Check Box51 PG 3",
            "citizen_no": "Check Box52 PG 3",
        },
        {
            "programs": (
                "Check Box54 PG 3",
                "Check Box55 PG 3",
                "Check Box56 PG 3",
                "Check Box57 PG 3",
            ),
            "name": "Text58 PG 3",
            "relationship": "Text59 PG 3",
            "dob": "Text60 PG 3",
            "sex": "Text61 PG 3",
            "statuses": (
                "Check Box62 PG 3",
                "Check Box63 PG 3",
                "Check Box64 PG 3",
                "Check Box65 PG 3",
                "Check Box66 PG 3",
                "Check Box67 PG 3",
                "Check Box68 PG 3",
            ),
            "citizen_yes": "Check Box69 PG 3",
            "citizen_no": "Check Box70 PG 3",
        },
        {
            "programs": (
                "Check Box72 PG 3",
                "Check Box73 PG 3",
                "Check Box74 PG 3",
                "Check Box75 PG 3",
            ),
            "name": "Text76 PG 3",
            "relationship": "Text77 PG 3",
            "dob": "Text78 PG 3",
            "sex": "Text79 PG 3",
            "statuses": (
                "Check Box80 PG 3",
                "Check Box81 PG 3",
                "Check Box82 PG 3",
                "Check Box83 PG 3",
                "Check Box84 PG 3",
                "Check Box85 PG 3",
                "Check Box86 PG 3",
            ),
            "citizen_yes": "Check Box87 PG 3",
            "citizen_no": "Check Box88 PG 3",
        },
    )

    CHILD_ROWS = (
        {
            "programs": (
                "Check Box1 PG 4",
                "Check Box2 PG 4",
                "Check Box3 PG 4",
                "Check Box4 PG 4",
            ),
            "name": "Text5 PG 4",
            "relationship": "Text6 PG 4",
            "dob": "Text7 PG 4",
            "place_of_birth": "Text8 PG 4",
            "sex": "Text9 PG 4",
            "statuses": (
                "Check Box10 PG 4",
                "Check Box11 PG 4",
                "Check Box12 PG 4",
                "Check Box13 PG 4",
                "Check Box14 PG 4",
                "Check Box15 PG 4",
                "Check Box16 PG 4",
            ),
            "citizen_yes": "Check Box17 PG 4",
            "citizen_no": "Check Box18 PG 4",
        },
        {
            "programs": (
                "Check Box20 PG 4",
                "Check Box21 PG 4",
                "Check Box22 PG 4",
                "Check Box23 PG 4",
            ),
            "name": "Text24 PG 4",
            "relationship": "Text25 PG 4",
            "dob": "Text26 PG 4",
            "place_of_birth": "Text27 PG 4",
            "sex": "Text28 PG 4",
            "statuses": (
                "Check Box29 PG 4",
                "Check Box30 PG 4",
                "Check Box31 PG 4",
                "Check Box32 PG 4",
                "Check Box33 PG 4",
                "Check Box34 PG 4",
                "Check Box35 PG 4",
            ),
            "citizen_yes": "Check Box36 PG 4",
            "citizen_no": "Check Box37 PG 4",
        },
        {
            "programs": (
                "Check Box39 PG 4",
                "Check Box40 PG 4",
                "Check Box41 PG 4",
                "Check Box42 PG 4",
            ),
            "name": "Text43 PG 4",
            "relationship": "Text44 PG 4",
            "dob": "Text45 PG 4",
            "place_of_birth": "Text46 PG 4",
            "sex": "Text47 PG 4",
            "statuses": (
                "Check Box48 PG 4",
                "Check Box49 PG 4",
                "Check Box50 PG 4",
                "Check Box51 PG 4",
                "Check Box52 PG 4",
                "Check Box53 PG 4",
                "Check Box54 PG 4",
            ),
            "citizen_yes": "Check Box55 PG 4",
            "citizen_no": "Check Box56 PG 4",
        },
        {
            "programs": (
                "Check Box58 PG 4",
                "Check Box59 PG 4",
                "Check Box60 PG 4",
                "Check Box61 PG 4",
            ),
            "name": "Text62 PG 4",
            "relationship": "Text63 PG 4",
            "dob": "Text64 PG 4",
            "place_of_birth": "Text65 PG 4",
            "sex": "Text66 PG 4",
            "statuses": (
                "Check Box67 PG 4",
                "Check Box68 PG 4",
                "Check Box69 PG 4",
                "Check Box70 PG 4",
                "Check Box71 PG 4",
                "Check Box72 PG 4",
                "Check Box73 PG 4",
            ),
            "citizen_yes": "Check Box74 PG 4",
            "citizen_no": "Check Box75 PG 4",
        },
        {
            "programs": (
                "Check Box77 PG 4",
                "Check Box78 PG 4",
                "Check Box79 PG 4",
                "Check Box80 PG 4",
            ),
            "name": "Text81 PG 4",
            "relationship": "Text82 PG 4",
            "dob": "Text83 PG 4",
            "place_of_birth": "Text84 PG 4",
            "sex": "Text85 PG 4",
            "statuses": (
                "Check Box86 PG 4",
                "Check Box87 PG 4",
                "Check Box88 PG 4",
                "Check Box89 PG 4",
                "Check Box90 PG 4",
                "Check Box91 PG 4",
                "Check Box92 PG 4",
            ),
            "citizen_yes": "Check Box93 PG 4",
            "citizen_no": "Check Box94 PG 4",
        },
    )

    # Program columns in the person tables.
    #
    # The fourth checkbox is the form's "None" column. We deliberately do not
    # automatically check it merely because `applyingFor` is empty: an empty
    # list may also mean the user has not answered the per-person question.
    PERSON_PROGRAM_INDEX = {
        "calfresh": 0,
        "calworks": 1,
        "medi_cal": 2,
    }

    # Seven adult status columns:
    # Single, Married, Separated, Divorced, Widowed,
    # Full-Time Student, Disabled.
    ADULT_STATUS_INDEX = {
        "single": 0,
        "married": 1,
        "separated": 2,
        "divorced": 3,
        "widowed": 4,
        "full_time_student": 5,
        "disabled": 6,
    }

    # Seven child status columns:
    # Parent not in home, parent unemployed, parent disabled,
    # parent deceased, none of those parent conditions,
    # full-time student, shots/immunizations up to date.
    #
    # A child's own disability is collected in the semantic application model
    # for later SAWS questions, but it does NOT map to one of these seven
    # Page 4 row checkboxes.
    CHILD_STATUS_INDEX = {
        "parent_not_in_home": 0,
        "parent_unemployed": 1,
        "parent_disabled": 2,
        "parent_deceased": 3,
        "parent_none": 4,
        "full_time_student": 5,
        "immunizations_up_to_date": 6,
    }

    SAFE_FIELDS = frozenset(
        {
            # Page 1 applicant name.
            "Text1 PG 1",

            # Preferred read/spoken language.
            "Text30 PG 1",
            "Text31 PG 1",

            *TEXT_FIELDS.values(),
            *PROGRAM_FIELDS.values(),

            *(
                field
                for pair in YES_NO_FIELDS.values()
                for field in pair
            ),

            *SINGLE_CHECKBOX_FIELDS.values(),

            # Every destination in the reviewed adult household rows.
            *(
                field
                for row in ADULT_ROWS
                for value in row.values()
                for field in (
                    value
                    if isinstance(value, tuple)
                    else (value,)
                )
            ),

            # Every destination in the reviewed child household rows.
            *(
                field
                for row in CHILD_ROWS
                for value in row.values()
                for field in (
                    value
                    if isinstance(value, tuple)
                    else (value,)
                )
            ),
        }
    )

    def map_values(
        self,
        canonical_values: dict[str, Any],
        available_fields: set[str],
    ) -> dict[str, str]:
        """Translate canonical application values into reviewed SAWS fields."""

        values: dict[str, str] = {}

        def set_field(
            field_name: str,
            value: Any,
        ) -> None:
            """Write only to an explicitly reviewed destination field."""

            if field_name not in self.SAFE_FIELDS:
                raise RuntimeError(
                    "Unreviewed SAWS 2 PLUS field destination: "
                    f"{field_name}"
                )

            if field_name not in available_fields:
                return

            text = _none_to_blank(value)

            if text:
                values[field_name] = text

        def format_sex(value: Any) -> str:
            """Convert semantic sex values to the M/F format used by SAWS."""

            normalized = str(value or "").strip().lower()

            if normalized in {"male", "m"}:
                return "M"

            if normalized in {"female", "f"}:
                return "F"

            return ""

        def apply_programs(
            row: dict[str, Any],
            prefix: str,
        ) -> None:
            """Fill explicit per-person program selections."""

            program_fields = row["programs"]

            for program, field_index in self.PERSON_PROGRAM_INDEX.items():
                if canonical_values.get(
                    f"{prefix}.applying_for.{program}"
                ) is True:
                    set_field(
                        program_fields[field_index],
                        "/Yes",
                    )

        # -------------------------------------------------------------------
        # Page 1
        # -------------------------------------------------------------------

        # Applicant name.
        set_field(
            "Text1 PG 1",
            _full_name(
                canonical_values,
                "applicant",
            ),
        )

        # Home / mailing address and contact information.
        same_mailing = bool(
            canonical_values.get(
                "applicant.mailing_address_same_as_home",
                False,
            )
        )

        for key, pdf_field in self.TEXT_FIELDS.items():
            if (
                same_mailing
                and key.startswith(
                    "applicant.mailing_address."
                )
            ):
                continue

            set_field(
                pdf_field,
                canonical_values.get(key),
            )

        # English is already the default language printed on the form.
        language = str(
            canonical_values.get(
                "applicant.preferred_language"
            )
            or ""
        ).strip()

        if (
            language
            and language.lower() != "english"
        ):
            set_field(
                "Text30 PG 1",
                language,
            )

            set_field(
                "Text31 PG 1",
                language,
            )

        # Programs requested by the application as a whole.
        for key, pdf_field in self.PROGRAM_FIELDS.items():
            if canonical_values.get(key) is True:
                set_field(
                    pdf_field,
                    "/Yes",
                )

        # Explicit Page 1 yes/no questions.
        #
        # Missing/unasked questions remain blank rather than being treated as
        # an implicit No.
        for (
            key,
            (yes_field, no_field),
        ) in self.YES_NO_FIELDS.items():
            value = canonical_values.get(key)

            if not isinstance(value, bool):
                continue

            set_field(
                yes_field if value else no_field,
                "/Yes",
            )

        # Standalone Page 1 checkboxes have no paired No destination.
        for (
            key,
            pdf_field,
        ) in self.SINGLE_CHECKBOX_FIELDS.items():
            if canonical_values.get(key) is True:
                set_field(
                    pdf_field,
                    "/Yes",
                )

        # -------------------------------------------------------------------
        # Build semantic household-person records.
        # -------------------------------------------------------------------

        adults: list[dict[str, Any]] = []
        children: list[dict[str, Any]] = []

        # The primary applicant also belongs in the household table.
        applicant_name = _full_name(
            canonical_values,
            "applicant",
            last_first=True,
        )

        applicant_dob = str(
            canonical_values.get(
                "applicant.date_of_birth"
            )
            or ""
        ).strip()

        if applicant_name:
            applicant_age = _age_on_date(
                applicant_dob
            )

            applicant_record = {
                "name": applicant_name,
                "relationship": "self",
                "dob": _format_date(
                    applicant_dob
                ),
                "raw_dob": applicant_dob,
                "prefix": "applicant.household",
            }

            if (
                applicant_age is not None
                and applicant_age < 18
            ):
                children.append(
                    applicant_record
                )
            else:
                adults.append(
                    applicant_record
                )

        # Additional household members.
        index = 0

        while (
            f"household.members.{index}.first_name"
            in canonical_values
        ):
            prefix = (
                f"household.members.{index}"
            )

            dob = str(
                canonical_values.get(
                    f"{prefix}.date_of_birth"
                )
                or ""
            ).strip()

            age = _age_on_date(
                dob
            )

            record = {
                "name": _full_name(
                    canonical_values,
                    prefix,
                    last_first=True,
                ),
                "relationship": str(
                    canonical_values.get(
                        f"{prefix}.relationship_to_applicant"
                    )
                    or ""
                ),
                "dob": _format_date(
                    dob
                ),
                "raw_dob": dob,
                "prefix": prefix,
            }

            if (
                age is not None
                and age < 18
            ):
                children.append(
                    record
                )
            else:
                adults.append(
                    record
                )

            index += 1

        # -------------------------------------------------------------------
        # Page 3 — adult household rows
        # -------------------------------------------------------------------

        for row, person in zip(
            self.ADULT_ROWS,
            adults,
        ):
            prefix = str(
                person["prefix"]
            )

            # Primary applicant fields use applicant.household.* while
            # additional adults use household.members.N.adult.*.
            if prefix == "applicant.household":
                details_prefix = prefix
            else:
                details_prefix = (
                    f"{prefix}.adult"
                )

            set_field(
                row["name"],
                person["name"],
            )

            set_field(
                row["relationship"],
                person["relationship"],
            )

            set_field(
                row["dob"],
                person["dob"],
            )

            set_field(
                row["sex"],
                format_sex(
                    canonical_values.get(
                        f"{details_prefix}.sex"
                    )
                ),
            )

            # Per-person benefit participation.
            apply_programs(
                row,
                prefix,
            )

            statuses = row["statuses"]

            marital_status = str(
                canonical_values.get(
                    f"{details_prefix}.marital_status"
                )
                or ""
            ).strip().lower()

            marital_index = (
                self.ADULT_STATUS_INDEX.get(
                    marital_status
                )
            )

            if marital_index is not None:
                set_field(
                    statuses[marital_index],
                    "/Yes",
                )

            if canonical_values.get(
                f"{details_prefix}.full_time_student"
            ) is True:
                set_field(
                    statuses[
                        self.ADULT_STATUS_INDEX[
                            "full_time_student"
                        ]
                    ],
                    "/Yes",
                )

            if canonical_values.get(
                f"{details_prefix}.disabled"
            ) is True:
                set_field(
                    statuses[
                        self.ADULT_STATUS_INDEX[
                            "disabled"
                        ]
                    ],
                    "/Yes",
                )

            citizen = canonical_values.get(
                f"{details_prefix}.citizen_or_national"
            )

            if isinstance(
                citizen,
                bool,
            ):
                set_field(
                    (
                        row["citizen_yes"]
                        if citizen
                        else row["citizen_no"]
                    ),
                    "/Yes",
                )

        # -------------------------------------------------------------------
        # Page 4 — child household rows
        # -------------------------------------------------------------------

        for row, person in zip(
            self.CHILD_ROWS,
            children,
        ):
            prefix = str(
                person["prefix"]
            )

            # A minor primary applicant currently shares the applicant
            # household namespace. Other children use the dedicated child
            # namespace from the TypeScript canonical model.
            if prefix == "applicant.household":
                details_prefix = prefix
            else:
                details_prefix = (
                    f"{prefix}.child"
                )

            set_field(
                row["name"],
                person["name"],
            )

            set_field(
                row["relationship"],
                person["relationship"],
            )

            set_field(
                row["dob"],
                person["dob"],
            )

            set_field(
                row["place_of_birth"],
                canonical_values.get(
                    f"{details_prefix}.place_of_birth"
                ),
            )

            set_field(
                row["sex"],
                format_sex(
                    canonical_values.get(
                        f"{details_prefix}.sex"
                    )
                ),
            )

            # Per-person benefit participation.
            apply_programs(
                row,
                prefix,
            )

            statuses = row["statuses"]

            # Parent-status checkboxes.
            child_status_keys = {
                "parent_not_in_home":
                    "parent_status.not_in_home",
                "parent_unemployed":
                    "parent_status.unemployed",
                "parent_disabled":
                    "parent_status.disabled",
                "parent_deceased":
                    "parent_status.deceased",
                "parent_none":
                    "parent_status.none",
                "full_time_student":
                    "full_time_student",
                "immunizations_up_to_date":
                    "immunizations_up_to_date",
            }

            for (
                status_name,
                canonical_suffix,
            ) in child_status_keys.items():
                if canonical_values.get(
                    f"{details_prefix}.{canonical_suffix}"
                ) is True:
                    set_field(
                        statuses[
                            self.CHILD_STATUS_INDEX[
                                status_name
                            ]
                        ],
                        "/Yes",
                    )

            citizen = canonical_values.get(
                f"{details_prefix}.citizen_or_national"
            )

            if isinstance(
                citizen,
                bool,
            ):
                set_field(
                    (
                        row["citizen_yes"]
                        if citizen
                        else row["citizen_no"]
                    ),
                    "/Yes",
                )

        # Final defensive check immediately before returning PDF destinations.
        self.assert_safe(
            values
        )

        return values

    def assert_safe(
        self,
        values: dict[str, str],
    ) -> None:
        unreviewed = sorted(
            set(values)
            - self.SAFE_FIELDS
        )

        if unreviewed:
            raise RuntimeError(
                "Unreviewed SAWS 2 PLUS fields reached "
                "the PDF write boundary: "
                + ", ".join(unreviewed)
            )
        
def generate_application_pdf(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path:
    """Inspect, validate, and prefill the official CDSS SAWS 2 PLUS PDF."""

    field_plan = args.get(
        "application_field_plan"
    )

    if (
        not isinstance(field_plan, list)
        or not field_plan
    ):
        raise ValueError(
            "application_field_plan must be a non-empty list."
        )

    if output_dir is None:
        output_dir = (
            Path.home()
            / "Documents"
            / "benefits-applications"
        )

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    canonical_values = (
        _canonical_values_from_plan(
            field_plan
        )
    )

    values = _extract_values(args)

    if values["state"] != "CA":
        raise NotImplementedError(
            "Official SAWS 2 PLUS generation is only "
            "available for California, not "
            f"{values['state'] or 'the selected state'}."
        )

    timestamp = datetime.now(
        tz=timezone.utc
    ).strftime(
        "%Y%m%d-%H%M%S"
    )

    zip_code = (
        values["zip_code"]
        or "unknown"
    )

    template_path = (
        output_dir
        / "official-ca-saws-2-plus-template.pdf"
    )

    output_path = (
        output_dir
        / (
            "official-ca-saws-2-plus-"
            f"{zip_code}-{timestamp}.pdf"
        )
    )

    inventory_path = (
        output_dir
        / "official-ca-saws-2-plus-field-inventory.json"
    )

    _download_template(
        template_path
    )

    field_inventory = (
        inspect_pdf_form(
            template_path
        )
    )

    inventory_path.write_text(
        json.dumps(
            field_inventory,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    reader = PdfReader(
        str(template_path)
    )

    available_fields = set(
        (
            reader.get_fields()
            or {}
        ).keys()
    )

    adapter = (
        Saws2PlusFieldAdapter()
    )

    requested_fields = (
        adapter.map_values(
            canonical_values,
            available_fields,
        )
    )

    adapter.assert_safe(
        requested_fields
    )

    if not requested_fields:
        raise RuntimeError(
            "The application did not contain any safe "
            "values that can be mapped to SAWS 2 PLUS."
        )

    writer = PdfWriter()

    writer.clone_document_from_reader(
        reader
    )

    for page in writer.pages:
        writer.update_page_form_field_values(
            page,
            requested_fields,
            auto_regenerate=True,
        )

    with output_path.open(
        "wb"
    ) as output_file:
        writer.write(
            output_file
        )

    output_path.with_suffix(
        ".review.txt"
    ).write_text(
        "Review every page before submitting.\n"
        "Social Security numbers, immigration document numbers, "
        "signatures, and signature dates were intentionally left blank.\n"
        "Only reviewed SAWS 2 PLUS fields are eligible for automatic "
        "prefilling.\n"
        "Enter remaining required items directly into the PDF, then verify "
        "every answer, sign, and date the application.\n",
        encoding="utf-8",
    )

    return output_path