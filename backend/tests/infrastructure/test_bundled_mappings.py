import json
from pathlib import Path
from typing import Any

import pytest

from agentscope_app.application.errors import InvalidInputError
from agentscope_app.infrastructure.db.engine import create_engine_for, run_migrations
from agentscope_app.infrastructure.db.unit_of_work import make_uow_factory
from agentscope_app.infrastructure.ids import UtcClock
from agentscope_app.infrastructure.mappings.bundled import load_bundled_mappings
from agentscope_app.infrastructure.settings import Settings

BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture
def uow_factory(tmp_path: Path) -> Any:
    engine = create_engine_for(f"sqlite:///{tmp_path / 'db.sqlite3'}")
    run_migrations(engine)
    return make_uow_factory(engine)


def test_bundled_tracelab_mapping_loads_once(uow_factory: Any) -> None:
    added = load_bundled_mappings(uow_factory, BACKEND / "mappings", UtcClock())
    assert [(m.name, m.revision, m.created_by) for m in added] == [("tracelab-v1", 1, "bundled")]
    assert load_bundled_mappings(uow_factory, BACKEND / "mappings", UtcClock()) == []
    with uow_factory() as uow:
        assert len(uow.mappings.list()) == 1


def test_edited_bundled_document_becomes_a_new_revision(uow_factory: Any, tmp_path: Path) -> None:
    source = json.loads((BACKEND / "mappings" / "tracelab-v1.json").read_text())
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "a.json").write_text(json.dumps(source))
    load_bundled_mappings(uow_factory, bundle, UtcClock())
    source["notes"] = "edited"
    (bundle / "a.json").write_text(json.dumps(source))
    added = load_bundled_mappings(uow_factory, bundle, UtcClock())
    assert [(m.name, m.revision) for m in added] == [("tracelab-v1", 2)]


def test_invalid_bundled_mapping_is_refused_with_issues(uow_factory: Any, tmp_path: Path) -> None:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "bad.json").write_text(json.dumps({"dsl_version": 1}))
    with pytest.raises(InvalidInputError) as caught:
        load_bundled_mappings(uow_factory, bundle, UtcClock())
    assert caught.value.details


def test_settings_read_agentscope_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENTSCOPE_LLM_MODEL", "minimax/minimax-m3:free")
    monkeypatch.setenv("AGENTSCOPE_LLM_API_KEY", "secret")
    monkeypatch.setenv("AGENTSCOPE_DATABASE_URL", "sqlite:///x.sqlite3")
    settings = Settings(_env_file=None)
    assert settings.llm_model == "minimax/minimax-m3:free"
    assert settings.llm_api_key.get_secret_value() == "secret"
    assert "secret" not in repr(settings)
    assert settings.database_url == "sqlite:///x.sqlite3"
    assert (settings.bundled_mappings_dir / "tracelab-v1.json").exists()
