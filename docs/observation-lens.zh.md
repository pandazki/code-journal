# 协作观测 Lens — 开发者 & 用户指南

> **状态:已发布(v0.2.0)。** 这是 observation-lens 功能的**确定版、与代码匹配**的
> 文档。它描述代码**当前的行为**,不是为走到这一步而做的探索。探索性记录——各
> phase、假设、重验轮次——单独存放在 `experiments/observation-lens-*/` 与
> `docs/plans/`;对使用或维护本功能的人而言,**本文取代那些文档**。
>
> English version: [`observation-lens.md`](observation-lens.md).

## 这是什么

协作观测 lens 读取与 journal 相同的原始 coding-agent transcript,显化**是用户、
而非 agent,在哪里注入了方向**:一个人 steer 了工作、否决了桌上的方案、或引入
新关切的那些时刻。它是镜子,不是判官:每个事件都指向逐字的 transcript 证据,
而且系统拒绝在没有信号的地方编造事件。

它与 visual journal 是两条独立产品线。它在本地运行,调用你已安装的 coding agent
(`claude -p`)来应用 lens,并把不可变的、按项目分的**审计 episode** 写到
`~/.code-journal/observations/`。

## 三层架构

```
transcript (.jsonl)
   │  digest.ts —— turn 编号的 markdown,剥除噪声
   ▼
检测 DETECTION   三条 lens,每条是一个隔离的 `claude -p` subagent
   │  lens-runner.ts → strict-negative-space · anchored-deferral · user-initiated-pivot
   ▼
[grounding gate] grounding.ts —— 对每个事件做机械化复核
   │  凡是引用无法在 digest 上复现的,丢弃
   ▼
信号库 SIGNAL STORE  store.ts —— append-only JSONL,每条 lens 一个文件,按 id 去重
   │
   ▼
审计 AUDIT       compose.ts —— δ' markdown episode(forbidden-words 门控),不可变
```

CLI(`code-journal …`,也可用 `cj`):

- `sync` —— 发现新 session、digest、跑三条 lens、过门、追加。新事件越过项目阈值时自动 compose。
- `compose --project <name|id>` —— 从信号库 compose 下一个审计 episode。
- `status` —— 按项目显示信号库计数 + episode 历史。

## 三条 lens

每条 lens 是一个单一职责的 prompt(`packages/observation/src/lenses/*.md`),
派发给一个**隔离**的 subagent。lens prompt 故意写成纯 markdown,这样它的版本与
编译后的代码解耦。

### 1. `strict-negative-space`(v2.1)

宏观 pivot:AI 提了一个**具体**方案,用户**没有**采纳,后续工作明显走向了
**另一条轴**。三条腿必须同时成立,否则不算事件。**天生稀疏**(每 session 0–4 个)。

### 2. `anchored-deferral`(v3.0)

AI 暴露了一个显式决策点(一个 "fork":直接提问 / ≥2 个命名选项 / 显式不确定),
把用户的即时回应分类为**五种 stance** 之一:

| stance | 含义 | 方向 |
|--------|------|------|
| `engaged` | 用户**加了内容**——理由、约束、新选项 | 注入 |
| `overrode` | 否决框架,改去另一个关切 | 注入 |
| `ignored` | 转移话题;问题悬而未决,工作走向别处 | 注入(在别处) |
| `assented` | 对 AI 方案的纯批准("可以,继续"、"looks good") | **未注入** |
| `deferred` | 把选择权交回("你决定就好"、"you decide") | **未注入** |

`engaged` / `assented` 的拆分是承重的:**批准不是参与**。把它们合并,就会重新
引入整个功能要避免的那个失败——"继续吧 / keep going" 被读成用户在主动塑造工作。

### 3. `user-initiated-pivot`(v1.0 · 实验性)

用户在**前面没有 AI fork** 的情况下注入了方向——一个未经提示的新关切 / 新文件 /
新需求,且后续工作接住了它。这是另外两条 lens **结构上看不见**的协作模式
(deferral 需要锚点;strict 需要一个被否决的方案)。source-anchored 三腿门。

**实验性:** 主要在单一作者的 transcript 上验证过;它的软边缘未调优——它故意
**不**在 session 开场触发(前面没有 AI turn),并且对疑问句形态的"提出新关切"
会漏触发。把它的输出当成有用信号,而不是已定论的测量。

## Grounding gate(别绕过它)

lens prompt *要求*事件 source-anchored;grounding gate 在代码里*强制*这一点,
因为光靠 prompt 指令守不住。重验发现:即便在干净输入上,lens 也会产出
plausible-but-ungrounded 的事件(引用一个在 40 个 turn 之外的方案;引用一段在
所标 turn 上根本不存在的文本)。gate(`lib/grounding.ts`,在 `sync` 写入
append-only 库之前应用)会丢弃任何**致命**检查不过的事件:

- **`proposal_found`** —— 引用的 AI 方案/锚点 verbatim 必须能在 transcript 里
  定位到(归一化匹配:对标点/引号/空白不敏感)。
