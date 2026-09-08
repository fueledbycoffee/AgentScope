#!/usr/bin/env python3
"""Fetch a public, user-owned OpenRouter token price snapshot. No credentials used."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_URL = "https://openrouter.ai/api/v1/models"
RATE_FIELDS = {"prompt": "prompt", "completion": "completion", "cache_read": "input_cache_read"}


def build_schedule(body: bytes, fetched_at: datetime) -> dict:
    payload = json.loads(body)
    rows = payload["data"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("Expected a nonempty public models list")
    models = {}
    unavailable = 0
    for row in rows:
        model_id = row["id"]
        if not isinstance(model_id, str) or not model_id or model_id in models:
            raise ValueError("Model IDs must be nonempty and unique")
        rates = {}
        for target, source in RATE_FIELDS.items():
            value = row.get("pricing", {}).get(source)
            if value is not None:
                if not isinstance(value, str):
                    raise ValueError("Rates must be exact decimal strings")
                try:
                    rate = Decimal(value)
                except InvalidOperation as exc:
                    raise ValueError("Invalid rate") from exc
                if not rate.is_finite():
                    raise ValueError("Rates must be finite")
                # OpenRouter uses negative sentinel prices for dynamic routing.
                value = format(rate, "f") if rate >= 0 else None
            unavailable += value is None
            rates[target] = value
        models[model_id] = rates
    stamp = fetched_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    digest = hashlib.sha256(body).hexdigest()
    return {
        "schema_version": 1,
        "schedule_version": f"openrouter-{stamp[:10]}-{digest[:12]}",
        "fetched_at": stamp,
        "revision_date": stamp[:10],
        "source_url": SOURCE_URL,
        "currency": "USD",
        "rate_unit": "per_token",
        "model_count": len(models),
        "models": dict(sorted(models.items())),
        "provenance": {
            "script": "scripts/fetch_openrouter_prices.py",
            "method": "GET",
            "authentication": "none",
            "response_sha256": digest,
            "source_model_count": len(rows),
            "rate_field_mapping": RATE_FIELDS,
            "unavailable_rate_count": unavailable,
            "revision_date_basis": "UTC fetch date; endpoint supplies no schedule revision date",
            "projection": "Public model IDs and prompt/completion/input_cache_read rates only",
            "unavailable_policy": "Absent or negative sentinel rates become null, never zero",
        },
    }


def fetch_schedule(output: Path) -> dict:
    request = Request(SOURCE_URL, headers={"Accept": "application/json"}, method="GET")
    with urlopen(request, timeout=30) as response:
        body = response.read()
    schedule = build_schedule(body, datetime.now(UTC))
    output.parent.mkdir(parents=True, exist_ok=True)
    # A snapshot is immutable; choose a new path to refresh the user-owned schedule.
    with output.open("x", encoding="utf-8") as stream:
        json.dump(schedule, stream, indent=2, ensure_ascii=True)
        stream.write("\n")
    return schedule


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    schedule = fetch_schedule(args.output)
    print(
        f"{schedule['schedule_version']}: {schedule['model_count']} public models; "
        f"revision {schedule['revision_date']}; wrote {args.output}"
    )


if __name__ == "__main__":
    main()
