#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Subprocess helper for generating a pre-filled benefit application draft.

Reads a JSON payload from stdin:
  {"args": {...}, "workflow_output": "...", "output_dir": "..."}

Writes one of two JSON payloads to stdout:
  Success: {"path": "<absolute_path>", "form_type": "official"|"worksheet",
            "review_path": "<absolute_path>",  (when one was written)
            "packet": [ ... ]}                 (the form manifest, when the
                                                state has a forms catalog)
  Failure: {"error": "<message>"}  (exit code 1)

The ``packet`` list is what the interface renders as form cards: one entry per
form this household needs, each naming the official document it resolves to in
the applicant's own language. It is produced here rather than in TypeScript so
that the locale-to-asset decision is made exactly once — see
``benefits_navigator.formmap.manifest``.

No LLM calls are made. No user PII is logged.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    """Read stdin payload, call generate_application, write result to stdout."""
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        sys.stdout.write(json.dumps({"error": f"Invalid stdin JSON: {exc}"}) + "\n")
        sys.exit(1)

    args = payload.get("args", {})
    workflow_output = payload.get("workflow_output", "")
    output_dir_str = payload.get("output_dir", "")

    if not output_dir_str:
        sys.stdout.write(json.dumps({"error": "output_dir is required"}) + "\n")
        sys.exit(1)

    output_dir = Path(output_dir_str)

    try:
        from benefits_navigator.form_filler import (
            generate_application_with_review,
        )

        path, form_type, review = generate_application_with_review(
            args, workflow_output, output_dir
        )

        result: dict[str, object] = {
            "path": str(path),
            "form_type": form_type,
        }

        # Reported by the generator, never guessed at from a sibling filename:
        # California's generator writes a review file of its own, and serving
        # that in place of its completion guide is a downgrade the caller
        # cannot detect.
        if review is not None and review.exists():
            result["review_path"] = str(review)

        result["packet"] = _packet_manifest(args)

        sys.stdout.write(json.dumps(result) + "\n")
    except Exception as exc:  # noqa: BLE001 — broad catch to ensure JSON error output
        sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")
        sys.exit(1)


def _packet_manifest(args: dict) -> list:
    """The form manifest for this household, or [] if it cannot be built.

    Failures here are swallowed on purpose, and this is the one place in the
    helper where that is the right call. The manifest drives presentation — the
    cards naming each form and its language — while the PDF beside it is the
    thing the applicant needs. A catalog defect must not turn a successfully
    generated application into an error, so a missing manifest degrades to the
    older, plainer panel rather than losing the document.

    It is not silent to an operator: the reason is written to stderr, which the
    Node caller already captures and logs.
    """
    try:
        from benefits_navigator.form_filler import packet_manifest_for

        return packet_manifest_for(args, args.get("application_field_plan"))
    except Exception as exc:  # noqa: BLE001 — presentation must not break the PDF
        sys.stderr.write(f"packet_manifest_unavailable: {exc}\n")

        return []


if __name__ == "__main__":
    main()
