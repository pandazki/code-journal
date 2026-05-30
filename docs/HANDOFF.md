# Handoff — Observation Lens · 接手就开干

> ⚠️ **Historical handoff (pre-v0.2.0).** The feature has since shipped. Start
> from the canonical guide [`docs/observation-lens.md`](observation-lens.md)
> instead; the "next steps" below are partly done (grounding gate, `assented`,
> third lens all landed). Latest record: `experiments/observation-lens-v3-revalidation/`.

> 2026-05-29 · 接手的人 / agent 读这一份,5 分钟内就能知道从哪开始。

## 现在在哪 · State

- 分支 `experiment/observation-lens-v1`,**8 个 commit,未 push**。
- MVP-II 全部 7 个 milestone 已完成,Phase 1+2 + smoke test 跑过。
- 4 个项目本地有 Episode 1 audit(`~/.code-journal/observations/<pid>/episodes/`)。
- **每个项目只有 Episode 1。fate / multi-episode 完全没真实数据测试过**。

## 先读这 3 份 · Read first

1. `docs/observation-lens-record.md` — 全部经历 + 置信度 ledger。**先读这个**。
2. `docs/plans/mvp-ii.md` — 工程设计 + ADR-like 决策(哪些不能反向)。
3. `docs/plans/mvp-ii-operations.md` — 怎么跑 sync / compose / status。

## 从这里开始 · Start here

**Tier 1 第一件:在一个已有 Episode 1 的项目上跑 Episode 2,看 fate tracking 在真实数据上能不能浮出来。**

为什么这个先 —— 零工程,只是 operations;但它是 § 8 命运追踪在真实数据上的**第一次测试**,结果决定后面 fate 模块要不要继续投入。

```sh
# 1. 等几天让任一项目积累新 session(或现在手动跑也行)。建议 code-journal
#    或 pneuma-skills —— 这俩 Episode 1 events 多,fate 信号面大。
node packages/cli/dist/index.js status --project code-journal

# 2. 跑 sync(只扫新 session,旧的会被 dedup)
node packages/cli/dist/index.js sync --project code-journal-7yyrpu --limit 5 --verbose

# 3. 若 new_events_since_last_compose ≥ 10,sync 会自动 compose Episode 2;
#    否则 force:
node packages/cli/dist/index.js compose --project code-journal-7yyrpu

# 4. 打开 Episode 2,看 ## Fate updates 段
cat ~/.code-journal/observations/code-journal-7yyrpu/episodes/2-*.md
```

### 读 Episode 2 时,问自己 3 个问题

1. **Fate updates 段有内容吗?** 如果有,fate 检测在真实数据上 work。
   如果是 "(none surfaced)",看下面第 2 问。
2. **"(none surfaced)" 是因为新 episode 真的没碰到 Episode 1 的 events,
   还是因为我们的 fate 检测 heuristic 太弱?** 手动对比 Episode 1 的
   strict events 跟 Episode 2 的 transcript 内容,判断 ground truth。
3. **M6 quintile shape 跟 Episode 1 像吗?** 如果像 → S6 翻盘(shape 是
   项目特征);如果不像 → P2 / S6 都需要进一步 narrow。

把答案补到 `docs/observation-lens-record.md` 的对应 confidence 列。

## 然后做什么 · Then

按 Tier 1 顺序:

- **跑 3-4 个项目各到 Episode 3**(给 M6 shape 稳定性收集足够样本)。
- **写 `code-journal fate add --event <id> --type reverted --note "..."`** —— 用户读 audit 发现错的入口。schema `FateUpdate.user_note` 已经留位,补一个 CLI handler 即可,小工。

Tier 2 / 3 见 `docs/observation-lens-record.md` § 8。

## 别踩的坑 · Watch out for

1. **超大 session (>2000 turns)** 会撞 model context 上限。MVP-II 不处理,
   sync 会标 failed 然后 retry 下次。**不要去重写**这块——chunked digest 是
   MVP-III 工程,要好好做。
2. **不要把任何 audit 推到 remote / GitHub**。`~/.code-journal/observations/`
   有 verbatim transcript,gitignored 不代表 export 安全。
3. **不要给 audit 加 LLM 二次综合**(自动产 meta-pattern / 跨 episode summary)。
   § 11.4 红线,代码里有 `FORBIDDEN_PHRASES` gate 守着,但**不要绕过它**。
4. **lens prompt 改动要走 `scripts/recharacterize-lens.mjs`**,否则
   `lens_version` 没 bump,新旧事件会用同一个 id 互相覆盖。

## 当前 8 commits

```
1783ba2  docs: complete record
479b107  mvp-ii: production hardening
9716ca5  mvp-ii: implement M1-M7
c3861fd  docs: MVP-II engineering plan
e2d6ee6  experiment: phase 2 battery E1-E7
1bc2dcb  experiment: v2 wrap-up
27599ef  experiment: bilingual phase 1 report
5cfe4d0  experiment: phase 1 cross-project comparison
```

## 一句话

> **从跑 Episode 2 开始,看 fate 能不能自然浮出来。然后回来更新置信度表。**
