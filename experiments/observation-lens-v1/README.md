# Observation Lens v1 — Comparison Experiment

> Single-pass experiment validating the 协作观测框架 (Phase 1) against real
> coding-agent transcripts. Three projects × two lenses, subagent-isolated.

## Hypotheses under test

Drawn from the framework document `协作观测框架.html` (Revised 2026-05-15).
Each is verified or noted as structurally unverifiable from a single
snapshot in the final `report.md`.

- **H1 · plausible 坍塌**: AI defaults are plausible-but-flat. Lens output
  should be sparse relative to total session volume — most turns produce no
  gradient signal at all.
- **H2 · 镜子 vs 判官**: lens output stays at observation level, citing
  source, not synthesising identity. Failure mode: drift to "user is X-type".
- **H3 · 分析单位是协作,不是用户**: same user, different projects → distinct
  distributions on both lenses. Empirically verifiable from cross-project
  numbers.
- **H4 · 负空间事件需要 source-anchored 双门**: AI suggestion specific +
  subsequent work along a different axis. Strict scan should reject "AI
  suggested something / user changed topic" without the second leg.
- **H5 · anchored deferral 四姿态**: at AI salience events (direct ask /
  ≥2 named options / explicit uncertainty), user stance falls into
  engaged / deferred / overrode / ignored. Anchor-density itself is a
  feature of the agent's question style, not the user.
- **H6 · empty-state 不能静默**: when nothing is found, the lens must say
  so explicitly, naming what was looked at. "Saw nothing" ≠ "blank".
- **H7 · 两 lens 互不替代**: same transcript through two lenses produces
  different but complementary slices, not redundant ones.

## Design

- **Scope**: 3 projects × 1 session each (goldilocks zone: 500-2000 lines).
  Phase 1 ledger in framework used 4 variants × 3 sessions × 2 projects; we
  hold lens fixed, vary project.
- **Isolation**: each `(session, lens)` pair → one subagent invocation with
  scoped context only. No subagent sees more than one digest or knows about
  other projects. Information leakage protection at the context level, not
  policy level.
- **Anonymisation**: per-project audits and the final report use `Project A
  / B / C`. Real project mapping lives in `PROJECT-MAPPING.md` (gitignored).
- **Pre-processing**: raw `.jsonl` transcripts → markdown digest preserving
  conversational structure but truncating long tool payloads. Reduces token
  cost, surfaces what the lens needs (turn-by-turn dynamics).

## Layout

```
experiments/observation-lens-v1/
├── README.md            this file
├── lenses/              prompt specs for the two lenses (committed)
├── schema/              event schema (committed)
├── scripts/             digest + dispatch + compose scripts (committed)
├── digests/             generated transcript digests (gitignored)
├── events/              subagent JSON outputs (gitignored)
├── audits/              one δ' markdown per project (committed, anonymised)
└── report.md            cross-experiment comparison report (committed)
```

## Trigger this experiment is the answer to

> "什么是 MVP 完成?" → I (Demo-grade): one-shot CLI proof that the lens
> design produces usable, source-anchored events from real transcripts, and
> that two lenses on the same data give complementary not redundant signal.
> Not a daemon, not scheduling — just enough to falsify or confirm the
> hypothesis before investing in infrastructure.
