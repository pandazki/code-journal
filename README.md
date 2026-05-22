# code-journal

**Collect your AI coding-agent sessions and turn them into work reports.**

Your coding agents — Claude Code, Codex, Claude Cowork — leave a detailed
transcript of every session on disk. code-journal discovers those transcripts,
backs them up to S3-compatible storage on a schedule, and (via a Claude Code
plugin) distills them into work-log entries and daily reports.

## What's in here

| Path | What it is |
|------|------------|
| `packages/tui` | **`cj`** — a terminal board to discover, browse, and upload coding-agent sessions |
| `packages/core` | session discovery + transcript parsing, shared by the rest |
| `packages/cli` | the work-log / report CLI that the Claude Code plugin drives |
| `claude-plugin/` | Claude Code plugin — drafts work-log entries and daily reports |
| `server/` | reference server — receives reports and uploaded sessions, serves a browse UI |

## Quick start — the `cj` session collector

`cj` discovers every coding-agent session for your projects, lets you browse the
transcripts, and uploads them — incrementally — to an S3-compatible bucket,
manually or on a cron schedule.

### Build

Requires Node ≥ 20.18. Release binaries are cross-compiled with
[Bun](https://bun.sh) (a build-time tool only — the app runs on Node).

```sh
npm install
# target: darwin-arm64 · darwin-x64 · linux-x64 · linux-arm64
npm run build:binaries -w @code-journal/tui darwin-arm64
```

The binary lands at `packages/tui/dist/cj-<target>`. Put it on your `PATH` —
it answers to **both** `cj` and `code-journal`, interchangeably:

```sh
ln -sf "$PWD/packages/tui/dist/cj-darwin-arm64" /usr/local/bin/cj
ln -sf "$PWD/packages/tui/dist/cj-darwin-arm64" /usr/local/bin/code-journal
```

### Run

```sh
cj                  # launch the board — first run walks you through setup
cj sync             # headless incremental upload — the cron target
cj cron install     # schedule the upload (default: every 4 hours)
cj --help
```

First launch runs a short, resumable wizard: pick projects → configure the
S3 target → schedule uploads. After that `cj` opens straight to the board.

### Let an AI agent set it up

[`packages/tui/AGENT-SETUP.md`](packages/tui/AGENT-SETUP.md) is a deterministic
procedure an AI agent (e.g. Claude Code) can follow to build, configure, and
schedule `cj` for you, end to end — no interactive UI needed.

## The Claude Code plugin

`claude-plugin/` is a [Claude Code](https://claude.com/claude-code) plugin that
turns raw sessions into **work-log entries** and **daily reports**, with skills
for capturing work and drafting reports on demand.

```sh
claude --plugin-dir /path/to/code-journal/claude-plugin
```

## The reference server

`server/` receives uploaded reports and sessions and serves a browse UI — a
faithful, line-numbered transcript viewer with subagent navigation. It's a
reference implementation; point `cj` at any S3-compatible bucket instead, or
adapt the server to your own backend.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run dev -w @code-journal/tui    # run cj from source (needs a TTY)
```

## License

MIT — see [LICENSE](LICENSE).
