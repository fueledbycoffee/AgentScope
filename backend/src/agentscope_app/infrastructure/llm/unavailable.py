"""The adapter wired when the configured provider has no implementation yet."""

from __future__ import annotations

from agentscope_app.application.dto import AssistantReply, PreparedContext, RepairRequest
from agentscope_app.application.errors import AssistantError


class UnavailableMappingAssistant:
    """Every other service keeps working; only assistant calls fail, explicitly (ADR-005)."""

    def __init__(self, provider: str, *, reason: str | None = None) -> None:
        self._provider = provider
        self._reason = reason

    def complete(
        self, prepared: PreparedContext, *, repair: RepairRequest | None = None
    ) -> AssistantReply:
        if self._reason is not None:
            raise AssistantError(
                "unavailable",
                f"The mapping assistant is not configured: {self._reason} "
                f"(provider {self._provider!r}); set it in backend/.env, or use "
                "AGENTSCOPE_LLM_PROVIDER=fake for the deterministic fake",
            )
        raise AssistantError(
            "unavailable",
            f"No mapping-assistant adapter is available for provider {self._provider!r}; "
            "use openai_compatible for any chat-completions endpoint, or fake for the "
            "deterministic fake",
        )
