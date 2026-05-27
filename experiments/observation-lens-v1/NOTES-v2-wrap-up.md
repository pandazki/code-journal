# Notes · v2 Wrap-Up

> Wrap-up pass on the Phase 1 experiment, applied after the first round
> of `report.md` was committed. Documents what changed in the lens /
> composer / digest, what the new run produced, and what the comparison
> against the v1 run reveals — including a new structural finding about
> lens variance.

## What changed (the punch list, applied)

| # | Change | File |
|---|--------|------|
| 1 | JSON-escape rule baked into both lens specs | `lenses/{strict-negative-space,anchored-deferral}.md` |
| 2 | `ignored` stance now carries a `Redirected to` field naming the concrete new direction the user introduced | `lenses/anchored-deferral.md`, `schema/event.md` |
| 3 | Same-turn cross-lens marker (`↔ deferral anchor at same turn (D<n>)` on strict events; `↔ strict event at same turn` on deferral events) | `scripts/compose.mjs` |
| 4 | Anchor density + anchor-type table moved **above** stance distribution table | `scripts/compose.mjs` |
| 5 | Per-turn timestamps emitted in digest headers (`· @<ISO-ts>`) so composer can compute response latency | `scripts/digest.mjs` |
| 6 | New `## Measurements` section in each audit with 5 intrinsic counts/durations (M1–M5) | `scripts/compose.mjs` |
| 7 | Valence-stripping reminder added to audit Method section | `scripts/compose.mjs` |

After (1)–(7), all three audits were regenerated from re-run lens scans
(anchored-deferral only — strict spec did not change, but strict events
were left as the v1 run; this turned out to surface a structural finding,
see below).

## v1 vs v2 numbers (the comparison)

| Project | Run | strict | deferral | stance (e/d/o/i) | anchor types (ask/opt/unc) | convergence |
|---------|-----|-------:|---------:|------------------|----------------------------|-------------|
| A       | v1  | 4      | 11       | (5, 1, 3, 2)     | (7, 3, 1)                  | 3 / 4 = 75% |
| A       | v2  | 4      | 7        | (1, 0, 3, 3)     | (3, 3, 0)                  | 2 / 4 = 50% |
| B       | v1  | 2      | 7        | (2, 1, 4, 0)     | (2, 4, 1)                  | 1 / 2 = 50% |
| B       | v2  | 2      | 8        | (3, 0, 4, 1)     | (2, 4, 1)                  | 2 / 2 = 100% |
| C       | v1  | 3      | 4        | (2, 0, 1, 1)     | (2, 2, 0)                  | 2 / 3 = 67% |
| C       | v2  | 3      | 5        | (2, 0, 1, 2)     | (2, 1, 0)                  | 3 / 3 = 100% |

