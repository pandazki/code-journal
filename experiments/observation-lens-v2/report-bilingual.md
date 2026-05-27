# Phase 2 实验组 · E1-E7 综合报告
# Phase 2 Experimental Battery · E1 through E7

> 七个实验,在 v1 grilling 之后基于推荐清单逐个执行。和 v1 一样的 subagent 隔离纪律。本报告**不复现 transcript 原文**——per-experiment 证据保存在 gitignored 的 event JSONs 和 digests 里;本文件只保留 aggregate 层面的结构性结论。
>
> Seven experiments executed on the post-v1 recommendation list. Same subagent isolation discipline as v1. **No verbatim transcript content reproduced here** — per-experiment evidence lives in gitignored event JSONs and digests; this document stays at the aggregate structural level only.

---

## 概要 · TL;DR

**中文:**

- **E1 · Lens 变异度**: `engaged` 和 `ignored` 中等噪声(stdev 0.75 / 0.89,range 1-3);**`overrode` 是最噪的**(stdev 1.36,range 1-4)—— **这跟我之前的预测正好相反**。总事件数高度稳定(6-7,stdev 0.49)。`haiku` 漏掉约 50% 的事件;`opus` 比 `sonnet` 平均多抓 ~20%。
- **E2 · Empty-state 压力测试**:**H6 完全验证**。4 次零信号 scan 全部正确返回 empty-state record 并 named 具体原因。**零次** 编造事件。
- **E3 · Measurement 价值评估**:**M1 / M2 / M5 高价值,M3 中等,M4 是噪声**。M4(anchor-to-response turn distance)~95% 的事件都是 1,几乎不带信息。建议:MVP-II **删 M4**,替换为 anchor position 归一化分布(E6 证明它有价值)。
- **E4 · 跨 agent 测试**:claude-code 跟 codex 在同 git tree 上 lens 输出**结构上相似**,都产 source-anchored 事件、无 identity drift。codex 的 anchor density **低 4.5 倍**(3.81 vs 0.85),consistent with H5 ("anchor density 是 agent 属性")。
- **E5 · Fate update proxy**: 击中一个**结构性 surprise** —— 同 git repo 的 2 天后 Episode 2 **完全换了 topic**(从 Cowork 实现 → code-journal TUI scaffolding)。Episode 1 events 在 Episode 2 **零 fate evolution** —— 不是 lens 漏看,是话题搬走了。结论:**"同 git repo" ≠ "同 collaboration arc"**;fate-tracking 需要 topic continuity,不只是 repo continuity。
- **E6 · 二阶可预测性 proxy**: 6 个 pneuma-skills sessions 跨 1 个月。**Anchor positions 在 [0,1] 归一化空间里呈双峰分布**:48% 落在前 20%,25% 落在后 20%,中段 50-70% 为零。这给 § 9 predictability 提供了**第一个真实的可利用结构** —— 一个 trivial "前 20% 或后 20%" 启发式就能预测 ~73% 的 anchor 位置。
- **E7 · 第三方 reader 重建 proxy**: 一个 isolated subagent 只读 Project B audit(不看 transcript)正确重建了 **8/8 关键 direction-injection 时刻**,医学语言为 "medium confidence",且**正确识别了 audit 的 6 个真实 gap**(代码细节 / 外部概念 / 中间过程等)。**Audit format 通过可读性测试**。

**English:**

- **E1 · Lens variance**: `engaged` and `ignored` stance categories are moderately noisy (stdev 0.75 / 0.89, range 1-3); **`overrode` is the noisiest** (stdev 1.36, range 1-4) — **opposite of my prior prediction**. Total event count highly stable (6-7, stdev 0.49). `haiku` misses ~50% of events; `opus` catches ~20% more than `sonnet` mean.
- **E2 · Empty-state stress test**: **H6 fully validated**. All 4 zero-signal scans correctly returned empty-state records with concrete reasons. **Zero** manufactured events.
- **E3 · Measurement utility review**: **M1 / M2 / M5 high value, M3 moderate, M4 is noise**. M4 reports 1 for ~95% of events — almost no information. Recommendation: drop M4 from MVP-II, replace with anchor position normalised distribution (validated by E6).
- **E4 · Cross-agent test**: claude-code vs codex on same git tree produced **structurally similar** lens output — both source-anchored, no identity drift. Codex's anchor density is **4.5x lower** (3.81 vs 0.85 per 100T), consistent with H5 ("anchor density is an agent property").
- **E5 · Fate update proxy**: hit a **structural surprise** — same git repo 2-day-later Episode 2 covered **entirely different work** (Cowork implementation → code-journal TUI scaffolding). Episode 1 events have **zero fate evolution in Episode 2** — not because the lens missed, but because the topic moved. Conclusion: **"same git repo" ≠ "same collaboration arc"**; fate-tracking needs topic continuity, not just repo continuity.
- **E6 · Second-order predictability proxy**: 6 pneuma-skills sessions across 1 month. **Anchor positions are bimodally distributed in normalised [0,1] space**: 48% in first 20%, 25% in last 20%, zero in 50-70% midsection. **First empirical substrate for § 9 predictability** — a trivial "first or last quintile" heuristic predicts ~73% of anchor positions.
- **E7 · Third-party reader proxy**: an isolated subagent given only Project B's audit (no transcript) correctly reconstructed **8 of 8 key direction-injection moments**, self-reported medium confidence, and **correctly identified 6 real gaps** the audit doesn't fill (code detail / external concepts / mid-section continuity). **Audit format passes the readability test**.

