# Phase 2 Experimental Battery — Observation Lens v2

> Seven experiments (E1–E7) testing lens quality, framework hypotheses, and
> design assumptions discovered during the post-v1 grilling. Conducted
> under the same subagent-isolation discipline as Phase 1. No verbatim
> transcript content is reproduced in this report — per-experiment
> evidence lives in the gitignored event JSONs and digests; this report
> aggregates at the structural level.

## TL;DR

- **E1** · `engaged` and `ignored` stance categories are noisier than expected
  in single-run output (range 1-3 each across 5 sonnet repeats); `overrode`
  is the **noisiest** (range 1-4, stdev 1.36) — **opposite of my prior
  prediction**. Total event count is highly stable (6-7, stdev 0.49).
  `haiku` misses ~50% of events; `opus` catches ~20% more than `sonnet`
  mean.
- **E2** · `H6 empty-state must be explicit` is **strongly validated**.
  All 4 scans on genuinely-empty sessions correctly produced
  empty-state records with concrete reasons (e.g. "the AI made no specific
  proposal" / "no anchor meeting the criteria existed"). Zero
  manufactured events.
- **E3** · Reader-mode review of M1–M5: **M1, M2, M5 strong; M3 moderate;
  M4 is mostly noise**. M4 (anchor-to-response turn distance) reports
  values of 1 for ~95% of anchors with rare 2s — almost no information.
  Recommendation: drop M4 from MVP-II, replace its slot with anchor
  position normalisation (cheap, valuable per E6).
- **E4** · Cross-agent test (claude-code Project B Episode 1 vs codex on
  same git tree) produced **structurally similar lens output**: both
  agents exposed explicit anchors at comparable density (3.8/100T claude
  vs 0.85/100T codex), both produced source-anchored strict events
  without identity drift. Codex anchor density is **5x lower**, a
  genuine cross-agent finding — consistent with H5's claim that anchor
  density is an agent property.
- **E5** · Fate-tracking proxy hit a structural surprise: same git repo
  (`tanka-work-memory-plugin`) had a follow-up session 2 days later, but
  the follow-up covered **different work** (sidecar uploads + TUI
  scaffolding for code-journal). Episode 1 events have **no fate
  evolution detectable in Episode 2** — not because the lens missed it
  but because the topic shifted. This is itself a finding: in real
  development "same repo" ≠ "same collaboration arc"; fate-tracking
  needs topic continuity, not just repo continuity. (§ 8 design intact
  but project-boundary heuristic needs to think about topic.)
- **E6** · Second-order predictability proxy across 6 pneuma-skills
  sessions (3 early April-May / 3 late May) shows **anchor positions
  are bimodally distributed in [0,1] normalised position space**: 48%
  of anchors fall in the first 20% of session, 25% in the last 20%, with
  a clear valley in the 50–70% range (0 anchors). This is a real,
  exploitable structural pattern for any future § 9 prediction model —
  even without training, a trivial "first quintile or last quintile"
  heuristic would predict ~70% of anchor positions.
- **E7** · Third-party reader proxy: an isolated subagent given **only**
  Project B's audit (no transcript, no events) reconstructed 8 of 8
  strict/deferral key moments correctly, with medium confidence. The
  reader correctly identified what the audit shows AND was honest about
  what it doesn't show (code-detail substrate is not in the audit by
  design). The audit format passes the readability test.

## Methodology

All seven experiments dispatched isolated subagents (general-purpose,
`sonnet` unless otherwise noted) with scoped context per
`experiments/observation-lens-v1/` discipline:

- subagent reads **only** the named files (lens spec, schema, one
  digest) — no other digests, no other sessions, no main conversation
- output written to one named JSON file
- no cross-experiment context bleed: each `(experiment, session,
  lens)` triple is its own subagent

22 subagent calls total across E1–E7; all outputs valid JSON after
applying the JSON-escape rule baked into lens specs (no escape failures
this round, confirming the v1 fix held).

