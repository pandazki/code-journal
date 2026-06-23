# MVP-II 工程规划 · Observation Lens Phase 2

> ⚠️ **Superseded / historical.** This is the original engineering *plan*, not the
> current state. For how the shipped feature actually works, see the canonical
> guide [`docs/observation-lens.md`](../../observation-lens.md). Out of date here:
> this plan describes **two** lenses and **four** stances; the shipped feature has
> **three** lenses, **five** stances, and a grounding gate.

> 这份规划把 Phase 1(grilling Q1-Q9)+ Phase 2(E1-E7 实验)的所有结论
> 收拢成**一份可执行的工程文档**。读者:未来要实现 MVP-II 的工程师 / 自己 /
> 下一个 agent。读完应该不需要再去翻 grilling 记录或实验报告就能上手。

---

## 0 · TL;DR

- **MVP-II = 三层架构的工程落地**:Detection(持续 lens scan)/ Signal Store
  (append-only events)/ Audit(按 cron + information-increment 触发的
  frozen episodes)
- **Scope**: 单用户、本地、纯 CLI、无 daemon(用 OS cron 调度);3 个新命令
  (`code-journal sync` / `compose` / `status`);1 个新 npm workspace
  package (`packages/observation/`);沿用 `claude -p` 调度子 agent(无 API key)
- **Effort estimate**: 3-5 天聚焦工程,主要 cost 在 schema 决策 + edge case
  处理;lens spec / digester / composer 已 production-ready
- **Out of scope for MVP-II**(明确推到 MVP-III): topic-coherent arc 检测 /
  predictability dashboard / 真人 reader test / 多用户 / 远程同步
- **来自 E1-E7 的 8 条 punch list 全部 inline 在对应工程项里**

---

## 1 · 目标与范围

### 1.1 In scope

| ID | Deliverable | 类型 |
|----|-------------|------|
| D1 | `packages/observation/` 新 workspace | 包结构 |
| D2 | Event / Episode / ProjectState JSON schema(TS types + runtime parsers,沿用 `core/models.ts` 风格) | 类型 |
| D3 | Persistent signal store(per `(project, lens)` JSONL 文件,append-only) | 持久化 |
| D4 | `code-journal sync` 命令:发现新 session → 调度 lens → append events | CLI |
| D5 | `code-journal compose --project <X>` 命令:从 signal store 读 → 编 δ' audit → 写 episode 文件 | CLI |
| D6 | `code-journal status` 命令:展示每个 project 的 episode 数 / 最近 scan / 待 compose 信号增量 | CLI |
| D7 | OS-level cron 集成(`code-journal cron install` 复用 tui 现有 pattern) | 调度 |
| D8 | Codex digester 接进生产路径(目前在 experiments/) | adapter |
| D9 | Lens-version-bump variance 重 characterize 协议(文档 + 一条 script) | 流程 |

### 1.2 Out of scope (推到 MVP-III)

| 不做的事 | 为什么不做 | 哪个实验/讨论触发 |
|---------|-----------|------------------|
| Topic-coherent arc 检测(代替 git-repo 作 fate 单位) | E5 新发现, 需要事件内容 clustering | Phase 2 E5 |
| § 9 predictability dashboard(residual time series) | 需要积累 3+ 月真实数据 | E6 substrate exists 但未到训练阶段 |
| 真人 third-party reader test | 需要找人,且 audit format 先要 stabilize | E7 用 subagent proxy |
| 多用户 / org / 权限 | 框架 § 12 明确单用户、opt-in | Q3 锁定 |
| 远程同步、S3 上传 | 已经在 v1 packages 里有,与 observation layer 解耦 | Q4 三层架构纪律 |
| Web GUI for audit | δ' 是 portable markdown,任意 viewer | Q8 + E7 验证 |
| Audit 的 LLM second-pass 总结 | 框架红线 § 4.3 / § 11.4 | Phase 2 第 4 条结论 |

### 1.3 与 v1 / experiments 的关系

- v1(`experiments/observation-lens-v1/`)是**实验代码**,不动它,但**引用它**做 baseline
- `experiments/observation-lens-v1/lenses/`、`schema/`、`scripts/digest.mjs`、
  `scripts/compose.mjs` 是**production-ready 的原型**;MVP-II 把它们**移植**
  到 `packages/observation/` 后实验目录可以归档(但保留作历史记录)
- 实验目录里的 v2(`experiments/observation-lens-v2/`)同理 —— digest-codex 移植

