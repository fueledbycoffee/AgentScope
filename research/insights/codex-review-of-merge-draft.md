# Codex review of MERGE-DRAFT.md

References below use merge section numbers; C and O refer to the two source brainstorms.

1. **§1.3: the interval correction mixes aggregation grains.** Known wall-latency sums are **21.092045 h** (Claude 53,918,497 ms; Codex 22,012,865 ms). Unioning timestamps across all sessions gives **18.858869 h**, matching the draft's 18.86. But summing each session's union gives **18.872055 h**: Claude **12.973647 h**, Codex **5.898409 h**. The corresponding summed session spans are 27.167542 h and 429.053704 h; within-session union/span is **47.7542% / 1.37475%**, reproducing O's **47.8% / 1.4%**. Thus O's 21.1 h union headline is wrong, but the draft's explanation of the provider percentages is also wrong: 12.960461 h is a cross-session union. State the grain and compare like populations in §§4.3 and 7.1.3. Neither union establishes active work; call it “observed tool-interval coverage.”

2. **§1.3: percentile and retry checks.** With 80 occurrence-counted sessions, nearest-rank p90 is the 72nd ordered count, **139**; inclusive linear interpolation gives **139.6**. Nearest-rank p25 is **4**. `Read` p90 is **288 ms** nearest-rank and **280.8 ms** linear (281 after rounding). There are **296** Boolean-true errors, **288** with a following tool in `(round_index, tool_index)` session order, and **196** followed by the same tool name: **68.0556%**, rounded to 68.1%, not “68.1% exactly.” Eight terminal errors are excluded. This is an eligible-adjacency denominator, not a replacement for the known-status denominator. O D3 also mentions missing-result chain breaks; the published aggregate must specify whether those impose further exclusions.

3. **§1.1 overstates substantive agreement.** Row 12 conflates C Catalogue F1 (known reasoning-token totals/distributions) with F2 (the paired ratio diagnostic); the ratio is not our shared production metric. Row 18 must not imply endorsement of O H1's comparable-metric allow-list: I do not endorse cross-provider prefix reuse, “think-time,” or latency by an unvalidated tool class. Row 2's “cost lives in long sessions” must say recorded workload; compatible token concentration is not measured cost. Row 16 must retain the distinction between per-call composition and distinct text aggregated over snapshots. Row 17 is a later adjacency candidate, not an agreed retry feature.

4. **§1.2: “identical in both docs” is too strong.** O F1 prints 46.2%, while C §6 prints 46.15%; these are compatible rounding of 711,948 / 1,542,659. Separate shared counts from differently rounded summaries. Retain C's provider p90s **112 / 155**, five-bin counts **23 / 18 / 13 / 12 / 14**, and Claude creation/uncached totals **8,114,953 / 64,203** as reference expectations for shortlist #5–6, rather than losing the numbers needed to check those views.

5. **§§2–3 misclassify and overinterpret positions.** The §3 adversarial-fixture row says the sample exercises neither duplicate IDs nor out-of-order timestamps; it contains **212** timestamp-inverted arrays (C §5). Missing endpoints and endpoint/duration consistency are already in C G3, so related §2 diagnostics are not wholly unique to O. Warm-up overlaps C B3's first-observed-versus-later trajectory proposal, though O supplies the measured buckets. Remove §2's unsupported claims that first rounds carry essentially all cache-creation *cost*, low-output calls are explained as compaction/classification, and endpoint reconciliation licenses latency “without a caveat.” Those are interpretations the measurements do not establish. Also, 100-million-scale values do not themselves explain browser integer precision loss (§3 `payload_text` row); exact raw display remains the requirement.

6. **§§4.1, 4.6, 4.9–4.10 misstate the boundaries I proposed.** C A2 explicitly permits an optional source-specific prefix/new-input split after extraction and definition work; “raw evidence only, no metric” is my current dashboard boundary, not a permanent prohibition. C D3 permits later weak adjacency sequences with a declared window and eligible denominator; command identity is required for a stronger *retry* claim, not every sequence view. C D4 prohibits summing snapshots *as distinct text*, not every conceivable explicitly defined snapshot statistic. C F1/H1 allow descriptive within-compatible-group model summaries; I reject causal/performance rankings and an unvalidated reasoning-share interpretation, not all model comparison.

7. **§§4.7–4.8 and 4.12 need reframing.** My cache panel is conditional P3 and explicitly deferrable if baseline/second-source work slips; it is not an unconditional timebox commitment. The zero-latency disagreement is about evidence for invalid instrumentation, not whether exclusion is visibly labelled: preserve reported legitimate zeros until validation justifies a changed validity rule. O already permits flagging. Concentration is compatible at table level; the dashboard placement differs, and O's final shortlist actually puts concentration later. Do not present O A2's optional KPI as an unconditional fifth headline.

