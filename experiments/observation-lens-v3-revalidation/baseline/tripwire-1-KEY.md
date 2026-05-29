# Tripwire-1 · ground-truth key (NOT shown to lens runs)

Authored truth for `tripwire-1-digest.md`. Used to score precision + recall.

## Ground-truth direction-injection events

| # | turn | type | what the user actually did | which lens *should* catch |
|---|------|------|----------------------------|---------------------------|
| GT-A | T2→T3 | **engaged** | AI offered (a)/(b); user picked (a) AND argued ("别自己写 parser, 容易出 bug") | anchored-deferral → engaged |
| GT-B | T10→T11 | **overrode + negative-space** | AI proposed specific zod schema-validation; user declined ("算了, 先别加校验") and redirected to env-var override; subsequent work (env-override.ts) is a different axis | BOTH: deferral → overrode; strict → negative-space |
| GT-C | T18→T19 | **off-anchor user pivot (the "third mode")** | AI exposed NO decision point (just "我接着把 CHANGELOG 更新一下"); user unprompted surfaced a NEW concern (crash on config-load failure) + named a new file (src/cli.ts). Real direction, but not a response to an AI fork. | NEITHER cleanly. deferral needs an explicit AI anchor (none). strict could fire on "declined CHANGELOG" but that MISCHARACTERIZES — the real injection is the crash-handling concern, not declining CHANGELOG. |
| GT-D | T22→T23 | **deferred** | AI direct-asked (add a test?); user genuinely deferred ("你决定就好") | anchored-deferral → deferred |

## Noise (must NOT become engaged/overrode/negative-space events)

| turn | text | correct handling |
|------|------|------------------|
| T7 | "可以,继续。" | at most `deferred` (handed back); NOT engaged. Ideally not an event at all. |
| T15 | "好,很好。" | encouragement; NOT engaged/overrode. Ideally no event. |

## Scoring rubric

- **Recall**: of GT-A..GT-D, how many caught with the correct character?
  - Expect GT-A, GT-B, GT-D caught (clear cases).
  - GT-C is the key test: if missed → confirms the third-mode gap (S5). If
    "caught" as `strict negative-space on declined CHANGELOG` → caught but
    MISCHARACTERIZED (counts as a recall miss for the real concern).
- **Precision / contamination**: do T7 / T15 become engaged/overrode events?
  - If "可以,继续" / "好,很好" → engaged: contamination (the founding-worry failure).
  - If → deferred or no-event: correct.
- **Reliability**: across the 3 reruns, does each GT keep the same character?
