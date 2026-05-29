# Observation Lens · Re-validation v3 — consolidated findings

> A from-scratch re-validation, deliberately NOT inheriting the prior
> experiments' framing. Built bottom-up with the three things the prior
> battery never had: an **independent adversarial judge** (generation ≠
> judgment), a **baseline + negative control**, and a **reliability-vs-noise**
> test. Plus a **planted-ground-truth tripwire** so precision AND recall can
> be measured against an authored key without waiting on human labels.
>
> Status: rungs 1-4 done on synthetic + 3 real projects (A/B/C). The only
> open piece is real-data recall, which needs the user's gold labels on
> proj-B (`labeling/proj-B-label-sheet.md`).

## What was run

- **Reliability**: 3 isolated reruns × {strict, deferral} × {proj-A 925T,
  proj-B 210T, proj-C 360T} + tripwire = 24+ lens runs (sonnet).
- **Precision**: 2 independent adversarial judges on the strict sets, 1 on
  each deferral set; verdicts cross-checked against digest line numbers.
- **Baseline**: regex over user turns vs lens output.
- **Negative control**: synthetic all-encouragement session.
- **Tripwire**: authored session with a hidden key (1 of each stance + 1
  off-anchor pivot + 2 pure-noise turns), run ×3 per lens.
- **Engaged-contamination audit**: judges re-classified real engaged events.

---

## The five findings

### 1. Detection is reproducible; classification is not — and reliability decays with session size

Same input, reruns:

| session | turns | deferral events (3 runs) | density /100T | strict events |
|----|----|----|----|----|
| tripwire | 26 | 5 / 5 / 5 (identical) | — | 2 / 2 / 2 |
| proj-B | 210 | 7 / 6 / 8 | **3.33** | 3 / 2 / 3 |
| proj-C | 360 | 4 / 5 / 4 | 1.20 | 2 / 2 / 2 |
| proj-A | 925 | 9 / 6 / 11 | 0.94 | 2 / 2 / 2 |

- **WHERE the lens points is stable** (anchors recur across runs; strict
  re-finds the same moments). **HOW it labels the response is not**: proj-B
  `overrode` swings 2→0→4; proj-A engaged swings 4→2→7.
- **Instability scales with session length/messiness**: tripwire (26T)
  perfectly stable, proj-A (925T) wildly unstable. The prior smoke test ran
  mostly on large real sessions and reported point estimates — single draws
  from wide distributions.

### 2. F3 ("4 projects = 4 collaboration shapes") is inside the noise floor

The marquee claim rests on the stance tuple — the least stable measurement.
Within-session `overrode` swing on proj-B (0→4) **exceeds** the B-vs-C mean
gap (2.0 vs 0.67). What separates projects is **density**, not shape — and even
density is coarse: it cleanly separates the grilling-heavy proj-B (3.3) from the
rest, but proj-A (0.94) and proj-C (1.20) overlap. Density is a real but
low-resolution signal.

Prior 🟢 → **⚫ falsified as stated**; survives only as "density distinguishes
high-junction-density collaborations from low ones."

### 3. Strict-negative-space precision ≈ 20% on real data — incl. a fabricated citation

Both adversarial judges + my own digest check:

| event | verdict | reason |
|----|----|----|
| B T32-T45 | not real | user approved ("那你加上去吧") — engagement dramatized as pivot |
| B T85-T95 | **REFUTED — fabricated** | quoted T127's text under a "T85" cite (digest line 1481 ≠ 991); leaked into 2 runs |
| B T102-T114 | not real | executor-swap, same axis |
| C T65-T87 | not real | self-resolved blocker dramatized as pivot |
| C T301-T327 | **REAL** | /schedule offer ignored → login-debug pivot; all 3 legs hold |

1 of 5 survives. Prior F4 ("source-anchored double-gate, no failure mode",
🟢) → **⚫ falsified**. The "no hallucination" guarantee leaks.

**But** strict returned **EMPTY on the negative control** and was **2/2 clean
on the tripwire** — so its failures are **over-reads of messy/ambiguous real
material + digest artifacts**, not hallucination from a void. Strict precision
is brittle to session messiness and digest quality, not fundamentally broken.

### 4. The `engaged` stance is contaminated by mere assent — the founding worry, reproduced inside the tool

- **Negative control**: all-encouragement session → 3 engaged events.
- **Tripwire (controlled, 3/3 identical runs)**: "可以,继续" → engaged;
  "好,很好" → engaged. Reproducible misclassification of encouragement as engagement.
- **Real data (proj-C)**: the engaged event flagged in **all 3 runs** ("好啊。。")
  is **bare assent**; the one genuinely substantive engagement was caught by **1/3
  runs**. The lens reliably surfaces the noise, unreliably the signal.
- proj-B milder (1 substantive, 1 pick-only, 0 assent).

This is "哪怕你无限说『非常好继续吧』也能得到丰富日志" — literalised. `engaged`
does not distinguish direction-injection from approval.

