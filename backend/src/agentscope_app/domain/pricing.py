"""Conservative component accounting against an explicit user-owned USD schedule."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from fractions import Fraction
from types import MappingProxyType


@dataclass(frozen=True)
class ModelRates:
    prompt: Fraction | None = None
    completion: Fraction | None = None
    cache_read: Fraction | None = None

    def __post_init__(self) -> None:
        for rate in (self.prompt, self.completion, self.cache_read):
            if rate is not None and (not isinstance(rate, Fraction) or rate < 0):
                raise ValueError("Rates must be exact nonnegative fractions")


@dataclass(frozen=True)
class PriceSchedule:
    version: str
    models: Mapping[str, ModelRates]
    currency: str = "USD"
    aliases: Mapping[str, str] = field(default_factory=dict)
    alias_version: str | None = None

    def __post_init__(self) -> None:
        if not self.version or self.currency != "USD":
            raise ValueError("A price schedule needs a version and USD currency")
        object.__setattr__(self, "models", MappingProxyType(dict(self.models)))
        if self.aliases and not self.alias_version:
            raise ValueError("Aliases require a version")
        for alias, target in self.aliases.items():
            if (
                not isinstance(alias, str)
                or not alias
                or not isinstance(target, str)
                or target not in self.models
                or alias in self.models
            ):
                raise ValueError("Aliases must map new IDs directly to existing schedule keys")
        object.__setattr__(self, "aliases", MappingProxyType(dict(self.aliases)))

    def resolve_model(self, model: str | None) -> str | None:
        """Exact schedule key first, then the reviewed source-agnostic allowlist."""
        if model in self.models:
            return model
        return self.aliases.get(model) if model is not None else None


@dataclass(frozen=True)
class TokenUsage:
    model: str | None
    semantics: str
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    cache_creation_tokens: int | None


@dataclass(frozen=True)
class PricedUsage:
    cost: Fraction | None
    priced_tokens: int
    total_tokens: int
    reason: str | None = None


def price_usage(usage: TokenUsage, schedule: PriceSchedule | None) -> PricedUsage:
    """Resolve reviewed aliases without inferring billing semantics or missing quantities."""
    input_total = usage.input_tokens
    read, creation = usage.cache_read_tokens, usage.cache_creation_tokens
    # Input/output are the disjoint observed denominator. If input is absent, only
    # separately known cache components can be counted; missing quantities stay missing.
    total = (input_total if input_total is not None else (read or 0) + (creation or 0)) + (
        usage.output_tokens or 0
    )
    model = schedule.resolve_model(usage.model) if schedule else None
    if schedule is not None and model is None:
        return PricedUsage(None, 0, total, "no rate for this model id")
    rates = schedule.models[model] if schedule is not None and model is not None else None
    if rates is None or usage.semantics not in {"tracelab-claude", "tracelab-codex"}:
        return PricedUsage(None, 0, total)
    components: list[tuple[int | None, Fraction | None]] = [(usage.output_tokens, rates.completion)]
    if usage.semantics == "tracelab-claude":
        # Cache read is independently priced only when it does not contradict the
        # recorded total. Prompt residual needs both cache counts, including known zero.
        consistent = input_total is None or (read or 0) + (creation or 0) <= input_total
        if consistent:
            components.append((read, rates.cache_read))
            if input_total is not None and read is not None and creation is not None:
                components.append((input_total - read - creation, rates.prompt))
    # Codex input includes raw-only prefix tokens whose billing status is unknown.
    # No canonical split exists, so all Codex input is conservatively unpriced.
    # Cache creation has no requested rate. Reasoning is not added to output again.
    priced = [
        (tokens, rate) for tokens, rate in components if tokens is not None and rate is not None
    ]
    return PricedUsage(
        sum((tokens * rate for tokens, rate in priced), Fraction(0)) if priced else None,
        sum(tokens for tokens, _ in priced),
        total,
    )
