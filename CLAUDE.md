# code-journal

Open-source tool to collect AI coding-agent sessions and turn them into work
reports. See `README.md` for the overview.

## Layout

- `packages/core` — session discovery + transcript parsing (shared)
- `packages/cli` — work-log / report CLI, driven by the Claude Code plugin
- `packages/tui` — `cj`, the terminal session collector. Agent-driven setup:
  `packages/tui/AGENT-SETUP.md`
- `claude-plugin/` — the Claude Code plugin (report synthesis)
- `server/` — reference report/browse server

`packages/*` and `server/` are an npm workspace. `claude-plugin/` is not a
package — its CLI bundle is generated into `claude-plugin/bin/` by
`npm run sync-plugin-bin`.

## Build & test

```sh
npm install         # installs workspaces, builds core + cli, syncs the plugin bin
npm run typecheck
npm test
npm run build:binaries -w @code-journal/tui   # release binaries for cj
```

## Conventions

Match the surrounding code's style. The TUI is Node + Ink + React; the server
is Web-standard (`Request`/`Response`) Node.

## Agent skills

### Issue tracker

Issues and PRDs live on GitHub (`pandazki/code-journal`), driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — the five canonical roles map 1:1 to label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
