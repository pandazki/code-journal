# Observation Lens — Quickstart

> Zero config. If you already use a coding agent (Claude Code / Codex / Cowork),
> everything you need is already on your disk. Three commands and a web page.
>
> 中文版:[`observation-lens-quickstart.zh.md`](observation-lens-quickstart.zh.md) ·
> Full guide: [`observation-lens.md`](observation-lens.md)

## What you get

A look back at **where *you* set the direction** in your AI coding sessions —
the moments you steered the work, declined what the agent proposed, or brought up
a new concern. Not a productivity score. A mirror: every line points back to the
actual words in your transcript.

## Before you start

You need the `claude` CLI on your PATH — the lens uses your own agent to read your
sessions, so there's **no API key, no account, no upload**. Your transcripts never
leave your machine.

## 1 · Scan

```sh
code-journal sync
```

Finds your recent coding sessions, reads each through the lenses, records what it
finds. A first run over a lot of history can take a few minutes (it runs your
agent once per session). To try one project first:

```sh
code-journal sync --project myproject --limit 5 --verbose
```

Quiet sessions produce **nothing** — that's correct, not a bug. The lens never
invents events.

## 2 · Compose

`sync` writes an audit automatically once a project has enough new events. To
force one now:

```sh
code-journal compose --project myproject
```

## 3 · Read it — the web console

```sh
code-journal            # opens the journal in your browser
```

Click **Observation →** in the top corner (or go straight to
[localhost:4319/observe](http://localhost:4319/observe)).

- The **ledger** lists your projects, densest first. Pick one.
- Each **episode** shows a stance band (how often you injected direction vs. just
  approved), a strip of *where* in the session direction landed, and the events
  themselves — each with verbatim quotes, expandable for source and reasoning.

The terminal can't show this much at once; the console is built for it.

## Check status anytime

```sh
code-journal status
```

Per project: events found, episodes composed, when it last ran.

## That's it

No setup, no config file. Run `sync` now and then (or on a schedule), open the
console when you want to look back. For what each lens means and the honest
limits, see the [full guide](observation-lens.md).