### 5. The off-anchor "third mode" (S5) is real and uncovered

Tripwire GT-C: the user, with no AI decision point exposed, spontaneously
surfaced a new concern + named a new file (`src/cli.ts`).
- **Deferral missed it** (no anchor to hang on).
- **Strict "caught" the redirect** but only by retrofitting the AI's narration
  ("我接着把 CHANGELOG 更新一下") as a declined "proposal" — capturing the
  *target* while **erasing the distinctive nature** (user-initiated, no fork).

Neither lens represents user-driven pivots as their own phenomenon. The prior
record flagged this as a 🟡 hypothesis (S5); the tripwire **confirms it by
construction**.

---

## What actually survives (the honest core)

| Holds | Confidence |
|----|----|
| No identity-claim leakage (mechanical gate) | 🟢 |
| Empty-state is explicit; no fabrication from a void (neg-control, strict) | 🟢 |
| Lens reliably finds *where* decision-junctions are (detection) | 🟢 |
| `deferred` is a narrow, stable, low-false-positive stance | 🟢 |
| Anchor **density** separates high- from low-junction collaborations (coarsely) | 🟡 |
| Strict catches a real macro-pivot **when a clean one exists** | 🟡 (≈20% precision on messy real data) |

| Does not hold (revised down) | Was |
|----|----|
| Stance *shape* = collaboration fingerprint (F3) | 🟢 → ⚫ noise floor |
| Negative-space double-gate, no failure mode (F4) | 🟢 → ⚫ ≈20% precision |
| Source-anchored, no hallucination | implicit 🟢 → ⚫ fabricated anchor ×2 |
| `engaged` is a meaningful direction signal | implicit → ⚫ assent-contaminated |

## Re-anchored read

The reproducible, trustworthy signal is the **cheap** part: *"here are your own
steering turns, and here's how dense the decision-junctions were."* The
**expensive interpretive layer** — classifying your stance, inferring what you
silently declined — is where it breaks, and it breaks toward the project's own
original sin (approval read as engagement; routine iteration dramatized as a pivot).

Three structural problems are now demonstrated, not suspected:
1. `engaged` conflates assent with engagement (findings 4).
2. Stance classification isn't stable enough to support per-collaboration claims (1, 2).
3. The digest pipeline injects errors (truncation, duplicate-shaped content →
   the T85 fabrication; `<task-notification>` rendered as user turns).

And one capability gap is confirmed: user-driven (off-anchor) pivots have no lens (5).

## Rung 4 — real-data recall (user gold labels, proj-B) — DONE

User labeled the 9 genuine user turns: 8 Y, 1 N (T33). Coverage of the 8 Y
turns by any B lens event (either lens, any of 3 runs):

| Y turn | covered? | note |
|----|----|----|
| T13, T45, T86, T103 | ✅ 3/3 runs | deferral stable (T86/T103 strict-coverage rides on invalid events) |
| T128 | ⚠️ 2/3 | |
| T207 | ⚠️ **1/3** | near coin-flip |
| **T1** | ❌ none | session-opening direction; no preceding AI decision point |
| **T142** | ❌ none | user-initiated new concern |

- **Union recall = 6/8 = 75%**; **stable recall (≥2/3 runs) = 5/8 ≈ 62%** (T207 unstable).
- **Both misses (T1, T142) are off-anchor, user-initiated** → real-data
  confirmation of finding 5: ~25% of this user's direction injections are
  invisible to both lenses because they did not follow an AI fork.
