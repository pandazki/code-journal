# code-journal — Claude Code plugin

A [Claude Code](https://claude.com/claude-code) plugin that turns your coding
sessions into **work-log entries** and **daily reports**, behind 3 skills and
2 subagents. For the project overview see [`../README.md`](../README.md).

The plugin wraps the `code-journal` CLI — a Node 20+ single-file bundle. The
`bin/` directory ships a tiny `code-journal` wrapper (Unix) and
`code-journal.cmd` (Windows) that exec `node` on the bundled `code-journal.js`;
that bundle is generated at install time by the workspace root's postinstall.

## Install

```bash
npm install     # from the repo root — builds packages/cli, syncs bin/code-journal.js
```

Then point Claude Code at this directory:

```bash
claude --plugin-dir /path/to/code-journal/claude-plugin
```

## Slash commands

- `/code-journal:work-log-init` — bootstrap a project. Provisions the project's
  home at `~/.code-journal/<userId>/<orgId>/projects/<projectId>/` and registers
  the cwd in that project's `config.cwds[]`. Nothing is written into the cwd
  itself; the cwd → project mapping is resolved on demand by
  `code-journal whoami`.
- `/code-journal:work-log` — append a work-log entry from the current conversation.
- `/code-journal:work-report` — produce today's (or a given date's) daily report.

## Development

```bash
npm run typecheck   # from the repo root
npm run build       # builds core + cli, syncs bin/code-journal.js
npm run test
```

CLI tests live in `packages/cli/test/`, the core library's in
`packages/core/test/`.