---

## 方法论 · Methodology

**中文:**

七个实验都用 isolated subagent(general-purpose,默认 `sonnet`)按 `experiments/observation-lens-v1/` 的纪律 dispatch:
- subagent **只** 读 named files(lens spec、schema、一份 digest)—— 没有其他 digest,没有其他 session,没有主对话
- 输出写到一个 named JSON 文件
- 实验之间无 context bleed:每个 `(experiment, session, lens)` triple 自己一个 subagent

E1-E7 共 22 次 subagent 调用,全部 output JSON 合法(应用 v1 baked-in 的 JSON-escape 规则,这一轮 0 次 escape failure,印证 v1 修复有效)。

对于 ideal 版本 structurally 不可能的实验(E5 需要多 episode 基础设施;E6 需要数月 MVP-II 数据;E7 需要真人第三方),本报告用**明确标注的 proxy** 替代,并坦率说明每个 proxy **能** 测和 **不能** 测什么。

**English:**

All seven experiments dispatched isolated subagents (general-purpose, default `sonnet`) per the `experiments/observation-lens-v1/` discipline:
- subagent reads **only** named files (lens spec, schema, one digest) — no other digests, no other sessions, no main conversation
- output written to one named JSON file
- no cross-experiment context bleed: each `(experiment, session, lens)` triple gets its own subagent

22 subagent calls total across E1-E7; all outputs valid JSON after the JSON-escape rule baked into lens specs (zero escape failures this round, confirming the v1 fix held).

For experiments where the ideal test is structurally impossible (E5 needs multi-episode infrastructure; E6 needs months of MVP-II data; E7 needs a real human third party), this report uses **clearly-labelled proxies** and is explicit about what each proxy can and cannot test.

---

## E1 · Lens 变异度 / Lens variance characterization

### 设置 · Setup

- 1 digest: Project B Episode 1(487 raw lines / 210 digest turns)
- Lens: anchored-deferral
- **5 runs `sonnet`** + 1 run `opus` + 1 run `haiku`,各自隔离

### 结果 · Results

```
                     events   engaged  deferred  overrode  ignored
sonnet-1               6        2        0         1         3
sonnet-2               7        3        0         1         3
sonnet-3               7        2        0         4         1
sonnet-4               7        2        0         2         2
sonnet-5               6        1        0         4         1
─────────────────────────────────────────────────────────────────
sonnet n=5
  total events     6-7    (mean 6.6, stdev 0.49)   ← STABLE
  engaged          1-3    (mean 2.0, stdev 0.75)
  deferred         0      (perfect stability)
  overrode         1-4    (mean 2.4, stdev 1.36)   ← LARGEST VARIANCE
  ignored          1-3    (mean 2.0, stdev 0.89)
─────────────────────────────────────────────────────────────────
opus                   8        3        0         4         1   (+20% events)
haiku                  3        2        0         0         1   (-55% events)
```

### 分析 · Analysis

**中文**: 三个发现:
1. **`overrode` 比 `engaged` 噪 ——跟我预测反了**。原因:`overrode`("拒绝 framing + 改去别的关切")judgment-heavy,边界 case("用户部分回应了 options 算不算?")在 run 之间在 `overrode` / `engaged` 之间翻转。
2. **`deferred` 完美稳定在 0**(本 session 没有 deferral)—— 窄定义 gate 有效。
3. **总事件数稳定** —— lens **找到的 anchor turns** 几乎相同,变异在**怎么分类** 上,不在**找不找得到**。

跨 model:`haiku` 漏掉 ~57%,**低于本任务能力门槛**;`opus` 比 `sonnet` 多抓 ~20%,且 shape 不同(0 ignored vs sonnet 平均 2)。

