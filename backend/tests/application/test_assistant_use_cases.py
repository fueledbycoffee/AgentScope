"""ProfileFile, PrepareContext and RunAssistant over in-memory ports and a scripted adapter."""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from agentscope_app.application.dto import (
    AssistantReply,
    AssistantRequest,
    MappingIdentity,
    PreparedContext,
    RepairRequest,
    Turn,
)
from agentscope_app.application.errors import (
    AssistantError,
    AssistantFailedError,
    AssistantUnavailableError,
    ContextTooLargeError,
    InvalidInputError,
    NotFoundError,
    StaleContextError,
)
from agentscope_app.application.use_cases.assistant import (
    PROFILE_CACHE_VERSION,
    PrepareContext,
    ProfileFile,
    RunAssistant,
)
from agentscope_app.application.use_cases.uploads import StoreUpload
from agentscope_app.domain.jsonx import dumps_exact
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.infrastructure.llm.fake import FakeMappingAssistant
from tests.application.fakes import FakeClock, FakeIds, FakeReader, FakeStore, FakeUnitOfWork
from tests.application.test_import_use_cases import tracelab_row

BUNDLED = Path(__file__).resolve().parents[2] / "mappings"
IDENTITY = MappingIdentity("tracelab-assist", "tracelab")


def jsonl(rows: list[dict[str, Any]]) -> bytes:
    return gzip.compress("\n".join(json.dumps(r) for r in rows).encode())


class Harness:
    def __init__(self, script: list[str] | None = None) -> None:
        self.uow = FakeUnitOfWork()
        self.store = FakeStore()
        self.reader = FakeReader()
        self.store_upload = StoreUpload(
            self.uow.factory, self.store, self.reader, FakeClock(), FakeIds()
        )
        self.profile_file = ProfileFile(self.uow.factory, self.store, self.reader)
        self.prepare = PrepareContext(self.uow.factory, self.store, self.reader, self.profile_file)
        self.assistant = FakeMappingAssistant(BUNDLED, script or [])
        self.run = RunAssistant(self.prepare, self.assistant)

    def upload(self, rows: list[dict[str, Any]], name: str = "trace.jsonl.gz") -> str:
        return self.store_upload.execute(name, jsonl(rows)).upload_id

    def tracelab_upload(self) -> str:
        rows = [tracelab_row(f"s{i}", r, 2) for i in range(3) for r in range(2)]
        return self.upload(rows)

    def request(self, upload_id: str, **kw: Any) -> AssistantRequest:
        return AssistantRequest(
            kind=kw.pop("kind", "propose"), upload_id=upload_id, identity=IDENTITY, **kw
        )

    def go(self, request: AssistantRequest) -> Any:
        prepared = self.prepare.execute(request)
        return self.run.execute(request, prepared.sha256)


# --- ProfileFile ----------------------------------------------------------------------------


def test_profile_is_computed_once_and_cached_with_its_version() -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    first = h.profile_file.execute(upload_id)
    assert not first.cached and first.profile["inspected"] == 6
    assert first.profile["total_records"] == 6 and "records" not in first.profile["truncated"]
    second = h.profile_file.execute(upload_id)
    assert second.cached and second.profile == first.profile
    assert h.uow.uploads.profiles[upload_id].version == PROFILE_CACHE_VERSION


def test_profile_reports_records_beyond_the_inspected_window_exactly() -> None:
    h = Harness()
    h.profile_file = ProfileFile(h.uow.factory, h.store, h.reader, limits=_limits(records=2))
    upload_id = h.tracelab_upload()
    report = h.profile_file.execute(upload_id)
    assert report.profile["inspected"] == 2 and report.profile["truncated"]["records"] == 4


def test_profile_of_unknown_upload_is_not_found() -> None:
    with pytest.raises(NotFoundError):
        Harness().profile_file.execute("upl_nope")


def test_profile_skips_undecodable_records() -> None:
    h = Harness()
    data = gzip.compress(b'{"a": 1}\nnot json\n{"a": 2}\n')
    upload_id = h.store_upload.execute("x.jsonl.gz", data).upload_id
    profile = h.profile_file.execute(upload_id).profile
    assert profile["inspected"] == 2 and profile["total_records"] == 3


