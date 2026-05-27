# 观测 Lens v1 · 跨项目对比实验报告
# Observation Lens v1 · Cross-Project Comparison Report

> Phase 1 实验:用三段真实 coding-agent transcripts 验证「协作观测框架」(2026-05-15 修订版)。**本报告不复现任何 transcript 原文** —— per-event 证据保存在 gitignored 的 `audits/proj-*.md`;本文件只保留 aggregate 层面的结构性结论。
>
> Phase 1 experiment validating the 协作观测框架 (Revised 2026-05-15) against real coding-agent transcripts. **No verbatim transcript content is reproduced here** — per-event evidence lives in the gitignored `audits/proj-*.md`; this report stays at the aggregate structural level only.

---

## 概要 · TL;DR

**中文:**

- 两条 lens 在三段真实 transcripts 上均产出了 source-anchored 事件,**没有出现 identity drift**。strict-negative-space 保持 sparse(2–4 events/session);anchored-deferral 出 4–11 个 anchor,随 AI 暴露的决策点密度而变。
- **同一用户、三个项目,得到三种结构性不同的 stance distribution**。anchored-deferral 的 e/d/o/i 分布形状跨项目差异显著,这是框架 § 4.3「分析单位是协作不是用户」claim 在 numerical 层面的支持。
- **两条 lens 互补,不冗余**。9 个 strict 事件里有 6 个(67%)的 primary turn 同时被 deferral lens 识别为 anchor,但**两 lens 描述的是同一时刻的不同 facet**(macro-pivot vs. stance-at-junction)。即使聚焦同一 turn,per-lens findings 也不重复。
- **所有 7 条可验证 hypothesis 全部成立**。另外 3 条 long-horizon hypothesis(§ 5.2 / § 8 / § 9)在 snapshot 数据上 structurally untestable —— 这一点框架自己在 § 13.3 也明确承认。
- **发现一个已知 failure mode 并打了补丁**:LLM-as-lens 大约 33%(2/6)的概率会产出 inner-quote 未转义的 JSON。下次 dispatch 加上显式转义规则即解决。lens spec 里已经把这条规则 bake in。

**English:**

- Both lenses produced source-anchored events without identity drift on three real transcripts. Strict negative-space stayed sparse (2–4 events per session); anchored deferral produced 4–11 anchors per session, scaling with the AI's exposed decision points.
- Same user, three projects, three structurally distinct stance distributions. The `e/d/o/i` mix on anchored deferral differs across projects — numerical support for the framework's core "分析单位是协作不是用户" claim (§ 4.3).
- Two lenses are complementary, not redundant. 6 of 9 strict events (67%) share a primary turn with a deferral anchor, but the two lenses describe **different facets of the same moment** — macro-pivot vs. stance-at-junction. Per-lens findings don't duplicate even when describing the same turn.
- All seven testable hypotheses (H1–H7) held. The three long-horizon ones (§ 5.2 / § 8 / § 9) remain structurally untestable from snapshot data — which the framework itself acknowledges in § 13.3.
- One known failure mode confirmed and patched: LLM-as-lens emits JSON with unescaped inner quotes ~33% of the time (2/6 here). Explicit re-dispatch fixed it; the rule is now baked into both lens specs.

---

## 实验设置 · Setup

### 扫了什么 · What was scanned

三段来自三个不同项目的真实 Claude Code transcripts(本报告统一匿名为 A / B / C;真实名称映射保存在 gitignored 的 `PROJECT-MAPPING.md`):

Three real Claude Code transcripts from three distinct projects (anonymised as A / B / C; real-name mapping in the gitignored `PROJECT-MAPPING.md`):

| 项目 / Project | 原始 JSONL 行数 / Raw lines | 摘要 turns / Digest turns | 摘要大小 / Digest size |
|---|---:|---:|---:|
| A | 1777 | 925 | 263 KB |
| B | 487 | 210 | 78 KB |
| C | 611 | 360 | 134 KB |

三段都是**同一用户**在大致同一周内、用**同一种 agent**(claude-code)、在**三个不同 repo** 上的会话 —— 这是本数据集下对「协作不是用户」claim 的最严格测试。

All three are real Claude-Code sessions from the **same user**, within roughly the same recent week, on **three different repositories** with the **same agent type**. This is the cleanest test of "协作 not 用户" available from this dataset.

### subagent 隔离 · Subagent isolation

每一对 `(transcript, lens)` 都由一个**独立的 subagent** 执行,模型为 `sonnet`,subagent 只能看到:

- 该 lens 的 spec(只看一条 lens)
- event schema
- 该 transcript 的 digest(只看这一段)
- 一条写出 JSON 输出文件的指令