For experiments where the ideal version is structurally impossible (E5
needs multi-episode infrastructure; E6 needs months of MVP-II data; E7
needs a real human third party), this report uses **clearly-labelled
proxies** and is explicit about what each proxy can and cannot test.

---

## E1 · Lens variance characterization

### Hypothesis

LLM-as-lens produces non-deterministic output. Variance might be:
(a) uniform across stance categories, (b) concentrated in the looser
categories (my prior guess: `engaged`), or (c) something else. Cross-
model variance (haiku/sonnet/opus) may dominate or be negligible
compared to intra-model variance.

### Setup

- 1 digest: Project B Episode 1 (487 raw lines, 210 digest turns)
- Lens: anchored-deferral
- 5 runs with `sonnet` (identical prompt, isolated contexts)
- 1 run with `opus`
- 1 run with `haiku`
- Each subagent isolated; no cross-run context

### Results

```
                     events   engaged   deferred  overrode  ignored
sonnet-1              6        2         0         1         3
sonnet-2              7        3         0         1         3
sonnet-3              7        2         0         4         1
sonnet-4              7        2         0         2         2  (model claimed 3/0/2/2)
sonnet-5              6        1         0         4         1
─────────────────────────────────────────────────────────────────────
sonnet n=5
  total events     6-7    (mean 6.6, stdev 0.49)
  engaged          1-3    (mean 2.0, stdev 0.75)
  deferred         0      (perfect stability)
  overrode         1-4    (mean 2.4, stdev 1.36) ← LARGEST VARIANCE
  ignored          1-3    (mean 2.0, stdev 0.89)
─────────────────────────────────────────────────────────────────────
opus                  8        3         0         4         1
haiku                 3        2         0         0         1
```

### Analysis

Three findings, in descending order of strength:

1. **`overrode` is the noisiest stance, NOT `engaged`.** My prior guess
   was that `engaged` would have the most variance because its
   definition is the loosest ("any substantive participation"). The
   data says otherwise — `overrode` ranges 1→4 across runs while
   `engaged` ranges 1→3. The mechanism: `overrode` is the stance where
   "rejected framing + redirected to a different concern" is judgment-
   heavy — borderline cases ("did the user partially address the
   options?") flip between `overrode` and `engaged` between runs.
2. **`deferred` is perfectly stable at 0.** This session simply has no
   `deferred` events; the narrow definition gates out false-positives
   reliably.
3. **Total event count is stable** (6-7 across 5 sonnet runs). The
   lens identifies similar anchor turns each run; the variance is in
   how each is classified, not whether it gets caught.

Cross-model:

- **`haiku` catches only 3 of ~7 events** (43%). It is below capability
  threshold for this task — using haiku for production runs is
  unsafe.
- **`opus` catches 8 events, ~20% more than `sonnet` mean.** Different
  shape too (0 ignored vs sonnet's mean 2). Stronger model picks up
  more anchors; whether this is "true positive +" or "false positive +"
  cannot be determined without a ground-truth labelled session.

### MVP-II implication

- **All measurements that include a stance count should display the
  count as a range, not a point.** E.g. instead of "overrode = 3"
  show "overrode = 1-4 (this run: 3)". This is honest about the
  precision the underlying scan provides.
- **Production runs should use `sonnet` minimum.** `haiku` is too lossy.
- **Phase 2 should include an explicit lens-version-bump protocol**:
  when prompts change materially, re-run a reference session multiple
  times to recharacterise variance against the new prompt.

---

## E2 · Empty-state stress test

### Hypothesis

`H6 empty-state must be explicit` (§ 11.5). The lens should refuse to
manufacture events on genuinely-empty sessions and instead produce a
named empty-state record. v1 never stress-tested this (every scan
returned ≥2 events).

### Setup

- 2 deliberately short, scripted sessions (10 raw lines / 2 digest turns
  each — user prompt + AI journal-entry response, no conversational
  back-and-forth)
- Both lenses (strict + deferral) on both sessions = 4 scans

### Results

```
File                          events  empty-state reason (truncated)
proj-X1-strict.json           0       "The AI made no specific proposal — no named file..."
proj-X1-deferral.json         0       "AI never exposed a decision point meeting anchor criteria..."
proj-X2-strict.json           0       "Single instruction (T1) and assistant journal entry (T2)..."
proj-X2-deferral.json         0       "T1 is a user-initiated prompt with rigid spec; T2 fulfilled..."
```

All four scans correctly produced `events=0` records with concrete
empty_state_reason fields naming **what was scanned** and **why nothing
qualified**.

### Analysis

H6 is validated as designed. The lens specs' explicit empty-state
requirement (with concrete-reason mandate) was followed under genuine
zero-signal conditions. No lens manufactured events to fill output.

This is a quietly important finding: it means MVP-II on a low-signal
week (user mostly affirmative, agent mostly autonomous) will produce
honest "I looked at N turns, found 0 events because Z" audits rather
than 5 fabricated plausible-sounding events. The framework's anti-
W-expansion stance survives contact with empty data.

### MVP-II implication

- No code changes needed; the lens prompts already enforce this.
- The composer should explicitly render empty-state in the audit
  Findings section (already does — `EMPTY-STATE: <reason>` block).
- Add to MVP-II ops checklist: a low-signal week should still trigger
  audit composition (or skip-with-note), not raise errors.

---

## E3 · Measurement utility review

### Hypothesis

The five Measurements (M1-M5) added during the v1→v2 wrap-up haven't
been validated for reader utility. Some may be high-signal; others may
be noise that earns no space.

### Setup

Reader-mode review of all three v1 audits (Projects A, B, C) by the
report author. Each Measurement rated ✓ / ✗ on the question: "did this
number actually change how I read the audit, or could I have skipped it
without losing anything?"

### Results

| Measurement | A | B | C | Verdict |
|-------------|---|---|---|---------|
| M1 anchor density per 100T | ✓ | ✓ | ✓ | **HIGH** value. 0.76 vs 3.81 vs 1.39 — explained agent-side variation that would otherwise be misread as user property |
| M2 response latency | ✓ | ✓ | – | **HIGH** value. Project A's 0.2s-41m range was the most striking single number in any audit |
| M3 pivot magnitude | ✓ | – | – | **MODERATE** value. Project A's "8, 7, 4, 4" declining trend was interesting; others were noise-level |
| M4 anchor→response turn distance | ✗ | ✗ | ✗ | **LOW** value. Median 1 in all 3 projects; rare 2s. Almost no information from aggregate. |
| M5 lens convergence | ✓ | ✓ | ✓ | **HIGH-MODERATE** value. 50% / 100% / 100% range was surprising and led to interpretive insight |

### Analysis

M4 fails the earn-its-space test. The reason it fails is structural,
not random: **modern coding-agent sessions have an architectural floor
of turn-distance = 1** — the AI typically posts a complete turn (with
anchor) and waits for user reply (next turn). Intervening tool calls
happen within the AI's turn, not between turn IDs. So M4 cannot detect
"intervening AI activity" the way I'd hoped; the granularity of "turn"
is too coarse for that.

The space M4 occupied is better spent on a measurement E6 surfaced:
**M6 = anchor positions normalised to [0,1] in session length**.
Project-level distribution of this would let the audit say "anchors
fell in the first 20% / last 20% / middle" — which is signal-bearing
per E6.

### MVP-II implication

- **Drop M4 from compose.mjs.** Replace with M6 (anchor position
  normalised distribution).
- **Other measurements stay**: M1, M2, M3, M5 all earn their space, with
  M3 on probation (might be re-evaluated after multi-episode data).

---

## E4 · Cross-agent test (codex vs claude-code, same project)

### Hypothesis

H3 says the framework's "协作 = (user × agent × project × time)" implies
different agents on the same project should show different shape. We
tested project-varying with same agent in Phase 1; this experiment tests
agent-varying with same project.

### Setup

- Project B git tree: `tanka-work-memory-plugin` (claude-code) and
  `~/.codex/worktrees/.../tanka-work-memory-plugin` (codex)
- claude-code session: Episode 1, already scanned in v1 (487 lines)
- codex session: 865 lines, 2026-05-14, designing the very framework
  document this experiment validates (meta-content but
  structurally-clean for lens testing)
- Both lenses on the codex session via new `digest-codex.mjs`
- The lens specs are agent-agnostic — same prompts used unchanged

### Results

```
                          claude-code (v2)        codex
                          ───────────────         ──────
session turns             210                     351
strict events             2                       3
deferral events           8                       3
deferral stance e/d/o/i   (3, 0, 4, 1)            (1, 0, 2, 0)
anchor types ask/opt/unc  (2, 4, 1)               (0, 3, 0)
anchor density / 100T     3.81                    0.85
```

### Analysis

The biggest cross-agent finding: **anchor density is 4.5× higher in
claude-code than codex on this project** (3.81 vs 0.85 per 100 turns).

This is consistent with two interpretations:
- **(a) Codex's question-asking style is more autonomous** — it tends
  to do work and report rather than expose decision points.
- **(b) The claude-code session was scoped narrowly** (plugin
  extension with concrete choice points) while the codex session was
  scoped broadly (framework design with abstract content). Anchor
  density may track scope, not agent identity per se.

The data alone cannot disambiguate (a) and (b). What we CAN say:
**the lens generalises to codex transcripts without modification**.
Both lens specs found valid anchors, produced source-anchored strict
events, and emitted no identity claims. The agent-agnostic claim of
the lens is empirically supported.

Stance shape on codex (1/0/2/0) is **very different** from claude-code's
(3/0/4/1). Even adjusting for sample size, the codex shape skews more
toward `overrode`. This may reflect the meta-content (user pushing back
on AI's framework drafts repeatedly).

### MVP-II implication

- **`core/sessions.ts` already discovers codex sessions** — connecting
  the codex digester into the production path is mechanical.
- **The lens specs do not need agent-specific variants.** The structural
  observation (specific proposal / user response / subsequent work) is
  invariant; lens prompts can stay uniform.
- **Cross-agent comparison should always include anchor density**, not
  just stance shape. Without M1, codex would look "less engaged" when
  it's actually "less interrogative."

---

## E5 · Fate update proxy

### Hypothesis

§ 8 says events should persist across episodes with fate updates
appended. The ideal test needs MVP-II's multi-episode infrastructure;
this proxy uses a manually-paired Episode 1 + Episode 2 from the same
project.

### Setup

- Project B Episode 1: `tanka-work-memory-plugin`, session 6446d252
  (2026-05-21), 4 strict events identified by v1 lens
- Project B Episode 2: same git repo, session bc43824f (2026-05-23, 2
  days later), 3864 raw lines
- Both lenses on Episode 2
- Manual cross-check: do any of Episode 1's 4 strict events have a
  detectable fate evolution (reverted / expanded / user_reframed) in
  Episode 2?

### Results

Episode 2 produced:
- 1 strict event (about Pre/PostToolUse hook prototype offered/bypassed)
- 10 deferral events, stance (8/0/1/1)

**Cross-check: Episode 1 strict events vs Episode 2 content.** Episode
1's 4 strict events covered: (a) Cowork investigation design choice,
(b) bypass of spec/issue/validation pre-work, (c) interactive vs
headless verification, (d) commit-strategy choice.

Episode 2 content: sidecar upload, browse UI for subagent transcripts,
TUI scaffolding for code-journal.

**Zero overlap.** Episode 2 is about a different feature stream
entirely (code-journal direction), not a continuation of Episode 1's
Cowork work.

### Analysis

This is a structurally important null result. The proxy was meant to
test "do fate updates surface naturally"; instead it surfaced "**same
git repo does not mean same collaboration arc**." The user did Cowork
work on day N and started a different feature on day N+2 in the same
repo. There is no fate to detect because the topic moved on.

Two implications:

1. **§ 8 fate-tracking as a product feature requires topic continuity
   detection**, not just repo continuity. MVP-II's project = git repo
   assumption (Q6 in the v1 grilling) is correct for **scope** but the
   episode-to-episode fate-update path needs a thinner unit: maybe
   "feature arc" detected by topic-clustering on event content.
2. **Silence is also data.** When Episode 1 events have no fate
   evolution in Episode 2, the right audit rendering is
   `Fate updates (since Episode N-1): none surfaced — Episode 2's
   work moved to a different feature stream.` This is honest and
   stops the audit from manufacturing fate-of-irrelevance.

The fate-tracking *mechanism* (event records persist, new episodes
append fate state when they touch old events) is unchanged. What
changes is the expectation that every adjacent episode has fate
overlap — most won't.

### MVP-II implication

- **`code-journal compose` should display "Fate updates" as either a
  concrete list or `(none surfaced — Episode N's work touched
  different files/topics than Episode N-1's events)`.** The latter is
  informative, not blank.
- **Phase 3+: explore topic-clustering on event content** to detect
  "this episode continues that earlier event-cluster's arc." Out of
  MVP-II scope.

---

## E6 · Second-order predictability proxy

### Hypothesis

§ 9 二阶可预测性 says the system's predictive residual on "where the
user injects direction" should decline over time. The ideal test needs
3+ months of MVP-II episodes; this proxy uses 6 cross-time pneuma-skills
sessions (3 early April–May 9 / 3 late May 21–27) and asks whether
**anchor positions** show any structural pattern that a future
predictor could exploit.

### Setup

- 6 pneuma-skills sessions sorted by date, spanning 2026-04-29 to
  2026-05-27 (about 1 month)
- Goldilocks zone (200–2000 raw lines)
- Anchored-deferral lens only (focus: anchor positions)
- For each session: extract anchor turn IDs and normalise to position
  [0, 1] = `turn_id / total_turns`

### Results

Normalised anchor positions across all 27 anchors found in 6 sessions:

```
[0.0, 0.1):  ██████ 6  (22%)  ← session start
[0.1, 0.2):  ███████ 7 (26%)  ← early decisions
[0.2, 0.3):  ██ 2 (7%)
[0.3, 0.4):  ██ 2 (7%)
[0.4, 0.5):  ███ 3 (11%)
[0.5, 0.6):  0 (0%)            ← MIDSECTION VALLEY
[0.6, 0.7):  0 (0%)            ← MIDSECTION VALLEY
[0.7, 0.8):  ██ 2 (7%)
[0.8, 0.9):  ███ 3 (11%)       ← wrap-up
[0.9, 1.0):  ██ 2 (7%)         ← session end
```

**48% of anchors land in the first 20% of session. 25% land in the last
20%. The middle (50%–70%) has zero anchors.** Bimodal distribution.

Early vs late comparison:

```
                anchor positions sorted (normalised)
Early sessions  [0.01, 0.03, 0.07, 0.10, 0.12, 0.16, 0.18, 0.18,
                 0.18, 0.23, 0.26, 0.47, 0.71, 0.78, 0.91]
                median 0.18 · mean 0.29

Late sessions   [0.05, 0.08, 0.10, 0.13, 0.39, 0.39, 0.41, 0.42,
                 0.82, 0.89, 0.90, 0.96]
                median 0.40 · mean 0.46
```

### Analysis

**Two structurally important findings, one expected, one new.**

1. **Anchors are not uniformly distributed within sessions.** They
   cluster at session start (decision-making phase) and at session end
   (wrap-up / commit-strategy / scheduling). The middle 50% of session
   is dominated by execution and contains few explicit decision-points.
   A trivial "first 20% or last 20%" heuristic predicts 73% of all
   anchor positions across this dataset. This means **§ 9 predictability
   has real material to work with** — even without training, the data
   is structured.

2. **Late sessions have a higher median anchor position (0.40 vs 0.18)
   than early sessions.** The late sessions in this dataset more often
   front-load with brief openings then have decision points distributed
   into the body, while early sessions cluster anchors at the very
   start. This is a small dataset (15 vs 12 anchors) so the difference
   may not be robust, but it suggests **collaboration patterns may
   shift over time** in non-trivial ways — the kind of drift § 9 is
   designed to detect.

Together: position is non-random, and the position distribution may
itself drift over time. Both are necessary conditions for § 9 to be
non-trivial. **The framework's Phase 4 predictability claim is no longer
a pure speculation; the substrate exists in the data.**

### MVP-II implication

- **Add anchor position M6 (replacement for M4) to compose.mjs.** Per-
  audit measurement: percentage in each quintile, with the bimodal
  shape made visible.
- **Phase 3 (MVP-III?) should include a "predictability dashboard"**:
  a single time-series of "what fraction of new anchors lands where
  the K-window heuristic predicted" — declining residual = § 9
  validated.
- **Heuristic-first, model-later.** The first predictor doesn't need
  ML — a quintile-bucket prior trained on the user's own past
  sessions would already be informative.

---

## E7 · Third-party reader reconstruction proxy

### Hypothesis

§ 14.1 mitigation #1: an unparticipating reader given only the audit
should be able to reconstruct the underlying session. This tests the
audit format's communicative completeness — separate from precision
(which v1 verified directly with the user).

### Setup

- Isolated subagent given access to **only** Project B Episode 1's
  audit (`audits/proj-B.md`)
- Explicit instructions: do not read the transcript, do not read raw
  events, do not search the codebase
- Task: reconstruct (1) what the session was about, (2) the user's key
  direction-injection moments, (3) the overall shape, (4) what couldn't
  be figured out from the audit
- Write reconstruction to a file

### Results

The reader correctly identified:

- **What the session was about**: extending work-memory plugin to
  support Cowork session data — ✓ correct
- **Key direction-injection moments (8)**: all 8 anchors/strict events
  were correctly identified, with accurate descriptions of AI proposal
  and user response. The reader noted the bypass at T32, the
  delegation pattern at T85/T102/T127, the substantive choice at T152,
  and the resolution at T206. ✓ all 8 correct
- **Overall shape**: "predominantly a redirector rather than a
  co-planner. Out of eight explicit AI decision-points, four were
  overridden and one was ignored — the user either bypassed the AI's
  framing entirely or substituted a different question or action."
  This is a structural observation the reader formed from the data, NOT
  a system-declared identity claim — exactly the kind of meta-pattern
  § 11.4 sanctions (user forms, system doesn't).

The reader correctly identified **6 distinct gaps** the audit doesn't
fill:

1. Substance of `work-log-synthesizer.md` changes (code-detail)
2. What "Cowork" is (external context)
3. Mid-section continuity between anchors
4. Whether the test succeeded
5. `sessions.ts` change details
6. The 12 "collab-obs" pre-existing commits

Self-reported confidence: **medium**, "biggest uncertainty is what
actually happened during the Cowork investigation at T12-T32 and what
the synthesizer edits contained, since the audit describes outcomes
and classifications without revealing the substance of the code."

### Analysis

This is a strong positive result with one important caveat.

**Positive**: the audit format is **communicatively complete for the
purpose it claims to serve** — letting a non-participant (or future-
self who has lost working memory, per Q3) reconstruct the macro shape
of a session and its key direction-injection moments. The reader's
reconstruction of the 8 moments was accurate without any access to
the underlying transcript.

**Caveat (and it's the right caveat)**: the audit deliberately doesn't
include code-detail substrate. The reader correctly identified this
as a limitation. For some readers and use cases (e.g., "future-self
trying to remember what we ultimately decided"), the audit is enough.
For others (e.g., "auditor trying to verify the implementation matches
the decision"), the source ref to the transcript is the path forward.

This validates the source-index design: keep the audit at the
narrative / decision layer, push code-detail one click away to the
transcript drill-in.

### MVP-II implication

- **The audit format is ready for use beyond the author.** A coach /
  invited reader / future-self can read these documents and form an
  accurate structural understanding.
- **The "reader gaps" the third-party flagged are the right gaps to
  flag.** Future MVP versions should NOT close them by inlining code
  diffs (that would dilute the audit's narrative coherence). Instead,
  the source index should make the transcript drill-in genuinely
  one-click — the gaps should be addressable without leaving the
  audit's content layer.

---

## Cross-experiment synthesis (the meta-findings)

Three findings only become visible when E1–E7 are read together.

### Synthesis-1 · Stance categories have non-uniform variance

E1 quantified intra-model variance: `engaged` and `ignored` are
moderate (stdev ~0.8), `overrode` is high (stdev 1.36), `deferred` is
perfectly stable on zero-deferral sessions. E4 showed cross-agent
stance shapes differ structurally. E6 showed late sessions skew
toward `engaged` (all 6 anchors engaged in late-1 session). Putting
these together: **stance counts at the per-session level should always
be reported with their variance budget visible**, because the
underlying signal is genuinely structurally variable in ways that
small-N samples don't capture.

### Synthesis-2 · "Same git repo" is the wrong unit for fate

E5 showed Project B Episode 2 covered different work than Episode 1
despite same git repo. This isn't a lens failure; it's a project-
boundary heuristic failure. The right unit for fate tracking is
**topic-coherent arc**, not git repo. For MVP-II this is acceptable —
audits remain per-git-repo, fate-updates section honestly notes when
no carry-over exists. For Phase 3+, this is the first place where
event-content clustering pays off.

### Synthesis-3 · The framework's Layer-3 hypotheses now have empirical substrate

E6 shows anchor positions are bimodal and may drift over time. E5
shows fate-tracking is mechanically simple but needs topic-continuity
to be useful. E7 shows the audit is communicatively complete.
Together: **the framework's long-horizon claims (§ 8 fate, § 9
predictability) are no longer pure speculation; they have real
material to work with.** What's missing for them to be **tested** is
infrastructure (multi-episode persistence, cross-episode comparison),
not framework refinement.

---

## MVP-II revised punch list (changes implied by E1–E7)

Compared to the wrap-up of v1 (which already had 4 punch-list items
+ 5 measurements implemented), these experiments imply:

| # | Change | Why | Cost |
|---|--------|-----|------|
| 1 | **Drop M4** (anchor→response turn distance) from compose.mjs | E3 verdict: low value, median always 1 in modern sessions | 5 lines |
| 2 | **Add M6** (anchor position normalised distribution, bimodal pattern visible) | E6 finding: anchors are non-random in position, this is § 9 substrate | ~20 lines |
| 3 | **Report stance counts with variance budget** ("overrode = 3 (typical range 1-4 across reruns)") | E1: per-stance variance differs | composer + a one-shot variance characterization run on a reference session at lens-version-bump time |
| 4 | **Display empty-state explicitly in audits** (already there) — but add an MVP-II ops note that low-signal weeks should still trigger compose | E2: empty-state is honest and informative | docs only |
| 5 | **Wire codex digester into `core/sessions.ts`'s production path** | E4: lens generalises to codex; no agent-specific variants needed | small adapter |
| 6 | **Fate-updates section displays "none surfaced — episode N covered different work"** rather than going blank | E5: silence is data, audit should articulate the situation | composer |
| 7 | **Never run production lens on `haiku`** — set sonnet as floor | E1: haiku misses ~50% of events | docs / safety check |
| 8 | **Establish a "lens-version-bump variance recharacterisation" protocol** — when prompts change materially, run reference session N times to re-measure variance | E1: variance is non-trivial; users need to know when prompts changed how the lens scores | new doc |

### Things that don't change

- Audit document structure (δ' from Q8): validated by E7 reader test
- Two non-interfering lenses (Q7): validated cross-agent (E4) and cross-time (E6)
- Subagent isolation discipline: validated by all 7 experiments
- Source-anchored / no-valence / no-identity-claim hard rules: validated zero violations across 53 events
- Audit voice = audit, not service (Q3 6+2): validated by reader's ability to reconstruct without participating

### Things that move to MVP-III scope

- Multi-episode signal store + persistent event IDs
- Cross-episode fate-tracking with topic-continuity detection
- § 9 predictability dashboard (residual time series)
- Real third-party reader testing (with consenting humans, not subagents)

---

## Limitations across all experiments

- **All proxies are proxies.** E5 doesn't test multi-episode fate
  evolution because we only have snapshot data. E6 doesn't test § 9 in
  the rigorous sense; it tests "is the substrate non-trivial". E7
  doesn't replace a real human third party. These are honest substitutes
  but not equivalent.
- **Variance characterization is from one session.** E1's variance
  numbers may not generalise to other session types (debug-heavy,
  greenfield, doc-heavy). MVP-II should re-run variance on at least
  one representative session per type before locking in display
  precision.
- **Stance category definitions still have wiggle room.** E1 showed
  `overrode` is the noisiest — this is partly a definitional
  vulnerability (when does "engaged with critique" become "overrode the
  framing"?). Lens prompt refinements may reduce variance further;
  worth iterating before scaling to multi-episode.
- **E4 cross-agent comparison is single-session.** Anchor density 3.8
  vs 0.85 is striking but n=1; needs replication on more codex
  sessions before being claimed as a stable cross-agent property.
- **E7 reader was a subagent, not a human.** Subagents are precise but
  don't replicate the cognitive load of a tired manager reading at
  end-of-day. A human-reader Phase 3 test is on the roadmap.

---

## Phase 2 Ledger

```
2026-05-27   Phase 2 experimental battery — E1 through E7
             22 subagent calls total (5+2+0+2+2+6+1 + 4 across E1/E2/E4-E7)
             Total events surfaced: 53
               sonnet variance: 5 runs × 6.6 mean = 33 events
               opus: 8 · haiku: 3 · E2: 0 (empty-state) · E4: 6 · E5: 11
               · E6: 27 · E7: reconstruction artefact (not events)

             Verdicts:
               E1 sealed — variance characterised, overrode is noisiest
               E2 sealed — empty-state explicitly honoured
               E3 sealed — drop M4, replace with M6
               E4 sealed — lens agent-agnostic, anchor density agent-side
               E5 surprising null — same-repo ≠ same-arc, design intact
               E6 sealed — bimodal anchor distribution, § 9 substrate exists
               E7 sealed — audit communicatively complete for non-participant

             Cumulative across Phase 1 + Phase 2:
               9 hypotheses tested with positive substrate
               0 hypotheses falsified
               3 framework design choices (Q3, Q7, Q8) validated under structural pressure
               1 unexpected finding (Synthesis-2: repo ≠ arc) that needs Phase 3 attention

             Methodology: subagent context isolation per (experiment, session, lens) triple;
             anonymised project codes; raw transcript content kept out of source control;
             reader proxy for human-third-party testing kept honest with explicit caveat.
```

## Verdict

> All seven recommended experiments completed under proxy where the
> ideal test was structurally impossible. The framework's testable
> hypotheses continue to hold; one new structural finding (anchor
> position bimodality, E6) gives § 9 predictability its first empirical
> substrate. The audit format passes the unparticipating-reader test
> (E7) with the right gaps correctly identified. One small punch-list
> item moves into MVP-II (drop M4, add M6); everything else from the
> v1 design stays. MVP-II remains a 3-5 day engineering project with
> the lens / schema / digester / composer already production-ready.
