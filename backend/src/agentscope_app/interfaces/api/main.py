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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

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


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
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

    web_dist = Path(__file__).resolve().parents[5] / "web" / "dist"
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    return app


app = create_app()
