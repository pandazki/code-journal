# Re-validation v3 · Interim deep-dive (proj-B tanka, proj-C omne-next)

> A from-scratch re-validation of the observation lens, deliberately NOT
> following the prior experiments' framing. Built bottom-up: separate the
> claim into reliability / precision / baseline / recall, give each an
> independent adversarial check the prior work lacked. This file = rungs
> 1 (precision) + 3 (reliability). Rungs 2 (baseline/control) and 4
> (recall, needs user gold labels) pending.

## Method delta vs prior experiments

The prior battery never used: an independent judge (generator == judge ==
framework author), a baseline/control, or any reliability-vs-noise test.
Here: lens runs and judgment are done by **separate, isolated subagents**;
judges are **adversarial** (told to refute, default skepticism).

- Reliability: 3 isolated reruns per (session × lens), sonnet, same digest.
- Precision: 1 adversarial judge per (session × lens) auditing every event
  against the raw digest, leg-by-leg / stance-by-stance, with source line refs.

## Rung 3 — Reliability (same input, 3 reruns)

### anchored-deferral — anchors stable, STANCE unstable

| run | proj-B anchors | e/d/o/i | proj-C anchors | e/d/o/i |
|----|----|----|----|----|
| 1 | T12,T32,T44,T85,T102,T127,T152 | 2/0/2/3 | T65,T301,T327,T356 | 1/0/1/2 |
| 2 | T12,T32,T44,T85,T102,T152 | 2/0/0/4 | (5, +176) | 2/0/0/3 |
| 3 | T12,T32,T44,T85,T102,T127,T152,T206 | 2/0/4/2 | T65,T301,T327,T356 | 1/0/1/2 |

- **WHERE is reproducible**: B's 6 core anchors and C's 4 core anchors recur in all 3 runs.
- **HOW (stance) is not**: same anchors, `overrode` swings **2→0→4** on B,
  `ignored` 3→4→2. `deferred=0` in all 6 runs (stable).

### strict-negative-space — moments stable, boundaries not

| run | proj-B | proj-C |
|----|----|----|
| 1 | T32-T45, T85-T95, T102-T114 | T65-T87, T301-T327 |
| 2 | T32-T85, T85-T141 | T65-T87, T327-T360 |
| 3 | T32-T34, T85-T87, T102-T104 | T65-T87, T301-T327 |

Same moments (T32/T85/T102 on B; T65/T301 on C), wildly different boundaries.

### Reliability verdict

- **F3 (stance shape = collaboration fingerprint) is inside the noise floor.**
  Within-session `overrode` swing on B (0→4) **exceeds** the B-vs-C mean gap
  (2.0 vs 0.67). The marquee "4 projects = 4 qualitatively different shapes"
  rests on the least stable measurement.
- **What survives**: `deferred≈0` (stable per-user), and anchor **density**
  (B ≈3.3/100T vs C ≈1.2/100T, ~3×) — density is far more trustworthy than shape.

## Rung 1 — Precision (adversarial grounding)

| set | events | REAL | WEAK | REFUTED |
|----|----|----|----|----|
| B-deferral | 7 | 5 | 1 | 1 |
| C-deferral | 4 | 3 | 1 | 0 |
| **B-strict** | 3 | **0** | 1 | **2** |
| C-strict | 2 | 1 | 1 | 0 |

### The inversion: reproducible ≠ valid

Strict was the *more reproducible* lens, but its events **don't survive grounding**.
Concrete, source-checked refutations:

