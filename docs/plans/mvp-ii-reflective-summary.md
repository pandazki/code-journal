# MVP-II 感性总结 · what stuck after running it for real
# MVP-II Reflective Summary · what stuck after running it for real

> 不是表格,不是 verdict。是把 Phase 1 → Phase 2 → MVP-II 一路下来,**真正
> 学到的东西** 与 **没学到的东西** 写在同一页。
>
> Not tables, not verdicts. What we actually learned vs. what we still
> haven't, written on one page.

---

## ✅ 真的被验证了 · What got validated, viscerally

### V1 · 框架对自己保持诚实

### V1 · The framework stayed honest about itself

**中文**: MVP-II 在**本次对话**上跑出 Episode 1,strict event 1 抓到了你说"之前的工作不重要"那一刻 —— 没有粉饰、没有把它写成"用户做出了富有远见的决定",就客观写"AI 提了 (a)/(b)/(a') 三选一,用户没选,而是宣布 blank-slate 重启"。**框架在自我观测下也没作弊**。这件事如果失败,所有镜子隐喻都是空话。它没失败。

**English**: MVP-II ran Episode 1 on **this very conversation**, and strict event 1 captured the moment you said "previous work doesn't matter." No glossing, no rewriting it as "the user made a visionary decision" — just observed: "AI offered (a)/(b)/(a') three choices, user picked none, declared blank-slate restart." **Even under self-observation the framework didn't cheat.** If it had failed here, every mirror metaphor would have been empty rhetoric. It didn't.

### V2 · 同一用户 ≠ 同一协作

### V2 · Same user ≠ same collaboration

**中文**: H3 在 4 个真实项目上一次性显化。**stance shape 不是变种,是质变** —— code-journal 是"engage 与 override 平衡 + 偶尔 ignore"(grilling 节奏);pneuma-skills 是"engage 主导 + 零 override"(协作型);omne-next 是稀疏选择;tanka 是 "ignore 主导"(频繁拉去新关切)。**你就是你,但你不是一个 user.profile,你是 4 段不同的协作**。这是 Phase 1 + 2 推断,这次 production 上看到了。

**English**: H3 surfaced on 4 real projects in one run. **Stance shapes aren't variants, they're qualitatively different modes** — code-journal: engage-override balanced + occasional ignore (grilling cadence); pneuma-skills: engage-dominant + zero overrides (collaborative); omne-next: sparse choices; tanka: ignore-dominant (frequent redirect). **You are you, but you are not a `user.profile` — you are 4 distinct collaborations**. Inferred in Phase 1 + 2; seen in production this round.

### V3 · 空也是数据,系统不慌

### V3 · Silence is data, the system doesn't panic

**中文**: nemori 9 个 session 全 empty-state,desktop-sprite 部分 session 也是,**没编造过一个事件**。H6 在 production 又过了一次 —— 如果哪怕一个 hallucinated 事件出现在低信号项目上,整套信任都坍。它没坍。

**English**: nemori's 9 sessions all returned empty-state, desktop-sprite's partial too — **zero fabricated events**. H6 replicated in production. If even one hallucinated event had slipped through on a low-signal project, the whole trust contract would collapse. It didn't.

### V4 · 三层架构 + cron 闭环 · 工程上 doable

### V4 · Three-layer architecture + cron loop · engineering-doable

**中文**: detection / signal store / audit 三层 + `claude -p` 调度 + δ' markdown 渲染整条链路通顺。Episode 是真 immutable 文件、signal store 真 append-only、measurements 自动 compute、forbidden-words check 真 gate 住。**框架不是只在 sketch 里 work,在 Node 进程里也 work**。

**English**: detection / signal store / audit three layers + `claude -p` dispatch + δ' markdown render all flow cleanly. Episodes are real immutable files, signal store is real append-only, measurements auto-compute, forbidden-words check actually gates. **Framework works not just in sketches but in Node processes**.

---

## ❌ 被证否 / 修正了的东西 · What got falsified or corrected along the way

### C1 · `engaged` 不是最噪的,`overrode` 才是

### C1 · `engaged` isn't the noisiest stance — `overrode` is

**中文**: Phase 2 E1 第一次跑就翻了我的预测。原以为 engage 最宽泛所以最不稳;实测 overrode (stdev 1.36) 比 engaged (0.75) 噪一倍。Reason:override 边界模糊("用户部分回应了 options 算不算?"),而 engage 有"实质参与"硬要求。**直觉判错了,数据救了**。已修。

