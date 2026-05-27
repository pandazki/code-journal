# Observation Lens v2 — Phase 2 Experimental Battery

> Seven experiments (E1–E7) executed on the post-v1 grilling recommendation
> list. Validates lens quality, framework hypotheses, and design assumptions
> under structural pressure beyond what Phase 1 could test.

## Layout

```
experiments/observation-lens-v2/
├── README.md                          this file
├── report.md                          English Phase 2 report (committed)
├── report-bilingual.md                中英双语 Phase 2 report (committed)
├── scripts/
│   └── digest-codex.mjs               codex JSONL → digest (for E4)
├── e1/                                Lens variance characterization
│   └── runs/  ← gitignored             5 sonnet + 1 opus + 1 haiku scans
├── e2/                                Empty-state stress test
│   ├── digests/  ← gitignored
│   └── events/   ← gitignored
├── e3/                                Measurement utility review (analysis only)
├── e4/                                Cross-agent test (codex vs claude-code)
│   ├── digests/  ← gitignored
│   └── events/   ← gitignored
├── e5/                                Fate update proxy
│   ├── digests/  ← gitignored
│   └── events/   ← gitignored
├── e6/                                Second-order predictability proxy
│   ├── digests/  ← gitignored
│   └── events/   ← gitignored
└── e7/                                Third-party reader reconstruction proxy
    └── reconstruction.md  ← gitignored
```

## Hypotheses tested

The experiments grew out of the post-v1 grilling conversation. Each
targets a specific gap in v1's evidence:

- **E1** — How noisy is lens output run-to-run?
- **E2** — Does the lens honour empty-state on truly empty sessions? (H6)
- **E3** — Do all 5 v2 measurements earn their space, or is one noise?
- **E4** — Does the lens generalise to non-Claude-Code transcripts? (H3 cross-agent)
- **E5** — Does fate-tracking surface naturally across multiple episodes? (§ 8)
- **E6** — Is there any structure in anchor positions that future § 9 prediction could exploit?
- **E7** — Can a non-participant reconstruct a session from the audit alone? (§ 14.1 mitigation #1)

## Subagent isolation discipline

All scans dispatched isolated subagents (general-purpose, `sonnet`
default — `opus` and `haiku` only in E1 for cross-model comparison). Each
subagent was given **only** its lens spec, the event schema, and one
digest path. No subagent saw another digest, another lens, this
conversation, or the framework document directly.

22 total subagent invocations across E1-E7; all outputs valid JSON after
the JSON-escape rule baked into lens specs in the v1 wrap-up.

## Anonymisation / leakage prevention

- Real project / session content lives in `digests/` and `events/` —
  **gitignored**.
- Committed artifacts (this README, `report.md`, `report-bilingual.md`,
  `scripts/digest-codex.mjs`) contain no verbatim user / AI dialogue.
- Project codes used in the reports (B, B-codex, A early-1 etc.) map
  to real names only in the gitignored `experiments/observation-lens-v1/PROJECT-MAPPING.md`.
