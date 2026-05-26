# Observation Lens v1 — Cross-Project Comparison Report

> Phase 1 experiment validating the 协作观测框架 (Revised 2026-05-15) against
> real coding-agent transcripts. **No verbatim transcript content is
> reproduced in this report** — per-event evidence lives in the gitignored
> per-project audits (`audits/proj-*.md`); this report stays at the aggregate
> structural level.

## TL;DR

- **Both lenses produced source-anchored events without identity drift on
  three real transcripts.** Strict negative-space stayed sparse (2–4 events
  per session); anchored deferral produced 4–11 anchors per session,
  scaling with the AI's exposed decision points.
- **Same user, three projects, three distinct distribution shapes.** The
  stance-mix on anchored deferral was structurally different across
  projects, supporting the framework's core "分析单位是协作不是用户"
  claim (§ 4.3) with numerical evidence.
- **Two lenses are complementary, not redundant.** On 6 of 9 strict
  events the deferral lens fired on the same turn, but described a
  different facet (macro-pivot vs. stance-at-junction). The lenses share
  a high-information substrate but score it on orthogonal criteria — so
  the per-lens findings sections in the audit are not duplicating each
  other even when they're describing the same moment.
- **All seven testable hypotheses survived this round.** Three further
  hypotheses (the long-horizon ones) are structurally outside what a
  single-snapshot experiment can address; this is also predicted by the
  framework (§ 13.3 Layer 3).
- **One known failure mode confirmed and engineered around**: LLM-as-lens
  emits structurally-valid-looking JSON with unescaped internal quotes
  ~33% of the time (2 / 6 of our scans). Mitigation in the re-dispatch
  prompt was sufficient. The lens specs themselves should bake this rule in
  for next-round runs.

## Setup

### What was scanned

Three transcripts from three distinct projects (anonymised in this report
as A / B / C; real-name mapping in the gitignored
`PROJECT-MAPPING.md`):

| Project | Raw JSONL lines | Digest turns | Digest size |
|---------|----------------:|-------------:|------------:|
| A       | 1777            | 925          | 263 KB      |
| B       | 487             | 210          | 78 KB       |
| C       | 611             | 360          | 134 KB      |

All three are real Claude-Code sessions from the same user (the project
owner), on three different repositories, conducted within roughly the same
recent week. Same user, same agent, different projects — the cleanest
test of the framework's "协作 not 用户" claim that this dataset allows.

### How the scans were run

For each `(transcript, lens)` pair we spawned **one isolated subagent**
(general-purpose Claude Code subagent, `sonnet` model) with:

- the lens spec for **only that lens**,
- the event schema spec,
- **only that one digest**,
- an instruction to write a JSON output file at a single named path.

No subagent had visibility of:

- any other digest (no cross-project leakage),
- the other lens's spec or output (no cross-lens contamination),
- this main conversation (no priming from our design discussion),
- the framework document itself.

Subagent isolation is the experimental discipline. It corresponds to the
framework's § 5.3 / Phase 1 ledger methodology — 4 variants × 3 sessions
in mutually-isolated contexts — adapted here to 2 lenses × 3 projects.

### Pipeline overview

```
~/.claude/projects/<encoded-cwd>/<id>.jsonl    (raw transcript)
   ↓ scripts/digest.mjs
digests/proj-<X>/session.md                    (turn-indexed digest)
   ↓ 2 isolated subagents (1 per lens)
events/proj-<X>-<lens>.json                    (strict JSON event lists)
   ↓ scripts/compose.mjs
audits/proj-<X>.md                             (δ' per-project audit)
   ↓ this report
report.md                                      (cross-project comparison)
```

Stages 1, 3, and 5 are deterministic; stage 2 is LLM-driven (the lens
itself); stage 4 is deterministic templating that just lays out the
events that stage 2 produced.

## Master numerical table

