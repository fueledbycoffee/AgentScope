"""Request bodies. Responses are the application DTOs (dataclasses) serialised by FastAPI."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


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


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[object] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorBody
