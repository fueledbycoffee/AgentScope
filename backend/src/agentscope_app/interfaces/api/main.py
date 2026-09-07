"""FastAPI application factory and composition root.

Adapters are wired here from configuration; nothing below the interfaces layer
imports FastAPI.
"""

from fastapi import FastAPI

from agentscope_app import __version__


def create_app() -> FastAPI:
    app = FastAPI(title="AgentScope", version=__version__)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
