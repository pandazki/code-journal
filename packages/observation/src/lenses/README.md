# Lens specs (canonical prompts)

Each `<lens>.md` here is the **canonical prompt** dispatched to isolated
subagents at `code-journal sync` time. They are intentionally plain
markdown — not embedded in code — so a future agent / developer can
read them as-is, and so the `lens_version` cadence is divorced from the
compiled TypeScript.

## Files

- `strict-negative-space.md` — macro-pivot lens (3-leg gate)
- `anchored-deferral.md` — stance-at-junction lens (4 stances)
- `event-schema.md` — shared event JSON schema referenced by both lens
  prompts

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

| Lens | Events per session (Phase 1+2 typical) | Density per 100 turns |
|------|----------------------------------------|----------------------|
| strict-negative-space | 0-4 (sparse by design) | ~0.5-1.0 |
| anchored-deferral | 4-12 (anchor-dependent) | 0.7-3.8 (varies with agent) |

Empty results are **explicit** (`events=0` + `empty_state_reason`) per
Phase 2 E2 — never silently empty.
