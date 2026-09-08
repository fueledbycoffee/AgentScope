BLOCK

Second-pass design review of Revision 2 for issue #39 on `feat/39-assistant-field-table`, 2026-09-08. Four of the original seven P1s are closed in the design; three remain open. “Closed” means the revised contract addresses the finding, not that an implementation has passed verification.

Read the supplied `BRIEF.md` and `issue-39.md` in `/Users/sean/.claude/jobs/fcddadde/tmp/wave1/`, the revised plan, the first Codex review, and the relevant assistant/runtime/API, DSL schema/parser, import, and Playwright code. All plan line references below refer to `docs/superpowers/plans/2026-09-08-assistant-field-table.md`. Only this review file was written; no git writes. Verification was source inspection plus an in-memory parser probe using the main checkout's Python environment with bytecode writes disabled. The default Python was too old (`StrEnum` unavailable); the environment-backed probe succeeded. No implementation suite or browser pass was run.

1. **Original P1-1 — CLOSED: remove the parsed-object numeric fallback.**

   Plan §3.6, lines 409–418, explicitly removes the fallback for both proposal extraction and saved-document loading, requires an object that passes the grammar, and preserves text, version, undo, validation, saved and preview state on failure. This directly replaces the problematic `JSON.stringify` plus validation attachment in `web/src/assist/assistRuntime.ts:254–267`. The existing raw transport is compatible: `web/src/api/index.ts:77–100,107–121` sends document text verbatim and retains the run response text. Keeping already-earned gates for the unchanged document is correct; attaching the failed outcome's validation is forbidden. The test contract still needs the correction in finding 8 below.

2. **Original P1-2 — CLOSED: grammar, decoded keys, duplicates and offset units.**

   Plan §3.1, lines 159–177,200–210, and §3.4, lines 370–376, now specify single-value JSON grammar including legal scalar/escape syntax, matching delimiters, separators and EOF, decoded-key lookup, duplicate-container repair, and UTF-16 code-unit offsets. These address the current permissive tokenizer and raw key comparisons in `web/src/assist/jsonText.ts:13–42,96–121,155–164`. The grammar suite at plan lines 532–536 includes malformed and non-ASCII cases. This closes safe addressing of an input document; preventing a batch from creating new duplicate keys remains part of P1-3.

3. **Original P1-3 — OPEN, partially addressed: batch conflicts and composition are still incomplete.**

   Plan lines 214–232 materially fix comma ownership: paths address the input snapshot, a renderer owns separators, creation allows only a missing leaf, and the result commits once through `editDocument` (`web/src/assist/assistRuntime.ts:89–99`). Adjacent removals and simultaneous insertions now have a plausible algorithm and tests at plan lines 538–545.

   However, the conflict list only rejects same-path operations, descendants of a removal, existing-key rename collisions and bad insertion indices. For input `{"unit":{"from":"s","to":"ms"}}`, a batch setting `unit` to `{"from":"us","to":"ms"}` and setting `unit.from` to `"min"` passes those rules. Innermost-first rendering followed by the outer set can silently discard the child edit; JSON grammar validation still succeeds. Similarly, renaming both `a` and `b` to previously absent `c` in `{"a":1,"b":2}` needs a collision check across the final member set, not only against existing input keys. Array move destinations after removals/inserts and propagation of a child's edited raw value through a move are also undefined.

   **Required:** reject descendant edits beneath a whole-value set unless an explicit composition rule supports them; check final decoded keys across renames and new members; define array destination/tie semantics and child-edit propagation under rename/move. Add these exact batch cases and assert failure leaves text, version, undo and gates unchanged. The final grammar check alone cannot detect discarded edits or duplicate keys. This is a remaining part of the original P1, not a request for broader editing features.