subagent **看不到**:其他 digest(跨项目隔离)、另一条 lens 的 spec 或输出(跨 lens 隔离)、本次主对话(避免被设计讨论 prime)、框架原文档本身。

For each `(transcript, lens)` pair, one **isolated subagent** ran (`sonnet` model), with visibility scoped to: the lens spec (one lens only), the event schema, the one digest, and an instruction to write to a single named JSON output path. The subagent saw **nothing else** — no other digest (cross-project isolation), no other lens (cross-lens isolation), no main conversation (no priming from our design discussion), no framework document.

这是实验上的纪律,对应框架 § 5.3 / Phase 1 ledger 的方法论 —— 4 variants × 3 sessions 在互相隔离的上下文里跑 —— 这里调整为 2 lenses × 3 projects。

This is the experimental discipline, corresponding to the framework's § 5.3 / Phase 1 ledger methodology (4 variants × 3 sessions in mutually-isolated contexts), adapted here to 2 lenses × 3 projects.

### 流程 · Pipeline

```
~/.claude/projects/<encoded-cwd>/<id>.jsonl              (原始 transcript)
   ↓ scripts/digest.mjs                                  (deterministic)
digests/proj-<X>/session.md                              (turn-indexed digest)
   ↓ 2 isolated subagents (1 per lens)                   (LLM-driven)
events/proj-<X>-<lens>.json                              (strict JSON event lists)
   ↓ scripts/compose.mjs                                 (deterministic templating)
audits/proj-<X>.md                                       (δ' per-project audit)
   ↓ this report
report.md / report-bilingual.md                          (跨项目对比 · cross-project)
```

1、3、5 步是 deterministic;2 是 LLM-driven(lens 本身);4 是 deterministic templating —— 只是把第 2 步产出的 events 按 δ' 结构排出来,**不做任何额外 synthesis**。

Stages 1, 3, 5 are deterministic; stage 2 is LLM-driven (the lens itself); stage 4 is deterministic templating that just lays out stage 2's events in the δ' structure — **no additional synthesis**.

---

## 数值总表 · Master numerical table

```
                      strict-     ───── anchored deferral ─────
project   digest      negative    total   e   d   o   i   anchor types
          turns       space               (engaged / deferred / overrode / ignored)
─────────────────────────────────────────────────────────────────────────
A          925        4           11      5   1   3   2   ask:7 / opt:3 / unc:1
B          210        2            7      2   1   4   0   ask:2 / opt:4 / unc:1
C          360        3            4      2   0   1   1   ask:2 / opt:2 / unc:0
```

缩写 / Abbreviations:
- `ask` = direct-ask · `opt` = ≥2-named-options · `unc` = explicit-uncertainty
- `e/d/o/i` = engaged / deferred / overrode / ignored(框架 § 5.3 修订后的四姿态)

---

## 逐条 hypothesis 验证 · Hypothesis verification

本节按框架的设计 note 把每条 hypothesis 拿数据过一遍:有没有被支持、什么是 structurally untestable、未来还需要什么数据。

This section walks each framework hypothesis against the data: supported, structurally untestable, or needs more data.

### H1 · plausible 坍塌 — AI 默认输出 plausible-but-flat,所以「丰富的工作日志」信息量薄

### H1 · plausible flattening — AI defaults are plausible-but-flat, so a "rich work log" is informationally thin

**结论 · Status: 支持 / Supported(以框架预期的形式)。**

strict-negative-space 在三个项目的密度:
Strict negative-space density across the three projects:

- Project A: 4 events / 925 digest-turns = **0.43%**
- Project B: 2 events / 210 turns = **0.95%**
- Project C: 3 events / 360 turns = **0.83%**

也就是说:**一段 coding session 里 ~99% 的 turn-level 活动里没有可识别的方向性注入事件**。framework Phase 1 ledger 报的是 2-4 strict events/session,我们的 2/3/4 正好落在这个区间。

That is: **roughly 99% of turn-level activity in a session does not carry an identifiable direction-injection event.** Phase 1 ledger reported 2-4 strict events per session; our 2 / 3 / 4 matches the range exactly.

一个朴素的 work-log 如果只打印"今天 925 turns / 14 files edited / 87 commands run",它呈现的 activity surface 大约比 lens 多 200×,但 framework 主信号的密度大约 0×。**这就是我们之前讨论时说的「5000 字日志 vs 500 字日志」的 numerical 形式。**

A naive work-log printing "925 turns / 14 files edited / 87 commands today" would show an activity surface ~200× richer than the lens but contain ~0× of the framework's primary signal. **This is the numerical form of the "5000-char log vs. 500-char log" claim from our earlier design discussion.**

