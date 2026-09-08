# User-owned token price schedules

The application reads `openrouter-v1.json` here, without network access. Every snapshot
has its own `schedule_version`; query results carry that version alongside cost and
priced coverage. Refresh explicitly, review the public projection, and retain previous
versions for reproducibility. The schedule is an estimate, not an invoice: provider
routing, tiers and cache TTL prices are not inferred.

The first real snapshot, `openrouter-v1.json`, was fetched on 2026-09-08 from the host (the implementation sandbox had no DNS), reviewed (model ids and rates only; no credentials, descriptions or raw response) and committed.

From the repository root, in an execution environment with DNS/network access:

```sh
uv --directory backend run python ../scripts/fetch_openrouter_prices.py \
  --output prices/openrouter-v1.json
```

The script makes one keyless `GET https://openrouter.ai/api/v1/models`. Its allowlist retains
model IDs and prompt, completion and published `input_cache_read` rates (renamed
`cache_read`). Rates are exact decimal strings in USD per token. Missing/negative sentinel
rates become null, never zero; numeric JSON rates and nonfinite values are rejected.
It records schema/schedule versions, UTC `fetched_at`, the UTC fetch date as `revision_date`,
model count, source URL, raw-response SHA-256 and fetch/projection provenance. The endpoint
does not supply a schedule revision date; the provenance states this distinction.
No model descriptions, request credentials, user data or raw response are written.

Inspect the generated JSON before committing: top-level metadata/provenance plus `models`,
with exactly `prompt`, `completion`, `cache_read` per model, containing decimal strings or
null. The script refuses to overwrite a snapshot. To refresh, fetch to a new versioned
filename and explicitly change the pinned `DEFAULT_SCHEDULE_PATH` in
`src/agentscope_app/infrastructure/prices.py` in the same reviewed change.

Accounting rules live in `domain/pricing.py`. Model IDs resolve by exact schedule key,
then the reviewed alias table below; no other aliases are inferred. Validated TraceLab
Claude output uses completion rates; its prompt residual
requires known total/read/creation and a consistent split, and cache read has its own
rate. Cache creation stays unpriced. TraceLab Codex output can be priced, but all Codex
input remains unpriced because the prefix split is raw evidence with unknown billing
semantics. Unknown/unrecognized accounting tags are never priced. Reasoning tokens are
not added to the output denominator or cost again.

Ordinary coverage counts calls with any priced component / eligible calls. Priced coverage
counts priced tokens / all recorded input+output tokens. If input total is absent, only
known cache components enter that denominator. Missing token quantities cannot be counted;
coverage is over recorded tokens, not an assertion of complete billing data. A measured
zero with a rate is a known zero cost; entirely unpriced usage is unavailable.

## Reviewed model aliases

`openrouter-v1.aliases.json` is the source-agnostic allowlist paired with
`openrouter-v1.json`. It declares `schema_version: 1`, the exact rate `schedule_version`,
`alias_version: "aliases-v1"`, and an `aliases` object mapping source IDs directly to
schedule keys. Every target must exist; empty IDs, chains, duplicate JSON keys and aliases
that shadow schedule keys are rejected. A mismatched rate version is rejected.

Resolution is case-sensitive: exact schedule key first, then exact alias. The table
explicitly enumerates the normalisation we accept: bare provider model IDs, `-` versus
`.` in the listed Claude versions, and the matching `anthropic/` prefix. Only the two
listed dated IDs lose their date suffix. There is no general punctuation substitution,
case folding, whitespace trimming, arbitrary provider/date stripping, or fuzzy fallback;
`:free`, `:batch`, `-spark`, and different model generations are not interchangeable.
Recorded model IDs and query/group/drill labels are preserved.

The reviewed TraceLab fixture IDs resolve as follows (the JSON also lists the accepted
undated dot and Anthropic-prefixed hyphen variants):

| Trace model ID | Schedule key |
| --- | --- |
| `claude-opus-4-6` | `anthropic/claude-opus-4.6` |
| `claude-opus-4-7` | `anthropic/claude-opus-4.7` |
| `claude-opus-4-8` | `anthropic/claude-opus-4.8` |
| `claude-opus-4-5-20251101` | `anthropic/claude-opus-4.5` |
| `claude-haiku-4-5-20251001` | `anthropic/claude-haiku-4.5` |
| `claude-sonnet-4-6` | `anthropic/claude-sonnet-4.6` |
| `gpt-5.2-codex` | `openai/gpt-5.2-codex` |
| `gpt-5.3-codex` | `openai/gpt-5.3-codex` |
| `gpt-5.4` | `openai/gpt-5.4` |
| `gpt-5.4-mini` | `openai/gpt-5.4-mini` |
| `gpt-5.5` | `openai/gpt-5.5` |

`codex-auto-review` (4 calls), `gpt-5-codex` (141), and `gpt-5.3-codex-spark` (3) have no
schedule key and stay unpriced with reason `no rate for this model id`. An unresolved-only
query or model bucket returns that exact reason; mixed selections report the unresolved
call count alongside the accounting reason. Those calls remain in coverage denominators.

SWE-chat's reviewed documents under `backend/tests/verification/documents/` preserve
`$.model`; the replay fixture uses `gpt-5.5` and a document mentions `claude-opus-4-6`.
Both resolve through the same table, independent of source/agent/provider. SWE-chat
semantics remain unvalidated, so resolution alone cannot price its tokens.

Results identify the combined rate and alias snapshot as
`openrouter-2026-09-08-734d889de105+aliases-v1`. A custom schedule with no adjacent
`<stem>.aliases.json` retains exact-key-only lookup and its original version. On changes,
retain the old schedule/alias pair, create a new pair with a new alias version (and the
new rate version when rates change), and repin `DEFAULT_SCHEDULE_PATH` in the same reviewed
commit. The fetch script still fetches only rates; aliases require separate review.

`GET /api/metrics/definitions` exposes the active cost `price_schedule` metadata and lists
all aliases in its `caveat`. The Definitions page integration is owned by #11; that page
currently uses the legacy summary endpoint. #59 supplies its backend contract without
editing `web/src`.

## Fixture cost reference

For the committed 4,770-row TraceLab fixture and this combined snapshot, independent
raw-field arithmetic gives these exact USD values. These are estimates for priced
components, not complete session bills:

| Accounting group | Prompt USD | Cache read USD | Output USD | Priced cost USD | Priced / recorded tokens | Priced / eligible calls |
| --- | --- | --- | --- | --- | --- | --- |
| `tracelab-claude` | 0.291323 | 85.2615223 | 22.251360 | 107.8042053 | 179280996 / 187395949 | 1583 / 1583 |
| `tracelab-codex` | Unavailable | Unavailable | 25.0719925 | 25.0719925 | 1496244 / 368535755 | 3039 / 3187 |

Reference calculation: group raw rows by provider and model, multiply `output_tokens`
by completion rate; for Claude additionally multiply `claude_uncached_input_tokens` by
prompt rate and `claude_cache_read_input_tokens` by cache-read rate. The fixture's Claude
uncached field equals total minus read and creation on every row. This independently
checks the production residual calculation. Claude priced components contain 64,203 prompt,
178,275,625 cache-read and 941,168 output tokens; Codex has 1,496,244 priced output tokens.
The recorded sum is `132.8761978`; mixed accounting groups keep overall `value_text: null`
and expose both priced partition values. The HTTP regression imports the entire fixture,
checks these fixed values and coverage, and verifies accounting-group filters round-trip.
