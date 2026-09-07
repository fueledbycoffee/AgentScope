"""Deterministic mapping assistant for tests and offline demos (``AGENTSCOPE_LLM_PROVIDER=fake``).

Replies are keyed by the shape of the prepared profile (its path set), as the
production readers produce it, so the fake exercises the same contract the
compatible adapter (#14) will: it only ever sees ``prepared.text`` and an
optional repair request, and answers with the JSON envelope the application
parses. A ``script`` of behaviours drives the failure paths in tests.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from agentscope_app.application.dto import AssistantReply, PreparedContext, RepairRequest
from agentscope_app.application.errors import AssistantError

MODEL = "fake/deterministic-1"
BEHAVIOURS = (
    "valid",
    "length",
    "refusal",
    "malformed",
    "envelope",
    "invalid",
    "timeout",
    "provider",
)


class FakeMappingAssistant:
    def __init__(self, bundled_dir: Path, script: Sequence[str] = ()) -> None:
        self._bundled_dir = Path(bundled_dir)
        self._script = list(script)
        self.calls: list[tuple[PreparedContext, RepairRequest | None]] = []

    def complete(
        self, prepared: PreparedContext, *, repair: RepairRequest | None = None
    ) -> AssistantReply:
        self.calls.append((prepared, repair))
        behaviour = self._script.pop(0) if self._script else "valid"
        if behaviour not in BEHAVIOURS:
            raise ValueError(f"unknown fake behaviour {behaviour!r}")
        if behaviour == "timeout":
            raise AssistantError("timeout", "The fake assistant timed out on purpose")
        if behaviour == "provider":
            raise AssistantError("provider", "The fake provider returned an error on purpose")
        if behaviour == "refusal":
            return AssistantReply("I cannot help with that.", MODEL, "refusal")
        if behaviour == "malformed":
            return AssistantReply("Sure! Here is the mapping: {not json", MODEL, "stop")
        if behaviour == "envelope":
            return AssistantReply("[]", MODEL, "stop")
        envelope = self._envelope(prepared.document, repair)
        if behaviour == "invalid":
            first_rule = envelope["mapping"]["rules"][0]
            first_rule["fields"]["external_id"] = {"path": "$.nope[*]"}  # wildcard in a field path
        text = json.dumps(envelope, ensure_ascii=False, default=str)
        if behaviour == "length":
            return AssistantReply(text[: max(20, len(text) // 2)], MODEL, "length")
        return AssistantReply(text, MODEL, "stop")

    # -- drafts ------------------------------------------------------------------------------

    def _envelope(self, document: dict[str, Any], repair: RepairRequest | None) -> dict[str, Any]:
        paths = {f["path"] for f in document["profile"]["fields"]}
        identity = document["identity"]
        head = {
            "dsl_version": 1,
            "target_schema_version": 1,
            "name": identity["name"],
            "source": identity["source"],
            "input_format": document["upload"]["format"],
        }
        message = str(document.get("message", "")).lower()
        current = document.get("current_mapping")
        if {
            "$.timing_events[*].timestamp",
            "$.input_tokens_total",
            "$.tools[*].tool_call_id",
        } <= paths:
            return self._tracelab(head)
        if {"$.session_id", "$.created_at", "$.checkpoints_count"} <= paths:
            return self._swe_sessions(head)
        if {"$.turn_id", "$.session_id", "$.timestamp", "$.role"} <= paths:
            return self._swe_conversations(head)
        if {"$.ts", "$.session", "$.id"} <= paths:
            return self._epoch(head, current, message)
        return self._generic(head, document["profile"]["fields"])

    def _tracelab(self, head: dict[str, Any]) -> dict[str, Any]:
        bundled = json.loads((self._bundled_dir / "tracelab-v1.json").read_text(encoding="utf-8"))
        mapping = {**bundled, **head}
        return {
            "mapping": mapping,
            "explanations": [
                _explain(
                    "session.external_id",
                    "$.session_id",
                    "one id per session, present on every row",
                    0.95,
                ),
                _explain(
                    "model_call.input_tokens",
                    "$.input_tokens_total",
                    "the row's total input tokens",
                    0.8,
                ),
                _explain(
                    "model_call.started_at",
                    "$.timing_events[*].timestamp",
                    "earliest event of the invocation (bounds: min)",
                    0.85,
                ),
                _explain(
                    "tool_call.tool_name",
                    "$.tools[*].tool_name",
                    "one tool per element of tools",
                    0.95,
                ),
            ],
            "ambiguities": [],
            "questions": [],
        }

    def _swe_sessions(self, head: dict[str, Any]) -> dict[str, Any]:
        mapping = {
            **head,
            "notes": "SWE-chat sessions table: one row per session; tokens are per-session totals.",
            "rules": [
                {
                    "id": "session",
                    "entity": "session",
                    "select": "$",
                    "fields": {
                        "external_id": {"path": "$.session_id", "on_missing": "reject"},
                        "agent": {"path": "$.agent"},
                        "user": {"path": "$.user_id"},
                        "repo": {"path": "$.repo_id"},
                        "started_at": {"path": "$.created_at.iso", "timestamp_format": "iso8601"},
                    },
                }
            ],
            "unmapped": [
                {
                    "path": "$.input_tokens",
                    "reason": "per-session total, no model_call observation",
                },
                {
                    "path": "$.duration_seconds",
                    "reason": "derived; observed bounds come from calls",
                },
            ],
        }
        return {
            "mapping": mapping,
            "explanations": [
                _explain("session.external_id", "$.session_id", "unique per row", 0.95),
                _explain(
                    "session.started_at",
                    "$.created_at.iso",
                    "Arrow timestamp (ns, UTC) addressed by .iso",
                    0.9,
                ),
            ],
            "ambiguities": [
                {
                    "target": "model_call.input_tokens",
                    "options": ["leave unmapped", "emit one synthetic model_call per session"],
                    "what_settles_it": "whether per-session totals should appear as calls at all",
                }
            ],
            "questions": ["Should sessions without conversations rows still count as sessions?"],
        }

    def _swe_conversations(self, head: dict[str, Any]) -> dict[str, Any]:
        mapping = {
            **head,
            "notes": "SWE-chat conversations: one row per turn; assistant turns are model calls.",
            "rules": [
                {
                    "id": "session",
                    "entity": "session",
                    "select": "$",
                    "fields": {
                        "external_id": {"path": "$.session_id", "on_missing": "reject"},
                        "agent": {"path": "$.agent"},
                    },
                },
                {
                    "id": "model_call",
                    "entity": "model_call",
                    "select": "$",
                    "where": [{"path": "$.role", "op": "eq", "value": "assistant"}],
                    "fields": {
                        "session_external_id": {"path": "$.session_id", "on_missing": "reject"},
                        "external_id": {"path": "$.turn_id"},
                        "sequence": {"path": "$.turn_number"},
                        "model": {"path": "$.model"},
                        "started_at": {"path": "$.timestamp.iso", "timestamp_format": "iso8601"},
                        "token_semantics": {"literal": "unknown"},
                        "input_tokens": {"path": "$.input_tokens"},
                        "output_tokens": {"path": "$.output_tokens"},
                        "cache_read_tokens": {"path": "$.cache_read_input_tokens"},
                        "cache_creation_tokens": {"path": "$.cache_creation_input_tokens"},
                    },
                },
                {
                    "id": "tool_call",
                    "entity": "tool_call",
                    "select": "$",
                    "where": [{"path": "$.role", "op": "eq", "value": "tool_use"}],
                    "fields": {
                        "session_external_id": {"path": "$.session_id", "on_missing": "reject"},
                        "external_id": {"path": "$.tool_call_id"},
                        "sequence": {"path": "$.turn_number"},
                        "tool_name": {"path": "$.tool_name", "on_missing": "reject"},
                        "started_at": {"path": "$.timestamp.iso", "timestamp_format": "iso8601"},
                    },
                },
            ],
        }
        return {
            "mapping": mapping,
            "explanations": [
                _explain(
                    "model_call.started_at",
                    "$.timestamp.iso",
                    "Arrow timestamp (us, UTC) addressed by .iso",
                    0.9,
                ),
                _explain(
                    "tool_call.tool_name",
                    "$.tool_name",
                    "set on tool_use rows (role); tool_result rows are not calls",
                    0.85,
                ),
            ],
            "ambiguities": [
                {
                    "target": "model_call.token_semantics",
                    "options": ["unknown", "a validated swe-chat tag"],
                    "what_settles_it": "what the source counts as input tokens "
                    "(cache included or not)",
                }
            ],
            "questions": [],
        }

    def _epoch(
        self, head: dict[str, Any], current: dict[str, Any] | None, message: str
    ) -> dict[str, Any]:
        fmt = "epoch_ms"
        if current is not None:
            try:
                fmt = current["rules"][1]["fields"]["started_at"]["timestamp_format"]
            except (KeyError, IndexError, TypeError):
                fmt = "epoch_ms"
        if "epoch seconds" in message or "epoch_s" in message:
            fmt = "epoch_s"
        elif "epoch millis" in message or "epoch_ms" in message:
            fmt = "epoch_ms"
        mapping = {
            **head,
            "rules": [
                {
                    "id": "session",
                    "entity": "session",
                    "select": "$",
                    "fields": {"external_id": {"path": "$.session", "on_missing": "reject"}},
                },
                {
                    "id": "model_call",
                    "entity": "model_call",
                    "select": "$",
                    "fields": {
                        "session_external_id": {"path": "$.session", "on_missing": "reject"},
                        "external_id": {"path": "$.id"},
                        "started_at": {"path": "$.ts", "timestamp_format": fmt},
                    },
                },
            ],
        }
        ambiguities = []
        if "epoch" not in message:
            ambiguities.append(
                {
                    "target": "model_call.started_at",
                    "options": ["epoch_s", "epoch_ms"],
                    "what_settles_it": "the magnitude of ts: about 1.7e9 is seconds, "
                    "1.7e12 is milliseconds",
                }
            )
        return {
            "mapping": mapping,
            "explanations": [
                _explain("model_call.started_at", "$.ts", f"bare integer read as {fmt}", 0.6)
            ],
            "ambiguities": ambiguities,
            "questions": [],
        }

    def _generic(self, head: dict[str, Any], fields: list[dict[str, Any]]) -> dict[str, Any]:
        strings = [f for f in fields if f["types"].get("string") and f["depth"] == 1]
        chosen = next((f for f in strings if "session" in f["path"].lower()), None)
        chosen = chosen or next((f for f in strings if "identifier" in f["hints"]), None)
        chosen = chosen or (strings[0] if strings else None)
        path = chosen["path"] if chosen else "$.session_id"
        mapping = {
            **head,
            "rules": [
                {
                    "id": "session",
                    "entity": "session",
                    "select": "$",
                    "fields": {"external_id": {"path": path, "on_missing": "reject"}},
                }
            ],
        }
        return {
            "mapping": mapping,
            "explanations": [
                _explain("session.external_id", path, "best available string id", 0.3)
            ],
            "ambiguities": [],
            "questions": [
                "Which field identifies the session (session.external_id)?",
                "Which records are model calls, and which field is their session_external_id?",
                "Which field carries the tool name for tool calls (tool_call.tool_name)?",
            ],
        }


def _explain(target: str, path: str, why: str, confidence: float) -> dict[str, Any]:
    return {"target": target, "path": path, "why": why, "confidence": confidence}