# --- PrepareContext -------------------------------------------------------------------------


def test_prepared_context_is_deterministic_profile_only_and_digested_over_its_text() -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    request = h.request(upload_id)
    a, b = h.prepare.execute(request), h.prepare.execute(request)
    assert a.text == b.text and a.sha256 == b.sha256
    assert a.sha256 == hashlib.sha256(a.text.encode("utf-8")).hexdigest()
    assert a.bytes == len(a.text.encode("utf-8"))
    assert not a.sample_included and a.sample_count == 0 and "sample" not in a.document
    assert a.document["sample_included"] is False
    assert a.document["identity"] == {"name": "tracelab-assist", "source": "tracelab"}
    assert a.document["upload"]["format"] == "jsonl"
    assert a.document["target"]["entities"]["session"]["fields"]["external_id"]["required"]
    assert "dsl_reference" in a.document["target"]
    assert dumps_exact(a.document, sort_keys=True) == a.text


def test_every_input_that_reaches_the_text_changes_the_digest() -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    base = h.prepare.execute(h.request(upload_id)).sha256
    other_name = h.prepare.execute(
        AssistantRequest("propose", upload_id, MappingIdentity("other", "tracelab"))
    ).sha256
    with_sample = h.prepare.execute(h.request(upload_id, include_sample=True)).sha256
    with_message = h.prepare.execute(h.request(upload_id, message="hello")).sha256
    with_history = h.prepare.execute(
        h.request(upload_id, history=(Turn("user", "hi"), Turn("assistant", "yes")))
    ).sha256
    other_upload = h.prepare.execute(h.request(h.upload([{"a": 1}]))).sha256
    assert len({base, other_name, with_sample, with_message, with_history, other_upload}) == 6


def test_sample_records_are_projected_sanitised_and_counted() -> None:
    h = Harness()
    rows = [
        {"session": "s1", "note": "mail sean@example.com", "big": list(range(100))},
        {"session": "s2", "extra": "/Users/sean/x"},
    ]
    upload_id = h.upload(rows)
    prepared = h.prepare.execute(h.request(upload_id, include_sample=True))
    assert prepared.sample_included and prepared.sample_count == 2
    sample = prepared.document["sample"]
    assert sample[0]["locator"] == "line:1"
    assert sample[0]["record"]["note"] == "mail <email>"
    assert (
        sample[0]["record"]["big"][-1] == "<80 more items>"
        and len(sample[0]["record"]["big"]) == 21
    )
    assert sample[1]["record"]["extra"] == "<path>"
    # once in the profile examples, once in the sample records
    assert prepared.redactions == {"email": 2, "path": 2}
    assert "sean@example.com" not in prepared.text and "/Users/sean" not in prepared.text


def test_message_history_and_current_mapping_are_sanitised_and_counted() -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    mapping = _tracelab_mapping()
    mapping["notes"] = "token sk-or-v1-abcdefghijklmnopqrstuvwxyz0123 lives here"
    request = h.request(
        upload_id,
        kind="revise",
        current_mapping=mapping,
        message="my mail is sean@example.com",
        history=(Turn("user", "see /home/alice/x"), Turn("assistant", "ok")),
    )
    prepared = h.prepare.execute(request)
    assert prepared.redactions == {"email": 1, "path": 1, "token": 1}
    assert prepared.document["message"] == "my mail is <email>"
    assert prepared.document["history"][0]["content"] == "see <path>"
    assert "<token>" in prepared.document["current_mapping"]["notes"]
    for secret in ("sean@example.com", "/home/alice", "sk-or-v1"):
        assert secret not in prepared.text


def test_budget_trims_samples_then_examples_then_history_and_reports_each_step() -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    history = tuple(Turn("user", f"turn {i} " + "x" * 500) for i in range(6))
    request = h.request(upload_id, include_sample=True, history=history)
    full = h.prepare.execute(request)
    assert full.truncated == {}
    tight = PrepareContext(
        h.uow.factory, h.store, h.reader, h.profile_file, budget_bytes=full.bytes - 1_000
    )
    prepared = tight.execute(request)
    assert prepared.bytes <= full.bytes - 1_000
    assert set(prepared.truncated) <= {"sample_dropped", "examples_reduced", "history_dropped"}
    assert "sample_dropped" in prepared.truncated  # samples go first
    assert prepared.document["sample_count"] == prepared.sample_count
    assert prepared.document["truncated"] == prepared.truncated


