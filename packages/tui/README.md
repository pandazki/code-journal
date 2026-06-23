# @code-journal/tui

> ⚠️ **Deprecated — superseded by the web GUI (`npm start` → `packages/app`).**
> A journal needs real visuals (timelines, heatmaps) a terminal can't do well,
> so `cj` is no longer the way in. It still builds and runs for existing users
> who rely on its S3 backup path, but it is **not under active development** and
> won't gain new features. Its session-discovery and transcript-parsing logic
> already lives in `packages/core`; new work goes there and in `packages/app`.

`cj` — an Ink terminal app that discovers, browses, and uploads raw
coding-agent sessions. One persistent board: a projects panel, a session
master-detail panel, a transcript viewer with subagent navigation, and an
activity log. Setup (projects, S3 target, schedule) runs as a first-launch
wizard.

> **Setting it up with an AI agent?** [`AGENT-SETUP.md`](./AGENT-SETUP.md) is a
> complete, deterministic procedure an agent (e.g. Claude Code) can follow to
> build, configure, and schedule `cj` for a user — no interactive UI needed.

## Develop

```sh
npm run dev   -w @code-journal/tui     # launch the TUI (needs a TTY)
npm run check -w @code-journal/tui     # render one frame, exit 0 (smoke test)
npm run typecheck -w @code-journal/tui
```

## Release binaries

Cross-platform binaries are compiled with `bun build --compile` (Bun is a
build-time tool only; the dev/test runtime is Node):

```sh
npm run build:binaries -w @code-journal/tui            # all targets
npm run build:binaries -w @code-journal/tui linux-x64  # one target
```

Targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Output lands
in `packages/tui/dist/cj-<target>` — the binary answers to both `cj` and
`code-journal`.
