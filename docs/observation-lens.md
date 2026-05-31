# Observation Lens — developer & user guide

> **Status: shipping (v0.2.0).** This is the canonical, code-matching
> documentation for the observation-lens feature. It describes what the code
> *does today*, not what was explored to get here. The exploratory record —
> phases, hypotheses, re-validation rounds — lives separately under
> `experiments/observation-lens-*/` and `docs/plans/`; this document supersedes
> those for anyone using or maintaining the feature.
>
> 中文版见 [`observation-lens.zh.md`](observation-lens.zh.md)。

## What it is

The observation lens takes the same raw coding-agent transcripts the journal
reads and surfaces **where the user — not the agent — injected direction**: the
moments where a person steered the work, declined what was on the table, or
introduced a new concern. It is a mirror, not a judge: every event points at
verbatim transcript evidence, and the system refuses to manufacture events where
there are none.

It is a separate product line from the visual journal. It runs locally, shells
out to your already-installed coding agent (`claude -p`) to apply the lenses, and
writes immutable per-project **audit episodes** to `~/.code-journal/observations/`.

## The three-layer architecture

```
transcript (.jsonl)
   │  digest.ts — turn-indexed markdown, noise stripped
   ▼
DETECTION       three lenses, each an isolated `claude -p` subagent
   │  lens-runner.ts → strict-negative-space · anchored-deferral · user-initiated-pivot
   ▼
[grounding gate]  grounding.ts — mechanical re-verification of every event
   │  drop anything whose citation can't be reproduced against the digest
   ▼
SIGNAL STORE    store.ts — append-only JSONL, one file per lens, deduped by id
   │
   ▼
AUDIT           compose.ts — δ' markdown episode (forbidden-words gated), immutable
```

CLI surface (`code-journal …`, also `cj`):

- `sync` — discover new sessions, digest them, run all three lenses, gate, append.
  Auto-composes when a project crosses its new-events threshold.
- `compose --project <name|id>` — compose the next audit episode from the store.
- `status` — per-project signal-store counts + episode history.

## The three lenses

Each lens is a single-purpose prompt (`packages/observation/src/lenses/*.md`)
dispatched to an **isolated** subagent. Lens prompts are plain markdown on
purpose, so their versioning is independent of the compiled code.

### 1. `strict-negative-space` (v2.1)

Macro pivots: the AI made a **specific** proposal, the user did **not** take it
up, and subsequent work demonstrably went along a **different axis**. All three
legs must hold or there is no event. Sparse by design (0–4 per session).

### 2. `anchored-deferral` (v3.0)

The AI exposed an explicit decision point (a "fork": direct question / ≥2 named
options / explicit uncertainty), and the user's immediate response is classified
into one of **five stances**:

| stance | meaning | direction |
|--------|---------|-----------|
| `engaged` | user **added content** — a reason, a constraint, a new option | injected |
| `overrode` | rejected the framing, redirected to a different concern | injected |
| `ignored` | changed topic; the question hangs while work proceeds elsewhere | injected (elsewhere) |
| `assented` | bare approval of the AI's proposal ("可以,继续", "looks good") | **declined** |
| `deferred` | handed the choice back ("you decide", "你决定就好") | **declined** |

The `engaged` / `assented` split is load-bearing: approval is not engagement.
Collapsing them re-introduces the failure the whole feature exists to avoid —
where "继续吧 / keep going" reads as the user actively shaping the work.

### 3. `user-initiated-pivot` (v1.0 · experimental)

The user injected direction with **no AI fork in front of them** — an unprompted
new concern / file / requirement that subsequent work took up. This is the
collaboration mode the other two lenses structurally cannot see (deferral needs
an anchor; strict needs a declined proposal). Source-anchored 3-leg gate.

**Experimental:** validated primarily on one author's transcripts; its soft
edges are not tuned — it deliberately does not fire on session openers (no
preceding AI turn) and under-fires on question-form concern-surfacing. Treat its
output as a useful signal, not a settled measurement.

## Grounding gate