4. **Original P1-4 — CLOSED: complete the table's DSL surface.**

   Plan lines 260–265,277–318 add distinct raw states, both transform forms, field add/delete, document metadata, identity-to-document edits, an always-editable/removable default, and raw object/list condition values. Rule rename/delete may safely refuse referenced rules, with explicit parent editing retained (lines 299–305,655–657); automatic cascades are not required. These choices match schema document/rule/condition/field definitions at `backend/src/agentscope_app/domain/mapping/mapping-dsl-v1.schema.json:7–16,29–52,80–109`, and parser requirements at `backend/src/agentscope_app/domain/mapping/parser.py:245–301,304–385`. The named usable-new-rule and option tests at plan lines 575–582 are appropriate. Undo and JSON-view identity synchronization still need an explicit transition rule, recorded as P2 finding 9 below.

5. **Original P1-5 — OPEN, partially addressed: a closed-domain match still does not establish the intended operation.**

   Plan lines 365–368 correctly anchor chips and Why to the post-application document version, fixing the generation mismatch in `web/src/assist/assistRuntime.ts:258–267`. Cutting profile-path suggestions removes the missing-profile/source-replacement problem. The operation contract at plan lines 339–363 remains contradictory and incomplete:

   - `Ambiguity` still provides only a target, option strings and prose (`web/src/api/types.ts:168`). Excluding open domains from the candidate set does not establish that field-targeted `true` means `empty_as_missing` rather than a literal. The plan calls `true` a multiple-candidate example but lists only one operation; its formal rule therefore auto-selects it.
   - `reject` belongs to both policy enums (schema lines 97–99; parser lines 567–597), yet plan line 557 expects `reject → on_missing`. An in-memory call to the actual parser accepted both policies together with no issues. That test encodes the same guessing defect as revision 1.
   - Plan lines 349,558 require a `min` choice between bounds and `unit.from`, while lines 354–360 exclude single-value unit suggestions and require an explicit unit pair. Those cannot both define the implementation.
   - “DSL option of a field” is not semantic applicability. `type` must match the target type, bounds requires a timestamp target and wildcard `path`, and unit conversion must end at the target's canonical unit (`parser.py:439–473,498–559`). The actual parser probe rejected `bounds:min` and `type:integer` on session `external_id`. The candidate formula does not specify these filters.
   - Exact option-target normalization remains unspecified: `rules[0].fields.x.on_invalid` must retain the operation while resolving its owning field, not be treated as a field or lose the suffix. The first review did not accept this part as solved, contrary to plan line 339.

   **Required:** retain an explicit option target when supplied; otherwise require the user to select a named operation even for a single supported candidate when the target identifies only a field. Unsupported meanings stay prose. Define target-type/source applicability and required accompanying values, reconcile `reject`/`true`/`min` tests with the chosen smaller catalogue, and enforce the anchor again in the apply action. At least one explicit, safe operation beyond timestamp format suffices; no broad inference catalogue is needed.

6. **Original P1-6 — OPEN, partially addressed: source preservation is fixed, but failed-retry semantics remain false.**

   Plan lines 427–435,449–464 now carry the exact per-file binding and report source, select a file for a multi-file rejects action, load by mapping id, and distinguish mapping identity from execution source. This addresses `web/src/pages/Assist.tsx:160–165` using `saved.record.source` and `web/src/pages/Imports.tsx:137–171` defaulting to All files. The backend really resolves duplicates by the requested source (`backend/src/agentscope_app/application/use_cases/imports.py:353–377`). These parts are closed.

   The remaining assertion at plan lines 471–472, “That attempt inserted nothing, so importing these bytes into A is a normal import, not a duplicate,” is false. `imports.py:328–344` explicitly records a lost concurrent-import race as failed for every file, even though another import committed some of those bytes. Retrying then reaches `find_committed` and can be a duplicate. An older failed attempt can also be reopened after a later successful one. Failure establishes what that attempt wrote, not current absence of the bytes in the source.

   **Required:** say that the failed attempt inserted nothing and retry will be deduplicated against current committed bytes for the selected source. Use the selected file's status in mixed reports. Carry nullable `duplicate_of` in origin to support the promised original-import link (currently omitted at plan lines 427–430; available in `web/src/api/types.ts:16–20` and already used in `Imports.tsx:76–79`). Add failed-race/later-success retry, committed/duplicate mixed batch, source A versus mapping source B, and two-file/two-mapping identical-filename cases. The single-file happy-path e2e at plan lines 600–607 does not establish these cases.