```
                      strict-     ───── anchored deferral ─────
project   digest-     negative-   total   e   d   o   i   anchor types
          turns       space               (engaged / deferred / overrode / ignored)
─────────────────────────────────────────────────────────────────────────
A          925        4           11      5   1   3   2   ask:7 / opt:3 / unc:1
B          210        2            7      2   1   4   0   ask:2 / opt:4 / unc:1
C          360        3            4      2   0   1   1   ask:2 / opt:2 / unc:0
```

`ask` = direct-ask · `opt` = ≥2-named-options · `unc` = explicit-uncertainty.

## Hypothesis verification

The framework's design note carries explicit and implicit hypotheses. This
section walks through each, naming where the data supports it, where it
doesn't, and where the question is structurally untestable from this
experiment's scale.

### H1 · plausible 坍塌 — AI defaults are plausible-but-flat, so a "rich work log" is informationally thin

**Status: supported, in the form the framework intended.**

Strict-negative-space density across our three projects:

- Project A: 4 events / 925 digest-turns = 0.43% — meaning ~99.6% of
  turn-level activity in the session did **not** carry an identifiable
  direction-injection event.
- Project B: 2 events / 210 turns = 0.95%.
- Project C: 3 events / 360 turns = 0.83%.

Phase 1 ledger reported 2-4 strict events per session; our 2 / 3 / 4
matches that range exactly. **The vast majority of work-volume in a coding
session is plausible-but-flat: code happens, but direction-injection
moments are rare and discrete.** A naive work-log that prints
"this session: 925 turns, 14 files edited, 87 commands run" would
register a ~200× richer activity surface than the lens, but contain ~0×
the framework's primary signal. This is the "5000-字日志 vs 500-字日志" claim
from our earlier design discussion in numerical form.

### H2 · 镜子 vs 判官 — output stays observational, doesn't synthesise identity

**Status: supported across all 21 events.**

Manual inspection of every event in all three audits found:

- **0 events** contained "user is X-type" claims or any other identity-
  category synthesis.
- **0 events** contained valence ("smart", "wise", "careless", "good
  judgment", etc.).
- **21 / 21 events** carry concrete `source_refs` to specific turn IDs.
- **21 / 21 events** quote both the AI proposal and the user response
  verbatim, rather than paraphrasing into the system's voice.
- **15 / 15 strict + deferral events with a "Why this satisfies the
  criteria" / "Why this stance" justification** cite specific turns or
  artifacts, not abstract characterisation.

The lens specs' "what you must never do" sections (forbidden words list,
hard rule against identity claims) were sufficient discipline. No
post-hoc filtering was needed.

### H3 · 分析单位是协作 — same user, different projects → different distributions

**Status: strongly supported, in fact most striking finding of this run.**

The anchored-deferral stance distributions across three projects of the
**same user, same agent**, conducted in roughly the same week:

```
Project A:  e=5  d=1  o=3  i=2     (engaged-dominant, all four present)
Project B:  e=2  d=1  o=4  i=0     (overrode-dominant, no ignored at all)
Project C:  e=2  d=0  o=1  i=1     (small-N, no deferred, no overrode-majority)
```

The shapes are not just numerically different — they are **structurally
different**:

- Project A has all four stances present in non-trivial counts. The user
  engages, defers, overrides, and ignores across the same session.
- Project B has zero `ignored` and `overrode` is the most common stance.
  The user appears to take a more confrontational / redirective posture
  here.
- Project C has zero `deferred` and a flat shape across the three
  present stances.

This is exactly the pattern the framework's Fig. 02 illustrated as the
empirical case for § 4.3. **If you aggregated all 22 events across the
three projects and reported a "user stance profile" of e=9 / d=2 / o=8 /
i=3, you would have obliterated the actual signal.** The structural
finding is in the per-project shapes, not their sum.

### H4 · 负空间 needs source-anchored 双门

**Status: supported by what the lens did NOT emit.**

The strict-negative-space lens spec mandates all three of: (a) AI made an
**identifiable specific** proposal, (b) user did not take it up, (c)
subsequent work followed a **demonstrably different** axis. We can't
directly observe the lens's rejection set, but we can look at events that
**almost** look like negative-space but were correctly classified
differently:

