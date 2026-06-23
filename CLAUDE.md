# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# code-journal

A local, typeset journal of your AI coding-agent sessions. It reads the
transcripts your coding agents (Claude Code, Codex, Cowork) leave on disk and
turns them into a browsable journal — what you built, day by day, project by
project. Everything runs locally. See `README.md` for the user-facing overview.

## Layout

`packages/*` and `server/` form one npm workspace (`engines.node >= 22`).
`claude-plugin/` is **not** a package — its CLI bundle is generated into
`claude-plugin/bin/` by `npm run sync-plugin-bin`.

- `packages/core` (`@code-journal/core`) — session discovery, transcript
  parsing, and the journal model. Pure library; everything else builds on it.
- `packages/observation` (`@code-journal/observation`) — the observation
  lenses, grounding gate, and audit composer. Depends on core.
- `packages/app` (`@code-journal/app`) — the local journal web app. **`npm
  start` runs this** (`packages/app/dist/main.js`). Builds the journal from
  disk, serves it on loopback, opens the browser.
- `packages/cli` (`@code-journal/cli`) — the CLI: work-log/report subcommands
  (driven by the Claude Code plugin) plus the observation-lens subcommands
  (`sync`, `compose`, `status`). Bundled with tsup.
- `packages/tui` (`@code-journal/tui`) — `cj`, an older terminal session
  collector that backs sessions up to S3. Node + Ink + React. Agent-driven
  setup: `packages/tui/AGENT-SETUP.md`.
- `server/` (`@code-journal/server`) — reference server that receives uploaded
  reports/sessions. Web-standard (`Request`/`Response`) Node.
- `claude-plugin/` — Claude Code plugin: drafts work-log entries and daily
  reports (`skills/`, `agents/`).

## Architecture

**Journal pipeline.** Coding agents leave transcripts on disk →
`packages/core` discovers sessions and parses transcripts into the journal
model → `packages/app` builds the journal (`buildJournalFromDisk`) and serves
the almanac, project arcs, and raw-transcript views. The journal is fully
usable on metadata alone; narratives and observation are optional layers on
top.

**Observation lens** (`packages/observation`) is a three-layer pipeline:

```
Detection (continuous) → Signal Store (append-only) → Audit (episodic, frozen)
```

Hard invariants enforced throughout: events are append-only and never rewritten
post-write; episodes are immutable once composed (a new period makes a new
episode); everything is source-anchored or skipped (the grounding gate drops
anything it can't reproduce against verbatim transcript). Lenses live as
markdown specs in `packages/observation/src/lenses/`.

**Zero-marginal-cost generation.** Both the observation lens and the day/project
narratives run by shelling out to the user's installed coding-agent CLI
(`claude -p` by default, or `codex`) — no API key, no account. See
`packages/app/src/narrate.ts` and `packages/observation/src/lib/lens-runner.ts`.

## Build & test

```sh
npm install         # installs workspaces, builds core+observation+cli+app, syncs plugin bin
npm start           # build the journal and open it in the browser (packages/app)
npm run typecheck
npm test            # runs `test` across all workspaces that define it
```

Build order matters: `core` and `observation` must be built (their `dist/` is
what downstream packages import) before `cli`/`app` typecheck or build. That's
why `npm run typecheck` builds core+observation first, then typechecks the rest.

Per-package work:

```sh
npm test -w @code-journal/core          # one workspace's tests
npm run build -w @code-journal/core     # rebuild one package's dist
npm run build:binaries -w @code-journal/tui   # release binaries for cj
```

Most packages test with `node --import tsx --test 'test/*.test.ts'`. To run a
single test file directly:

```sh
node --import tsx --test packages/core/test/<file>.test.ts
```

`server/` and `cli/` build with `tsup` first; `server`'s test script compiles to
`test-dist/` before running `node --test`, so run it via `npm test -w
@code-journal/server` rather than invoking `node --test` by hand.

After changing anything in `packages/cli` that the plugin ships, run `npm run
sync-plugin-bin` (or `npm run build`) to regenerate `claude-plugin/bin/`.

## Conventions

Match the surrounding code's style. The TUI is Node + Ink + React; the server
and app are Web-standard (`Request`/`Response`) Node.

## Agent skills

### Issue tracker

Issues and PRDs live on GitHub (`pandazki/code-journal`), driven via the `gh`
CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — the five canonical roles map 1:1 to label strings. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created
lazily; proceed silently if absent). See `docs/agents/domain.md`.
