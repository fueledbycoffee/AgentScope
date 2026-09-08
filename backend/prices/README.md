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

Accounting rules live in `domain/pricing.py`. Model IDs match exactly; no aliases are
invented. Validated TraceLab Claude output uses completion rates; its prompt residual
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