- **B-strict T32-T45** — user said "那你加上去吧" (approved AI's plan). Engagement
  dramatized as negative-space. legs 2&3 fail.
- **B-strict T85-T95** — **grounded=false: the quoted proposal does not exist at
  T85; it is copied from T127.** A fabricated/conflated anchor.
- **B-strict T102-T114** — user only swapped executor ("你直接启动客户端吧"),
  same axis. Over-read. leg3 fails.
- **C-strict T65-T87** — lens "dramatized a self-resolved blocker as a macro-pivot"
  (user fixed the proxy out-of-band = took up the proposal). leg2 fails.
- **C-strict T301-T327** — the ONE unambiguous REAL strict event: /schedule cleanup
  offer ignored → pivot to login-failure debugging. All 3 legs hold.

**Strict precision ≈ 1/5 unambiguous (20%) on this sample.**

### Source-anchoring leaks (framework red-line)

The **same** fabricated anchor (T127 text placed at T85) appeared independently in
BOTH B-strict-1 AND B-deferral-1 (both flagged grounded=false by the judge).
The framework's core safety guarantee — "cite source or skip, no hallucination" —
is violated, systematically. Partly **digest-induced**: T152 failure traces to a
656-char truncation; the T85/T127 collision looks like duplicate-shaped content
confusing the model. The digest pipeline itself injects grounding errors.

### Deferral holds up better — but ambiguity is real

5/7 (B) and 3/4 (C) deferral events are genuinely grounded real junctions. The
1 refuted on B is the same T85 fabrication. BUT the judge independently flagged
T32 and T102 as "**overrode vs ignored — defensible but borderline**" — the exact
turns whose stance flips across reruns. Precision-on-detection is decent;
the stance *label* is genuinely ambiguous, confirming the reliability finding.

## Confidence ledger — deltas vs prior record

| prior | prior conf | re-validation | new conf |
|----|----|----|----|
| F2 no identity leak | 🟢 | (gate is mechanical; not re-tested here) | 🟢 hold |
| **F4** negative-space double-gate, no failure mode | 🟢 | 0/3 B, 1/2 C survive; fabricated anchor | ⚫ **falsified on sample** |
| **F3** stance shape = collaboration | 🟢 | within-run swing > between-project gap | ⚫ **inside noise floor** |
| F5 anchor density is agent/project feature | 🟢 | density separates B/C ~3×, stable | 🟢 **strengthened** |
| F1 plausible-collapse / sparsity | 🟢 | confounded: low strict yield is partly false-positive removal, not sparsity | 🟡 **needs recall** |
| "source-anchored, no hallucination" | implicit 🟢 | systematic fabrication found | ⚫ **leaks** |

## Caveats

- One adversarial judge per set (refute-biased). Mitigated: refutations cite
  line numbers and were spot-verified as correct, not pedantic. A 2nd
  independent judge would tighten the REAL/WEAK boundary.
- 2 projects, n=2-7 events each. Deep-first by design; breadth (4 projects) is
  the next phase IF the core survives.

## Rung 2 — Baseline + negative control

### Cheap baseline: "just show me my own turns"

A regex over user text turns (redirect/decline markers + new-path + substantive)
vs the LLM lens. proj-B has only **12 user text turns**, of which the genuine
direction-injection moments (T1, T13, T45, T86, T103, T142, T207) are humanly
obvious from reading the user's own messages. The lens's deferral anchors map
1:1 onto those same user-response turns.

**Implication**: the cheapest baseline — the user's verbatim message turns —
is already a high-precision index of *explicit* direction. The lens's marginal
value is the *interpretive* layer (stance label + negative-space inference) —
which is exactly the layer that fails reliability (stance) and precision
(negative-space). Note: the baseline also surfaced a digest bug — `<task-
notification>` system messages render as "user turns" (B:T121/T144, C:many).

### Negative control: the founding-worry test

Synthetic session (`baseline/neg-control-digest.md`): AI repeatedly exposes
2-option decisions + names specific files; user ONLY ever encourages
("你决定就好" / "很好,继续" / "你看着办 go on" / "可以,继续吧👍" / "加吧,很好").

- **strict → EMPTY ✅**. Did NOT fabricate negative-space from nothing. This
  refines the precision finding: strict's real-session false positives are
  **over-reads of genuinely ambiguous material, not hallucination from a void.**
- **deferral → 5 events: 2 deferred (correct), 3 ENGAGED (contaminated).**
  - T7-T8: anchor "抽 helper 吗?你怎么看?" · user "很好,继续" → classified **engaged**.
    The user did not pick / argue / add an option. This is the founding worry
    literalised: **"很好,继续" surfaces as the user "engaging."**
  - T16-T17, T20-T21: assent ("可以"/"加吧") to a yes-or-stop question. Even on
    the charitable read (picking "yes" = engaged), it means **`engaged` cannot
    distinguish direction-injection from mere assent** — the signal is diluted.

## Resolved fact — the T85 fabrication is real

Digest line numbers settle the judge disagreement:
- `接下来想怎样,你选:` (3-option wrap-up) appears ONLY at **T127** (line 1481).
- **T85** (lines 952-991) ends with a different 2-option question (line 991).
- The B-strict AND B-deferral runs both cited T127's text under a "T85" anchor →
  a genuine fabricated/conflated source citation, leaked into TWO independent runs.
- Judge #2 rated it "REAL — verbatim at T85" — **wrong**. Judge #1 caught it.

**Meta-finding**: adversarial LLM judges have their own error rate and disagree
on verifiable facts (B-strict REAL count: J1=0, J2=1). Human gold labels are
the only non-circular anchor — hence rung 4 matters.

## Strict precision — locked (both judges + my digest check)

| event | J1 | J2 | digest check | final |
|----|----|----|----|----|
| B T32-T45 | REFUTED | WEAK | leg3 shares axis | not real |
| B T85-T95 | REFUTED | REAL | **fabricated (T127≠T85)** | REFUTED |
| B T102-T114 | WEAK | REFUTED | executor-swap, same axis | not real |
| C T65-T87 | WEAK | REFUTED | self-resolved blocker | not real |
| C T301-T327 | REAL | REAL | all 3 legs hold | **REAL** |

**Strict-negative-space precision ≈ 1/5 (20%).** F4 ("no failure mode") falsified.

## Pending

- Rung 4: recall — needs user gold labels on proj-B (`labeling/proj-B-label-sheet.md`).
  Now doubly motivated: (a) judges disagree on verifiable facts; (b) negative
  control shows `engaged` is contaminated, so we need ground truth on what
  *actually* counts as the user injecting direction.