7. **Original P1-7 — CLOSED: test discovery and existing JSON-view assumptions.**

   Plan lines 519–522,600–610 explicitly add the Playwright config and old assistant spec, a third project depending on `assistant`, a discovery listing and execution evidence, and selection of JSON in tests that query its textarea. This fixes `web/playwright.config.ts:29–34`, whose two matchers exclude the new filename, while preserving smoke-before-assistant ordering. The old assumptions are present at `web/e2e/assist.spec.ts:55–64` and `web/src/pages/Assist.test.tsx:93,101`. Direct API upload for the new spec avoids #45's upload selectors. The existing spec still uses `/import` selectors at lines 14–25, so shared-flow coordination remains necessary during implementation; closure here is of the discovery/default-view design defect.

Additional findings from Revision 2:

8. **[P2] The codec test now contradicts successful escaped-key extraction and leaves boundary coverage implicit.**

   Plan lines 409–411 require escaped envelope keys to work, but lines 566–568 list an escaped envelope key as a negative case that must leave the document unchanged. The displayed example is actually plain `{"proposal": …}`; similar examples at lines 53,202,403 have lost their escape spellings. Use literal raw fixtures such as `{"\u0070roposal":{"mapping":{"literal":1.0}}}` and `{"fields":{"\u0078":{"literal":9007199254740993}}}` as positive cases, including editing the decoded field itself. Missing/wrong-type mapping members, invalid grammar and duplicate envelope keys are negative cases; assert unchanged previously validated/saved state and no new outcome validation.

   Name browser transport cases for saved-document GET and prepare/run/validate/save, not just one unspecified mocked fetch. Their separate helper paths exist at `web/src/api/index.ts:54,77–100,114–121`. Use span text for exact JavaScript integer assertions and Python integer/type assertions for the real server test. The narrower response-to-request lexeme guarantee and planned real save/get test at plan lines 398–405,570–573 are otherwise appropriate for `interfaces/api/schemas.py:63–93` and `routers.py:110–129`.

9. **[P2] Atomic identity edits need matching undo and JSON-repair behavior.**

   Plan lines 230–232,309–312 combine identity and document changes but retain the runtime's text-only undo model. `web/src/assist/assistRuntime.ts:53,89–117` stores/restores only document text. Rename identity A to B, then undo: restoring document A without identity A makes the next revise fail at lines 174–176. A direct JSON name/source edit has the same missing reverse-sync policy. Define synchronization for every accepted document replacement, JSON repair and undo (or explicitly include identity in the undo snapshot), retaining the user's identity while JSON is malformed. Test identity rename → undo → revise and malformed JSON → repaired identity → revise; do not require users to discover a second identity repair after Undo.

10. **[P2] Option (a)'s half-day margin has no capacity calculation behind it.**

   Plan lines 703–717 total approximately four engineer-days and explicitly acknowledge three calendar days remaining, but lines 719–721 then assert roughly half a day of margin without identifying additional capacity. Even four completely available working dates from September 8 through 11 provide no half-day reserve against four days of work, and current review fixes remain unestimated. A green step 1 establishes only the grammar/editing foundation and receipt selector; roughly 3.1 estimated days, shared-file integration and release verification still follow it. Remove the unsupported fit claim. If the owner nevertheless considers (a), the gate must include a fresh remaining-work/capacity estimate and a dated no-go decision that preserves verification time. The sprint explicitly separates feature freeze from clean-clone/rehearsal/release work (`docs/planning/2026-09-07-consolidated-plan.md:118–122`).

Release recommendation (five lines):

1. Choose (b): ship v0.1.0 with the existing #15 JSON slice and land the complete #39 in v0.1.1.
2. The revised estimate is four engineer-days before a September 11 freeze, with no demonstrated integration or review-fix margin.
3. Three P1 contracts remain open; a green step 1 would still leave most UI, report and acceptance work unfinished.
4. Making #39 the only remaining feature work does not remove coordination with #10/#33/#45 or clean-clone and release verification.
5. Keep the step-1 correctness gate for v0.1.1, close these findings, and deliver all six #39 criteria without another acceptance split.

REVIEW-DONE
