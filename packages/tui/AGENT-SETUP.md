# cj — agent-driven setup guide

**Audience: an AI coding agent (e.g. Claude Code).** A user has asked you to set
up `cj` — the code-journal session manager — for them. This document is the
complete, deterministic procedure. Follow it end to end. You do **not** need the
interactive TUI for any of this; you write the config files and run CLI
commands directly.

`cj` discovers raw coding-agent session transcripts (Claude Code, Codex, Cowork)
on this machine and uploads them, incrementally, to an S3-compatible bucket.
"Full configuration" means: a built `cj` binary on `PATH`, a config file
describing the projects to track and the S3 target, a credentials file, and a
cron job that runs the upload on a schedule.

The whole flow is five steps. Do them in order. If a step's prerequisite is
missing, resolve it before continuing.

---

## Step 1 — Build the `cj` binary

Run from the repository root (the directory containing `packages/tui/`).

1. Ensure the toolchain:
   - Node ≥ 20.18 — `node --version`.
   - Bun (build-time only) — `bun --version`. If missing:
     `curl -fsSL https://bun.sh/install | bash` (then re-source the shell, or
     use `~/.bun/bin/bun`).

2. Install dependencies and build:
   ```sh
   npm install
   npm run build -w @code-journal/core
   ```

3. Compile the binary for **this** machine's platform. Pick the target from
   `uname -sm`:
   | `uname -sm`      | target         |
   |------------------|----------------|
   | `Darwin arm64`   | `darwin-arm64` |
   | `Darwin x86_64`  | `darwin-x64`   |
   | `Linux x86_64`   | `linux-x64`    |
   | `Linux aarch64`  | `linux-arm64`  |
   ```sh
   npm run build:binaries -w @code-journal/tui <target>
   ```
   The binary lands at `packages/tui/dist/cj-<target>`.

4. Install it on `PATH` as `cj` — symlink so future rebuilds propagate:
   ```sh
   ln -sf "$(pwd)/packages/tui/dist/cj-<target>" <a-dir-on-PATH>/cj
   ```
   Use a directory already on the user's `PATH` and writable by them
   (`/opt/homebrew/bin` on macOS w/ Homebrew, or `~/.local/bin`). Verify:
   `cj --version`.

---

## Step 2 — Gather the configuration from the user

Ask the user for these. Do not invent values.

**S3-compatible target** (AWS S3, Cloudflare R2, MinIO, Backblaze B2, …):

| field | notes |
|---|---|
| endpoint | The account/service endpoint **origin only** — scheme + host, **no bucket in the path**. e.g. `https://<acct>.r2.cloudflarestorage.com`. (`cj` strips a stray path defensively, but ask for the clean form.) |
| region | `us-east-1` is a safe default; R2 ignores it. |
| bucket | the bucket name |
| prefix | optional key prefix inside the bucket; `""` if none |
| forcePathStyle | `true` for R2 / MinIO / most non-AWS stores; `true` is a safe default |
| accessKeyId | the access key |
| secretAccessKey | the secret |

**Projects** — which directories' sessions to track. A *project* is a named
group of one or more absolute cwd paths. Ask the user which repositories they
want backed up; take the absolute repo root for each. `cj` auto-expands a repo's
git worktrees, so one entry per repo root is enough. To suggest candidates you
may inspect `~/.claude/projects/` (each subdirectory name is an encoded cwd) or
`~/.codex/sessions/`, but confirm the final list with the user.

---

## Step 3 — Write the config files

Two files under `~/.code-journal/tui/` (create the directory). Write them
directly — do not run the TUI wizard.

### `~/.code-journal/tui/config.json`  (mode 0644)

```json
{
  "version": 1,
  "projects": [
    { "id": "my-app", "name": "My App", "cwds": ["/Users/me/code/my-app"] },
    { "id": "server", "name": "Server", "cwds": ["/Users/me/code/server"] }
  ],
  "s3": {
    "endpoint": "https://ACCOUNT.r2.cloudflarestorage.com",
    "region": "us-east-1",
    "bucket": "coding-agent-sessions",
    "prefix": "",
    "forcePathStyle": true
  },
  "wizardStep": "done"
}
```

