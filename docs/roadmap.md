# Roadmap

Where code-journal is heading, and the work to get there. Items marked
**OPEN** are not settled yet.

## Direction

code-journal is a **local, project-scoped tool** that turns your AI coding-agent
sessions into a **visual journal** of your work.

- You run `code-journal` inside a project; it starts a local web server and
  opens a browser onto that project's journal.
- **Local-first, zero-config.** It reads your local agent sessions
  (`~/.claude/projects/`, Codex, Cowork) directly — no upload, no account, no
  setup needed to get value.
- The **journal** is the centerpiece: not a list of worklog entries, but a
  visual, time-organized narrative of your work — days you can see and flip
  through.
- Uploading sessions to S3, pushing reports to a remote server — **optional
  extensions**, configured in the GUI, off by default.

The current Ink TUI is superseded by the web GUI: a journal needs real visuals
(timelines, heatmaps) a terminal can't do well. The discovery and
transcript-parsing logic in `packages/core` carries over unchanged; so does the
transcript-viewer SPA in `server/public/`.

## A — Pivot to a local web GUI

- [ ] CLI: `code-journal` in a project dir → start the local server + open the browser
- [ ] Build the GUI on the existing `server/` + `server/public/` SPA
- [ ] Port the TUI's features into the GUI — project view, session list, transcript + subagent viewer
- [ ] Move configuration (S3, remote server) into the GUI; make it optional, never a gate
- [ ] Retire / shrink `packages/tui` (the Ink board) — keep its logic in `core`
- [ ] Keep a headless `code-journal sync` for the cron path

## B — The journal (the centerpiece)

- [ ] Day-as-unit journal model — assemble a day's entry from its sessions + git commits
- [ ] Pure-metadata day card (no LLM): session count, time span, files touched, commands run, commits, the day's opening prompt
- [ ] **Stream view** — scrollable day cards with activity density / intensity
- [ ] **Day detail** — the day's story, drilling into each session
- [ ] **Project arc** — a project's life: when it started, activity peaks, milestones
- [ ] **Activity heatmap** — when / how much coding-agent activity
- [ ] (extension) optional LLM-written narrative for the day card

## C — Onboarding & adoption

- [ ] First run = zero-config, straight to the journal — no S3 gate
- [ ] Prebuilt release binaries + a one-line install; tag a release, wire `release.yml`
- [ ] (idea) a "local archive directory" backup target, so backup needs no cloud

## D — Extensions (optional, user-configurable)

- [x] S3-compatible session upload
- [x] Push worklog / reports to a remote server (`server/`)
- [x] Scheduled upload via cron
- [ ] Define clean extension points so users can add their own targets

## Open questions

- **OPEN** — journal unit: day (leaning), session, or week?
- **OPEN** — main view: a single project's journal, or an all-projects overview too?
- **OPEN** — the "what was this day about" line: pure metadata for v1, LLM as an extension?
- **OPEN** — the Claude Code plugin's worklog/report path: fold into the journal, or keep as an independent extension?
