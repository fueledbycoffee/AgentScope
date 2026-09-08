from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone

import pytest

from agentscope_app.domain.claims import (
    MAX_CANONICAL_BYTES,
    PROJECTION_FIELDS,
    canonical_projection,
    prepare_claims,
)
from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.contract import FieldMapping, MappingSpec, Rule
from agentscope_app.domain.mapping.interpreter import Emission
from agentscope_app.domain.mapping.paths import parse_path
from agentscope_app.domain.schema import TARGET_SCHEMA, FieldType


def spec():
    return MappingSpec(
        1,
        1,
        "test",
        "source",
        "jsonl",
        tuple(
            Rule(
                kind,
                kind,
                parse_path("$"),
                {
                    "external_id": FieldMapping(
                        "external_id", FieldType.STRING, (parse_path("$.id"),)
                    ),
                    "sequence": FieldMapping("sequence", FieldType.INTEGER, (parse_path("$.n"),)),
                },
                native_key=("external_id",),
            )
            for kind in PROJECTION_FIELDS
        ),
    )


def emit(kind="model_call", file="a", locator="line:1", **fields):
    return Emission(
        kind,
        kind,
        occurrence=SourceOccurrence(file, locator, kind),
        fields={"external_id": "k", "session_external_id": "s", **fields},
        native_key=("k",),
    )


def prepared(*emissions, mapping=None, source="src"):
    return prepare_claims(
        source, emissions, {e.occurrence.file_sha256: mapping or spec() for e in emissions}
    )


def session(file="a", locator="line:1", agent="h"):
    return emit("session", file, locator, external_id="s", agent=agent)


def test_projection_v1_normalizes_null_and_utc_without_rounding():
    t = datetime(2026, 1, 1, tzinfo=UTC)
    a = emit(input_tokens=2**60 + 1, started_at=t)
    b = emit(
        input_tokens=2**60 + 1, started_at=t.astimezone(timezone(timedelta(hours=2))), model=None
    )
    assert canonical_projection(a) == canonical_projection(b)
    assert str(2**60 + 1) in canonical_projection(a)
    assert len({canonical_projection(emit(model=x)) for x in (None, "", False, 0)}) == 4


@pytest.mark.parametrize("kind", PROJECTION_FIELDS)
def test_all_entity_fields_affect_only_their_own_projection(kind):
    assert set(PROJECTION_FIELDS[kind]) == set(TARGET_SCHEMA[kind].fields)
    empty = emit(kind)
    for key in PROJECTION_FIELDS[kind]:
        assert canonical_projection(
            replace(empty, fields={**empty.fields, key: "different"})
        ) != canonical_projection(empty)


def test_composite_claims_keep_names_types_and_boundaries():
    mapping = spec()
    rules = tuple(replace(r, native_key=("sequence", "external_id")) for r in mapping.rules)
    mapping = replace(mapping, rules=rules)
    a = prepared(session(), emit(sequence=5), mapping=mapping).claims[-1]
    b = prepared(session(), emit(sequence="5"), mapping=mapping).claims[-1]
    assert a.scope_text != b.scope_text
    reordered = replace(
        mapping, rules=tuple(replace(r, native_key=tuple(reversed(r.native_key))) for r in rules)
    )
    assert (
        prepared(session(), emit(sequence=5), mapping=reordered).claims[-1].scope_text
        == a.scope_text
    )


def test_null_empty_and_missing_claim_parts():
    for key in (None,):
        assert len(prepared(session(), emit(external_id=key)).claims) == 1
    assert len(prepared(session(), emit(external_id="")).claims) == 2
    assert not prepared(
        session(),
        mapping=replace(spec(), rules=tuple(replace(r, native_key=()) for r in spec().rules)),
    ).claims


def test_harness_resolution_is_file_local():
    a = emit(locator="line:1")
    later = session(locator="line:9")
    assert prepared(a, later).claims[0].scope_text == prepared(later, a).claims[-1].scope_text
    assert prepared(session(file="b"), a).conditions[0].affected_emissions == 1
    assert prepared(session(agent="h"), session(agent="other"), a).conditions
    assert prepared(session(agent=None), a).conditions


def test_changed_agent_and_provider_lose_coverage():
    a = prepared(session(), emit(provider="old")).claims
    b = prepared(session(agent="other"), emit(provider="new")).claims
    assert all(x.scope_text != y.scope_text for x, y in zip(a, b, strict=True))
    assert len(prepared(session(agent=None), emit(provider="unknown")).conditions) == 2


def test_compatible_mapping_revisions_compare():
    a = prepared(session(), emit()).claims[-1]
    mapping = replace(spec(), name="revision two", notes="new notes")
    assert prepared(session(), emit(), mapping=mapping).claims[-1].scope_text == a.scope_text
    rules = tuple(
        replace(
            r,
            fields={
                **r.fields,
                "external_id": replace(r.fields["external_id"], paths=(parse_path("$.other_id"),)),
            },
        )
        for r in mapping.rules
    )
    assert (
        prepared(session(), emit(), mapping=replace(mapping, rules=rules)).claims[-1].scope_text
        != a.scope_text
    )


def test_parent_changes_leave_child_projection_equal():
    tool = emit("tool_call", tool_name="read")
    a = prepared(session(), emit(model="old", input_tokens=10), tool)
    b = prepared(session(), emit(model="new", input_tokens=20), tool)
    assert a.claims[-1] == b.claims[-1]
    assert a.claims[1].projection_text != b.claims[1].projection_text


def test_projection_size_limit():
    result = prepared(session(), emit(error_message="x" * MAX_CANONICAL_BYTES))
    assert len(result.claims) == 1
    assert result.conditions[0].code == "claim_projection_too_large"


def test_source_session_and_entity_isolate_claims():
    a = prepared(session(), emit()).claims[-1]
    assert prepared(session(), emit(), source="other").claims[-1].scope_text != a.scope_text
    other_session = prepared(
        emit("session", external_id="other", agent="h"), emit(session_external_id="other")
    ).claims[-1]
    assert other_session.scope_text != a.scope_text
    assert prepared(session(), emit("tool_call")).claims[-1].scope_text != a.scope_text
