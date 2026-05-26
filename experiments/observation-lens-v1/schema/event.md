# Event Schema

The unit produced by a lens scan. One JSON object per event.

## Required fields

```jsonc
{
  "lens_id":        "strict-negative-space" | "anchored-deferral",
  "session_id":     "<uuid>",            // from .jsonl filename
  "project_code":   "A" | "B" | "C",     // anonymised
  "turn_anchor":    "<integer or range>",// 1-indexed turn(s) in the digest
  "timespan":       "<HH:MM-HH:MM>",     // approximate clock window in the session

  "source_refs": [                       // every claim must point back
    { "type": "turn", "id": <int> },
    { "type": "turn-range", "from": <int>, "to": <int> },
    { "type": "commit", "sha": "..." }   // optional, only if visible in transcript
  ],

  "payload":        "...lens-specific markdown..."
}
```

## Per-lens payload shape

### lens_id = "strict-negative-space"

Payload is a markdown block following the framework § 11.1 5-section card:

```
**Arc**: <2-3 sentences naming the work in progress at this point>

**Before**: <1-2 sentences — AI's specific proposal that wasn't taken up,
              named with enough detail to be identifiable>

**Event (AI proposal — verbatim)**: <copy AI's specific proposal>
**Event (user response — verbatim)**:  <copy user's response>
**Event classification**: negative-space

**After — concrete artifacts**: <2-4 sentences naming what work actually
              landed: files, commits, decisions. NO topic descriptions —
              concrete artifacts only.>

**Why this satisfies the criteria**: <1-2 sentences. Must address: (a) AI
              proposal was specific, (b) user didn't take it up, (c) the
              subsequent work demonstrably followed a different axis.>
```

### lens_id = "anchored-deferral"

Payload is a markdown block with stance classification at an AI salience
event:

```
**Anchor (AI salience event)**: <one of: direct-ask | ≥2-named-options |
              explicit-uncertainty>
**Anchor verbatim**: <copy AI's salience event>
**User response verbatim**: <copy user's response>
**Stance**: engaged | deferred | overrode | ignored
**Why this stance, not another**: <1 sentence>
```

## Hard rules (enforced in lens prompts)

- **No identity claims.** Forbidden words/phrases in payload:
  "user is X type", "user tends to", "the user prefers", "personality",
  "type of developer", "always", "habitually". Replace with concrete
  citations. (§ 4.1, § 4.3)
- **No valence.** No "good", "bad", "correct", "smart", "wise", "weak", etc.
  Direction-injection events have no inherent valence. (§ 8)
- **Source-anchored or skip.** Cannot infer events from missing data; if
  there's no AI proposal specific enough to recognise it being declined,
  there's no negative-space event. (§ 7)
- **Empty-state explicit.** When the lens finds nothing in a session, output
  exactly:
  ```
  EMPTY-STATE: scanned <N> turns; found 0 events. <one sentence on
  why — e.g. "AI never exposed a salience event meeting the anchor
  definition", or "AI proposals were too vague to count as identifiable">
  ```
  Not a blank list, not "no events found." (§ 11.5)

## Output format from the subagent

The subagent returns a single JSON object:

```jsonc
{
  "lens_id": "...",
  "session_id": "...",
  "project_code": "...",
  "events": [ /* zero or more event objects */ ],
  "empty_state_reason": "...optional, present only when events is empty..."
}
```

Nothing else — no preamble, no explanation. Strict JSON.