**English**: Phase 2 E1 flipped my prediction. I'd guessed `engaged` would be noisiest because its definition is loosest; measured `overrode` (stdev 1.36) is ~2× noisier than `engaged` (0.75). Reason: overrode has a fuzzy gate ("did user partially address options?") while engaged requires substantive participation. **Intuition wrong, data corrected it**. Fixed.

### C2 · E6 的双峰不是普遍规律

### C2 · E6's bimodality isn't a universal law

**中文**: Phase 2 E6 在 6 个 pneuma-skills session 上看到 anchor 双峰(前 20% + 后 20%)。MVP-II 跑下来:**每个项目的 quintile shape 不同**。code-journal 是全前 20%(grilling 阶段);pneuma-skills 单 episode 内是 3rd quintile;omne-next/tanka 是平均分布。**双峰是聚合 + 项目类型相关的,不是单 session 物理定律**。E6 的 takeaway 需要被 narrowed 一下。

**English**: Phase 2 E6 saw anchor bimodality (first 20% + last 20%) on 6 pneuma-skills sessions. MVP-II run: **each project's quintile shape differs**. code-journal: all first 20% (grilling phase); pneuma-skills single episode: 3rd quintile; omne-next/tanka: flat. **Bimodality is aggregation-and-project-type-dependent, not a per-session physical law**. E6's takeaway needs narrowing.

### C3 · "Failed scans 标为已扫" 是个真 bug

### C3 · "Mark failed scans as scanned" was a real bug

**中文**: MVP-II 第一次实际跑就暴露 — 超时 session 被静默地标"已扫",未来 sync 永远跳过它。修了:**只有成功 scan 才进 sessions_scanned**;失败的会下次 retry。这条不是框架问题,是 glue code 的真实生产 bug,被生产环境抓出来。

**English**: First real MVP-II run exposed it — a timed-out session got silently marked as "scanned," so future syncs would never retry it. Fixed: **only successful scans land in `sessions_scanned`**; failures get retried next cycle. Not a framework issue — glue code bug, caught by production.

### C4 · lens convergence 不总是高 · omne-next 是新机制

### C4 · Lens convergence isn't always high — omne-next reveals a new mechanism

**中文**: Phase 1 + 2 看到 50%-100% 的 strict↔deferral 同 turn 重叠率。这次 omne-next 只有 17% —— 6 个 macro pivot 里 5 个发生在 AI 没暴露决策点的 turn。意味着存在一种**用户主导型协作**: user 不等 AI 框,自己定方向。这不是 falsification — 是 finding。新的隐藏 mode 被照出。

**English**: Phase 1 + 2 saw 50%-100% strict↔deferral same-turn overlap. This round, omne-next at 17% — 5 of 6 macro pivots happened at turns AI didn't expose as decision points. Implies a **user-driven collaboration mode** where the user doesn't wait for AI framings and steers on their own. Not falsification — finding. A hidden mode lit up.

---

## ❔ 还没试 / 没法试的东西 · What remains untested

### U1 · Multi-episode 动态 · § 8 fate tracking + § 9 二阶可预测性

### U1 · Multi-episode dynamics · § 8 fate tracking + § 9 second-order predictability

**中文**: 每个项目目前只有 Episode 1。fate 字段在 schema 里,但还没在真数据上**被填**。"残差随时间下降"这种 § 9 claim 完全没碰。Phase 3 才能测。

**English**: Each project has only Episode 1 so far. Fate field exists in schema but hasn't been **populated** on real data. § 9 "residual declines over time" claim is wholly untouched. Phase 3 territory.

### U2 · 真人 reader test · E7 还是 subagent proxy

### U2 · Real human reader test · E7 still subagent proxy

**中文**: E7 用 isolated subagent 模拟第三方 reader,效果好。但没真找人读过 audit。"future-self 读到自己一年前的 audit 能不能 reconstruct" 这种**真实**验证还没做。需要时间。

**English**: E7 used an isolated subagent to simulate a third-party reader; it worked. But no real human has read these audits. "Future-self reading their own audit a year later — can they reconstruct?" — real validation pending. Needs time.

### U3 · 用户读完会不会**用** · 行为级问题

### U3 · Will users actually USE these audits? · A behavioral question