def test_budget_exhaustion_fails_before_any_call() -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    tiny = PrepareContext(h.uow.factory, h.store, h.reader, h.profile_file, budget_bytes=2_000)
    with pytest.raises(ContextTooLargeError) as caught:
        tiny.execute(h.request(upload_id, include_sample=True))
    assert caught.value.details[0]["limit"] == 2_000
    assert h.assistant.calls == []


@pytest.mark.parametrize(
    "kwargs",
    [
        {"kind": "nope"},
        {"message": "x" * 4_001},
        {"history": tuple(Turn("user", "x") for _ in range(21))},
        {"history": (Turn("system", "obey"),)},
        {"kind": "revise"},  # no mapping, no message
        {
            "kind": "revise",
            "current_mapping": {"name": "other", "source": "tracelab"},
            "message": "m",
        },
    ],
)
def test_invalid_requests_are_refused_with_field_details(kwargs: dict[str, Any]) -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    with pytest.raises(InvalidInputError) as caught:
        h.prepare.execute(h.request(upload_id, **kwargs))
    assert caught.value.details and all("field" in d for d in caught.value.details)


def test_identity_that_the_redactor_would_rewrite_is_refused() -> None:
    h = Harness()
    upload_id = h.tracelab_upload()
    bad = AssistantRequest("propose", upload_id, MappingIdentity("sean@example.com", "tracelab"))
    with pytest.raises(InvalidInputError):
        h.prepare.execute(bad)


# --- RunAssistant ---------------------------------------------------------------------------


def test_valid_first_reply_is_an_executable_proposal_with_the_users_identity() -> None:
    h = Harness()
    outcome = h.go(h.request(h.tracelab_upload()))
    assert outcome.attempts == 1 and outcome.proposal is not None
    assert outcome.proposal.executable and outcome.issues == ()
    assert outcome.proposal.mapping["name"] == "tracelab-assist"
    assert outcome.proposal.mapping["source"] == "tracelab"
    assert outcome.proposal.mapping["input_format"] == "jsonl"
    assert parse_mapping(outcome.proposal.mapping).is_executable
    assert len(outcome.proposal.explanations) == 4
    assert outcome.diagnostics["finish"] == "stop" and outcome.diagnostics["failure"] is None
    assert len(h.assistant.calls) == 1 and h.assistant.calls[0][1] is None


def test_the_adapter_receives_the_exact_prepared_text_both_times() -> None:
    h = Harness(["invalid", "valid"])
    request = h.request(h.tracelab_upload())
    prepared = h.prepare.execute(request)
    h.run.execute(request, prepared.sha256)
    assert [call[0].text for call in h.assistant.calls] == [prepared.text, prepared.text]
    repair = h.assistant.calls[1][1]
    assert isinstance(repair, RepairRequest)
    assert "wildcard_in_field_path" in repair.issues_text


def test_stale_digest_is_refused_without_calling_the_adapter() -> None:
    h = Harness()
    request = h.request(h.tracelab_upload())
    with pytest.raises(StaleContextError):
        h.run.execute(request, "0" * 64)
    assert h.assistant.calls == []


def test_invalid_then_valid_repairs_once() -> None:
    h = Harness(["invalid", "valid"])
    outcome = h.go(h.request(h.tracelab_upload()))
    assert outcome.attempts == 2 and outcome.proposal is not None and outcome.proposal.executable


def test_invalid_twice_returns_the_editable_draft_with_its_issues() -> None:
    h = Harness(["invalid", "invalid"])
    outcome = h.go(h.request(h.tracelab_upload()))
    assert outcome.attempts == 2 and outcome.proposal is not None
    assert not outcome.proposal.executable
    assert "wildcard_in_field_path" in {i["code"] for i in outcome.issues}
    assert len(h.assistant.calls) == 2


