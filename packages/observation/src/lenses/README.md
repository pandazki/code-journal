# Lens specs (canonical prompts)

Each `<lens>.md` here is the **canonical prompt** dispatched to isolated
subagents at `code-journal sync` time. They are intentionally plain
markdown — not embedded in code — so a future agent / developer can
read them as-is, and so the `lens_version` cadence is divorced from the
compiled TypeScript.

## Files

- `strict-negative-space.md` — macro-pivot lens (3-leg gate)
- `anchored-deferral.md` — stance-at-junction lens (5 stances)
- `user-initiated-pivot.md` — off-anchor pivot lens (3-leg gate) · **experimental**
- `event-schema.md` — shared event JSON schema referenced by all three lens
  prompts

See [`docs/observation-lens.md`](../../../../docs/observation-lens.md) for the
canonical developer/user documentation of the whole feature (what each lens is,
what the grounding gate guarantees, how to read an audit, and the honest limits).

## `lens_version` cadence

Lens prompts evolve. When a prompt **materially changes** (changes that
would shift event counts or classifications), bump the version pinned
in `ProjectState.config.lens_versions[<lens>]`.

What counts as material:

- **Material** (bump version):
  - changing what counts as an event (add/remove/loosen a leg)
  - changing how stance is classified
  - adding or removing required payload fields
  - changing the empty-state condition
- **Not material** (no bump):
  - clarifying language without changing behaviour
  - fixing typos
  - extending forbidden-words list without redefining a gate
  - tightening JSON-escape instructions (cosmetic)

## Recharacterize-on-bump protocol

When you bump a lens version, run the recharacterize helper:

```sh
node scripts/recharacterize-lens.mjs \
  --lens strict-negative-space \
  --reference <path-to-stable-reference-session> \
  --n 5
```

This dispatches N isolated runs against the same digest with the new
prompt and produces a `variance budget` per stance category. The
result feeds the audit composer's "stance counts ± range" rendering
(see MVP-II plan § 3.4 / E1 finding).

## What lives where

```
~/.code-journal/observations/<pid>/state.json     pinned lens_versions per project
packages/observation/src/lenses/                  canonical prompt content + this README
packages/observation/src/lib/lens-runner.ts       dispatch logic (claude -p)
scripts/recharacterize-lens.mjs                   variance-budget helper (M7)
```

## What the lenses produce (recap)

| Lens | Events per session (typical) | Stances / classification |
|------|------------------------------|--------------------------|
| strict-negative-space | 0-4 (sparse by design) | negative-space (single class) |
| anchored-deferral | 4-12 (anchor-dependent) | engaged / assented / deferred / overrode / ignored |
| user-initiated-pivot | 0-2 (sparse; **experimental**) | user-initiated-pivot (single class) |

Empty results are **explicit** (`events=0` + `empty_state_reason`) — never
silently empty.

## Grounding gate (don't bypass it)

Every event a lens emits passes through `lib/grounding.ts` before it can enter
the append-only signal store (`cmdObservationSync` → `checkEventGrounding`).
The gate mechanically re-verifies the lens's own citations against the digest —
it does **not** trust the model's self-report:

- `proposal_found` (fatal) — the quoted AI-proposal/anchor verbatim must actually
  appear in the transcript
- `citation_accurate` (fatal) — its real location must match the cited
  `turn_anchor` (±2; nearest occurrence when a verbatim recurs)
- `chronology` (fatal, strict only) — the proposal must precede the response
- `no_preceding_fork` (fatal, pivot only) — no AI decision point may precede the
  user's direction (else it belongs to anchored-deferral)
- `response_found` (soft) — the user reply may be an image/action, so non-gating

This is the same philosophy as the forbidden-words gate: the lens prompts ask
for source-anchored events, and the gate enforces it in code so a hallucinated
or miscited event can never reach a published audit. See
[`docs/observation-lens.md`](../../../../docs/observation-lens.md) § Grounding.

## Stance taxonomy (anchored-deferral v3.0)

`assented` was split out from `engaged` (v2.1 → v3.0) because bare approval of
the AI's proposal ("可以,继续", "looks good") is **not** the user injecting
direction — only `engaged` (added a reason / constraint / option), `overrode`,
and `ignored` are. Keep `assented` distinct; collapsing it back into `engaged`
re-introduces the contamination the split was made to remove.
