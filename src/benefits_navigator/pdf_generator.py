"""Generate official state benefit application PDFs."""

from __future__ import annotations

import json
import math
import re
import urllib.request
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

_FORMS_DIR = Path(__file__).parent / "forms"

_SAWS2_PLUS_TEMPLATE = _FORMS_DIR / "CA-SAWS-2-PLUS.pdf"

from .form_templates import FormTemplate, normalize_locale, template_for

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
        # The locale the applicant chose, not one inferred at generation time.
        "locale": normalize_locale(merged_args.get("locale")),
    }


def _download_template(
    destination: Path,
    template: FormTemplate | None = None,
) -> None:
    """Ensure the official CDSS SAWS 2 PLUS template exists at destination.

    `template` names the language edition to place. The network fallback only
    ever fetches the English form, so a locale whose asset is missing raises
    rather than silently handing over English under a localized name.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)

    source = template.path if template is not None else _SAWS2_PLUS_TEMPLATE

    if source.exists():
        destination.write_bytes(source.read_bytes())
        return

    if template is not None and template.document_language != "en":
        raise RuntimeError(
            f"The official {template.document_language} SAWS 2 PLUS asset is "
            f"missing at {source}. Refusing to substitute the English form "
            "for a form presented as translated."
        )

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


#: How many authorized representatives the canonical layer may emit. The
#: printed form has one page-2 block and one Appendix C block, so more than a
#: couple would have nowhere to go; this only bounds the search.
_MAX_AUTHORIZED_REPRESENTATIVES = 4


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

        # -- Household circumstances, verified the same way ------------------
        #
        # Several of these field names carry the form's own typography errors —
        # a space inside "Check Box 1 PG 7", a double space in
        # "Check Box9  PG 8", a lower-case "pg 10". They are reproduced exactly:
        # the AcroForm key is whatever the form author typed.

        # Q2 "Do you want to name someone to help you with your CalFresh case?"
        # Yes x=339.2 / No x=382.2.
        "household.authorized_representative": (
            "Check Box1 PG 2",
            "Check Box2 PG 2",
        ),

        # Q3 "Are you or any member of your family American Indian or Alaskan
        # Native?"  Yes x=379.2 / No x=422.0.
        "health.american_indian_or_alaska_native": (
            "Check Box15 PG 2",
            "Check Box16 PG 2",
        ),

        # Q5 "...have you received benefits from another program (General
        # Assistance/General Relief, SNAP, etc.)?"  Yes x=466.0 / No x=508.8.
        "household.prior_public_assistance": (
            "Check Box47 PG 2",
            "Check Box48 PG 2",
        ),

        # Q6d "Has anyone been in the U.S. Military service, or are they the
        # spouse, parent or child of a person who was?"
        # Yes x=241.8 / No x=284.8.
        "household.military_service": (
            "Check Box1 PG 5",
            "Check Box2 PG 5",
        ),

        # Q6g "Does anyone under 21 have a parent who does not live in the
        # home?"  Yes x=78.0 / No x=111.5.
        "household.absent_parents": (
            "Check Box17 PG 6",
            "Check Box18 PG 6",
        ),

        # Q6h "Does anyone live with at least one child under 19 and are they
        # the main person taking care of the child?"
        # Yes x=78.0 / No x=111.5.
        "household.caretaker_relative": (
            "Check Box23 PG 6",
            "Check Box24 PG 6",
        ),

        # Q6l "Is anyone who is applying for benefits attending a college or
        # vocational school?"  Yes x=435.5 / No x=469.2.
        "household.students": (
            "Check Box 1 PG 7",
            "Check Box 2 PG 7",
        ),

        # Q6p "Is there a foster child currently living in your home who is
        # receiving foster care services?"  Yes x=471.2 / No x=505.0.
        "household.foster_care": (
            "Check Box1 PG 8",
            "Check Box2 PG 8",
        ),

        # Q6q "Does everyone listed in question 6 live in California and expect
        # to keep living here?"  Yes x=442.2 / No x=475.8.
        "household.california_resident": (
            "Check Box8 PG 8",
            "Check Box9  PG 8",
        ),

        # Q6r "Does anyone listed in question 6 plan to leave California for
        # more than 30 days?"  Yes x=432.0 / No x=465.5.
        "household.planned_absence": (
            "Check Box11 PG 8",
            "Check Box12 PG 8",
        ),

        # Q10 "Does anyone's total income (unearned, earned, and self
        # employment) change from month to month?"
        # Yes x=485.5 / No x=519.2.
        "income.varies_during_year": (
            "Check Box27 pg 10",
            "Check Box28 pg 10",
        ),

        # Q18 "Does anyone in question 6 get food from any of the following?"
        # The Yes/No pair sits above the printed list of programs.
        # Yes x=353.5 / No x=387.0.
        "household.other_food_program": (
            "Check Box40 PG 12",
            "Check Box41 PG 12",
        ),

        # -- Newly modeled household circumstances --------------------------

        # Q2a "Do you want to choose an authorized representative for the health
        # insurance part of your application?"  Yes x=133.2 / No x=176.0.
        # Independent of Q2, which appoints a CalFresh representative.
        "household.health_coverage_representative": (
            "Check Box13 PG 2",
            "Check Box14 PG 2",
        ),

        # Q6i "Does anyone listed in question 6 have a physical, mental,
        # emotional, or developmental disability that causes limitations in
        # activities?"  Yes x=361.0 / No x=394.8.
        "household.disability_limits_activities": (
            "Check Box26 PG 6",
            "Check Box27 PG 6",
        ),

        # Q6k "Is there a child or disabled person in the household who needs
        # care from another household member?"  Yes x=78.8 / No x=112.2.
        "household.needs_care_from_member": (
            "Check Box56 PG 6",
            "Check Box57 PG 6",
        ),

        # Q6m "Is anyone listed in question 6 or 6b pregnant or a teen parent?"
        # Yes x=362.8 / No x=396.2.
        "household.pregnant_or_teen_parent": (
            "Check Box 13 PG 7",
            "Check Box 14 PG 7",
        ),

        # Q6n "Has anyone ever gotten a cash bonus or penalty, or help with child
        # care, transportation or other service from the Cal-Learn Program?"
        # Yes x=176.8 / No x=210.5.
        "household.cal_learn_history": (
            "Check Box 42 PG 7",
            "Check Box 43 PG 7",
        ),

        # Q6o "Was anyone listed in question 6 ever in foster care?"
        # Yes x=309.0 / No x=342.5. Distinct from Q6p, which asks about a foster
        # child living in the home now.
        "household.ever_in_foster_care": (
            "Check Box 50 PG 7",
            "Check Box 51 PG 7",
        ),

        # Q21a "Is anyone living with you age 60 or older and unable to buy food
        # and fix meals separately because of a disability?"
        # Yes x=83.8 / No x=117.5.
        "household.elderly_unable_to_prepare_meals": (
            "Check Box11 PG 13",
            "Check Box12 PG 13",
        ),

        # Q23d "Will this person claim any dependents on their tax return?"
        # Yes x=320.0 / No x=353.5.
        "health.has_tax_dependents": (
            "Check Box65 PG 13",
            "Check Box66 PG 13",
        ),

        # -- Q14 Special Needs Expenses -------------------------------------
        #
        # Six independent printed questions under one heading, each with its
        # own Yes/No pair at x=215.8 / x=249.2 (the "other" row sits to the
        # right at x=443.8 / x=477.2). They are NOT a gateway plus details: a
        # household can need a special diet and nothing else.
        "expenses.special_need.diet": (
            "Check Box9 PG 11",
            "Check Box10 PG 11",
        ),
        "expenses.special_need.phone_or_equipment": (
            "Check Box11 PG 11",
            "Check Box12 PG 11",
        ),
        "expenses.special_need.housework": (
            "Check Box13 PG 11",
            "Check Box14 PG 11",
        ),
        "expenses.special_need.high_utility_use": (
            "Check Box15 PG 11",
            "Check Box16 PG 11",
        ),
        "expenses.special_need.laundry": (
            "Check Box17 PG 11",
            "Check Box18 PG 11",
        ),
        "expenses.special_need.other": (
            "Check Box19 PG 11",
            "Check Box20 PG 11",
        ),
    }

    # -----------------------------------------------------------------------
    # Q4 — interview preference
    # -----------------------------------------------------------------------
    #
    # Two standalone printed checkboxes, not a Yes/No pair. Both sit at x=57.1
    # with the same ~7pt baseline offset above their printed line, in printed
    # order:
    #
    #   y=168.5 "prefer an in-person interview for CalFresh"  Check Box45, y=175.6
    #   y=154.5 "need other arrangements due to a disability" Check Box46, y=161.4
    #
    # A False answer leaves the box unticked, exactly like an unanswered one:
    # the form offers no way to say "no" beyond leaving it blank.
    #
    #: canonical key -> single checkbox destination
    PAGE_2_INTERVIEW_PREFERENCE = {
        "applicant.prefers_in_person_interview": "Check Box45 PG 2",
        "applicant.needs_disability_interview_arrangements": "Check Box46 PG 2",
    }

    # -----------------------------------------------------------------------
    # Q6a — per-person contact blocks
    # -----------------------------------------------------------------------
    #
    # The printed form provides two blocks for people whose contact details
    # differ from the applicant's. Each block is fourteen fields in three rows,
    # and the column x positions match the printed headers exactly:
    #
    #   row A  NAME@36  HOME (STREET) ADDRESS@237  APARTMENT#@434  CITY@492
    #          STATE@603  ZIP CODE@670
    #   row B  HOME PHONE@36  MAILING ADDRESS@237  APARTMENT#@434  CITY@492
    #          STATE@603  ZIP CODE@670
    #   row C  WORK/ALTERNATE/MESSAGE PHONE@36   EMAIL ADDRESS (OPTIONAL)@237
    #
    # Which member occupies which block is decided by the canonical layer, the
    # same way household rows are, so contact details can never land in another
    # person's block.
    #
    #: (name, home street, home apt, home city, home state, home zip,
    #:  home phone, mailing street, mailing apt, mailing city, mailing state,
    #:  mailing zip, alternate phone, email)
    PAGE_3_CONTACT_BLOCKS = (
        (
            "Text92 PG 3", "Text93 PG 3", "Text94 PG 3", "Text95 PG 3",
            "Text96 PG 3", "Text97 PG 3",
            "Text98 PG 3", "Text99 PG 3", "Text100 PG 3", "Text101 PG 3",
            "Text102 PG 3", "Text103 PG 3",
            "Text104 PG 3", "Text105 PG 3",
        ),
        (
            "Text106 PG 3", "Text107 PG 3", "Text108 PG 3", "Text109 PG 3",
            "Text110 PG 3", "Text111 PG 3",
            "Text112 PG 3", "Text113 PG 3", "Text114 PG 3", "Text115 PG 3",
            "Text116 PG 3", "Text117 PG 3",
            "Text118 PG 3", "Text119 PG 3",
        ),
    )

    #: Q6a gateway. Yes x=385.5 / No x=428.4 on the printed line.
    PAGE_3_SAME_CONTACT_GATEWAY = ("Check Box90 PG 3", "Check Box91 PG 3")

    # -----------------------------------------------------------------------
    # Q6j — per-disabled-person detail blocks
    # -----------------------------------------------------------------------
    #
    # Printed page 6 (PDF page 12) holds two person blocks, offset by about
    # 111pt. The two-column layout interleaves in text extraction, so each
    # column below was resolved by matching the printed label's x position to
    # the widget rectangle within its own block:
    #
    #   label "Name of person"@36           block1 y=417.5 -> Text30   y=403.5
    #                                       block2 y=306.5 -> Text43   y=292.5
    #   "need care so someone else..."@36   block1 Yes/No glyphs y=326.2 @36/@69.5
    #                                         -> Check Box39/40 (x=33.4/65.1)
    #                                       block2 glyphs y=198.2 @36/@69.5
    #                                         -> Check Box52/53 (x=32.5/64.3)
    #   "need help with ADLs..."@266        block1 glyphs @333.5/@367.2
    #                                         -> Check Box31/32 (x=332.2/363.0)
    #                                       block2 -> Check Box44/45 (329.7/362.2)
    #   "work and have medical expenses"    block1 glyphs @268.5/@302.0
    #                                         -> Check Box36/37 (265.4/297.9)
    #                                       block2 -> Check Box49/50 (263.7/296.3)
    #   "in a medical facility..."@266      block1 glyphs @449.5/@483.2
    #                                         -> Check Box41/42 (445.7/479.0)
    #                                       block2 -> Check Box54/55 (445.7/479.0)
    #   "Disability is expected to last"    block1 30d Check Box34, 12mo Box35
    #                                       block2 30d "BOX 47 PG 6", 12mo Box48
    #
    # NOTE the literal field name "BOX 47 PG 6" — upper case, no "Check". The
    # AcroForm key is whatever the form author typed.
    #
    # The facility-name line is asymmetric and that is a genuine form omission,
    # not a gap in this mapping: block 2's label at y=218.5 x=266.3 has
    # "Text55A PG 6" at y=201.1 x=266.2, but block 1's label at y=330.5 x=266.3
    # has NO widget anywhere in its band. So a first-listed person's facility
    # name has nowhere to be written and stays manual work.
    #
    #: one dict per printed person block
    PAGE_6_DISABILITY_BLOCKS = (
        {
            "person_name": "Text30 PG 6",
            "needs_care": ("Check Box39 PG 6", "Check Box40 PG 6"),
            "daily_living": ("Check Box31 PG 6", "Check Box32 PG 6"),
            "daily_living_explanation": "Text33 PG 6",
            "works_with_medical": ("Check Box36 PG 6", "Check Box37 PG 6"),
            "works_with_medical_explanation": "Text38 PG 6",
            "in_facility": ("Check Box41 PG 6", "Check Box42 PG 6"),
            # No writable widget exists for this block's facility name.
            "facility_name": None,
            "duration_thirty_days": "Check Box34 PG 6",
            "duration_twelve_months": "Check Box35 PG 6",
        },
        {
            "person_name": "Text43 PG 6",
            "needs_care": ("Check Box52 PG 6", "Check Box53 PG 6"),
            "daily_living": ("Check Box44 PG 6", "Check Box45 PG 6"),
            "daily_living_explanation": "Text46 PG 6",
            "works_with_medical": ("Check Box49 PG 6", "Check Box50 PG 6"),
            "works_with_medical_explanation": "Text51 PG 6",
            "in_facility": ("Check Box54 PG 6", "Check Box55 PG 6"),
            "facility_name": "Text55A PG 6",
            "duration_thirty_days": "BOX 47 PG 6",
            "duration_twelve_months": "Check Box48 PG 6",
        },
    )

    # -----------------------------------------------------------------------
    # Q25 — Personal Property
    # -----------------------------------------------------------------------
    #
    # Separate from Q24: Q24 is cash/accounts, Q25 is physical personal and
    # business property with its own gateway, category checklist and item table.
    #
    # Gateway "Does anyone own any personal or business-related property?"
    # Yes glyph x=339.5 / No glyph x=373.2.
    PAGE_14_PERSONAL_PROPERTY_GATEWAY = (
        "Check Box42 PG 14",
        "Check Box43 PG 14",
    )

    # The printed checklist runs in two columns. Left column x=34.5, right
    # column x=220.4; each label sits about 3.6pt below its box centre, which is
    # what pairs them:
    #
    #   Tools                     box y=313.0  label y=308.8 @37.0
    #   Business inventory        box y=300.4  label y=296.8 @37.0
    #   Livestock                 box y=289.2  label y=284.8 @37.0
    #   Business equipment        box y=276.8  label y=272.8 @37.0
    #   Sporting equipment, Guns  box y=315.2  label y=310.2 @222.2
    #   Non-Motor boats/trailers  box y=302.8  label y=296.8 @222.2
    #   Camper shells             box y=290.6  label y=284.8 @222.2
    #   Personal tools            box y=278.5  label y=272.8 @222.2
    #   Jewelry/Artwork/etc.      box y=266.2  label y=262.2 @222.2
    #
    # "Tools" and "Personal tools" are two separate printed boxes in two
    # separate columns and stay separate here.
    #
    #: category -> checkbox destination
    PAGE_14_PERSONAL_PROPERTY_CATEGORIES = {
        "tools": "Check Box44 PG 14",
        "business_inventory": "Check Box45 PG 14",
        "livestock": "Check Box46 PG 14",
        "business_equipment": "Check Box47 PG 14",
        "sporting_equipment_guns": "Check Box48 PG 14",
        "non_motor_boats_or_trailers": "Check Box49 PG 14",
        "camper_shells": "Check Box50 PG 14",
        "personal_tools": "Check Box51 PG 14",
        "jewelry_artwork_or_collections": "Check Box52 PG 14",
    }

    # Three printed item rows. Columns, left to right:
    #   Item (x=37.3), listed-for-sale Yes (x=284.8) / No (x=313.8),
    #   Purchase Price or Current Value (x=353.0), Amount Owed (x=494.5).
    # The sale Yes/No glyphs sit at x=285.2 / x=315.5, matching the boxes.
    #
    #: (item, sale yes, sale no, value, amount owed)
    PAGE_14_PERSONAL_PROPERTY_ROWS = (
        ("Text53 PG 14", "Check Box54 PG 14", "Check Box55 PG 14",
         "Text56 PG 14", "Text57 PG 14"),
        ("Text58 PG 14", "Check Box59 PG 14", "Check Box60 PG 14",
         "Text61 PG 14", "Text62 PG 14"),
        ("Text63 PG 14", "Check Box64 PG 14", "Check Box65 PG 14",
         "Text66 PG 14", "Text67 PG 14"),
    )

    # -----------------------------------------------------------------------
    # Appendix E — vehicle detail, three printed columns
    # -----------------------------------------------------------------------
    #
    # The appendix is a three-column table (one column per vehicle) at
    # x≈167/304/441 for text and x≈169-187/308-332/443-463 for boxes. Each
    # printed row label sits in the left margin at x≈39-40 and its option glyphs
    # in column 1 at x≈170-187, which is what pairs label to widget:
    #
    #   "Owner of vehicle"                       y=632.0  -> Text1/2/3   y=635.7
    #   "Name of person who uses this vehicle"   y=614.0  -> Text4/5/6   y=613.5
    #   "Is this vehicle: used as a home / ..."  y=589.3, Yes glyph y=590.5 x=186.5
    #                                            -> Check Box1/2         y=595.4
    #   "Is this vehicle used by a child ..."    y=491.4, Yes glyph y=489.8
    #                                            -> Check Box7/8         y=495.9
    #   "Is this vehicle a gift, donation ..."   y=414.9; Yes y=410.5,
    #        Gift y=398.5, Family Transfer y=386.5, all x=186.5
    #                                            -> Yes Box13 / No Box16,
    #                                               Gift Box14 / Donation Box17,
    #                                               Family Transfer Box15
    #   "Year/Make/Model"                        y=323.0  -> Text28/29/30 y=324.1
    #   "Vehicle License Number"                 y=301.8  -> Text31/32/33 y=301.9
    #   "Estimated value ... Fair Market Value"  $ y=274.5 -> Text34      y=280.9
    #        "I don't know/I need help" y=264.5   -> Check Box35          y=269.7
    #   "How I found out the Fair Market Value"  For sale ads y=235.8,
    #        Kelly blue Book y=225.8, Mechanic y=215.8,
    #        Purchase price y=205.8, Other y=195.8
    #                                            -> Box40/41/42/43/44 + Text45
    #   "How much I owe on the vehicle"          $ y=178.5 -> Text61      y=182.2
    #        "I don't know/I need help" y=168.5   -> Check Box62          y=173.6
    #   "What I used to find the amount owed"    Last Bill y=139.0,
    #        Lender statement y=129.0, Estimate y=119.0, Other y=109.0
    #                                            -> Box67/68/69/70 + Text71
    #   "Is this a leased vehicle?"              Yes glyph y=88.8 x=187.5
    #                                            -> Check Box82/83        y=93.2
    #
    # Check Box46 / Box53 / Box60 (y=241.4, at a second x within each column)
    # have no printed label that coordinate matching resolves, so they are left
    # out rather than guessed.
    #
    # The sub-options of the two "Is this vehicle:" groups are printed with "G"
    # bullet glyphs, not widgets, so only each group's Yes/No pair is fillable.
    #
    #: one dict per printed vehicle column
    APPENDIX_E_VEHICLES = (
        {
            "owner": "Text1 appxE",
            "user": "Text4 appxE",
            "exempt_use": ("Check Box1 appx E", "Check Box2 appx E"),
            "child_use": ("Check Box7 appx E", "Check Box8 appx E"),
            "transfer": ("Check Box13 appx E", "Check Box16 appx E"),
            "transfer_kind": {
                "gift": "Check Box14 appx E",
                "donation": "Check Box17 appx E",
                "family_transfer": "Check Box15 appx E",
            },
            "year_make_model": "Text28 appx E",
            "license": "Text31 appx E",
            "value": "Text34 appx E",
            "value_unknown": "Check Box35 appx E",
            "value_source": {
                "for_sale_ads": "Check Box40 appx E",
                "kelly_blue_book": "Check Box41 appx E",
                "mechanic": "Check Box42 appx E",
                "purchase_price": "Check Box43 appx E",
                "other": "Check Box44 appx E",
            },
            "value_source_other": "Text45 appx E",
            "owed": "Text61 appx E",
            "owed_unknown": "Check Box62 appx E",
            "owed_source": {
                "last_bill": "Check Box67 appx E",
                "lender_statement": "Check Box68 appx E",
                "estimate": "Check Box69 appx E",
                "other": "Check Box70 appx E",
            },
            "owed_source_other": "Text71 appx E",
            "leased": ("Check Box82 appx E", "Check Box83 appx E"),
        },
        {
            "owner": "Text2 appxE",
            "user": "Text5 appxE",
            "exempt_use": ("Check Box3 appx E", "Check Box4 appx E"),
            "child_use": ("Check Box9 appx E", "Check Box10 appx E"),
            "transfer": ("Check Box18 appx E", "Check Box21 appx E"),
            "transfer_kind": {
                "gift": "Check Box19 appx E",
                "donation": "Check Box22 appx E",
                "family_transfer": "Check Box20 appx E",
            },
            "year_make_model": "Text29 appx E",
            "license": "Text32 appx E",
            "value": "Text36 appx E",
            "value_unknown": "Check Box37 appx E",
            "value_source": {
                "for_sale_ads": "Check Box47 appx E",
                "kelly_blue_book": "Check Box48 appx E",
                "mechanic": "Check Box49 appx E",
                "purchase_price": "Check Box50 appx E",
                "other": "Check Box51 appx E",
            },
            "value_source_other": "Text52 appx E",
            "owed": "Text63 appx E",
            "owed_unknown": "Check Box64 appx E",
            "owed_source": {
                "last_bill": "Check Box72 appx E",
                "lender_statement": "Check Box73 appx E",
                "estimate": "Check Box74 appx E",
                "other": "Check Box75 appx E",
            },
            "owed_source_other": "Text76 appx E",
            "leased": ("Check Box84 appx E", "Check Box85 appx E"),
        },
        {
            "owner": "Text3 appxE",
            "user": "Text6 appxE",
            "exempt_use": ("Check Box5 appx E", "Check Box6 appx E"),
            "child_use": ("Check Box11 appx E", "Check Box12 appx E"),
            "transfer": ("Check Box23 appx E", "Check Box26 appx E"),
            "transfer_kind": {
                "gift": "Check Box24 appx E",
                "donation": "Check Box27 appx E",
                "family_transfer": "Check Box25 appx E",
            },
            "year_make_model": "Text30 appx E",
            "license": "Text33 appx E",
            "value": "Text38 appx E",
            "value_unknown": "Check Box39 appx E",
            "value_source": {
                "for_sale_ads": "Check Box54 appx E",
                "kelly_blue_book": "Check Box55 appx E",
                "mechanic": "Check Box56 appx E",
                "purchase_price": "Check Box57 appx E",
                "other": "Check Box58 appx E",
            },
            "value_source_other": "Text59 appx E",
            "owed": "Text65 appx E",
            "owed_unknown": "Check Box66 appx E",
            "owed_source": {
                "last_bill": "Check Box77 appx E",
                "lender_statement": "Check Box78 appx E",
                "estimate": "Check Box79 appx E",
                "other": "Check Box80 appx E",
            },
            "owed_source_other": "Text81 appx E",
            "leased": ("Check Box86 appx E", "Check Box87 appx E"),
        },
    )

    # -----------------------------------------------------------------------
    # Appendix A — employer health coverage
    # -----------------------------------------------------------------------
    #
    # One printed page per employer that offers coverage. Verified against
    # printed page 18 (PDF page 24) by matching each numbered label to the
    # widget beneath it:
    #
    #   1. EMPLOYEE NAME                    Text1 PG 18   @38
    #   2. EMPLOYEE SOCIAL SECURITY NUMBER  Text2/3/4     @422/483/516  <- NEVER
    #   3. EMPLOYER NAME                    Text5         @39
    #   4. EMPLOYER IDENTIFICATION (EIN)    Text6/Text7   @420/452
    #   5. EMPLOYER ADDRESS                 Text8         @39
    #   6. EMPLOYER PHONE NUMBER            Text9/Text10  @434/467
    #   7. CITY / 8. STATE / 9. ZIP CODE    Text12/13/14  @39/329/421
    #  12. EMPLOYER'S EMAIL ADDRESS         Text18        @328
    #  13. eligible now or in three months  No  Check Box19, Yes Check Box20
    #      NOTE the printed order is No first, then Yes — the opposite of every
    #      other pair on this form, because a No stops the section.
    #  13a. waiting-period enrolment date   Text21        @433
    #      names of others eligible         Text22/23/24  @92/263/427
    #  14. meets minimum value standard     Yes Check Box25 @472 / No Box26 @506
    #  14a. State employee benefit plan     Yes Check Box27 @249 / No Box28 @282
    #  15a. premium amount                  Text29        @388
    #  15b. how often                       Check Box30-35 @151/222/295/385/450/515
    #      matching printed Weekly@163, Bi-weekly@235, Twice a month@307,
    #      Monthly@398, Quarterly@463, Yearly@532
    #  15.  no wellness programs            Check Box36   @38
    #  16.  will no longer provide          Check Box37   @59
    #       will start offering / change    Check Box38   @58
    #  16a. changed premium                 Text39        @389
    #  16b. how often                       Check Box40-45 @149/221/293/384/448/515
    #  16c. date of change                  Text46        @206
    #       no changes expected             Check Box47   @36
    #
    # Text15, Text16 and Text17 (printed items 10 and 11) are deliberately
    # absent: their labels do not extract with a usable text matrix, so the
    # rows they belong to were not resolved and are left for manual completion
    # rather than guessed.
    #
    # Items 2's three boxes appear nowhere below. They are in SSN_FIELDS and
    # therefore not in SAFE_FIELDS, so set_field() would raise on them.
    APPENDIX_A_EMPLOYEE_NAME = "Text1 PG 18"

    #: canonical suffix -> printed text destination
    APPENDIX_A_TEXT = {
        "employee_name": "Text1 PG 18",
        "employer_name": "Text5 PG 18",
        "employer_ein": "Text6 PG 18",
        "employer_address": "Text8 PG 18",
        "employer_city": "Text12 PG 18",
        "employer_state": "Text13 PG 18",
        "employer_zip_code": "Text14 PG 18",
        "employer_email": "Text18 PG 18",
        "waiting_period_enrollment_date": "Text21 PG 18",
        "lowest_cost_premium": "Text29 PG 18",
        "changed_premium": "Text39 PG 18",
        "plan_change_date": "Text46 PG 18",
    }

    # Item 6, "EMPLOYER PHONE NUMBER", is two boxes, not one. The page prints
    # "(          )" at x=434.0 and Text9 sits inside those parentheses at
    # x=433.7-464.3 — it is the area code, 30.6pt wide. Text10 at
    # x=467.5-577.3 takes the rest. Writing all ten digits into Text9 fitted a
    # 27.8pt string into a 26.6pt box even at the smallest legible size, which
    # is how this was found.
    #
    #: (area code, remaining digits)
    APPENDIX_A_PHONE = ("Text9 PG 18", "Text10 PG 18")

    #: The three printed "Name:" slots for others eligible from the same job.
    APPENDIX_A_OTHER_ELIGIBLE = (
        "Text22 PG 18",
        "Text23 PG 18",
        "Text24 PG 18",
    )

    #: canonical suffix -> (Yes destination, No destination)
    APPENDIX_A_YES_NO = {
        # Item 13 prints No first; the tuple stays (yes, no) so every caller
        # reads it the same way.
        "eligible_now_or_soon": ("Check Box20 PG 18", "Check Box19 PG 18"),
        "meets_minimum_value_standard": ("Check Box25 PG 18", "Check Box26 PG 18"),
        "is_state_employee_benefit_plan": ("Check Box27 PG 18", "Check Box28 PG 18"),
    }

    #: Appendix A prints six premium frequencies, including Quarterly and Yearly.
    APPENDIX_A_PREMIUM_FREQUENCY = {
        "weekly": "Check Box30 PG 18",
        "bi_weekly": "Check Box31 PG 18",
        "twice_a_month": "Check Box32 PG 18",
        "monthly": "Check Box33 PG 18",
        "quarterly": "Check Box34 PG 18",
        "yearly": "Check Box35 PG 18",
    }

    APPENDIX_A_CHANGED_PREMIUM_FREQUENCY = {
        "weekly": "Check Box40 PG 18",
        "bi_weekly": "Check Box41 PG 18",
        "twice_a_month": "Check Box42 PG 18",
        "monthly": "Check Box43 PG 18",
        "quarterly": "Check Box44 PG 18",
        "yearly": "Check Box45 PG 18",
    }

    APPENDIX_A_NO_WELLNESS = "Check Box36 PG 18"

    APPENDIX_A_PLAN_CHANGE = {
        "will_no_longer_provide": "Check Box37 PG 18",
        "will_start_offering_or_change_premium": "Check Box38 PG 18",
        "no_changes_expected": "Check Box47 PG 18",
    }

    # -----------------------------------------------------------------------
    # Appendix B — American Indian / Alaska Native
    # -----------------------------------------------------------------------
    #
    # Two person columns at x≈250 and x≈415. Verified on printed page
    # "APPENDIX B" (PDF page 25) by matching each printed marker to the widget:
    #
    #   1. Name        "First Middle" y=587.5 -> Text1  y=578.3
    #                  "Last"         y=564.2 -> Text2b y=555.7
    #   2. Member of a federally recognized tribe?
    #                  Yes y=534.2 x=251.2 -> Check Box5 y=537.9
    #                  No  y=498.0 x=251.2 -> Check Box7 y=501.7
    #                  "If yes, tribe name" y=523.4 -> Text6 y=515.1
    #   3. Ever got a service from the Indian Health Service?
    #                  Yes y=463.5 -> Check Box11 y=467.8
    #                  No  y=448.8 -> Check Box12 y=452.2
    #      "If NO, is this person eligible to get services ..." — note the
    #      follow-up hangs off a No, not a Yes:
    #                  Yes y=369.5 x=268.2 -> Check Box13 y=373.0
    #                  no  y=369.5 x=315.5 -> Check Box14 y=373.0
    #   4. Certain money may not be counted ...
    #                  "Yes - if yes, please complete" y=345.5 -> Check Box19
    #                  "None to report"                y=320.0 -> Check Box20
    #                  "$______"     y=298.5 -> Text21 y=302.1
    #                  "How often?"  y=244.5 -> Text22 y=247.7
    #
    # NOTE the field names all read "APPX A" even though this is Appendix B.
    # That is the form author's error and the AcroForm key is what it is.
    #
    #: one dict per printed person column
    APPENDIX_B_PEOPLE = (
        {
            "first_middle_name": "Text1 APPX A",
            "last_name": "Text2b APPX A",
            "member_of_tribe": ("Check Box5 APPX A", "Check Box7 APPX A"),
            "tribe_name": "Text6 APPX A",
            "received_ihs": ("Check Box11 APPX A", "Check Box12 APPX A"),
            "eligible_for_ihs": ("Check Box13 APPX A", "Check Box14 APPX A"),
            "tribal_income": ("Check Box19 APPX A", "Check Box20 APPX A"),
            "tribal_income_amount": "Text21 APPX A",
            "tribal_income_frequency": "Text22 APPX A",
        },
        {
            "first_middle_name": "Text3 APPX A",
            "last_name": "Text4 APPX A",
            "member_of_tribe": ("Check Box8 APPX A", "Check Box10 APPX A"),
            "tribe_name": "Text9 APPX A",
            "received_ihs": ("Check Box15 APPX A", "Check Box16 APPX A"),
            "eligible_for_ihs": ("Check Box17 APPX A", "Check Box18 APPX A"),
            "tribal_income": ("Check Box23 APPX A", "Check Box24 APPX A"),
            "tribal_income_amount": "Text25 APPX A",
            "tribal_income_frequency": "Text26 APPX A",
        },
    )

    # -----------------------------------------------------------------------
    # Appendix D — employment history
    # -----------------------------------------------------------------------
    #
    # Two printed pages of identical shape, each one person with three job
    # blocks:
    #
    #   PDF page 27, "APPENDIX D-1", printed heading "Person1"  — names "appx c"
    #   PDF page 28, "APPENDIX D-2", printed heading "Person 2" — names "appx d2"
    #
    # NOTE the D-1 widgets all read "appx c". The form's appendix widget names
    # are shifted one letter behind the printed appendix throughout: Appendix B
    # uses "APPX A", Appendix C uses "APPX B", Appendix D-1 uses "appx c". The
    # AcroForm key is what it is, so the literal names are used verbatim.
    #
    # Every destination below was resolved by matching the printed label's text
    # matrix against the widget rectangle on the real form. The two pages are
    # laid out identically, so the same y-bands recur; the x positions
    # disambiguate within a row. Job 1 of Person1, as the worked example:
    #
    #   "NAME:"                             y=650.2 -> Text1 appx c   y=635.5
    #   "Is this person Native American?"    y=603.5
    #                     "Y es" x=158.5    -> Check Box1b  x=156.8
    #                     "No"   x=191.2    -> Check Box1c  x=189.6
    #   "Name of Tribe:"                     y=581.5 -> Text2  x=88.5
    #   "Reason for leaving this job?"       y=609.5 x=338.2 -> Text3 x=337.5
    #   "Name and Address of Employer:"      y=566.8 -> Text4  y=543.3
    #   "Number of hours worked:"            y=567.5 x=419.3
    #                     "Daily"   x=421.0 -> Check Box5 x=419.4
    #                     "Weekly"  x=460.2 -> Check Box6 x=458.8
    #                     "Monthly" x=508.5 -> Check Box7 x=506.8
    #   "Was this your own business ...?"    y=530.8
    #                     "Y es" x=38.5     -> Check Box8 x=37.4
    #                     "No"   x=71.2     -> Check Box9 x=69.1
    #   "From____ To____"                    y=512.8 -> Text9b x=437.8,
    #                                                  Text9c x=501.2
    #   "How much ... paid ... $______"      y=493.3 -> Text 10 x=252.5
    #                                        (the literal name has a space)
    #                     "Hourly"          x=36.2  -> Check Box11 x=35.2
    #                     "Daily"           x=81.8  -> Check Box12 x=80.2
    #                     "Weekly"          x=123.8 -> Check Box13 x=122.4
    #                     "Every two weeks" x=177.0 -> Check Box14 x=175.6
    #                     "Monthly"         x=268.8 -> Check Box15 x=266.4
    #   "Did the County help you get this job?" y=501.8 x=335.3
    #                     "Y es" x=337.0    -> Check Box16 x=335.4
    #                     "No"   x=369.8    -> Check Box17 x=368.7
    #
    # Two source-form irregularities the coordinates caught, and which the
    # sequential names would have got wrong:
    #
    #   * D-2 Job 1 "Number of hours worked" runs Daily=Check Box8, Weekly=Check
    #     Box7, Monthly=Check Box9 — 7 and 8 are transposed relative to the
    #     printed left-to-right order.
    #   * D-1 Job 3 has Text41 (reason for leaving, x=336.5) before Text40 (tribe
    #     name, x=87.1) in the annotation array.
    #
    # NOT WRITABLE, recorded so the search is not repeated: the printed line
    # "Number of hours worked:" is followed only by the Daily/Weekly/Monthly
    # checkboxes. There is no text widget for the count anywhere in either page's
    # 61 widgets, so the frequency is written and the count is reported as a
    # manual write-in.

    #: one dict per printed person block, each with its three printed job blocks
    APPENDIX_D_PERSONS = (
        # ---- Appendix D-1, printed "Person1", widget suffix "appx c" --------
        {
            "person_name": "Text1 appx c",
            "jobs": (
                {
                    "native_american": ("Check Box1b appx c", "Check Box1c appx c"),
                    "tribe_name": "Text2 appx c",
                    "reason_for_leaving": "Text3 appx c",
                    "employer": "Text4 appx c",
                    "hours_frequency": {
                        "daily": "Check Box5 appx c",
                        "weekly": "Check Box6 appx c",
                        "monthly": "Check Box7 appx c",
                    },
                    "self_employed": ("Check Box8 appx c", "Check Box9 appx c"),
                    "worked_from": "Text9b appx c",
                    "worked_to": "Text9c appx c",
                    # The literal AcroForm name contains a space after "Text".
                    "pay_amount": "Text 10 appx c",
                    "pay_frequency": {
                        "hourly": "Check Box11 appx c",
                        "daily": "Check Box12 appx c",
                        "weekly": "Check Box13 appx c",
                        "every_two_weeks": "Check Box14 appx c",
                        "monthly": "Check Box15 appx c",
                    },
                    "county_helped": ("Check Box16 appx c", "Check Box17 appx c"),
                },
                {
                    "native_american": ("Check Box18 appx c", "Check Box19 appx c"),
                    "tribe_name": "Text20 appx c",
                    "reason_for_leaving": "Text21 appx c",
                    "employer": "Text22 appx c",
                    "hours_frequency": {
                        "daily": "Check Box23 appx c",
                        "weekly": "Check Box24 appx c",
                        "monthly": "Check Box25 appx c",
                    },
                    "self_employed": ("Check Box26 appx c", "Check Box27 appx c"),
                    "worked_from": "Text28 appx c",
                    "worked_to": "Text29 appx c",
                    "pay_amount": "Text30 appx c",
                    "pay_frequency": {
                        "hourly": "Check Box31 appx c",
                        "daily": "Check Box32 appx c",
                        "weekly": "Check Box33 appx c",
                        "every_two_weeks": "Check Box34 appx c",
                        "monthly": "Check Box35 appx c",
                    },
                    "county_helped": ("Check Box36 appx c", "Check Box37 appx c"),
                },
                {
                    "native_american": ("Check Box38 appx c", "Check Box39 appx c"),
                    "tribe_name": "Text40 appx c",
                    "reason_for_leaving": "Text41 appx c",
                    "employer": "Text42 appx c",
                    "hours_frequency": {
                        "daily": "Check Box43 appx c",
                        "weekly": "Check Box44 appx c",
                        "monthly": "Check Box45 appx c",
                    },
                    "self_employed": ("Check Box46 appx c", "Check Box47 appx c"),
                    "worked_from": "Text48 appx c",
                    "worked_to": "Text49 appx c",
                    "pay_amount": "Text50 appx c",
                    "pay_frequency": {
                        "hourly": "Check Box51 appx c",
                        "daily": "Check Box52 appx c",
                        "weekly": "Check Box53 appx c",
                        "every_two_weeks": "Check Box54 appx c",
                        "monthly": "Check Box55 appx c",
                    },
                    "county_helped": ("Check Box56 appx c", "Check Box57 appx c"),
                },
            ),
        },
        # ---- Appendix D-2, printed "Person 2", widget suffix "appx d2" ------
        {
            "person_name": "Text1 appx d2",
            "jobs": (
                {
                    "native_american": ("Check Box2 appx d2", "Check Box3 appx d2"),
                    "tribe_name": "Text4 appx d2",
                    "reason_for_leaving": "Text5 appx d2",
                    "employer": "Text6 appx d2",
                    # Daily is Check Box8 and Weekly is Check Box7: the source
                    # form transposes them relative to the printed order.
                    "hours_frequency": {
                        "daily": "Check Box8 appx d2",
                        "weekly": "Check Box7 appx d2",
                        "monthly": "Check Box9 appx d2",
                    },
                    "self_employed": ("Check Box10 appx d2", "Check Box11 appx d2"),
                    "worked_from": "Text12 appx d2",
                    "worked_to": "Text13 appx d2",
                    "pay_amount": "Text14 appx d2",
                    "pay_frequency": {
                        "hourly": "Check Box15 appx d2",
                        "daily": "Check Box16 appx d2",
                        "weekly": "Check Box17 appx d2",
                        "every_two_weeks": "Check Box18 appx d2",
                        "monthly": "Check Box19 appx d2",
                    },
                    "county_helped": ("Check Box20 appx d2", "Check Box21 appx d2"),
                },
                {
                    "native_american": ("Check Box22 appx d2", "Check Box23 appx d2"),
                    # These four read "Appx D2" with different capitalisation
                    # from their neighbours. The AcroForm key is case-sensitive.
                    "tribe_name": "Text24 Appx D2",
                    "reason_for_leaving": "Text25 Appx D2",
                    "employer": "Text26 Appx D2",
                    "hours_frequency": {
                        "daily": "Check Box27 appx d2",
                        "weekly": "Check Box28 appx d2",
                        "monthly": "Check Box29 appx d2",
                    },
                    "self_employed": ("Check Box30 appx d2", "Check Box31 appx d2"),
                    "worked_from": "Text32 Appx D2",
                    "worked_to": "Text33 Appx D2",
                    "pay_amount": "Text34 Appx D2",
                    "pay_frequency": {
                        "hourly": "Check Box35 appx d2",
                        "daily": "Check Box36 appx d2",
                        "weekly": "Check Box37 appx d2",
                        "every_two_weeks": "Check Box38 appx d2",
                        "monthly": "Check Box39 appx d2",
                    },
                    "county_helped": ("Check Box40 appx d2", "Check Box41 appx d2"),
                },
                {
                    "native_american": ("Check Box42 appx d2", "Check Box43 appx d2"),
                    "tribe_name": "Text44 Appx D2",
                    "reason_for_leaving": "Text45 Appx D2",
                    "employer": "Text46 Appx D2",
                    "hours_frequency": {
                        "daily": "Check Box47 appx d2",
                        "weekly": "Check Box48 appx d2",
                        "monthly": "Check Box49 appx d2",
                    },
                    "self_employed": ("Check Box50 appx d2", "Check Box51 appx d2"),
                    "worked_from": "Text52 Appx D2",
                    "worked_to": "Text53 Appx D2",
                    "pay_amount": "Text54 Appx D2",
                    "pay_frequency": {
                        "hourly": "Check Box55 appx d2",
                        "daily": "Check Box56 appx d2",
                        "weekly": "Check Box57 appx d2",
                        "every_two_weeks": "Check Box58 appx d2",
                        "monthly": "Check Box59 appx d2",
                    },
                    "county_helped": ("Check Box60 appx d2", "Check Box61 appx d2"),
                },
            ),
        },
    )

    # -----------------------------------------------------------------------
    # Appendix C — the health-insurance authorized representative
    # -----------------------------------------------------------------------
    #
    # PDF page 26, printed "APPENDIX C". Its widgets read "APPX B", one letter
    # behind the printed appendix, like every other appendix on this form.
    #
    # The page has two blocks. The upper one identifies the representative and
    # is filled from the answers the applicant already gave:
    #
    #   "1. Name of authorized representative"  y=678.1 -> Text1  y=654.1
    #   "2. Address"                            y=642.1 -> Text2  y=618.4
    #   "3. Apartment or Suite number"  x=437.5 -> Text3  x=437.5
    #   "4. City" / "5. State" / "6. Zip code"  -> Text4 / Text5 / Text6
    #   "7. Phone number"                       y=570.1 -> Text7 (area code,
    #                                              x=54.2-81.3, 27.1pt) and
    #                                              Text8 (x=86.5-256.5)
    #   "8. Organization name (if applicable)"  -> Text9
    #   "9. I.D. Number (if applicable)"        -> Text10
    #
    # Items 10 and 11 are the applicant's own signature and its date. The
    # signature line has no widget; Text11 is the date box beside it and stays
    # blank, because dating a signature is part of signing it.
    #
    # The lower block is headed "For Certified Application Counselors,
    # Navigators, Agents and Brokers Only" (Text12-15). Nothing in the model
    # describes the person filling the form in on someone else's behalf, so it
    # is left for them and reported as manual.
    #
    #: canonical suffix -> printed text destination
    # Verified by widget coordinate against the printed item numbers on
    # page 26: the label above each box shares its x position.
    #
    #   Text1  y654 x52   1. Name of authorized representative
    #   Text2  y618 x52   2. Address
    #   Text3  y639 x437  3. Apartment or Suite number
    #   Text4  y582 x52   4. City
    #   Text5  y582 x264  5. State
    #   Text6  y582 x437  6. Zip code
    #   Text9  y510 x50   8. Organization name (if applicable)
    APPENDIX_C_REPRESENTATIVE = {
        "name": "Text1 APPX B",
        "address": "Text2 APPX B",
        "apartment": "Text3 APPX B",
        "city": "Text4 APPX B",
        "state": "Text5 APPX B",
        "zip_code": "Text6 APPX B",
        "organization": "Text9 APPX B",
    }

    #: Item 7, split like Appendix A's: (area code, remaining digits).
    APPENDIX_C_PHONE = ("Text7 APPX B", "Text8 APPX B")

    # Not written, and recorded so the search is not repeated:
    #   Text10 (I.D. number) — not collected. The printed box says "if
    #     applicable"; an authorized representative's county-issued I.D. number
    #     is not something intake can know, and inventing one would be worse
    #     than the blank the applicant can fill in.
    #   Text11 — the date beside item 10's signature.
    #   Text12-15 — the counsellor/navigator block.

    # -----------------------------------------------------------------------
    # Page 2 — the CalFresh authorized representative
    # -----------------------------------------------------------------------
    #
    # Section 2, "HOUSEHOLD'S AUTHORIZED REPRESENTATIVE", prints only a name
    # and a phone number; the fuller address block belongs to Appendix C. Both
    # labels sit at y=630.9 with the fields left and right of each other:
    #
    #   Text3 PG 2  x=33.9   AUTHORIZED REPRESENTATIVE NAME
    #   Text4 PG 2  x=368.5  AUTHORIZED REPRESENTATIVE PHONE NUMBER
    PAGE_2_REPRESENTATIVE = {
        "name": "Text3 PG 2",
        "phone": "Text4 PG 2",
    }

    #: Q14's two printed free-text lines.
    PAGE_11_SPECIAL_NEED_TEXT = {
        # "Please list the name of the person with the special need and explain"
        "expenses.special_need.person": "Text22 PG 11",
        # The line beside "Other special need? (specify)".
        "expenses.special_need.other_description": "Text21 PG 11",
    }

    #: Q21a "If yes, who:" — the text line beside the Yes/No pair, x=197.8.
    PAGE_13_ELDERLY_SEPARATE_MEALS_WHO = "Text13 PG 13"

    # -----------------------------------------------------------------------
    # Q23b-Q23e — the tax household
    # -----------------------------------------------------------------------
    #
    # Each of these text destinations sits alone on its printed line, so the
    # widget rectangle identifies it without ambiguity:
    #
    #   Q23b "Name of person planning to file ..."   Text61 PG 13, x=321.3
    #   Q23c "If yes, name of spouse: ..."           Text64 PG 13, x=177.5
    #   Q23d "If yes, please list the name(s) ..."   Text67 PG 13, x=347.3
    #   Q23e "How is the dependent(s) ... related"   Text68 PG 13, x=405.5
    #
    #: canonical key -> printed text destination
    PAGE_13_TAX_TEXT = {
        "health.tax_filer_name": "Text61 PG 13",
        "health.spouse_name": "Text64 PG 13",
        "health.tax_dependent_names": "Text67 PG 13",
        "health.tax_dependent_relationships": "Text68 PG 13",
    }

    # -----------------------------------------------------------------------
    # Verified as UNMAPPABLE — recorded so the search is not repeated
    # -----------------------------------------------------------------------
    #
    # Q23f asks the applicant to consent to automatic renewal from tax data.
    # The printed page offers two opposite choices:
    #
    #   y=61.8  "Yes, renew my eligibility automatically for the next ..."
    #   y=51.8  "No, don't use information from tax returns to renew my
    #            coverage."
    #
    # Both printed markers start at x≈83.7, and the AcroForm contains exactly
    # ONE checkbox for them: "Check Box74 PG 13" at x=83.5, mid_y=56.6 — 5.2pt
    # from each line, so its rectangle does not disambiguate them. The duration
    # boxes (Check Box69-73 PG 13, "5/4/3/2/1 years") sit on the Yes line at
    # mid_y=65.1 and are unambiguous, but the model carries no duration.
    #
    # Ticking that one box could therefore tell the county either "renew my
    # coverage automatically" or "never use my tax returns" — opposite
    # instructions about the applicant's tax data. It stays unwritten.
    Q23F_AMBIGUOUS_CONSENT_BOX = "Check Box74 PG 13"

    SAFE_FIELDS = frozenset(
        {
            *(
                field
                for pair in GATEWAY_YES_NO.values()
                for field in pair
            ),
            PAGE_13_ELDERLY_SEPARATE_MEALS_WHO,
            *PAGE_13_TAX_TEXT.values(),
            *PAGE_2_INTERVIEW_PREFERENCE.values(),
            *PAGE_3_SAME_CONTACT_GATEWAY,
            *PAGE_14_PERSONAL_PROPERTY_GATEWAY,
            *(
                field
                for column in APPENDIX_B_PEOPLE
                for value in column.values()
                for field in (
                    value
                    if isinstance(value, tuple)
                    else (value,)
                )
            ),
            *(
                field
                for person in APPENDIX_D_PERSONS
                for field in (
                    person["person_name"],
                    *(
                        destination
                        for job in person["jobs"]
                        for value in job.values()
                        for destination in (
                            tuple(value.values())
                            if isinstance(value, dict)
                            else value
                            if isinstance(value, tuple)
                            else (value,)
                        )
                    ),
                )
            ),
            *APPENDIX_A_TEXT.values(),
            *APPENDIX_A_PHONE,
            *APPENDIX_C_REPRESENTATIVE.values(),
            *APPENDIX_C_PHONE,
            *PAGE_2_REPRESENTATIVE.values(),
            *APPENDIX_A_OTHER_ELIGIBLE,
            *(f for pair in APPENDIX_A_YES_NO.values() for f in pair),
            *APPENDIX_A_PREMIUM_FREQUENCY.values(),
            *APPENDIX_A_CHANGED_PREMIUM_FREQUENCY.values(),
            APPENDIX_A_NO_WELLNESS,
            *APPENDIX_A_PLAN_CHANGE.values(),
            *(
                field
                for column in APPENDIX_E_VEHICLES
                for value in column.values()
                for field in (
                    tuple(value.values())
                    if isinstance(value, dict)
                    else value
                    if isinstance(value, tuple)
                    else (value,)
                )
            ),
            *PAGE_14_PERSONAL_PROPERTY_CATEGORIES.values(),
            *(
                field
                for row in PAGE_14_PERSONAL_PROPERTY_ROWS
                for field in row
            ),
            *(
                field
                for block in PAGE_6_DISABILITY_BLOCKS
                for value in block.values()
                for field in (
                    value
                    if isinstance(value, tuple)
                    else (value,)
                )
                if field is not None
            ),
            *(field for block in PAGE_3_CONTACT_BLOCKS for field in block),
            *PAGE_11_SPECIAL_NEED_TEXT.values(),

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

        # -------------------------------------------------------------------
        # Page 2 — the CalFresh authorized representative
        # -------------------------------------------------------------------
        #
        # Section 2 prints one name and one phone box, so the first
        # representative the household named for CalFresh takes them. A
        # representative appointed only for health coverage does not belong
        # here: the printed question asks about the CalFresh case.
        for rep_index in range(_MAX_AUTHORIZED_REPRESENTATIVES):
            rep_prefix = f"household.authorized_representative.{rep_index}"

            if canonical_values.get(f"{rep_prefix}.for_calfresh") is not True:
                continue

            set_field(
                self.PAGE_2_REPRESENTATIVE["name"],
                canonical_values.get(f"{rep_prefix}.name"),
            )

            digits = "".join(
                character
                for character in str(
                    canonical_values.get(f"{rep_prefix}.phone") or ""
                )
                if character.isdigit()
            )

            if len(digits) == 10:
                set_field(
                    self.PAGE_2_REPRESENTATIVE["phone"],
                    f"({digits[:3]}) {digits[3:6]}-{digits[6:]}",
                )

            break

        # -------------------------------------------------------------------
        # Appendix C — the health-insurance authorized representative
        # -------------------------------------------------------------------
        appendix_c_prefix = "appendices.representative"

        if any(
            key.startswith(f"{appendix_c_prefix}.")
            for key in canonical_values
        ):
            for canonical_suffix, pdf_field in (
                self.APPENDIX_C_REPRESENTATIVE.items()
            ):
                set_field(
                    pdf_field,
                    canonical_values.get(
                        f"{appendix_c_prefix}.{canonical_suffix}"
                    ),
                )

            digits = "".join(
                character
                for character in str(
                    canonical_values.get(f"{appendix_c_prefix}.phone") or ""
                )
                if character.isdigit()
            )

            if len(digits) == 10:
                area_code_field, number_field = self.APPENDIX_C_PHONE
                set_field(area_code_field, digits[:3])
                set_field(number_field, f"{digits[3:6]}-{digits[6:]}")

        # -------------------------------------------------------------------
        # Appendix D — employment history
        # -------------------------------------------------------------------
        #
        # The person and job blocks a job belongs to were decided by
        # planAppendixDRows before the plan reached here, so this only places
        # the values it is given. A block whose keys are absent stays blank:
        # that is how a household with one working adult leaves "Person 2"
        # untouched instead of half-filling a second printed page.
        for person_index, person in enumerate(self.APPENDIX_D_PERSONS):
            person_prefix = f"appendices.employment.{person_index}"

            if not any(
                key.startswith(f"{person_prefix}.")
                for key in canonical_values
            ):
                continue

            set_field(
                person["person_name"],
                canonical_values.get(f"{person_prefix}.person_name"),
            )

            for job_index, job in enumerate(person["jobs"]):
                prefix = f"{person_prefix}.job.{job_index}"

                for suffix in (
                    "tribe_name",
                    "reason_for_leaving",
                    "employer",
                    "worked_from",
                    "worked_to",
                    "pay_amount",
                ):
                    set_field(
                        job[suffix],
                        canonical_values.get(f"{prefix}.{suffix}"),
                    )

                for suffix in (
                    "native_american",
                    "self_employed",
                    "county_helped",
                ):
                    value = canonical_values.get(f"{prefix}.{suffix}")

                    if not isinstance(value, bool):
                        continue

                    yes_field, no_field = job[suffix]
                    set_field(yes_field if value else no_field, "/Yes")

                # Frequencies are single-choice rows: an unrecognised value
                # ticks nothing rather than guessing the nearest box.
                for suffix in ("hours_frequency", "pay_frequency"):
                    choice = canonical_values.get(f"{prefix}.{suffix}")
                    destination = job[suffix].get(choice) if choice else None

                    if destination:
                        set_field(destination, "/Yes")

        # -------------------------------------------------------------------
        # Appendix B — American Indian / Alaska Native
        # -------------------------------------------------------------------
        for column_index, column in enumerate(
            self.APPENDIX_B_PEOPLE
        ):
            prefix = (
                f"appendices.tribal.{column_index}"
            )

            if not any(
                key.startswith(f"{prefix}.")
                for key in canonical_values
            ):
                continue

            # The printed column splits the name across two lines.
            name = str(
                canonical_values.get(f"{prefix}.person_name")
                or ""
            ).strip()

            if name:
                parts = name.split()
                set_field(
                    column["first_middle_name"],
                    " ".join(parts[:-1]) if len(parts) > 1 else name,
                )

                if len(parts) > 1:
                    set_field(
                        column["last_name"],
                        parts[-1],
                    )

            for canonical_suffix, column_key in (
                ("member_of_tribe", "member_of_tribe"),
                ("received_indian_health_service", "received_ihs"),
                ("eligible_for_indian_health_service", "eligible_for_ihs"),
                ("has_excludable_tribal_income", "tribal_income"),
            ):
                value = canonical_values.get(
                    f"{prefix}.{canonical_suffix}"
                )

                if not isinstance(
                    value,
                    bool,
                ):
                    continue

                yes_field, no_field = column[column_key]
                set_field(
                    yes_field if value else no_field,
                    "/Yes",
                )

            for canonical_suffix, column_key in (
                ("tribe_name", "tribe_name"),
                ("tribal_income_amount", "tribal_income_amount"),
                ("tribal_income_frequency", "tribal_income_frequency"),
            ):
                set_field(
                    column[column_key],
                    canonical_values.get(
                        f"{prefix}.{canonical_suffix}"
                    ),
                )

        # -------------------------------------------------------------------
        # Appendix A — employer health coverage
        # -------------------------------------------------------------------
        #
        # The form provides one printed page, so only the first employer record
        # can be written; a second employer needs another copy of the appendix
        # and is reported as overflow.
        appendix_a_prefix = "appendices.employer_coverage.0"

        if any(
            key.startswith(f"{appendix_a_prefix}.")
            for key in canonical_values
        ):
            for canonical_suffix, pdf_field in self.APPENDIX_A_TEXT.items():
                set_field(
                    pdf_field,
                    canonical_values.get(
                        f"{appendix_a_prefix}.{canonical_suffix}"
                    ),
                )

            # Item 6 splits the phone across the printed "(   )" and the line
            # beside it. Only a recognisable ten-digit number is split; anything
            # else leaves both boxes blank rather than guessing where to cut.
            digits = "".join(
                character
                for character in str(
                    canonical_values.get(f"{appendix_a_prefix}.employer_phone")
                    or ""
                )
                if character.isdigit()
            )

            if len(digits) == 10:
                area_code_field, number_field = self.APPENDIX_A_PHONE
                set_field(area_code_field, digits[:3])
                set_field(number_field, f"{digits[3:6]}-{digits[6:]}")

            for slot, pdf_field in enumerate(
                self.APPENDIX_A_OTHER_ELIGIBLE
            ):
                set_field(
                    pdf_field,
                    canonical_values.get(
                        f"{appendix_a_prefix}.other_eligible.{slot}"
                    ),
                )

            for (
                canonical_suffix,
                (yes_field, no_field),
            ) in self.APPENDIX_A_YES_NO.items():
                value = canonical_values.get(
                    f"{appendix_a_prefix}.{canonical_suffix}"
                )

                if not isinstance(
                    value,
                    bool,
                ):
                    continue

                set_field(
                    yes_field if value else no_field,
                    "/Yes",
                )

            for canonical_suffix, table in (
                ("lowest_cost_premium_frequency", self.APPENDIX_A_PREMIUM_FREQUENCY),
                (
                    "changed_premium_frequency",
                    self.APPENDIX_A_CHANGED_PREMIUM_FREQUENCY,
                ),
                ("plan_change", self.APPENDIX_A_PLAN_CHANGE),
            ):
                choice = str(
                    canonical_values.get(
                        f"{appendix_a_prefix}.{canonical_suffix}"
                    )
                    or ""
                ).strip()

                pdf_field = table.get(
                    choice
                )

                if pdf_field is not None:
                    set_field(
                        pdf_field,
                        "/Yes",
                    )

            if canonical_values.get(
                f"{appendix_a_prefix}.no_wellness_programs"
            ) is True:
                set_field(
                    self.APPENDIX_A_NO_WELLNESS,
                    "/Yes",
                )

        # -------------------------------------------------------------------
        # Appendix E — vehicle detail
        # -------------------------------------------------------------------
        for column_index, column in enumerate(
            self.APPENDIX_E_VEHICLES
        ):
            prefix = (
                f"appendices.vehicle.{column_index}"
            )

            if not any(
                key.startswith(f"{prefix}.")
                for key in canonical_values
            ):
                continue

            for canonical_suffix, column_key in (
                ("owner_name", "owner"),
                ("user_name", "user"),
                ("year_make_model", "year_make_model"),
                ("license_number", "license"),
                ("fair_market_value", "value"),
                ("amount_owed", "owed"),
                ("fair_market_value_source_other", "value_source_other"),
                ("amount_owed_source_other", "owed_source_other"),
            ):
                set_field(
                    column[column_key],
                    canonical_values.get(
                        f"{prefix}.{canonical_suffix}"
                    ),
                )

            for canonical_suffix, column_key in (
                ("used_for_exempt_purpose", "exempt_use"),
                ("used_by_child_under_18", "child_use"),
                ("is_gift_donation_or_transfer", "transfer"),
                ("is_leased", "leased"),
            ):
                value = canonical_values.get(
                    f"{prefix}.{canonical_suffix}"
                )

                if not isinstance(
                    value,
                    bool,
                ):
                    continue

                yes_field, no_field = column[column_key]
                set_field(
                    yes_field if value else no_field,
                    "/Yes",
                )

            # Single-choice option groups: gift kind, and how the value and the
            # amount owed were established.
            for canonical_suffix, column_key in (
                ("transfer_kind", "transfer_kind"),
                ("fair_market_value_source", "value_source"),
                ("amount_owed_source", "owed_source"),
            ):
                choice = str(
                    canonical_values.get(
                        f"{prefix}.{canonical_suffix}"
                    )
                    or ""
                ).strip()

                pdf_field = column[column_key].get(
                    choice
                )

                if pdf_field is not None:
                    set_field(
                        pdf_field,
                        "/Yes",
                    )

            # The two "I don't know / I need help finding out" boxes.
            for canonical_suffix, column_key in (
                ("fair_market_value_unknown", "value_unknown"),
                ("amount_owed_unknown", "owed_unknown"),
            ):
                if canonical_values.get(
                    f"{prefix}.{canonical_suffix}"
                ) is True:
                    set_field(
                        column[column_key],
                        "/Yes",
                    )

        # -------------------------------------------------------------------
        # Q25 — Personal Property
        # -------------------------------------------------------------------
        personal_property_gateway = canonical_values.get(
            "resources.has_personal_property"
        )

        if isinstance(
            personal_property_gateway,
            bool,
        ):
            yes_field, no_field = self.PAGE_14_PERSONAL_PROPERTY_GATEWAY
            set_field(
                yes_field if personal_property_gateway else no_field,
                "/Yes",
            )

        for (
            category,
            pdf_field,
        ) in self.PAGE_14_PERSONAL_PROPERTY_CATEGORIES.items():
            if canonical_values.get(
                f"resources.personal_property.category.{category}"
            ) is True:
                set_field(
                    pdf_field,
                    "/Yes",
                )

        for row_index, row in enumerate(
            self.PAGE_14_PERSONAL_PROPERTY_ROWS
        ):
            prefix = (
                f"resources.personal_property.{row_index}"
            )

            if not any(
                key.startswith(f"{prefix}.")
                for key in canonical_values
            ):
                continue

            item, sale_yes, sale_no, value, owed = row

            set_field(
                item,
                canonical_values.get(f"{prefix}.item"),
            )

            listed = canonical_values.get(
                f"{prefix}.listed_for_sale"
            )

            if isinstance(
                listed,
                bool,
            ):
                set_field(
                    sale_yes if listed else sale_no,
                    "/Yes",
                )

            set_field(
                value,
                canonical_values.get(
                    f"{prefix}.purchase_price_or_current_value"
                ),
            )

            set_field(
                owed,
                canonical_values.get(f"{prefix}.amount_owed"),
            )

        # -------------------------------------------------------------------
        # Q6j — per-disabled-person detail
        # -------------------------------------------------------------------
        for block_index, block in enumerate(
            self.PAGE_6_DISABILITY_BLOCKS
        ):
            prefix = (
                f"household.disability_detail.{block_index}"
            )

            if not any(
                key.startswith(f"{prefix}.")
                for key in canonical_values
            ):
                continue

            set_field(
                block["person_name"],
                canonical_values.get(f"{prefix}.person_name"),
            )

            for canonical_suffix, pair_key in (
                ("needs_care_for_others_to_work", "needs_care"),
                ("needs_help_daily_living", "daily_living"),
                ("works_with_medical_expenses", "works_with_medical"),
                ("in_medical_facility", "in_facility"),
            ):
                value = canonical_values.get(
                    f"{prefix}.{canonical_suffix}"
                )

                if not isinstance(
                    value,
                    bool,
                ):
                    continue

                yes_field, no_field = block[pair_key]
                set_field(
                    yes_field if value else no_field,
                    "/Yes",
                )

            set_field(
                block["daily_living_explanation"],
                canonical_values.get(
                    f"{prefix}.needs_help_daily_living_explanation"
                ),
            )

            set_field(
                block["works_with_medical_explanation"],
                canonical_values.get(
                    f"{prefix}.works_with_medical_expenses_explanation"
                ),
            )

            # Only the second printed block has a facility-name field.
            if block["facility_name"] is not None:
                set_field(
                    block["facility_name"],
                    canonical_values.get(
                        f"{prefix}.medical_facility_name"
                    ),
                )

            duration = str(
                canonical_values.get(
                    f"{prefix}.expected_duration"
                )
                or ""
            ).strip()

            if duration == "thirty_days_or_more":
                set_field(
                    block["duration_thirty_days"],
                    "/Yes",
                )
            elif duration == "twelve_months_or_more":
                set_field(
                    block["duration_twelve_months"],
                    "/Yes",
                )

        # Q4 interview preference: standalone boxes, ticked only on an
        # explicit Yes.
        for key, pdf_field in self.PAGE_2_INTERVIEW_PREFERENCE.items():
            if canonical_values.get(key) is True:
                set_field(
                    pdf_field,
                    "/Yes",
                )

        # Q14's free-text lines.
        for key, pdf_field in self.PAGE_11_SPECIAL_NEED_TEXT.items():
            set_field(
                pdf_field,
                canonical_values.get(key),
            )

        # Q23b-Q23e text lines. The canonical layer already suppresses these
        # when Q23 is not Yes, so nothing stale can arrive here.
        for key, pdf_field in self.PAGE_13_TAX_TEXT.items():
            set_field(
                pdf_field,
                canonical_values.get(key),
            )

        # Q21a's "who" line, printed only when the answer is Yes.
        set_field(
            self.PAGE_13_ELDERLY_SEPARATE_MEALS_WHO,
            canonical_values.get(
                "household.elderly_unable_to_prepare_meals_who"
            ),
        )

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
        # Q6a — per-person contact blocks
        # -------------------------------------------------------------------
        same_contact = canonical_values.get(
            "household.same_contact_information"
        )

        if isinstance(
            same_contact,
            bool,
        ):
            yes_field, no_field = self.PAGE_3_SAME_CONTACT_GATEWAY
            set_field(
                yes_field if same_contact else no_field,
                "/Yes",
            )

        # Members whose details differ, in the order the canonical layer
        # assigned them. A member with no contact block emits no keys at all,
        # so the printed block stays blank rather than repeating the
        # applicant's own details.
        contact_block_index = 0

        for index in range(
            member_count
        ):
            if contact_block_index >= len(
                self.PAGE_3_CONTACT_BLOCKS
            ):
                break

            prefix = (
                f"household.members.{index}.contact"
            )

            if not any(
                key.startswith(f"{prefix}.")
                for key in canonical_values
            ):
                continue

            block = self.PAGE_3_CONTACT_BLOCKS[
                contact_block_index
            ]
            contact_block_index += 1

            member_prefix = (
                f"household.members.{index}"
            )

            columns = (
                _full_name(
                    canonical_values,
                    member_prefix,
                ),
                canonical_values.get(f"{prefix}.home_address.street"),
                canonical_values.get(f"{prefix}.home_address.apartment"),
                canonical_values.get(f"{prefix}.home_address.city"),
                canonical_values.get(f"{prefix}.home_address.state"),
                canonical_values.get(f"{prefix}.home_address.zip_code"),
                canonical_values.get(f"{prefix}.home_phone"),
                canonical_values.get(f"{prefix}.mailing_address.street"),
                canonical_values.get(f"{prefix}.mailing_address.apartment"),
                canonical_values.get(f"{prefix}.mailing_address.city"),
                canonical_values.get(f"{prefix}.mailing_address.state"),
                canonical_values.get(f"{prefix}.mailing_address.zip_code"),
                canonical_values.get(f"{prefix}.alternate_phone"),
                canonical_values.get(f"{prefix}.email"),
            )

            for pdf_field, value in zip(
                block,
                columns,
            ):
                set_field(
                    pdf_field,
                    value,
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


# ---------------------------------------------------------------------------
# Making written values fit the boxes the form drew for them
# ---------------------------------------------------------------------------

#: Widths of the Helvetica glyphs, in 1/1000 em, for printable ASCII.
#:
#: From the Adobe Core 14 AFM metrics. Needed because the form declares a fixed
#: point size per field and several of its boxes are too narrow for the value
#: that belongs in them — the Q6 "DATE OF BIRTH" column is 47.9pt wide with
#: "/Helv 10 Tf" set, and "01/01/1990" needs 50.0pt at that size, so the year
#: was being cut in half on a form the applicant signs.
_HELVETICA_WIDTHS: tuple[int, ...] = (
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333,  # 32-45
    278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278,  # 46-59
    584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,  # 60-73
    500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,  # 74-87
    667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556,  # 88-101
    278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,  # 102-115
    278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,                 # 116-126
)

#: Points of horizontal inset an AcroForm text field keeps inside its border.
_FIELD_PADDING = 2.0

#: Points of vertical inset, top and bottom.
_FIELD_PADDING_Y = 1.5

#: Line spacing as a multiple of the font size, for wrapped multiline fields.
_LINE_HEIGHT = 1.15

#: The smallest size still legible in print, and the floor for shrinking.
#:
#: A county worker reads this on paper, often photocopied. Below about six
#: points that stops being reliable, so the fitter refuses to go further and
#: reports the value as not fitting instead of rendering something unreadable
#: and calling it filled.
_MIN_FONT_SIZE = 6.0


def _helvetica_width(text: str, size: float) -> float:
    """Rendered width of `text` in Helvetica at `size` points."""
    total = 0

    for character in text:
        code = ord(character)
        # Anything outside printable ASCII falls back to the digit width, which
        # is Helvetica's most common advance.
        total += (
            _HELVETICA_WIDTHS[code - 32]
            if 32 <= code <= 126
            else 556
        )

    return total / 1000 * size


def _wrap_to_width(text: str, size: float, usable: float) -> list[str]:
    """Break `text` into lines that each fit `usable` points at `size`.

    Wraps on spaces like a PDF viewer does, and falls back to breaking inside a
    word only when a single word is itself wider than the box — a 40-character
    street name in a narrow column has to break somewhere, and breaking it is
    better than letting it run past the border.
    """
    lines: list[str] = []

    for paragraph in text.split("\n"):
        current = ""

        for word in paragraph.split():
            candidate = f"{current} {word}".strip()

            if _helvetica_width(candidate, size) <= usable:
                current = candidate
                continue

            if current:
                lines.append(current)
                current = ""

            # A word too wide for the box on its own.
            while _helvetica_width(word, size) > usable and len(word) > 1:
                cut = len(word)

                while cut > 1 and _helvetica_width(word[:cut], size) > usable:
                    cut -= 1

                lines.append(word[:cut])
                word = word[cut:]

            current = word

        lines.append(current)

    return lines


def _fits(text: str, size: float, width: float, height: float, multiline: bool) -> bool:
    """Whether `text` renders inside a box of this size at this font size."""
    usable_width = width - _FIELD_PADDING * 2
    usable_height = height - _FIELD_PADDING_Y * 2

    if usable_width <= 0 or usable_height <= 0:
        return False

    if not multiline:
        return (
            _helvetica_width(text, size) <= usable_width
            and size <= usable_height
        )

    lines = _wrap_to_width(text, size, usable_width)

    return len(lines) * size * _LINE_HEIGHT <= usable_height


def _largest_size_that_fits(
    text: str,
    declared: float,
    width: float,
    height: float,
    multiline: bool,
) -> float | None:
    """The biggest size up to `declared` at which the whole value fits.

    Returns None when even `_MIN_FONT_SIZE` overflows, which is the caller's
    signal to report the value rather than render it illegibly. Searched in
    hundredth-point steps downward from the declared size so the result is the
    largest that fits rather than merely one that does.
    """
    if _fits(text, declared, width, height, multiline):
        return declared

    size = declared

    while size > _MIN_FONT_SIZE:
        size = max(_MIN_FONT_SIZE, math.floor((size - 0.05) * 100) / 100)

        if _fits(text, size, width, height, multiline):
            return size

    return None


def _shrink_overflowing_text(writer: Any, written: set[str]) -> list[str]:
    """Reduce the declared font size of any value too wide for its box.

    The form specifies an explicit point size per field, and some of its boxes
    are narrower than the value that belongs in them. Leaving that alone clips
    the text — a birth year cut off, an employer name ending mid-word — on a
    document signed under penalty of perjury.

    Auto-sizing (``/Helv 0 Tf``) is not the fix: viewers that honour it grow
    short values to fill the box height, so a one-letter "F" in the GENDER
    column renders three times the size of its neighbours.

    So the size is reduced explicitly, only for the fields this run wrote, only
    when the value genuinely does not fit, and never below `_MIN_FONT_SIZE`.
    Multi-line fields are left alone: their text wraps rather than clipping.
    """
    from pypdf.generic import NameObject, TextStringObject

    unfitted: list[str] = []

    for page in writer.pages:
        for annotation in page.get("/Annots") or []:
            field = annotation.get_object()
            parent = field.get("/Parent")
            parent_object = parent.get_object() if parent else None

            name = field.get("/T")
            if name is None and parent_object is not None:
                name = parent_object.get("/T")

            if str(name) not in written:
                continue

            value = field.get("/V")
            if value is None and parent_object is not None:
                value = parent_object.get("/V")

            text = str(value or "")
            if not text:
                continue

            flags = int(
                field.get("/Ff")
                or (parent_object.get("/Ff") if parent_object else 0)
                or 0
            )

            # Bit 13 is Multiline: those wrap, so height is what constrains
            # them rather than width alone.
            multiline = bool(flags & 4096)

            appearance = field.get("/DA") or (
                parent_object.get("/DA") if parent_object else None
            )

            if appearance is None:
                continue

            parts = str(appearance).split()

            try:
                size_index = parts.index("Tf") - 1
                size = float(parts[size_index])
            except (ValueError, IndexError):
                continue

            # 0 means "auto size", which is the viewer's decision, not ours.
            if size <= 0:
                continue

            rectangle = [float(value) for value in field["/Rect"]]
            width = abs(rectangle[2] - rectangle[0])
            height = abs(rectangle[3] - rectangle[1])

            fitted = _largest_size_that_fits(
                text, size, width, height, multiline
            )

            if fitted is None:
                # Legible rendering is impossible in this box. The value is
                # left at its declared size and reported, so the applicant is
                # told to attach it rather than being handed a form with
                # something unreadable — or invisible — in the box.
                unfitted.append(str(name))
                continue

            if fitted >= size:
                continue

            parts[size_index] = f"{fitted:.2f}"
            target = parent_object if field.get("/DA") is None else field
            target[NameObject("/DA")] = TextStringObject(" ".join(parts))

    return unfitted


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

    template = template_for(
        values["locale"]
    )

    # The filename states the language of the paper, not the language of the
    # interface, so a downloaded file is never mistaken for a translation it
    # is not.
    suffix = (
        ""
        if template.document_language == "en"
        else f"-{template.document_language}"
    )

    template_path = (
        output_dir
        / f"official-ca-saws-2-plus{suffix}-template.pdf"
    )

    output_path = (
        output_dir
        / (
            f"official-ca-saws-2-plus{suffix}-"
            f"{zip_code}-{timestamp}.pdf"
        )
    )

    inventory_path = (
        output_dir
        / f"official-ca-saws-2-plus{suffix}-field-inventory.json"
    )

    _download_template(
        template_path,
        template,
    )

    # An official form in the applicant's language that cannot be filled is
    # still worth having: it lets them read what they are signing. Place it
    # beside the fillable one rather than discarding it.
    if template.reference_path is not None and template.reference_path.exists():
        (
            output_dir
            / (
                "official-ca-saws-2-plus-"
                f"{template.reference_language}-reference.pdf"
            )
        ).write_bytes(template.reference_path.read_bytes())

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

    unfitted_fields = _shrink_overflowing_text(
        writer, set(requested_fields)
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
        "every answer, sign, and date the application.\n"
        + (
            # Nothing is silently dropped: an answer too long for its printed
            # box is named here so it can be attached on a separate sheet.
            "\nThese answers are too long for their printed boxes to hold "
            "legibly. Write \"see attached\" in each and attach the full "
            "answer:\n"
            + "".join(f"  - {name}\n" for name in unfitted_fields)
            if unfitted_fields
            else ""
        ),
        encoding="utf-8",
    )

    return output_path