"""What the assistant is told about the target: versions, entities and a DSL reference.

Application-owned so both adapters (the fake and the OpenAI-compatible one)
send the same contract. The text below is part of the prepared context and
therefore of its digest: change ``CONTEXT_VERSION`` when the shape changes and
``PROMPT_VERSION`` when the reference wording changes.
"""

from __future__ import annotations

from typing import Any, Final

from agentscope_app.domain.mapping.contract import DSL_VERSION
from agentscope_app.domain.schema import TARGET_SCHEMA, TARGET_SCHEMA_VERSION

CONTEXT_VERSION: Final = 1
PROMPT_VERSION: Final = 2

COMMON_MISTAKES_REFERENCE: Final = (
    'native_key lists mapped target field names, e.g. ["external_id"], never source columns. '
    'For example, fields: {"external_id": {"path": "$.session_id"}} uses '
    'native_key: ["external_id"], not ["session_id"] or ["$.session_id"]. '
    "A single scalar timestamp on a row is a start, never an end: map it to started_at and "
    "never copy it into ended_at. ended_at comes from a column that declares an end, or from "
    'the bounds of an event array (e.g. {"path": "$.timing_events[*].timestamp", '
    '"bounds": "max"}); otherwise omit ended_at rather than invent an interval. 
    'notes must be a string, never an object or array; use "" when there are no notes. '
    'Every field mapping must be a JSON object, e.g. {"path": "$.session_id"}, '
    'never a bare string; use {"literal": value} for a constant. '
)

DSL_REFERENCE: Final = (
    "Mapping DSL v1. A document is {dsl_version: 1, target_schema_version: 1, name, source, "
    "input_format: 'jsonl'|'parquet', rules: [...], unmapped: [{path, reason}], notes}. "
    "A rule is {id, entity: 'session'|'model_call'|'tool_call', select: path (default '$'), "
    "where: [{path, op: eq|ne|in|not_in|exists|not_exists, value}], parent: id of an earlier "
    "model_call rule whose select is '$' (tool_call rules only), native_key: [field, ...], "
    "fields: {target_field: field_mapping}}. Paths: '$' is the current item (the record, or one "
    "element of the selected array), '@root' is always the record; segments are '.name', '[n]' "
    "or '[*]'; '[*]' is allowed only in 'select' and in a timestamp 'bounds' path. A field "
    "mapping has exactly one of 'path' | 'paths' (first present wins) | 'literal', plus optional "
    "transforms (trim, lower, upper, json_decode, {enum_map: {mapping: {...}, unmapped: "
    "keep|null|reject}}), timestamp_format (iso8601|epoch_s|epoch_ms; timestamp fields only), "
    "unit ({from, to} in ns|us|ms|s|min; only for 'ms' fields, to must be 'ms'), "
    "empty_as_missing, on_missing (null|default|reject), default, on_invalid (null|reject), "
    "bounds (min|max with a '[*]' path; timestamp fields only). Conversions are strict: no "
    "boolean-to-number, no rounding, unknown enum values are not kept silently. Sessions are "
    "reconciled by external_id within a source; model_call and tool_call need "
    "session_external_id. Copy source paths exactly as the profile reports them. "
    + COMMON_MISTAKES_REFERENCE
)

WRAPPER_REFERENCE: Final = (
    "Parquet values that JSON cannot carry arrive as objects with an '_arrow' kind: timestamp "
    "{iso, unit, tz, value} (address '.iso' with timestamp_format iso8601), duration and time "
    "{seconds, unit} (address '.seconds' with unit {from: 's', to: 'ms'} for latency fields), "
    "binary {base64}, float {value} for NaN/Infinity. The profile lists each wrapper path's "
    "kind, observed units and time zones, and the accessors that address its payload."
)


def target_contract(input_format: str) -> dict[str, Any]:
    """The resolved contract sent with every prepared context."""
    entities: dict[str, Any] = {}
    for entity in TARGET_SCHEMA.values():
        entities[entity.name] = {
            "description": entity.description,
            "fields": {
                name: {
                    "type": f.type.value,
                    "required": f.required,
                    "unit": f.unit,
                    "description": f.description,
                }
                for name, f in entity.fields.items()
            },
        }
    return {
        "dsl_version": DSL_VERSION,
        "target_schema_version": TARGET_SCHEMA_VERSION,
        "input_format": input_format,
        "entities": entities,
        "dsl_reference": DSL_REFERENCE,
        "wrapper_reference": WRAPPER_REFERENCE,
    }