8. **§5: restore prerequisites before expanding scope.** Correct accounting partitions in the existing token chart (#7) are baseline correctness, not stretch. Exact provenance/metric definitions, an ordered session-to-occurrence path (#8), and import outcome reporting (§6) likewise belong to P0/baseline. Restore the omitted reference checks: multi-tool joins count call tokens once, null statuses stay unknown, mixed tags partition, re-import is idempotent, and drilled populations reconcile. Duplicate-ID coverage and the second-source/release gates cannot all move to “later.” My entire analytical increment was P1–P3, with an explicit fallback to P1 plus a plain session summary if time slips.

9. **§5 #3–4 are new priority choices, not my minimum.** A dashboard error KPI replaces one of the four slots; it is not an additional agreed requirement. Put the calls/time toggle behind the tool table as optional scope, label “summed recorded tool wall latency,” show known/all coverage, partition by source/harness, and keep zeros pending validation. `Agent` does not prove a linked nested session (C §4). For #6 require the same paired, reconciled population for numerator and denominator; for #8 “TL complete” must be field-specific, preserve unknown statuses, and make equal-time ordering uncertainty visible. Unsupported Codex project mapping should be explainable beyond “Unknown project.”

10. **§§6–7 omit qualifications.** I defer automated findings/anomaly suggestions to a validated later stage (C Later work, stage 8); I do not reject them forever. Natural-language data questions are outside v0.1.0, not a demonstrated permanent joint rejection. “Think-time proxy” still overclaims mixed-event bounds: use “observed call event span” (C C4/limits). §7.1.9 must gate individual metrics: unvalidated token grain does not ban every count or timestamp comparison forever. §7.2's n<30 suppression is an unresolved O/C difference; my policy is visible n and documented product thresholds, not an automatic statistical cutoff. Raw model labels are shared with O H3, not Codex-only. The introduction and §1.3 incorrectly direct owner questions to §7; they are in §8.

The ten owner questions should be revised as follows:

- **§8 Q1:** Keep prices outside v0.1.0. Remove the claim that ~96% prefix implies a billable cache discount; that is precisely unvalidated for Codex. Do not attach an unsupported “most of a day” estimate.
- **§8 Q2:** Ask whether to fund a separately defined source-specific prefix metric now or defer it. A billing disclaimer alone does not validate “reuse,” and raw extensions need extraction/tests before becoming dashboard inputs. Do not attribute a permanent no-metric veto to C.
- **§8 Q3:** Counts are actionable navigation into large workloads, not a dashboard that “states nothing a user could act on.” “Zero API churn” also overpromises: semantics groups and coverage must survive the response contract. State the concrete slot replaced by a hybrid.
- **§8 Q4:** Ask whether aggregated observed span deserves a headline. Neither placement answers “how long did this take,” and a gap between spans and tool intervals does not measure idle or active work.
- **§8 Q5:** Options (a) and (b) largely overlap. Partition by validated compatibility and refuse incompatible sums; sharing `unknown` or an unvalidated tag is insufficient. Incompatible token pooling is not a supported product choice merely because it carries a label.
- **§8 Q6:** Adopt nearest-rank quantiles plus averaged even-n medians; declare display precision independently. If linear is chosen, publish underlying 139.6 / 280.8 and their rounding rule. Do not leave metric semantics to accidental implementation defaults.
- **§8 Q7:** Keep the ordered table now and the rich timeline later. Hiding a timeline behind a control does not reduce its required implementation or verification scope.
- **§8 Q8:** Replace “[C] defer entirely until command identity exists” with “defer the adjacency feature beyond v0.1.0; require identity/linkage before calling it retry.” A future explicit adjacency report need not wait for command identity. Remove the unsupported loop-recovery framing.
- **§8 Q9:** Separate known reasoning-token totals by compatible model group from the unvalidated reasoning/output ratio. The diagnostic restriction is about accounting meaning, not whether the result is “dull”; descriptive model reporting is permitted with scope and coverage.
- **§8 Q10:** Options (b) and (c) are effectively the same include-and-flag policy. Ask what source evidence would justify invalidating measurements; do not assume the generation was uninstrumented or treat every recorded zero as valid regardless of subsequent evidence.

Reproduction: run this read-only stdlib snippet from the repository root. It counts occurrences without native-ID deduplication; adjacency uses recorded round order and array position. It computes both union grains explicitly.

```python
import collections as c, datetime as d, gzip, json, math, statistics as s
with gzip.open('fixtures/tracelab/tracelab-sample.jsonl.gz', 'rt') as f:
    rows = [json.loads(line) for line in f]
groups = c.defaultdict(list)
for r in rows:
    groups[r['provider'], r['session_id']].append(r)
sizes = sorted(map(len, groups.values()))
print('p90 nearest/linear', sizes[math.ceil(.9*len(sizes))-1],
      s.quantiles(sizes, n=10, method='inclusive')[8])
def ts(x): return d.datetime.fromisoformat(x.replace('Z', '+00:00'))
def union(intervals):
    merged = []
    for a, b in sorted(intervals):
        assert a <= b
        if merged and a <= merged[-1][1]:
            merged[-1] = merged[-1][0], max(merged[-1][1], b)
        else: merged.append((a, b))
    return sum((b-a).total_seconds() for a, b in merged) / 3600
wall, per_session, pooled = c.Counter(), c.Counter(), c.defaultdict(list)
errors = eligible = same = 0
for (provider, sid), rr in groups.items():
    tools = [t for r in sorted(rr, key=lambda r: r['round_index']) for t in r['tools']]
    wall[provider] += sum(t['tool_wall_latency_ms'] for t in tools
                         if t['tool_wall_latency_ms'] is not None) / 3600000
    intervals = [(ts(t['emitted_at']), ts(t['result_at'])) for t in tools
                 if t.get('emitted_at') and t.get('result_at')]
    per_session[provider] += union(intervals)
    pooled[provider].extend(intervals)
    errors += sum(t.get('is_error') is True for t in tools)
    for a, b in zip(tools, tools[1:]):
        if a.get('is_error') is True:
            eligible += 1
            same += a['tool_name'] == b['tool_name']
print('wall-sum hours', dict(wall), sum(wall.values()))
print('summed session-union hours', dict(per_session), sum(per_session.values()))
print('pooled union hours', {p: union(v) for p, v in pooled.items()},
      union([i for v in pooled.values() for i in v]))
print('errors/eligible/same/percent', errors, eligible, same, 100*same/eligible)
```