def test_refusal_is_terminal_with_no_candidate_and_no_repair() -> None:
    h = Harness(["refusal"])
    outcome = h.go(h.request(h.tracelab_upload()))
    assert outcome.attempts == 1 and outcome.proposal is None
    assert outcome.diagnostics["failure"] == "refusal"
    assert len(h.assistant.calls) == 1


@pytest.mark.parametrize(
    ("script", "kind"),
    [
        (["length", "length"], "truncated"),
        (["malformed", "malformed"], "malformed"),
        (["envelope", "envelope"], "malformed"),
        (["length", "malformed"], "malformed"),
    ],
)
def test_two_unusable_replies_fail_with_the_second_kind(script: list[str], kind: str) -> None:
    h = Harness(script)
    with pytest.raises(AssistantFailedError) as caught:
        h.go(h.request(h.tracelab_upload()))
    assert list(caught.value.details) == [{"kind": kind, "attempts": 2}]
    assert len(h.assistant.calls) == 2


def test_a_truncated_reply_that_still_parses_is_never_executable() -> None:
    class Truncating:
        def complete(
            self, prepared: PreparedContext, *, repair: RepairRequest | None = None
        ) -> AssistantReply:
            mapping = _tracelab_mapping()
            return AssistantReply(json.dumps({"mapping": mapping}), "m", "length")

    h = Harness()
    h.run = RunAssistant(h.prepare, Truncating())
    with pytest.raises(AssistantFailedError) as caught:
        h.go(h.request(h.tracelab_upload()))
    assert caught.value.details[0]["kind"] == "truncated"


def test_malformed_then_valid_recovers() -> None:
    h = Harness(["malformed", "valid"])
    outcome = h.go(h.request(h.tracelab_upload()))
    assert outcome.attempts == 2 and outcome.proposal is not None and outcome.proposal.executable


def test_adapter_errors_are_terminal_and_mapped() -> None:
    h = Harness(["timeout", "valid"])
    with pytest.raises(AssistantFailedError) as failed:
        h.go(h.request(h.tracelab_upload()))
    assert list(failed.value.details) == [{"kind": "timeout"}]
    assert len(h.assistant.calls) == 1  # no second call after a transport failure

    class Unavailable:
        def complete(
            self, prepared: PreparedContext, *, repair: RepairRequest | None = None
        ) -> AssistantReply:
            raise AssistantError("unavailable", "no adapter")

    h = Harness()
    h.run = RunAssistant(h.prepare, Unavailable())
    with pytest.raises(AssistantUnavailableError):
        h.go(h.request(h.tracelab_upload()))


def test_the_model_cannot_rename_retarget_or_change_the_format() -> None:
    class Renaming:
        def complete(
            self, prepared: PreparedContext, *, repair: RepairRequest | None = None
        ) -> AssistantReply:
            mapping = _tracelab_mapping()
            mapping.update(name="evil", source="elsewhere", input_format="parquet", dsl_version=2)
            return AssistantReply(json.dumps({"mapping": mapping}), "m", "stop")

    h = Harness()
    h.run = RunAssistant(h.prepare, Renaming())
    outcome = h.go(h.request(h.tracelab_upload()))
    assert outcome.proposal is not None
    assert outcome.proposal.mapping["name"] == "tracelab-assist"
    assert outcome.proposal.mapping["source"] == "tracelab"
    assert outcome.proposal.mapping["input_format"] == "jsonl"
    # the version is validated, not rewritten: a wrong one is a contract issue
    assert outcome.proposal.mapping["dsl_version"] == 2 and not outcome.proposal.executable
    assert any(i["path"].endswith("dsl_version") or "version" in i["code"] for i in outcome.issues)


