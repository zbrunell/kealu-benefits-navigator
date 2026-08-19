#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Which official SAWS 2 PLUS form belongs to which language.

CDSS publishes SAWS 2 PLUS (4/15) in seventeen languages. Two of them matter
here, and they are not equally usable:

Spanish
    ``saws2plus_SP.pdf`` is a genuine fillable AcroForm — 29 pages, 1,442
    fields — and 276 of the 276 destinations this project writes to exist on
    it, on the same pages, with the same checkbox on-state names as English.
    An applicant who picks Spanish gets the real state form with Spanish
    printed labels, and the answers land in the right boxes.

Chinese
    ``saws2plus_chinese.pdf`` is published, and it is the same 4/15 revision,
    but it fails the two things this product needs from it:

    1. It is **Traditional** Chinese. The CDSS Chinese forms index states
       "Unless otherwise indicated, all forms on this page have been
       translated into Traditional Chinese", and the file itself confirms it
       (補充 / 醫療 / 殘障 / 計劃, where Simplified would be 补充 / 医疗 /
       残障 / 计划). This product promises Simplified Chinese.
    2. It has **zero** AcroForm fields. It is a flat scan-style PDF. Nothing
       can be written into it programmatically at all.

    Neither is a defect we can fix without forging a state form, so we do not
    try. Simplified Chinese users get a Simplified Chinese interface and a
    Simplified Chinese completion guide, and the guide says plainly which
    form they are holding. See ``TEMPLATES['zh-CN']``.

Adding a language means adding a row here and mapping it — never quietly
falling back, because a Spanish speaker handed an English form has been given
a form they cannot read while being told it is theirs.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_FORMS_DIR = Path(__file__).parent / "forms"

#: The revision every template here must be, printed in each page footer.
FORM_REVISION = "4/15"


@dataclass(frozen=True)
class FormTemplate:
    """One official form asset, and how honest we can be about it."""

    #: The application locale this row serves.
    locale: str

    #: The language of the PDF actually handed to the applicant.
    #:
    #: Equal to ``locale`` when an official fillable translation exists, and
    #: deliberately different when it does not.
    document_language: str

    #: The file to fill.
    path: Path

    #: Whether ``path`` is the official form in the applicant's own language.
    #:
    #: False means the interface is localized but the paper is not, and every
    #: user-facing surface has to say so.
    is_official_translation: bool

    #: CDSS source URL, so the asset can be re-verified against the state.
    source_url: str

    #: Message key naming the limitation, or None when there is none.
    #:
    #: A key rather than a sentence: this is resolved into the applicant's own
    #: language by the guide and the UI, like every other message.
    limitation_key: str | None = None

    #: An official form in the applicant's language that exists but cannot be
    #: filled — offered for reading alongside the fillable one.
    reference_path: Path | None = None

    #: The language of ``reference_path``, when there is one.
    reference_language: str | None = None


TEMPLATES: dict[str, FormTemplate] = {
    "en": FormTemplate(
        locale="en",
        document_language="en",
        path=_FORMS_DIR / "CA-SAWS-2-PLUS.pdf",
        is_official_translation=True,
        source_url=(
            "https://www.cdss.ca.gov/cdssweb/entres/forms/English/SAWS2PLUS.pdf"
        ),
    ),
    "es": FormTemplate(
        locale="es",
        document_language="es",
        path=_FORMS_DIR / "CA-SAWS-2-PLUS-ES.pdf",
        is_official_translation=True,
        source_url=(
            "https://www.cdss.ca.gov/cdssweb/entres/forms/Spanish/saws2plus_SP.pdf"
        ),
    ),
    "zh-CN": FormTemplate(
        locale="zh-CN",
        # The paper is English. Saying so is the entire point of this row.
        document_language="en",
        path=_FORMS_DIR / "CA-SAWS-2-PLUS.pdf",
        is_official_translation=False,
        source_url=(
            "https://www.cdss.ca.gov/cdssweb/entres/forms/English/SAWS2PLUS.pdf"
        ),
        limitation_key="form_limitation_zh_hant_not_fillable",
        reference_path=_FORMS_DIR / "CA-SAWS-2-PLUS-ZH-HANT-REFERENCE.pdf",
        reference_language="zh-Hant",
    ),
}

#: Locales this product will generate a draft for.
SUPPORTED_LOCALES: tuple[str, ...] = ("en", "es", "zh-CN")


def normalize_locale(value: str | None) -> str:
    """Reduce a locale tag to one of :data:`SUPPORTED_LOCALES`.

    Deliberately narrow. ``zh``, ``zh-Hans`` and ``zh-SG`` all mean Simplified
    Chinese here, but ``zh-Hant``/``zh-TW``/``zh-HK`` are Traditional and are
    *not* silently folded into Simplified — we would be promising a script we
    do not render. They fall through to English, which is at least true.
    """
    if not value:
        return "en"

    tag = value.strip().replace("_", "-")
    lower = tag.lower()

    if lower.startswith("es"):
        return "es"

    if lower.startswith("zh"):
        traditional = ("zh-hant", "zh-tw", "zh-hk", "zh-mo")

        if any(lower.startswith(t) for t in traditional):
            return "en"

        return "zh-CN"

    return "en"


def template_for(locale: str | None) -> FormTemplate:
    """The official form to fill for `locale`, never None."""
    return TEMPLATES[normalize_locale(locale)]
