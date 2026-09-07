# ADR-004: A bounded, replayable mapping DSL v1

## Status

Accepted — 2026-09-07.

## Context

Users must be able to review, correct and replay mappings for unfamiliar trace
structures. An LLM may propose a mapping, but neither generated code nor a live
provider can be required to execute a saved mapping. The interpreter needs a
closed contract that yields explanations when a source cannot be represented.

[Consolidated plan section 4](../planning/2026-09-07-consolidated-plan.md#4-mapping-dsl-contract)
is the capability boundary. It supersedes draft DSL examples that included
grouping, aggregates or a broader transform list. The
[verified dataset notes](../datasets/README.md) supersede guessed field names
and unverified assumptions about row grain in those examples.

## Decision

Represent a mapping as a declarative, versioned contract with these parts:

| Part | Required contract content |
| --- | --- |
| Identity | Logical mapping ID, immutable revision, parent revision (none for the first revision), content hash. |
| Compatibility | `dsl_version` and `target_schema_version`. |
| Input | Format, reader options and expected required fields. |
| Rules | Rule ID, predicate, collection selector, target entity, identity fields and parent reference. |
| Field mappings | Source path or literal → target field, ordered allowlisted transforms, type, source/target unit (`from`/`to`) and null policy. |
| Documentation | Explanations, ambiguities and unmapped/unsupported paths with a reason. |

Bind each imported file to its mapping revision. Editing creates a new revision
and invalidates any previous preview; historical imports retain their binding.
Reject unsupported DSL versions and incompatible target schema versions clearly,
rather than guessing an interpretation. Provider, model and prompt-version
metadata are audit-only and do not affect executable mapping semantics.

The complete allowed capability set is:

- Object-key and array-index access.
- Bounded iteration over named arrays.
- Root, current-item and parent scopes.
- Existence, equality and membership predicates.
- Trim and explicit enum/boolean maps.
- Strict integer and decimal parsing.
- Timestamp parsing and unit conversion.
- Ordered coalescing, constants and composite keys.
- Bounded JSON decoding of a string field.

Explicitly exclude **expressions, regex programs, recursion, joins, aggregation
and generated code**. This is not full JSONPath or a general programming
language. Parent references declare entity relationships; they do not permit
arbitrary joins. Enforce bounded expansion and decoding alongside import limits
of 25 MiB per file and 100,000 records per batch. Reject unsupported operations
with diagnostics instead of evaluating them or silently ignoring them.

For TraceLab, `$` contributes session identity using `session_id` and harness
from `provider` via an enum map. A root rule emits a model-call observation;
`$.tools[*]` emits tool observations referencing that enclosing model call.
Use actual token fields and `timing_events` as timestamp evidence; the domain
reducer computes session bounds from accepted children. There is no DSL
`group-by`, `min`, `max`, `sum`, `count` or `first` for deriving sessions or
dashboard metrics. See [ADR-002](ADR-002-identities.md).

Validate through four stages, in order:

1. **Schema validation:** contract structure, versions and closed operation set.
2. **Semantic validation:** known targets, compatible types and units, identity
   keys and valid references.
3. **Preview diagnostics:** execute the same interpreter on a bounded sample,
   without persistence, showing omissions, conversions and rejected emissions.
4. **Full-run diagnostics:** validate every record and emission during import;
   preview success does not certify unseen records.

Draft proposals may be incomplete so users can discuss and correct them.
Execution rejects any entity emission missing required identity or relationship
fields with an explanation identifying the rule, path and failure. Listing a
required field as unmapped documents the problem; it does not waive the
requirement. Nullable fields and conversion failures follow the explicit policy
described in [ADR-003](ADR-003-nulls-and-units.md).

Approval follows validation and preview, binding file hashes and mapping revision
before commit. The application orchestrates import; the domain interpreter owns
deterministic mapping behavior. Saved mappings replay with **no LLM call**,
including when the provider is disabled or replaced.

The machine-readable JSON Schema and reference TraceLab mapping are delivered
in the backend by [issue #4](https://github.com/fueledbycoffee/AgentScope/issues/4).
That PR will add links to both artifacts here once their paths exist. This ADR
defines the decision and deliberately does not supply a competing schema; this
handoff supersedes issue #3's original schema checkbox.

## Consequences

One interpreter handles manual and assisted mappings, preview and import. Its
bounded vocabulary makes behavior testable without trusting generated code.
Unsupported source structures remain explained limitations; expanding the
language requires an explicit versioned contract change.

## Alternatives considered

- Generated Python or JavaScript connectors: unsafe execution and no stable declarative replay contract.
- General expressions or JSONPath: broadens evaluation beyond the reviewed bounded capability set.
- DSL aggregation and joins: duplicates fixed domain/session and metric behavior inside mappings.
- Provider-specific executable mappings: breaks offline replay and couples imports to model availability.
