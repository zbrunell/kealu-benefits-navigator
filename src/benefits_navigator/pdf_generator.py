"""Generate official state benefit application PDFs."""

from __future__ import annotations

import json
import re
import urllib.request
import textwrap
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

        # Reviewed against the printed page-1 layout:
        #   name row  -> Text1 (name) | Text2 (other names) | Text3 (SSN)
        #   phone row -> Text20 (home) | Text21 (work/alternate/message)
        #                | Text22 (email)
        # Text3 is the SSN and is never written; see saws2_plus_inventory.
        "applicant.other_names": "Text2 PG 1",
        "applicant.alternate_phone": "Text21 PG 1",

        # "What programs are you applying for?" -> ... | Other ____
        "programs.other_description": "Text26B PG 1",
    }

    PROGRAM_FIELDS: dict[str, str] = {
        "programs.calfresh": "Check Box23 PG 1",
        "programs.calworks": "Check Box24PG 1",
        "programs.medi_cal": "Check Box25 PG 1",
        "programs.other": "Check Box26 PG 1",
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


    # -----------------------------------------------------------------------
    # Page 16 — program integrity, other services, third-party liability
    # -----------------------------------------------------------------------
    #
    # Reviewed against the printed page and the widget coordinates: page 16
    # holds ten aligned Yes/No pairs at x=467 (Yes) / x=500 (No) plus three
    # question-specific pairs and five free-text lines. Rows were matched by
    # descending y against the printed question order:
    #
    #   y=732  Q35 fleeing felon            Box1 / Box2   (+ Text3  "who?")
    #   y=677  Q36 probation/parole         Box4 / Box5   (+ Text6  "who?")
    #   y=619  Q37 special-need payment     Box7 / Box8   (+ Text9/Text10)
    #   y=485  Q38A CHDP information        Box11 / Box12
    #   y=473  Q38A CHDP medical            Box13 / Box14
    #   y=461  Q38A CHDP dental             Box15 / Box16
    #   y=449  Q38A CHDP appointment help   Box17 / Box18
    #   y=427  Q38B immunization            Box19 / Box20
    #   y=393  Q38C pregnancy help          Box21 / Box22
    #   y=371  Q38D breastfeeding           Box23 / Box24
    #   y=358  Q38D gave birth <12 months   Box25 / Box26
    #   y=302  Q38E family planning         Box27 / Box28
    #   y=233  Q39 third-party liability    Box29 / Box30 (+ Text31..Text34)

    PAGE_16_YES_NO: dict[str, tuple[str, str]] = {
        "integrity.fleeing_felon": ("Check Box1 PG 16", "Check Box2 PG 16"),
        "integrity.probation_or_parole_violation": (
            "Check Box4 PG 16",
            "Check Box5 PG 16",
        ),
        "services.special_needs_payment": ("Check Box7 PG 16", "Check Box8 PG 16"),
        "services.chdp_more_information": ("Check Box11 PG 16", "Check Box12 PG 16"),
        "services.chdp_medical": ("Check Box13 PG 16", "Check Box14 PG 16"),
        "services.chdp_dental": ("Check Box15 PG 16", "Check Box16 PG 16"),
        "services.chdp_appointment_help": ("Check Box17 PG 16", "Check Box18 PG 16"),
        "services.immunization_information": (
            "Check Box19 PG 16",
            "Check Box20 PG 16",
        ),
        "services.pregnancy_assistance": ("Check Box21 PG 16", "Check Box22 PG 16"),
        "services.breastfeeding": ("Check Box23 PG 16", "Check Box24 PG 16"),
        "services.gave_birth_last_twelve_months": (
            "Check Box25 PG 16",
            "Check Box26 PG 16",
        ),
        "services.family_planning": ("Check Box27 PG 16", "Check Box28 PG 16"),
        "services.third_party_liability": (
            "Check Box29 PG 16",
            "Check Box30 PG 16",
        ),
    }

    PAGE_16_TEXT: dict[str, str] = {
        "integrity.fleeing_felon_who": "Text3 PG 16",
        "integrity.probation_or_parole_who": "Text6 PG 16",
        "services.special_needs_explanation": "Text9 PG 16",
        "services.third_party_liability_who": "Text31 PG 16",
    }


    # -----------------------------------------------------------------------
    # Page 9 — Q8 earned income, Q8 job-change block, Q8a self-employment
    # -----------------------------------------------------------------------
    #
    # Verification basis: every column band below was confirmed by extracting the
    # printed header text with coordinates and matching each header's x-position
    # to the widget column it sits above, independently of field numbering.
    #
    #   header                                   header x   widget x-range
    #   "Person Working"                            56        32-141
    #   "Employer's Name and Address"              156/166   147-233
    #   "Employer's Phone Number"                  242/251   240-305
    #   "Hourly Rate"                              321/325   318-357
    #   "Average hours per week"                   361/371   361-400
    #   "How Often Paid? (Once weekly, monthly)"   411/427   406-472
    #   "Total Gross Earned Income Received
    #    This Month?"                              477/486   480-525
    #   "Expect to Continue? (Check Yes or No)"    529/532   537-550 (stacked)
    #
    # The Q8 table has exactly four printed rows and Q8a exactly three. Records
    # beyond those counts have nowhere to go on this page and are not written;
    # the form directs applicants to attach an additional sheet.

    #: Q8 rows: (person, employer name/address, employer phone, hourly rate,
    #: hours per week, how often paid, gross received this month,
    #: expect-to-continue Yes, expect-to-continue No)
    PAGE_9_EARNED_ROWS = (
        (
            "Text3 PG 9", "Text4 PG 9", "Text5 PG 9", "Text6 PG 9",
            "Text7 PG 9", "Text8 PG 9", "Text9 PG 9",
            "Check Box10 PG 9", "Check Box11 PG 9",
        ),
        (
            "Text12 PG 9", "Text13 PG 9", "Text14 PG 9", "Text15 PG 9",
            "Text16 PG 9", "Text17 PG 9", "Text18 PG 9",
            "Check Box19 PG 9", "Check Box20 PG 9",
        ),
        (
            "Text21 PG 9", "Text22 PG 9", "Text23 PG 9", "Text24 PG 9",
            "Text25 PG 9", "Text26 PG 9", "Text27 PG 9",
            "Check Box28 PG 9", "Check Box29 PG 9",
        ),
        (
            "Text30 PG 9", "Text31 PG 9", "Text32 PG 9", "Text33 PG 9",
            "Text34 PG 9", "Text35 PG 9", "Text36 PG 9",
            "Check Box37 PG 9", "Check Box38 PG 9",
        ),
    )

    #: Q8 gateway "Does anyone get income from a job?" (Yes x=300, No x=332).
    PAGE_9_EARNED_GATEWAY = ("Check Box1 PG 9", "Check Box2 PG 9")

    #: Q8 job-change block. Yes/No pairs verified against the printed prompts.
    PAGE_9_JOB_CHANGE_GATEWAY = ("Check Box40 PG 9", "Check Box41 PG 9")

    #: "IF YES, WHO?" / "DATE OF JOB LOSS, QUIT, OR CHANGE" / "REASON?"
    PAGE_9_JOB_CHANGE_WHO = "Text46 PG 9"
    PAGE_9_JOB_CHANGE_DATE = "Text47 PG 9"
    PAGE_9_JOB_CHANGE_REASON = "Text49 PG 9"

    #: Q8a rows: (person, business name, type, date started, gross monthly,
    #: net monthly, 40%-flat box, actual-expenses box, monthly-average box,
    #: actual-expenses amount, monthly-average amount)
    PAGE_9_SELF_EMPLOYMENT_ROWS = (
        (
            "Text56 PG 9", "Text57 PG 9", "Text58 PG 9", "Text59 PG 9",
            "Text60 PG 9", "Text66 PG 9",
            "Check Box61 PG 9", "Check Box62 PG 9", "Check Box63 PG 9",
            "Text64 PG 9", "Text65 PG 9",
        ),
        (
            "Text67 PG 9", "Text68 PG 9", "Text69 PG 9", "Text70 PG 9",
            "Text71 PG 9", "Text77 PG 9",
            "Check Box72 PG 9", "Check Box73 PG 9", "Check Box74 PG 9",
            "Text75 PG 9", "Text76 PG 9",
        ),
        (
            "Text78 PG 9", "Text79 PG 9", "Text80 PG 9", "Text81 PG 9",
            "Text82 PG 9", "Text88 PG 9",
            "Check Box83 PG 9", "Check Box84 PG 9", "Check Box85 PG 9",
            "Text86 PG 9", "Text87 PG 9",
        ),
    )

    #: Printed wording for the "How Often Paid?" column.
    PAY_FREQUENCY_LABELS = {
        "weekly": "Weekly",
        "every_two_weeks": "Every two weeks",
        "twice_a_month": "Twice a month",
        "monthly": "Monthly",
        "irregular": "Irregular",
    }

    #: Column index of each self-employment expense option.
    SELF_EMPLOYMENT_EXPENSE_INDEX = {
        "standard_40_percent": 0,
        "actual_expenses": 1,
        "monthly_average": 2,
    }


    # -----------------------------------------------------------------------
    # Page 8 — Q7 Unearned Income
    # -----------------------------------------------------------------------
    #
    # Verified: the printed gateway "Does anyone get income that does not come
    # from work (unearned)?" sits at y=498 with its Yes glyph at x=362 and No at
    # x=396; the two widgets below occupy [361,495,375,509] and [394,495,408,509].
    # Table columns were matched to the printed headers: "Person Getting the
    # Money?" (x=61), "From Where?", "How Much?", "How Often Received?" (x=407)
    # and "Expect to Continue?" (x=517/519).
    PAGE_8_UNEARNED_GATEWAY = ("Check Box23 PG 8", "Check Box24 PG 8")

    #: (person, from where, how much, how often, continue-yes, continue-no)
    PAGE_8_UNEARNED_ROWS = (
        (
            "Text54 PG 8", "Text55 PG 8", "Text56 PG 8", "Text57 PG 8",
            "Check Box58 PG 8", "Check Box59 PG 8",
        ),
        (
            "Text60 PG 8", "Text61 PG 8", "Text62 PG 8", "Text63 PG 8",
            "Check Box64 PG 8", "Check Box65 PG 8",
        ),
        (
            "Text66 PG 8", "Text67 PG 8", "Text68 PG 8", "Text69 PG 8",
            "Check Box70 PG 8", "Check Box71 PG 8",
        ),
        (
            "Text72 PG 8", "Text73 PG 8", "Text74 PG 8", "Text75 PG 8",
            "Check Box76 PG 8", "Check Box77 PG 8",
        ),
    )

    # The 27 "check all types of unearned income" boxes (Check Box25-51 PG 8) are
    # deliberately NOT mapped: the application collects a free-text source, and
    # matching that text to one of 27 printed categories would be guesswork. Two
    # of those widgets also share a y position, so their identity is unresolved.

    # -----------------------------------------------------------------------
    # Page 10 — Q9 Other Income (free or in exchange for work)
    # -----------------------------------------------------------------------
    #
    # Verified: gateway Yes/No at [430,...]/[465,...] under the printed question.
    # The table has FOUR FIXED rows, one per printed item type, not free rows.
    # Columns: Free | For Work | Who gets the item? | Value | Who gives the item?
    PAGE_10_OTHER_INCOME_GATEWAY = ("Check Box1 pg 10", "Check Box2 pg 10")

    #: item kind -> (free box, for-work box, who gets, value, who gives)
    PAGE_10_OTHER_INCOME_ROWS = {
        "housing": (
            "Check Box4 pg 10", "Check Box5 pg 10",
            "Text6 pg 10", "Text7 pg 10", "Text8 pg 10",
        ),
        "utilities": (
            "Check Box10 pg 10", "Check Box11 pg 10",
            "Text12 pg 10", "Text13 pg 10", "Text14 pg 10",
        ),
        "food": (
            "Check Box16 pg 10", "Check Box17 pg 10",
            "Text18 pg 10", "Text19 pg 10", "Tex20 pg 10",
        ),
        "clothing": (
            "Check Box22 pg 10", "Check Box23 pg 10",
            "Text24 pg 10", "Text25 pg 10", "Text26pg 10",
        ),
    }

    # The Free / For Work boxes stay blank: the application asks one combined
    # question ("free or in exchange for work") and never learns which it was.

    # -----------------------------------------------------------------------
    # Page 11 — Q15 Household Expenses
    # -----------------------------------------------------------------------
    #
    # Verified: gateway Yes/No at x=440/472. Column bands matched to the printed
    # headers "Have Expense?" (Yes x=223, No x=255), "Who Pays?" (x=295-413),
    # "Amount Owed" (x=423-474) and "How Often Billed?" (x=478-568).
    #
    # The form prints a NOTE: heating/cooling, telephone, other utilities and the
    # homeless shelter "are set allowances. It is not necessary to fill in the
    # actual amount owed." Those four rows have NO Amount Owed widget at all, so
    # `amount` is None for them and no amount is ever written there.
    PAGE_11_EXPENSES_GATEWAY = ("Check Box23 PG 11", "Check Box24 PG 11")

    #: printed row -> (have-yes, have-no, who pays, amount owed or None, how often)
    PAGE_11_EXPENSE_ROWS = {
        "rent_or_house_payment": (
            "Check Box25 PG 11", "Check Box26 PG 11",
            "Text27 PG 11", "Text28 PG 11", "Text29 PG 11",
        ),
        "property_taxes_and_insurance": (
            "Check Box30 PG 11", "Check Box31 PG 11",
            "Text32 PG 11", "Text33 PG 11", "Text34 PG 11",
        ),
        "heating_or_cooling": (
            "Check Box35 PG 11", "Check Box36 PG 11",
            "Text37 PG 11", None, "Text38 PG 11",
        ),
        "telephone": (
            "Check Box39 PG 11", "Check Bo40 PG 11",
            "Text41 PG 11", None, "Text42 PG 11",
        ),
        "homeless_shelter": (
            "Check Box43 PG 11", "Check Box44 PG 11",
            "Text45 PG 11", None, "Text46 PG 11",
        ),
        "water_sewage_garbage": (
            "Check Box47 PG 11", "Check Box48 PG 11",
            "Text49 PG 11", None, "Text50 PG 11",
        ),
    }

    #: Our expense kinds mapped onto the printed rows above.
    EXPENSE_KIND_TO_ROW = {
        "rent_or_mortgage": "rent_or_house_payment",
        "property_tax": "property_taxes_and_insurance",
        "home_insurance": "property_taxes_and_insurance",
        "gas": "heating_or_cooling",
        "electricity": "heating_or_cooling",
        "telephone": "telephone",
        "water": "water_sewage_garbage",
        "trash": "water_sewage_garbage",
    }

    # "other" has no printed row on Q15 and is intentionally unmapped. The
    # "Who Pays?" column also stays blank: household expenses are collected at
    # household level, so no payer is known. LIHEAP (Check Box54/55 PG 11) and the
    # outside-help block are not modeled and stay blank.

    # -----------------------------------------------------------------------
    # Page 14 — Q24 Household's Resources
    # -----------------------------------------------------------------------
    #
    # Verified: gateway Yes at [190,...], No at [224,...] beneath the printed
    # question. The type grid is 5 rows x 3 columns (Check Box3-17), and the table
    # below has four rows with columns "In Whose Name is the Resource Listed?"
    # (x=36-160), "Type of Resource" (x=165-274), "How Much is it Worth?"
    # (x=282-334) and "Where is the Resource?" (x=339-578).
    PAGE_14_RESOURCES_GATEWAY = ("Check Box1 PG 14", "Check Box2 PG 14")

    #: our resource kind -> the printed type checkbox
    PAGE_14_RESOURCE_TYPE_BOXES = {
        "checking": "Check Box3 PG 14",     # Bank/Credit Union account (Checking)
        "savings": "Check Box4 PG 14",      # Bank/Credit Union account (Savings)
        "cash_on_hand": "Check Box11 PG 14",  # Cash on hand
        "trust": "Check Box9 PG 14",        # Mutual funds/Trust funds
        "other": "Check Box17 PG 14",       # Other: ______
    }

    # "stocks_or_bonds" is intentionally unmapped: the form has separate "Stocks"
    # (Check Box13) and "Bonds" (Check Box14) boxes and the application collects a
    # single combined category, so ticking either one would assert something the
    # applicant did not say.

    #: (in whose name, type of resource, how much worth, where held)
    PAGE_14_RESOURCE_ROWS = (
        ("Text18 PG 14", "Text19 PG 14", "Text20PG 14", "Text21 PG 14"),
        ("Text22 PG 14", "Text23 PG 14", "Text24 PG 14", "Text25 PG 14"),
        ("Text26 PG 14", "Text27 PG 14", "Text28 PG 14", "Text29 PG 14"),
        ("Text30 PG 14", "Text31 PG 14", "Text32 PG 14", "Text33 PG 14"),
    )

    #: Human labels for the "Type of Resource" column, matching the printed grid.
    RESOURCE_TYPE_LABELS = {
        "checking": "Bank/Credit Union account (Checking)",
        "savings": "Bank/Credit Union account (Savings)",
        "cash_on_hand": "Cash on hand",
        "stocks_or_bonds": "Stocks/Bonds",
        "trust": "Mutual funds/Trust funds",
        "other": "Other",
    }

    #: The un-numbered transferred-resource question printed at the end of Q24,
    #: above the "25. Personal Property" heading. Yes at x=513, No at x=546.
    PAGE_14_TRANSFERRED_GATEWAY = ("Check Box34 PG 14", "Check Box35 PG 14")
    PAGE_14_TRANSFERRED_WHAT = "Text37 PG 14"
    PAGE_14_TRANSFERRED_WORTH = "Text38 PG 14"
    # "WHEN?" (Text36) and "HOW MUCH DID YOU GET FOR IT" (Text39) are not modeled.

    # -----------------------------------------------------------------------
    # Gateway Yes/No pairs — expenses, household circumstances, health, taxes
    # -----------------------------------------------------------------------
    #
    # Every pair below was located the same way: extract each text run with its
    # device coordinates, find the printed "Yes" and "No" glyphs on the
    # question's own baseline band, and take the checkbox widgets whose x
    # positions match those glyphs (within ~2pt). Both the printed question text
    # and the matching x coordinates are recorded so the mapping can be
    # re-checked without repeating the search.
    #
    # A question whose printed form has no gateway Yes/No box is absent here
    # rather than pointed at an approximate destination:
    #
    # - Q27 (real property) is a table of rows with no gateway checkbox at all,
    #   so `resources.has_real_property` has nowhere correct to go.
    #
    #: canonical key -> (Yes destination, No destination)
    GATEWAY_YES_NO = {
        # Q11 "Does anyone pay for care of a child, disabled adult, or other
        # dependent so you or the other person can go to work, school, or look
        # for a job?"  Yes glyph x=141.8 / No glyph x=175.5.
        # (The form spells this page suffix in lower case.)
        "expenses.has_dependent_care": (
            "Check Box35 pg 10",
            "Check Box36 pg 10",
        ),

        # Q12 "Is anyone listed in question 6 legally obligated to pay child
        # support, including back child support?"  Yes x=469.5 / No x=503.0.
        "expenses.pays_child_support": (
            "Check Box63 PG 10",
            "Check Box64 PG 10",
        ),

        # Q13 "Is anyone listed in question 6 legally obligated to pay spousal
        # support/alimony?"  Yes x=399.2 / No x=433.0.
        "expenses.pays_spousal_support": (
            "Check Box1 PG 11",
            "Check Box2 PG 11",
        ),

        # Q16 "Are you or anyone you buy and prepare food with an elderly (60 or
        # older) or disabled person that has any out-of-pocket medical
        # expenses?"  Yes x=161.8 / No x=195.5.
        "expenses.has_medical_expenses": (
            "Check Box1 PG 12",
            "Check Box2 PG 12",
        ),

        # Q17 "Other Tax-Deductible Expenses".  Yes x=221.5 / No x=255.2.
        "expenses.other_tax_deductible": (
            "Check Box28 PG 12",
            "Check Box29 PG 12",
        ),

        # Q19 "Does anyone in question 6 live at any of the following?" — the
        # printed list is Homeless Shelter, Group living arrangement for the
        # blind/disabled, Shelter for battered women, Federally subsidized
        # housing, which is the question the application asks.
        # Yes x=320.5 / No x=354.2.
        "household.institutional_living": (
            "Check Box46 PG 12",
            "Check Box47 PG 12",
        ),

        # Q20 "Is anyone getting In-Home Supportive Services (IHSS)?"
        # Yes x=325.2 / No x=358.8.
        "household.receives_ihss": (
            "Check Box1 PG 13",
            "Check Box2 PG 13",
        ),

        # Q21 "Does everyone listed in question 6 buy and prepare food with
        # you?"  Yes x=371.5 / No x=405.0.
        "household.buys_and_prepares_food_together": (
            "Check Box5 PG 13",
            "Check Box6 PG 13",
        ),

        # Q22 "Is anyone enrolled in health coverage now from the following?"
        # Yes glyph x=157.0 / No glyph x=190.5.
        "health.has_current_coverage": (
            "Check Box14 PG 13",
            "Check Box15 PG 13",
        ),

        # Q22a "Is anyone listed on this application offered health care
        # coverage from a job?"  Yes x=421.5 / No x=455.0.
        "health.has_employer_coverage": (
            "Check Box44 PG 13",
            "Check Box45 PG 13",
        ),

        # Q22b "Is anyone's health insurance expected to end or has it ended in
        # the last 90 days?"  Yes x=441.0 / No x=474.8.
        "health.coverage_ending": (
            "Check Box46 PG 13",
            "Check Box47 PG 13",
        ),

        # Q22c "Does anyone want help for medical bills from the last three
        # months?"  Yes x=388.0 / No x=421.8.
        "health.retroactive_medical_help": (
            "Check Box56 PG 13",
            "Check Box57 PG 13",
        ),

        # Q23 "Does anyone listed in question 6 plan to file a federal income
        # tax return next year?"  Yes x=445.8 / No x=479.2.
        "health.tax_filer": (
            "Check Box59 PG 13",
            "Check Box60 PG 13",
        ),

        # Q23c "Will this person file jointly with a spouse?"
        # Yes x=254.2 / No x=288.0.
        "health.spouse_filing_jointly": (
            "Check Box62 PG 13",
            "Check Box63 PG 13",
        ),

        # Q26 "Does anyone own, have the use of, or have their name on any
        # registration of any motor vehicle ... even if it isn't running?"
        # Yes x=411.5 / No x=445.2.
        "resources.has_vehicles": (
            "Check Box1 PG 15",
            "Check Box2 PG 15",
        ),

        # Q28 "Has anyone received a Diversion cash payment or non-cash services
        # from any county or other state?"  Yes x=499.0 / No x=532.8.
        "resources.received_diversion_payment": (
            "Check Box21 PG 15",
            "Check Box22 PG 15",
        ),
    }

    SAFE_FIELDS = frozenset(
        {
            *(
                field
                for pair in GATEWAY_YES_NO.values()
                for field in pair
            ),

            # Page 1 applicant name.
            "Text1 PG 1",

            # Preferred read/spoken language.
            "Text30 PG 1",
            "Text31 PG 1",

            *TEXT_FIELDS.values(),
            *PROGRAM_FIELDS.values(),
            *PAGE_16_TEXT.values(),

            # Page 9 earned income, job-change block, and self-employment.
            *PAGE_9_EARNED_GATEWAY,
            *PAGE_9_JOB_CHANGE_GATEWAY,
            PAGE_9_JOB_CHANGE_WHO,
            PAGE_9_JOB_CHANGE_DATE,
            PAGE_9_JOB_CHANGE_REASON,
            *(field for row in PAGE_9_EARNED_ROWS for field in row),

            # Page 8 Q7, page 10 Q9, page 11 Q15, page 14 Q24.
            *PAGE_8_UNEARNED_GATEWAY,
            *(field for row in PAGE_8_UNEARNED_ROWS for field in row),
            *PAGE_10_OTHER_INCOME_GATEWAY,
            *(
                field
                for row in PAGE_10_OTHER_INCOME_ROWS.values()
                for field in row
            ),
            *PAGE_11_EXPENSES_GATEWAY,
            *(
                field
                for row in PAGE_11_EXPENSE_ROWS.values()
                for field in row
                if field is not None
            ),
            *PAGE_14_RESOURCES_GATEWAY,
            *PAGE_14_RESOURCE_TYPE_BOXES.values(),
            *(field for row in PAGE_14_RESOURCE_ROWS for field in row),
            *PAGE_14_TRANSFERRED_GATEWAY,
            PAGE_14_TRANSFERRED_WHAT,
            PAGE_14_TRANSFERRED_WORTH,
            *(field for row in PAGE_9_SELF_EMPLOYMENT_ROWS for field in row),

            *(
                field
                for pair in PAGE_16_YES_NO.values()
                for field in pair
            ),

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
        # Page 9 — Q8 earned income
        # -------------------------------------------------------------------
        earned_gateway = canonical_values.get("income.has_earned_income")

        if isinstance(earned_gateway, bool):
            yes_field, no_field = self.PAGE_9_EARNED_GATEWAY
            set_field(yes_field if earned_gateway else no_field, "/Yes")

        for row_index, row in enumerate(self.PAGE_9_EARNED_ROWS):
            prefix = f"income.earned.{row_index}"

            # A record only reaches this point when its gateway is Yes; the
            # TypeScript field plan omits inactive records entirely.
            if not any(
                key.startswith(f"{prefix}.") for key in canonical_values
            ):
                continue

            (
                person_field,
                employer_field,
                phone_field,
                hourly_field,
                hours_field,
                frequency_field,
                monthly_field,
                continue_yes,
                continue_no,
            ) = row

            set_field(person_field, canonical_values.get(f"{prefix}.person_name"))

            # "Employer's Name and Address" is one printed column.
            employer_parts = [
                _none_to_blank(canonical_values.get(f"{prefix}.employer_name")),
                _none_to_blank(canonical_values.get(f"{prefix}.employer_address")),
            ]
            set_field(
                employer_field,
                ", ".join(part for part in employer_parts if part),
            )

            set_field(phone_field, canonical_values.get(f"{prefix}.employer_phone"))
            set_field(hourly_field, canonical_values.get(f"{prefix}.hourly_rate"))
            set_field(hours_field, canonical_values.get(f"{prefix}.hours_per_week"))

            frequency = str(
                canonical_values.get(f"{prefix}.pay_frequency") or ""
            ).strip()
            set_field(
                frequency_field,
                self.PAY_FREQUENCY_LABELS.get(frequency, ""),
            )

            # Only the month total may go in the month column. A per-period
            # amount is a different fact and is never converted.
            set_field(
                monthly_field,
                canonical_values.get(f"{prefix}.gross_received_this_month"),
            )

            expect = canonical_values.get(f"{prefix}.expected_to_continue")
            if isinstance(expect, bool):
                set_field(continue_yes if expect else continue_no, "/Yes")

        # Q8 job-change block.
        job_change_gateway = canonical_values.get("income.recent_job_change")

        if isinstance(job_change_gateway, bool):
            yes_field, no_field = self.PAGE_9_JOB_CHANGE_GATEWAY
            set_field(yes_field if job_change_gateway else no_field, "/Yes")

        # The printed block has room for a single job change.
        set_field(
            self.PAGE_9_JOB_CHANGE_WHO,
            canonical_values.get("income.recent_job_change.0.person_name"),
        )
        set_field(
            self.PAGE_9_JOB_CHANGE_DATE,
            canonical_values.get("income.recent_job_change.0.change_date"),
        )
        set_field(
            self.PAGE_9_JOB_CHANGE_REASON,
            canonical_values.get("income.recent_job_change.0.reason"),
        )

        # -------------------------------------------------------------------
        # Page 9 — Q8a self-employment
        # -------------------------------------------------------------------
        for row_index, row in enumerate(self.PAGE_9_SELF_EMPLOYMENT_ROWS):
            prefix = f"income.self_employment.{row_index}"

            if not any(
                key.startswith(f"{prefix}.") for key in canonical_values
            ):
                continue

            (
                person_field,
                business_name_field,
                business_type_field,
                start_date_field,
                gross_field,
                net_field,
                flat_rate_box,
                actual_box,
                average_box,
                actual_amount_field,
                average_amount_field,
            ) = row

            set_field(person_field, canonical_values.get(f"{prefix}.person_name"))
            set_field(
                business_name_field,
                canonical_values.get(f"{prefix}.business_name"),
            )
            set_field(
                business_type_field,
                canonical_values.get(f"{prefix}.business_type"),
            )
            set_field(
                start_date_field,
                _format_date(
                    str(canonical_values.get(f"{prefix}.start_date") or "")
                ),
            )
            set_field(gross_field, canonical_values.get(f"{prefix}.gross_monthly"))
            set_field(net_field, canonical_values.get(f"{prefix}.net_monthly"))

            method = str(
                canonical_values.get(f"{prefix}.expense_method") or ""
            ).strip()
            option_index = self.SELF_EMPLOYMENT_EXPENSE_INDEX.get(method)

            if option_index is not None:
                set_field(
                    (flat_rate_box, actual_box, average_box)[option_index],
                    "/Yes",
                )

                amount = canonical_values.get(f"{prefix}.expense_amount")

                if option_index == 1:
                    set_field(actual_amount_field, amount)
                elif option_index == 2:
                    set_field(average_amount_field, amount)

        # -------------------------------------------------------------------
        # Page 8 — Q7 Unearned Income
        # -------------------------------------------------------------------
        unearned_gateway = canonical_values.get("income.has_unearned_income")

        if isinstance(unearned_gateway, bool):
            yes_field, no_field = self.PAGE_8_UNEARNED_GATEWAY
            set_field(yes_field if unearned_gateway else no_field, "/Yes")

        for row_index, row in enumerate(self.PAGE_8_UNEARNED_ROWS):
            prefix = f"income.unearned.{row_index}"

            if not any(key.startswith(f"{prefix}.") for key in canonical_values):
                continue

            person, from_where, how_much, how_often, _yes, _no = row

            set_field(person, canonical_values.get(f"{prefix}.person_name"))
            set_field(from_where, canonical_values.get(f"{prefix}.source"))

            # "HOW MUCH?" and "HOW OFTEN?" are the applicant's reported facts,
            # not an internal normalization. The canonical layer decides what
            # those words are; the frequency column is written only when the
            # applicant actually stated one, so a known amount with an unknown
            # frequency prints the amount and leaves the frequency blank rather
            # than asserting "Monthly".
            #
            # `income.unearned.N.amount_monthly` is deliberately NOT read here:
            # it is the derived budgeting figure and must never reach the form.
            set_field(
                how_much,
                canonical_values.get(f"{prefix}.reported_amount"),
            )

            set_field(
                how_often,
                canonical_values.get(f"{prefix}.reported_frequency"),
            )

            # "Expect to Continue?" is not collected for unearned income, so both
            # boxes stay blank.

        # -------------------------------------------------------------------
        # Page 10 — Q9 Other Income
        # -------------------------------------------------------------------
        other_income_gateway = canonical_values.get("income.has_in_kind_support")

        if isinstance(other_income_gateway, bool):
            yes_field, no_field = self.PAGE_10_OTHER_INCOME_GATEWAY
            set_field(yes_field if other_income_gateway else no_field, "/Yes")

        # Rows are keyed by the printed item type, so the first record of each
        # kind fills that row. A second record of the same kind has no printed row
        # and is left for the applicant to add by hand.
        filled_kinds: set[str] = set()

        for index in range(len(self.PAGE_10_OTHER_INCOME_ROWS) * 4):
            prefix = f"income.in_kind.{index}"

            if not any(key.startswith(f"{prefix}.") for key in canonical_values):
                continue

            kind = str(canonical_values.get(f"{prefix}.kind") or "").strip()
            row = self.PAGE_10_OTHER_INCOME_ROWS.get(kind)

            if row is None or kind in filled_kinds:
                continue

            filled_kinds.add(kind)
            _free, _for_work, who_gets, value, who_gives = row

            set_field(who_gets, canonical_values.get(f"{prefix}.person_name"))
            set_field(value, canonical_values.get(f"{prefix}.estimated_monthly_value"))
            set_field(who_gives, canonical_values.get(f"{prefix}.provided_by"))

            # Free vs For Work is never written: the application asks one combined
            # question and does not learn which of the two applies.

        # -------------------------------------------------------------------
        # Page 11 — Q15 Household Expenses
        # -------------------------------------------------------------------
        expenses_gateway = canonical_values.get("expenses.has_household_expenses")

        if isinstance(expenses_gateway, bool):
            yes_field, no_field = self.PAGE_11_EXPENSES_GATEWAY
            set_field(yes_field if expenses_gateway else no_field, "/Yes")

        filled_rows: set[str] = set()

        for index in range(20):
            prefix = f"expenses.household.{index}"

            if not any(key.startswith(f"{prefix}.") for key in canonical_values):
                continue

            kind = str(canonical_values.get(f"{prefix}.kind") or "").strip()
            row_name = self.EXPENSE_KIND_TO_ROW.get(kind)

            if row_name is None or row_name in filled_rows:
                continue

            filled_rows.add(row_name)
            have_yes, _have_no, _who_pays, amount_field, how_often = (
                self.PAGE_11_EXPENSE_ROWS[row_name]
            )

            # Recording this expense is an affirmative statement that the
            # household has it.
            set_field(have_yes, "/Yes")

            amount = canonical_values.get(f"{prefix}.amount_monthly")

            # Rows the form treats as set allowances have no amount box at all.
            if amount_field is not None:
                set_field(amount_field, amount)

            if amount is not None:
                set_field(how_often, "Monthly")

        # -------------------------------------------------------------------
        # Page 14 — Q24 Household's Resources
        # -------------------------------------------------------------------
        resources_gateway = canonical_values.get("resources.has_accounts")

        if isinstance(resources_gateway, bool):
            yes_field, no_field = self.PAGE_14_RESOURCES_GATEWAY
            set_field(yes_field if resources_gateway else no_field, "/Yes")

        for row_index, row in enumerate(self.PAGE_14_RESOURCE_ROWS):
            prefix = f"resources.accounts.{row_index}"

            if not any(key.startswith(f"{prefix}.") for key in canonical_values):
                continue

            whose_name, type_of_resource, worth, where_held = row
            kind = str(canonical_values.get(f"{prefix}.kind") or "").strip()

            set_field(whose_name, canonical_values.get(f"{prefix}.person_name"))
            set_field(type_of_resource, self.RESOURCE_TYPE_LABELS.get(kind, ""))
            set_field(worth, canonical_values.get(f"{prefix}.balance"))
            set_field(where_held, canonical_values.get(f"{prefix}.institution"))

            # Tick the matching entry in the printed type grid, where our
            # category corresponds to exactly one printed box.
            type_box = self.PAGE_14_RESOURCE_TYPE_BOXES.get(kind)

            if type_box is not None:
                set_field(type_box, "/Yes")

        # The un-numbered transferred-resource question at the end of Q24.
        transferred_gateway = canonical_values.get("resources.transferred_resources")

        if isinstance(transferred_gateway, bool):
            yes_field, no_field = self.PAGE_14_TRANSFERRED_GATEWAY
            set_field(yes_field if transferred_gateway else no_field, "/Yes")

        set_field(
            self.PAGE_14_TRANSFERRED_WHAT,
            canonical_values.get("resources.transferred.0.description"),
        )
        set_field(
            self.PAGE_14_TRANSFERRED_WORTH,
            canonical_values.get("resources.transferred.0.estimated_value"),
        )

        # -------------------------------------------------------------------
        # Page 16 — program integrity, other services, third-party liability
        # -------------------------------------------------------------------
        #
        # An unanswered question stays blank: only a real boolean ticks a box, so
        # "not asked" is never rendered as an explicit No.
        for (
            key,
            (yes_field, no_field),
        ) in self.PAGE_16_YES_NO.items():
            value = canonical_values.get(key)

            if not isinstance(value, bool):
                continue

            set_field(
                yes_field if value else no_field,
                "/Yes",
            )

        for key, pdf_field in self.PAGE_16_TEXT.items():
            set_field(
                pdf_field,
                canonical_values.get(key),
            )

        # -------------------------------------------------------------------
        # Gateway Yes/No questions across the expense, household, health and
        # tax sections.
        # -------------------------------------------------------------------
        #
        # `isinstance(value, bool)` is the whole point: an explicit No is a real
        # answer and ticks the No box, while a question that was never answered
        # (or was skipped) leaves both boxes blank. Truthiness here would make a
        # No indistinguishable from silence.

        for (
            key,
            (yes_field, no_field),
        ) in self.GATEWAY_YES_NO.items():
            value = canonical_values.get(key)

            if not isinstance(
                value,
                bool,
            ):
                continue

            set_field(
                yes_field if value else no_field,
                "/Yes",
            )

        # -------------------------------------------------------------------
        # Build semantic household-person records.
        # -------------------------------------------------------------------
        #
        # Row placement is NOT decided here. The TypeScript canonical layer
        # states, per person, which printed table they belong in and which row
        # of it they occupy (`<prefix>.table` / `<prefix>.table_row`). This
        # adapter only obeys that plan.
        #
        # That split exists because every previous misplacement came from this
        # function inferring the ordering from whichever canonical keys were
        # present: an unnamed member truncated the discovery loop, a member with
        # an age but no birth date was classified as an adult, and an unnamed
        # applicant gave up row 1 to the next adult.

        adults: dict[int, dict[str, Any]] = {}
        children: dict[int, dict[str, Any]] = {}

        def place(
            prefix: str,
            details_prefix: str,
            programs_prefix: str,
            name: str,
            relationship: str,
            raw_dob: str,
        ) -> None:
            """File one person into the row the canonical plan assigned."""

            table = str(
                canonical_values.get(
                    f"{prefix}.table"
                )
                or ""
            ).strip()

            row = canonical_values.get(
                f"{prefix}.table_row"
            )

            if table not in {"adult", "child"} or not isinstance(
                row,
                int,
            ):
                # No assignment means no row. Guessing one is what put people in
                # the wrong place before.
                return

            record = {
                "name": name,
                "relationship": relationship,
                "dob": _format_date(
                    raw_dob
                ),
                "raw_dob": raw_dob,
                "prefix": prefix,
                "details_prefix": details_prefix,
                "programs_prefix": programs_prefix,
            }

            target = (
                adults
                if table == "adult"
                else children
            )

            # Two people can never share a row: the canonical plan numbers each
            # table independently and consecutively.
            if row in target:
                raise RuntimeError(
                    "Two household people were assigned the same "
                    f"{table} row: {row}"
                )

            target[row] = record

        # The primary applicant. Placed whether or not a name has been entered,
        # so nobody else can take their row.
        place(
            prefix="applicant",
            details_prefix="applicant.household",
            # The applicant's per-person program selections live under their
            # household namespace; members carry theirs at the member root.
            programs_prefix="applicant.household",
            name=_full_name(
                canonical_values,
                "applicant",
                last_first=True,
            ),
            relationship="self",
            raw_dob=str(
                canonical_values.get(
                    "applicant.date_of_birth"
                )
                or ""
            ).strip(),
        )

        # Additional household members. Membership is stated explicitly by
        # `<prefix>.present`, never inferred from a populated name.
        member_count = canonical_values.get(
            "household.members.count"
        )

        if not isinstance(
            member_count,
            int,
        ):
            member_count = 0

        for index in range(
            member_count
        ):
            prefix = (
                f"household.members.{index}"
            )

            if canonical_values.get(
                f"{prefix}.present"
            ) is not True:
                continue

            table = str(
                canonical_values.get(
                    f"{prefix}.table"
                )
                or ""
            ).strip()

            place(
                prefix=prefix,
                details_prefix=f"{prefix}.{table}",
                programs_prefix=prefix,
                name=_full_name(
                    canonical_values,
                    prefix,
                    last_first=True,
                ),
                relationship=str(
                    canonical_values.get(
                        f"{prefix}.relationship_to_applicant"
                    )
                    or ""
                ),
                raw_dob=str(
                    canonical_values.get(
                        f"{prefix}.date_of_birth"
                    )
                    or ""
                ).strip(),
            )

        # -------------------------------------------------------------------
        # Page 3 — adult household rows
        # -------------------------------------------------------------------

        for row_index, person in sorted(
            adults.items()
        ):
            # A household larger than the printed table simply has no row for
            # the extra people. Wrapping them onto row 1 would overwrite the
            # applicant.
            if row_index >= len(
                self.ADULT_ROWS
            ):
                continue

            row = self.ADULT_ROWS[
                row_index
            ]

            details_prefix = str(
                person["details_prefix"]
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
                str(
                    person["programs_prefix"]
                ),
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

        for row_index, person in sorted(
            children.items()
        ):
            if row_index >= len(
                self.CHILD_ROWS
            ):
                continue

            row = self.CHILD_ROWS[
                row_index
            ]

            # A minor primary applicant keeps the single applicant household
            # namespace; other children use their own child sub-namespace. The
            # canonical plan states which, so this is not re-derived here.
            details_prefix = str(
                person["details_prefix"]
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
                str(
                    person["programs_prefix"]
                ),
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



class _PdfWriter:
    """Minimal PDF writer that supports text pages with basic formatting."""

    def __init__(self) -> None:
        # Slots: 0=unused, 1=reserved(Pages), 2=reserved(Font)
        # Pre-allocate so add_page() starts at obj 3+
        self._objects: list[bytes] = [b"", b"", b""]
        self._pages: list[int] = []

    def _add_obj(self, data: bytes) -> int:
        self._objects.append(data)
        return len(self._objects) - 1

    def add_page(self, lines: list[tuple[str, float, float, float]]) -> None:
        """Add a page with positioned text lines.

        Each line is (text, x, y, font_size).
        """
        stream_parts: list[str] = []
        for text, x, y, size in lines:
            escaped = (
                text.replace("\\", "\\\\")
                .replace("(", "\\(")
                .replace(")", "\\)")
            )
            stream_parts.append(f"BT /F1 {size:.0f} Tf {x:.1f} {y:.1f} Td ({escaped}) Tj ET")

        stream = "\n".join(stream_parts)
        stream_bytes = stream.encode("latin-1", errors="replace")

        stream_obj = self._add_obj(
            b"<< /Length " + str(len(stream_bytes)).encode() + b" >>\nstream\n"
            + stream_bytes + b"\nendstream"
        )

        page_obj = self._add_obj(
            b"<< /Type /Page /Parent 1 0 R"
            b" /MediaBox [0 0 612 792]"
            b" /Contents " + str(stream_obj).encode() + b" 0 R"
            b" /Resources << /Font << /F1 2 0 R >> >> >>"
        )
        self._pages.append(page_obj)

    def write(self, path: Path) -> None:
        """Write the PDF to *path*."""
        # Slot 1 = Pages, Slot 2 = Font (reserved in __init__)
        kids = " ".join(f"{p} 0 R" for p in self._pages)
        self._objects[1] = (
            f"<< /Type /Pages /Kids [{kids}] /Count {len(self._pages)} >>".encode()
        )
        self._objects[2] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

        catalog = self._add_obj(b"<< /Type /Catalog /Pages 1 0 R >>")

        # Serialize
        buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets: list[int] = [0] * len(self._objects)

        for i in range(1, len(self._objects)):
            offsets[i] = len(buf)
            buf.extend(f"{i} 0 obj\n".encode())
            buf.extend(self._objects[i])
            buf.extend(b"\nendobj\n")

        xref_offset = len(buf)
        buf.extend(f"xref\n0 {len(self._objects)}\n".encode())
        buf.extend(b"0000000000 65535 f\r\n")
        for i in range(1, len(self._objects)):
            buf.extend(f"{offsets[i]:010d} 00000 n\r\n".encode())

        buf.extend(
            f"trailer\n<< /Size {len(self._objects)} /Root {catalog} 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n".encode()
        )

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes(buf))


# ---------------------------------------------------------------------------
# Page layout helpers
# ---------------------------------------------------------------------------

_PAGE_W = 612  # Letter width in points
_PAGE_H = 792
_MARGIN_L = 54
_MARGIN_R = 54
_MARGIN_TOP = 54
_USABLE_W = _PAGE_W - _MARGIN_L - _MARGIN_R
_LINE_HEIGHT_BODY = 14
_LINE_HEIGHT_HEADING = 20


def _wrap(text: str, width: int = 80) -> list[str]:
    """Word-wrap text to fit page width."""
    return textwrap.wrap(text, width=width) or [""]


def _add_text(
    lines: list[tuple[str, float, float, float]],
    text: str,
    y: float,
    *,
    size: float = 10,
    x: float = _MARGIN_L,
    bold: bool = False,
) -> float:
    """Append wrapped text lines, return new y position."""
    if bold:
        size += 1  # Helvetica has no bold variant in base 14; simulate with size
    wrapped = _wrap(text, width=int(_USABLE_W / (size * 0.5)))
    lh = _LINE_HEIGHT_HEADING if size > 12 else _LINE_HEIGHT_BODY
    for line_text in wrapped:
        lines.append((line_text, x, y, size))
        y -= lh
    return y


# ---------------------------------------------------------------------------
# Application form content builders
# ---------------------------------------------------------------------------


def _build_header_page(
    household: dict[str, Any],
    programs: list[str],
    generated_at: str,
) -> list[tuple[str, float, float, float]]:
    """Build the cover/header page."""
    lines: list[tuple[str, float, float, float]] = []
    y = _PAGE_H - _MARGIN_TOP

    y = _add_text(lines, "BENEFIT APPLICATION DRAFT", y, size=18, bold=True)
    y -= 8
    y = _add_text(lines, "*** DRAFT FOR REVIEW - NOT A FINAL SUBMISSION ***", y, size=12, bold=True)
    y -= 20

    y = _add_text(lines, f"Generated: {generated_at}", y, size=9)
    y = _add_text(lines, "Source: Kealu Benefit Navigator (AI-assisted)", y, size=9)
    y -= 16

    # Applicant information section
    y = _add_text(lines, "APPLICANT INFORMATION", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    fields = [
        ("Full Name", household.get("name", "________________________")),
        ("Date of Birth", household.get("dob", "____/____/________")),
        ("Address", household.get("address", "________________________________________")),
        ("City, State, ZIP", f"{household.get('city', '_____________')}, "
                             f"{household.get('state', '____')} "
                             f"{household.get('zip_code', '_________')}"),
        ("Phone", household.get("phone", "(____) ____-________")),
        ("Email", household.get("email", "________________________________")),
        ("Household Size", str(household.get("household_size", "____"))),
        ("Annual Income", f"${household.get('income', '____________')}"),
        ("Income Type", household.get("income_type", "________________________")),
    ]

    for label, value in fields:
        y = _add_text(lines, f"{label}:  {value}", y, size=10)
        y -= 2

    y -= 16
    y = _add_text(lines, "PROGRAMS APPLIED FOR", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    for i, program in enumerate(programs, 1):
        y = _add_text(lines, f"  [{i}]  {program}", y, size=11)
        y -= 2

    y -= 24
    y = _add_text(
        lines,
        "IMPORTANT: This is an AI-generated draft based on information you provided. "
        "Review all pre-filled fields carefully before submitting to any agency. "
        "Eligibility determinations are estimates and subject to official verification.",
        y,
        size=9,
    )

    return lines


def _build_household_page(
    members: list[dict[str, Any]],
) -> list[tuple[str, float, float, float]]:
    """Build household members page."""
    lines: list[tuple[str, float, float, float]] = []
    y = _PAGE_H - _MARGIN_TOP

    y = _add_text(lines, "HOUSEHOLD MEMBERS", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    for i, member in enumerate(members, 1):
        y = _add_text(lines, f"Member {i}:", y, size=11, bold=True)
        y -= 2
        y = _add_text(lines, f"  Name: {member.get('name', '________________________')}", y)
        y = _add_text(lines, f"  Relationship: {member.get('relationship', '________________')}", y)
        y = _add_text(lines, f"  Age: {member.get('age', '____')}    DOB: {member.get('dob', '____/____/________')}", y)
        y = _add_text(lines, "  SSN: ____-____-________  (do NOT pre-fill)", y, size=9)
        y = _add_text(lines, f"  Health Conditions: {member.get('health_needs', '________________________________')}", y)
        y -= 12

        if y < _MARGIN_TOP + 80:
            break  # prevent overflow

    return lines


def _build_documents_page(
    documents: list[str],
) -> list[tuple[str, float, float, float]]:
    """Build required documents checklist page."""
    lines: list[tuple[str, float, float, float]] = []
    y = _PAGE_H - _MARGIN_TOP

    y = _add_text(lines, "REQUIRED DOCUMENTS CHECKLIST", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    y = _add_text(
        lines,
        "Gather these documents before submitting your application:",
        y,
        size=10,
    )
    y -= 8

    for doc in documents:
        y = _add_text(lines, f"  [ ]  {doc}", y, size=10)
        y -= 4
        if y < _MARGIN_TOP + 40:
            break

    y -= 20
    y = _add_text(lines, "APPLICANT SIGNATURE", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 20

    y = _add_text(
        lines,
        "I certify that the information provided is true and correct to the best of "
        "my knowledge. I understand that providing false information may result in "
        "denial of benefits and potential legal consequences.",
        y,
        size=9,
    )
    y -= 20

    y = _add_text(lines, "Signature: ________________________________________    Date: ____/____/________", y)
    y -= 16
    y = _add_text(lines, "Print Name: ________________________________________", y)

    return lines


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------



def _parse_documents_from_output(workflow_output: str) -> list[str]:
    """Extract document requirements from workflow output."""
    documents = []
    # Look for common document mentions
    doc_patterns = [
        (r"(?:proof of |verify )?income", "Proof of income (pay stubs, tax return, W-2)"),
        (r"(?:birth certificate|proof of age)", "Birth certificates for all household members"),
        (r"(?:social security|SSN|SS card)", "Social Security cards for all household members"),
        (r"(?:photo id|driver.?s? license|state id)", "Government-issued photo ID"),
        (r"(?:proof of )?residen(?:ce|cy)", "Proof of residency (utility bill, lease agreement)"),
        (r"(?:immigration|citizenship|naturalization)", "Proof of citizenship or immigration status"),
        (r"(?:bank statement|financial|asset)", "Bank statements (last 3 months)"),
        (r"(?:rent|mortgage|housing)", "Housing cost documentation (lease, mortgage statement)"),
        (r"(?:medical|health) record", "Medical records or physician statements"),
        (r"(?:cobra|employer|coverage).{0,20}(?:letter|notice)", "Coverage loss documentation (COBRA notice, termination letter)"),
        (r"(?:child care|daycare)", "Child care expense documentation"),
        (r"(?:disability|SSI|SSDI)", "Disability determination letter (if applicable)"),
    ]

    output_lower = workflow_output.lower()
    for pattern, doc_name in doc_patterns:
        if re.search(pattern, output_lower):
            documents.append(doc_name)

    if not documents:
        # Provide standard set
        documents = [
            "Proof of income (pay stubs, tax return, W-2)",
            "Birth certificates for all household members",
            "Social Security cards for all household members",
            "Government-issued photo ID",
            "Proof of residency (utility bill, lease agreement)",
        ]

    return documents


def _parse_household_from_args(args: dict[str, Any]) -> dict[str, Any]:
    """Extract structured household data from tool arguments."""
    profile = args.get("household_profile", "")
    household: dict[str, Any] = {}

    # Extract ZIP
    zip_match = re.search(r"\b(\d{5})\b", args.get("zip_code", "") or profile)
    if zip_match:
        household["zip_code"] = zip_match.group(1)

    # Extract state
    if args.get("state"):
        household["state"] = args["state"]

    # Extract income — require $ prefix or k/K suffix to avoid false matches
    income_match = re.search(
        r"\$\s*([\d,]+)\s*(?:k|K|/yr|/year|annual|yearly)?"
        r"|(\d[\d,]*)\s*(?:k|K)\b"
        r"|(\d[\d,]+)\s*/(?:yr|year|month|mo)\b",
        profile,
    )
    if income_match:
        raw = (income_match.group(1) or income_match.group(2) or income_match.group(3) or "").replace(",", "")
        if raw:
            amount = int(raw)
            if amount < 1000:
                amount *= 1000  # "42k" -> 42000
            household["income"] = f"{amount:,}"

    # Extract household size
    size_match = re.search(
        r"(?:family of |household.{0,10})(\d+)|(\d+)\s*(?:people|person|member)",
        profile,
        re.IGNORECASE,
    )
    if size_match:
        household["household_size"] = size_match.group(1) or size_match.group(2)

    household["income_type"] = args.get("income_type", "")

    # Structured intake answers (collected by the state-adapter intake flow).
    # The header page renders these keys directly; without this mapping a
    # completed intake produced a worksheet with every personal field blank.
    if args.get("applicant_name") or args.get("name"):
        household["name"] = str(args.get("applicant_name") or args.get("name"))
    if args.get("phone_home"):
        household["phone"] = str(args["phone_home"])
    if args.get("email"):
        household["email"] = str(args["email"])
    if args.get("home_city"):
        household["city"] = str(args["home_city"])
    if args.get("home_address"):
        address = str(args["home_address"])
        household["address"] = address

    return household


def _parse_members_from_args(args: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract household member details from profile text."""
    profile = args.get("household_profile", "")
    members: list[dict[str, Any]] = []

    # Try to parse "single parent ... two kids ages 4 and 9" style
    age_pairs = re.findall(r"ages?\s+(\d+)\s+and\s+(\d+)", profile, re.IGNORECASE)
    single_ages = re.findall(r"(\d+)\s*(?:yo|y/o|year.?old)", profile, re.IGNORECASE)

    # Primary applicant
    adult_age = ""
    for a in single_ages:
        if int(a) >= 18:
            adult_age = a
            break

    relationship = "Self (Head of Household)"
    if re.search(r"single (?:parent|mom|mother|dad|father)", profile, re.IGNORECASE):
        relationship = "Self (Single Parent, Head of Household)"

    members.append({
        "name": "",
        "relationship": relationship,
        "age": adult_age,
        "health_needs": args.get("health_needs", ""),
    })

    # Children
    child_num = 1
    for pair in age_pairs:
        for age in pair:
            if int(age) < 19:
                members.append({
                    "name": "",
                    "relationship": f"Child {child_num}",
                    "age": age,
                    "health_needs": "",
                })
                child_num += 1

    # Any single ages that are children
    for age in single_ages:
        if int(age) < 19 and not any(m["age"] == age for m in members):
            members.append({
                "name": "",
                "relationship": f"Child {child_num}",
                "age": age,
                "health_needs": "",
            })
            child_num += 1

    return members


def generate_application_pdf(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path:
    """Generate a pre-filled benefit application draft PDF."""
    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefits-applications"

    now = datetime.now(tz=timezone.utc)
    generated_at = now.strftime("%B %d, %Y at %H:%M UTC")
    timestamp = now.strftime("%Y%m%d-%H%M%S")

    household = _parse_household_from_args(args)
    members = _parse_members_from_args(args)
    programs = _parse_programs_from_output(workflow_output)
    documents = _parse_documents_from_output(workflow_output)

    pdf = _PdfWriter()
    pdf.add_page(_build_header_page(household, programs, generated_at))
    pdf.add_page(_build_household_page(members))
    pdf.add_page(_build_documents_page(documents))

    zip_code = household.get("zip_code", "unknown")
    filename = f"benefits-application-draft-{zip_code}-{timestamp}.pdf"
    output_path = output_dir / filename
    pdf.write(output_path)

    return output_path

def generate_saws2_plus_pdf(
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