def test_repair_request_is_sanitised_and_bounded() -> None:
    class Leaky:
        def __init__(self) -> None:
            self.repairs: list[RepairRequest | None] = []

        def complete(
            self, prepared: PreparedContext, *, repair: RepairRequest | None = None
        ) -> AssistantReply:
            self.repairs.append(repair)
            if repair is None:
                text = (
                    '{"mapping": {"notes": "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123 '
                    + "x" * 40_000
                    + '"}}'
                )
                return AssistantReply(text, "m", "stop")
            return AssistantReply(json.dumps({"mapping": _tracelab_mapping()}), "m", "stop")

    h = Harness()
    leaky = Leaky()
    h.run = RunAssistant(h.prepare, leaky)
    outcome = h.go(h.request(h.tracelab_upload()))
    assert outcome.attempts == 2 and outcome.proposal is not None and outcome.proposal.executable
    repair = leaky.repairs[1]
    assert repair is not None
    # the whole oversized note leaves as a placeholder; the key inside it never does
    assert "sk-or-v1" not in repair.candidate_text and "<text 40040 chars>" in repair.candidate_text
    assert len(repair.candidate_text.encode()) <= 16 * 1024 + 40
    assert len(repair.issues_text.encode()) <= 4 * 1024 + 40
    assert "sk-or" not in repair.issues_text and "unsupported_version" in repair.issues_text


def test_run_writes_nothing_but_the_profile_cache() -> None:
    h = Harness(["invalid", "valid"])
    upload_id = h.tracelab_upload()
    before_mappings = dict(h.uow.mappings.items)
    h.go(h.request(upload_id))
    assert h.uow.mappings.items == before_mappings
    assert set(h.uow.uploads.profiles) == {upload_id}


def test_parse_valid_proposal_can_still_fail_preview() -> None:
    """Executable means the contract holds, not that the records fit: the wrong id path
    parses fine and would reject every record at preview time."""
    h = Harness()
    upload_id = h.upload([{"sid": "a", "x": 1}, {"sid": "b", "x": 2}])
    outcome = h.go(h.request(upload_id))
    assert outcome.proposal is not None and outcome.proposal.executable
    assert outcome.proposal.questions  # the generic draft asks what the session id is


# --- helpers --------------------------------------------------------------------------------


def _limits(**kw: Any) -> Any:
    from agentscope_app.domain.profile import ProfileLimits

    return ProfileLimits(**kw)


def _tracelab_mapping() -> dict[str, Any]:
    document = json.loads((BUNDLED / "tracelab-v1.json").read_text(encoding="utf-8"))
    document["name"], document["source"] = "tracelab-assist", "tracelab"
    return document


# --- regressions from the adversarial review of PR #37 ----------------------------------------


def test_samples_and_current_mapping_withhold_sensitive_keys_like_the_profile() -> None:
    h = Harness()
    upload_id = h.upload([{"session": "s1", "sean@example.com": {"secret": "private subtree"}}])
    prepared = h.prepare.execute(h.request(upload_id, include_sample=True))
    assert prepared.document["sample"][0]["record"] == {"session": "s1"}
    assert prepared.redactions == {"key_withheld": 1}
    assert "example.com" not in prepared.text and "private subtree" not in prepared.text
    mapping = _tracelab_mapping()
    mapping["rules"][0]["fields"]["/Users/sean/leak"] = {"literal": 1}
    revise = h.request(upload_id, kind="revise", current_mapping=mapping, message="m")
    prepared = h.prepare.execute(revise)
    assert "/Users/sean" not in prepared.text
    assert prepared.redactions["key_withheld"] == 1


def test_wrapper_metadata_from_a_jsonl_file_is_untrusted() -> None:
    h = Harness()
    row = {
        "x": {
            "_arrow": "timestamp",
            "value": 1,
            "iso": "2026-01-01",
            "unit": "ns",
            "tz": "sean@example.com",
        },
        "y": {"_arrow": "sean@example.com", "value": 1},
    }
    upload_id = h.upload([row])
    prepared = h.prepare.execute(h.request(upload_id))
    assert "example.com" not in prepared.text
    fields = {f["path"]: f for f in prepared.document["profile"]["fields"]}
    assert fields["$.x"]["wrapper"]["tz"] == {"<email>": 1}
    assert fields["$.y"]["types"] == {"object": 1}  # not a known wrapper kind: an ordinary object
    assert "$.y.value" in fields


