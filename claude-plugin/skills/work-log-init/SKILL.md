---
name: work-log-init
description: Bootstrap a code-journal project at the cwd. Interactive Q&A then provisions the project's user-home root at ~/.code-journal/<userId>/<orgId>/projects/<projectId>/ and registers the cwd in that project's `config.cwds[]`. No pointer file is written into the cwd itself. Refuses to overwrite an existing project's config without explicit consent.
allowed-tools: Bash Read
disable-model-invocation: true
---

You are setting up a new `code-journal` project at the user's current working directory. Be conversational, run one shell command at a time, and confirm each suggestion before writing files. The user is the source of truth — your job is to gather a few values and let the CLI do the actual write.

The only tools you may use are `Bash` and `Read`. Inside `Bash`, restrict yourself to read-only commands:

- `"${CLAUDE_PLUGIN_ROOT}/bin/code-journal" ...` (the CLI you're configuring; this is the only command that writes anything)
- `git rev-parse ...` (cwd / repo detection)
- `cat`, `head`, `ls` (reading project files for context — README, package.json, existing config.json)
- shell test primitives `test` / `[ ... ]`, `echo`, `true`, `&&`, `||` (for the conditional file-existence checks shown below)

Do not run any other commands; in particular, do not edit, write, or remove files directly — the CLI's `init` subcommand owns the write. (`init` writes only under `~/.code-journal/<userId>/<orgId>/projects/<projectId>/`; it does NOT touch the cwd. The cwd is registered in that project's `config.cwds[]`, and `code-journal whoami` resolves cwd → project via that registry.)

The plugin ships its own self-contained CLI at `${CLAUDE_PLUGIN_ROOT}/bin/code-journal` (Node single-file bundle, no install required). Always invoke it via that quoted path so the script handles spaces in the plugin root.

## Step 1 — Verify the CLI is reachable

Run:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/code-journal" --version
```

If this fails ("command not found" or non-zero exit), tell the user:

> The plugin's `code-journal` CLI didn't run. Check that `${CLAUDE_PLUGIN_ROOT}/bin/code-journal.js` exists (re-run `npm install` from the workspace root if not), that `node` resolves on your PATH, and that the wrapper at `${CLAUDE_PLUGIN_ROOT}/bin/code-journal` is executable. Once it's runnable, re-run `/code-journal:work-log-init`.

Then stop. Do not proceed to step 2.

## Step 2 — Refuse to overwrite without consent

Check whether this cwd already belongs to a code-journal project:

```bash
KEY=$("${CLAUDE_PLUGIN_ROOT}/bin/code-journal" whoami 2>/dev/null) && echo "EXISTS:$KEY" || echo "MISSING"
```

If the output is `EXISTS:<userId>/<orgId>/<projectId>`, the cwd already belongs to a project. Load its config from the user-home root:

```bash
cat "$HOME/.code-journal/$KEY/config.json" 2>/dev/null
```

Then:

1. Summarize the key settings in plain prose: project ID, display name, daily-reports enablement, language.
2. Ask: "This cwd already belongs to project `<KEY>`. Do you want to amend its config (this will overwrite settings)? \[y/N]"
3. If the user does not give an unambiguous yes, stop with a brief message like "OK, leaving the existing config as-is." Never re-run `${CLAUDE_PLUGIN_ROOT}/bin/code-journal init` without explicit consent — this is non-negotiable.

If the user says yes, proceed to step 3.

If `MISSING`, proceed to step 3 directly.

## Step 3 — Suggest a `display_name`

Gather signals (each command is independent; if one fails, just skip it):

```bash
git rev-parse --show-toplevel
```

```bash
[ -f README.md ] && head -n 20 README.md || true
```

```bash
[ -f package.json ] && cat package.json || true
```

Pick the strongest signal:

- `package.json` `.name` field if it's set and looks human-readable.
- The first `# Heading` line in `README.md`.
- The basename of the git repo root (from `git rev-parse --show-toplevel`).
- Otherwise, the basename of the cwd.

Propose it: "I'd use **`<suggested name>`** as the display name — does that work, or want to override?" Accept whatever the user says; don't argue.

## Step 4 — Suggest a `project_id` slug

Slug rule: take the cwd basename (or the chosen display name as a fallback), lowercase it, and convert any non-alphanumeric runs to single hyphens. Show the user the suggestion: "Project ID will be **`<slug>`** — keep it, or override?"

The project ID is what shows up in report frontmatter and downstream upload payloads, so the user may legitimately want something shorter or different from the slug.

