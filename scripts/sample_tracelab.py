#!/usr/bin/env python3
"""Download the pinned TraceLab release and extract whole provider-stratified sessions.

Python 3.9+, standard library only. Run from the repository root. Binary JSONL
lines are copied without reserialization; gzip timestamps and filenames are fixed.
"""

import argparse
import gzip
import hashlib
import json
import tempfile
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

URL = "https://github.com/uw-syfi/TraceLab/releases/download/v0.0.1/syfi_coding_trace.jsonl.gz"
# GitHub release asset digest and size, verified on 2026-09-07.
UPSTREAM_SHA256 = "9d265eae69a31cae203848bea936f018148eed7ca8bf56050c5abe96da0b4e6b"
UPSTREAM_BYTES = 53601226
PROVIDERS = ("claude", "codex")


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")  # noqa: UP017 - Python 3.9+


def file_digest(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, indent=2, sort_keys=True, ensure_ascii=False)
            stream.write("\n")
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(path)


def ensure_source(path):
    """Verify before reuse/publication; never bless a corrupt or changed cache."""
    receipt_path = path.with_name(path.name + ".retrieval.json")
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print("Downloading " + URL, flush=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            try:
                with urllib.request.urlopen(URL, timeout=120) as response:
                    for chunk in iter(lambda: response.read(1024 * 1024), b""):
                        stream.write(chunk)
                stream.flush()
                if file_digest(temporary) != (UPSTREAM_SHA256, UPSTREAM_BYTES):
                    raise ValueError("Downloaded release SHA-256/size mismatch")
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        temporary.replace(path)
        write_json(
            receipt_path,
            {
                "url": URL,
                "sha256": UPSTREAM_SHA256,
                "bytes": UPSTREAM_BYTES,
                "retrieved_at": utc_now(),
            },
        )
    digest, size = file_digest(path)
    if (digest, size) != (UPSTREAM_SHA256, UPSTREAM_BYTES):
        raise ValueError("Cached release SHA-256/size mismatch: " + str(path))
    retrieved_at = None
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if (receipt.get("sha256"), receipt.get("bytes"), receipt.get("url")) != (digest, size, URL):
            raise ValueError("Retrieval receipt does not match release")
        retrieved_at = receipt.get("retrieved_at")
    return {
        "url": URL,
        "version": "v0.0.1",
        "sha256": digest,
        "bytes": size,
        "retrieved_at": retrieved_at,
        "retrieval_note": (
            "Recorded after verified download"
            if retrieved_at
            else "Unknown: pre-existing cache has no retrieval receipt"
        ),
    }


def index_sessions(source):
    """Keep counts/metadata in memory, never the trace payloads.

    session_id is the grouping key requested for this excerpt, even when several
    project/session_file pairs claim it. Keep every pair and every occurrence.
    A session crossing providers is ambiguous and fails rather than being split.
    """
    sessions = {}
    rows = Counter()
    with gzip.open(source, "rb") as stream:
        for ordinal, line in enumerate(stream, 1):
            try:
                row = json.loads(line)
                session_id = row["session_id"]
                provider = row["provider"]
                project = row.get("project")
                session_file = row.get("session_file")
                if not isinstance(session_id, str) or not session_id:
                    raise ValueError("missing session identity")
                if provider not in PROVIDERS:
                    raise ValueError("unexpected provider")
                if any(x is not None and not isinstance(x, str) for x in (project, session_file)):
                    raise ValueError("invalid session metadata")
            except (ValueError, KeyError, TypeError) as exc:
                raise ValueError(f"Invalid source record at line {ordinal}") from exc
            info = sessions.setdefault(
                session_id, {"provider": provider, "row_count": 0, "source_files": set()}
            )
            if info["provider"] != provider:
                raise ValueError("Session identity crosses provider strata")
            info["row_count"] += 1
            info["source_files"].add(
                (project, session_file, "project" in row, "session_file" in row)
            )
            rows[provider] += 1
    return sessions, rows


def select_sessions(sessions, seed, count):
    """Stable SHA-256 ranking avoids PRNG implementation/version dependence."""
    selected = {}
    for provider in PROVIDERS:
        candidates = [sid for sid, info in sessions.items() if info["provider"] == provider]
        if len(candidates) < count:
            raise ValueError(
                f"Requested {count} {provider} sessions; only {len(candidates)} available"
            )

        def rank(sid, provider=provider):
            payload = json.dumps(
                [seed, provider, sid], ensure_ascii=True, separators=(",", ":")
            ).encode("utf-8")
            return hashlib.sha256(payload).digest(), sid

        selected[provider] = sorted(sorted(candidates, key=rank)[:count])
    return selected


def extract(source, output, selected, sessions):
    wanted = {sid for ids in selected.values() for sid in ids}
    counts = Counter()
    locators = {sid: [] for sid in wanted}
    uncompressed_bytes = 0
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as raw:
        temporary = Path(raw.name)
        try:
            with (
                gzip.GzipFile(
                    filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0
                ) as target,
                gzip.open(source, "rb") as stream,
            ):
                for ordinal, line in enumerate(stream, 1):
                    sid = json.loads(line)["session_id"]
                    if sid not in wanted:
                        continue
                    target.write(line)
                    uncompressed_bytes += len(line)
                    counts[sid] += 1
                    ranges = locators[sid]
                    if ranges and ranges[-1][1] == ordinal - 1:
                        ranges[-1][1] = ordinal
                    else:
                        ranges.append([ordinal, ordinal])
            if any(counts[sid] != sessions[sid]["row_count"] for sid in wanted):
                raise ValueError("Whole-session row counts changed during extraction")
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(output)
    return counts, locators, uncompressed_bytes


def sample(source, output, manifest_path, upstream, seed, count):
    if count < 1:
        raise ValueError("sessions-per-provider must be positive")
    if len({source.resolve(), output.resolve(), manifest_path.resolve()}) != 3:
        raise ValueError("Source, output and manifest must have distinct paths")
    print("Indexing whole sessions (first streaming pass)...", flush=True)
    sessions, source_rows = index_sessions(source)
    selected = select_sessions(sessions, seed, count)
    counts, locators, uncompressed_bytes = extract(source, output, selected, sessions)
    digest, size = file_digest(output)
    selected_details = []
    for provider, ids in selected.items():
        for sid in ids:
            info = sessions[sid]
            selected_details.append(
                {
                    "session_id": sid,
                    "provider": provider,
                    "row_count": counts[sid],
                    "source_files": [
                        {
                            "project": p,
                            "session_file": f,
                            "project_present": has_project,
                            "session_file_present": has_file,
                        }
                        for p, f, has_project, has_file in sorted(
                            info["source_files"], key=lambda pair: json.dumps(pair)
                        )
                    ],
                    "source_line_ranges": locators[sid],
                }
            )
    manifest = {
        "manifest_version": 1,
        "upstream": upstream,
        "generated_at": utc_now(),
        "selection": {
            "seed": seed,
            "sessions_per_provider": count,
            "providers": list(PROVIDERS),
            "group_by": "session_id",
            "algorithm": "sha256-json-array-rank-v1",
            "rank_input": (
                "UTF-8 JSON [seed,provider,session_id], ensure_ascii=true, compact separators"
            ),
            "order": "ascending digest bytes then session_id; take N per provider",
            "output_order": "original source line order",
            "locator_convention": "1-based inclusive source JSONL line ranges",
        },
        "source_counts": {
            "rows": sum(source_rows.values()),
            "rows_per_provider": dict(source_rows),
            "sessions_per_provider": dict(Counter(info["provider"] for info in sessions.values())),
        },
        "selected_session_ids_per_provider": selected,
        "sessions": selected_details,
        "output": {
            "file": output.name,
            "sha256": digest,
            "bytes": size,
            "uncompressed_bytes": uncompressed_bytes,
            "rows": sum(counts.values()),
            "sessions": len(counts),
            "rows_per_provider": {
                p: sum(counts[sid] for sid in ids) for p, ids in selected.items()
            },
            "gzip": {"mtime": 0, "filename": "", "compresslevel": 9},
        },
    }
    write_json(manifest_path, manifest)
    print(f"Upstream: sha256={upstream['sha256']} bytes={upstream['bytes']}")
    print(f"Upstream retrieved_at={upstream['retrieved_at']}")
    print(f"Source: rows={sum(source_rows.values())} sessions={len(sessions)}")
    for provider, ids in selected.items():
        print(
            f"{provider}: "
            f"available_sessions={manifest['source_counts']['sessions_per_provider'][provider]} "
            f"selected_sessions={len(ids)} rows={manifest['output']['rows_per_provider'][provider]}"
        )
    print(
        f"Output: {output} sha256={digest} bytes={size} "
        f"uncompressed_bytes={uncompressed_bytes} rows={sum(counts.values())}"
    )
    print("Manifest: " + str(manifest_path))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--sessions-per-provider", type=int, default=1)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("data/raw/syfi_coding_trace.jsonl.gz"),
        help="Cache path for the pinned release (always hash-verified)",
    )
    parser.add_argument("--output-dir", type=Path, default=Path("data/samples/tracelab"))
    parser.add_argument(
        "--manifest", type=Path, help="Default: tracelab-sample.manifest.json next to output"
    )
    args = parser.parse_args()
    if args.sessions_per_provider < 1:
        parser.error("--sessions-per-provider must be positive")
    output = args.output_dir / "tracelab-sample.jsonl.gz"
    manifest_path = args.manifest or args.output_dir / "tracelab-sample.manifest.json"
    # Reject aliases before any download/write can overwrite the input.
    protected = {
        args.source.resolve(),
        args.source.with_name(args.source.name + ".retrieval.json").resolve(),
    }
    if (
        output.resolve() in protected
        or manifest_path.resolve() in protected
        or (output.resolve() == manifest_path.resolve())
    ):
        parser.error("source, receipt, output and manifest must have distinct paths")
    try:
        upstream = ensure_source(args.source)
        sample(args.source, output, manifest_path, upstream, args.seed, args.sessions_per_provider)
    except (OSError, ValueError, EOFError) as exc:
        parser.exit(1, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
