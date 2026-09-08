"""Offline fixtures only: importing or testing the fetch script never contacts OpenRouter."""

import importlib.util
import io
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from agentscope_app.infrastructure.prices import load_price_schedule

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "fetch_openrouter_prices.py"
spec = importlib.util.spec_from_file_location("fetch_openrouter_prices", SCRIPT)
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)


@pytest.fixture
def public_body():
    return json.dumps(
        {
            "data": [
                {
                    "id": "vendor/model",
                    "pricing": {
                        "prompt": "0.01",
                        "completion": "0.02",
                        "input_cache_read": "0.001",
                    },
                    "description": "This unrelated field must not be retained",
                    "private_extra": "discard",
                },
                {"id": "vendor/free", "pricing": {"prompt": "0", "completion": "0"}},
                {"id": "vendor/dynamic", "pricing": {"prompt": "-1", "completion": "1e-9"}},
            ]
        }
    ).encode()


def test_real_fetch_path_uses_only_keyless_get_and_writes_public_projection(
    tmp_path, monkeypatch, public_body
):
    requests = []

    def fake_open(request, timeout):
        requests.append((request.full_url, request.get_method(), request.headers, timeout))
        return io.BytesIO(public_body)

    monkeypatch.setattr(fetcher, "urlopen", fake_open)
    path = tmp_path / "schedule.json"
    data = fetcher.fetch_schedule(path)
    assert requests == [(fetcher.SOURCE_URL, "GET", {"Accept": "application/json"}, 30)]
    assert data["model_count"] == data["provenance"]["source_model_count"] == 3
    assert data["revision_date"] == data["fetched_at"][:10]
    assert set(data) == {
        "schema_version",
        "schedule_version",
        "fetched_at",
        "revision_date",
        "source_url",
        "currency",
        "rate_unit",
        "model_count",
        "models",
        "provenance",
    }
    assert data["models"]["vendor/dynamic"] == {
        "prompt": None,
        "completion": "0.000000001",
        "cache_read": None,
    }
    assert all(
        set(rates) == {"prompt", "completion", "cache_read"} for rates in data["models"].values()
    )
    assert "private_extra" not in path.read_text() and "discard" not in path.read_text()
    loaded = load_price_schedule(path)
    assert loaded.version == data["schedule_version"]
    assert str(loaded.models["vendor/model"].prompt) == "1/100"
    with pytest.raises(FileExistsError):
        fetcher.fetch_schedule(path)
    assert load_price_schedule(tmp_path / "absent.json") is None


@pytest.mark.parametrize("bad", [0.01, "NaN", "Infinity", "oops"])
def test_fetch_rejects_inexact_or_invalid_rates(public_body, bad):
    data = json.loads(public_body)
    data["data"][0]["pricing"]["prompt"] = bad
    with pytest.raises(ValueError):
        fetcher.build_schedule(json.dumps(data).encode(), datetime(2026, 9, 8, tzinfo=UTC))


def test_loader_rejects_invalid_units_count_currency_and_rates(tmp_path, public_body):
    data = fetcher.build_schedule(public_body, datetime(2026, 9, 8, tzinfo=UTC))
    path = tmp_path / "schedule.json"
    for key, value in [
        ("rate_unit", "per_million_tokens"),
        ("currency", "EUR"),
        ("model_count", 999),
    ]:
        path.write_text(json.dumps({**data, key: value}))
        with pytest.raises(ValueError):
            load_price_schedule(path)
    data["models"]["vendor/model"]["prompt"] = 0.01
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        load_price_schedule(path)
