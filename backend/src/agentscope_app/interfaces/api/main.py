"""FastAPI application factory and composition root.

Adapters are wired here from configuration; nothing below the interfaces layer
imports FastAPI.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from agentscope_app import __version__
from agentscope_app.application.errors import (
    ApplicationError,
    ConflictError,
    InvalidInputError,
    LimitExceededError,
    NotFoundError,
)
from agentscope_app.infrastructure.settings import Settings
from agentscope_app.interfaces.api.container import Container, build_container
from agentscope_app.interfaces.api.routers import router

# Exact decimals from JSONL payloads are shown as strings so nothing is rounded on display.
ENCODERS_BY_TYPE[Decimal] = str

_STATUS = {
    NotFoundError: 404,
    InvalidInputError: 400,
    LimitExceededError: 413,
    ConflictError: 409,
    ApplicationError: 400,
}


class SpaFiles(StaticFiles):
    """The built web app: real files as they are, and ``index.html`` for every
    other extension-less path so client-side routes survive a reload or a
    shared link. ``/api`` never reaches here."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            is_api = path == "api" or path.startswith("api/")
            if exc.status_code == 404 and not is_api and "." not in path.rsplit("/", 1)[-1]:
                return await super().get_response("index.html", scope)
            raise


DEFAULT_WEB_DIST = Path(__file__).resolve().parents[5] / "web" / "dist"


def create_app(
    settings: Settings | None = None,
    container: Container | None = None,
    web_dist: Path | None = None,
) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.container = container or build_container(settings)
        yield

    app = FastAPI(title="AgentScope", version=__version__, lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(router)

    @app.exception_handler(ApplicationError)
    async def _application_error(request: Request, exc: ApplicationError) -> JSONResponse:
        status = next((s for t, s in _STATUS.items() if isinstance(exc, t)), 400)
        body: dict[str, Any] = {
            "error": {"code": exc.code, "message": exc.message, "details": list(exc.details)}
        }
        return JSONResponse(status_code=status, content=body)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Unknown API paths (and any other framework-level HTTP error) keep the envelope.
        code = "not_found" if exc.status_code == 404 else "http_error"
        body = {"error": {"code": code, "message": str(exc.detail), "details": []}}
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"path": ".".join(str(p) for p in e.get("loc", ())), "message": e.get("msg", "")}
            for e in exc.errors()
        ]
        body = {
            "error": {"code": "invalid_input", "message": "Invalid request", "details": details}
        }
        return JSONResponse(status_code=400, content=body)

    web_dist = DEFAULT_WEB_DIST if web_dist is None else web_dist
    if web_dist.is_dir():
        app.mount("/", SpaFiles(directory=web_dist, html=True), name="web")
    return app


app = create_app()
