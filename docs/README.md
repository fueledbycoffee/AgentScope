# Documentation

The implementation references added for issue #18 describe repository commit
`2a351e90bd67dc7fd51aa5a16b8cf27cbddb0dc2` as it stood on 2026-09-08. Later
behavior needs a follow-up update rather than being inferred from a plan.

- [Planning](planning/2026-09-07-consolidated-plan.md): agreed release scope and
  decisions; the same folder retains the original proposals and cross-reviews.
- [Datasets](datasets/README.md): verified provenance, retrieval, field caveats,
  fixture review and limits on what has been inspected.
- [Mapping DSL v1](mapping/README.md): the declarative mapping contract, target
  schema, validation stages and diagnostic codes, with the TraceLab example.
- [Architecture decision records](adr/README.md): accepted decisions and their
  rationale for maintainers.
- [Architecture and import pipeline](architecture/import-pipeline.md): runtime
  components, dependency direction, commit path and the persisted ERD.
- [HTTP API contract v0.1](api/v0.1.md): the interface the web app consumes.
- [Metric definitions](metrics/README.md): canonical wording, formula,
  coverage, scope and comparability for the shipped summary.
- [Mapping assistant configuration](llm/configuration.md): provider settings,
  model-switch procedure and recorded adapter behavior.
- [Draft v0.1.0 release notes](releases/v0.1.0.md): supported path, known limits
  and coordinator-owned release metadata.
- [Verification records](verification/): dated evidence for integration and
  release checks.
- [Contributing](../CONTRIBUTING.md): locked setup, CI commands and repository
  rules.
