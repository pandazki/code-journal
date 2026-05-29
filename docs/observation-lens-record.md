# 协作观测 Lens · 完整记录
# Observation Lens · Complete Record

> 一份把 **缘起 → Phase 1 → Phase 2 → MVP-II → smoke test** 串成一条线
> 的诚实记录。每条结论都标了置信度。读完应该清楚:**哪些是真的站住
> 了,哪些是单次实验觉得对但没复制过,哪些根本没碰过**。
>
> An honest record stringing together origin → Phase 1 → Phase 2 →
> MVP-II → smoke test. Every claim is tagged with a confidence level.
> Reading this should make clear: what actually holds, what we *think*
> holds but only saw once, and what we have not touched at all.

---

## 置信度图例 · Confidence legend

- 🟢 **Strong** — 多次实验 / 多项目复制,方向一致
- 🟡 **Tentative** — 单次或 single-N 观察,合理但需复制
- 🔵 **Inferred** — 框架推断,schema 留位但没实测
- ⚫ **Falsified / revised** — 试了,要修正或退回

---

## 0 · 缘起 · Origin

用户的根本问题在 grilling 期间被精确说出来:

> 「只做工作日志有啥意义呢?哪怕你无限跟 coding agent 说,**非常好继续吧**,
> 也能得到一个看似非常丰富的工作日志,这有意义吗?」

这一问把当时 code-journal 已有的方向(visual journal + heatmap +
contribution tile)整片地基掀了一半:**如果 agent 默认产出就是
plausible-but-flat,那"丰富"的日志只是把 plausible 整齐摊开**。

由此引出 user 已经独立写好的 **协作观测框架**(2026-05-15 修订版)。
框架的核心 claim:**协作的信号不在 AI 产出的体积里,在 user 注入方向
的位置上**。框架要做的不是评分,是显化已经发生过的、可被追溯到证据
的方向性事件。

整个 code-journal 的 observation lens 方向,从这里开始。

---

## 1 · 时间线 · Chronology

```
2026-05-14    协作观测框架文档初版(user 独立写)
2026-05-15    框架 Revised 版本(经 Phase 1 实验)
2026-05-22    code-journal 项目 pivot · 旧 journal 方向搁置
2026-05-26    Grilling 阶段:Q1-Q9 设计决策
              + 第一次 Phase 1 实验(3 项目 × 2 lens × subagent 隔离)
              + 双语 Phase 1 报告
2026-05-27    Phase 2 实验组(E1-E7,7 项实验)
              + MVP-II 工程规划(docs/plans/mvp-ii.md)
2026-05-28    MVP-II 实现(M1-M7,7 个工程 milestone,53 单元测试)
              + 在 6 个真实项目上跑 smoke test
              + 4 个项目产出 Episode 1 audit
2026-05-29    本记录(把全部链条理清楚)
```

Git 上 6 个 commit,**没有 push 到 remote**,全部在
`experiment/observation-lens-v1` 分支:

```
479b107  mvp-ii: production hardening + smoke-test results
9716ca5  mvp-ii: implement M1-M7
c3861fd  docs: MVP-II engineering plan + roadmap link
e2d6ee6  experiment: phase 2 battery — E1 through E7
1bc2dcb  experiment: v2 wrap-up
27599ef  experiment: bilingual (中英) version of Phase 1 report
5cfe4d0  experiment: phase 1 observation-lens cross-project comparison
```

---

## 2 · Code 与 artifact 状态 · What's actually built

### 已实现 · Built

```
packages/observation/                          (new workspace, 53 tests)
├── src/lib/
│   ├── schema.ts            Event/FateUpdate/Episode/ProjectState types
│   ├── digest.ts            claude-code JSONL → digest
│   ├── digest-codex.ts      codex JSONL → digest (E4 fix)
│   ├── lens-runner.ts       claude -p stdin pipe + JSON-retry + haiku ban
│   ├── compose.ts           events → δ' markdown (forbidden-words gate)
│   ├── store.ts             append-only JSONL signal store
│   ├── state.ts             ProjectState read/write
│   └── paths.ts             ~/.code-journal/observations/ resolver
├── src/lenses/              canonical prompts (live markdown)
└── test/                    53 unit tests (round-trip / dedup / etc)

packages/cli/src/observation.ts               new sync / compose / status

scripts/recharacterize-lens.mjs               variance helper for lens bumps

docs/plans/mvp-ii.md                          engineering plan
docs/plans/mvp-ii-operations.md               cron + ops runbook
docs/plans/mvp-ii-smoke-test-results.md       cross-project numbers
docs/plans/mvp-ii-reflective-summary.md       what stuck after running
docs/observation-lens-record.md               (this file)

experiments/observation-lens-v1/              Phase 1 artifacts
experiments/observation-lens-v2/              Phase 2 artifacts (E1-E7)
```

