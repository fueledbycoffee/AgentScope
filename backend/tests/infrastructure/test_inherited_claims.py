"""Executable mapping revisions must isolate inherited native-key extraction."""

import json
from copy import deepcopy
from dataclasses import replace

import pytest

from agentscope_app.domain.claims import prepare_claims
from agentscope_app.domain.mapping.interpreter import apply_mapping
from agentscope_app.domain.mapping.parser import parse_mapping
from tests.infrastructure import test_multifile_import
from tests.infrastructure.test_cross_file_claims import commit_data
from tests.infrastructure.test_database import mapping_record
from tests.infrastructure.test_multifile_import import Env

env = test_multifile_import.env


@pytest.mark.parametrize(
    "change",
    [
        "path",
        "transforms",
        "default",
        "on_missing",
        "on_invalid",
        "empty_as_missing",
        "where",
        "rename",
        "non_key",
    ],
)
def test_inherited_native_key_dependencies_control_cross_file_matches(env: Env, change):
    original = mapping_record()
    document = original.document
    document["rules"] = [
        {
            "id": "session",
            "entity": "session",
            "select": "$",
            "fields": {"external_id": {"literal": "s"}, "agent": {"literal": "h"}},
        },
        {
            "id": "model",
            "entity": "model_call",
            "select": "$",
            "native_key": [],
            "fields": {"session_external_id": {"path": "$.old_session"}},
        },
        {
            "id": "tool",
            "entity": "tool_call",
            "select": "$.tools[*]",
            "parent": "model",
            "native_key": ["session_external_id", "external_id"],
            "fields": {
                "session_external_id": {"path": "$.missing"},
                "external_id": {"path": "$.id"},
                "tool_name": {"path": "$.name"},
            },
        },
    ]
    revised = deepcopy(document)
    parent = revised["rules"][1]
    field = parent["fields"]["session_external_id"]
    if change == "path":
        field["path"] = "$.new_session"
    elif change == "transforms":
        field["transforms"] = ["trim"]
    elif change == "default":
        field.update(on_missing="default", default="s")
    elif change == "on_missing":
        field["on_missing"] = "reject"
    elif change == "on_invalid":
        field["on_invalid"] = "null"
    elif change == "empty_as_missing":
        field["empty_as_missing"] = True
    elif change == "where":
        parent["where"] = [{"path": "$.new_session", "op": "exists"}]
    elif change == "rename":
        parent["id"] = "renamed_model"
        revised["rules"][2]["parent"] = "renamed_model"
    elif change == "non_key":
        parent["fields"]["provider"] = {"literal": "other"}

    scopes = []
    for n, doc in enumerate((document, revised)):
        parsed = parse_mapping(doc)
        assert parsed.is_executable, parsed.errors
        assert parsed.spec is not None
        row = {"old_session": "s", "new_session": "s", "tools": [{"id": "t", "name": f"tool{n}"}]}
        result = apply_mapping(parsed.spec, row, file_sha256=str(n), locator="line:1")
        assert not result.rejects
        tool = result.emissions[-1]
        assert tool.entity == "tool_call" and tool.fields["session_external_id"] == "s"
        assert tool.native_key == ("s", "t")
        claims = prepare_claims("src", result.emissions, {str(n): parsed.spec})
        scopes.append(claims.claims[-1].scope_text)
        mapping = replace(
            original,
            id=f"inherited{n}",
            name=f"inherited{n}",
            content_hash=f"inherited{n}",
            document=doc,
        )
        with env.uow_factory() as uow:
            uow.mappings.add(mapping)
            uow.commit()
        _, report = commit_data(env, json.dumps(row).encode() + b"\n", mapping=mapping.id)
        assert report.records["accepted"] == 1

    compatible = change in ("rename", "non_key")
    with env.uow_factory() as uow:
        diagnostics = uow.imports.diagnostics(report.import_id, None, None, None, 50, 0)
    tools = [d for d in diagnostics.items if d.entity == "tool_call"]
    assert [d.code for d in tools] == (["suspected_duplicate"] if compatible else [])
    assert (scopes[0] == scopes[1]) is compatible