- **`citation_accurate`** —— 它真实所在的 turn 必须与所引 `turn_anchor` 吻合
  (±2)。当 verbatim 重复出现(AI 重述了一遍计划)时,采用离所引锚点**最近**
  的那次,所以更早的副本不会造成误丢。
- **`chronology`**(仅 strict)—— 方案必须早于回应。
- **`no_preceding_fork`**(仅 pivot)—— 用户方向之前不能有 AI 决策点;若有,
  这个时刻归 `anchored-deferral`。
- `response_found` 是**软**检查(报告但不门控):用户回应可能是图片或动作,
  它的缺失不该杀掉一个真实事件。

因为信号库 append-only、审计不可变,gate 在**入库时**运行——一个 ungrounded
事件在能进入已发布 episode 之前就被丢掉了。**不要绕过它**。

`compose.ts` 里还有第二条独立硬规则:forbidden-phrases 检查,拒绝写入任何含有
对用户身份评价("用户是/倾向于/偏好……")的审计。lens 是观测,永远不是判决。

## 怎么运行

```sh
# 发现新 session、跑全部 lens、过门、追加;到阈值自动 compose
code-journal sync                       # 全部项目
code-journal sync --project myproj      # 单个项目
code-journal sync --project myproj --limit 5 --verbose

# 从信号库 compose 下一个不可变审计 episode
code-journal compose --project myproj

# 查看信号库计数 + episode 历史
code-journal status
code-journal status --project myproj --verbose   # 同时打印 lens 版本
```

前置条件:PATH 上有可用的 `claude` CLI(lens 调用它;`haiku` 被拒——丢失太多)。
session 在本地读取,不上传任何东西。

## 怎么读一个审计 episode

episode 是位于
`~/.code-journal/observations/<project>/episodes/<n>-<date>.md` 的 markdown
(不可变;同名 `.json` 是它的元数据)。各段:

- **Scope / Method** —— 覆盖的时间窗、跑了哪些 lens 版本。
- **Measurements** —— 计数与密度(M1–M6)。**是计数,不是评分**。
- **Anchor distribution** —— 故意排在 stance **之前**:stance 计数是以"AI 是否
  暴露了决策点"为条件的。
- **Stance distribution** —— 五元组 `(e, a, d, o, i)`,带"注入 / 未注入"列。
- **Findings — Strict negative-space / Anchored deferral / User-initiated pivot**
  —— 逐事件卡片,含逐字引用和 source ref。
- **Fate updates** —— 早先事件在后续 episode 里的命运(本版手动;见 Limitations)。
- **Limitations / Source index。**

把它当成一篇你会回头重读的日志,而不是一眼扫过的 dashboard。

## 局限 —— 本版**不**主张什么

这些是刻意写明的;遵守它们是正确使用本功能的一部分。

- **stance shape 不是个人指纹。** 重跑之间的分类抖动是真实的,甚至可能大于项目
  间差异;**报计数,不要据 shape 推导"用户画像"**。
- **`strict-negative-space` 精度中等**(真实数据上约 20–35% 的原始产出是
  ungrounded)。grounding gate 会移除它们,所以进入审计的是可信的——但这条 lens
  产量低,且 recall 未测量。
- **`user-initiated-pivot` 是实验性的**(见上)。
- **`assented` 与 `engaged` 是尽力而为的界线** —— 边界上的批准在不同跑次可能
  两边落;prompt 在不确定时偏向 `assented`。
- **本版未实现 / 未验证:** fate 追踪是手动的(schema 有字段,但没有自动检测,
  也没有 `fate add` CLI);超大 session(>~2000 turns)可能超出模型上下文,会被
  跳过并标记重试;跨机器同步、多用户/分享、真人 reader 验证都未触及。
- **digest 截断:** `tool_result` 内容有上限,所以一个非常长的 AI 锚点可能部分
  落在 digest 之外而变得无法验证;这类事件会被 gate 保守地丢弃。

## 给维护者

- **东西在哪:** lens 在 `src/lenses/*.md`;派发在 `lib/lens-runner.ts`;gate 在
  `lib/grounding.ts`;库在 `lib/store.ts`;state/schema 在 `lib/schema.ts` +
  `lib/state.ts`;审计渲染在 `lib/compose.ts`;CLI 在
  `packages/cli/src/observation.ts`。测试:`packages/observation/test/*.test.ts`。
- **新增/修改 lens prompt:** 若改动是**实质性**的(改变什么算事件、或怎么分类),
  在 `schema.ts` 里 bump `lens_versions[<lens>]`,这样新旧事件不会在同一个 id 上
  撞车。版本节奏 + recharacterize 帮手见 `src/lenses/README.md`。
- **新增一条 lens:** 在 `schema.ts` 扩展 `LensId` 联合 + `LENS_IDS` + `isLensId`
  以及三处 `lens_versions` 字面量;在 `grounding.ts` 的 `extractVerbatims` 里教它
  这条 lens 的 payload 形状;在 `compose.ts` 加一个 Findings 段。sync 循环和 gate
  会自动接上。
- **这些门不是可有可无的礼貌。** grounding gate 和 forbidden-phrases 检查是**信任
  契约**。测试钉死了它们的行为;如果某个改动让它们失败,那是改动错了,不是测试
  错了。
