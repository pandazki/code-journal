# Changelog

## Unreleased

- **Observation: fate auto-detection (§ 8)** — `compose` now surfaces the *fate*
  of prior-episode decisions: a grounded cross-episode detector runs as a separate
  phase before the (still deterministic) composer, scanning the new episode's work
  against **all** prior episodes' flagged moments and appending `expanded` /
  `reverted` / `user_reframed` / `caused_rework` updates onto the prior events
  (`addFateUpdate`). Precision-first: both-sides citation or drop — an evidence
  snippet that can't be reproduced verbatim in the new digests, or a target that
  isn't a real prior event, is dropped; empty is the honest, common result. Uses
  the same `claude -p` / codex plumbing as the lenses (no API key); a detection
  failure never blocks the episode. Replaces the previous hardcoded empty fate
  section. Prototyped and validated (precision + recall) in
  `experiments/observation-lens-v4-fate/`.

- **Observation: episodes are now disjoint periods** — `compose` covers only the
  events no prior episode has already composed (the low-water mark is the union
  of every prior episode's `source_signals[].event_ids`), instead of re-auditing
  the entire append-only store on every call. Before this, Episode N nested over
  Episode N-1's events, which made fate tracking structurally impossible (no
  prior-vs-new partition), made cross-episode measurements non-independent, and
  contradicted the "new period → new episode" model. `compose --force` no longer
  re-pulls already-composed events (it can't fabricate a duplicate episode from
  an empty new slice). No state migration — the fix reads the low-water mark back
  from the episode metadata already on disk.

- **Per-project timezone** — each project reckons calendar days in one timezone,
  set once and used everywhere: entry filing date, `today` / `yesterday` query
  windows, catch-up's pending-report list, and report staleness. `init`
  auto-detects the host's IANA zone (e.g. `Asia/Shanghai`) and records it in
  `config.json`; pin a different one with `init --timezone <IANA>` (handy for a
  project worked from machines in different zones, or a UTC server). This
  replaces a latent split where entries were filed by **UTC** date while
  "today" was computed in **local** time — near midnight in non-UTC zones the
  two disagreed, so a day's work could land under the wrong date or a finished
  day never showed up for drafting.

## 0.2.0 — observation lens

The observation lens ships: take the same raw coding-agent sessions and surface
**where you, not the agent, injected direction**. A separate product line from
the visual journal, local-first, mirror-not-judge. Full guide:
[`docs/observation-lens.md`](docs/observation-lens.md) (中文:
[`docs/observation-lens.zh.md`](docs/observation-lens.zh.md)).

- **Three-layer architecture** — digest → detection (lenses) → append-only
  signal store → immutable audit episode, driven by `code-journal sync` /
  `compose` / `status`. Lenses shell out to your installed `claude` CLI; nothing
  is uploaded.
- **Three lenses** — `strict-negative-space` (macro pivots), `anchored-deferral`
  (your stance at AI decision points), and the experimental
  `user-initiated-pivot` (direction injected with no AI prompt).
- **Web console** — `code-journal` → **Observation →** (`/observe`): a typeset
  reader for the audits (stance ink-band, turn-position density strip, per-event
  verbatim cards) plus per-project settings (model, compose threshold). Built for
  content density the TUI can't show; served by the same zero-dep local server as
  the journal. Quickstart: [`docs/observation-lens-quickstart.md`](docs/observation-lens-quickstart.md)
  (中文: [`.zh.md`](docs/observation-lens-quickstart.zh.md)).
- **Grounding gate** — every event is mechanically re-verified against the digest
  before it can enter the store; hallucinated or miscited events are dropped at
  ingestion. The model's self-citation is never trusted.
- **`assented` stance** (anchored-deferral v3.0) — bare approval ("继续吧 / keep
  going") is now kept distinct from `engaged`, so approval no longer reads as the
  user actively shaping the work.
- **Analysis language** — lenses write their prose in the project's language,
  auto-detected from your own messages on first sync (char-script heuristic, no
  model call) and overridable in the console's Settings. Verbatim quotes are
  never translated; audit headings follow the language (EN + ZH today).
- **Empty-state is explicit** — low-signal sessions produce zero events with a
  reason, never a manufactured story. A forbidden-phrases gate refuses to write
  any audit containing identity claims about the user.
- **Known limits (by design):** stance shape is not a personal fingerprint; fate
  tracking is manual; very large sessions and cross-machine sync are not yet
  handled. See the guide's Limitations section.

## 0.1.0 — initial release

First open-source release.

- **`cj`** — an Ink terminal app to discover, browse, and upload coding-agent
  sessions. One persistent board: a projects panel, a session master-detail
  panel, a transcript viewer with subagent navigation, and an activity log.
- **Session discovery** across Claude Code, Codex, and Claude Cowork — git
  worktrees folded in, deduped by session id.
- **S3-compatible upload** — works with AWS S3, Cloudflare R2, MinIO,
  Backblaze B2, … One folder per session (`transcript.jsonl` + `meta.json` +
  `subagents/` / `tool-results/` sidecar files). Incremental: only new or
  changed sessions are re-uploaded.
- **Scheduled upload** via the system cron — `cj cron install` and the headless
  `cj sync` command.
- **First-run wizard** — a resumable setup flow (scan projects → S3 target →
  schedule).
- **Auto-scan** — sweep every agent's history and generate projects, grouped by
  git repository.
- **Claude Code plugin** — drafts work-log entries and daily reports from the
  collected sessions.
- **Reference server** — receives reports and uploaded sessions and serves a
  browse UI with a faithful transcript viewer.
