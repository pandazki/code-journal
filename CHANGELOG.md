# Changelog

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
- **Grounding gate** — every event is mechanically re-verified against the digest
  before it can enter the store; hallucinated or miscited events are dropped at
  ingestion. The model's self-citation is never trusted.
- **`assented` stance** (anchored-deferral v3.0) — bare approval ("继续吧 / keep
  going") is now kept distinct from `engaged`, so approval no longer reads as the
  user actively shaping the work.
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
