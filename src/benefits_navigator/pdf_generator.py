"""Generate official state benefit application PDFs."""

from __future__ import annotations

import json

import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

_CA_MEDI_CAL_APPLICATION_URLS = (
    "https://www.coveredca.com/pdfs/paper-application/CA-SingleStreamApp_92MAX.pdf",
    "https://www.dhcs.ca.gov/services/medi-cal/eligibility/Documents/"
    "2014_CoveredCA_Applications/ENG-CASingleStreamApp.pdf",
)

_CALIFORNIA_APPLICATION_DESTINATIONS = {
    "medi-cal": "https://benefitscal.com/",
    "medicaid": "https://benefitscal.com/",
    "calfresh": "https://benefitscal.com/",
    "snap": "https://benefitscal.com/",
    "calworks": "https://benefitscal.com/",
    "covered-california": "https://apply.coveredca.com/covered-california",
}

_SENSITIVE_FIELD_MARKERS = (
    "ssn",
    "social security",
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


_APPLICATION_QUESTIONS = (
    ("full_name", "What is your full legal name?"),
    ("email", "What is your email address?"),
    ("phone", "What is your phone number?"),
    ("address", "What is your street address?"),
    ("city", "What city do you live in?"),
    ("state", "What state do you live in?"),
    ("zip_code", "What is your ZIP code?"),
    ("dob", "What is your date of birth?"),
    ("children", "List each child applying for benefits, one per line, as: full name | date of birth. Enter none if no children are applying."),
    ("plans_to_file_taxes", "Do you plan to file taxes for the year you want health insurance? Answer yes or no."),
    ("tax_filing_status", "What will your tax filing status be? Answer single, head of household, married filing jointly, married filing separately, or none."),
    ("joint_filer_name", "If you are married filing jointly, what is your spouse's full legal name? Enter none if this does not apply."),
    ("required_to_file_taxes", "Do you expect to be required to file taxes for the year you want health insurance? Answer yes or no."),
    ("claimed_as_dependent", "Will anyone claim you as a dependent on their taxes? Answer yes or no."),
    ("dependent_claimer_name", "If someone will claim you as a dependent, what is that person's full legal name? Enter none if this does not apply."),
    ("primary_tax_filer_name", "Who is the primary tax filer whose name will appear first on the tax return? Enter none if nobody files taxes."),
    ("has_income", "Does anyone on this application have income? Answer yes or no."),
    ("income_1_person", "Who receives the first source of income? Enter their full legal name, or none if there is no income."),
    ("income_1_name", "What is the name of the first income source, such as the employer or business name? Enter none if there is no income."),
    ("income_1_source", "What type of income is the first source? Answer employment, self-employment, Social Security or interest, other, or none."),
    ("income_1_amount", "What is the amount received from the first income source before taxes? Enter a number only, or none."),
    ("income_1_frequency", "How often is the first income received? Answer hourly, daily, weekly, every two weeks, twice a month, monthly, yearly, or none."),
    ("income_1_hours_per_week", "If the first income is hourly, how many hours are worked per week? Enter none if this does not apply."),
    ("income_1_days_per_week", "If the first income is daily, how many days are worked per week? Enter none if this does not apply."),
    ("income_2_person", "Who receives the second source of income? Enter their full legal name, or none if there is no second income."),
    ("income_2_name", "What is the name of the second income source? Enter none if there is no second income."),
    ("income_2_source", "What type of income is the second source? Answer employment, self-employment, Social Security or interest, other, or none."),
    ("income_2_amount", "What is the amount received from the second income source before taxes? Enter a number only, or none."),
    ("income_2_frequency", "How often is the second income received? Answer hourly, daily, weekly, every two weeks, twice a month, monthly, yearly, or none."),
    ("income_2_hours_per_week", "If the second income is hourly, how many hours are worked per week? Enter none if this does not apply."),
    ("income_2_days_per_week", "If the second income is daily, how many days are worked per week? Enter none if this does not apply."),
)


class MissingApplicationInformation(ValueError):
    """Raised when the application profile is not complete enough to fill the form."""

    def __init__(self, key: str, question: str) -> None:
        self.key = key
        self.question = question
        super().__init__(question)


def load_application_profile(path: Path) -> dict[str, Any]:
    """Load saved application answers from JSON, returning an empty profile if absent."""
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as profile_file:
        data = json.load(profile_file)
    if not isinstance(data, dict):
        raise ValueError("Application profile JSON must contain an object at the top level.")
    return data


def save_application_profile(path: Path, profile: dict[str, Any]) -> None:
    """Persist collected application answers as readable JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as profile_file:
        json.dump(profile, profile_file, indent=2, ensure_ascii=False)
        profile_file.write("\n")


def next_application_question(profile: dict[str, Any]) -> tuple[str, str] | None:
    """Return exactly one unanswered application question in form order."""
    for key, question in _APPLICATION_QUESTIONS:
        if key not in profile:
            return key, question
        value = profile[key]
        if value is None or value == "":
            return key, question
    return None


def record_application_answer(
    path: Path,
    key: str,
    answer: str,
) -> dict[str, Any]:
    """Add one answer to the saved application profile and return the updated profile."""
    valid_keys = {question_key for question_key, _ in _APPLICATION_QUESTIONS}
    if key not in valid_keys:
        raise KeyError(f"Unknown application question key: {key}")

    profile = load_application_profile(path)
    cleaned_answer = answer.strip()
    if key == "children":
        if cleaned_answer.lower() in {"none", "no", "n/a"}:
            profile[key] = []
        else:
            children: list[dict[str, str]] = []
            for line in cleaned_answer.splitlines():
                if not line.strip():
                    continue
                name, separator, dob = line.partition("|")
                if not separator or not name.strip() or not dob.strip():
                    raise ValueError(
                        "Each child must be entered as: full name | date of birth."
                    )
                children.append(
                    {"full_name": name.strip(), "dob": dob.strip()}
                )
            profile[key] = children
    else:
        profile[key] = cleaned_answer

    save_application_profile(path, profile)
    return profile


def require_complete_application_profile(profile: dict[str, Any]) -> None:
    """Raise with the next single question when required application data is missing."""
    missing = next_application_question(profile)
    if missing is not None:
        key, question = missing
        raise MissingApplicationInformation(key, question)


def _parse_programs_from_output(workflow_output: str) -> list[str]:
    known = ["Medicaid", "Medi-Cal", "SNAP", "CalFresh", "WIC"]
    output_upper = workflow_output.upper()
    return [program for program in known if program.upper() in output_upper]


def get_california_application_destination(program: str) -> str:
    """Return the official online application destination for a California program."""
    normalized = program.strip().lower()
    try:
        return _CALIFORNIA_APPLICATION_DESTINATIONS[normalized]
    except KeyError as exc:
        raise NotImplementedError(
            f"No official California online application destination is configured for {program!r}."
        ) from exc


def _split_name(full_name: str) -> tuple[str, str, str]:
    parts = [part for part in full_name.strip().split() if part]
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], "", ""
    if len(parts) == 2:
        return parts[0], "", parts[1]
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def _is_yes(value: Any) -> bool:
    return str(value or "").strip().lower() in {"yes", "y", "true", "1"}


def _none_to_blank(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text.lower() in {"none", "n/a", "not applicable"} else text


def _is_sensitive_pdf_field(field_name: str) -> bool:
    normalized = field_name.strip().lower()
    return any(marker in normalized for marker in _SENSITIVE_FIELD_MARKERS)


def inspect_pdf_form(pdf_path: Path) -> list[dict[str, Any]]:
    """Inspect the real official PDF and return its fillable field inventory."""
    reader = PdfReader(str(pdf_path))
    inventory: list[dict[str, Any]] = []
    for name, field in (reader.get_fields() or {}).items():
        inventory.append(
            {
                "name": name,
                "field_type": str(field.get("/FT") or ""),
                "options": field.get("/Opt"),
                "sensitive": _is_sensitive_pdf_field(name),
            }
        )
    return inventory


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


def _field_values_from_plan(
    profile: dict[str, Any],
    field_plan: list[dict[str, Any]],
    available_fields: set[str],
) -> dict[str, str]:
    """Convert an AI-produced semantic field plan into real PDF field values."""
    values: dict[str, str] = {}

    for item in field_plan:
        if not isinstance(item, dict):
            continue

        profile_key = str(item.get("profile_key") or "").strip()
        kind = str(item.get("kind") or "text").strip().lower()
        pdf_fields = item.get("pdf_fields") or []
        if isinstance(pdf_fields, str):
            pdf_fields = [pdf_fields]
        if not profile_key or not isinstance(pdf_fields, list):
            continue

        safe_fields = [
            str(field_name)
            for field_name in pdf_fields
            if str(field_name) in available_fields
            and not _is_sensitive_pdf_field(str(field_name))
        ]
        if not safe_fields:
            continue

        profile_value = _get_profile_value(profile, profile_key)
        if profile_value is None or profile_value == "":
            continue

        if kind == "full_name":
            first, middle, last = _split_name(str(profile_value))
            name_parts = [first, middle, last]
            for field_name, part in zip(safe_fields, name_parts):
                if part:
                    values[field_name] = part
            continue

        if kind == "yes_no":
            yes_field = str(item.get("yes_field") or "")
            no_field = str(item.get("no_field") or "")
            normalized = str(profile_value).strip().lower()
            if normalized in {"yes", "y", "true", "1"}:
                if yes_field in available_fields and not _is_sensitive_pdf_field(yes_field):
                    values[yes_field] = "/Yes"
            elif normalized in {"no", "n", "false", "0"}:
                if no_field in available_fields and not _is_sensitive_pdf_field(no_field):
                    values[no_field] = "/Yes"
            continue

        if kind == "choice":
            choices = item.get("choices") or {}
            if isinstance(choices, dict):
                selected = choices.get(str(profile_value).strip().lower())
                if (
                    selected
                    and str(selected) in available_fields
                    and not _is_sensitive_pdf_field(str(selected))
                ):
                    values[str(selected)] = "/Yes"
            continue

        if kind == "multi_choice":
            choices = item.get("choices") or {}
            selected_values = profile_value if isinstance(profile_value, list) else [profile_value]
            if isinstance(choices, dict):
                for selected_value in selected_values:
                    selected = choices.get(str(selected_value).strip().lower())
                    if (
                        selected
                        and str(selected) in available_fields
                        and not _is_sensitive_pdf_field(str(selected))
                    ):
                        values[str(selected)] = "/Yes"
            continue

        text = _none_to_blank(profile_value)
        if text:
            for field_name in safe_fields:
                values[field_name] = text

    return values


def _extract_values(args: dict[str, Any]) -> dict[str, str]:
    application_data = args.get("application_data")
    if application_data is None:
        application_data = {}
    if not isinstance(application_data, dict):
        raise ValueError("application_data must be a dictionary when provided.")

    merged_args = {**args, **application_data}
    profile = str(merged_args.get("household_profile") or "")
    zip_code = str(merged_args.get("zip_code") or "").strip()
    if not zip_code:
        match = re.search(r"\b(\d{5})\b", profile)
        if match:
            zip_code = match.group(1)

    annual_income = str(merged_args.get("annual_income") or merged_args.get("income") or "").strip()
    if not annual_income:
        match = re.search(r"\$\s*([\d,]+)", profile)
        if match:
            annual_income = match.group(1)
    annual_income = annual_income.replace("$", "").replace(",", "")
    if annual_income:
        try:
            annual_income = f"{int(float(annual_income)):,.0f}"
        except ValueError:
            pass

    return {
        "full_name": str(merged_args.get("name") or merged_args.get("full_name") or "").strip(),
        "email": str(merged_args.get("email") or "").strip(),
        "phone": str(merged_args.get("phone") or "").strip(),
        "address": str(merged_args.get("address") or "").strip(),
        "city": str(merged_args.get("city") or "").strip(),
        "state": str(merged_args.get("state") or "CA").strip().upper(),
        "zip_code": zip_code,
        "dob": str(merged_args.get("dob") or "").strip(),
        "annual_income": annual_income,
        "plans_to_file_taxes": str(merged_args.get("plans_to_file_taxes") or "").strip(),
        "tax_filing_status": str(merged_args.get("tax_filing_status") or "").strip(),
        "joint_filer_name": _none_to_blank(merged_args.get("joint_filer_name")),
        "required_to_file_taxes": str(merged_args.get("required_to_file_taxes") or "").strip(),
        "claimed_as_dependent": str(merged_args.get("claimed_as_dependent") or "").strip(),
        "dependent_claimer_name": _none_to_blank(merged_args.get("dependent_claimer_name")),
        "primary_tax_filer_name": _none_to_blank(merged_args.get("primary_tax_filer_name")),
        "has_income": str(merged_args.get("has_income") or "").strip(),
        "income_1_person": _none_to_blank(merged_args.get("income_1_person")),
        "income_1_name": _none_to_blank(merged_args.get("income_1_name")),
        "income_1_source": _none_to_blank(merged_args.get("income_1_source")),
        "income_1_amount": _none_to_blank(merged_args.get("income_1_amount")),
        "income_1_frequency": _none_to_blank(merged_args.get("income_1_frequency")),
        "income_1_hours_per_week": _none_to_blank(merged_args.get("income_1_hours_per_week")),
        "income_1_days_per_week": _none_to_blank(merged_args.get("income_1_days_per_week")),
        "income_2_person": _none_to_blank(merged_args.get("income_2_person")),
        "income_2_name": _none_to_blank(merged_args.get("income_2_name")),
        "income_2_source": _none_to_blank(merged_args.get("income_2_source")),
        "income_2_amount": _none_to_blank(merged_args.get("income_2_amount")),
        "income_2_frequency": _none_to_blank(merged_args.get("income_2_frequency")),
        "income_2_hours_per_week": _none_to_blank(merged_args.get("income_2_hours_per_week")),
        "income_2_days_per_week": _none_to_blank(merged_args.get("income_2_days_per_week")),
    }


def _download_template(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    for url in _CA_MEDI_CAL_APPLICATION_URLS:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 Kealu-Benefits-Navigator/1.0",
                "Accept": "application/pdf,*/*;q=0.8",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content_type = response.headers.get_content_type()
                data = response.read()
        except Exception as exc:
            errors.append(f"{url}: {exc}")
            continue

        if data.startswith(b"%PDF-"):
            destination.write_bytes(data)
            return

        errors.append(
            f"{url}: returned {content_type!r} with header {data[:16]!r}"
        )

    raise RuntimeError(
        "None of the official California application sources returned a valid PDF. "
        + " | ".join(errors)
    )




def application_args_from_profile(
    args: dict[str, Any],
    profile_path: Path,
) -> dict[str, Any]:
    """Merge saved JSON answers into workflow arguments after checking completeness."""
    profile = load_application_profile(profile_path)
    require_complete_application_profile(profile)
    return {**args, "application_data": profile}


def _field_values(
    args: dict[str, Any],
    available_fields: set[str],
) -> dict[str, str]:
    """Build values for the real PDF from the saved profile and AI field plan."""
    profile = args.get("application_data") or {}
    if not isinstance(profile, dict):
        raise ValueError("application_data must be a dictionary.")

    field_plan = args.get("application_field_plan")
    if not isinstance(field_plan, list) or not field_plan:
        raise ValueError(
            "application_field_plan is required. The workflow AI must inspect the official PDF field inventory and map saved profile keys to real PDF fields before generation."
        )

    return _field_values_from_plan(profile, field_plan, available_fields)


def generate_application_pdf(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path:
    """Download and prefill California's official Medi-Cal application."""
    profile_path_value = args.get("application_profile_path")
    if profile_path_value:
        args = application_args_from_profile(args, Path(str(profile_path_value)))
    elif isinstance(args.get("application_data"), dict):
        require_complete_application_profile(args["application_data"])

    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefits-applications"

    values = _extract_values(args)
    state = values["state"]
    if state != "CA":
        raise NotImplementedError(
            f"Official application generation is not implemented for {state or 'the selected state'}."
        )

    programs = _parse_programs_from_output(workflow_output)
    if not any(program.upper() in {"MEDICAID", "MEDI-CAL"} for program in programs):
        raise NotImplementedError(
            "CalFresh and WIC require separate official California application workflows."
        )

    now = datetime.now(tz=timezone.utc)
    timestamp = now.strftime("%Y%m%d-%H%M%S")
    zip_code = values["zip_code"] or "unknown"

    output_dir.mkdir(parents=True, exist_ok=True)
    template_path = output_dir / "official-ca-medi-cal-template.pdf"
    output_path = output_dir / f"official-ca-medi-cal-{zip_code}-{timestamp}.pdf"
    _download_template(template_path)

    field_inventory = inspect_pdf_form(template_path)
    inventory_path = output_dir / "official-ca-medi-cal-field-inventory.json"
    inventory_path.write_text(
        json.dumps(field_inventory, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    reader = PdfReader(str(template_path))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    available_fields = set((reader.get_fields() or {}).keys())
    requested_fields = _field_values(args, available_fields)
    matched_fields = {
        key: value for key, value in requested_fields.items() if key in available_fields
    }
    if not matched_fields:
        raise RuntimeError(
            "The official PDF downloaded successfully, but none of the configured field names matched its AcroForm fields."
        )
    for page in writer.pages:
        writer.update_page_form_field_values(
            page,
            matched_fields,
            auto_regenerate=True,
        )

    with output_path.open("wb") as output_file:
        writer.write(output_file)

    review_path = output_path.with_suffix(".review.txt")
    review_path.write_text(
        "Review every page of this prefilled official application before submitting it.\n"
        "For privacy and legal reasons, Social Security numbers, immigration document numbers, signatures, and signature dates were intentionally left blank.\n"
        "Enter those items directly into the PDF, sign and date the application, and verify that every checked box and entered value is correct.\n",
        encoding="utf-8",
    )

    return output_path