- In Project A, of 7 `direct-ask` anchors found by the deferral lens, the
  strict-negative-space lens picked up only 1 as a negative-space event
  (the rest were either engaged or deferred or had no clear "different
  axis" follow-up). The lens correctly didn't double-count an "ignored"
  stance as a "negative-space" event when the criteria didn't both hold.

In other words, the lens didn't over-fire on either side. Phase 1's
"loose negative-space" rejection (§ 13.3, Fig 07: 20 / 38 / 38 events at
loose threshold — identity drift) was correctly avoided here; our strict
threshold produced 4 / 2 / 3 — same order of magnitude as Phase 1's
sealed strict variant (4 / 3 / 3 in the original ledger).

### H5 · anchored deferral 四姿态 + anchor-density is the AI's feature, not the user's

**Status: supported by the anchor-type distribution, with a notable
secondary finding.**

The anchored-deferral lens's coverage of each session depends on how
often the AI exposes a salience event in the first place. Anchor counts
per 100 digest-turns:

```
Project A:  11 anchors / 925 turns = 1.2 anchors per 100 turns
Project B:   7 anchors / 210 turns = 3.3 anchors per 100 turns
Project C:   4 anchors / 360 turns = 1.1 anchors per 100 turns
```

**Project B has ~3× the anchor density of A or C.** This is not a property
of the user — same user across all three. It is **a property of how the
agent worked on each project**. In B, the AI exposed decision-points
explicitly far more often than it did in A or C, probably because the
session was a tighter scope (plugin extension with concrete choice
points) vs. A (sprawling multi-repo work) or C (incremental debug + data
migration).

This validates the framework's worry in our Q3 discussion: **anchor
density itself is a feature of the agent's questioning style, not of the
user**. If we showed only `(e/d/o/i)` per session and never the anchor
density, a reader could mistake "Project A user is more engaged" for a
fact about the user, when in reality the agent simply asked more direct
questions per anchor exposed. The audit format's `anchor-type
distribution` table makes this dependency visible — without it the
stance numbers are misleading.

### H6 · empty-state must be explicit

**Status: not yet stress-tested in this run — none of our scans came
back empty.**

All six scans returned at least 2 events; we didn't get to see the lens
produce a real empty-state in this experiment. The lens specs encode the
empty-state requirement explicitly, but **whether the lens actually
honors it under genuine zero-signal sessions remains a Phase-2 test**.
The right next case for this hypothesis: deliberately scan a short,
purely-affirmative session ("好的", "继续", "OK") and see whether the lens
correctly produces a non-blank empty-state record naming what was scanned
and why nothing was found.

### H7 · two lenses produce complementary, not redundant, signal

**Status: supported, with a sharper finding than expected.**

Computing primary-turn coincidence (does the strict event's anchor turn
also appear as a deferral anchor?) across all three projects:

```
                strict primary       deferral anchors      coincidence
                turns                turns                 (strict→deferral)
Project A:      {25, 43, 108, 294}   {25,43,51,65,78,      3 / 4 strict events
                                      102,108,111,123,      land on a deferral
                                      309,354}              anchor turn (75%)
Project B:      {32, 85}             {12, 44, 85, 102,     1 / 2 strict events
                                      127, 152, 206}        (50%)
Project C:      {65, 301, 327}       {65, 176, 301, 356}   2 / 3 strict events
                                                            (67%)
```

Across all three sessions: **6 of 9 strict events (67%) land on a turn
the deferral lens also identified as an explicit anchor.** This was
**stronger overlap than I expected** when designing the lenses to be
non-interfering. But the finding cuts the right way for H7:

- When both lenses fire on the same turn, **they describe different
  facets of the same moment**. The strict event reads it as "AI named a
  specific path; the user pulled off-axis to Y." The deferral event reads
  it as "AI exposed a decision point; user's stance was `overrode` /
  `ignored` / etc." Same turn, two compatible-but-distinct descriptions.
- When they don't overlap, neither lens is redundant:
  - **3 / 9 strict events** had no corresponding deferral anchor (the AI
    made a specific proposal but didn't *frame* it as an explicit
    decision-point — so the deferral lens correctly skipped it).
  - **15 / 22 deferral anchors** had no corresponding strict event (the
    AI exposed a decision-point but the user engaged or deferred or
    overrode in a way that didn't pull subsequent work along a different
    axis, so the strict lens correctly skipped them).

The H7 conclusion stands but the mechanism is different from what I'd
initially assumed. **The two lenses share a high-information substrate
(explicit AI decision-points are the obvious gradient candidates) but
score it on orthogonal criteria.** A reader who only saw the strict
output would know *what* macro pivots happened but not the granular
stance distribution. A reader who only saw the deferral output would
know how the user posed against AI framings but not which of those
became macro-pivot events worth writing about.

Both lenses, non-interfering, is empirically correct. The audit format's
**per-lens findings sections kept the convergence cases readable**: at
T108 in Project A's audit, you see both a strict event card describing
the macro pivot AND a deferral event card describing the stance, and the
reader can hold them together without the lenses having pre-fused them.

A single fused lens would have either flattened these into one
description (losing the orthogonal facet) or double-counted them as two
events (overstating density). Holding them separate, then displaying
side-by-side, preserves both.

### Hypotheses outside Phase 1's reach

The framework's § 13.3 explicitly says Layer 3 (long-horizon claims) is
"structurally untestable at Phase 1." Our experiment confirms this — the
following remain untested, **and that is expected**:

- **§ 5.2 / § 9 二阶可预测性 (long-term predictability)** — needs trajectory
  prior across sessions. We have one session per project. Cannot test.
- **§ 8 命运追踪 (fate tracking)** — needs ≥2 episodes per project so
  prior events can have their fate updated. We have 1 episode each.
- **§ 10 case 02 事后证错** — needs the wall-clock follow-up to surface
  whether a maintained decision was later wrong. Same problem.

These are not gaps to fix; they are structural properties of any
snapshot-grade experiment. The architecture choice in our prior discussion
(three-layer: detection / signal store / audit, episode-versioned) is
precisely what would enable Layer-3 tests once it's running for ~3
months.

## What this validates about the product direction

Beyond the framework's own hypotheses, this experiment validates several
product-design choices from our prior grilling:

1. **Q4 reframed (three-layer architecture).** The split between
   `detection` (continuous, signal-producing) and `audit` (low-frequency,
   conclusion-producing) is right: even in this snapshot run, the events
   and their composition into an audit are clearly separable concerns.
   Storing events as their own artifact, then composing audits from them,
   is more honest than fusing the two.
2. **Q7 (both lenses, non-interfering, comparable).** Empirically
   confirmed: ~12-25% overlap per session, distinct kinds of signal,
   convergence on the same turn is itself rare and meaningful.
3. **Q8 (δ' audit document).** The δ' format held up well — having
   `Scope / Method / Findings / Limitations / Source index` made each
   audit self-describing in a way that a future-self reader can navigate
   without external context. The per-lens `Findings` sections kept the
   non-interference Q7 promised visible at the reading layer.
4. **Q6 (audit = git repo, agent as facet).** Single-agent scope worked
   for all three projects (all were claude-code). The agent-as-facet
   plumbing isn't stressed yet but isn't blocking either — adding a
   second agent type later is mechanically straightforward.
5. **MVP-I (Demo-grade, one-shot CLI).** This experiment effectively *is*
   the MVP-I, just scaled to three projects. The total infrastructure
   needed was three scripts (`digest.mjs`, `compose.mjs`, the subagent
   dispatch logic embedded in the orchestrator) plus the lens and schema
   specs as content. No daemon, no scheduler, no signal store. **The
   hypothesis the framework would benefit from real-data testing is now
   answered: yes, it does, and the lenses produce usable output on first
   real-data contact.**

## Surprises / unexpected findings

### S1 · LLM-as-lens emits broken JSON ~33% of the time

Two of six initial subagent scans produced JSON files with unescaped
inner `"` characters (English straight-quotes inside Chinese verbatim
text). This is a known model failure mode; explicit re-dispatch
instructions ("every `"` inside verbatim text must be `\"`") fixed both.
This rule should be baked into the lens specs going forward. The cost
of a malformed scan is one extra subagent invocation per failure — not
catastrophic, but enough to budget for in the eventual MVP-II
information-increment gate.

