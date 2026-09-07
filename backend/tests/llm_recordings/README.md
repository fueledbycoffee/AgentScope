# Recorded chat-completions responses

Two kinds of files, told apart by their prefix:

- `synthetic_*.json`: hand-written bodies shaped like the named server's replies
  (OpenRouter, LM Studio's `/v1`, Ollama's `/v1`). They drive the adapter tests
  through `httpx2.MockTransport`; they are fixtures, not evidence, and prove
  nothing about a deployed server or model.
- `captured_*.json` + `.provenance.json`: real response bodies from a local run of
  `scripts/llm_smoke.py`, request, headers and credentials stripped; the sidecar
  says when, where, which model and prompt version, and what the reply was.

Statuses and headers are set in the tests themselves; connection failures and
timeouts are injected as exceptions. CI never calls a network and never reads a
real key (`tests/infrastructure/test_openai_compatible.py`).