---

## 2 · 架构(三层)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 3 · Audit (frozen episodes)                                    │
│  ────────────────────────────────                                     │
│  · 触发: cron tick + information-increment gate                       │
│  · 单位: per project, monotonically increasing episode 编号           │
│  · 文件: ~/.code-journal/observations/<pid>/episodes/<N>-<date>.md    │
│  · 写入后 immutable;新一期是新文件,不改老文件                          │
└──────────────────────────────────────────────────────────────────────┘
                              ▲ reads
                              │
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 2 · Signal Store (append-only, growing)                        │
│  ─────────────────────────────────────────────                       │
│  · 内容: 所有 lens scan 出的 events                                   │
│  · 文件: ~/.code-journal/observations/<pid>/signals/<lens>.jsonl     │
│  · 不是 user surface;Layer 3 的原料库                                 │
└──────────────────────────────────────────────────────────────────────┘
                              ▲ appends
                              │
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 1 · Detection (continuous, system-internal)                    │
│  ──────────────────────────────────────────────────                  │
│  · 每次 sync: 发现新 session → digest → 2 个 isolated subagent (1/lens)│
│  · subagent 用 claude -p 调度(无 API key)                            │
│  · 输出 events 直接 append 到 signal store                            │
└──────────────────────────────────────────────────────────────────────┘
                              ▲ reads from disk
                              │
            ~/.claude/projects/ + ~/.codex/sessions/ + cowork...
```

### 2.1 触发图

```
OS cron  ──tick──>  `code-journal sync` 
                       │
                       ▼
                  discover new sessions per project
                       │
                       ▼
                  any new sessions?  ──no──>  exit clean
                       │ yes
                       ▼
                  digest + 2 subagent scans per new session
                       │
                       ▼
                  append events to signal store
                       │
                       ▼
                  cumulative new-events crossed N?  ──no──>  exit clean
                       │ yes
                       ▼
                  call `compose --project <X>` for each project crossing N
                       │
                       ▼
                  write Episode N+1 audit; update ProjectState
```

阈值 N **可配置**,默认 10。框架 § 5 / 我们 Q5 grilling 都说"不要严谨",
默认值经验法,3-5 episode 后再调。

---

## 3 · 数据模型

所有 schema 定义在 `packages/observation/src/lib/schema.ts`,沿用
`packages/core/src/models.ts` 的 parse/serialize/_extra passthrough 风格
(forward-compat,无破坏性 schema 演进)。

### 3.1 Event

```typescript
export interface ObservationEvent {
  /** Stable across runs: fnv hash of (project_id, session_id, lens_id, turn_anchor) */
  id: string;
  lens_id: LensId;                        // 'strict-negative-space' | 'anchored-deferral'
  lens_version: string;                   // 'v2.1' — bumped when prompt materially changes
  project_id: string;
  session_id: string;
  turn_anchor: string;                    // 'T42' or 'T25-T52'
  primary_turn: number;                   // first turn in range, for cross-lens convergence
  timespan: { start: string; end: string } | null;
  source_refs: SourceRef[];
  payload: string;                        // markdown — lens-specific 5-section card or stance card
  detected_at: string;                    // ISO-8601, when sync produced this
  agent: 'claude-code' | 'codex' | 'cowork';
  
  // Fate updates — append-only sub-stream; absent on first detection.
  fate: FateUpdate[];

  /** Forward-compat passthrough; unknown keys ride here for schema evolution. */
  _extra: JsonObject;
}

export interface FateUpdate {
  type: 'maintained' | 'expanded' | 'user_reframed' | 'reverted' | 'caused_rework';
  detected_at: string;                    // when a later episode noticed this fate
  detected_in_episode: number;
  evidence_ref: SourceRef;                // pointer to event(s) in the later episode
  /** Optional reader note; § 8 says user-supplied reframings live here. */
  user_note?: string;
}

export type SourceRef =
  | { type: 'turn'; id: number; session_id: string }
  | { type: 'turn-range'; from: number; to: number; session_id: string }
  | { type: 'commit'; sha: string }
  | { type: 'file'; path: string };