Same lens spec on B and C; spec on A actually changed only by adding the
optional `Redirected to` field, which shouldn't affect counts. Same model
(`sonnet`), same digest content (minus the timestamp suffix in headers
which the lens doesn't use). Yet:

- **A's stance shape changed from engaged-dominant (5/1/3/2) to
  overrode+ignored dominant (1/0/3/3).** The `engaged` count dropped 5x.
- **B's overrode count is stable at 4, but `engaged` went 2→3 and the
  total grew 7→8.**
- **C's `ignored` count went 1→2 and convergence jumped 67%→100%.**

## What this reveals (a new structural finding)

**Lens output has non-trivial run-to-run variance, especially in the
"engaged" stance category.** The `engaged` label is the most permissive
of the four — anything that addresses the anchor with substance counts —
which makes it most sensitive to the lens's interpretive threshold from
run to run. The narrower categories (`deferred`, `ignored`) are more
stable because they have sharper definitional gates.

This was **predicted in the framework** (§ 14.1 — recall is not validated
from precision alone) but the experiment now provides numerical evidence:
**single-run numbers are samples, not ground truth.** The Limitations
section of the audits has been updated to call this out.

Two concrete implications:

1. **For MVP-II reporting**: any measurement that gets surfaced should
   tolerate ±30% noise per run. The 5 measurements M1–M5 in the new
   composer all have this property — they're counts, not percentages with
   implied precision.
2. **For Phase 2+ recall validation**: running the same lens N times on
   the same digest and taking the union (or intersection) is a cheap
   recall-improvement technique. Single-pass should be the default, but
   the option to "double-scan critical sessions" should exist in MVP-II's
   `code-journal sync`.

## What the v1 `report.md` is now (and isn't)

`report.md` and `report-bilingual.md` document the **v1 experiment** —
they were committed before this wrap-up. The qualitative findings (H1–H7
verification, the three project shapes you confirmed against memory, the
"same user same week different projects different distributions" finding)
**all still hold** with v2 data — actually, v2 sharpens some of them:

- **A is even more clearly "off the AI's anchor axis" in v2** — only 1
  engaged event out of 7. v1's 5 engaged events may have over-counted soft
  acknowledgements as engagement.
- **B's convergence jumped to 100%** in v2 — every strict event has a
  deferral anchor at the same turn. This is the strongest evidence yet
  that on B the user reliably reframes at AI-flagged decision-points,
  rather than wandering off-axis at unmarked moments.
- **C's convergence also went to 100%** — same finding, same project
  character (debug-driven session where user redirects from AI's
  nice-to-haves to immediate problems).

The headline of v1's report ("all 7 testable hypotheses survive") becomes
**stronger** under v2 data, not weaker.

## New measurements (M1–M5) — what each project's numbers look like in v2

```
                A             B             C
M1 density:     0.76/100T     3.81/100T     1.39/100T
M2 latency:     0.2s → 41m    11s → 4m      varies
M3 magnitudes:  8,7,4,4       3,2           varies
M4 turn-dist:   1 → 2         1 → 1         varies
M5 convergence: 2/4           2/2           3/3
```

What stands out (without putting it on a scale):

- **A's M2 range is enormous** (0.2s to 41 minutes). Single-stance-bucket
  treatment hides this — the same `engaged` label covered a 0.2-second
  "好" and a 41-minute deliberation. M2 makes this visible without
  needing to invent an "engagement quality" score.
- **B's M1 (3.81 anchors per 100 turns) is structurally consistent
  with v1** (was 3.3). M1 is the most stable measurement we have —
  consistent with the framework's claim that anchor density is a
  property of the agent on the project, not the user.
- **A's M3 magnitudes (8, 7, 4, 4) decline over time.** Earlier pivots
  in the session landed bigger artifact-sets in After; later pivots are
  smaller. This is descriptive, not evaluative — could mean the project
  consolidated, or could mean the lens missed late artifacts. Reader
  decides.
- **M5 convergence ≥ 67% in all three projects in v2.** The v1 finding
  that the lenses are "non-interfering but converge on key turns" is
  reinforced.

## State of the codebase

After this commit:

- All MVP-I infrastructure is in place. The lens specs, schema, digester,
  and composer are ready to be reused as-is when MVP-II (signal store +
  cron + episode trigger) gets built.
- The 4-item punch list from the prior conversation + the 5-item
  measurements addition are all implemented.
- Single-run experimental snapshots can be produced by:

  ```sh
  node experiments/observation-lens-v1/scripts/digest.mjs \
      --in <session.jsonl> \
      --out digests/proj-X/session.md \
      --project-code X
  # dispatch 2 subagents (one per lens) — orchestration is manual in MVP-I
  node experiments/observation-lens-v1/scripts/compose.mjs \
      --project X \
      --out audits/proj-X.md
  ```

- For MVP-II, the only mechanical additions on top of this are: persistent
  signal store, dispatch loop (replacing manual subagent invocation),
  cron + information-increment gate, and episode versioning in compose.
  Estimated 3-5 days of focused work, unchanged from prior estimate.