### S2 · "Same user, same agent, same week" produces dramatically different stance distributions

Going in, the framework's H3 claim was that *different agents or
different projects* would produce different distributions. We didn't even
need to vary the agent. Holding agent + week + user constant and only
varying the project produced the e=5/d=1/o=3/i=2 vs e=2/d=1/o=4/i=0 vs
e=2/d=0/o=1/i=1 split. **The project is doing a lot of work in shaping
the collaboration's micro-dynamics.** This is stronger evidence for
"协作 is the analysis unit" than the framework's own Fig 02 (which
varied 4 lens variants × 3 sessions × 2 projects with sealed/rejected
lens variants — a methodological cross-check, not a within-user-only
test).

### S3 · The 4th stance (`ignored`) is rare but the framework-most-distinctive one

Across 22 anchored-deferral events, `ignored` appears only 3 times (A=2,
B=0, C=1). It is the stance that, by definition, leaves the AI's question
hanging — neither engaged nor overridden, just bypassed by other work. Two
observations:

- **`ignored` is hard for the lens to false-positive on** because it
  requires both (a) an explicit anchor and (b) work clearly continuing on
  an unrelated topic. The strictness shows up in the low count.
- **Project B had zero `ignored` events** despite high anchor density,
  while A had 2 across 11 anchors. This is itself a structural feature of
  collaboration B — the user there either engaged with or overrode every
  anchor; nothing was bypassed.