```

**关键纪律**(从 Phase 1 + 2 沉淀):
- `payload` 是 LLM 产物;系统**永远不修改**已写入的 payload
- `fate` 是 system 在后续 episode 检测到时**追加**的,不改 payload
- `lens_version` 改时**不删老 events**,新 events 用新版本号 —— v1 wrap-up 已经踩过这条
- `_extra` passthrough 让 schema 演进时老 events 不报错

### 3.2 Episode

```typescript
export interface AuditEpisode {
  episode: number;                        // 1, 2, 3, ... monotonic per project
  project_id: string;
  composed_at: string;
  window: { start: string; end: string };  // session activity dates covered
  
  source_signals: {                       // immutable snapshot of what fed this episode
    lens_id: LensId;
    lens_version: string;
    event_ids: string[];                  // events from signal store at compose time
  }[];
  
  fate_updates_surfaced: FateUpdate[];    // detected against prior episodes
  
  measurements: Measurements;             // see § 3.4
  
  trigger: {
    cron_at: string;                      // when the sync that triggered this fired
    new_events_since_last: number;
    threshold: number;
  };
  
  audit_path: string;                     // relative to observation root: episodes/<N>-<date>.md
  
  _extra: JsonObject;
}
```

### 3.3 ProjectState

```typescript
export interface ProjectState {
  project_id: string;
  display_name: string;
  agent_seen: ('claude-code' | 'codex' | 'cowork')[];
  
  /** What's already been scanned, so sync knows what's new */
  last_scan: {
    at: string;
    sessions_scanned: string[];           // session ids seen by sync
  };
  
  episodes: { 
    episode: number; 
    composed_at: string; 
    event_count: number 
  }[];                                    // history
  
  next_episode_number: number;
  new_events_since_last_compose: number;  // increments by sync, reset by compose
  
  config: {
    compose_threshold: number;            // default 10
    lens_versions: { [key in LensId]: string };  // pinned per project
    model: 'sonnet' | 'opus';             // haiku banned (E1)
  };
  
  _extra: JsonObject;
}
```

### 3.4 Measurements(来自 Phase 2 E3 verdict)

```typescript
export interface Measurements {
  // M1 - anchor density per 100 turns
  m1_anchor_density_per_100t: number;
  
  // M2 - response latency clock-time
  m2_latency_seconds: {
    n: number;
    min: number; median: number; max: number;
  };
  
  // M3 - pivot magnitude per strict event
  m3_pivot_magnitudes: { turn: number; artifact_count: number }[];
  
  // M5 - lens convergence
  m5_convergence: { convergent: number; total_strict: number };
  
  // M6 - NEW (replaces M4 per E3 verdict)
  // Anchor positions normalised to [0,1] in session length, bucketed
  m6_anchor_positions: {
    quintile_distribution: number[];      // 5 buckets, [0-0.2, 0.2-0.4, ..., 0.8-1.0]
    bimodality_score: number;             // optional — (q1+q5) / total
  };
  
  // M4 explicitly omitted — see E3, M4 fails earn-its-space test
}
```

`measurements` 是**计算出的**,不是 LLM 产的。compose.mjs 阶段从 events
+ digest's turn map 算出来。

---

## 4 · CLI 接口

3 个新 subcommand,加到 `packages/cli/src/index.ts` 的 argv 路由。沿用现
有 `--project`、`--since`、`--until` 风格。

### 4.1 `code-journal sync`

```
code-journal sync [--project <name|id>...] [--scan-only] [--verbose]
```

- 发现 ~/.claude/projects/ + ~/.codex/sessions/ 的新 session(用 `core/sessions.ts`)
- 对每个新 session:
  - digest(用 `packages/observation/src/digest.ts`,移植自 v1 digest.mjs)
  - 2 个 isolated subagent(strict + deferral),通过 `claude -p` 调度
  - 解析 strict JSON,append 到 signal store
- 更新 `ProjectState.last_scan.sessions_scanned`
- 更新 `ProjectState.new_events_since_last_compose`
- **如果** `new_events >= compose_threshold` **且** **未** 设 `--scan-only`:
  自动 call `compose --project <pid>` 
- 退出码: 0 = OK, 1 = digest/scan failure(报告但继续), 2 = config error

### 4.2 `code-journal compose`

```
code-journal compose --project <name|id> [--episode <N>] [--dry-run]
```

- 默认: compose **下一期** episode(`ProjectState.next_episode_number`)
- `--episode <N>`: re-compose 历史 episode N(从其 immutable `source_signals` 重建,
  调试用,**不覆盖**已写入 episode 文件 —— 写 `<N>-<date>.recomp.md`)
- `--dry-run`: 打印将写入路径 + measurements 数字,不写文件
- 步骤:
  1. 读 signal store 的所有 events for this project
  2. 检测 fate updates(新 events 是否触及 prior episodes 的 events?
     v1 ↔ v2 cross-link 逻辑的同形扩展)
  3. 计算 measurements
  4. 渲染 δ' markdown
  5. 写 `episodes/<N>-<date>.md`
  6. 追加 fate updates 到 prior events 的 `fate` 数组
  7. 重置 `new_events_since_last_compose = 0`
  8. 更新 `next_episode_number += 1`

### 4.3 `code-journal status`

```
code-journal status [--project <name|id>] [--verbose]
```

输出(stdout,机器可解析的简洁格式):

```
Project pneuma-skills (pid=a1b2c3)
  agent: claude-code, codex
  sessions scanned: 47 (last sync 2026-05-27 14:30)
  signal store: 132 events (strict: 28, deferral: 104)
  episodes:
    [1] 2026-05-15 -> 2026-05-20 (composed 2026-05-21, 18 events)
    [2] 2026-05-21 -> 2026-05-25 (composed 2026-05-26, 24 events)
  new events since last compose: 7  (threshold: 10)
  next compose: when 3 more events accumulate
