---
name: work-report
description: Generate a daily code-journal report for today (default) or a specified date. Spawns daily-report-drafter to draft and save the markdown; submission is the host application's call.
allowed-tools: Bash
argument-hint: "[--date YYYY-MM-DD] [--language CODE]"
---

You are handling a manual daily-report request. The user invoked `/code-journal:work-report` because they want either a fresh snapshot of "what have I done so far today" or an after-the-fact catchup for a specific past day. Both cases route through the same `daily-report-drafter` subagent — you pick the date, the subagent does the work.

This skill is also the **only** path that produces today's report. The Electron scheduler's catch-up sweep deliberately never drafts today, because today is still in flight; it only catches up past missing days. So if the user wants today's report, they have to ask for it explicitly via this skill.

The only tool you may use is `Bash`, and you should keep yourself to read-only commands plus date computation:

- `"${CLAUDE_PLUGIN_ROOT}/bin/code-journal" --version`, `"${CLAUDE_PLUGIN_ROOT}/bin/code-journal" config get ...` (CLI introspection only — no `write-report`, no `submit`)
- `date` (computing today's UTC date)
- `cat`, `ls` (reading project state for context)
- shell test primitives `test` / `[ ... ]`, `echo`, `true`, `&&`, `||`

The plugin ships its self-contained CLI at `${CLAUDE_PLUGIN_ROOT}/bin/code-journal` (Python stdlib only, no install required). Always invoke it via that quoted path.

Do not invoke `write-report` or `submit` yourself. The subagent owns those calls. Do not edit files under the project's user-home root.

## Step 1 — Verify the project is initialized

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/code-journal" whoami >/dev/null 2>&1 && echo OK || echo MISSING
```

`whoami` resolves the project key (`<userId>/<orgId>/<projectId>`) by reverse-scanning every project's `config.cwds[]`. If this cwd is registered in some project, it prints the key and exits 0. Otherwise it exits non-zero — meaning this directory isn't part of any code-journal project.

If `MISSING`, tell the user:

> This cwd isn't registered with any code-journal project (not found in any `config.cwds[]`). Run `/code-journal:work-log-init` first to bootstrap the project, then come back to `/code-journal:work-report`.

Then stop.

## Step 2 — Determine the target date

Parse the slash-command args:

- If the user passed `--date YYYY-MM-DD`, validate the shape (`grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'` is enough) and use that value verbatim. If the shape is wrong, refuse with a one-liner:

  > `--date` expects an ISO date like `2026-05-07`. Got `<input>` — try again with the correct shape.

- Otherwise (no args, or unrelated args), default to **today in UTC**:

  ```bash
  date -u +%Y-%m-%d
  ```

  UTC is the canonical timezone for `target_date` across this system — entry ids, daily windows, and report filenames are all UTC-keyed. Using local time here would produce a date that doesn't line up with what `${CLAUDE_PLUGIN_ROOT}/bin/code-journal query --window today` returns.

Confirm the choice in one short sentence to the user before delegating, e.g. "Drafting today's report for `2026-05-07`." or "Drafting catchup for `2026-05-04`." This is just a courtesy — don't gate the delegation on a y/n; the user already asked for the report by invoking the skill.

## Step 2.5 — Optional `--language CODE` override

The drafter's default behavior is to read `report.language` from the project's `config.json` (under `~/.code-journal/<userId>/<orgId>/projects/<projectId>/config.json` — resolve the key via `code-journal whoami`) and write the whole report body in that language (frontmatter stays ASCII). If the user passed `--language CODE` to this slash command, that's a one-shot override of the project default for this single run.

Acceptable forms: any short string the drafter can interpret as a target language — BCP-47 codes like `zh-CN`, `ja`, `en`, or natural-language names like `Chinese`, `Japanese`. Don't normalize on this side; pass the user's value through verbatim and let the drafter resolve it. If `--language` is absent, do not invent one — the drafter will fall back to project config.

## Step 3 — Delegate to `daily-report-drafter`

Hand off to the subagent. Use natural-language delegation:

> Use the `daily-report-drafter` subagent to draft the daily code-journal report. Inputs: `cwd=<absolute project root>`, `target_date=<YYYY-MM-DD chosen in step 2>`. Follow its standard procedure — index-only fetch, short-circuit if zero entries, draft the markdown, save via `${CLAUDE_PLUGIN_ROOT}/bin/code-journal write-report`. Submission is the host application's call; the drafter stops at the saved markdown.

If `--language CODE` was given in step 2.5, append a sentence to the delegation prompt:

> Use `language=<code>` for this run; that overrides the project's `report.language` value.

If `--language` was *not* given, say nothing about language — the drafter knows to consult config.json on its own.

Pass the project root as an absolute path. Do not pre-compute the report content or pre-call any CLI commands the subagent is supposed to make — the subagent's procedure is the source of truth for what gets queried, drafted, and saved.

Note: this skill is the **only** path that may draft today's report. The scheduler's catch-up sweep never passes today to the subagent — it only catches up past dates. So if `target_date` from step 2 equals today, that's expected and the subagent will handle it the same way as any other date.

## Step 4 — Report the subagent's outcome

The subagent prints exactly one stdout line at the end: `drafted <target_date>` or `skipped <target_date>`. Surface that line back to the user verbatim, then add one sentence of context:

> `drafted 2026-05-07` — saved to `~/.code-journal/<userId>/<orgId>/projects/<projectId>/reports/2026-05-07-daily.md`. The Electron host (if running) may forward it onward according to its own settings.

> `skipped 2026-05-07` — no canonical-log entries on that day, so no report was drafted. (The drafter only writes when there's actual work to summarize.)

If the subagent surfaces an error instead — CLI not on PATH, project not initialized, `write-report` refused because the file already exists, `submit` failed — pass the error through unchanged. The user needs the real failure mode, not a sanitized retelling.

## Why each guard exists

- **Project-existence check** (step 1): without a project, nothing the drafter does is meaningful; checking up front gives a clearer error and a direct pointer to `/code-journal:work-log-init`.
- **UTC default for today** (step 2): all date-keyed artifacts in this system (entry ids, query windows, report filenames) are UTC. Using local time silently misaligns the slash-command's "today" with the canonical log's "today", which produces the wrong report.
- **Subagent-only writes** (step 3): the drafter encapsulates the empty-window check, the markdown template, the `source_entry_ids` correctness, and the optional `submit` follow-through. Bypassing it would force this skill to reimplement all that logic.
- **Bash-only, read-only whitelist**: this skill is orchestration. Granting it broader access invites accidental scope creep into report editing, which belongs elsewhere.
