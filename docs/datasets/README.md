# Dataset provenance and local retrieval

Access and bytes verified on **2026-09-07**. Run commands from the repository root.
Only the reviewed TraceLab fixture is redistributed. Raw downloads, local samples
and the reserved native file remain under gitignored `data/`.

## Manifest inventory

| Dataset | Manifest status | What it records |
| --- | --- | --- |
| TraceLab | [Committed fixture manifest](../../fixtures/tracelab/tracelab-sample.manifest.json), beside the redistributable fixture and attribution | Manifest version and generation time; pinned upstream URL/version/hash/bytes and retrieval receipt; deterministic seed, selection algorithm and source locators; selected session ids; output path/hash/bytes/row/session counts and gzip settings. Licence and redistribution review are linked from this page and [`ATTRIBUTION.md`](../../fixtures/tracelab/ATTRIBUTION.md). |
| SWE-chat | Local `data/samples/swe-chat-1/manifest.json`, generated and gitignored; aggregate evidence is committed in the [two-model report](../verification/2026-09-08-second-source-two-models.md) | Build time, deterministic seed and per-agent cap, whole-session selection rule and limits, upstream file hashes/bytes, output hashes/bytes/row counts, and selected-session counts per agent. The local manifest does not currently carry the pinned dataset revision, licence or generator version; those remain explicit on this page rather than being invented in a clean clone. |
| Trace Commons | Provenance only on this page; no import fixture or selection manifest | Pinned repository revision, remote paths, local hashes/bytes and the fact that the native holdout is reserved unseen. These local bytes are not a clean-clone input. |

A manifest used for publication should let a reviewer identify the source and
revision, verify upstream hashes, reproduce selection from its seed and caps,
verify every output path/hash/byte/row count, identify the generator and version,
and find the licence and redistribution decision. Missing fields must stay
visibly missing; do not synthesize them after a run or copy a gated local
manifest into the repository.

## TraceLab: available, excerpt committed

