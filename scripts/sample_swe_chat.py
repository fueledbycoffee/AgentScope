#!/usr/bin/env python3
"""Build a bounded SWE-chat excerpt of whole sessions, stratified by agent.

Reads ``sessions.parquet`` and ``conversations.parquet`` (downloaded under
``data/raw/swe-chat/`` per docs/datasets/README.md), selects whole sessions
deterministically (seeded hash of ``session_id``, round-robin across agents),
and writes both tables plus ``manifest.json`` under ``data/samples/swe-chat/``.

Limits are validated on the closed outputs: each file at most 25 MiB, and the
two tables' rows together at most 100,000 (the product's per-attempt limit),
so the pair imports as one batch. If either bound is exceeded the lowest-ranked
whole session is dropped and both files are rewritten; a single session that
cannot fit is an explicit failure. Nothing under data/ is committed.

Requires pyarrow (run with ``uv --directory backend run python ../scripts/sample_swe_chat.py``).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TOTAL_ROWS = 100_000
DEFAULT_SEED = "agentscope-swe-chat-v1"


def rank_key(session_id: str, seed: str) -> str:
    return hashlib.sha256(f"{seed}:{session_id}".encode()).hexdigest()


def select_sessions(sessions: list[dict], *, seed: str, per_agent: int | None) -> list[dict]:
    """Deterministic round-robin over agents, each agent's sessions ordered by seeded hash."""
    by_agent: dict[str, list[dict]] = defaultdict(list)
    for row in sessions:
        by_agent[str(row.get("agent"))].append(row)
    queues = {
        agent: sorted(rows, key=lambda r: rank_key(str(r["session_id"]), seed))
        for agent, rows in sorted(by_agent.items())
    }
    if per_agent is not None:
        queues = {a: rows[:per_agent] for a, rows in queues.items()}
    picked: list[dict] = []
    while any(queues.values()):
        for agent in sorted(queues):
            if queues[agent]:
                picked.append(queues[agent].pop(0))
    return picked


def file_digest(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def write_outputs(
    selected: list[dict],
    conversations_path: Path,
    out_dir: Path,
    *,
    batch_rows: int = 65_536,
) -> tuple[Path, Path, int, int]:
    """Write both tables for ``selected`` sessions; conversations are streamed by batch."""
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    out_dir.mkdir(parents=True, exist_ok=True)
    ids = pa.array([str(r["session_id"]) for r in selected], pa.string())
    sessions_out = out_dir / "sessions.parquet"
    conversations_out = out_dir / "conversations.parquet"
    pq.write_table(pa.Table.from_pylist(selected), sessions_out)
    source = pq.ParquetFile(conversations_path)
    writer = None
    rows = 0
    try:
        for batch in source.iter_batches(batch_size=batch_rows):
            mask = pc.is_in(batch.column("session_id").cast(pa.string()), value_set=ids)
            kept = batch.filter(mask)
            if writer is None:
                writer = pq.ParquetWriter(conversations_out, kept.schema)
            if kept.num_rows:
                writer.write_batch(kept)
                rows += kept.num_rows
    finally:
        if writer is not None:
            writer.close()
    if writer is None:  # empty source: still produce a valid file
        pq.write_table(source.schema_arrow.empty_table(), conversations_out)
    return sessions_out, conversations_out, len(selected), rows


def within_limits(
    sessions_out: Path, conversations_out: Path, session_rows: int, conv_rows: int
) -> bool:
    return (
        sessions_out.stat().st_size <= MAX_FILE_BYTES
        and conversations_out.stat().st_size <= MAX_FILE_BYTES
        and session_rows + conv_rows <= MAX_TOTAL_ROWS
    )


def offending_sessions(conversations_out: Path, sessions_out: Path) -> set[str]:
    """Sessions whose rows the product's reader would refuse or turn into record errors.

    The closed outputs are read exactly as an import would read them, so a row
    over the per-record limit (or a schema the reader refuses) is caught here,
    not after the excerpt has been published.
    """
    import pyarrow.parquet as pq

    try:
        from agentscope_app.application.errors import ApplicationError
        from agentscope_app.infrastructure.readers.parquet import ParquetRecordReader
    except ImportError as exc:  # pragma: no cover - the backend environment provides it
        raise SystemExit(
            "run inside the backend environment (uv --directory backend run ...)"
        ) from exc
    reader = ParquetRecordReader()
    bad: set[str] = set()
    for path in (conversations_out, sessions_out):
        ids = pq.read_table(path, columns=["session_id"]).column("session_id").to_pylist()
        with path.open("rb") as stream:
            try:
                for record in reader.read(stream, "parquet"):
                    if record.error is not None:
                        bad.add(str(ids[int(record.locator.split(":")[1])]))
            except ApplicationError as exc:
                raise SystemExit(f"{path.name} is not importable as written: {exc}") from exc
    return bad


def build_excerpt(
    sessions_path: Path,
    conversations_path: Path,
    out_dir: Path,
    *,
    seed: str = DEFAULT_SEED,
    per_agent: int | None = None,
) -> dict:
    import pyarrow.parquet as pq

    sessions = pq.read_table(sessions_path).to_pylist()
    selected = select_sessions(sessions, seed=seed, per_agent=per_agent)
    if not selected:
        raise SystemExit("no sessions to select")
    while True:
        s_out, c_out, s_rows, c_rows = write_outputs(selected, conversations_path, out_dir)
        if within_limits(s_out, c_out, s_rows, c_rows):
            bad = offending_sessions(c_out, s_out)
            if not bad:
                break
            # a row the reader would refuse: its whole session leaves the excerpt
            selected = [r for r in selected if str(r["session_id"]) not in bad]
            if not selected:
                raise SystemExit(
                    f"every candidate session has rows the reader refuses: {sorted(bad)}"
                )
            continue
        if len(selected) == 1:
            raise SystemExit(
                f"a single session ({selected[0]['session_id']}) exceeds the limits: "
                f"{c_rows} conversation rows, {c_out.stat().st_size} bytes"
            )
        selected.pop()  # the lowest-ranked whole session goes; never split a session
    per_agent_counts: dict[str, int] = defaultdict(int)
    for row in selected:
        per_agent_counts[str(row.get("agent"))] += 1
    s_hash, s_size = file_digest(s_out)
    c_hash, c_size = file_digest(c_out)
    upstream = {
        p.name: dict(zip(("sha256", "bytes"), file_digest(p), strict=True))
        for p in (sessions_path, conversations_path)
    }
    manifest = {
        "built_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "seed": seed,
        "per_agent_cap": per_agent,
        "selection": "seeded sha256 rank per agent, round-robin, whole sessions only",
        "limits": {"max_file_bytes": MAX_FILE_BYTES, "max_total_rows": MAX_TOTAL_ROWS},
        "upstream": upstream,
        "outputs": {
            "sessions.parquet": {"rows": s_rows, "bytes": s_size, "sha256": s_hash},
            "conversations.parquet": {"rows": c_rows, "bytes": c_size, "sha256": c_hash},
        },
        "sessions_per_agent": dict(sorted(per_agent_counts.items())),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw/swe-chat"))
    parser.add_argument("--out-dir", type=Path, default=Path("data/samples/swe-chat"))
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--per-agent", type=int, default=None, help="cap sessions per agent")
    args = parser.parse_args(argv)
    manifest = build_excerpt(
        args.raw_dir / "sessions.parquet",
        args.raw_dir / "conversations.parquet",
        args.out_dir,
        seed=args.seed,
        per_agent=args.per_agent,
    )
    print(json.dumps(manifest["outputs"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