### 没实现(从 plan 推到 MVP-III)· Deferred to MVP-III

- Topic-coherent arc detection(替代 git-repo 作 fate 单位)
- § 9 二阶可预测性 dashboard
- 真人 third-party reader test
- Multi-machine sync
- 用户 fate 注释 CLI(`code-journal fate add`)
- 超大 session(>2000 turns)chunked digestion
- Audit export to PDF / HTML
- Web GUI for episode browsing

---

## 3 · 主张 → 证据 → 置信度 · Claim → evidence → confidence

### 框架核心主张 · Framework core claims

| # | Claim | Evidence | Confidence |
|---|-------|----------|------------|
| F1 | **plausible 坍塌** — AI 默认输出 plausible-but-flat,鲁棒方向信号稀疏 | strict-negative-space 在 9 个 Phase 1+2 session 上密度 0.43%-0.95% turns;smoke test 4 项目 0.29-1.56/100T | 🟢 Strong |
| F2 | **镜子 not 判官** — 输出不能滑成 identity claim | 53 events 跨 Phase 1+2+smoke test,**0 个 identity 词漏出** forbidden-words gate | 🟢 Strong |
| F3 | **分析单位是协作 not 用户** — 同 user 在不同协作有不同 distribution | Phase 1: 3 项目 3 种 shape;Phase 2 E4 cross-agent;smoke test: 4 项目 4 种 shape,**且 stance e/d/o/i 模式 qualitatively 不同**(code-journal 7/1/6/2 vs tanka 2/0/3/5 vs pneuma-skills 9/1/0/4) | 🟢 Strong |
| F4 | **负空间需要 source-anchored 双门** | strict lens 严守"AI 提议具体 + 后续走不同轴"双门,smoke test 上 14 个 strict event 没有出现"沉默 → 编故事"的失败模式 | 🟢 Strong |
| F5 | **anchored deferral 四姿态** + anchor density 是 agent feature | smoke test 上 4 项目 anchor density 0.29-1.56/100T,**同 user 跨项目大幅波动**说明它是 agent + project 特征,不是 user 属性 | 🟢 Strong |
| F6 | **empty-state 必须显式** | Phase 2 E2: 4/4 零信号 scan 正确返回 empty-state;smoke test 上 nemori 9 session + desktop-sprite 部分 session,**0 编造** | 🟢 Strong |
| F7 | **两 lens 互补不冗余** | Phase 1: 12-25% overlap;Phase 2: 67% primary-turn overlap;smoke test: **17%-100% range across projects** — 互补性成立但**机制不止一种**,见 S5 | 🟡 Tentative — 设计成立,但具体 mechanism 至少 2 种,需更多数据分类 |
| F8 | **命运追踪 + 事件不可删** (§ 8) | schema 字段全到位、单元测试覆盖 append-only + fate 追加;但**没真数据上填过 fate** | 🔵 Inferred — 工程就位,行为未验 |
| F9 | **二阶可预测性** (§ 9) | Phase 2 E6 在 6 个 pneuma-skills session 上看到 anchor 双峰(73% 命中前 / 后 20%);smoke test ⚫ **部分反转** — 单 episode 内 quintile shape 不是双峰,project-phase 相关 | 🟡 Tentative,且 P2/S6 表明 framework 描述需 narrow |
| F10 | **§ 14.1 ceiling** — precision 可测,recall 难测 | Phase 2 E7 reader proxy 揭示了 audit 的 6 个真实 gap(代码细节、外部上下文等);这条 ceiling 本身**被设计正确识别** | 🟢 Strong — meta 层成立 |

### Phase 2 实验新结论 · Phase 2 new claims