- **False positive vs gold**: T33 (the user's only N) fired in all 3 runs —
  the lens called a turn the user judged *not* a direction injection an event.
- Caveat: "covered" ≠ "correctly characterized"; some hits (T86, T103 strict)
  ride on events already judged invalid/fabricated. Deferral coverage of T86/T103
  is genuine.

This closes the last rung. Net: recall is mediocre-to-OK on anchored direction,
but has a **structural blind spot** (user-initiated pivots) that is now confirmed
on both synthetic and real data.

## Digest pipeline — fixed, then re-tested

Three correctness bugs fixed in `packages/observation/src/lib/digest.ts`
(+ 5 new tests, suite 53→58 green):

1. **`isMeta` user messages** ("Continue from where you left off.") no longer
   render as human turns.
2. **System-injected user-channel text** (`<task-notification>` etc., arriving
   as `type:"user"` *and* as `queue-operation`) dropped — was polluting the
   user-turn stream.
3. **AskUserQuestion rendered in full** (was truncated to 500 chars, the cause
   of the T152 grounding gap) — decision content is now verbatim-quotable.
4. **assistant `thinking` dropped** — private "I could do A or B" monologue was
   being fed to the negative-space lens (phantom-proposal risk).

Regenerated proj-B: 9 user-text turns = exactly the 9 genuine human turns the
user labeled, **zero** task-notification / Continue / thinking.

**Re-test on the clean digest:**

| metric | pre-fix | post-fix |
|----|----|----|
| noise user-turns | 3 (2 task-notif + 1 Continue) | **0** |
| recall vs gold | 6/8 (75%) | **7/8 (88%)** — T141 now caught; only T1 (off-anchor opener) missed |
| strict precision (adversarial) | 1/5 | **2/8** — still misgrounded |
| stance stability (overrode) | 2/0/4 | 3/5 — **still unstable** |
| T33 false positive | yes | **still yes** |

**The sharpened diagnosis — what the digest fix isolates:** on the *clean*
digest, the strict lens STILL fabricated a citation — it quoted the 3-option
menu (which lives at **T126**) under anchor **T85-T95 with user response T86**,
i.e. a "response" ~40 turns *before* the proposal exists. **Chronologically
impossible, on clean input.** This proves the misgrounding and the stance
instability are **lens/model failures, not digest artifacts**. The digest fix
was worth doing (cleaner input, +recall, removed an artifact class) but it
**relocates** the remaining problem: the next lever is the lens itself —
e.g. a programmatic grounding gate that rejects any event whose cited verbatim
doesn't byte-match the cited turn, and chronology checks (proposal-before-response).

## Grounding gate — built + measured

Implemented `packages/observation/src/lib/grounding.ts` (+6 tests, suite 58→64
green): a mechanical verifier, sibling to the forbidden-words gate. Per event,
against the digest turn text:

- `proposal_found` (fatal) — the AI-proposal verbatim must be locatable.
- `citation_accurate` (fatal) — its real turn must match the cited anchor (±2).
- `chronology` (fatal, negative-space) — proposal must precede the response.
- `response_found` (soft) — user reply can be an image/action, so non-gating.

Matcher normalizes away quotes/punctuation/whitespace (the lens wraps verbatim
in 「」 and uses full-width punctuation) and probes from both ends.

**Measured on the real lens outputs:**

| outcome | count | examples |
|----|----|----|
| **true fabrications/miscitations killed** | 7/7 | B-strict T85 (cite T85, text at T127); Bfix-strict T44/T102/T85; B-deferral T85/T152 |
| **verified-real events preserved** | ✓ | C-strict T301 (both judges REAL) kept; TW1 GT-B kept |
| **false kills of real events** | 0 | (response-soft split fixed the only one) |
| **stance contamination caught** | 0 | NC-deferral's 3 "assent→engaged" all pass — grounded, just mislabeled |

**Effect, honestly:** the gate eliminates the *fabricated/miscited* class — the
worst, trust-destroying failure, the one prompt tweaks couldn't fix — at zero
cost to verified-real events. It does **not** address the other two problems
(stance instability, assent-as-engagement), which are grounded-but-wrong and
need different mechanisms (a stance-definition fix + the missing off-anchor lens).

Status: **wired into the sync pipeline** (`packages/cli/src/observation.ts`,
`scanOneSession`). Events are gated between `runLens` and `appendSignals` — an
ungrounded event is dropped (logged) before it can enter the append-only store,
which is immutable. Exported from `@code-journal/observation`; CLI dist + plugin
bin rebuilt. Suite 64 green, workspace typecheck clean.

## #2 fix — `engaged` de-contamination (stance taxonomy v3.0)

Added a fifth stance, `assented`, and tightened `engaged` to require the user to
**add content** (reason / constraint / new option), not merely select or approve.
The deferral lens now distinguishes direction **injected** (engaged / overrode /
ignored) from **declined** (assented / deferred). lens_version bumped v2.1→v3.0
(material change); touched the lens prompt, event-schema, compose (5-tuple table),
schema defaults; +tests, suite 64 green.

**Verified against ground truth:**

| input | pre-fix | post-fix (v3.0) |
|----|----|----|
| tripwire T6 "可以,继续" | engaged ❌ | **assented** ✓ |
| tripwire T14 "好,很好" | engaged ❌ | **assented** ✓ |
| tripwire T2 "用(a),因为…" | engaged | **engaged** ✓ (genuine, preserved) |
| negative control (all encouragement) | engaged=3 | **engaged=0**, assented=3, deferred=2 |
| real proj-C "好啊。。" (T348) | engaged (3/3 runs) | **assented** ✓ |
| real proj-C substantive (T175) | engaged | **engaged** ✓ (preserved) |

Tripwire reruns identical (e1/a2/o1/d1) — the new classification is stable on
clean input. The founding-worry failure ("无限说『非常好继续吧』也能得到丰富日志")
no longer surfaces as engagement.

Remaining open item from the re-validation: #3 — the off-anchor user-driven
pivot mode (tripwire GT-C, real-data T1) still has no lens.

## Caveats

- 3 real projects, 1 author, single-agent transcripts; n=2-11 events each.
- Adversarial judges are refute-biased and disagree on verifiable facts (the
  T85 split) — verdicts were cross-checked against digest line numbers where they
  diverged. Synthetic findings (tripwire/neg-control) have authored ground truth
  and are the most reliable here.