- Reference: [TraceLab](https://github.com/uw-syfi/TraceLab),
  [release v0.0.1](https://github.com/uw-syfi/TraceLab/releases/tag/v0.0.1).
- Asset: [syfi_coding_trace.jsonl.gz](https://github.com/uw-syfi/TraceLab/releases/download/v0.0.1/syfi_coding_trace.jsonl.gz).
- Licence: [CC BY 4.0 for the released dataset](https://github.com/uw-syfi/TraceLab/blob/11b8b14c6005808ab272b3431487066832582414/LICENSE-DATASET.md).
  Credit: TraceLab (SyFI Lab, University of Washington).
- Retrieved: `2026-09-07T08:23:11.935391Z` by Python `urllib.request` over HTTPS.
- Upstream compressed size: **53,601,226 bytes**.
- Upstream SHA-256: `9d265eae69a31cae203848bea936f018148eed7ca8bf56050c5abe96da0b4e6b`.
  Matches the GitHub release asset's published digest and size, pinned in the script.

Exact retrieval and selection commands used (Python **3.9.6**, standard library only):

```sh
python3 scripts/sample_tracelab.py --seed 42 --sessions-per-provider 40
python3 scripts/scan_tracelab.py data/samples/tracelab/tracelab-sample.jsonl.gz
python3 scripts/sample_tracelab.py --seed 42 --sessions-per-provider 40 \
  --output-dir fixtures/tracelab
python3 scripts/scan_tracelab.py fixtures/tracelab/tracelab-sample.jsonl.gz \
  > fixtures/tracelab/sensitive-content-scan.json
```

The first command downloads into `data/raw/` unless the release is already there.
Every invocation checks its SHA-256 and byte size before decompressing; downloads
are installed only after verification. The adjacent `.retrieval.json` receipt
preserves the actual download timestamp on reuse. A pre-existing matching file
without a receipt gets a null retrieval timestamp with an explicit explanation,
not an invented retrieval date. The gzip is streamed through EOF, including its
CRC checks. Malformed records and insufficient provider populations fail.

Default local output is `data/samples/tracelab/tracelab-sample.jsonl.gz` with an
adjacent manifest unless `--manifest` is supplied. The committed
[fixture manifest](../../fixtures/tracelab/tracelab-sample.manifest.json) is the
single source of truth for the shipped selection. The local `data/samples/` extract
is the same selection regenerated with the command above; its ignored manifest
only differs in generation timestamp on the tested runtime.

Selection groups **all occurrences of each `session_id`**, then ranks sessions
separately for `claude` and `codex` by SHA-256 of compact ASCII-escaped JSON
`[seed,provider,session_id]`. It takes the lowest N digests (session ID breaks ties).
No row-size filtering, redaction, native-ID deduplication or contiguous-session
assumption is involved. A second streaming pass copies every selected binary line
in original file order. All project/session-file combinations are retained as
metadata; presence flags distinguish absent fields from explicit nulls. A session
ID crossing provider strata is rejected. Inclusive, 1-based source line ranges
identify every selected occurrence independently of native IDs.

| Extract | Whole sessions | Model invocation rows | Nested tools | Gzip bytes | Uncompressed bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude | 40 | 1,583 | 1,797 | — | — |
| Codex | 40 | 3,187 | 3,926 | — | — |
| Total (local and fixture) | 80 | 4,770 | 5,723 | 681,057 | 8,597,668 |

The source has 357,161 rows and 4,265 grouped session IDs: 2,676 Claude sessions
(140,338 rows) and 1,589 Codex sessions (216,823 rows). N=40 gives an integration
fixture of approximately 0.68 MB gzipped, within the 0.5–1 MB review target and
below the 1.5 MB limit; it is not statistically representative. Scan any proposed
replacement fixture before committing it.

Extract SHA-256: `d044a766e12c7eceae2eb1ed71e42d95cf0aec2f10c8d61a06cecc0381fb9897`.
Gzip uses level 9, mtime 0 and no filename. Repeated runs on the tested runtime
produce identical compressed bytes; a different zlib version may compress the
same selected JSONL bytes differently. Manifest generation timestamps intentionally
change on regeneration.

### Schema caveats and redistribution review

The upstream [DB_SCHEMA.md](https://github.com/uw-syfi/TraceLab/blob/11b8b14c6005808ab272b3431487066832582414/artifacts/utils/DB_SCHEMA.md)
documents non-unique `round_id` (about 8,900 duplicated IDs) and `trace_key`
(514 duplicates); `(session_id, round_index)` is also not unique. One root JSONL
row is one **recorded model invocation**, with nested `tools[]`. Count observations,
not presumed unique calls. The public release drops tool `input`; Claude-specific
`claude_*` accounting fields are null for Codex. These are unavailable values, not
zeros. The release licence describes sanitisation; the database schema describes
a related representation and must not be treated as an exact JSONL contract.

A full-source metadata check found `session_file` absent on every released row,
and `project` absent on every Codex row. All three `claude_*` accounting fields were
null on all 216,823 Codex rows. No missing source fields are fabricated in the
excerpt. The fixture has no `input` key in any nested tool.

Redistribution decision: commit the unchanged, attributed excerpt under CC BY 4.0,
with [ATTRIBUTION.md](../../fixtures/tracelab/ATTRIBUTION.md); retain the full release
only in `data/raw/`. Before committing, the offline
[scanner](../../scripts/scan_tracelab.py) checked all decoded JSON string values
and keys, including nested tools, for emails, Unix/macOS/Windows absolute home
paths, credential-bearing URLs and query parameters, known token/key formats,
private keys, JWTs, bearer credentials, secret assignments and secret fields.
It reports locations rather than matching values. Both the local candidate and
the fixture returned **zero candidates across 4,770 rows**; the committed
[report](../../fixtures/tracelab/sensitive-content-scan.json) records the checks.
This is a pattern-based review aid, not proof that all possible sensitive content
is absent. Any future positive candidate blocks fixture publication pending review;
do not silently redact rows or choose another seed to conceal findings.

## SWE-chat: gated, local excerpt verified; no bytes committed

Reference: [SALT-NLP/SWE-chat](https://huggingface.co/datasets/SALT-NLP/SWE-chat).
Revision: `f66cca95b14caaa4177f7ed5eaa424608dadcffa` (pinned in the commands below).
Licence: [Open Data Commons Attribution (ODC-BY)](https://opendatacommons.org/licenses/by/1-0/),
as declared in the [dataset card](https://huggingface.co/datasets/SALT-NLP/SWE-chat/blob/f66cca95b14caaa4177f7ed5eaa424608dadcffa/README.md).
The dataset is gated (`gated: "auto"`): the owner accepted the access terms on the
Hugging Face website with their own account, then downloaded with that account.
No access bypass was used; the token stays in the HF CLI credential store.

Retrieved **2026-09-07T08:51Z** with the `hf` CLI 1.30.0 (Homebrew formula `hf`)
from the repository root:

```sh
hf auth login                      # once, interactive, same account that accepted the terms
mkdir -p data/raw/swe-chat
hf download SALT-NLP/SWE-chat sessions.parquet conversations.parquet \
  --repo-type dataset --revision f66cca95b14caaa4177f7ed5eaa424608dadcffa \
  --local-dir data/raw/swe-chat
shasum -a 256 data/raw/swe-chat/sessions.parquet data/raw/swe-chat/conversations.parquet
```

| Table | Local path | Bytes | Rows | Columns | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| sessions | `data/raw/swe-chat/sessions.parquet` | 1,997,377 | 5,851 | 39 | `2ada63973b182b691318916ca8c813e694091400e43744eca9cad3da2d958a95` |
| conversations | `data/raw/swe-chat/conversations.parquet` | 1,311,422,253 | 2,692,480 | 35 | `9ee1d937dbf7eb73a8dad75071c69a4f6b5aac7f4120bd8ef3799ee50f4f1c36` |

Row counts and column names for the full downloads were read from Parquet
footers with pyarrow. A later bounded excerpt was inspected only through the
aggregate audit and product workflow recorded below; the full conversation
content was not published or committed.

Schema notes relevant to normalisation. Field names and types come from the
Parquet footers; row granularity is what the
[dataset card](https://huggingface.co/datasets/SALT-NLP/SWE-chat/blob/f66cca95b14caaa4177f7ed5eaa424608dadcffa/README.md)
states ("one row per coding session", "one row per conversation turn"). The
excerpt audit found that an assistant row is not equivalent to a provider API
call. Token-accounting semantics (what the session-level and entry-level token
columns count, and whether they reconcile) remain unvalidated.

- `sessions` fields: `session_id`, `repo_id`, `user_id`, `agent`, `created_at`
  (UTC), `input_tokens`, `output_tokens`, `cache_creation_tokens`,
  `cache_read_tokens`, `api_call_count`, `tool_call_count`, `turn_count`,
  `prompt_count`, `duration_seconds`, plus attribution and repo metadata columns.
- `conversations` fields: `turn_id`, `session_id`, `turn_number`, `role`,
  `turn_type`, `is_continuation`, `content`, `model`, `timestamp` (UTC),
  `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, and tool fields `tool_name`, `tool_call_id`,
  `file_path`, `command`, `tool_input_json`. A conversation entry is not
  necessarily a model invocation: whether one assistant entry equals one API call
  must be established from the data (for example against `sessions.api_call_count`)
  before any model-call mapping is trusted; see the identity rules in the
  consolidated plan.

The conversations file is above the product limits (25 MiB per uploaded file,
100,000 records per batch). The committed
[`scripts/sample_swe_chat.py`](../../scripts/sample_swe_chat.py) selects whole
sessions deterministically, stratified by `agent`, and writes both source tables
plus a local manifest. The verified invocation was:

```sh
uv --directory backend run python ../scripts/sample_swe_chat.py \
  --raw-dir ../data/raw/swe-chat --per-agent 1 \
  --out-dir ../data/samples/swe-chat-1
```

It produced the ignored excerpt recorded in the two-model report: 12 session
rows and 518 conversation rows. The generator checks both output files against
25 MiB, their combined rows against 100,000, and the closed outputs with the
production Parquet reader. If a selected session contains a refused row or the
outputs exceed a limit, its whole session is removed; sessions are never split.

Redistribution decision: **none committed**. The files stay under gitignored
`data/raw/`; ODC-BY permits redistribution with attribution, but the excerpt will be
reviewed for sensitive content first and its terms re-read at that point.
Sessions and conversations are different tables; do not treat their rows as
interchangeable or assume their granularity matches TraceLab. Reviewed mappings
and replay limits are in the [mapping inventory](../mapping/README.md). Trace
Commons remains provenance-only fallback material, described below.

## Trace Commons: public fallback downloaded; native file reserved unseen

Reference: [trace-commons/agent-traces](https://huggingface.co/datasets/trace-commons/agent-traces).
Revision observed before and after download: `112ebd4d03ce852b00e935d523107c3d0c9a65bf`.
Retrieved 2026-09-07 with unauthenticated `curl`; API reports `gated: false`.
Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), attributed to
Trace Commons in the [dataset card](https://huggingface.co/datasets/trace-commons/agent-traces/blob/112ebd4d03ce852b00e935d523107c3d0c9a65bf/README.md).

Exact file-listing commands used (only metadata, no native session content):

```sh
curl -fsSL https://huggingface.co/api/datasets/trace-commons/agent-traces
curl -fsSL https://huggingface.co/api/datasets/trace-commons/agent-traces/tree/main
curl -fsSL https://huggingface.co/api/datasets/trace-commons/agent-traces/tree/main/data
curl -fsSL https://huggingface.co/api/datasets/trace-commons/agent-traces/tree/main/sessions
curl -fsSL https://huggingface.co/api/datasets/trace-commons/agent-traces/tree/main/sessions/claude_code
```

Exact download and checksum commands:

```sh
mkdir -p data/raw/trace-commons data/reserved/sessions/claude_code
curl -fL --retry 3 \
  https://huggingface.co/datasets/trace-commons/agent-traces/resolve/main/data/train-00000-of-00001.parquet \
  -o data/raw/trace-commons/train-00000-of-00001.parquet
curl -fsSL --retry 3 \
  https://huggingface.co/datasets/trace-commons/agent-traces/resolve/main/sessions/claude_code/07b57159-218e-4330-a64e-0ec4b4355056.jsonl \
  -o data/reserved/sessions/claude_code/07b57159-218e-4330-a64e-0ec4b4355056.jsonl
shasum -a 256 data/raw/trace-commons/train-00000-of-00001.parquet
shasum -a 256 data/reserved/sessions/claude_code/07b57159-218e-4330-a64e-0ec4b4355056.jsonl
```

`main` is mutable. To reproduce this snapshot later, replace `main` in the resolve
URLs with the recorded revision and compare these hashes before use:

| Role | Local path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Decoded Parquet fallback | `data/raw/trace-commons/train-00000-of-00001.parquet` | 70,202,603 | `7c2c6ee4342ff014c47b906425501b4dc4f368df8af5280c158e827944da11e7` |
| Reserved native file | `data/reserved/sessions/claude_code/07b57159-218e-4330-a64e-0ec4b4355056.jsonl` | 1,556,737 | `f0f3711cd1cd6b683007b70ac071b18a64c158956d3863631b834bee8471fa70` |

The Parquet SHA-256 and size match the tree API's LFS object. The reserved file's
Git blob SHA-1 also matches the listing (`89e91176aedd70198434417ed5c45aa06eab0170`).
Selection: download the sole decoded Parquet shard in full; reserve the first
`.jsonl` path in the `sessions/claude_code/` listing. **The reserved file has only
been downloaded and hashed; its contents and structure have not been inspected.
Do not preview, scan, parse or use it in development/tests before the day-4 exercise.**

The card describes the decoded Parquet as one row per session. It is a voluntary
sample, sanitisation is best-effort, and embedded code/content may carry original
licences beyond the compilation's CC BY 4.0. Redistribution decision: retain both
files locally; commit provenance only. No Parquet payload has been inspected in
this task either, preserving the holdout against indirect exposure. The 70.2 MB
shard exceeds the planned 25 MiB per-upload limit: make a bounded local Parquet
excerpt during second-source integration, excluding the reserved session, before
UI import. It is downloaded fallback material, not yet an import-ready excerpt.

## Verification

```sh
python3 -m unittest discover -s scripts -p 'test_*.py' -v
python3 scripts/scan_tracelab.py fixtures/tracelab/tracelab-sample.jsonl.gz
cmp data/samples/tracelab/tracelab-sample.jsonl.gz fixtures/tracelab/tracelab-sample.jsonl.gz
```

Offline tests cover interleaved whole sessions, duplicate native IDs, multiple
source-file claims, absent metadata, exact CRLF/whitespace/final-line bytes,
deterministic selection/compression, invalid counts/records, corrupt caches,
download verification/receipt reuse and scanner detections. An independent pass
over all 357,161 source rows also confirmed that the selected 4,770 rows match the
local extract byte for byte, in source order, with complete session membership
and exact manifest locators. The backend CI job also runs the script tests and
includes `scripts/` in its Ruff lint and format checks. Local verification includes
backend Ruff, mypy, architecture contracts and pytest, plus the script tests on
Python 3.9.6 and the backend Python 3.12.13 environment.