Lens prompts *ask* for source-anchored events; the grounding gate *enforces* it
in code, because prompt instructions alone don't hold. Re-validation found lenses
emitting plausible-but-ungrounded events even on clean input (citing a proposal
that lived 40 turns away; quoting text that didn't exist at the cited turn). The
gate (`lib/grounding.ts`, applied in `sync` before the append-only store) drops
any event that fails a **fatal** check:

- **`proposal_found`** — the quoted AI-proposal/anchor verbatim is locatable in
  the transcript (normalized match: punctuation/quote/whitespace-insensitive).
- **`citation_accurate`** — its real turn matches the cited `turn_anchor` (±2).
  When a verbatim recurs (the AI repeated a plan), the occurrence nearest the
  cited anchor is used, so an earlier copy doesn't cause a false drop.
- **`chronology`** (strict only) — the proposal precedes the response.
- **`no_preceding_fork`** (pivot only) — no AI decision point preceded the
  user's direction; if one did, the moment belongs to `anchored-deferral`.
- `response_found` is **soft** (reported, non-gating): a user reply can be an
  image or an action, so its absence must not kill a real event.

Because the store is append-only and audits are immutable, the gate runs at
**ingestion** — an ungrounded event is dropped before it can ever reach a
published episode. Do not bypass it.

A second, independent hard rule lives in `compose.ts`: a forbidden-phrases check
that refuses to write an audit containing identity claims about the user ("the
user is/tends to/prefers …"). The lens is an observation, never a verdict.

## How to run it

```sh
# discover new sessions, run all lenses, gate, append; auto-compose at threshold
code-journal sync                       # all projects
code-journal sync --project myproj      # one project
code-journal sync --project myproj --limit 5 --verbose

# compose the next immutable audit episode from the signal store
code-journal compose --project myproj

# inspect signal-store counts + episode history
code-journal status
code-journal status --project myproj --verbose   # also prints lens versions
```

Requirements: a working `claude` CLI on PATH (lenses shell out to it; `haiku` is
rejected — too lossy). Sessions are read locally; nothing is uploaded.

## How to read an audit episode

### The web console (recommended)

Run `code-journal` to open the journal, then click **Observation →** (or visit
`/observe`). The console reads `~/.code-journal/observations/` live and renders,
per episode: the **stance distribution** as an ink band (direction injected takes
ink; declined stays faint), a **density strip** of where in the session direction
landed, and **per-event cards** with verbatim quotes — each expandable for source
refs and the lens's reasoning. **Settings** (`/observe#/settings`) edits
per-project config (model, compose threshold). Built for the content density the
TUI can't show; served by `packages/app` (the same zero-dep local server as the
journal); nothing is uploaded.

### The raw markdown

Each episode is also plain markdown at
`~/.code-journal/observations/<project>/episodes/<n>-<date>.md` (immutable; the
`.json` sibling is its metadata). Sections:

- **Scope / Method** — window covered, which lens versions ran.
- **Measurements** — counts and densities (M1–M6). Counts, not scores.
- **Anchor distribution** — shown *before* stance, on purpose: stance counts are
  conditional on the AI having exposed decision points at all.
- **Stance distribution** — the 5-tuple `(e, a, d, o, i)` with an injected /
  declined column.
- **Findings — Strict negative-space / Anchored deferral / User-initiated pivot**
  — the per-event cards with verbatim quotes and source refs.
- **Fate updates** — how earlier events fared in later episodes (manual in this
  release; see Limitations).
- **Limitations / Source index.**

Read it as a logbook entry you return to, not a dashboard you glance at.

## Limitations — what this release does NOT claim

These are deliberately stated; honoring them is part of using the feature
correctly.

- **Stance shape is not a personal fingerprint.** Run-to-run classification
  variance is real and can exceed between-project differences; report the counts,
  do not derive a "user profile" from the shape.
- **`strict-negative-space` precision is moderate** (~20–35% of raw emissions on
  real data are ungrounded). The grounding gate removes them, so what reaches an
  audit is trustworthy — but the lens is low-yield, and recall is not measured.
- **`user-initiated-pivot` is experimental** (see above).
- **`assented` vs `engaged` is a best-effort line** — borderline approvals can
  fall either way between runs; the prompt biases toward `assented` when unsure.
- **Not implemented / not validated in this release:** fate tracking is manual
  (the schema has the fields, there is no auto-detection or `fate add` CLI yet);
  very large sessions (>~2000 turns) can exceed the model context and are skipped
  with a retry mark; cross-machine sync, multi-user/sharing, and real-human
  reader validation are untouched.
- **Digest truncation:** `tool_result` payloads are capped, so a very long
  AI anchor can fall partly outside the digest and become unverifiable; such an
  event is conservatively dropped by the gate.

## For maintainers

- **Where things live:** lenses in `src/lenses/*.md`; dispatch in
  `lib/lens-runner.ts`; gate in `lib/grounding.ts`; store in `lib/store.ts`;
  state/schema in `lib/schema.ts` + `lib/state.ts`; audit render in
  `lib/compose.ts`; CLI in `packages/cli/src/observation.ts`. Tests:
  `packages/observation/test/*.test.ts`.
- **Adding/changing a lens prompt:** if the change is *material* (shifts what
  counts as an event or how it's classified), bump
  `lens_versions[<lens>]` in `schema.ts` so old and new events don't collide on
  the same id. See `src/lenses/README.md` for the cadence + recharacterize helper.
- **Adding a lens:** extend the `LensId` union + `LENS_IDS` + `isLensId` in
  `schema.ts` and the three `lens_versions` literals; teach `extractVerbatims`
  in `grounding.ts` its payload shape; add a Findings section in `compose.ts`.
  The sync loop and gate then pick it up automatically.
- **The gates are not optional politeness.** The grounding gate and the
  forbidden-phrases check are the trust contract. Tests pin their behavior; if a
  change makes them fail, the change is wrong, not the test.