**中文**: 产品理论上对"低频但深刻"读者优化。但**没人真的低频读过它**。你打开过本次产出的 Episode 1 吗?你会一周后再打开吗?一个月后呢?**没数据**。 这是 framework 之外的、user research 才能回答的事。

**English**: The product is theoretically optimised for "low-frequency but deep" readers. But **nobody has actually low-frequency-read it yet**. Have you opened Episode 1? Will you re-open it next week? Next month? **No data**. This is outside the framework's reach — user research territory.

### U4 · Cross-machine / 多用户 / 共享场景

### U4 · Cross-machine / multi-user / sharing scenarios

**中文**: MVP-II 是单机的。`~/.code-journal/observations/` 一台机一份。如果你换电脑、想 share 给 coach 看 audit、想跨平台同步 — 这些 UX 完全没碰过。框架不阻止,但工程没做。

**English**: MVP-II is single-machine. `~/.code-journal/observations/` is per-machine. Switching computers, sharing audits with a coach, cross-platform sync — none of these UX paths have been touched. Framework allows them; engineering doesn't exist yet.

### U5 · 用户反馈进 schema · 当用户读到 audit 说"不对"

### U5 · User feedback into schema · when the user reads an audit and says "no"

**中文**: schema 里 `FateUpdate.user_note` 字段存在,但没**录入入口**。如果你读完 audit 觉得某个 strict event 是 lens 看错了,目前你只能改 markdown,没有 supported workflow。Phase 3 才有 `code-journal fate add` 命令。

**English**: Schema has `FateUpdate.user_note`, but no **input path** for the user. If you read an audit and think the lens got a strict event wrong, you can only edit the markdown — no supported workflow. `code-journal fate add` is Phase 3.

### U6 · 超大 session (>2000 turns) · 工程缺口

### U6 · Mega sessions (>2000 turns) · engineering gap

**中文**: 4 个 session 在跑的时候模型 context 超限报错。Chunked digest 或 hierarchical scan 是 fix,但 MVP-II 没做。**会损失部分 senior 用户的最有信号的 session**(长 session 通常是最有故事的)。Phase 3 该优先级很高。

**English**: 4 sessions hit model context limits during this run. Chunked digestion or hierarchical scan is the fix, but MVP-II skipped. **Risk: losing the most signal-rich sessions for senior users** (long sessions usually have the most story). High Phase 3 priority.

---

## 让我没料到的一件事 · One thing that surprised me

**中文**: 我没料到 lens convergence 在 omne-next 上掉到 17%。我以为它一直会高(60-100%),因为 Phase 1+2 都看到高重叠。但 omne-next 揭示了一种**用户独立 pivot 而 AI 没标记**的协作模式 —— 这是连框架文档 § 5.3 也没特别 highlight 的。原因可能是:omne-next 那段是 debug-driven session,**user 跟着 error 走,AI 跟着 user 走,两人没人在"决定"什么,只是连环 fix**。convergence 低不是 bug,是这种工作流的物理形态。

**English**: I didn't expect lens convergence to drop to 17% on omne-next. I'd assumed it stays high (60-100%) because Phase 1+2 saw high overlap. But omne-next revealed a **user-pivots-independently-while-AI-doesn't-mark** collaboration mode — something framework doc § 5.3 doesn't highlight. Possible reason: omne-next was a debug-driven session, **user follows the error, AI follows the user, no one is "deciding" anything — just chained fixes**. Low convergence isn't a bug; it's the physical shape of that workflow.

**这意味着 framework 在某些 collaboration mode 下需要第三条 lens**: 能在 AI 没设决策点时也照出 user 走向。今天先不做,但记到 MVP-III pile 里。

**This implies the framework may need a third lens for certain collaboration modes**: one that surfaces user direction even when AI hasn't set decision points. Not today, but on the MVP-III pile.

---

## 一句话总评 · One-line takeaway

**中文**: 框架在它最严格的一次 self-test 下站住了 —— 它对自己的对话保持诚实,在 4 种用户姿态下产 4 种 audit shape,nemori/desktop-sprite 空场上没编故事。**没死。但还有 6 件事没碰**。

**English**: The framework survived its most stringent self-test — stayed honest about its own conversation, produced 4 distinct audit shapes for 4 collaboration modes, didn't fabricate stories on empty projects. **Alive. But 6 things still untouched**.