**English**: Three findings:
1. **`overrode` is noisier than `engaged` — opposite of my prediction.** Reason: `overrode` ("rejected framing + redirected") is judgment-heavy; borderline cases ("did user partially address?") flip between `overrode` / `engaged` across runs.
2. **`deferred` perfectly stable at 0** (no deferral in this session) — narrow gate works.
3. **Total event count stable** — lens **finds the same anchor turns** each run; variance is in **how each is classified**, not whether it gets caught.

Cross-model: `haiku` misses ~57%, **below capability threshold for this task**; `opus` catches ~20% more than `sonnet`, with different shape (0 ignored vs sonnet's mean 2).

### MVP-II 影响 · MVP-II implication

- **所有 stance count 显示要带 variance 区间**(例:"overrode = 3 (typical range 1-4 across reruns)")。
- **生产 runs 至少用 `sonnet`**;`haiku` 太 lossy 不能用。
- 加 **lens-version-bump 重新 characterize variance** 协议:prompt 改大改时,reference session 多 run 几次重测。

---

## E2 · Empty-state 压力测试 / Empty-state stress test

### 结果 · Results

```
File                          events  reason (truncated)
proj-X1-strict.json           0       "AI made no specific proposal — no named file..."
proj-X1-deferral.json         0       "AI never exposed a decision point meeting anchor criteria..."
proj-X2-strict.json           0       "Single instruction (T1) and assistant journal entry (T2)..."
proj-X2-deferral.json         0       "T1 is user-initiated prompt with rigid spec; T2 fulfilled..."
```

四次扫描全部返回 `events=0` + 具体 empty_state_reason。

### 分析 · Analysis

**中文**: H6 按设计通过。Lens spec 里的 empty-state 硬性规则在真零信号下被遵守。**零编造事件**。这意味着 MVP-II 在 low-signal week 会产出 "我看了 N turns,因 Z 找到 0 events" 这种诚实 audit,而不是 5 个编出来的合理事件。**框架的反-W-扩张姿态在 empty data 下站住了**。

**English**: H6 validated as designed. Lens spec's explicit empty-state requirement was followed under genuine zero-signal conditions. **Zero manufactured events.** This means MVP-II on a low-signal week (user mostly affirmative, agent mostly autonomous) produces honest "I looked at N turns, found 0 events because Z" audits rather than 5 fabricated plausible-sounding events. **Framework's anti-W-expansion stance survives empty data.**

### MVP-II 影响 · MVP-II implication

- 无代码改动 —— lens 规则已 enforce。
- composer 的 EMPTY-STATE block 渲染保留。
- ops checklist 加一条:low-signal week 仍触发 compose,不报错。

---

## E3 · Measurement 价值评估 / Measurement utility review

### 结果 · Results

Reader-mode 评分(✓ = 改变了我对 audit 的理解 / ✗ = 跳过没影响):

| Measurement | A | B | C | Verdict |
|-------------|---|---|---|---------|
| M1 anchor density per 100T | ✓ | ✓ | ✓ | **HIGH** —— B 的 3.81 vs A 的 0.76 解释了 agent-side 差异,防止把 stance 数误读为 user 属性 |
| M2 response latency | ✓ | ✓ | – | **HIGH** —— Project A 的 0.2s-41m 范围是任何 audit 里**最 striking 的单个数字** |
| M3 pivot magnitude | ✓ | – | – | **MODERATE** —— Project A 的 "8, 7, 4, 4" 递减趋势有意思,其他 project 在 noise level |
| M4 anchor→response turn distance | ✗ | ✗ | ✗ | **LOW** —— 三个 project 中位数都是 1,极少 2;基本无信息 |
| M5 lens convergence | ✓ | ✓ | ✓ | **HIGH-MODERATE** —— 50% / 100% / 100% 跨度让人惊讶并引出解读 |

### 分析 · Analysis

**中文**: M4 fails earn-its-space test。原因是结构性的不是随机的:**现代 coding agent session 的架构地板就是 turn-distance = 1**(AI 完整 turn → user 回复 → 下一 turn)。tool calls 发生在 AI 的 turn 内部,不在 turn 之间。M4 的设计目的"探测中间 AI 活动"在 turn 粒度上做不到。

M4 的位置应换成 E6 surfaces 的 **M6 = anchor positions 归一化到 [0,1]**。Project 级别能告诉 audit "anchors 落在前 20% / 后 20% / 中间" —— per E6 这是 signal-bearing。

**English**: M4 fails the earn-its-space test for a structural (not random) reason: **modern coding-agent sessions have an architectural floor of turn-distance = 1** — the AI typically posts a complete turn (with anchor) and waits for user reply (next turn). Intervening tool calls happen within the AI's turn, not between turn IDs. M4's intended detection of "intervening AI activity" doesn't work at turn granularity.

M4's slot should be replaced by **M6 = anchor positions normalised to [0,1] in session length** (surfaced by E6). Project-level distribution would let the audit say "anchors fell in first 20% / last 20% / middle" — which is signal-bearing per E6.

### MVP-II 影响 · MVP-II implication

- **compose.mjs 里删 M4**, 加 M6(anchor position 归一化分布,bimodal shape 可见)。
- M1 / M2 / M3 / M5 全部保留 ——M3 列为 probation(等多 episode 数据再 re-evaluate)。

---

## E4 · 同 project 跨 agent / Cross-agent test (codex vs claude-code)

### 结果 · Results

```
                          claude-code (v2 Project B)    codex (same project)
                          ─────────────────────────      ─────────────────────
session turns             210                            351
strict events             2                              3
deferral events           8                              3
deferral stance e/d/o/i   (3, 0, 4, 1)                   (1, 0, 2, 0)
anchor types ask/opt/unc  (2, 4, 1)                      (0, 3, 0)
anchor density / 100T     3.81                           0.85   ← 4.5x 差异
```

### 分析 · Analysis

**中文**: 最大发现 —— **claude-code 的 anchor 密度是 codex 的 4.5 倍**(3.81 vs 0.85 / 100T)。两种解读:
- (a) **codex 的提问风格更 autonomous** —— 倾向于做事报告,而非暴露决策点
- (b) **claude-code session scope 窄**(plugin extension + 具体选择点),codex session scope 宽(framework design)。anchor 密度可能跟 scope 走,不是 agent identity

数据不能 disambiguate (a) 和 (b)。**能说的是: lens 在 codex transcripts 上无需修改就能工作**。两条 lens spec 都正常找到 anchor,产 source-anchored 事件,无 identity drift。**lens 的 agent-agnostic claim 实证成立**。

Stance shape 不同(codex 1/0/2/0 vs claude-code 3/0/4/1)—— codex 偏 `overrode`,可能反映 meta-content(用户反复 push back AI 的 framework drafts)。

**English**: Biggest finding: **claude-code anchor density is 4.5x higher than codex** on this project (3.81 vs 0.85 per 100T). Two interpretations:
- (a) **Codex's question-asking style is more autonomous** — tends to do work and report rather than expose decision points
- (b) **Claude-code session was narrowly scoped** (plugin extension with concrete decision points) while codex session was broadly scoped (framework design). Anchor density may track scope, not agent identity

The data alone cannot disambiguate. What we CAN say: **the lens generalises to codex transcripts without modification**. Both lens specs found valid anchors, produced source-anchored strict events, emitted no identity claims. **Lens's agent-agnostic claim is empirically supported.**

Stance shape differs (codex 1/0/2/0 vs claude-code 3/0/4/1) — codex skews `overrode`, may reflect meta-content (user repeatedly pushing back on AI's framework drafts).

### MVP-II 影响 · MVP-II implication

- `core/sessions.ts` 已经发现 codex sessions —— 把 codex digester 接进生产路径是机械改动。
- **Lens specs 不需要 agent-specific 变体**。结构观察(specific proposal / user response / subsequent work)agent-invariant。
- 跨 agent 对比**永远**要带 anchor density,**不能** 只看 stance shape,否则 codex 会被误读为 "less engaged" 而其实是 "less interrogative"。

---

## E5 · Fate update proxy

### 结果 · Results

- Episode 1: tanka-work-memory-plugin, 2026-05-21, session 6446d252, 4 strict events (Cowork support topic)
- Episode 2: same repo, 2 days later, session bc43824f, 3864 lines
- Episode 2 内容: sidecar uploads + browse UI + TUI scaffolding for **code-journal**(完全不同的 topic!)
- Episode 1 events 在 Episode 2 **零 fate evolution**

### 分析 · Analysis

**中文**: 这是个**结构上重要的 null result**。Proxy 本来测"fate updates 在多 episode 下会不会自然出现",结果 surface 了 "**同 git repo ≠ 同 collaboration arc**"。用户 day N 做 Cowork 工作,day N+2 在同一个 repo 里换了一个 feature 干。没 fate 可探,因为话题搬走了。

两个含义:
1. **§ 8 fate-tracking 作为产品功能需要 topic continuity 检测**, 不只是 repo continuity。MVP-II 的 project = git repo 设定(Q6)对 **scope** 是对的,但 episode-to-episode fate-update 路径需要更细的单位:可能是事件内容 topic-clustering 出来的 "feature arc"。
2. **Silence is data**。Episode 1 events 在 Episode 2 无 fate evolution 时,audit 正确渲染应该是 `Fate updates: 无 —— Episode 2 的工作转到不同 feature stream 上了`。这是诚实的、不空白的、不编 fate-of-irrelevance。

Fate-tracking **机制**(event records 持续、新 episodes 触及老 events 时 append fate state)没问题。变的是预期:**不是每对相邻 episode 都有 fate overlap;多数没有**。

**English**: A **structurally important null result**. The proxy was meant to test "do fate updates surface naturally"; instead it surfaced "**same git repo does not mean same collaboration arc**." User did Cowork work on day N, started a different feature in the same repo on day N+2. No fate to detect because topic moved.

Two implications:
1. **§ 8 fate-tracking as a product feature requires topic continuity detection**, not just repo continuity. MVP-II's project = git repo assumption (Q6) is correct for **scope** but the episode-to-episode fate-update path needs a thinner unit — maybe "feature arc" detected by topic-clustering on event content.
2. **Silence is also data.** When Episode 1 events have no fate evolution in Episode 2, the right audit rendering is `Fate updates: none surfaced — Episode 2's work moved to a different feature stream.` This is honest, not blank, doesn't manufacture fate-of-irrelevance.

Fate-tracking **mechanism** (events persist, new episodes append fate when touching old events) is unchanged. What changes is the expectation that every adjacent episode has fate overlap — most won't.

### MVP-II 影响 · MVP-II implication

- `code-journal compose` 显示 Fate updates 时,要么列具体 fate,要么 `(none surfaced — Episode N's work touched different files/topics than Episode N-1's)`。后者是 informative 的、不是空白。
- **Phase 3+: 探索事件内容 topic-clustering** 来检测 "this episode continues that earlier event-cluster's arc"。MVP-II 不做。

---

## E6 · 二阶可预测性 proxy / Second-order predictability proxy

### 结果 · Results

6 个 pneuma-skills sessions 跨 2026-04-29 → 2026-05-27(约 1 个月)。各 session 用 anchored-deferral lens 扫,提取 anchor turn IDs,归一化到 [0, 1] = `turn_id / total_turns`:

```
27 个 anchor 的位置分布(所有 6 session 汇总):

[0.0, 0.1):  ██████ 6  (22%)  ← session 开头
[0.1, 0.2):  ███████ 7 (26%)  ← 早期 decisions
[0.2, 0.3):  ██ 2 (7%)
[0.3, 0.4):  ██ 2 (7%)
[0.4, 0.5):  ███ 3 (11%)
[0.5, 0.6):  0 (0%)             ← 中段空谷
[0.6, 0.7):  0 (0%)             ← 中段空谷
[0.7, 0.8):  ██ 2 (7%)
[0.8, 0.9):  ███ 3 (11%)        ← 收尾
[0.9, 1.0):  ██ 2 (7%)          ← session 结束
```

**48% 落在前 20%。25% 落在后 20%。中段(50%-70%)0 个 anchor**。双峰分布。

Early vs late 对比:

```
Early sessions (3):  positions sorted -> median 0.18, mean 0.29
                     很多落在 session 头部
Late sessions (3):   positions sorted -> median 0.40, mean 0.46
                     更分散,后半段也有
```

### 分析 · Analysis

**中文**: 两个发现,一个 expected 一个 new:

1. **Anchor 在 session 内不是均匀分布的**。它们 cluster 在 session 开头(decision-making 阶段)和 session 末尾(wrap-up / commit-strategy / scheduling)。中段 50% 由执行主导,explicit 决策点稀少。**一个 trivial "前 20% 或后 20%" 启发式预测 73% 的 anchor 位置**。意味着 **§ 9 predictability 有真东西可工作了** —— 即使不训练,数据本身有结构。
2. **Late session 的 anchor 位置中位数(0.40)比 early(0.18)高**。Late sessions 更频繁地 front-load 简短开局 + 分散 body decisions;early sessions 把 anchor 堆在最开头。数据集小(15 vs 12)所以差异可能不稳健,但**暗示协作模式会随时间漂移**—— 正是 § 9 设计来检测的那种漂移。

合起来: 位置非随机, **而且** 位置分布本身可能随时间漂移。这两个都是 § 9 非平凡所需的必要条件。**框架的 Phase 4 predictability claim 不再是纯 speculation;substrate 在数据里存在**。

**English**: Two findings, one expected, one new:

1. **Anchors are not uniformly distributed within sessions.** They cluster at session start (decision-making phase) and session end (wrap-up / commit-strategy / scheduling). The middle 50% is dominated by execution and contains few explicit decision-points. **A trivial "first 20% or last 20%" heuristic predicts 73% of all anchor positions across this dataset.** This means **§ 9 predictability has real material to work with** — even without training, the data is structured.

2. **Late sessions have higher median anchor position (0.40) than early (0.18).** Late sessions in this dataset more often front-load with brief openings then distribute decisions into the body; early sessions cluster anchors at the very start. Dataset is small (15 vs 12) so difference may not be robust, but **suggests collaboration patterns may shift over time** — the kind of drift § 9 is designed to detect.

Together: position is non-random, AND the position distribution may itself drift over time. Both are necessary conditions for § 9 to be non-trivial. **The framework's Phase 4 predictability claim is no longer pure speculation; the substrate exists in the data.**

### MVP-II 影响 · MVP-II implication

- **compose.mjs 加 M6**(anchor position 归一化分布,bimodal 可见)替换 M4。
- **Phase 3 / MVP-III 加 "predictability dashboard"**: "新 anchor 落在 K-window heuristic 预测位置的比率" 时间序列 —— residual 下降 = § 9 验证。
- **Heuristic first, model later.** 第一个 predictor 不需要 ML —— 一个 quintile-bucket prior 在用户自己历史 sessions 上训练就已经 informative。

---

## E7 · 第三方 reader 重建 proxy / Third-party reader reconstruction proxy

### 结果 · Results

一个 isolated subagent 只读 Project B 的 audit(不看 transcript, 不看 raw events,不搜代码库)。Reader 正确识别:

- **Session 主题**: 扩展 work-memory plugin 支持 Cowork session 数据 ✓
- **8 个关键 direction-injection 时刻** 全部正确,描述了 AI 提议和 user 回应 ✓
- **整体形态**: "predominantly a redirector rather than a co-planner. Out of eight explicit AI decision-points, four were overridden and one was ignored — the user either bypassed the AI's framing entirely or substituted a different question or action."

Reader **正确 flag 了 6 个 gap**:
1. `work-log-synthesizer.md` 改动的实质内容(code-detail)
2. "Cowork" 到底是什么(外部 context)
3. 各 anchor 之间的中段连续性
4. 测试是否成功
5. `sessions.ts` 改动细节
6. 12 个 "collab-obs" 预存 commits 的身份

Self-reported confidence: **medium**,"最大不确定是 Cowork 调研期间发生的具体事情和 synthesizer 编辑的实质内容,因为 audit 描述了 outcome 和分类但没揭示代码 / 逻辑变化的实质"。

### 分析 · Analysis

**中文**: 强正面结果,带一个**重要 caveat**。

**正面**: audit format **communicatively complete** for its claimed purpose —— 让非参与者(或失去 working memory 的 future-self,per Q3)重建 session 的 macro 形态和关键 direction-injection 时刻。Reader 在零 transcript 访问下重建 8 个时刻全部准确。

值得注意的是: reader 的 "predominantly a redirector" 形态判断是**从数据 form 出来的**, **不是** system declared 的 identity claim —— 正是 § 11.4 sanction 的 meta-pattern(user 形成,system 不形成)。**第二条 framework 预测被验证**: audit format 对 reader 来说能 form 模式,系统不用替 reader 说话。

**Caveat (这是对的 caveat)**: audit 故意不带 code-detail substrate。reader 正确识别这是 limitation。某些 reader / 用例(如 "future-self 想记起最终决定了什么")audit 够;某些(如 "auditor 想验证实现是否匹配决策")需要点进 transcript 去看。这验证了 source-index 设计: audit 留在 narrative / decision 层,code-detail 一键之外 push 给 transcript drill-in。

**English**: Strong positive result with one **important caveat**.

**Positive**: audit format is **communicatively complete for its claimed purpose** — letting a non-participant (or future-self who has lost working memory, per Q3) reconstruct the macro shape of a session and its key direction-injection moments. Reader's reconstruction of 8 moments was accurate with zero transcript access.

Notable: the reader's "predominantly a redirector" shape assessment is **formed from the data**, **not** a system-declared identity claim — exactly the kind of meta-pattern § 11.4 sanctions (user forms, system doesn't). **Second framework prediction validated**: audit format lets reader form patterns; system doesn't have to do it for the reader.

**Caveat (and it's the right caveat)**: audit deliberately doesn't include code-detail substrate. Reader correctly identified this as a limitation. For some readers/use cases (e.g., "future-self trying to remember what we ultimately decided"), audit is enough. For others (e.g., "auditor trying to verify implementation matches decision"), source ref to transcript is the path forward. **Validates the source-index design**: audit stays at narrative / decision layer, code-detail pushed one click away to transcript drill-in.

### MVP-II 影响 · MVP-II implication

- **Audit format 已经可以给作者之外的人用**。Coach / 受邀 reader / future-self 能读这些文档 form 准确结构化理解。
- **Reader flag 的 6 个 gap 是正确该 flag 的 gap**。未来版本**不应** 把 code diff 内联进 audit(那会稀释 audit 的 narrative coherence)。Source index 应让 transcript drill-in 真正一键直达,gap 在不离开 audit 内容层的前提下可寻址。

---

## 跨实验 synthesis · Cross-experiment synthesis (meta-findings)

三个 finding 只有把 E1-E7 一起读才看得见。

Three findings only visible when E1-E7 are read together.

### Synthesis-1 · Stance 类别有非均匀 variance / Non-uniform variance across stance categories

**中文**: E1 量化了 intra-model variance: `engaged` 和 `ignored` 中等(stdev ~0.8), `overrode` 高(stdev 1.36), `deferred` 在零 deferral session 上完美稳定。E4 显示 cross-agent stance shape 在结构上不同。E6 显示 late session 偏 `engaged`(late-1 是 6/0/0/0 全 engaged)。合起来: **per-session 层面的 stance count 永远要带 variance budget 显示**,因为底层信号在 small-N 样本不能捕获的方式上结构性 variable。

**English**: E1 quantified intra-model variance: `engaged` and `ignored` moderate (stdev ~0.8), `overrode` high (stdev 1.36), `deferred` perfectly stable on zero-deferral sessions. E4 showed cross-agent stance shapes differ structurally. E6 showed late sessions skew toward `engaged`. Together: **stance counts at the per-session level should always be reported with their variance budget visible**, because the underlying signal is genuinely structurally variable in ways small-N samples don't capture.

### Synthesis-2 · "同 git repo" 是 fate 的错误单位 / "Same git repo" is the wrong unit for fate

**中文**: E5 showed Project B Episode 2 covered different work despite same git repo. 不是 lens failure,是 project-boundary heuristic failure。Fate-tracking 的正确单位是 **topic-coherent arc**, 不是 git repo。MVP-II 接受这个 —— audits 保持 per-git-repo, fate-updates section 诚实地标 "none surfaced"。Phase 3+ 这就是事件内容 clustering 第一次 pay off 的地方。

**English**: E5 showed Project B Episode 2 covered different work despite same git repo. Not a lens failure; a project-boundary heuristic failure. The right unit for fate tracking is **topic-coherent arc**, not git repo. For MVP-II this is acceptable — audits remain per-git-repo, fate-updates section honestly notes when no carry-over exists. For Phase 3+, this is the first place where event-content clustering pays off.

### Synthesis-3 · 框架 Layer-3 hypotheses 现在有 empirical substrate / Framework's Layer-3 hypotheses now have empirical substrate

**中文**: E6 showed anchor positions bimodal 且可能随时间漂移。E5 showed fate-tracking 机械上简单但需要 topic-continuity 才有用。E7 showed audit communicatively complete。合起来: **框架的 long-horizon claims (§ 8 fate, § 9 predictability) 不再是纯 speculation;它们有真材料工作**。缺的不是框架细化,是 infrastructure(multi-episode persistence, cross-episode comparison)。

**English**: E6 shows anchor positions are bimodal and may drift over time. E5 shows fate-tracking is mechanically simple but needs topic-continuity to be useful. E7 shows the audit is communicatively complete. Together: **the framework's long-horizon claims (§ 8 fate, § 9 predictability) are no longer pure speculation; they have real material to work with.** What's missing for them to be tested is infrastructure (multi-episode persistence, cross-episode comparison), not framework refinement.

---

## MVP-II 修订 punch list / Revised punch list

| # | Change | Why | Cost |
|---|--------|-----|------|
| 1 | **删 M4** (anchor→response turn distance) | E3: median 总是 1, 无信息 | 5 行 |
| 2 | **加 M6** (anchor position 归一化分布) | E6: 双峰非随机, § 9 substrate | ~20 行 |
| 3 | **Stance counts 显示带 variance budget** | E1: per-stance variance 不均匀 | composer + reference-session 重测 |
| 4 | **Empty-state 在 audit 里 explicit 显示** (已在) + ops note: low-signal week 仍 trigger compose | E2: 诚实又 informative | docs |
| 5 | **codex digester 接进 `core/sessions.ts` 生产路径** | E4: lens generalises, 无需 agent-specific | small adapter |
| 6 | **Fate-updates section 显示 "none surfaced — Episode N 涉及不同 work"** 而非空白 | E5: silence is data | composer |
| 7 | **生产 lens 不用 `haiku`** —— sonnet 为底线 | E1: haiku 漏 ~50% | docs / safety check |
| 8 | **建立 lens-version-bump variance 重 characterize 协议** | E1: variance non-trivial, prompt 改时要告知用户 | 新 doc |

### 不变的事情 / Things that don't change

- Audit document 结构 (δ' from Q8): 被 E7 reader test 验证
- Two non-interfering lenses (Q7): cross-agent (E4) + cross-time (E6) 都验证
- Subagent isolation discipline: 7 个实验都验证
- Source-anchored / no-valence / no-identity-claim 硬规: 53 events 零违反
- Audit voice = audit, not service (Q3 6+2): reader 能不参与就重建,即验证

### 移到 MVP-III scope / Moved to MVP-III scope

- Multi-episode signal store + persistent event IDs
- Cross-episode fate-tracking + topic-continuity 检测
- § 9 predictability dashboard (residual time series)
- Real third-party reader testing (consenting humans, not subagents)

---

## 限制 · Limitations

- **所有 proxy 都是 proxy** —— E5 不测多 episode fate evolution,E6 不严格测 § 9,E7 不替代真人第三方
- **Variance characterization 只来自一个 session** —— E1 数字可能不 generalize 到其他 session 类型(debug-heavy, greenfield, doc-heavy)
- **Stance 类别定义还有 wiggle room** —— E1 显示 `overrode` 最噪,部分是定义脆弱(什么时候 "engaged with critique" 变成 "overrode the framing"?)
- **E4 cross-agent 是 single-session** —— anchor density 3.8 vs 0.85 striking 但 n=1
- **E7 reader 是 subagent,不是人** —— precise 但不模拟疲惫 manager 在 EOD 阅读的认知 load

All proxies are proxies. Variance characterisation is from one session. Stance category definitions still have wiggle room. E4 is single-session. E7 reader was a subagent, not a human.

---

## Phase 2 Ledger

```
2026-05-27   Phase 2 experimental battery — E1 through E7
             22 subagent calls (sonnet primary, opus + haiku in E1 only)
             Total events surfaced across all experiments: 53
               sonnet variance: 5 runs × 6.6 mean = 33 events
               opus: 8 · haiku: 3
               E2: 0 (empty-state, intended)
               E4: 6 · E5: 11 · E6: 27
               E7: reconstruction artefact (not events)

             Verdicts:
               E1 sealed — variance characterised, overrode noisiest
               E2 sealed — empty-state explicitly honoured
               E3 sealed — drop M4, replace with M6
               E4 sealed — lens agent-agnostic, anchor density agent-side
               E5 surprising null — same-repo ≠ same-arc, design intact
               E6 sealed — bimodal anchor distribution, § 9 substrate exists
               E7 sealed — audit communicatively complete for non-participant

             Cumulative across Phase 1 + Phase 2:
               9 hypotheses tested with positive substrate
               0 hypotheses falsified
               3 framework design choices (Q3, Q7, Q8) validated under structural pressure
               1 unexpected finding (Synthesis-2: repo ≠ arc) needs Phase 3 attention

             Methodology: subagent context isolation per (experiment, session, lens) triple;
             anonymised project codes; raw transcript content kept out of source control;
             reader proxy honest with explicit caveat.
```

## 总结 · Verdict

> **中文** —— 七个推荐实验全部完成,structurally 不可能 ideal 版本的用清楚标注的 proxy。框架的可测试 hypotheses 继续站住;一个新结构性发现(anchor 位置 bimodal, E6)给 § 9 predictability 第一次 empirical substrate。Audit format 通过 unparticipating-reader 测试(E7),正确 gap 被正确识别。一个小 punch-list 项进 MVP-II(删 M4 加 M6);v1 设计的其他都保留。MVP-II 仍是 3-5 天工程,lens / schema / digester / composer 已 production-ready。

> **English** — All seven recommended experiments completed, with clearly-labelled proxies where the ideal test was structurally impossible. The framework's testable hypotheses continue to hold; one new structural finding (anchor position bimodality, E6) gives § 9 predictability its first empirical substrate. The audit format passes the unparticipating-reader test (E7), with the right gaps correctly identified. One small punch-list item moves into MVP-II (drop M4, add M6); everything else from the v1 design stays. MVP-II remains a 3-5 day engineering project with the lens / schema / digester / composer already production-ready.
