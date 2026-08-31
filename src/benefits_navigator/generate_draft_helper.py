#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Subprocess helper for generating a pre-filled benefit application draft.

Reads a JSON payload from stdin:
  {"args": {...}, "workflow_output": "...", "output_dir": "..."}

Writes one of two JSON payloads to stdout:
  Success: {"path": "<absolute_path>", "form_type": "official"|"worksheet",
            "review_path": "<absolute_path>"}   (review_path when one was written)
  Failure: {"error": "<message>"}  (exit code 1)

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

        result: dict[str, str] = {"path": str(path), "form_type": form_type}

        # Reported by the generator, never guessed at from a sibling filename:
        # California's generator writes a review file of its own, and serving
        # that in place of its completion guide is a downgrade the caller
        # cannot detect.
        if review is not None and review.exists():
            result["review_path"] = str(review)

        sys.stdout.write(json.dumps(result) + "\n")
    except Exception as exc:  # noqa: BLE001 — broad catch to ensure JSON error output
        sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
