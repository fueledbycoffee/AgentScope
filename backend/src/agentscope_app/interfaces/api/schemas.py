"""Request bodies. Responses are the application DTOs (dataclasses) serialised by FastAPI."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from agentscope_app.application.dto import (
    MAX_HISTORY_TURNS,
    MAX_MESSAGE_CHARS,
    AssistantRequest,
    MappingIdentity,
    Turn,
)


class PreviewRequest(BaseModel):
    upload_id: str
    mapping_id: str
    sample: int = Field(default=200, ge=1, le=1000)


class FileBindingBody(BaseModel):
    upload_id: str
    mapping_id: str


class ImportRequest(BaseModel):
    """Either one file (``upload_id`` + ``mapping_id``) or a ``files`` batch."""

    source: str = Field(min_length=1, max_length=100)
    upload_id: str | None = None
    mapping_id: str | None = None
    files: list[FileBindingBody] | None = Field(default=None, min_length=1, max_length=20)

    @model_validator(mode="after")
    def _one_form(self) -> ImportRequest:
        single = self.upload_id is not None or self.mapping_id is not None
        if self.files is not None and single:
            raise ValueError("give either upload_id and mapping_id, or files, not both")
        if self.files is None and (self.upload_id is None or self.mapping_id is None):
            raise ValueError("upload_id and mapping_id are required without files")
        return self

    def bindings(self) -> list[FileBindingBody]:
        if self.files is not None:
            return list(self.files)
        assert self.upload_id is not None and self.mapping_id is not None
        return [FileBindingBody(upload_id=self.upload_id, mapping_id=self.mapping_id)]


class TurnBody(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)


class IdentityBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    source: str = Field(min_length=1, max_length=100)


class AssistantRequestBody(BaseModel):
    """``POST /api/assistant/prepare``; the use case validates the rest (identity, revise)."""

    kind: Literal["propose", "revise"]
    upload_id: str
    identity: IdentityBody
    include_sample: bool = False
    current_mapping: dict[str, Any] | None = None
    message: str | None = Field(default=None, max_length=MAX_MESSAGE_CHARS)
    history: list[TurnBody] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)

    def to_request(self) -> AssistantRequest:
        return AssistantRequest(
            kind=self.kind,
            upload_id=self.upload_id,
            identity=MappingIdentity(self.identity.name, self.identity.source),
            include_sample=self.include_sample,
            current_mapping=self.current_mapping,
            message=self.message,
            history=tuple(Turn(t.role, t.content) for t in self.history),
        )


class AssistantRunBody(AssistantRequestBody):
    """``POST /api/assistant/run``: the same request plus the digest of the prepared text."""

    context_sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


class SaveMappingBody(BaseModel):
    document: dict[str, Any]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[object] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorBody
