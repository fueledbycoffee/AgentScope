"""Engine factory (SQLite foreign keys on every connection) and migration runner."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event

ALEMBIC_DIR = Path(__file__).resolve().parent / "alembic"


def create_engine_for(url: str) -> Engine:
    engine = create_engine(url, future=True)
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def alembic_config(engine: Engine | None = None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    if engine is not None:
        config.set_main_option("sqlalchemy.url", str(engine.url).replace("%", "%%"))
    return config


def run_migrations(engine: Engine) -> None:
    """Upgrade the database bound to ``engine`` to the latest revision. Idempotent."""
    config = alembic_config(engine)
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
