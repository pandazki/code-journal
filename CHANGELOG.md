# Changelog

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
