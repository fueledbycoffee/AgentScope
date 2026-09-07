"""The adapter wired when the configured provider has no implementation yet."""

from __future__ import annotations

from agentscope_app.application.dto import AssistantReply, PreparedContext, RepairRequest
from agentscope_app.application.errors import AssistantError


class UnavailableMappingAssistant:
    """Every other service keeps working; only assistant calls fail, explicitly (ADR-005)."""

    def __init__(self, provider: str) -> None:
        self._provider = provider

    def complete(
        self, prepared: PreparedContext, *, repair: RepairRequest | None = None
    ) -> AssistantReply:
        raise AssistantError(
            "unavailable",
            f"No mapping-assistant adapter is available for provider {self._provider!r} "
            "(the OpenAI-compatible adapter is issue #14); set AGENTSCOPE_LLM_PROVIDER=fake "
            "for the deterministic fake",
        )