```

### 4.4 `code-journal cron install`

沿用 tui 现有的 `cj cron install` pattern,把 `code-journal sync` 注册成
OS-level cron(default: 每 4 小时)。这部分**已经实现**在 tui;只需
copy/adapt。

---

## 5 · 文件布局

### 5.1 新增 package

```
packages/observation/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                public exports
│   ├── lib/
│   │   ├── schema.ts           ObservationEvent / AuditEpisode / ProjectState types + parsers
│   │   ├── digest.ts           ported from experiments/observation-lens-v1/scripts/digest.mjs
│   │   ├── digest-codex.ts     ported from experiments/observation-lens-v2/scripts/digest-codex.mjs
│   │   ├── lens-runner.ts      `claude -p` subagent dispatch
│   │   ├── compose.ts          ported from experiments/observation-lens-v1/scripts/compose.mjs
│   │   │                         + fate detection + measurements
│   │   ├── store.ts            signal store read/write/append
│   │   ├── state.ts            ProjectState read/write
│   │   └── paths.ts            ~/.code-journal/observations/<pid>/ resolver
│   └── lenses/                 prompt specs (copies of v1's, may be edited)
│       ├── strict-negative-space.md
│       ├── anchored-deferral.md
│       └── README.md           when to bump lens_version, recharacterization protocol
└── test/
    ├── schema.test.ts
    ├── store.test.ts
    ├── compose.test.ts
    └── fixtures/               synthetic events/episodes for tests (no real transcripts)
```

### 5.2 用户数据 layout(运行时)

```
~/.code-journal/
├── narratives/                  (v1 — unchanged)
├── observations/                (NEW)
│   ├── _projects.json          ProjectState[] index (cross-project lookup)
│   ├── <pid-1>/
│   │   ├── state.json          this project's ProjectState
│   │   ├── signals/
│   │   │   ├── strict-negative-space.jsonl
│   │   │   └── anchored-deferral.jsonl
│   │   ├── digests/            (cached digests for re-compose / debugging)
│   │   │   ├── <session-id>.md
│   │   │   └── ...
│   │   └── episodes/
│   │       ├── 1-2026-05-20.md
│   │       ├── 1.json          episode metadata (AuditEpisode)
│   │       ├── 2-2026-05-26.md
│   │       └── 2.json
│   └── <pid-2>/
│       └── ...
```

**纪律**(从 v1 wrap-up + Phase 2 沉淀):
- `episodes/<N>-<date>.md` 一旦写入**绝对 immutable**
- `signals/<lens>.jsonl` 是 append-only,event ids 稳定,**不重写**
- `_projects.json` 是 index 而非真值源;真值在 per-project `state.json`

### 5.3 修改的现有文件

| 文件 | 改什么 | 由哪个 punch list 项触发 |
|------|--------|------------------------|
| `packages/core/src/sessions.ts` | 已经支持 codex 路径;暴露 `discoverNewSessionsSince(lastScan)` helper | D4(sync 命令) |
| `packages/cli/src/index.ts` | 加 3 个新 subcommand 的 argv 路由 | D4 / D5 / D6 |
| `packages/cli/package.json` | dep on `@code-journal/observation` | D1 |
| `package.json` (root) | workspace 列表加 `packages/observation` | D1 |
| `docs/roadmap.md` | 把 MVP-II 一行链到这份 plan | (此文档) |
| `CLAUDE.md` | 加 `## Observation Lens` 一段,指向这份 plan | optional |

---

## 6 · Subagent 调度

### 6.1 模式:`claude -p` 与 `narrate.ts` 同形

`packages/observation/src/lib/lens-runner.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface LensRunArgs {
  lensSpec: string;                       // path to lens spec markdown
  schemaSpec: string;                     // path to schema spec markdown  
  digestPath: string;                     // path to one digest
  projectCode: string;
  sessionId: string;
  outputPath: string;                     // where to write the JSON
  model?: 'sonnet' | 'opus';              // NOT haiku (E1: misses ~50%)
}

export function runLens(args: LensRunArgs): { ok: true; eventCount: number } | { ok: false; reason: string } {
  const prompt = buildLensPrompt(args);   // assemble the isolated-subagent prompt
  
  try {
    execFileSync('claude', [
      '-p', prompt,
      ...(args.model ? ['--model', args.model] : ['--model', 'sonnet']),
    ], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 300_000,                   // 5 min cap per scan
    });
    // ... validate JSON, retry once if escape failure
    return { ok: true, eventCount: /* ... */ };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
```

### 6.2 JSON-validate-then-retry(E1 punch list)

```typescript
function parseLensOutput(path: string): ParsedOrError {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    // Phase 1 found ~33% raw failure rate on un-instructed runs.
    // Phase 2 baked the escape rule into the spec; failures should be < 5% now.
    // Single retry with extra inline reminder is enough.
    return { _retryNeeded: true, error: e };
  }
}
```

如果 retry 仍然失败:**写入 ERROR-state 到 signal store**(special event id 标识),
不阻塞 sync 继续处理其他 session。下次 sync 时手动 review。

### 6.3 隔离纪律(从 Phase 1+2 沉淀)

每次 subagent 调度都要 **保证**:
- subagent prompt 里**只有** lens spec / schema / 一个 digest path
- **不包含**其他 session、其他 lens、用户身份信息(framework 关切 § 14 #3)
- output 文件 path 是 sandbox 里的、subagent 知道写哪
- 调度方(sync 命令)**不向 subagent transmit** 任何 cross-project context

### 6.4 安全 budget(Phase 2 E1 含 cost 经验)

| Model | per-scan latency | per-scan tokens(平均) | 备注 |
|-------|------------------|---------------------|------|
| sonnet | 60-120s | ~60K | **默认** |
| opus | 90-180s | ~80K | 仅在 lens-version-bump 重 characterize 时用 |
| haiku | 30-60s | ~30K | **生产禁用**(E1: ~50% recall) |

按典型用户每周 5-10 session × 2 lens = 10-20 scan/周:
- sonnet × 20 scan ≈ 1.2M tokens/周 ≈ 5M tokens/月
- 这个量级用户应当能承受;但如果不能,Phase 3 加 model-tier-per-project 配置

---

## 7 · Milestones(分阶段)

每个 milestone 独立可验收,前一个 milestone 不阻塞后一个的设计但阻塞它的
acceptance test。

### M1 · Package skeleton + schema(0.5 天)

- 创建 `packages/observation/` 目录、`package.json`、`tsconfig.json`
- 把 `schema.ts` 写出来,parse/serialize per type,unit test
- root `package.json` workspace 加这个包
- `npm install` 应该 clean 通过

**Done when**: `npm test -w @code-journal/observation` pass;types exportable
from `@code-journal/observation`

### M2 · Digest + signal store + state(1 天)

- `digest.ts` / `digest-codex.ts` 从 experiments/ 移植
- `store.ts`(append-only JSONL,id-based dedup)
- `state.ts`(ProjectState 读写)
- `paths.ts`(`~/.code-journal/observations/<pid>/` resolver)
- Unit test 用 synthetic events 覆盖 append + dedup + read-all

**Done when**: 可以从 TS 代码 manually call `appendEvent` + 读回来 +
ProjectState 持久化

### M3 · Lens runner(1 天)

- `lens-runner.ts`(`claude -p` shell-out + JSON-validate-then-retry + error-state)
- 把 lens spec(experiments/observation-lens-v1/lenses/*) 拷贝到 
  `packages/observation/src/lenses/`,加 `lens_version` 头
- Test: 手动用 1 个 sample digest 跑通(integration 不入 CI;cost too high)

**Done when**: 能用 `runLens()` 调度一次扫描,events 落地到 signal store

### M4 · Compose(1 天)

- `compose.ts` 移植 + 加 fate detection(events 跨 episode 重叠时追加 FateUpdate)
- M6 measurement(anchor position normalised)
- variance budget 显示(per-stance,在 v3 lens-recharacterize 之后填具体值)
- 渲染到 `episodes/<N>-<date>.md`

**Done when**: 手动 `compose --project <pid>` 输出 valid δ' markdown +
更新 AuditEpisode metadata + 更新 ProjectState

### M5 · CLI integration(0.5 天)

- `packages/cli/src/index.ts` argv 路由加 sync / compose / status
- `code-journal sync` 调 sessions.discover → digest → runLens → store
- `code-journal compose` 走 M4 流程
- `code-journal status` 读 state.json + signal store summary

**Done when**: 3 个命令在真实 `~/.claude/projects/` 上端到端跑通

### M6 · Cron + onboarding(0.5 天)

- `code-journal cron install` 复用 tui 现有 pattern
- README 段落:**MVP-II Usage** —— 5 行 quickstart(`install` →
  `cron install` → 等几天 → `status` 看 episodes 累积)
- 在 `docs/roadmap.md` 把 MVP-II 标 done

**Done when**: install + cron + 4 小时后 status 显示 fresh signals

### M7 · Lens-version-bump 协议 + 文档(0.5 天)

- `packages/observation/src/lenses/README.md`(when to bump version, 
  recharacterize protocol)
- 一条 helper script `scripts/recharacterize-lens.mjs`: 
  对 reference session 跑 N=5 次,出 variance report
- `lens_version` 字段在 `state.json` 里 pinning;升级时旧 events 不动,新 events 用新版本号

**Done when**: 文档完整,helper script 在 reference session 上能跑出
"per-stance variance budget" 表

### 总时长

| Milestone | 工时 |
|-----------|------|
| M1 skeleton | 0.5 天 |
| M2 store | 1 天 |
| M3 lens-runner | 1 天 |
| M4 compose | 1 天 |
| M5 CLI | 0.5 天 |
| M6 cron + docs | 0.5 天 |
| M7 lens-bump protocol | 0.5 天 |
| **总** | **5 天** |

**含浮动**: schema 决策可能多 0.5-1 天(很多 edge case);测试覆盖宽
度也可能再加 0.5 天。**保守估算: 3-5 天聚焦工程,7 天碎片化** —— 与
Phase 1 给的 "3-5 天" 估算一致。

---

## 8 · 验收标准(end-to-end)

MVP-II ship 时,以下全部为真:

### 8.1 功能性

- [ ] `code-journal sync` 跑在 `~/.claude/projects/` 上,**3 个不同的 active project** 各产 ≥1 个 event
- [ ] `code-journal compose --project <X>` 产 episode 1 markdown,**E1-E7 punch list 8 条全部在该文件可见**:
  - [ ] anchor 表在 stance 表前面(punch #4 / v1 wrap-up)
  - [ ] cross-lens `↔` 标记(v1 wrap-up)
  - [ ] `Redirected to` 在 ignored stance 渲染(v1 wrap-up)
  - [ ] 5 个 measurements 中: M1/M2/M3/M5 + M6(替换 M4, E3)
  - [ ] valence-stripping reminder 在 Method 段(v1 wrap-up)
  - [ ] empty-state "none surfaced" 在 fate-updates 段(E5)
  - [ ] stance counts 带 variance budget(±range, E1)
- [ ] **第二期 compose** 在 same project 上 surfaces ≥1 fate update **或** 诚实地说 "none surfaced — Episode 2 covered different work"(E5)
- [ ] `code-journal status` 输出**机器可解析**,human readable
- [ ] codex transcripts 与 claude-code transcripts 一视同仁 process(E4)

### 8.2 纪律性

- [ ] subagent 调度时,prompt 里**不含**:其他 session/digest、其他 project ID、用户 PII、framework 文档本身
- [ ] signal store 是**真 append-only**(无覆盖路径);unit test 覆盖
- [ ] episode 文件**immutable**;test 覆盖 re-compose 不覆盖
- [ ] **No haiku in production**(E1):runtime 拒绝 model = haiku
- [ ] 任何 lens 输出 JSON parse 失败时:retry 1 次,失败则写 error-state event,**不阻塞** sync 继续
- [ ] **No system-side meta-pattern declarations**(framework § 11.4):
  audit 渲染时 grep 不出来 "user is", "user tends to", "user prefers" 等
  (硬编码 forbidden-words check)

### 8.3 安全 / 隐私

- [ ] 所有 audit / event / digest 文件**默认 mode 0600**(用户可读,组/世界不可读)
- [ ] `~/.code-journal/observations/` 目录 mode 0700
- [ ] **不向网络发任何请求**(除 `claude -p` 调度本身经过 Anthropic API);test 用 nock 验证

### 8.4 可观测 / 调试

- [ ] `--verbose` 模式打印每次 lens 调度的 model / digest size / event count
- [ ] sync 失败时,error 包含 enough context 复现(session id + lens id)
- [ ] `code-journal status --verbose` 显示每个 lens 的 lens_version,**新旧版本号并存时给出警告**

---

## 9 · 风险与缓解

### 9.1 R1 · `claude -p` 不可用 / 改了 API

**风险**: MVP-II 完全依赖 `claude` CLI;若用户没装、版本太老、Anthropic 改了 `-p` flag,sync 就死了。

**缓解**:
- 启动时 health check:`claude --version` + 一次 trivial `-p "hello"`
- 在 status / sync 都报告 host agent health
- Phase 3+ 加 fallback:支持 codex CLI 或 API key 直接调用(opt-in)

### 9.2 R2 · LLM 输出 schema 漂移

**风险**: lens 输出 JSON 形式跟 schema 不严格一致(新字段、缺字段、字段类型变)。

**缓解**:
- schema parsers 用 `_extra` passthrough(同 `core/models.ts`)
- 字段缺失时 fail loud(已有具体 detect 路径)
- lens-version-bump 协议把这种变化形式化(M7)

### 9.3 R3 · 同 git repo 跨 topic 让 fate 失效(E5)

**风险**: 用户在同 repo 做多个不相关 feature,fate updates 永远 "none surfaced",audit 看起来没在追踪长期演化。

**缓解**(短期):
- audit 渲染时显示 "(none surfaced — Episode N covered topic X based on file overlap)" 而非空白
- 给用户一个**手动** fate update entry 的口子(`code-journal fate add --event <id> --type reverted --note "..."`)推到 MVP-III,但 schema 已留位

**缓解**(MVP-III):
- topic-coherent arc detection(事件内容 clustering)

### 9.4 R4 · 用户多机 / 状态分裂

**风险**: 用户在多台机器写代码,`~/.code-journal/observations/` 各自分立,无 cross-machine view。

**缓解**:
- **不在 MVP-II 解** —— 框架明确单用户、单机、opt-in
- README 写明 limitation
- Phase 3+ 加 export/import(同步 obvservations 目录到 dotfiles 仓库等)

### 9.5 R5 · 用户看到 audit 后情绪反弹

**风险**: 即便框架严守 § 4 不评价、不打分,真人读到自己的 stance distribution
仍然可能不舒服(尤其 overrode 多时容易被自己解读为"太刚")。

**缓解**:
- README 一段 "How to read these audits"(明确 audit 不是 character assessment)
- audit 顶部 boilerplate 直接 inline framework § 8 valence-stripping 提示
- 第一次 compose 时 stdout 提示:"This is a mirror, not a judge."

### 9.6 R6 · 同 lens 重跑产生不同 events(E1 variance)

**风险**: 同 session 同 lens 跑两次产 6 vs 7 events,用户/系统困惑哪个是"对的"。

**缓解**:
- MVP-II 默认**每个 session 只 scan 一次**(by `session_id` dedup)
- 强制 re-scan 必须用 `code-journal sync --force-rescan --session <id>` —— 新 events append,
  旧 events 保留(event id 含 `lens_version`,re-scan with bumped version 不冲突)
- 提示用户:variance is real(E1 数字),re-scan 是诊断手段不是日常路径

---

## 10 · 重要决策记录(ADR-like)

把 grilling 阶段和 Phase 2 沉淀的不可逆决策列出来,**未来要改这些决策前,
请先读这一节** —— 它们都有具体原因,不是 arbitrary。

| # | 决策 | 由 | 不可逆性 |
|---|------|----|---------|
| ADR-1 | 三层架构(Detection / Signal Store / Audit)分离 | Q4 reframed | 高 —— 是 framework 与产品的边界 |
| ADR-2 | Audit episode-versioned & immutable;不做 live doc | Q4 | 高 —— § 8 命运追加纪律的物理形式 |
| ADR-3 | Audit scope = git repo,agent 作 facet | Q6 | 中 —— E5 surface 出 "repo ≠ arc" 隐患,Phase 3 加 topic-clustering 可演进 |
| ADR-4 | 两 lens 非交叉运行(strict + deferral) | Q7 + E4 + E6 验证 | 高 —— 互补性已实证 |
| ADR-5 | δ' audit 结构(Scope/Method/Findings/Fate/Limit/SourceIndex) | Q8 + E7 验证 | 高 |
| ADR-6 | 单 markdown 文件 audit,任意 viewer | Q8 + E7 | 高 |
| ADR-7 | cron + information-increment trigger | Q5 | 中 —— 默认阈值 10 可调 |
| ADR-8 | Future-self user model + 中性观察者纪律 | Q3 (6+2) + E7 验证 | 高 |
| ADR-9 | `claude -p` 调度子 agent(无 API key) | narrate.ts 同形 + 框架 § 13 | 中 —— R1 风险 |
| ADR-10 | Drop M4, add M6;haiku ban for production | E3 + E1 + E6 | 中 —— 经验决策 |
| ADR-11 | system **不** 主动产生跨 events meta-pattern | § 11.4 + E7 验证 reader 能自己 form | 高 —— 框架红线 |
| ADR-12 | Events / digests / audits 默认 0600,目录 0700 | § 14 #3 + E5 隐私 | 高 |

---

## 11 · MVP-III 路线图(指针,不展开)

按重要性排序的 Phase 3 候选:

1. **Topic-coherent arc detection**(replace git-repo with topic clustering as fate unit) —— E5 直接催生
2. **§ 9 二阶可预测性 dashboard** —— K-window heuristic on M6 quintile distribution; 残差时间序列 —— E6 substrate ready
3. **Manual fate annotation CLI**(`code-journal fate add ...`) —— R3 缓解 + 用户 agency
4. **真人 reader test** —— E7 用 subagent proxy,真人在 audit format stable 后做
5. **Per-project model tier 配置** —— R6 + 6.4 cost budget;某些 critical project 用 opus
6. **Audit export to PDF / HTML** —— 仅在用户实际想 share 给 coach/mentor 时再做
7. **Cross-machine sync** —— R4;不在 framework scope 但用户体验缺口
8. **Webhook / external trigger** —— 让用户在 PR merge 时主动触发 sync(可选 nudge)

---

## English Summary (for downstream agents)

**MVP-II is the production engineering of the three-layer observation
architecture validated across Phase 1 (Q1-Q9 grilling) and Phase 2
(E1-E7 experiments).** New package `packages/observation/` containing
TypeScript port of the v1/v2 experimental tooling: `digest.ts`,
`digest-codex.ts`, `lens-runner.ts` (claude -p subagent dispatch),
`compose.ts`, `store.ts` (append-only JSONL per (project, lens)),
`state.ts` (ProjectState persistence).

Three new CLI commands routed through `packages/cli/`:
`code-journal sync` (discover new sessions → dispatch isolated subagents
per lens → append events), `compose` (frozen-episode δ' markdown),
`status` (machine-readable project + signal summary).

User data lives at `~/.code-journal/observations/<project-id>/`:
state.json (ProjectState), signals/*.jsonl (append-only events), 
digests/ (cache), episodes/N-date.md (immutable audit episodes).

7 milestones, ~5 days focused work. Acceptance criteria cover
functional (8 punch-list items visible in produced audits), discipline
(no manufactured events, no system-side identity claims, immutable
episodes, append-only signals), security (0600/0700 mode), and
debugging (verbose mode, health checks).

8 ADR-like decisions sealed against future flipping without re-reading
their origin: three-layer split, episode immutability, repo scope,
non-interfering lenses, δ' format, single-markdown output, cron-driven
trigger, future-self user model, claude -p dispatch, M4/M6 replacement,
no system meta-patterns, restrictive file permissions.

Out of scope (MVP-III): topic-coherent arc detection (E5 follow-up),
§ 9 predictability dashboard (E6 substrate exists), real human reader
testing (E7 used subagent proxy), per-project model tier, multi-machine
sync, audit export to other formats.

The lens specs, digester, composer, and δ' format are all
production-ready as-is from the v1/v2 experimental work. MVP-II is
mechanical engineering on top of these, with no further framework
design needed.
