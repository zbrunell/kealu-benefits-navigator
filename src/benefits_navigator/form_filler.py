"""Fill official government benefit application PDFs when available.

Uses pypdf to fill AcroForm fields on real state application forms.
Falls back to the worksheet-style PDF when no official form is available
or when pypdf is not installed.

Template PDFs live in the ``forms/`` directory alongside this module.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_FORMS_DIR = Path(__file__).parent / "forms"

# ---------------------------------------------------------------------------
# Form registry — maps (state_code, program) to template + field mapping
# ---------------------------------------------------------------------------

# Field mapping: our canonical key → PDF AcroForm field name
_CA_SAWS1_FIELDS: dict[str, str] = {
    "name": "applicant_name",
    "other_name": "applicant_name_other",
    "home_address": "applicant_home_address",
    "home_unit": "applicant_home_unit",
    "home_city": "applicant_home_city",
    "home_state": "applicant_home_state",
    "home_zip": "applicant_home_zip",
    "home_county": "applicant_home_county",
    "mailing_address": "applicant_mailing_address",
    "mailing_unit": "applicant_mailing_unit",
    "mailing_city": "applicant_mailing_city",
    "mailing_state": "applicant_mailing_state",
    "mailing_zip": "applicant_mailing_zip",
    "mailing_county": "applicant_mailing_county",
    "phone_home": "applicant_phone_home",
    "phone_alternate": "applicant_phone_alternate",
    "email": "applicant_email",
    "date": "applicant_date",
    "language_speak": "applicant_language_speak",
    "language_read": "applicant_language_read",
}

# Checkbox fields: our key → PDF field name
_CA_SAWS1_CHECKBOXES: dict[str, str] = {
    "apply_calfresh": "applicant_programs_1",
    "apply_medical": "applicant_programs_2",
    "apply_calworks": "applicant_programs_3",
}

# Illinois IL444-2378B — combined Cash/Medical/SNAP application
# XFA-style field names with Form[0].#subform[N] prefix
_IL_2378B_FIELDS: dict[str, str] = {
    "home_address": "Form[0].#subform[0].Address[0]",
    "mailing_address": "Form[0].#subform[0].Address[1]",
    "home_city": "Form[0].#subform[0].City[1]",
    "home_zip": "Form[0].#subform[0].City[0]",
    "home_county": "Form[0].#subform[0].TextField1[4]",
    "mailing_city": "Form[0].#subform[0].City[4]",
    "mailing_zip": "Form[0].#subform[0].City[3]",
    "mailing_county": "Form[0].#subform[0].TextField1[5]",
    "home_state": "Form[0].#subform[0].State[0]",
    "mailing_state": "Form[0].#subform[0].State[1]",
    "date": "Form[0].#subform[0].DateTimeField1[0]",
    "first_name": "Form[0].#subform[0].TextField1[2]",
    "last_name": "Form[0].#subform[0].TextField1[3]",
    "phone_home": "Form[0].#subform[0].TextField2[2]",
    "phone_work": "Form[0].#subform[0].TextField2[1]",
}

# New York LDSS-4826-DD — SNAP Application/Recertification (fillable/accessible)
_NY_4826_FIELDS: dict[str, str] = {
    "first_name": "3 First Name",
    "last_name": "3 Last Name",
    "home_address": "4 Address where you live (do not give P. box). box)",
    "home_city": "4 City/Town/Village",
    "home_county": "4 County",
    "home_zip": "4 Zip Code",
    "mailing_address": "5 Address where you get your mail (if different than above)",
    "mailing_zip": "5 Zip Code",
    "phone_home": "8 Telephone (optional)",
    "email": "8 Email (optional)",
    "language_speak": "What is the Individuals primary language spoken?1",
}

# Pennsylvania PA-600 — combined Cash/Healthcare/SNAP application
_PA_600_FIELDS: dict[str, str] = {
    "name": "Applicant Name",
    "home_address": "Applicant Home Address",
    "mailing_address": "Mailing address",
    "home_county": "County",
    "how_long_at_address": "How long have you lived at this address?",
}

_FORM_REGISTRY: dict[str, dict[str, Any]] = {
    "CA": {
        "template": "CA-SAWS-1.pdf",
        "name": "SAWS-1 (CalFresh / Medi-Cal / CalWORKs)",
        "text_fields": _CA_SAWS1_FIELDS,
        "checkboxes": _CA_SAWS1_CHECKBOXES,
        "programs": ["CalFresh (SNAP)", "Medi-Cal (Medicaid)", "CalWORKs (TANF)"],
    },
    "IL": {
        "template": "IL-444-2378B.pdf",
        "name": "IL444-2378B (Cash / Medical / SNAP combined)",
        "text_fields": _IL_2378B_FIELDS,
        "checkboxes": {},
        "programs": ["SNAP", "Medicaid", "TANF (Cash Assistance)"],
    },
    "NY": {
        "template": "NY-LDSS-4826-DD.pdf",
        "name": "LDSS-4826-DD (SNAP Application/Recertification)",
        "text_fields": _NY_4826_FIELDS,
        "checkboxes": {},
        "programs": ["SNAP"],
    },
    "PA": {
        "template": "PA-600.pdf",
        "name": "PA-600 (Cash / Healthcare / SNAP combined)",
        "text_fields": _PA_600_FIELDS,
        "checkboxes": {},
        "programs": ["SNAP", "Medicaid", "TANF (Cash Assistance)"],
    },
}


def get_available_states() -> list[str]:
    """Return state codes that have official form templates."""
    return [
        code
        for code, info in _FORM_REGISTRY.items()
        if (_FORMS_DIR / info["template"]).exists()
    ]


def has_official_form(state: str) -> bool:
    """Check whether an official fillable form exists for *state*."""
    info = _FORM_REGISTRY.get(state.upper())
    if not info:
        return False
    return (_FORMS_DIR / info["template"]).exists()


# ---------------------------------------------------------------------------
# Data extraction — reuses patterns from pdf_generator but maps to form keys
# ---------------------------------------------------------------------------


def _extract_form_data(args: dict[str, Any]) -> dict[str, str]:
    """Map tool arguments to canonical form field keys."""
    profile = args.get("household_profile", "")
    data: dict[str, str] = {}

    # Date
    data["date"] = datetime.now(tz=timezone.utc).strftime("%m/%d/%Y")

    # State
    state = args.get("state", "")
    if state:
        data["home_state"] = state
        data["mailing_state"] = state

    # ZIP
    zip_code = args.get("zip_code", "")
    zip_match = re.search(r"\b(\d{5})\b", zip_code or profile)
    if zip_match:
        data["home_zip"] = zip_match.group(1)
        data["mailing_zip"] = zip_match.group(1)

    # County
    county = args.get("county", "")
    if county:
        data["home_county"] = county.replace(" County", "")
        data["mailing_county"] = county.replace(" County", "")

    # Language — default English
    data["language_speak"] = "English"
    data["language_read"] = "English"

    return data


def _determine_checkboxes(
    args: dict[str, Any],
    workflow_output: str,
) -> dict[str, bool]:
    """Determine which program checkboxes to check based on workflow output."""
    output_upper = workflow_output.upper()
    checks: dict[str, bool] = {}

    # CalFresh (SNAP)
    checks["apply_calfresh"] = any(
        kw in output_upper for kw in ["SNAP", "CALFRESH", "FOOD STAMP"]
    )
    # Medi-Cal (Medicaid)
    checks["apply_medical"] = any(
        kw in output_upper for kw in ["MEDICAID", "MEDI-CAL", "CHIP"]
    )
    # CalWORKs (TANF)
    checks["apply_calworks"] = any(
        kw in output_upper for kw in ["TANF", "CALWORKS", "CASH ASSISTANCE"]
    )

    return checks


# ---------------------------------------------------------------------------
# PDF form filling
# ---------------------------------------------------------------------------


def fill_official_form(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path | None:
    """Fill the official state application form if available.

    Returns the path to the filled PDF, or ``None`` if no form is available
    or pypdf is not installed.
    """
    state = (args.get("state") or "").upper()
    if state not in _FORM_REGISTRY:
        return None

    info = _FORM_REGISTRY[state]
    template_path = _FORMS_DIR / info["template"]
    if not template_path.exists():
        logger.warning("Template %s not found", template_path)
        return None

    try:
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import NameObject
    except ImportError:
        logger.info("pypdf not installed — falling back to worksheet")
        return None

    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefits-applications"
    output_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(template_path))
    writer = PdfWriter()
    writer.append(reader)

    # Fill text fields
    form_data = _extract_form_data(args)
    text_mapping = info["text_fields"]

    field_values: dict[str, str] = {}
    for our_key, pdf_field in text_mapping.items():
        if our_key in form_data and form_data[our_key]:
            field_values[pdf_field] = form_data[our_key]

    # Apply text fields to all pages (fields may span pages)
    for page in writer.pages:
        writer.update_page_form_field_values(page, field_values, auto_regenerate=False)

    # Fill checkboxes by directly setting /V and /AS on annotation objects
    checkbox_states = _determine_checkboxes(args, workflow_output)
    checkbox_mapping = info.get("checkboxes", {})
    fields_to_check: set[str] = set()
    for our_key, pdf_field in checkbox_mapping.items():
        if checkbox_states.get(our_key, False):
            fields_to_check.add(pdf_field)

    if fields_to_check:
        for page in writer.pages:
            annots = page.get("/Annots", [])
            for annot in annots:
                obj = annot.get_object()
                field_name = str(obj.get("/T", ""))
                if field_name in fields_to_check:
                    obj[NameObject("/V")] = NameObject("/On")
                    obj[NameObject("/AS")] = NameObject("/On")

    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    zip_code = form_data.get("home_zip", "unknown")
    filename = f"benefits-application-{state}-{zip_code}-{timestamp}.pdf"
    output_path = output_dir / filename
    writer.write(str(output_path))

    return output_path


# ---------------------------------------------------------------------------
# Public API — unified entry point with fallback
# ---------------------------------------------------------------------------


def generate_application(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> tuple[Path, str]:
    """Generate a benefit application PDF.

    The path and the kind of document. Callers that also need the review sheet
    — there is exactly one, the subprocess helper — use
    :func:`generate_application_with_review`.
    """
    path, kind, _ = generate_application_with_review(
        args, workflow_output, output_dir
    )

    return path, kind


def generate_application_with_review(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> tuple[Path, str, Path | None]:
    """The same, plus the review sheet when the mapping layer wrote one.

    Reported rather than discovered. The helper used to look for a sibling
    ``.review.txt`` and found California's, which the SAWS generator also
    writes — so the guide route served a plain text sheet in place of the
    completion guide computed from the readiness model, which is a different
    and much poorer document. Only the layer that wrote a sheet knows it did.

    Three routes, in the order they are tried:

    1. **California**, which has a real 1,444-field AcroForm, a reviewed
       destination allowlist and its own generator. Left exactly where it is.
    2. **Any other state the mapping layer describes** — today Texas — through
       ``formmap``, which maps the same canonical field plan onto that state's
       form. This is the route that makes a second jurisdiction a data change
       rather than a new code path.
    3. The legacy per-state template fill, then the generic worksheet, for
       callers with no field plan at all.

    California is checked first and by name rather than through the registry
    because the two are genuinely different jobs: SAWS 2 PLUS is filled by
    writing native form fields, which the mapping layer describes but
    deliberately does not do (see ``NativeFieldFormNotRenderable``).
    """
    state = str(args.get("state") or "").upper()
    field_plan = args.get("application_field_plan")
    has_plan = isinstance(field_plan, list) and bool(field_plan)

    if state == "CA" and has_plan:
        from benefits_navigator.pdf_generator import generate_saws2_plus_pdf

        path = generate_saws2_plus_pdf(args, workflow_output, output_dir)
        return path, "official", None

    if has_plan:
        result = _generate_mapped_form(state, field_plan, output_dir)

        if result is not None:
            return result

    path = fill_official_form(args, workflow_output, output_dir)
    if path is not None:
        return path, "official", None

    from benefits_navigator.pdf_generator import generate_application_pdf

    path = generate_application_pdf(args, workflow_output, output_dir)
    return path, "worksheet", None


def _generate_mapped_form(
    state: str,
    field_plan: list[dict[str, Any]],
    output_dir: Path | None,
) -> tuple[Path, str, Path | None] | None:
    """Render this state's form through the mapping layer, if it can.

    Returns None — falling through to the older routes — when the state has no
    definition, or has one whose fields are all native. Never returns a
    document for a form it could not actually draw values onto: a blank PDF
    presented as a prefilled application is worse than no PDF at all.
    """
    from benefits_navigator.formmap import (
        canonical_values_from_field_plan,
        definition_for_form,
        form_id_for_state,
        generate_form,
        output_filename,
    )

    form_id = form_id_for_state(state)

    if form_id is None or not definition_for_form(form_id).is_overlay:
        return None

    canonical_values = canonical_values_from_field_plan(field_plan)
    generated = generate_form(form_id, canonical_values)

    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefits-applications"

    zip_code = str(
        canonical_values.get("applicant.home_address.zip_code") or ""
    )

    path = output_dir / output_filename(form_id, zip_code=zip_code[:5])
    generated.write(path)

    # The word the caller shows the applicant. "official" is reserved for a
    # document that is the government's own paper with our answers on it.
    kind = "official" if generated.is_official_document else "worksheet"

    # `write` always puts the review sheet beside the document, so this is a
    # statement rather than a search.
    return path, kind, path.with_suffix(".review.txt")
