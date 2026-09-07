"""The bundled TraceLab mapping must normalise the committed real fixture."""

import gzip
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import jsonschema

from agentscope_app.domain.mapping.interpreter import Emission, Reject, apply_mapping
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.domain.reducer import reduce_sessions
from tests.domain.test_schema_json import SCHEMA

BACKEND = Path(__file__).resolve().parents[2]
MAPPING_PATH = BACKEND / "mappings" / "tracelab-v1.json"
FIXTURE = BACKEND.parent / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"


def load_rows() -> list[tuple[int, dict[str, Any]]]:
    with gzip.open(FIXTURE, "rt", encoding="utf-8") as stream:
        return [(n, json.loads(line)) for n, line in enumerate(stream, 1)]


def test_reference_mapping_is_valid_against_schema_and_parser() -> None:
    raw = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
    jsonschema.validate(raw, SCHEMA)
    parsed = parse_mapping(raw)
    assert parsed.issues == (), parsed.issues
    assert parsed.spec is not None
    assert [r.id for r in parsed.spec.rules] == ["session", "model_call", "tool_call"]


def test_reference_mapping_normalises_the_whole_fixture() -> None:
    spec = parse_mapping(json.loads(MAPPING_PATH.read_text(encoding="utf-8"))).spec
    assert spec is not None
    rows = load_rows()
    emissions: list[Emission] = []
    rejects: list[Reject] = []
    for line_no, row in rows:
        result = apply_mapping(spec, row, file_sha256="fixture", locator=f"line:{line_no}")
        emissions.extend(result.emissions)
        rejects.extend(result.rejects)
    assert rejects == [], rejects[:5]
    counts = Counter(e.entity for e in emissions)
    assert counts["model_call"] == len(rows) == 4770
    assert counts["session"] == len(rows)
    assert counts["tool_call"] == sum(len(r["tools"]) for _, r in rows) == 5723
    tool = next(e for e in emissions if e.entity == "tool_call")
    assert tool.parent_occurrence is not None
    assert tool.parent_occurrence.emission_path == "model_call"
    assert isinstance(tool.fields["started_at"], datetime)
    assert tool.fields["session_external_id"] is not None
    call = next(e for e in emissions if e.entity == "model_call")
    assert call.fields["input_tokens"] is not None
    assert call.fields["started_at"] <= call.fields["ended_at"]
    assert len({e.occurrence.key for e in emissions}) == len(emissions)

    sessions = reduce_sessions(emissions)
    assert len(sessions) == 80
    assert Counter(s.agent for s in sessions.values()) == {"claude-code": 40, "codex": 40}
    for s in sessions.values():
        assert s.observed_start_at is not None and s.observed_end_at is not None
        assert s.observed_end_at >= s.observed_start_at
        assert s.conflicts == ()
    assert sum(s.model_call_count for s in sessions.values()) == 4770
    assert sum(s.tool_call_count for s in sessions.values()) == 5723


def test_call_bounds_are_chronological_extrema_of_timing_events() -> None:
    spec = parse_mapping(json.loads(MAPPING_PATH.read_text(encoding="utf-8"))).spec
    assert spec is not None
    non_chronological = 0
    for line_no, row in load_rows():
        stamps = [e["timestamp"] for e in row["timing_events"] if e.get("timestamp")]
        result = apply_mapping(spec, row, file_sha256="fixture", locator=f"line:{line_no}")
        call = next(e for e in result.emissions if e.entity == "model_call")
        expected_start = min(datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps)
        expected_end = max(datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps)
        assert call.fields["started_at"] == expected_start, line_no
        assert call.fields["ended_at"] == expected_end, line_no
        if stamps != sorted(stamps):
            non_chronological += 1
    assert non_chronological > 0  # the fixture really has unsorted event arrays


def test_every_source_field_in_the_fixture_is_mapped_or_explained() -> None:
    raw = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
    referenced: set[str] = set()
    for rule in raw["rules"]:
        prefix = "" if rule["select"] == "$" else rule["select"].removeprefix("$.") + "."
        for fm in rule["fields"].values():
            for p in [fm["path"]] if "path" in fm else fm.get("paths", []):
                referenced.add(prefix + p.removeprefix("$."))
    for entry in raw["unmapped"]:
        referenced.add(entry["path"].removeprefix("$."))

    def covered(key: str) -> bool:
        return any(
            ref == key or ref.startswith(key + ".") or ref.startswith(key + "[")
            for ref in referenced
        )

    top_keys: set[str] = set()
    tool_keys: set[str] = set()
    for _, row in load_rows():
        top_keys.update(row)
        for tool in row.get("tools") or []:
            tool_keys.update(tool)
    uncovered = sorted(k for k in top_keys if not covered(k))
    uncovered += sorted(f"tools[*].{k}" for k in tool_keys if not covered(f"tools[*].{k}"))
    assert uncovered == [], uncovered
