"""Load the pinned local schedule; metrics never fetch prices from the network."""

from __future__ import annotations

import json
import re
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Any

from agentscope_app.domain.pricing import ModelRates, PriceSchedule

DEFAULT_SCHEDULE_PATH = Path(__file__).resolve().parents[3] / "prices" / "openrouter-v1.json"


def _unique_alias_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate alias table key: {key}")
        result[key] = value
    return result


def load_price_schedule(path: Path = DEFAULT_SCHEDULE_PATH) -> PriceSchedule | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if data["schema_version"] != 1 or data["rate_unit"] != "per_token":
        raise ValueError("Unsupported price schedule schema or rate unit")
    fetched_at = datetime.fromisoformat(data["fetched_at"])
    if fetched_at.tzinfo is None or data["revision_date"] != fetched_at.date().isoformat():
        raise ValueError("Schedule must declare its UTC fetch and revision date")
    if data["source_url"] != "https://openrouter.ai/api/v1/models":
        raise ValueError("Unexpected price source")
    models = {}
    for model_id, rates in data["models"].items():
        if not isinstance(model_id, str) or not model_id:
            raise ValueError("Invalid model ID")
        if set(rates) != {"prompt", "completion", "cache_read"}:
            raise ValueError("Unexpected rate fields")
        parsed = {}
        for name, value in rates.items():
            if value is not None and (
                not isinstance(value, str) or re.fullmatch(r"\d+(?:\.\d+)?", value) is None
            ):
                raise ValueError("Rates must be nonnegative exact decimal strings or null")
            parsed[name] = Fraction(value) if value is not None else None
        models[model_id] = ModelRates(**parsed)
    if len(models) != data["model_count"]:
        raise ValueError("Schedule model count mismatch")
    provenance = data["provenance"]
    if (
        provenance["source_model_count"] != len(models)
        or provenance["method"] != "GET"
        or provenance["authentication"] != "none"
        or re.fullmatch(r"[0-9a-f]{64}", provenance["response_sha256"]) is None
    ):
        raise ValueError("Invalid public-fetch provenance")
    aliases_path = path.with_suffix(".aliases.json")
    aliases = {}
    alias_version = None
    version = data["schedule_version"]
    if aliases_path.exists():
        table = json.loads(
            aliases_path.read_text(encoding="utf-8"), object_pairs_hook=_unique_alias_keys
        )
        if (
            table["schema_version"] != 1
            or table["schedule_version"] != version
            or not isinstance(table["alias_version"], str)
            or not table["alias_version"]
            or not isinstance(table["aliases"], dict)
        ):
            raise ValueError("Invalid alias table schema, version or schedule binding")
        aliases, alias_version = table["aliases"], table["alias_version"]
        version = f"{version}+{alias_version}"
    return PriceSchedule(version, models, data["currency"], aliases, alias_version)
