#!/usr/bin/env python3
"""Live smoke of the mapping assistant against the configured endpoint (not run in CI).

Runs profile → prepare → run over the TraceLab fixture through the real use
cases and the configured adapter (``backend/.env``), and prints what came back:
model, attempts, whether the proposal is executable, issue codes, ambiguities
and questions. Nothing is stored; the prepared context is what the API would
show, so nothing beyond it leaves the machine. Optionally saves the raw
chat-completions body (headers and key stripped) as a test recording.

Run with ``uv --directory backend run python ../scripts/llm_smoke.py [--save-recording NAME]``.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "tracelab" / "tracelab-sample.jsonl.gz"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--file", type=Path, default=FIXTURE)
    parser.add_argument("--name", default="assisted")
    parser.add_argument("--source", default="tracelab")
    parser.add_argument("--include-sample", action="store_true")
    parser.add_argument("--save-recording", metavar="NAME", default=None)
    args = parser.parse_args(argv)

    try:
        import httpx2

        from agentscope_app.application.dto import AssistantRequest, MappingIdentity
        from agentscope_app.application.errors import ApplicationError
        from agentscope_app.infrastructure.settings import Settings
        from agentscope_app.interfaces.api.container import build_container
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "run inside the backend environment (uv --directory backend run ...)"
        ) from exc

    tmp = Path(tempfile.mkdtemp(prefix="agentscope-llm-smoke-"))
    settings = Settings(database_url=f"sqlite:///{tmp / 'db.sqlite3'}", raw_file_dir=tmp / "raw")
    print(f"provider={settings.llm_provider} base_url={settings.llm_base_url}")
    print(f"model={settings.llm_model}")
    container = build_container(settings)

    captured: list[dict] = []
    adapter = container.run_assistant._assistant  # noqa: SLF001 - diagnostics hook
    client = getattr(adapter, "_client", None)
    if isinstance(client, httpx2.Client):

        def record(response: httpx2.Response) -> None:
            response.read()
            try:
                captured.append(response.json())
            except ValueError:
                captured.append({"raw": response.text[:2000]})

        client.event_hooks["response"].append(record)

    info = container.store_upload.execute(args.file.name, args.file.read_bytes())
    request = AssistantRequest(
        "propose",
        info.upload_id,
        MappingIdentity(args.name, args.source),
        include_sample=args.include_sample,
    )
    prepared = container.prepare_context.execute(request)
    print(f"prepared {prepared.bytes} bytes sha256={prepared.sha256[:12]}")
    print(f"redactions={prepared.redactions} truncated={prepared.truncated}")
    started = time.perf_counter()
    try:
        outcome = container.run_assistant.execute(request, prepared.sha256)
    except ApplicationError as exc:
        print(f"FAILED after {time.perf_counter() - started:.1f}s: {exc.code}: {exc.message}")
        print(f"details={list(exc.details)}")
        return 1
    elapsed = time.perf_counter() - started
    proposal = outcome.proposal
    diagnostics = outcome.diagnostics
    print(f"done in {elapsed:.1f}s attempts={outcome.attempts} finish={diagnostics['finish']}")
    print(f"model={diagnostics['model']}")
    if proposal is None:
        print(f"no proposal: failure={outcome.diagnostics['failure']}")
    else:
        rules = [r.get("entity") for r in proposal.mapping.get("rules", [])]
        print(f"executable={proposal.executable} rules={rules}")
        print(f"issues={sorted({i['code'] for i in outcome.issues})}")
        ambiguities = [a.target for a in proposal.ambiguities]
        print(f"explanations={len(proposal.explanations)} ambiguities={ambiguities}")
        print(f"questions={list(proposal.questions)}")
    if args.save_recording and captured:
        target = ROOT / "backend" / "tests" / "llm_recordings" / f"{args.save_recording}.json"
        body = captured[-1]
        target.write_text(json.dumps(body, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"saved body of the last response to {target.relative_to(ROOT)}")
    return 0 if proposal is not None and proposal.executable else 2


if __name__ == "__main__":
    sys.exit(main())
