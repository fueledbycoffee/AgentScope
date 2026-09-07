"""Assistant persistence: profile cache on SQLite, mapping saves, hash compatibility, migration."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Barrier, Thread
from typing import Any

import pytest
from alembic import command
from sqlalchemy import inspect, text

from agentscope_app.application.dto import CachedProfile
from agentscope_app.application.errors import InvalidInputError
from agentscope_app.application.use_cases.assistant import PROFILE_CACHE_VERSION, ProfileFile
from agentscope_app.application.use_cases.mappings import SaveMappingRevision
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.domain.jsonx import content_hash
from agentscope_app.infrastructure.db.engine import (
    alembic_config,
    create_engine_for,
    run_migrations,
)
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from agentscope_app.infrastructure.files.raw_store import FilesystemRawFileStore
from agentscope_app.infrastructure.ids import UtcClock, UuidIdGenerator
from agentscope_app.infrastructure.mappings.bundled import load_bundled_mappings
from agentscope_app.infrastructure.readers.router import FormatRouter

BACKEND = Path(__file__).resolve().parents[2]
FIXTURE = BACKEND.parent / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"
# The id the loader has always given the bundled document: sha256 of its legacy canonical
# JSON (sorted keys, compact). Moving content_hash into the domain must not change it, or
# every existing database would gain a second revision of tracelab-v1 on the next start.
BUNDLED_TRACELAB_HASH = "82934058a2f6af1cbfc616db9597dee748c251613663804a23f605a5c54f0a49"


@pytest.fixture
def env(tmp_path: Path) -> dict[str, Any]:
    engine = create_engine_for(f"sqlite:///{tmp_path / 'db.sqlite3'}")
    run_migrations(engine)
    uow_factory = make_uow_factory(engine)
    store = FilesystemRawFileStore(tmp_path / "raw")
    reader = FormatRouter()
    upload = StoreUpload(uow_factory, store, reader, UtcClock(), UuidIdGenerator())
    return {
        "engine": engine,
        "uow": uow_factory,
        "store": store,
        "reader": reader,
        "upload": upload,
        "profile": ProfileFile(uow_factory, store, reader),
        "save": SaveMappingRevision(uow_factory, UtcClock()),
        "tmp": tmp_path,
    }


def test_bundled_hash_is_unchanged_by_the_codec_move(env: dict[str, Any]) -> None:
    document = json.loads((BACKEND / "mappings" / "tracelab-v1.json").read_text())
    assert content_hash(document) == BUNDLED_TRACELAB_HASH
    added = load_bundled_mappings(env["uow"], BACKEND / "mappings", UtcClock())
    assert [m.id for m in added] == [f"map_{BUNDLED_TRACELAB_HASH[:20]}"]
    # a database seeded by the legacy loader is recognised: nothing is re-added
    assert load_bundled_mappings(env["uow"], BACKEND / "mappings", UtcClock()) == []
    with env["uow"]() as uow:
        assert [m.revision for m in uow.mappings.list()] == [1]


def test_profile_cache_survives_a_new_container_and_recomputes_on_version_change(
    env: dict[str, Any],
) -> None:
    info = env["upload"].execute("tracelab.jsonl.gz", FIXTURE.read_bytes())
    first = env["profile"].execute(info.upload_id)
    assert not first.cached and first.profile["inspected"] == 2_000
    # a second ProfileFile over a fresh unit-of-work factory on the same database
    again = ProfileFile(make_uow_factory(env["engine"]), env["store"], env["reader"])
    second = again.execute(info.upload_id)
    assert second.cached and second.profile == first.profile
    with env["engine"].begin() as c:
        row = c.execute(text("SELECT profile_version FROM uploads")).one()
    assert row[0] == PROFILE_CACHE_VERSION
    # an older cache version is recomputed, not trusted
    with env["uow"]() as uow:
        uow.uploads.set_profile(
            info.upload_id, CachedProfile(PROFILE_CACHE_VERSION - 1, {"old": 1})
        )
        uow.commit()
    third = env["profile"].execute(info.upload_id)
    assert not third.cached and third.profile == first.profile


def test_profile_writes_only_the_cache_columns(env: dict[str, Any]) -> None:
    info = env["upload"].execute("tracelab.jsonl.gz", FIXTURE.read_bytes())

    def snapshot() -> dict[str, Any]:
        with env["engine"].begin() as c:
            counts = {
                t: c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                for t in ("uploads", "mappings", "imports", "raw_records", "sessions")
            }
            upload = c.execute(
                text("SELECT id, sha256, filename, record_count, preview FROM uploads")
            ).one()
        return {"counts": counts, "upload": tuple(upload)}

    before = snapshot()
    env["profile"].execute(info.upload_id)
    assert snapshot() == before  # every column except the two cache columns is untouched


def test_save_is_idempotent_creates_revisions_and_refuses_invalid_documents(
    env: dict[str, Any],
) -> None:
    document = json.loads((BACKEND / "mappings" / "tracelab-v1.json").read_text())
    document["name"] = "mine"
    first = env["save"].execute(document, created_by="user")
    assert first.created and first.record.revision == 1 and first.record.created_by == "user"
    again = env["save"].execute(dict(document), created_by="user")
    assert not again.created and again.record.id == first.record.id
    document["notes"] = "edited"
    edited = env["save"].execute(document, created_by="user")
    assert edited.created and edited.record.revision == 2 and edited.record.id != first.record.id
    with pytest.raises(InvalidInputError) as caught:
        env["save"].execute({"dsl_version": 1}, created_by="user")
    assert caught.value.details
    with env["uow"]() as uow:
        assert [(m.name, m.revision) for m in uow.mappings.list()] == [("mine", 1), ("mine", 2)]


def test_concurrent_saves_yield_unique_immutable_revisions(env: dict[str, Any]) -> None:
    base = json.loads((BACKEND / "mappings" / "tracelab-v1.json").read_text())
    base["name"] = "race"
    same = [dict(base) for _ in range(4)]
    distinct = [{**base, "notes": f"edit {i}"} for i in range(4)]
    for documents in (same, distinct):
        results, errors = _save_concurrently(env["save"], documents)
        assert not errors, errors
        assert len(results) == len(documents)
    with env["uow"]() as uow:
        rows = [m for m in uow.mappings.list() if m.name == "race"]
    assert len(rows) == 5  # one shared document + four distinct edits
    assert sorted(m.revision for m in rows) == [1, 2, 3, 4, 5]
    assert len({m.content_hash for m in rows}) == 5


def _save_concurrently(
    save: SaveMappingRevision, documents: list[dict[str, Any]]
) -> tuple[list[Any], list[BaseException]]:
    barrier = Barrier(len(documents))
    results: list[Any] = []
    errors: list[BaseException] = []

    def worker(doc: dict[str, Any]) -> None:
        try:
            barrier.wait(timeout=10)
            results.append(save.execute(doc, created_by="user"))
        except BaseException as exc:  # noqa: BLE001 - collected and asserted by the caller
            errors.append(exc)

    threads = [Thread(target=worker, args=(d,)) for d in documents]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return results, errors


def test_migration_0004_adds_nullable_cache_columns_to_a_populated_database(
    tmp_path: Path,
) -> None:
    engine = create_engine_for(f"sqlite:///{tmp_path / 'old.sqlite3'}")
    config = alembic_config(engine)
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0003")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO raw_files (sha256, size_bytes, storage_key, created_at) "
                "VALUES (:s, 1, '', '2026-09-07 10:00:00.000000')"
            ),
            {"s": "a" * 64},
        )
        c.execute(
            text(
                "INSERT INTO uploads (id, sha256, filename, format, record_count, preview, "
                "created_at) VALUES ('upl_1', :s, 'f.jsonl', 'jsonl', 1, '[]', "
                "'2026-09-07 10:00:00.000000')"
            ),
            {"s": "a" * 64},
        )
    run_migrations(engine)
    columns = {c["name"]: c for c in inspect(engine).get_columns("uploads")}
    assert columns["profile"]["nullable"] and columns["profile_version"]["nullable"]
    with engine.begin() as c:
        row = c.execute(text("SELECT profile, profile_version FROM uploads")).one()
    assert tuple(row) == (None, None)
    with make_uow_factory(engine)() as uow:
        assert uow.uploads.get_profile("upl_1") is None
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0003")
    assert "profile" not in {c["name"] for c in inspect(engine).get_columns("uploads")}
