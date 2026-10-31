#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""The fax and mailing address we give Texas applicants are the form's own.

``web/src/lib/tx-hhsc-office.ts`` tells an applicant where to send the H1010
we prepared. Those details are copied from the edition we fill, not from a
web page, because the form is what HHSC stands behind. When the asset is
replaced with a new edition this fails until the constants are checked.
"""

from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
FORM = ROOT / "src/benefits_navigator/forms/TX-H1010-EN-2026-08.pdf"
CONSTANTS = ROOT / "web/src/lib/tx-hhsc-office.ts"


def _form_text() -> str:
    text = " ".join(page.extract_text() or "" for page in PdfReader(FORM).pages)
    return re.sub(r"\s+", " ", text)


def _constant(pattern: str) -> str:
    match = re.search(pattern, CONSTANTS.read_text())
    assert match, pattern
    return match.group(1)


def test_fax_number_is_printed_on_the_form() -> None:
    fax = _constant(r"fax: '([^']+)'")

    assert f"Fax: {fax}" in _form_text()


def test_mailing_address_is_printed_on_the_form() -> None:
    lines = re.findall(r"'([^']+)'", _constant(r"mailLines: \[([^\]]+)\]"))

    assert lines == ["HHSC", "PO Box 149024", "Austin, TX 78714-9968"]
    assert f"Mail: {lines[0]}, {lines[1]}, {lines[2]}" in _form_text()
