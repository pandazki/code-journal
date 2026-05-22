# @code-journal/server

A small reference server that receives **daily reports** and **uploaded
sessions** and serves a browse UI — a faithful, line-numbered transcript
viewer with subagent navigation.

It's a reference implementation: the `cj` TUI can upload sessions to any
S3-compatible bucket instead, and you can adapt this server (or its storage
layer) to your own backend.

Zero npm runtime dependencies — Node builtins (`node:http`, `node:fs`, …) and
the Web globals Node ships (`Request`, `Response`, `URL`, `fetch`) only. The
server listens on loopback and is unauthenticated; put it behind your own
gateway if you expose it.

## Run

```sh
npm install            # from the repo root — installs the workspace
npm run build -w @code-journal/server
PORT=8787 CJ_SERVER_DATA_DIR=/path/to/data npm run start -w @code-journal/server
# → code-journal server listening on http://127.0.0.1:8787
```

Or run from source with a TS runner: `npx tsx server/src/cli.ts`.
Env: `PORT` (default 8787), `CJ_SERVER_DATA_DIR` (where artifacts are stored).

## Storage layout (under the data dir)

```
sessions/<project_id>/<session_id>.jsonl        raw session transcript
sessions/<project_id>/<session_id>.meta.json    { agent, cwd, received_ts, size_bytes }
sessions/<project_id>/<session_id>/<rel_path>   session sidecar files (subagents/, tool-results/)
worklog/<project_id>/<entry_id>.md              raw work-log entry (frontmatter + body)
worklog/<project_id>/<entry_id>.meta.json       { received_ts, size_bytes }
reports/<project_id>/<date_range>/<user>.md     rendered daily reports
```

Re-POSTing the same id overwrites — that's the dedup. `project_id` matches
`[A-Za-z0-9_-]+`; `session_id` / `entry_id` match `[A-Za-z0-9._:-]+` (no `/`,
no `..`). Bad ids → `400` before any disk write.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/api/reports` | store a rendered daily report |
| `POST` | `/api/projects/:id/sessions/:sessionId?agent=&cwd=` | store a raw session transcript |
| `GET` | `/api/projects/:id/sessions[/:sessionId]` | list sessions / fetch one |
| `POST/GET` | `/api/projects/:id/sessions/:sessionId/files[?path=]` | store / list / fetch session sidecar files |
| `POST/GET` | `/api/projects/:id/worklog[/:entryId]` | store / list / fetch raw work-log entries |
| `GET` | `/api/projects[/:id]` | project list / detail (with `session_count`, `worklog_count`) |
| `GET` | `/api/health` | readiness probe |

All browse endpoints carry permissive CORS headers.

## Browse UI

`public/` is a dependency-free SPA: project → sessions / work-log lists →
detail views. Sessions render in a structured, line-numbered transcript viewer
(no parsing or pretty-printing — exactly what was stored), with a session's
subagent transcripts listed and openable inline.

## API

```ts
import { start } from '@code-journal/server';

const { server, port, url } = await start({
  port: 8787,            // omit / 0 → ephemeral port
  dataDir: '/path/to/data',
  publicDir: '/path/to/server/public',
  getUsername: () => 'local',   // stamped on stored reports; read per request
});
```

## Tests

`npm run test -w @code-journal/server` — `node:test` coverage of the report,
session, sidecar, and work-log endpoints (`server/test/*.test.ts`).