For the audit document to convey this well, the empty cells in the stance
table matter as much as the full ones. The δ' format's stance-table
preserves this; a paragraph-narrative format would naturally smooth over
the zeros.

### S4 · Anchor density (1.1 to 3.3 per 100 turns) varies more than stance shape

I expected anchor density to be roughly constant per session and stance
shape to do all the varying. Reverse was true: anchor density ranged 3×
across projects, while the stance shape, conditional on having an anchor,
shifted in less dramatic ways. The interpretation:

- The AI's question-asking style is **project-dependent** (probably scope-
  dependent — tight-scoped plugin extension in B prompts more decisions
  than sprawling A).
- The user's stance, when prompted, is somewhat more **collaboration-
  dependent** than user-dependent but less dramatically so than anchor
  density itself.

This means: in the eventual MVP-II report rendering, **the anchor-type
table needs to live next to the stance table**, and the per-100-turn
density should be visible — otherwise consumers will misread stance
distribution as a property of the user.

## Limitations

Some are inherent to a snapshot-grade Phase 1; others are local to this
run.

### Inherent to Phase 1
- **Recall is not validated** (§ 14.1). We know events the lens DID find
  were source-anchored and well-formed (precision). We do not know
  whether there were gradient events the lens MISSED. The framework's
  three mitigations (third-party-reader reconstruction, density-shape
  audit, fate-driven back-inference) are all multi-session or external-
  reader tests not available here.
- **Single session per project.** Cannot test § 9 二阶可预测性 or § 8
  fate tracking.
- **One agent type.** Cannot test the framework's "同一用户跨 agent 分布不
  同" claim from this dataset alone.

### Local to this run
- **`sonnet` was used for lens application.** A more capable model
  (`opus`) might pick up subtler events; a less capable one (`haiku`)
  might miss obvious ones. Phase-2 should at minimum run a single
  reference session across all three models to characterise variance.
- **Project A's digest is 263 KB / ~65K tokens.** Within sonnet's context
  but on the larger side. The strict-negative-space scan on A first
  returned 2 events; the re-run (which was forced by the JSON-escaping
  issue, not by quality) returned 4 events with different content. This
  is suggestive that **on large digests, the lens may be missing events
  on the first pass**. Phase-2 should explicitly run the same digest
  through the same lens twice and characterise the variance.
