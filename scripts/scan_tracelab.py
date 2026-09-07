#!/usr/bin/env python3
"""Conservative, offline fixture review aid; reports locations, never matched secrets.

Exit 1 on any candidate. Review findings before redistribution; a clean scan is
not a guarantee against personal information or unknown credential formats.
Never run this against the reserved Trace Commons native session.
"""

import argparse
import gzip
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PATTERNS = {
    "email": r"[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+",
    "absolute_home_path": (
        r"/(?:Users|home|var/home)/[^/\s]+|/root(?:/|$)|"
        r"[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+"
    ),
    "credential_url": r"[A-Z][A-Z0-9+.-]*://[^\s/<>]+@",
    "credential_query": r"[?&](?:access_token|api_key|apikey|token|password|secret)=[^&\s]+",
    "known_token": (
        r"\b(?:sk-(?:proj-|ant-)?[A-Z0-9_-]{16,}|"
        r"gh[pousr]_[A-Z0-9]{20,}|github_pat_[A-Z0-9_]{20,}|"
        r"hf_[A-Z0-9]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|"
        r"xox[baprs]-[A-Z0-9-]{10,}|AIza[A-Z0-9_-]{30,}|"
        r"glpat-[A-Z0-9_-]{16,}|npm_[A-Z0-9]{20,})\b"
    ),
    "private_key": r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----",
    "jwt": r"\beyJ[A-Z0-9_-]+\.eyJ[A-Z0-9_-]+\.[A-Z0-9_-]+",
    "bearer": r"\bBearer\s+[A-Z0-9._~+/-]{8,}",
    "secret_assignment": (
        r"\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|"
        r"secret|password|passwd|client_secret)\b"
        r"[\"'\s]*[:=][\"'\s]*[^\s\"',;}]{8,}"
    ),
}
REGEXES = {key: re.compile(pattern, re.IGNORECASE) for key, pattern in PATTERNS.items()}
SECRET_KEY = re.compile(
    r"(?:api_?key|access_?token|auth_?token|secret|password|passwd|private_?key)", re.I
)


def strings(value, path="$", secret_field=False):
    if isinstance(value, str):
        yield path, value, secret_field
    elif isinstance(value, dict):
        for key, child in value.items():
            yield path + ".<key>", key, False
            yield from strings(child, path + "." + key, bool(SECRET_KEY.fullmatch(key)))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from strings(child, f"{path}[{index}]", secret_field)


def scan(path):
    findings = []
    counts = Counter()
    rows = 0
    with gzip.open(path, "rb") as stream:
        for rows, line in enumerate(stream, 1):
            row = json.loads(line)
            for field, value, secret_field in strings(row):
                for category, pattern in REGEXES.items():
                    if pattern.search(value):
                        counts[category] += 1
                        findings.append({"row": rows, "field": field, "category": category})
                if secret_field and value.strip():
                    counts["secret_field"] += 1
                    findings.append({"row": rows, "field": field, "category": "secret_field"})
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    scanned_at = datetime.now(timezone.utc)  # noqa: UP017 - Python 3.9+
    return {
        "file": str(path),
        "sha256": digest.hexdigest(),
        "scanned_at": scanned_at.isoformat().replace("+00:00", "Z"),
        "rows_scanned": rows,
        "checks": list(REGEXES) + ["secret_field"],
        "candidate_counts": dict(counts),
        "findings": findings,
        "result": "review_required" if findings else "no_candidates",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    report = scan(args.path)
    print(json.dumps(report, indent=2, sort_keys=True))
    raise SystemExit(1 if report["findings"] else 0)