**Multi-cwd same project_id is supported and joins transparently.** If the user explicitly says they want this cwd to be part of an existing project (e.g. they just initialized code-journal in a sibling code repo and now want the docs repo to belong to the same logical project), use that exact `project_id` — don't slugify a fresh one. Init in a cwd that's already a member of an existing project_id (different cwd, same id) joins it transparently — no error. Both cwds end up sharing one project root under user home, and `query` / daily reports automatically see the union of entries appended from either side. You can confirm the existing IDs with `${CLAUDE_PLUGIN_ROOT}/bin/code-journal list-projects --ids-only` before deciding.

## Step 6 — Daily report language

Every project ships with a daily-reports block in `config.json`; there is no longer an opt-out. The drafter's own "zero-entry day → skip" rule handles "no real work happened today" correctly without needing a project-level toggle. Editing settings later is always possible: tune `~/.code-journal/<userId>/<orgId>/projects/<projectId>/config.json` directly (use `code-journal whoami` to resolve the key), or use the host app's strategy dialog.

Ask:

> Daily reports should be written in what language? \[default: English]

Map common natural-language answers to BCP-47 codes:

- "English" / empty / "en" → no flag (default)
- "Chinese" / "中文" / "简体中文" / "简体" / "zh" / "zh-CN" → `zh-CN`
- "Traditional Chinese" / "繁体" / "繁體" / "zh-TW" → `zh-TW`
- "Japanese" / "日本語" / "ja" → `ja`
- "Korean" / "한국어" / "ko" → `ko`
- "Spanish" / "Español" / "es" → `es`
- "French" / "Français" / "fr" → `fr`
- "German" / "Deutsch" / "de" → `de`

For anything else, accept what the user typed verbatim if it looks like a BCP-47 tag (`xx` or `xx-YY` shape); otherwise ask them to give you the BCP-47 code.

If the answer maps to a non-default language, you'll pass `--report-language <code>` to the `init` invocation in Step 7. If the answer is exactly "English" / empty / "en", omit the flag — that keeps the on-disk json clean (no `language` key at all, drafter writes English by default).

Remember the resolved code; you'll thread it into Step 7.

## Step 7 — Run the `init` command

Confirm the assembled values back to the user one more time:

> About to run: `"${CLAUDE_PLUGIN_ROOT}/bin/code-journal" init --id <project_id> --display-name "<display_name>"` *(append `--report-language <code>` if Step 6 resolved to a non-default language)* — looks good?

On confirmation, execute exactly that command. Quote the display name so spaces survive, and keep the `${CLAUDE_PLUGIN_ROOT}/bin/code-journal` path quoted so plugin roots with spaces work.

If the command reports "already initialized" (it does this when the project's `config.json` already exists at `~/.code-journal/<userId>/<orgId>/projects/<projectId>/config.json` — it will not overwrite), tell the user, show the existing file with `cat "$HOME/.code-journal/$KEY/config.json"` (`$KEY` from `code-journal whoami`), and stop. The CLI's refusal to overwrite is the second line of defense after step 2 — respect it.

## Step 8 — One-line summary

Print one sentence: where the project landed, the project_id, and (if non-default) the daily-report language.

**Tell the user about the file layout** — this is genuinely useful context they should know:

> Nothing is written into this cwd — no pointer file, no `.code-journal` directory, nothing committable. The cwd → project mapping lives in the project's own `config.cwds[]` under `~/.code-journal/<userId>/<orgId>/projects/<projectId>/config.json`, which `code-journal whoami` resolves on demand. All project state — config, log entries, reports — lives under your user home at that path, never in the repo.

Then the confirmation:

> Initialized code-journal project `acme-api` at `~/.code-journal/<userId>/<orgId>/projects/acme-api/` and registered this cwd in its `config.cwds[]`. Edit `~/.code-journal/<userId>/<orgId>/projects/acme-api/config.json` to tune the daily-report block (lookback window, language) or set a schedule.

If a non-default language was chosen in Step 6, append a sentence: "Daily reports will be drafted in `zh-CN`. Run `/code-journal:work-report` to generate one."

Then suggest the natural next step: "Run `/code-journal:work-log` whenever you want to capture an entry — at the end of a meaningful chunk of work, or at the end of the day."

## Why each guard exists

- **Refusing to overwrite** (step 2): the project's `config.json` is the only place project-specific settings live; clobbering it silently could erase the user's schedule, language choice, or schema extensions.
- **Asking before running `init`** (step 7): the CLI is idempotent in the safe direction (won't overwrite) but a user mid-amend might lose track — restating the command makes the diff between "what I asked for" and "what's about to happen" obvious.
- **Tool whitelist**: this skill is meant to be a thin orchestration over the CLI. Granting itself broader tool access invites accidental scope creep into editing repo or user-home files; the CLI is the only thing that should write to either location.
