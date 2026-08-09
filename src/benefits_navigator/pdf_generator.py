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

    ADULT_ROWS = (
        (
            "Text5 PG 3",
            "Text6 PG 3",
            "Text7 PG 3",
        ),
        (
            "Text22 PG 3",
            "Text23 PG 3",
            "Text24 PG 3",
        ),
        (
            "Text40 PG 3",
            "Text41 PG 3",
            "Text42 PG 3",
        ),
        (
            "Text58 PG 3",
            "Text59 PG 3",
            "Text60 PG 3",
        ),
        (
            "Text76 PG 3",
            "Text77 PG 3",
            "Text78 PG 3",
        ),
    )

    CHILD_ROWS = (
        (
            "Text5 PG 4",
            "Text6 PG 4",
            "Text7 PG 4",
        ),
        (
            "Text24 PG 4",
            "Text25 PG 4",
            "Text26 PG 4",
        ),
        (
            "Text43 PG 4",
            "Text44 PG 4",
            "Text45 PG 4",
        ),
        (
            "Text62 PG 4",
            "Text63 PG 4",
            "Text64 PG 4",
        ),
        (
            "Text81 PG 4",
            "Text82 PG 4",
            "Text83 PG 4",
        ),
    )

    SAFE_FIELDS = frozenset(
        {
            # Applicant name
            "Text1 PG 1",

            # Preferred read/spoken language
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

            *(
                field
                for row in ADULT_ROWS
                for field in row
            ),

            *(
                field
                for row in CHILD_ROWS
                for field in row
            ),
        }
    )

    def map_values(
        self,
        canonical_values: dict[str, Any],
        available_fields: set[str],
    ) -> dict[str, str]:
        values: dict[str, str] = {}

        def set_field(
            field_name: str,
            value: Any,
        ) -> None:
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

        # Page 1 applicant name
        set_field(
            "Text1 PG 1",
            _full_name(
                canonical_values,
                "applicant",
            ),
        )

        # Home / mailing address and contact information
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

        # English is already the default language on the form.
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

        # Requested programs
        for key, pdf_field in self.PROGRAM_FIELDS.items():
            if canonical_values.get(key) is True:
                set_field(
                    pdf_field,
                    "/Yes",
                )

                        # Explicit yes/no questions.
        #
        # Only populate these if the application actually contains a boolean.
        # Missing/unasked questions remain blank rather than being treated as No.
        for key, (yes_field, no_field) in self.YES_NO_FIELDS.items():
            value = canonical_values.get(key)

            if not isinstance(value, bool):
                continue

            set_field(
                yes_field if value else no_field,
                "/Yes",
            )

        # Standalone checkboxes have no paired "No" field.
        # Only check them when explicitly true.
        for key, pdf_field in self.SINGLE_CHECKBOX_FIELDS.items():
            if canonical_values.get(key) is True:
                set_field(
                    pdf_field,
                    "/Yes",
                )

        adults: list[
            tuple[str, str, str]
        ] = []

        children: list[
            tuple[str, str, str]
        ] = []

        # Applicant also belongs in the household-person table.
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
            applicant_row = (
                applicant_name,
                "self",
                _format_date(
                    applicant_dob
                ),
            )

            applicant_age = _age_on_date(
                applicant_dob
            )

            (
                children
                if (
                    applicant_age is not None
                    and applicant_age < 18
                )
                else adults
            ).append(applicant_row)

        index = 0

        while (
            f"household.members.{index}.first_name"
            in canonical_values
        ):
            prefix = (
                f"household.members.{index}"
            )

            member = (
                _full_name(
                    canonical_values,
                    prefix,
                    last_first=True,
                ),
                str(
                    canonical_values.get(
                        f"{prefix}.relationship_to_applicant"
                    )
                    or ""
                ),
                str(
                    canonical_values.get(
                        f"{prefix}.date_of_birth"
                    )
                    or ""
                ),
            )

            age = _age_on_date(
                member[2]
            )

            member = (
                member[0],
                member[1],
                _format_date(
                    member[2]
                ),
            )

            (
                children
                if age is not None and age < 18
                else adults
            ).append(member)

            index += 1

        for row, member in zip(
            self.ADULT_ROWS,
            adults,
        ):
            for field_name, value in zip(
                row,
                member,
            ):
                set_field(
                    field_name,
                    value,
                )

        for row, member in zip(
            self.CHILD_ROWS,
            children,
        ):
            for field_name, value in zip(
                row,
                member,
            ):
                set_field(
                    field_name,
                    value,
                )

        self.assert_safe(values)

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