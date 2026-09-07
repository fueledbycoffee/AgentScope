# Configuring the mapping assistant

The assistant talks to one chat-completions endpoint, chosen by four variables
in `backend/.env` (never committed; copy `.env.example`). No model id lives in
the code. Switching model or provider is: change the variables, restart the
backend, nothing else.

| Variable | Meaning | Default |
| --- | --- | --- |
| `AGENTSCOPE_LLM_PROVIDER` | `openai_compatible` (any chat-completions endpoint) or `fake` (deterministic, offline, used by the tests) | `openai_compatible` |
| `AGENTSCOPE_LLM_BASE_URL` | Endpoint root, ending in `/v1` (or `/api/v1` for OpenRouter), exactly once; the adapter appends `/chat/completions`. Absolute `http(s)`, no credentials, query or fragment | `https://openrouter.ai/api/v1` |
| `AGENTSCOPE_LLM_MODEL` | Model id exactly as the endpoint expects it | (must be set) |
| `AGENTSCOPE_LLM_API_KEY` | Sent as `Authorization: Bearer …` when non-empty; leave empty for local servers | empty |
| `AGENTSCOPE_LLM_TIMEOUT_S` | Deadline of one generation call (positive seconds). A run with a repair takes at most twice this. Kept as text and parsed by the adapter: a typo disables the assistant, not the application | `60` |
| `AGENTSCOPE_LLM_JSON_MODE` | `auto`, `on`, `off`: whether `response_format: {"type": "json_object"}` is sent (see below) | `auto` |
| `AGENTSCOPE_LLM_MAX_TOKENS` | Upper bound on a reply (positive integer). A cut-off reply gets one repair, then fails clearly | `8192` |

An invalid or missing assistant configuration never stops the application:
uploads, previews, imports, saved-mapping replay and the dashboards work, and
only assistant runs answer `503 assistant_unavailable` with the variable to
fix in the message.

## Endpoints

**OpenRouter** (hosted, tested once on 2026-09-07, see below)

```
AGENTSCOPE_LLM_PROVIDER=openai_compatible
AGENTSCOPE_LLM_BASE_URL=https://openrouter.ai/api/v1
AGENTSCOPE_LLM_MODEL=dots-studio/dots-3-note-preview:free
AGENTSCOPE_LLM_API_KEY=sk-or-v1-…
```

Free models come and go: `minimax/minimax-m3:free` answered 404 "unavailable
for free" on 2026-09-07. `GET https://openrouter.ai/api/v1/models` lists what
exists; ids ending in `:free` with `response_format` in
`supported_parameters` fit best. The adapter sends `HTTP-Referer` and
`X-Title` headers (the repository URL and "AgentScope"), which OpenRouter uses
for attribution; they carry no secrets.

**LM Studio** (local, evidence pending)

```
AGENTSCOPE_LLM_BASE_URL=http://localhost:1234/v1
AGENTSCOPE_LLM_MODEL=<the id shown in LM Studio's server tab>
AGENTSCOPE_LLM_API_KEY=
```

Load the model and start the server first. Some builds reject
`response_format: json_object`; `auto` handles that (see below), `off` skips
it entirely.

**Ollama** (local, evidence pending)

```
AGENTSCOPE_LLM_BASE_URL=http://localhost:11434/v1
AGENTSCOPE_LLM_MODEL=<a pulled model, e.g. qwen3:8b>
AGENTSCOPE_LLM_API_KEY=
```

`ollama pull <model>` first. Small models often return prose around the JSON
or an invalid mapping; the run then ends with one repair and either an
editable draft or a clear `502`.

## What is sent, and what is not

Every run is two steps. `POST /api/assistant/prepare` returns the exact text
the model will receive as its data message (redacted field profile, target
contract, optional redacted sample, current mapping, message, history) and
its SHA-256; `POST /api/assistant/run` sends that text only when the digest
still matches. The adapter adds one fixed instruction preamble (versioned;
part of the digest) that contains no upload content, and, on the single repair
call, the model's own previous reply (redacted, bounded) and the validation
issues between markers, both declared as untrusted data. Nothing else leaves
the machine: no file, no unredacted record, no key in any message or reply.

Redaction is exposure control, not anonymisation: see
`docs/mapping/README.md`, "How the assistant sees your file".

## Structured output (`AGENTSCOPE_LLM_JSON_MODE`)

- `auto` (default): `response_format: {"type": "json_object"}` is sent. If the
  server answers `400` with an error message that explicitly says the
  parameter is unsupported, unknown or invalid, the adapter sends the same
  request once more without it (no generation had happened) and remembers
  the choice for the life of the process; the run's diagnostics carry
  `adapter_notes: ["json_mode_off_after_rejection"]`. Any other `400` is a
  provider error.