def test_repair_issue_paths_and_raw_diagnostics_are_redacted() -> None:
    class Leaky:
        def __init__(self) -> None:
            self.repairs: list[RepairRequest | None] = []

        def complete(
            self, prepared: PreparedContext, *, repair: RepairRequest | None = None
        ) -> AssistantReply:
            self.repairs.append(repair)
            if repair is None:
                return AssistantReply('{"mapping": {"sean@example.com": 1}}', "m", "stop")
            return AssistantReply(
                "Cannot process sk-or-v1-abcdefghijklmnopqrstuvwxyz0123", "m", "refusal"
            )

    h = Harness()
    leaky = Leaky()
    h.run = RunAssistant(h.prepare, leaky)
    outcome = h.go(h.request(h.tracelab_upload()))
    repair = leaky.repairs[1]
    assert repair is not None and "example.com" not in repair.issues_text
    assert "sk-or-v1" not in outcome.diagnostics["raw_text"]
    assert "<token>" in outcome.diagnostics["raw_text"]


def test_adapter_error_messages_are_redacted_before_they_become_http_details() -> None:
    class Loud:
        def complete(
            self, prepared: PreparedContext, *, repair: RepairRequest | None = None
        ) -> AssistantReply:
            raise AssistantError(
                "provider", "401 from https://u:p@host with key sk-or-v1-" + "a" * 30
            )

    h = Harness()
    h.run = RunAssistant(h.prepare, Loud())
    with pytest.raises(AssistantFailedError) as caught:
        h.go(h.request(h.tracelab_upload()))
    assert "u:p@" not in caught.value.message and "sk-or-v1" not in caught.value.message


def test_a_malformed_line_does_not_shift_the_sample_onto_the_wrong_record() -> None:
    h = Harness()
    data = gzip.compress(b'not json\n{"session": "s1", "unique_field": 123}\n')
    upload_id = h.store_upload.execute("x.jsonl.gz", data).upload_id
    profile = h.profile_file.execute(upload_id).profile
    assert profile["coverage_sample"] == [1]  # reader position, not position among decodable rows
    prepared = h.prepare.execute(h.request(upload_id, include_sample=True))
    assert prepared.sample_count == 1
    assert prepared.document["sample"][0] == {
        "locator": "line:2",
        "record": {"session": "s1", "unique_field": 123},
    }


def test_redaction_counts_include_profile_examples_and_the_filename() -> None:
    h = Harness()
    upload_id = h.upload(
        [{"session": "s1", "email": "sean@example.com"}], name="/Users/sean/t.jsonl.gz"
    )
    prepared = h.prepare.execute(h.request(upload_id))
    assert prepared.redactions == {"email": 1, "path": 1}
    assert prepared.document["profile"]["redactions"] == {"email": 1}
    assert prepared.document["upload"]["filename"] == "<path>"


def test_structured_credentials_never_reach_the_prepared_text() -> None:
    h = Harness()
    upload_id = h.upload([{"session": "s1", "password": "hunter22", "api_key": "abcdef123456"}])
    prepared = h.prepare.execute(h.request(upload_id, include_sample=True))
    assert "hunter22" not in prepared.text and "abcdef123456" not in prepared.text
    assert prepared.redactions["token"] >= 2
    assert prepared.document["sample"][0]["record"]["password"] == "<token>"


def test_parseable_replies_are_sanitised_structurally_before_repair_and_diagnostics() -> None:
    class Escaped:
        def __init__(self) -> None:
            self.repairs: list[RepairRequest | None] = []

        def complete(
            self, prepared: PreparedContext, *, repair: RepairRequest | None = None
        ) -> AssistantReply:
            self.repairs.append(repair)
            if repair is None:
                mapping = {"notes": "C:\\Users\\Alice\\private.txt", "api_key": "abc"}
                return AssistantReply(json.dumps({"mapping": mapping}), "m", "stop")
            return AssistantReply(json.dumps({"mapping": _tracelab_mapping()}), "m", "stop")

    h = Harness()
    adapter = Escaped()
    h.run = RunAssistant(h.prepare, adapter)
    outcome = h.go(h.request(h.tracelab_upload()))
    repair = adapter.repairs[1]
    assert repair is not None
    assert "Alice" not in repair.candidate_text and "<path>" in repair.candidate_text
    assert '"api_key":"<token>"' in repair.candidate_text
    assert "Alice" not in outcome.diagnostics["raw_text"]
