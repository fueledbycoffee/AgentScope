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
