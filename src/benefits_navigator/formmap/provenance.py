#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Which official document we hold, where it came from, and proof it is that one.

Every coordinate in a form definition is a measurement of one specific PDF. The
measurement is only meaningful while that exact PDF is the one being drawn on.
Swap in a newer revision whose boxes have moved by four points and nothing
fails — the overlay still renders, the tests still pass, and an applicant hands
a caseworker a form with their income printed across a printed label.

So a document is not a filename here. It is a filename **plus the SHA-256 of
the bytes we measured**, and :func:`load_document` refuses to return a file
whose hash has changed. Updating a form is then a deliberate act: replace the
asset, replace the digest, re-measure, look at the pages. The failure mode is a
loud one at load time rather than a quiet one on a government form.

── Why the digest lives beside the coordinates ────────────────────────────
It would be easier to hash the assets in a test and call that enough. It is not:
a test proves the file was intact when CI ran, and the risk is a file that
changes afterwards — a fresh download dropped in by hand, an asset re-added from
a different HHSC page, a partially written copy. The check belongs on the path
that opens the file for rendering, which is here.

── What "revision" means, and why there are two ───────────────────────────
HHSC's catalog and HHSC's own printed page do not always agree. The Your Texas
Benefits paper-form catalog labels H1049 as a 2014 revision; the PDF behind that
label prints "Form H1049 / December 2001" in its own footer, and its embedded
creation date is 2005. Neither number is wrong — one is the catalog's, one is
the document's — and picking a favourite would throw away the discrepancy a
counselor needs to see. Both are recorded:

:attr:`OfficialDocument.catalog_revision`
    What the source page called it when it was retrieved.

:attr:`OfficialDocument.printed_revision`
    What the document prints on itself. This is the one a caseworker reads off
    the paper, and the one that identifies the layout our boxes were measured
    against.

── Language is a property of the document, not of the form ────────────────
See :mod:`benefits_navigator.formmap.documents`. This module records what each
file *is*; that one decides which file an applicant should be handed.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from enum import Enum
from pathlib import Path

#: Where official form assets live. Shared with the California templates, which
#: predate this module and are registered in ``form_templates``.
FORMS_DIR = Path(__file__).resolve().parent.parent / "forms"


class DocumentIntegrityError(RuntimeError):
    """A bundled official document is missing, or is not the one we measured.

    Deliberately not a warning and not a fallback to rendering anyway. A form
    definition's coordinates describe one specific PDF; drawing them onto a
    different one produces a plausible-looking, wrong government form, which is
    the single worst output this system can generate.
    """


class Fillability(str, Enum):
    """How much of a document can be filled through its own PDF form fields."""

    #: Real, usable AcroForm fields covering the answers we map.
    NATIVE_FIELDS = "native_fields"

    #: An XFA (LiveCycle) form whose AcroForm layer is a partial fallback.
    #:
    #: The widgets that exist are real and can be written, but they cover only a
    #: fraction of the printed boxes, and Adobe Acrobat renders the XFA layer in
    #: preference to them. Treated as *not* a filling route for anything we care
    #: about getting right; the few usable widgets are noted per form.
    XFA_PARTIAL = "xfa_partial"

    #: No form fields at all. Overlay is the only route.
    FLAT = "flat"


@dataclass(frozen=True)
class OfficialDocument:
    """One official government PDF, identified by its content.

    Frozen, and every field is a fact about the file rather than a preference:
    two people reading this record and the file should reach the same
    conclusions about what it is.
    """

    #: Filename within :data:`FORMS_DIR`.
    filename: str

    #: SHA-256 of the exact bytes the form's coordinates were measured against.
    sha256: str

    #: Size in bytes, for a cheaper mismatch message than a hash comparison.
    byte_size: int

    #: Page count, checked against the definition so a mapping cannot name a
    #: page the document does not have.
    page_count: int

    page_width: float
    page_height: float

    #: BCP-47 language tags the document itself is printed in.
    #:
    #: A tuple because HHSC publishes genuinely bilingual forms — H1049 prints
    #: every question in English and Spanish on the same line, in one file.
    #: Modelling that as "the English edition" and inventing a Spanish sibling
    #: would be a lie in both directions.
    languages: tuple[str, ...]

    fillability: Fillability

    #: What the document prints about its own revision, e.g. ``"08/2026"``.
    printed_revision: str

    #: What the source catalog called this revision when retrieved.
    #:
    #: Equal to :attr:`printed_revision` when they agree, and deliberately
    #: different when they do not. See the module docstring.
    catalog_revision: str

    #: The first-party page or file URL this was retrieved from.
    source_url: str

    #: When it was retrieved, for audit.
    retrieved_on: date

    #: The filename it arrived as, before being renamed into the repository.
    #:
    #: Kept so a downloaded file can be matched back to its record without
    #: re-hashing, and so the renaming is reversible by a reader.
    downloaded_as: str

    #: Anything a reader of this record needs that the fields above cannot say.
    notes: str = ""

    #: Message key qualifying how far :attr:`languages` actually goes.
    #:
    #: Set only when "bilingual" is true but incomplete. H3037 is the case:
    #: page 2, the authorization the *client* signs, is printed in English and
    #: Spanish, while page 1 is the clinician's and is English only. Declaring
    #: ``languages=("en", "es")`` and stopping there would let every surface
    #: tell a Spanish reader the whole document is theirs to read.
    #:
    #: A key rather than a sentence, and for the same reason the rest of this
    #: layer uses keys: the qualification is shown to the applicant in *their*
    #: language, so a Spanish reader is told in Spanish which page is not. The
    #: sentence itself lives with the other applicant-facing wording — in
    #: ``review_words`` for the review sheet, and in the message catalog for
    #: the interface — which is also what keeps this module free of any prose
    #: to translate.
    #:
    #: Empty means the document is printed in every language it declares,
    #: throughout.
    language_scope_key: str = ""

    @property
    def path(self) -> Path:
        return FORMS_DIR / self.filename

    @property
    def is_bilingual(self) -> bool:
        return len(self.languages) > 1

    def serves_language(self, language: str) -> bool:
        """Whether this document is printed in `language`."""
        return language in self.languages

    def digest_of_file(self) -> str:
        """The SHA-256 of the file as it is on disk right now."""
        try:
            data = self.path.read_bytes()
        except FileNotFoundError:
            raise DocumentIntegrityError(
                f"{self.filename} is declared as an official document but is "
                f"not present at {self.path}"
            ) from None

        return hashlib.sha256(data).hexdigest()

    def verify(self) -> None:
        """Raise unless the file on disk is the one this record describes.

        Called by :func:`load_document` before any rendering reads the file.
        """
        actual = self.digest_of_file()

        if actual == self.sha256:
            return

        size = self.path.stat().st_size

        raise DocumentIntegrityError(
            f"{self.filename} is not the document its coordinates were "
            f"measured against.\n"
            f"  expected sha256 {self.sha256} ({self.byte_size} bytes)\n"
            f"  found    sha256 {actual} ({size} bytes)\n"
            f"If HHSC published a new revision, this is the correct failure: "
            f"re-measure the boxes against the new document, update this "
            f"record, and look at the rendered pages before trusting it. "
            f"Do not update the digest alone — see docs/texas-forms.md."
        )


def load_document(document: OfficialDocument) -> Path:
    """The path to `document`, having proved it is the document we measured."""
    document.verify()

    return document.path