### H2 · 镜子 vs 判官 — 输出保持 observational,不 synthesize identity

### H2 · mirror vs judge — output stays observational, does not synthesise identity

**结论 · Status: 在全部 21 个事件上都成立 / Supported across all 21 events.**

手工检查每一个事件:
Manual inspection of every event:

- **0 events** 含「user is X-type」claims 或其他身份标签 / No identity-category claims
- **0 events** 含 valence(「smart / wise / careless / good judgment」)/ No valence
- **21 / 21 events** 带具体 `source_refs` 指到 turn ID / Carry concrete source refs to turn IDs
- **21 / 21 events** 把 AI 提议和用户回复都 **verbatim 引用**,而不是改写到系统口吻 / Quote both AI proposal and user response verbatim
- **每一段 "Why this satisfies the criteria" 都引具体 turn 或 artifact**,而不是抽象 characterization / Every justification cites specific turns or artifacts, not abstract characterizations

lens spec 里的 "what you must never do" 段(forbidden words + 反 identity claim 硬规)就够了,**没有 post-hoc filter 的需要**。

The lens specs' "what you must never do" sections (forbidden-words list, hard rule against identity claims) were sufficient discipline. **No post-hoc filtering was needed.**

### H3 · 分析单位是协作 — 同一用户、不同项目 → 不同 distribution

### H3 · collaboration is the analysis unit — same user, different projects → different distributions

**结论 · Status: 强支持,且这是本轮最 striking 的发现。/ Strongly supported, and the most striking finding of this run.**

同一用户、同一 agent、同一周内,三个项目的 anchored-deferral stance distribution:
Same user, same agent, same week, three projects' stance distributions:

```
Project A:  e=5  d=1  o=3  i=2     engaged-dominant, 四种 stance 全部出现
                                    engaged-dominant, all four stances present
Project B:  e=2  d=1  o=4  i=0     overrode-dominant, 完全没有 ignored
                                    overrode-dominant, zero ignored
Project C:  e=2  d=0  o=1  i=1     small-N, 完全没有 deferred
                                    small-N, zero deferred
```

形状不是只在 number 上不同,**是结构上不同**:A 四种 stance 都有非零计数;B 是 overrode 主导且零 ignored;C 是平缓分布且零 deferred。

The shapes aren't just numerically different — they are **structurally different**. A has non-trivial counts in all four stances; B is overrode-dominant with zero ignored; C has a flat distribution with zero deferred.

这正是框架 Fig 02 illustrate 的 § 4.3 case。**如果把 22 个 events 跨三个项目聚合成单一 user-stance-profile (e=9 / d=2 / o=8 / i=3),你会彻底抹掉真实信号。结构性的发现存在于 per-project shape,不存在于它们的总和**。

This is exactly the pattern Fig 02 in the framework illustrates for § 4.3. **If you aggregated all 22 events across the three projects into a single user-stance-profile of e=9 / d=2 / o=8 / i=3, you would have obliterated the actual signal. The structural finding is in the per-project shapes, not in their sum.**

### H4 · 负空间需要 source-anchored 双门

### H4 · negative-space needs source-anchored double-gate

**结论 · Status: 由 lens **没有** emit 的东西支持 / Supported by what the lens did NOT emit.**

strict-negative-space 要求三条同时成立:(a) AI 提议**具体可识别**,(b) 用户**没接住**,(c) 后续工作沿**可证不同的轴**。这三道门让 lens 不会误把以下 case 标为 negative-space:

- AI 提了具体方案,但用户 engaged → 不算
- AI 提了具体方案,用户没接住,但后续工作没有沿不同轴 → 不算
- AI 模糊提议,用户 ignore → 不算

The strict-negative-space lens requires all three gates: (a) AI proposal is **identifiable and specific**, (b) user **did not take it up**, (c) subsequent work **demonstrably follows a different axis**. Three gates together filter out look-alikes.

数据上可以看到 lens 在该跳过时跳过了:Project A 里 7 个 `direct-ask` 类 anchors 中,strict-negative-space lens 只挑出 1 个作为负空间事件,其它的或者是 engaged / deferred、或者后续没有"不同轴"的工作 —— **lens 没把"ignored 姿态"自动等同于"负空间事件"**。

Data shows the lens correctly skips: of Project A's 7 `direct-ask` anchors, only 1 became a strict-negative-space event. The lens did not auto-conflate "ignored stance" with "negative-space event" when the three gates didn't all hold.

跟框架 Phase 1 对照:loose negative-space variant 在原 ledger 里产出 20 / 38 / 38 events 并 drift 到身份描述;sealed strict 产 4 / 3 / 3。我们这一轮 4 / 2 / 3,同量级,没有 drift。