| # | Claim | Evidence | Confidence |
|---|-------|----------|------------|
| P1 | **`overrode` 是最噪 stance**(不是 `engaged`) | Phase 2 E1: 5 sonnet runs on 1 session,overrode stdev 1.36 vs engaged 0.75 | 🟡 Tentative — n=5,单 session,需在其它 session / 模型上复制 |
| P2 | **anchor positions 双峰** | Phase 2 E6: 6 pneuma-skills sessions,48% 落在前 20%,25% 落在后 20% | ⚫ **被 smoke test 部分反转** — 见 S6 |
| P3 | **lens 在 codex 上 work,无需 agent-specific 变体** | Phase 2 E4: 1 codex session;smoke test: 4 项目 auto-discover claude-code + codex | 🟢 Strong |
| P4 | **"同 git repo" ≠ "同 collaboration arc"** | Phase 2 E5: Project B Episode 1 (Cowork 支持) vs Episode 2 (TUI scaffolding,同 repo 但不同 feature stream);smoke test 上 tanka 跨多 session 同样的现象 | 🟢 Strong |
| P5 | **audit format 对 future-self / 非参与者 communicatively complete** | Phase 2 E7: subagent reader correctly reconstructs 8/8 key moments | 🟡 Tentative — reader 是 subagent proxy,真人未测 |

### MVP-II Smoke test 上的新观察 · Findings from real production run

| # | Finding | Evidence | Confidence |
|---|---------|----------|------------|
| S1 | **lens 对自我观测保持诚实** — 抓到本次对话的 macro pivot,没编造 | code-journal Episode 1 strict event 1 (T107-T110) 抓到"之前的工作不重要"那一刻,event content 经 user 确认 | 🟢 Strong — single but high-stakes case |
| S2 | **4 项目 4 种 stance shape**(production-grade H3 验证) | 4 audit,e/d/o/i tuple qualitatively 不同;同 user | 🟢 Strong |
| S3 | **空场上的 H6 production replication** | nemori 9/9 session empty;desktop-sprite 部分 session empty | 🟢 Strong |
| S4 | **三层架构 + cron 工程可行** | 53 单元测试 + 4 端到端 audit 落地 | 🟢 Strong |
| S5 | **lens convergence 可以低到 17%** — 揭示 user-driven pivot mode | omne-next 6 strict events 中只有 1 个落在 deferral anchor 上 | 🟡 Tentative — n=1 项目,但**质上不同的 mode**,需 replication 验证它是稳定 mode 还是 outlier |
| S6 | **anchor position M6 quintile 形状是 project-phase-dependent** | code-journal [16,0,0,0,0] front;pneuma-skills [1,2,10,0,1] middle;omne-next/tanka 平均 | 🟡 Tentative — 4 单 episode 观察,反转了 P2 的 universality;需多 episode 数据看真实形状 |
| S7 | **多 agent 自动浮现** | smoke test 上 4 项目 agent_seen 同时包含 claude-code + codex | 🟢 Strong — pipeline 正确 |

---

## 4 · 真实数据上跑过什么 · What ran against real data

### Phase 1 (2026-05-26)

3 个项目 × 2 lens × subagent isolation = 6 scans on:
- pneuma-skills · session bd0a2c73 · 1777 lines · 925 turns
- tanka-work-memory-plugin · session 6446d252 · 487 lines · 210 turns
- omne-omne-next · session 6d6ff5a5 · 611 lines · 360 turns

产出 9 strict + 22 deferral events = 31 events,3 个 δ' audit。

### Phase 2 (2026-05-27)

E1-E7 共 22 subagent calls:
- E1: 7 calls (5 sonnet + opus + haiku · 1 session)
- E2: 4 calls (2 low-signal sessions × 2 lens)
- E3: 0 calls (reader-mode review of v1 audits)
- E4: 2 calls (codex session × 2 lens)
- E5: 2 calls (Project B Ep2 × 2 lens)
- E6: 6 calls (6 pneuma-skills sessions × deferral lens)
- E7: 1 call (third-party reader proxy)

共 53 events + 1 reconstruction artifact。详细在 `experiments/observation-lens-v2/report.md`。

### MVP-II smoke test (2026-05-28)

| Project | sessions attempted | succeeded | events | episode |
|---------|-------------------:|----------:|-------:|--------:|
| code-journal | 5 (1 ARG_MAX, 1 OK, 3 too tiny) | 4 | 18 (2 strict + 16 deferral) | 1 ✓ |
| pneuma-skills | 5 (1 context overflow) | 4 | 12 (initial) + 4 more | 1 ✓ |
| omne-next | 15 (3 ARG_MAX/timeout) | 12 | 9 (6 strict + 3 deferral) | 1 ✓ |
| tanka-work-memory | 18 (3 ARG_MAX/timeout) | 15 | 14 (4 strict + 10 deferral) | 1 ✓ |
| nemori | 9 (all small) | 9 | 0 (all empty-state) | — |
| desktop-sprite | 5 (2 failed) | 3 | 0 (small / empty-state) | — |

**totaling: 6054 turns scanned, 53 events stored, 4 Episode 1 audits,
0 hypotheses falsified, 3 engineering bugs surfaced and fixed**。

Audits 在 `~/.code-journal/observations/<pid>/episodes/1-2026-05-28.md`
(gitignored — 真实 transcript 内容不进 commit)。

---

## 5 · 没碰的 / 没法碰的事 · What hasn't been tested

按 **why not tested** 分组:

### A · 需要时间累积才能测的 · Needs time

| Item | 缺什么 |
|------|--------|
| **§ 8 fate tracking 在真实数据上** | 每个项目目前只有 Episode 1。Episode 2+ 才能看 fate 演化 |
| **§ 9 二阶可预测性 残差时间序列** | 需要 3+ 月连续 MVP-II 运行的 episodes |
| **真人 future-self 读自己 6 个月前的 audit 能否 reconstruct** | 需要时间 |
| **anchor density / stance shape 是否会随 user 变化** | 同一 (user, project) 在不同时段对照才有意义 |

### B · 需要其他人才能测的 · Needs other humans

| Item | 缺什么 |
|------|--------|
| **真人 reader test** | E7 是 subagent proxy。真人在 audit format stable 后才有意义 |
| **管理场景误用风险**(§ 14 #3) | 框架理论上禁止,实际上需要在被误用过的场景下做反测 |
| **跨用户对比是否真的不安全** | § 4.3 禁止跨用户综合,但没人试过"如果硬做会出什么样的灾难性输出" |

### C · 需要工程才能测的 · Needs engineering

| Item | 缺什么 |
|------|--------|
| **超大 session (>2000 turns)** | Chunked digest 没做,4 个 senior 用户 session 当场打不开 |
| **用户反馈进 schema** | `FateUpdate.user_note` 字段存在,**没入口** |
| **跨机器 sync** | 单机方案,UX 完全没碰 |
| **lens version 升级**真实流程 | scripts/recharacterize-lens.mjs 写了,但没在真 lens prompt 改动场景下走完一遍 |

### D · 用户行为级问题 · User behaviour, not framework

| Item | 没数据 |
|------|--------|
| **用户会不会真的打开 audit 来读** | 你打开过 Episode 1 吗?会一周后再打开吗? |
| **用户读完会做什么** | 给 coach 看?自己 reflect?忽略? |
| **低频深刻的"低频"具体是几天 / 几周 / 几月** | 框架说"低频深刻",但没观察过真实节奏 |

### E · 框架本身没特别 highlight 但 smoke test 暴露的 · New holes from real data

| Item | What it implies |
|------|----------------|
| **omne-next 17% 收敛率** | 框架的两 lens 在 debug-driven workflow 下不够;可能需要第三条 lens 在 AI 没暴露决策点时也能照出 user pivot |
| **每个 episode 内 M6 quintile shape 随项目阶段变** | 框架的"anchor 双峰"叙述需要 narrow 到"跨 session 聚合"层级 |
| **多 agent 项目里 claude-code 与 codex 的事件比例可能不均衡** | 当前 audit 把两 agent 的 events 合并,**没分 agent 报 stance shape** — 这是 H5 的具体测试,但目前 schema 已支持,只是 composer 没渲染 |

---

## 6 · 这次发现但没消化完的 surprise · Open puzzle

### S5 详说 · The 17% convergence on omne-next

Phase 1 + 2 一直观察到 50%-100% 的 strict / deferral 同 turn 重叠率。
但 smoke test 上 **omne-next 突降到 17%** — 6 个 strict event 里只有
1 个落在 deferral lens 标的 anchor 上。

意味着存在一种**用户独立 pivot、AI 没设决策点**的协作模式。原因可能是:

- omne-next 那段是 **debug-driven session** —— 用户跟着 error 走,AI 跟着用户走,**两人没人在"决定"什么,只是连环 fix**。
- 在 debug 流里,AI 不会停下来问"你想 A 还是 B?",而是直接尝试解决。user 的"方向注入"发生在 **error 出现的那一刻**,不在 AI 提问的那一刻。

如果这条 mode 稳定存在,则 framework 在描述协作时需要至少 **3 种 mode**:

1. **fork-and-choose**(AI 设决策点,user 在那里 stance) ← anchored-deferral 覆盖
2. **macro-pivot-off-axis**(AI 提具体方案,user 拉去别处) ← strict-negative-space 覆盖
3. **user-driven-pivot-no-fork**(AI 没设决策点,user 自己改向) ← **目前没 lens 覆盖**

第 3 种需要一条**新 lens**:扫"用户在没有 anchor 的情况下引入新名词 / 新 file / 新关切"的事件。但这是 MVP-III。

**这一发现 confidence 是 🟡** — 单个项目观察,需要在 2-3 个其它 debug-heavy projects 上看是否复制。

---

## 7 · 索引 · Index

### 文档

- `experiments/observation-lens-v1/report.md` — Phase 1 cross-project report (English)
- `experiments/observation-lens-v1/report-bilingual.md` — Phase 1 双语版
- `experiments/observation-lens-v1/NOTES-v2-wrap-up.md` — v1 → v2 punch list 落地
- `experiments/observation-lens-v2/report.md` — Phase 2 E1-E7 report
- `experiments/observation-lens-v2/report-bilingual.md` — Phase 2 双语
- `docs/plans/mvp-ii.md` — MVP-II 工程规划
- `docs/plans/mvp-ii-operations.md` — cron + ops runbook
- `docs/plans/mvp-ii-smoke-test-results.md` — smoke test 数字
- `docs/plans/mvp-ii-reflective-summary.md` — smoke test 感性总结
- `docs/observation-lens-record.md` — **本文件**

### 代码

- `packages/observation/` — 全部 observation 层 (新 workspace, 53 单元测试)
- `packages/cli/src/observation.ts` — 3 个新 subcommand
- `scripts/recharacterize-lens.mjs` — lens variance 帮手

### 真实数据(本机,不入 git)

- `~/.code-journal/observations/code-journal-7yyrpu/episodes/1-2026-05-28.md`
- `~/.code-journal/observations/pneuma-skills-3lck7c/episodes/1-2026-05-28.md`
- `~/.code-journal/observations/omne-next-w11tae/episodes/1-2026-05-28.md`
- `~/.code-journal/observations/tanka-work-memory-plugin-5lpzra/episodes/1-2026-05-28.md`

### 原始框架文档

- `~/Downloads/协作观测框架.html`(user 拥有,不在 repo)

---

## 8 · 接下来按什么顺序 · What next, in priority order

按"信号 / 成本"比排序:

### Tier 1 · 短期(几周)就能做 · cheap and high signal

1. **跑 Episode 2** — 任一 active project 隔一周再跑一次 `sync` + `compose`,
   看 Episode 2 是否在 Episode 1 events 上检测到 fate。这是 § 8 fate
   tracking 的**第一次真实数据测试**。零工程成本。

2. **跨 episode 看 M6 quintile shape 是否稳定** — 4 个项目各 3-4 个 Episode 后,
   M6 shape 是否在项目内重复。能区分:S6(shape 是项目特征)vs P2(shape 是 framework 普适)
   到底哪个对。

3. **写 user fate annotation 入口** — 把 `code-journal fate add --event <id> --note "..."`
   实现,让你读完 audit 不爽时有地方说。U5 缺口。

### Tier 2 · 中期(1-2 月)· medium effort

4. **超大 session chunked digest** — 4 个最有故事的 senior session 现在看不到,
   是真亏。Chunked / hierarchical 解决。U6 缺口。

5. **第三条 lens (user-driven-pivot-no-fork)** — 验证 S5 是否是稳定 mode。
   如果是,framework 需要扩展。

6. **找 1-2 个真人** — 读你某个 audit cold,看能不能 reconstruct。U2 缺口。
   1 个人 30-60 分钟。

### Tier 3 · 长期(3+ 月)· wait for data

7. **§ 9 predictability dashboard** — 需要 3+ 月 episodes 累积才有意义。

8. **跨 agent stance shape 对比** — 等 codex 和 claude-code 在同一项目都积累几个
   Episode,可以分 agent 渲染 audit,看 stance shape 是不是真的 agent-dependent。

9. **Manager 误用场景反测** — 等产品 stable 之后,在受控环境下故意试一次"如果
   manager 拿到 audit 会发生什么",看 framework 的红线在压力下能不能扛住。

---

## 一句话总评 · One-line

> **框架站住了,但 8 件事还没碰**。code 跑通了,但**只 Episode 1**。
> 真人没读过,future-self 没回来过,fate 没追加过。**好消息是:验证
> 到的部分,验证得很扎实**。

> **Framework holds, but 8 things remain untouched**. Code works, but
> only Episode 1 anywhere. No human has read. No future-self has come
> back. No fate has accrued. **The good news: what got validated was
> validated rigorously**.
