# Lens — fate-detection (`v1.0`)

A cross-episode lens. The other three lenses look *within* a session. This one
looks *across time*: given the decision moments a prior episode already flagged
(the **watch list**) and the work done in a later episode (the **new digests**),
detect whether any flagged moment's **fate** evolved.

This lens is precision-first. On real data most watch-list items have **no** fate —
consecutive episodes are usually different feature streams. Emitting nothing is the
correct, common answer. A false "you revisited X" fabricates a narrative and is the
worst failure mode. When in doubt, drop it.

## Fate types (use exactly these)

- `expanded` — a deferred / ignored / postponed item was later actually done, or an
  existing decision was built further / generalized.
- `reverted` — a prior decision was undone or contradicted.
- `user_reframed` — the user recast the prior decision into a different frame.
- `caused_rework` — the prior decision later forced rework elsewhere.

Do **not** emit `maintained` (a decision merely still holding is not an event).

## Hard grounding rules

1. Every fate MUST cite BOTH sides concretely:
   - `target_event_id` — the exact watch-list event id whose fate evolved.
   - `evidence_ref` + `evidence_quote` — a concrete artifact in the **new digests**
     (a commit message/sha, a changed file path, or a decision turn) **and** a short
     verbatim snippet copied from the new digests that proves it.
2. If you cannot cite both sides concretely, DO NOT emit it. Silence > speculation.
3. Reject incidental keyword coincidences. The underlying artifact/topic must
   genuinely match — not just a shared word. A browser "reload the page" is NOT a
   desktop "reload while torn off". Distinguish the agent **acting** on something
   from the agent merely **reading / grepping** a pre-existing file that happens to
   mention it (a `grep` hit in a tool_result is not new work).
4. No identity claims about the user. Describe artifacts and decisions only.
5. **Require a genuine cross-episode gap.** A fate is the *later* destiny of a
   prior decision, not its immediate follow-through. If a user instruction was
   simply carried out right away (same session / next few turns), that is NOT
   fate — it is the instruction's normal execution. Drop it. Only emit when the
   evolution happens in the NEW episode's later work, separated from the original
   decision's own session.
6. **`evidence_ref` must name a concrete artifact in the NEW work** — a real
   `turn` (with a non-zero `id` and a `session_id`), a `commit` sha, or a `file`
   path. Never a placeholder (`turn 0`, empty session). If you cannot point at a
   concrete artifact in the new episode, you do not have a grounded fate — drop it.
7. **`expanded` is the easiest type to over-claim** — it requires the later work
   to genuinely build *beyond* the original decision, not merely execute or
   restate it. When unsure between `expanded` and "it just got done", drop it.

## Output (STRICT JSON, no markdown)

```json
{
  "fates": [
    {
      "target_event_id": "ev_xxxxxxxx",
      "type": "expanded",
      "evidence_ref": { "type": "commit", "sha": "7c1a2f0" },
      "evidence_quote": "fix(agent-surface): persist torn-off state across main-window reload",
      "note": "one line: why this genuinely takes up the watch-list item, not a coincidence"
    }
  ],
  "empty_reason": "if fates is empty, one line on what you checked and why nothing grounded"
}
```

`evidence_ref.type` is one of `commit` (`{type,sha}`), `file` (`{type,path}`),
`turn` (`{type,id}`), or `turn-range` (`{type,from,to}`). `evidence_quote` must be
copied verbatim from the new digests so it can be mechanically re-verified.
