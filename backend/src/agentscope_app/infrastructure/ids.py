"""Clock and identifier adapters."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime


class UtcClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class UuidIdGenerator:
    """Prefixed, URL-safe ids such as ``imp_3f9c…``; the prefix says what the id names."""

    def new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex[:20]}"