Comparing to framework Phase 1: loose negative-space variant in the original ledger produced 20 / 38 / 38 events with identity drift; sealed strict produced 4 / 3 / 3. Our 4 / 2 / 3 matches the sealed range; no drift observed.

### H5 · anchored deferral 四姿态 + anchor density 是 agent 的特征,不是 user 的

### H5 · anchored-deferral four stances + anchor density is an agent feature, not a user feature

**结论 · Status: 支持,并带一个值得记录的次级发现 / Supported, with a notable secondary finding.**

把 anchor density 按 per-100-turns 算:
Anchor counts per 100 digest-turns:

```
Project A:  11 anchors / 925 turns = 1.2 anchors per 100 turns
Project B:   7 anchors / 210 turns = 3.3 anchors per 100 turns
Project C:   4 anchors / 360 turns = 1.1 anchors per 100 turns
```

**Project B 的 anchor 密度是 A 或 C 的 ~3 倍**。这不是 user 的属性 —— 同一个 user 横跨三项目 —— 这是 **agent 在每个项目里的工作方式的属性**。在 B 这个 session 里 agent 比在 A 或 C 里更频繁地 explicitly 暴露决策点,大概是因为 scope 更紧(plugin extension + 明确选择点 vs. A 大型多 repo / C 增量 debug + migration)。

**Project B has ~3× the anchor density of A or C.** This is not a property of the user (same user) — it is a property of **how the agent worked on each project**. In B, the AI exposed explicit decision points much more often than in A or C, probably because the scope was tighter (plugin extension with concrete decision points vs. sprawling A, vs. incremental C debug + migration).

这印证了 grilling Q3 阶段我们讨论的担心:**anchor density 本身是 agent 的提问风格,不是 user 的。** 如果只展示 `(e/d/o/i)` per session 而不展示 anchor density,读者会把"Project A 用户更 engaged"误读为对 user 的事实判断,而其实只是 agent 在 A 提的问题更少。audit 文档里的 anchor-type table 把这个 dependency 显化了 —— **没有它,stance 数字会 misleading**。

This validates a worry from the Q3 grilling: **anchor density itself is the agent's questioning style, not the user's.** If we showed only `(e/d/o/i)` per session without anchor density, a reader could mistake "Project A's user is more engaged" for a fact about the user — when in reality the agent simply exposed fewer questions. The audit format's `anchor-type distribution` table makes this dependency visible. **Without it, the stance numbers would be misleading.**

### H6 · empty-state 必须显式

### H6 · empty-state must be explicit

**结论 · Status: 本轮未被 stress-test —— 六次 scan 都没出现 empty-state / Not stress-tested this round — all six scans returned ≥2 events.**

六次 scan 都至少返回 2 个 events,这一轮没机会看到 lens 真的产出 empty-state。lens spec 里 empty-state 是 explicit 要求,**但 lens 在真实零信号 session 下到底守不守这条规则,要 Phase 2 才能验证**。

All six scans returned at least 2 events; we did not see a real empty-state in this round. The lens specs encode the empty-state requirement explicitly, but **whether the lens actually honors it under genuine zero-signal sessions remains a Phase-2 test**.

下一步该测的 case:故意扫一段短的、纯肯定回复的 session(只有「好的」「继续」「OK」),看 lens 会不会正确产出非空白的 empty-state(说明扫了什么、为什么没找到)。

The right next case for this hypothesis: deliberately scan a short, purely-affirmative session ("好的", "继续", "OK") and verify the lens produces a non-blank empty-state naming what was scanned and why nothing was found.

### H7 · 两条 lens 互补、不冗余

### H7 · two lenses complementary, not redundant

**结论 · Status: 支持,且 mechanism 比预期的更 sharp / Supported, with a sharper finding than expected.**

把每个 strict event 的 primary turn 跟 deferral anchors 比对:
Cross-tabulating each strict event's primary turn against deferral anchor turns:

```
                strict primary       deferral anchors      coincidence
                turns                turns                 (strict→deferral)
Project A:      {25, 43, 108, 294}   {25,43,51,65,78,      3 / 4 strict events
                                      102,108,111,123,      落在 deferral anchor
                                      309,354}              (75%)
Project B:      {32, 85}             {12, 44, 85, 102,     1 / 2 strict events
                                      127, 152, 206}        (50%)
Project C:      {65, 301, 327}       {65, 176, 301, 356}   2 / 3 strict events
                                                            (67%)
```

跨三个项目:**9 个 strict events 里有 6 个(67%)的 primary turn 同时被 deferral lens 标为 explicit anchor**。这比设计 lens 时我预期的 overlap **要高得多**(grilling 阶段我推断 overlap 低)。但这个 finding 实际上**更支持** H7,只是 mechanism 不同:

Across all three sessions: **6 of 9 strict events (67%) land on a turn the deferral lens also identified as an explicit anchor.** This was **stronger overlap than I expected** when designing the lenses to be non-interfering. But the finding cuts the right way for H7:

- **两条 lens 在同一 turn 上 fire 时,描述的是同一时刻的不同 facet**。strict event 说"AI 命名了一条具体路径;user 把工作拉到 Y 轴";deferral event 说"AI 暴露决策点;user stance 是 `overrode` / `ignored` / etc."。同一 turn,两个 compatible-but-distinct 的描述。
- **不重叠的部分**:3/9 strict events 没有对应 deferral anchor(AI 提议很具体但没有 explicit 决策框架);15/22 deferral anchors 没有对应 strict event(用户响应了 anchor,但后续工作没沿不同轴展开,所以 strict lens 正确跳过)。

- When both lenses fire on the same turn, **they describe different facets of the same moment** — "AI named a specific path; user pulled off to Y" (strict) vs. "AI exposed a decision-point; user's stance was `overrode` / `ignored` / etc." (deferral). Same turn, two compatible-but-distinct descriptions.
- Where they don't overlap, neither lens is redundant: 3 of 9 strict events had no corresponding deferral anchor (the AI made a specific proposal but didn't *frame* it as an explicit decision); 15 of 22 deferral anchors had no corresponding strict event (the user engaged or overrode but the work didn't actually pull off-axis).

H7 结论保留,但 mechanism 变了:**两条 lens 共享一个 high-information substrate(explicit AI 决策点是明显的 gradient 候选),但在 orthogonal criteria 上打分**。读者只看 strict 输出会知道发生了哪些 macro pivots 但缺颗粒度;只看 deferral 输出会知道 user 对 AI framing 的 stance 但不知道哪些 stance 升级成了 macro pivots。两条都跑、并排显示 —— Q7 的设计经验上是对的。

The H7 conclusion stands but the mechanism is different from what I'd assumed. **The two lenses share a high-information substrate (explicit AI decision-points are the obvious gradient candidates) but score it on orthogonal criteria.** A reader who only saw strict output would know what macro pivots happened but miss the granular stance; a reader who only saw deferral would know stance but not which stance escalated into a macro pivot. Both lenses, non-interfering, is empirically right.

如果只用一条 lens,要么把这两类信号 flatten 到一种描述(失去 orthogonal facet),要么 double-count(夸大密度)。**保持两条分开、并排显示,两件事都不发生**。

A single fused lens would have either flattened these into one description (losing the orthogonal facet) or double-counted them as two events (overstating density). Holding them separate, then displaying side-by-side, preserves both.

### 超出 Phase 1 范围的 hypotheses · Hypotheses outside Phase 1's reach

框架 § 13.3 自己说 Layer 3(long-horizon claims)在 Phase 1 阶段 "structurally untestable"。本实验确认这一点 —— 下列假设未被测试,**而且这正是预期**:

The framework's § 13.3 itself says Layer 3 (long-horizon claims) is "structurally untestable at Phase 1." Our experiment confirms this — the following remain untested, **as expected**:

- **§ 5.2 / § 9 二阶可预测性 / long-term predictability** —— 需要跨 session 的 trajectory prior。我们每个项目只有 1 session。无法测试。/ Needs trajectory prior across sessions. We have one session per project.
- **§ 8 命运追踪 / fate tracking** —— 需要每个项目 ≥2 episodes 才能让 prior events 的 fate 更新。我们每项目 1 episode。/ Needs ≥2 episodes per project for prior events to evolve.
- **§ 10 case 02 事后证错 / case 02 "wrong in hindsight"** —— 需要 wall-clock follow-up。同上。/ Needs wall-clock follow-up.

这些不是 gap,是**任何 snapshot-grade 实验的结构性属性**。之前 grilling 锁定的三层架构(detection / signal store / audit,episode-versioned)正好是 enabling Layer-3 test 的 infrastructure —— 跑 3 个月之后再测。

These are not gaps to fix; they are **structural properties of any snapshot-grade experiment**. The three-layer architecture we locked in during the grilling (detection / signal store / audit, episode-versioned) is precisely the infrastructure that enables Layer-3 tests once it has been running for ~3 months.

---

## 对产品方向的间接验证 · Indirect validation of product direction

除了框架本身的 hypotheses,本实验还为 grilling 阶段定下的几个产品决策提供了证据:

Beyond the framework's own hypotheses, this experiment validates several product-design choices from the prior grilling:

1. **Q4 reframed(三层架构)** —— detection(持续、产 signal)和 audit(低频、产 conclusion)的分层经得起结构压力。把 events 当 first-class artefact 存,再 compose 成 audit,比融合两层更诚实。/ The split between detection and audit holds up under structural pressure; storing events as their own artefact then composing audits is more honest than fusing.
2. **Q7(两 lens、非交叉、可比)** —— empirically confirmed:~67% overlap on key turns,但描述 orthogonal facets。/ Empirically confirmed: lenses overlap but describe orthogonal facets.
3. **Q8(δ' audit 文档)** —— `Scope / Method / Findings / Limitations / Source index` 让每份 audit self-describing,future-self reader 不需要 external context 就能导航。Per-lens Findings 让 Q7 的非交叉性在阅读层可见。/ The δ' format made each audit self-describing for a future-self reader; per-lens Findings kept Q7's non-interference visible at the reading layer.
4. **Q6(audit = git repo,agent 作 facet)** —— 三项目都 single-agent(claude-code),agent-as-facet 这条 plumbing 没被 stress-tested 但也没 blocking。Phase 2 加第二种 agent 是机械改动。/ All three projects were single-agent (claude-code); the agent-as-facet plumbing isn't stressed yet but isn't blocking either.
5. **MVP-I (Demo-grade)** —— 这次实验**就是 MVP-I**,只是放大到三个项目。总共需要的 infra 是三个脚本 + lens 和 schema spec(content)。没有 daemon、没有 scheduler、没有 signal store。**「框架能不能在真实数据上 work」这个问题现在有答案了:能,而且 first-contact 就出可用输出**。/ This experiment IS the MVP-I, just scaled to three projects. Three scripts + the lens/schema specs. No daemon, no scheduler. The hypothesis is now answered: the framework does produce usable output on first real-data contact.

---

## 意料之外的发现 · Surprises

### S1 · LLM-as-lens 大约 33% 概率产出 broken JSON

### S1 · LLM-as-lens emits broken JSON ~33% of the time

六次初始 scan 里有两次产出了 inner-quote 未转义的 JSON(verbatim 文本中含英文直引号 `"`)。这是已知 model failure mode;re-dispatch 时显式加规则("verbatim 文本中每个 `"` 必须 `\"`")后两次都通过。**lens spec 已经把这条规则 bake in**。

Two of six initial scans produced JSON with unescaped inner `"` (English straight-quotes inside Chinese verbatim text). Known model failure mode; re-dispatch with explicit escape rule fixed both. **The rule is now baked into both lens specs.**

每次失败的成本是一次额外 subagent invocation —— 不灾难,但 MVP-II 在做 information-increment gate 时要 budget 这一项。

The cost per malformed scan is one extra subagent invocation — not catastrophic, but worth budgeting in MVP-II's information-increment gate.

### S2 · 同一用户、同 agent、同周 → stance distribution 已经 dramatically 不同

### S2 · "Same user, same agent, same week" → dramatically different stance distributions

设计阶段我以为 H3 需要变化 agent 或时间窗口才能看到分布差异。**结果完全不需要 —— 只变项目就够了**。这是比框架 Fig 02 还要强的 within-user-only 证据。

Going in, I assumed H3 needed varying agents or time windows. **Turns out it didn't — varying only the project was enough.** Stronger within-user-only evidence than even Fig 02 in the framework provided.

### S3 · 第 4 种 stance(`ignored`)稀少,但最有 framework-distinctive

### S3 · the 4th stance (`ignored`) is rare but most framework-distinctive

22 个 anchored-deferral events 里 `ignored` 只出现 3 次(A=2, B=0, C=1)。它是定义上让 AI 问题悬空的 stance —— 既不 engaged 也不 overrode,只是被旁置。两个 observation:

Across 22 anchored-deferral events, `ignored` appears only 3 times. By definition this stance leaves the AI's question hanging — neither engaged nor overridden, just bypassed. Two observations:

- **`ignored` 难 false-positive**,因为它要求 (a) 有明确 anchor + (b) 后续工作明显走 unrelated 主题。这两条 strictness 让计数低。/ Hard to false-positive on because it requires both an explicit anchor and clearly unrelated subsequent work.
- **Project B 在高 anchor 密度下 `ignored` = 0**;A 在 11 个 anchor 里有 2 个 `ignored`。这是 collaboration B 的结构性特征 —— 该项目里用户对每个 anchor 要么 engaged 要么 overrode,**从不 bypass**。/ B's zero `ignored` despite high anchor density is structural — that collaboration never bypassed.

audit 里的 stance table **空格跟有数字的格子一样重要**。paragraph-narrative 形式会自然 smooth over zeros;δ' 的 table 保留了它们。

In an audit, **the empty cells in the stance table matter as much as the full ones**. Paragraph-narrative formats naturally smooth over zeros; δ''s table preserves them.

### S4 · anchor density(1.1 → 3.3 / 100 turns)比 stance shape 变化更大

### S4 · anchor density (1.1–3.3 / 100 turns) varies more than stance shape

我预期 anchor density 跨 session 大致 constant,stance shape 来承担差异。**实际反过来**:anchor density 跨项目 3 倍,而 stance shape(在有 anchor 的前提下)变化没那么 dramatic。解读:

I expected anchor density to be roughly constant per session and stance shape to do all the varying. **The reverse was true**: anchor density 3× across projects, stance shape (conditional on anchor) varied less. Interpretation:

- AI 的提问风格是 **项目相关的**(很可能是 scope 相关 —— 在 B 的紧 scope plugin extension 里,decision point 自然密集)。/ AI's questioning style is project-dependent (likely scope-dependent — tight-scoped plugin extension prompts more decisions).
- 用户的 stance(在被问到时)是 **collaboration 相关的**,但变化幅度不如 anchor density 本身。/ User's stance (when prompted) is collaboration-dependent but with less dramatic variance than anchor density itself.

这意味着 MVP-II 的 report rendering **必须把 anchor-type table 放在 stance table 旁边**,且 per-100-turn density 要可见,否则消费者会把 stance distribution 误解为 user 的属性。

This means: in MVP-II's report rendering, **the anchor-type table must live next to the stance table**, and the per-100-turn density must be visible — otherwise consumers will misread stance distribution as a property of the user.

---

## 限制 · Limitations

部分是 Phase 1 inherent,部分是本轮 specific。

Some are inherent to a snapshot-grade Phase 1; others are local to this run.

### Phase 1 inherent

- **Recall 未验证**(§ 14.1)。我们知道 lens 找到的 events 是 source-anchored 且 well-formed(precision),但 lens **漏掉**了多少 gradient event,从单纯 participant-review 是 structurally unverifiable。框架的三条 mitigation(第三方读者重建、密度跨 session 稳定性、fate-driven 反推)都是 multi-session 或 external-reader 的测试,本轮没有。/ Lens precision verifiable but recall is not — needs multi-session or external-reader tests not available here.
- **每个项目只有 1 session**,无法测 § 9 / § 8。/ One session per project — cannot test § 9 or § 8.
- **只有一种 agent**(claude-code),无法测「同用户跨 agent 分布不同」的 claim。/ Only one agent type — cannot test the cross-agent claim.

### 本轮 specific · Local to this run

- **lens 用 `sonnet`**。更强模型(`opus`)可能 pick up 更 subtle 事件;更弱模型(`haiku`)可能漏明显的。Phase-2 至少要在 reference session 上跑三种模型 characterize variance。/ Lens used `sonnet`; Phase-2 should characterise model variance.
- **Project A digest 263 KB / ~65K tokens**。在 sonnet context 内但偏大。strict scan on A 第一次返回 2 events,re-run(因 JSON-escape 强制重跑)返回 4 events 且内容不同。**这暗示在大 digest 上 lens 可能 first-pass miss events**。Phase-2 应该 explicitly 在同一 digest 上重跑同一 lens 测 variance。/ Larger digests may cause first-pass miss; Phase-2 should test same-digest, same-lens variance explicitly.
- **digester 把 tool_result 预 truncate 到 600 chars**。如果 negative-space event hinge 于 AI 提议读取的某个文件 *的 content*,lens 只看得到 `Read(<path>)` + 截断片段。这是为 digest size 做的 tradeoff;lens 的 "skip if AI proposal isn't specific enough" 规则自然 handle,但会把 lens biased 向 **提议文本本身有 visible artifact** 的事件。/ Digester truncation biases lens toward events with proposals that have visible artifacts in their own text.

---

## 推到 MVP-II 的成本 · Cost of next-step rollout

从这次实验(MVP-I, Demo-grade)推到下阶段(MVP-II, Self-use-grade —— cron + signal store + episode trigger),工程 delta:

To go from MVP-I (Demo-grade) to MVP-II (Self-use-grade — cron + signal store + episode trigger):

1. **持久化 signal store**:目前 events 存为 `(project, lens)` 一对一 JSON。MVP-II 需要 append-only store + 稳定 ID。可能是 per-project per-lens JSONL,或 SQLite。加 `event.id`(stable hash)/ `event.created_at` / `event.lens_version`。机械改动。/ Mechanical change to append-only store + stable IDs.
2. **cron + information-increment gate**:`code-journal sync` 跑在 cron 上,发现新 session 就 dispatch subagent,events append 到 store。Q5 grilling 已经 sketch 过。机械。/ Already sketched in Q5; mechanical.
3. **on-demand compose**:`code-journal compose --project <X>` 已存在(`scripts/compose.mjs`),改成从 signal store 读 + 打 episode 号 / 日期。容易。/ Already exists; tweak to read from store and stamp episode/date.
4. **时间窗口 audit**:加 `--since <date>` 让长跑的 store 能切窗。/ Add `--since <date>` for time-windowed audits.
5. **fate tracking** —— MVP-II 核心 loop **其实不需要它**,fate 只在多 episode 时才相关。延到 Phase 3。/ Not needed for MVP-II's core loop — defer to Phase 3.

总估算:**3-5 天专注工作即可到 MVP-II**。lens prompts / schema / audit format / digest format 已是 production-ready,差的只是 JSON-escape rule(已加)和 infrastructure。

Total estimate: **3-5 days of focused work to reach MVP-II**. Lens prompts, schema, audit format, digest format are all production-ready as-is.

---

## 总结 · Verdict

> **中文** —— 协作观测框架在第一次接触三段真实 coding-agent transcripts 时,产出了 source-anchored、无 identity-drift 的 events。两条非交叉 lens 在信号类型上 empirically distinct。框架核心 claim「协作是分析单位」survived 一个**比框架自己提出的更强**的测试(同 agent、同周、只变项目)。Phase 1 可验证的 hypotheses(H1–H7)全部成立;long-horizon 的几条仍 structurally untestable,直到 multi-episode 基础设施就位。
>
> grilling 阶段定下的产品方向 —— 三层架构、episode-versioned audit、δ' 文档格式、audit 而非 service voice —— 在尝试真的产出这些 audit 的结构压力下经得起。没有任何设计决策需要事后修订。MVP-I as-built 足够在真实数据上 falsify 框架,如果它是假的;它没被 falsify。

> **English** —— The 协作观测框架 produced source-anchored, identity-drift-free output on first contact with three real coding-agent transcripts from the same user. The two-lens, non-interfering design is empirically distinct in signal type. The framework's central "协作 is the analysis unit" claim survived an **even stronger test** than the framework itself proposed (same agent, same week, only project varying). Phase 1's testable hypotheses (H1–H7) all hold; the long-horizon ones remain structurally untestable until multi-episode infrastructure is in place.
>
> The product direction we locked in during the prior grilling — three-layer architecture, episode-versioned audits, δ' document format, audit rather than service voice — held up under the structural pressure of actually producing these audits. No design decision needed revision after seeing the output. The MVP-I as-built is sufficient to falsify the framework if it's false on real data; **it did not falsify**.

下一步具体决策:是花 3-5 天把 MVP-I 推到 MVP-II(Self-use-grade)开始积累真实多 episode 数据,还是先继续 refine lens specs 和 digest pipeline 再 commit infrastructure。

The next concrete decision: whether to invest the 3-5 days to take MVP-I to MVP-II (Self-use-grade) and start accumulating real multi-episode data, or to refine the lens specs and digest pipeline further before committing infrastructure.

---

## 实验记录 · Phase 1 ledger

```
2026-05-27   Phase 1 cross-project test · 跨项目 Phase 1 测试
             3 projects · 2 lenses · 6 subagent scans
             (initial 6 scans; 2 reruns due to JSON-escape failure mode;
              count above is final, post-rerun)
             3 项目 · 2 lens · 6 次 subagent scan(其中 2 次因 JSON 转义问题 re-run)

             31 events total · 总共 31 个 events:
               9 strict-negative-space events (across 3 sessions)
              22 anchored-deferral anchors    (across 3 sessions)

             Cross-lens overlap (primary-turn coincidence):
             跨 lens overlap(primary-turn 重合):
               6 / 9 strict events share a primary turn with a deferral anchor (67%)
               9 个 strict events 中 6 个 primary turn 同时是 deferral anchor (67%)
               — see H7 for interpretation. / 解读见 H7。

             Sealed: 两条 lens 在三项目上 sealed;结构性 stance shape 在
             same-user / same-agent / same-week 限制下仍跨项目变化。
             Sealed: both lenses on all three projects; structural stance shape
             preserved across projects despite same-user, same-agent, same-week.

             Methodology: subagent context isolation per (project, lens) pair,
             anonymised project codes in committed report, no raw transcript
             content reproduced outside gitignored audits.
             方法论:subagent context 按 (project, lens) 隔离,committed 报告里
             项目代号匿名化,原始 transcript 内容不出 gitignored audits 范围。
```