- `on`: always sent; a rejection is a `502`.
- `off`: never sent; the preamble alone asks for a bare JSON object.

`on` does not prove the server enforced JSON output: the application
validates every reply itself.

## Timeouts, retries and attempts

- One `complete` call ends within `AGENTSCOPE_LLM_TIMEOUT_S`: a monotonic
  deadline that caps every HTTP attempt inside it (connect is capped at 10 s)
  and is checked while the body streams in, so a reply that keeps trickling
  bytes is cut off at the deadline too. Replies over 4 MiB are discarded.
- The only replays are the JSON-mode negotiation above and one retry after a
  `429` per call, negotiation included (honouring `Retry-After` in seconds or
  as an HTTP date when it fits the remaining time; otherwise the call fails). `502`,
  `503`, `504` and connection failures are never replayed: a request the
  server may have accepted is never sent twice.
- The application makes at most two generation calls per run (the second is
  the repair). `502` details carry `kind` and `attempts`; `attempts` counts
  generation calls, not HTTP attempts.

## Outcomes

| What happened | HTTP | Body |
| --- | --- | --- |
| executable proposal | 200 | `proposal.executable: true` |
| non-executable after the repair | 200 | `proposal.executable: false`, `issues` (an editable draft) |
| the model refused | 200 | `proposal: null`, `diagnostics.failure: "refusal"` |
| cut off twice, or not a JSON object twice | 502 `assistant_failed` | `details: [{kind: "truncated" \| "malformed", attempts: 2}]` |
| transport or provider failure, timeout | 502 `assistant_failed` | `details: [{kind: "timeout" \| "provider" \| "malformed", attempts}]` |
| no adapter, bad configuration, refused credentials, unreachable host | 503 `assistant_unavailable` | message names the variable to check |
| the context changed since it was shown | 409 `stale_context` | prepare again |
| context over 64 KiB after trimming | 413 `context_too_large` | nothing was sent |

## Verification

Offline, always: `uv --directory backend run pytest tests/infrastructure/test_openai_compatible.py`
runs the adapter against labelled synthetic fixtures and one captured reply
(`backend/tests/llm_recordings/`, bodies only, key stripped) through
`httpx2.MockTransport`. CI never calls a network and never reads a real key.

Live, locally, with your own `.env`:

```
uv --directory backend run python ../scripts/llm_smoke.py [--include-sample] [--save-recording NAME]
```

It profiles the TraceLab fixture, prepares the context, runs the assistant and
prints model, attempts, executable, issue codes, ambiguities and questions.
`--save-recording NAME` stores the last response body under
`backend/tests/llm_recordings/` with the configured key scrubbed everywhere
(escaped forms included) and refuses to write if any trace of it remains.

Evidence so far (ADR-005 wants recorded live runs before a configuration is
called tested):

| Date | Endpoint | Model | Result |
| --- | --- | --- | --- |
| 2026-09-07 | OpenRouter | `dots-studio/dots-3-note-preview:free` (rewritten adapter) | 78 s, 2 attempts, **executable** proposal: session, model_call, tool_call rules; 26 explanations, 5 ambiguities, 4 questions |
| 2026-09-07 | OpenRouter | `dots-studio/dots-3-note-preview:free` (first adapter build) | 113 s, 2 attempts, editable draft (`invalid_type`, `unknown_key`, `unknown_policy`); reply captured |
| 2026-09-07 | OpenRouter | `minimax/minimax-m3:free` | 404 "unavailable for free" (model retired from the free tier) |
| 2026-09-07 | OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` | provider error inside a 200: upstream overloaded |
| 2026-09-07 | OpenRouter | `google/gemma-4-31b-it:free` | 429 rate-limited upstream |
| 2026-09-07 | OpenRouter | `nvidia/nemotron-3.5-lightning:free` | cut off twice (before the deadline fix the run took 623 s; now bounded at 2 × timeout) |
| pending | LM Studio | | |
| pending | Ollama | | |

The two-distinct-model verification report is issue #16.

## Troubleshooting

- `503 … AGENTSCOPE_LLM_MODEL is empty`: set the model.
- `503 … refused the credentials (401)`: the key is wrong or missing for a hosted endpoint.
- `503 … answered 404`: the root is wrong (needs `/v1` once) or the model id does not exist on this endpoint; the message quotes the endpoint's own explanation.
- `502 … kind: timeout`: raise `AGENTSCOPE_LLM_TIMEOUT_S` or pick a faster model; local models on CPU often need more than 60 s.
- `502 … kind: truncated`: raise `AGENTSCOPE_LLM_MAX_TOKENS` or pick a model that writes compact JSON.
- `502 … reported a provider error`: the hosted provider itself failed (OpenRouter puts these inside a 200); try again or another model.
