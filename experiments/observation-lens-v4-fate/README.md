# Experiment v4 · Fate detection on disjoint episodes

**Date:** 2026-06-22 · **Status:** prototype validated (precision + recall) → **productionized**
(`packages/observation/src/lib/fate-runner.ts` + `src/lenses/fate-detection.md`, wired into
`compose` as a separate pre-phase; end-to-end on real data — returns empty honestly on the
disjoint Ep1↔Ep2). Remaining: recall on a *real* resurfaced thread; `fate add` CLI.

## Why now

The disjoint-episode fix (CHANGELOG / `observation-lens-record.md` S8) made `compose`
cover only the new event slice per episode, instead of re-auditing the whole store.
That was the structural prerequisite for **fate tracking** (§ 8): a later episode
can only be said to touch a *prior* episode's events if "prior" and "new" are
actually distinct sets. Now they are. This experiment asks the next question:

> On real disjoint-episode data, does fate signal exist — and can a grounded
> subagent (the same "lens over a digest" pattern the system already uses)
> detect it without inventing links?

## Setup

Testbed: `pneuma-skills-3lck7c`, the only project with two disjoint episodes.
- **Episode 1** (2026-05-27→05-29): Agent Surface floating chat + cosmos viewer source-references.
- **Episode 2** (2026-06-10→06-15): `.claude` toolchain restructure + methodology
  experiments + a session-meta-preservation bug fix + a kami export clipping fix.

The detector is a subagent given (Episode-1 audit = the watch list) × (Episode-2
session digests = the later work), with hard grounding rules: cite **both** sides
concretely (Ep1 turn+quote AND Ep2 file/line+quote) or emit nothing; reject
incidental keyword coincidences and incidental reads/greps of pre-existing files.

## Runs

### Run A — null case (real data only)
Inputs: Ep1 audit + the two real Ep2 digests.
**Result: zero grounded fate candidates.** The two episodes are topically disjoint
feature streams. The one tempting link — a `CosmosSourceRef.excerpt` CHANGELOG line
appearing in Ep2 — the detector **correctly rejected** as a false positive: it is a
`grep "byte-identical"` (a docs-consistency sweep) incidentally surfacing a
*pre-existing* CHANGELOG entry that documents Ep1's own already-shipped work, not new
Ep2 action. (Verified against the raw digest: T60 grep → T61 tool_result at digest
line 673 = `CHANGELOG.md:316:`.) The orchestrator's first-pass keyword screen had
*accepted* this link — the detector was more precise than the human screen.

### Run B — recall case (controlled positive mixed with distractors)
Inputs: Ep1 audit + the two real digests + `synthetic-positive-digest.md`, a fixture
that deliberately takes up Ep1's **T706** deferral (reload-while-torn-off persistence,
which the user had *ignored*) with a real-looking commit. The subagent was fresh
(not told which digest was synthetic or what to find).
**Result: fired on exactly the planted take-up** — `T706 → taken-up`, grounded on
Ep1 T706 + the synthetic commit, `self_confidence: high` — and returned NO-FATE for
every distractor, including re-rejecting the cosmos incidental (stable across runs).

## Findings

| # | Finding | Confidence |
|---|---------|------------|
| V4-1 | **A grounded-subagent fate detector works.** Precision validated (null → zero, rejected a tempting false positive a keyword screen accepted); recall validated (positive → fired on the one real take-up with correct both-sides grounding, distractors null). | 🟢 Strong for this case; n=1 project + 1 synthetic positive — needs more real positives. |
| V4-2 | **Fate is sparse.** Real consecutive episodes (Ep1↔Ep2) had *zero* fate — different feature streams. Strongly reconfirms P4 ("same git repo ≠ same collaboration arc"). A production detector must tolerate returning empty most of the time and should look back across **all** prior episodes, not just the immediately preceding one (a thread can resurface after a gap). | 🟢 Strong (reconfirms P4) |
| V4-3 | **Precision-over-recall is the right tuning**, consistent with the framework's source-anchored-or-skip ethos. The cost of a false "you revisited X" is high (it fabricates a narrative); the empty result on real data is honest, not a miss. | 🟢 Strong |
| V4-4 | **Recall on *real* positives is still unproven.** Run B's positive was synthetic. Genuine validation needs real data where an Ep1 deferral resurfaces in a later episode — accumulate more episodes, or scan a project with a known revisit. | open |

## What this unblocks

The detector is ready to productionize into `compose` (replacing the hardcoded
`fate_updates_surfaced = []` at `compose.ts`). Design sketch:
- A `fate-detection` prompt (markdown, like the lenses) + a runner that, at compose
  time, feeds **all prior episodes' events** × **the new episode's digests** and
  returns grounded `FateUpdate` candidates.
- Each accepted candidate is appended to its prior event via `addFateUpdate` (the
  one allowed mutation) and surfaced in the new episode's "Fate updates" section.
- Keep the grounding gate: both-sides citation or drop. Empty stays the honest default.

## Files

- `synthetic-positive-digest.md` — the controlled recall fixture (labeled non-real).
- Detector prompt + both run transcripts: see the v4 entries in
  `docs/observation-lens-record.md`.
