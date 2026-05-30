# MVP-II Operations · setup, cron, daily ops

> ⚠️ **Superseded / historical.** Operational notes here predate the v0.2.0
> release (e.g. "two lenses"). For current usage see
> [`docs/observation-lens.md`](../observation-lens.md) /
> [中文](../observation-lens.zh.md).

Companion to `docs/plans/mvp-ii.md`. This file is the **runbook**: how
to install MVP-II locally, schedule the cron, and read the audits it
produces. Read this when you've just built `packages/observation` and
want to start using it on your own sessions.

## 1 · Build

```sh
npm install                                         # picks up packages/observation
npm run build -w @code-journal/observation          # compile types + lens runner
npm run build -w @code-journal/cli                  # compile CLI bundle
```

Once built, `node packages/cli/dist/index.js --help` lists the new
observation subcommands at the bottom.

## 2 · First run (no cron — manual)

```sh
# Inventory what code-journal sees on disk; no scans yet
node packages/cli/dist/index.js status

# Discover new sessions and run both lenses on each. With no --project
# this hits every active project in ~/.claude/projects + ~/.codex/sessions.
# Be aware: a first scan over ~50 sessions × 2 lenses ≈ 100 subagent
# calls. Use --project to scope down for the first time.
node packages/cli/dist/index.js sync --project code-journal --verbose

# Once a project's new-events count crosses its threshold (default 10),
# sync auto-composes. To compose explicitly without waiting for the gate:
node packages/cli/dist/index.js compose --project code-journal --dry-run
node packages/cli/dist/index.js compose --project code-journal

# Inspect the produced audit
ls ~/.code-journal/observations/<pid>/episodes/
```

## 3 · Cron setup

MVP-II runs as a one-shot CLI under OS-level cron. No daemon, no
background process.

### macOS / Linux (crontab)

```sh
# Edit your crontab
crontab -e

# Add a line that runs sync every 4 hours, logging to a file you can
# tail when something looks off:
0 */4 * * * cd /Users/pandazki/Codes/code-journal && /opt/homebrew/bin/node packages/cli/dist/index.js sync >> ~/.code-journal/observations/sync.log 2>&1
```

Adjust paths to your Node binary (`which node`) and your repo location.
`code-journal sync` is idempotent — re-running a few times within the
same interval just discovers no new sessions and exits cleanly.

### macOS / launchd (alternative)

If you prefer launchd-managed jobs (survives login cycles cleanly):

```sh
cat > ~/Library/LaunchAgents/com.pandazki.code-journal-sync.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pandazki.code-journal-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/pandazki/Codes/code-journal/packages/cli/dist/index.js</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key><integer>14400</integer>
  <key>StandardOutPath</key><string>/Users/pandazki/.code-journal/observations/sync.log</string>
  <key>StandardErrorPath</key><string>/Users/pandazki/.code-journal/observations/sync.err</string>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.pandazki.code-journal-sync.plist
```

## 4 · Daily reading

Once cron has been running a week or so:

```sh
# What's accumulated?
node packages/cli/dist/index.js status

# Read the most recent audit for a project
ls -t ~/.code-journal/observations/<pid>/episodes/*.md | head -1 | xargs -I{} bat {}
# or open in your favourite markdown viewer / Obsidian / VSCode
```

## 5 · Per-project tuning

Edit `~/.code-journal/observations/<pid>/state.json` directly to:

- Lower `config.compose_threshold` (default 10) if you want more frequent
  episodes for a particular project
- Raise it if a project produces too many small audits
- Change `config.model` between `sonnet` (default) and `opus`. **Never
  set `haiku`** — it's banned at runtime (Phase 2 E1: ~50% recall)
- Pin a different `config.lens_versions.<lens>` if you want to keep an
  old lens version on this project after a global bump

Changes take effect on the next sync.

## 6 · Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `claude -p failed: ENOENT` | `claude` CLI not on PATH | install Claude Code CLI or set PATH in your cron environment |
| `claude -p failed: timeout` | Lens scan hung (rare; large digest) | manually re-run `sync --project <X>`; failed sessions will retry next sync |
| `JSON parse failed twice` | LLM emitted non-strict JSON twice in a row | check the lens spec's JSON-escape rule is intact; failed session stays unscanned (no error-state in MVP-II; will retry next sync) |
| `compose: no events in signal store` | No lens output yet | run `sync` first |
| `compose: audit contains forbidden phrase` | Lens output drifted toward identity claim | inspect the offending event in `signals/<lens>.jsonl`; usually means a payload sneaked in a forbidden phrase. Fix the lens prompt or manually edit the event payload, then re-compose |
| Auto-compose never triggers | New events below threshold | check `status` for "need N more"; lower `compose_threshold` or run `compose` manually |

## 7 · What MVP-II does not do (yet)

Per `docs/plans/mvp-ii.md` § 1.2:

- **No cross-machine sync.** State + signals live in `~/.code-journal/` per
  machine. You can manually sync this directory between machines (e.g.,
  via a dotfiles repo with appropriate `.gitignore`) but it's not
  built-in.
- **No auto fate-update detection.** When Episode N covers different work
  than Episode N-1, the fate section says "(none surfaced ...)". Manual
  fate annotation is MVP-III.
- **No web GUI.** Audits are markdown files. Read them in any viewer.
- **No `code-journal cron install`.** The existing tui's pattern is for
  the journal-direction; MVP-II uses raw cron / launchd as above.
  Subsumed integration is on the MVP-III table.

## 8 · Disabling MVP-II

```sh
# Stop the cron
crontab -e   # remove the sync line
# or
launchctl unload ~/Library/LaunchAgents/com.pandazki.code-journal-sync.plist

# Optionally wipe state (signals + episodes preserved are ok to keep!
# Only state.json controls future scans)
rm -rf ~/.code-journal/observations/

# Reinstalling later: just re-add the cron entry. sync will rediscover
# everything from scratch and rebuild signal store from raw transcripts.
```
