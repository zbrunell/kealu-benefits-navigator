#!/usr/bin/env python
#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Resolve each form's anchors against its official document, and commit them.

Run from the repository root::

    .venv/bin/python tools/measure_texas_forms.py          # regenerate all
    .venv/bin/python tools/measure_texas_forms.py --check  # fail if stale

**Read the diff before committing.** A changed anchor moves boxes on a
government form, and the diff is the only place a reviewer can see by how much.

``--check`` is what CI runs: it regenerates in memory and fails if the result
differs from what is committed, so an anchor edited without regenerating cannot
reach main.

Needs ``pdftotext`` (poppler). Nothing on the rendering path does — that is the
point of committing the output.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from benefits_navigator.formmap.measure import (  # noqa: E402
    DocumentText,
    MeasurementError,
)
from benefits_navigator.formmap.measurements import (  # noqa: E402
    measurements_path,
    write_measurements,
)
from benefits_navigator.formmap.provenance import (  # noqa: E402
    OfficialDocument,
    load_document,
)
from benefits_navigator.formmap.targets import Box  # noqa: E402


def _sources() -> list[tuple[OfficialDocument, dict[str, object]]]:
    """Every document to measure, with the placements to resolve against it.

    Imported lazily so that adding a form here is the only edit needed — and so
    a form whose module fails to import names itself in the traceback rather
    than taking the whole tool down anonymously.
    """
    from benefits_navigator.formmap.forms import h1010_official, h3037
    from benefits_navigator.formmap.forms.tx_documents import (
        TX_H1010_EN,
        TX_H1010_ES,
        TX_H3037_BILINGUAL,
    )

    return [
        (TX_H3037_BILINGUAL, h3037.PLACEMENTS),
        (TX_H1010_EN, h1010_official.PLACEMENTS_EN),
        (TX_H1010_ES, h1010_official.PLACEMENTS_ES),
    ]


def _resolve(
    document: OfficialDocument, placements: dict[str, object]
) -> dict[str, tuple[Box, ...]]:
    text = DocumentText.of(load_document(document))
    resolved: dict[str, tuple[Box, ...]] = {}
    failures: list[str] = []

    for key, placement in placements.items():
        group = placement if isinstance(placement, tuple) else (placement,)
        boxes: list[Box] = []

        for item in group:
            try:
                found = item.resolve(text)
            except MeasurementError as error:
                failures.append(f"  {key}: {error}")
                break

            boxes.extend(found if isinstance(found, tuple) else [found])
        else:
            resolved[key] = tuple(boxes)

    if failures:
        raise SystemExit(
            f"\n{document.filename}: {len(failures)} anchor(s) did not "
            f"resolve.\n" + "\n".join(failures)
        )

    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the committed measurements differ from a fresh run",
    )
    args = parser.parse_args()

    stale: list[str] = []

    for document, placements in _sources():
        boxes = _resolve(document, placements)
        path = measurements_path(document)

        if args.check:
            before = path.read_text() if path.exists() else ""
            write_measurements(document, boxes)
            after = path.read_text()

            if before != after:
                stale.append(document.filename)

                if before:
                    path.write_text(before)
                else:
                    path.unlink()
            continue

        write_measurements(document, boxes)
        count = sum(len(group) for group in boxes.values())
        print(
            f"  {document.filename}: {len(boxes)} field(s), {count} box(es) "
            f"-> {path.relative_to(REPO_ROOT)}"
        )

    if stale:
        print(
            "These measurement files are out of date with their anchors:\n  "
            + "\n  ".join(stale)
            + "\n\nRun tools/measure_texas_forms.py and review the diff.",
            file=sys.stderr,
        )

        return 1

    if args.check:
        print("measurements are up to date")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
