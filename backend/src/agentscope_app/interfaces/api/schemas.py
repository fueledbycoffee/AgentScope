"""Request bodies. Responses are the application DTOs (dataclasses) serialised by FastAPI."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PreviewRequest(BaseModel):
    upload_id: str
    mapping_id: str
    sample: int = Field(default=200, ge=1, le=1000)


class ImportRequest(BaseModel):
    upload_id: str
    mapping_id: str
    source: str = Field(min_length=1, max_length=100)


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[object] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorBody
