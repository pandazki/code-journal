# Experiment v5 · Long-history steering analysis — pneuma-framework

**Date:** 2026-06-22 · **Judges:** run twice — codex lens, then `claude -p` lens
(independent cross-check) — over the same oldest-first window of codex+cc
transcripts · **Scope:** ~57–64 / 210 sessions, oldest-first, 6 chronological
episodes (window 2026-04-28 → 2026-05-11, the early–mid arc of the project)

> **Question under test (architect's felt sense):** pneuma-framework is a complex
> project where a human architect does the top-level design and intervenes
> *strongly* against the LLM's tendency to **regress to consensus** (plausible,
> safe, mean-reverting output). Does the observation-lens data support that?

---

## English report

### Verdict

**Supported — with a concrete mechanism, and honest caveats.** This is a
strongly human-directed collaboration: direction is **injected ~4.5× more often
than it is bare-accepted**, the dominant mode is *unprompted* leading, and the
human repeatedly overrides the AI's "done / good-enough" with specific, scoped
corrections.

### The numbers (65 events across 6 episodes)

Event mix: `strict-negative-space = 5`, `anchored-deferral = 33`,
`user-initiated-pivot = 27`.

- **At AI decision points** (33 deferral anchors): direction **injected 22**
  (engaged 15 + ignored 7) vs **bare-assent 11** → 2:1 active.
- **Outside decision points**: **27 user-initiated pivots** — the single largest
  category. The human injects direction the AI never asked for.
- `overrode = 0`, `deferred = 0` — the human never punts the decision back to the
  AI, and almost never takes the "reject the option, pick another named one" path.
- Net: direction **injected ≈ 49 vs bare-accepted 11 ≈ 4.5 : 1**.

### The mechanism (the most telling part)

The 27 pivots are nearly one template — the human runs their *own* external
review and hands the AI a prioritized punch-list under strict scope:

> *"Spec compliance review found issues. Please fix them in the same workspace and
> commit. **Do not touch unrelated files.** Issues: 1. [P1] …"*
> *"Code quality review found Task 2 fixes needed …"*

This is anti-consensus-regression in its literal form: the AI reports "done" (its
consensus = good enough), the human says *"no — here are the specific gaps, fix
exactly these and nothing else."* The 7 `ignored` stances are the same character:
the AI asks A, the human redirects to their own agenda ("make this a project-level
skill", "commit it to git", "generate the last 10 days of work logs").

### The temporal arc

- **Earliest (Ep1–2, 04-28): pure pivot, zero anchors.** The human directs
  unilaterally before the AI exposes any decision point — maximum imposition.
- **Mature (Ep3, Ep6): anchors appear**, density rising to `M1 = 4.90/100t`. The
  dialogue thickens, but stays injection-leaning (Ep6: 9 injected vs 5 assent) and
  `ignored` rises to 4.
- **Fate**: `reverted` (a localhost placeholder swapped for the real
  tanka-work-report endpoint), `caused_rework`, `user_reframed`, `expanded` — the
  human goes back and *changes/undoes* prior decisions, not just accretes. An
  architect maintaining one design line.

### Caveats (honest)

1. **codex judged codex** — the observer is not independent of the observed agent.
   Direction of bias: an agent that may share the consensus tendency is more
   likely to *under*-count the human's corrections, so this is likely a **lower
   bound**, not an overstatement. A `claude -p` independent rerun is in progress.
2. Stance has ±30% run-to-run variance; single project; the store's first 5
   sessions were scanned by claude (minor mixed-engine confound).
3. `strict` is low (5): the steering is "lead / review from the front" more than
   "yank a specific AI proposal off-axis mid-stream".
4. Only 64/210 sessions (early–mid history); later arc not yet scanned.
5. Bug: fate `evidence_ref` degenerated to `T0` (the `evidence_quote` grounding
   and notes are real — one fate spot-verified against the transcript — but the
   structured ref is useless). Polish item on the codex output path.

### Bonus methodological result

This long history **validated the fate detector's recall on real data** — the gap
v4 could only fill with a synthetic positive. 16 real fate updates surfaced across
episodes; one (`reverted`, the tanka endpoint swap) was spot-verified against the
transcript. **Lengthening the history is itself the precondition for fate to
appear** — the same thread as the disjoint-episode fix and the detector.

---

## 中文报告

### 结论

**支持——并给出了具体机制,附诚实 caveat。** 这是一场被人类强力定向的协作:
方向的**注入对裸顺从约 4.5:1**,主模式是"不等 AI 问就主动领",并且人类反复用
具体、限定 scope 的纠正去推翻 AI 的"完成 / 够好了"。

### 量化(6 episode 共 65 events)

事件构成:`strict-negative-space = 5`、`anchored-deferral = 33`、
`user-initiated-pivot = 27`。

- **AI 决策点上**(33 个 deferral anchor):方向**注入 22**(engaged 15 + ignored 7)
  vs **裸批准 11** → 2:1 主动。
- **决策点之外**:**27 个 user-initiated-pivot**,单类最大——人类注入 AI 从没问过的方向。
- `overrode = 0`、`deferred = 0`:人类**从不把决定踢回给 AI**,也几乎不走
  "否决选项再选另一个"那条路。
- 合计:方向**注入 ≈ 49 vs 裸接受 11 ≈ 4.5 : 1**。

### 机制(最有说服力)

那 27 个 pivot 几乎是同一个模板——人类跑自己的外部 review,把带优先级的 punch-list
在严格 scope 下甩给 AI:

> *"Spec compliance review found issues … **Do not touch unrelated files.**
> Issues: 1. [P1] …"*
> *"Code quality review found Task 2 fixes needed …"*

这是"对抗向共识回归"的字面形态:AI 报"完成"(它的共识=够好),人类说**"不,这里有
具体缺口,只修这些、别碰别的"**。那 7 个 `ignored` 是同一性格:AI 问 A,人类直接转向
自己的议程("把它做成 project 级 skill"、"提交到 git"、"生成过去 10 天 worklog")。

### 时间弧线

- **最早(Ep1–2,04-28):纯 pivot,0 anchor。** 人类在 AI 暴露任何决策点之前就单方面
  定向——最强的"按住设计"。
- **成熟期(Ep3、Ep6):anchor 出现**,密度升到 `M1 = 4.90/100t`。对话变密,但仍注入
  主导(Ep6:注入 9 vs 裸批准 5),`ignored` 升到 4。
- **fate**:`reverted`(把 localhost 占位换成真的 tanka-work-report endpoint)、
  `caused_rework`、`user_reframed`、`expanded`——人类**回头改/推翻**早期决策,不是只往上
  堆。架构师在维护一条贯穿的设计线。

### 诚实的 caveat

1. **codex 评判了 codex**——观察者不独立于被观察的 agent。偏差方向:自带共识倾向的 agent
   更可能**漏报**人类的纠偏,所以这大概率是**下界**而非高估。`claude -p` 独立复跑进行中。
2. stance 有 ±30% run-to-run 方差;单项目;store 前 5 session 是 claude 扫的(轻微混引擎)。
3. `strict` 低(5):转向更多是"从前面领 / 审查",而非"中途把 AI 的具体提案拽偏轴"。
4. 只覆盖 64/210(早中期);后期弧线还没扫。
5. bug:fate 的 `evidence_ref` 退化成 `T0`(`evidence_quote` 接地与 note 是真的——抽查 1 条
   对得上 transcript——但结构化 ref 没用)。codex 输出路径的待 polish 项。

### 意外的方法论收获

这条长历史**验证了 fate 检测器在真实数据上的 recall**——v4 只能用合成正例填的那个缺口。
跨 episode 浮出 16 条真实 fate,抽查 1 条(`reverted`,tanka endpoint 替换)对得上 transcript。
**"把历史拉长"本身就是 fate 能浮现的前提**——和 disjoint 修复、检测器是同一条线。

---

## Independent rerun (`claude -p`) — cross-judge check / 独立复跑交叉验证

The codex run had codex judging codex's own transcripts — not an independent
observer. To check, the **same oldest-first window was rescanned with the
`claude -p` lens engine** (default, the more-validated judge; a clean reset
first). Falsifiable prediction stated beforehand: an independent judge should
show *equal or stronger* injection-dominance — if it came back much weaker, the
conclusion would be in doubt.

> codex judge 是用 codex 评判 codex 自己的 transcript,观察者不独立。于是用
> **`claude -p` 引擎对同一最老窗口重扫**(默认、验证更充分的 judge;先做了干净
> reset)。事先给的可证伪预测:独立 judge 应显示*相等或更强*的注入主导;若明显
> 更弱,则结论存疑。

**Overall — holds.** Injection-dominance survives the independent judge:

| judge | sessions | events | ALL inject : assent |
|-------|----------|--------|---------------------|
| codex | 64 | 65 | 49 : 11 ≈ **4.5 : 1** |
| claude (independent) | 57 | 47 | 31 : 8 ≈ **3.9 : 1** |

**Per authoring agent — the contrast *sharpens* under the independent judge:**

| authoring agent | judge | strict / deferral / pivot | stance e/a/d/o/i | inject(anchored+pivot) : assent |
|-----------------|-------|---------------------------|------------------|--------------------------------|
| **codex** (foundational) | codex | 1 / 16 / 23 | 7/5/0/0/4 | 34 : 5 ≈ 6.8 : 1 |
| **codex** | **claude** | 1 / **0** / 18 | 0/0/0/0/0 | 18 : 0 ≈ **18 : 1** |
| **claude-code** (later) | codex | 4 / 17 / 4 | 8/6/0/0/3 | 15 : 6 ≈ 2.5 : 1 |
| **claude-code** | **claude** | 7 / 17 / 4 | 4/8/0/1/4 | 13 : 8 ≈ **1.6 : 1** |

The independent judge reads the **codex** collaboration as *near-pure human
imposition* — 18 unprompted pivots, **zero** exposed decision points — while
reading the **claude-code** collaboration as genuinely *dialogic* (anchors,
assent, engaged shaping). Prediction confirmed: the codex-as-judge run had
**under**-counted how hard the human was steering codex (6.8:1 → 18:1).

> 独立 judge 把 **codex** 协作读成*近乎纯人类强加*——18 个不请自来的 pivot、**0**
> 个决策点;把 **claude-code** 协作读成真正的*对话式*(有 anchor、assent、engaged
> 塑造)。预测应验:codex 当 judge 时**低估**了人类对 codex 的转向强度(6.8:1 → 18:1)。

**Honest read of the 18:1.** Roughly half of that extreme ratio is *agent style*,
not just human intensity: codex exposes ~**0** decision points (it executes and
reports "done", rarely asks), so the human's only channel is the unprompted pivot
— there is no anchor to assent to. This is exactly the ledger's F5 ("anchor
density is an agent feature, not a user property"). The clean, robust measure is
therefore the **pivot count itself — 18 unprompted course-corrections of codex's
"done"** — which is high under both judges. claude-code asks more (deferral 17),
so its steering flows through engaged responses instead.

> **对 18:1 的诚实拆解**:这个极端比值约一半是 *agent 风格*而非纯人类强度——codex
> 暴露 ~**0** 决策点(执行完报 "done"、很少问),人类唯一的通道就是不请自来的 pivot,
> 根本没有 anchor 可 assent(对应 ledger F5:"anchor 密度是 agent 特征,不是用户属性")。
> 所以干净、稳健的度量是 **pivot 计数本身——18 次对 codex "完成"的不请自来纠偏**,两个
> judge 下都高。claude-code 问得多(deferral 17),转向就走 engaged 回应。

**Fate is engine-sensitive.** codex surfaced 16 fate updates, claude only 1 — but
both independently surfaced the **same thread** (the tanka-work-report remote
endpoint: codex labeled it `reverted`, claude `expanded`), a cross-judge true
positive. claude (more conservative / validated default) is the higher-precision
reading; codex over-produced, consistent with the `evidence_ref` degenerating to
`T0` — a bug that appears under *both* engines, so it's a prompt/parsing issue,
not codex-specific. Net: **fate recall on real long history is confirmed (it does
surface), but the count is not trustworthy until the `evidence_ref` grounding is
fixed.**

> **fate 对引擎敏感**:codex 浮出 16 条、claude 只 1 条,但两者独立地浮出了**同一条
> 线**(tanka-work-report remote endpoint:codex 标 `reverted`、claude 标 `expanded`),
> 是跨 judge 的真阳。claude(更保守 / 验证过的默认)是更高精度的读数;codex 偏多产,
> 和 `evidence_ref` 退化成 `T0` 一致——这个 bug 在*两个*引擎下都出现,所以是 prompt/解析
> 问题而非 codex 特有。结论:**真实长历史上 fate recall 成立(确实能浮现),但在修好
> `evidence_ref` 接地前,数量不可信。**

**Caveat:** the two runs are not byte-identical data — claude scanned 57 sessions
vs codex's 64 (a few sessions failed under one engine), so treat the head-to-head
as same-window, not same-rows. The per-agent *ratios* are the robust comparison,
not the absolute counts. / **Caveat**:两轮不是逐行同一数据——claude 扫 57、codex 扫
64(有少数 session 在某引擎下失败),所以这是同窗口对比而非同行对比;稳健的是 per-agent
*比例*,不是绝对计数。

## Per-episode detail (codex run)

| Ep | window | strict | deferral | pivot | stance (e/a/d/o/i) | M1 /100t | M6 quintiles |
|----|--------|--------|----------|-------|--------------------|----------|--------------|
| 1 | 04-28 | 0 | 0 | 6 | 0/0/0/0/0 | 0.00 | [0,0,0,0,0] |
| 2 | 04-28 | 0 | 0 | 4 | 0/0/0/0/0 | 0.00 | [0,0,0,0,0] |
| 3 | 04-28→05-07 | 4 | 11 | 1 | 4/5/0/0/2 | 2.86 | [2,2,3,1,3] |
| 4 | 05-09 | 0 | 6 | 3 | 4/1/0/0/1 | 1.74 | [4,1,0,0,1] |
| 5 | 05-10→05-11 | 0 | 2 | 8 | 2/0/0/0/0 | 0.23 | [1,0,1,0,0] |
| 6 | 05-11 | 1 | 14 | 5 | 5/5/0/0/4 | 4.90 | [4,3,4,1,2] |

**Done:** independent `claude -p` rerun confirmed the steering signal (see
cross-judge section) — overall ~4:1 injection holds, the codex-phase contrast
*sharpens* to 18:1, both judges converged on one true-positive fate. **Open:**
(1) fix the fate `evidence_ref` grounding before trusting fate *counts*;
(2) optionally scan the remaining ~150 sessions to see whether the steering
intensity shifts as the project matured past this early–mid window.