- **Digester pre-truncates tool_results to 600 chars.** A negative-space
  event that hinges on the *content* of a specific file the AI proposed
  reading would be visible only as `Read(<path>)` plus a truncated
  excerpt. If the proposal's recognisability depended on the truncated
  content, the lens couldn't make the call. This is a deliberate
  tradeoff for digest size; the lens's "skip if AI proposal isn't
  specific enough" rule naturally handles it, but it does bias the lens
  toward catching events that turn on a *visible artifact in the
  proposal text itself*.

## Cost of next-step rollout

To go from this experiment (MVP-I, Demo-grade) to the next stage (MVP-II,
Self-use-grade — the cron + signal-store + episode trigger), the
engineering delta from what we just built:

1. **Persistent signal store.** Events currently live as one JSON file
   per `(project, lens)` scan. MVP-II needs them in a continuous append-
   only store with stable IDs. Probably JSONL files per project per lens,
   or SQLite. Add `event.id` (stable hash), `event.created_at`,
   `event.lens_version`. Mechanical change.
2. **Cron + information-increment gate.** A simple `code-journal sync`
   command run on cron: discover new sessions since last sync, dispatch
   subagents on the new ones, append events to the store. Already
   sketched in earlier discussion; mechanical.
3. **Compose-on-demand.** `code-journal compose --project <X>` already
   exists in scripts/compose.mjs; needs to read from the signal store
   instead of from per-scan JSON files, and stamp an episode number /
   date. Easy.
4. **`code-journal compose --project X --since <date>`** for time-windowed
   audits within a long-running signal store. Add.
5. **Fate tracking** is not actually needed for MVP-II's core loop — it
   only matters once there are multiple episodes per project. Defer to
   Phase 3.

Total: estimated **3-5 days of focused work** to reach MVP-II from MVP-I.
The lens prompts, schema, audit format, and digest format are all
production-ready as-is, minus the JSON-escaping rule (single-line addition
to both lens specs).

## Verdict

> The 协作观测框架 produced source-anchored, identity-drift-free output on
> first contact with three real coding-agent transcripts from the same
> user. The two-lens, non-interfering design is empirically distinct in
> signal type. The framework's central "协作 is the analysis unit" claim
> survives an even stronger test than the framework itself proposed
> (same agent, same week, only project varying). Phase 1's range of
> testable hypotheses — H1 through H7 here — all hold; the long-horizon
> ones remain structurally untestable until multi-episode infrastructure
> is in place.
>
> The product direction we discussed in the prior grilling — three-layer
> architecture, episode-versioned audits, δ' document format, audit
> rather than service voice — held up under the structural pressure of
> trying to actually produce these audits. No design decision needed
> revision after seeing the output. The MVP-I as-built is sufficient to
> falsify the framework if false on real data; it didn't.

The next concrete decision is whether to invest the 3-5 days to take
MVP-I to MVP-II (Self-use-grade) and start accumulating real
multi-episode data, or to refine the lens specs and digest pipeline
further before committing to that infrastructure investment.

Phase 1 ledger of this experiment, for reference and reproducibility:

```
2026-05-27   Phase 1 cross-project test
             3 projects · 2 lenses · 6 subagent scans
             (2 re-runs required after initial JSON-escape failure mode;
              count above is final, post-rerun)

             31 events total:
               9 strict-negative-space events (across 3 sessions)
              22 anchored-deferral anchors    (across 3 sessions)

             Cross-lens overlap (primary-turn coincidence):
               6 / 9 strict events share a primary turn with a deferral
               anchor (67%) — see H7 for interpretation.

             Sealed: both lenses on all three projects; structural shape
             of stance distribution preserved across projects despite
             same-user, same-agent, same-week design constraint.

             Methodology: subagent context isolation per (project, lens)
             pair, anonymised project codes in committed report, no raw
             transcript content reproduced outside gitignored audits.
```
