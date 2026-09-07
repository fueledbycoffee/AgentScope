"""Source-occurrence identity: the only identity the import guarantees."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceOccurrence:
    """Where an emitted entity came from.

    ``file_sha256`` identifies the immutable uploaded bytes, ``locator`` the
    record inside the file (``line:N`` for JSONL, ``row:N`` for Parquet) and
    ``emission_path`` the rule and item index that produced the entity
    (``model_call`` or ``tool_call[3]``). Re-importing the same bytes yields
    the same keys, which is what makes exact-file re-import idempotent.
    """

    file_sha256: str
    locator: str
    emission_path: str

    @property
    def key(self) -> str:
        return f"{self.file_sha256}:{self.locator}:{self.emission_path}"