- `projects[].id` — slug, must match `^[A-Za-z0-9][A-Za-z0-9_-]*$`, unique.
- `projects[].cwds` — absolute paths.
- **`wizardStep: "done"`** — required. It tells `cj` the setup is complete so it
  boots straight to the board instead of re-running the first-run wizard.

### `~/.code-journal/tui/credentials.json`  (mode 0600)

```json
{ "accessKeyId": "AKIA...", "secretAccessKey": "..." }
```

Set the file mode to `0600` after writing (`chmod 600`). Never put the secret in
`config.json`.

`~/.code-journal/tui/uploads.json` is created and maintained by `cj` itself — do
not write it.

---

## Step 4 — Verify

Run a real incremental upload — it both verifies S3 connectivity and performs
the first backup:

```sh
cj sync
```

Expected: `sync: N uploaded, 0 failed, M up-to-date`, exit code 0. On failure it
prints the error per session and exits 1. Common causes:

- **`NoSuchBucket` / 404** — the `endpoint` wrongly includes the bucket name in
  its path, or the `bucket` is wrong. The endpoint must be origin-only.
- **403 / signature errors** — wrong `accessKeyId` / `secretAccessKey`, or the
  key lacks write permission (R2 tokens need *Object Read & Write*).
- **`S3 is not configured`** — `config.json` has no `s3`, or `credentials.json`
  is missing/unreadable.

Fix the config files and re-run `cj sync` until it succeeds.

---

## Step 5 — Install the scheduled upload (cron)

Install a system cron job that runs `cj sync` on a schedule. Default: every 4
hours.

**Prerequisite — a working cron.** A normal desktop/server already has it. A
minimal Linux (e.g. a container) often does not: if `cj cron install` fails
with `Executable not found in $PATH: "crontab"`, install it and start the
daemon — the job only fires while the daemon runs.
- Debian / Ubuntu: `apt-get update && apt-get install -y cron && service cron start`
- Make sure the daemon also starts on boot (`systemctl enable cron`, or your
  init system's equivalent).

```sh
cj cron install "0 */4 * * *"
cj cron status
```

`cj cron install` writes a marked block to the user's crontab calling
`cj sync` (it uses the running binary's own path, so install it via the
`cj` you put on `PATH` in Step 1). `cj cron status` confirms it. To change the
cadence, run `install` again with a different 5-field cron expression; to remove
it, `cj cron remove`.

Setup is now complete. The user can run `cj` any time to open the board and
browse / manage sessions.

---

## Reference

### File locations

```
~/.code-journal/tui/config.json       projects + S3 settings        (0644, you write)
~/.code-journal/tui/credentials.json  S3 access key + secret        (0600, you write)
~/.code-journal/tui/uploads.json      upload manifest               (cj-managed)
~/.code-journal/tui/cj.log            activity log                  (cj-managed)
```

### CLI

```
cj                      launch the TUI board
cj sync [project-id]    incremental upload — all projects, or one
cj cron install [expr]  install the scheduled-upload job (default "0 */4 * * *")
cj cron status          show the scheduled-upload job
cj cron remove          remove it
cj --version | --help
```

### What an upload produces (per session, in the bucket)

```
<prefix>/sessions/<project-id>/<session-id>/transcript.jsonl
<prefix>/sessions/<project-id>/<session-id>/meta.json     project info + extracted metadata
<prefix>/sessions/<project-id>/<session-id>/subagents/…     subagent transcripts (if any)
<prefix>/sessions/<project-id>/<session-id>/tool-results/…  spilled tool outputs (if any)
```

Re-uploads are incremental: `cj` records each transcript's mtime+size and only
re-uploads a session that is new or has changed.

### Resetting

To wipe all `cj` state and start over: `rm -rf ~/.code-journal/tui` and
`cj cron remove`.
