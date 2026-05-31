/**
 * Audit composer — events from signal store → frozen δ' episode markdown.
 *
 * Hard rules (from MVP-II plan + Phase 2):
 *   - Episodes are immutable once composed.
 *   - Composer is deterministic — no LLM call at this stage. Lenses
 *     already did the narrative work in each event's `payload`. The
 *     composer just lays them out in the δ' audit-report structure.
 *   - No system-side meta-pattern claims (forbidden_words check, § 11.4).
 *   - Fate updates section says "(none surfaced ...)" when there's
 *     nothing — silence is data (Phase 2 E5).
 *   - Measurements: M1, M2, M3, M5, M6 (M4 dropped per Phase 2 E3).
 *   - Anchor table before stance table (v1 wrap-up).
 *   - Same-turn cross-lens marker `↔` (v1 wrap-up).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  DIR_MODE,
  FILE_MODE,
  digestFilePath,
  episodeMarkdownPath,
  episodeMetadataPath,
  episodesDir,
} from './paths';
import {
  type AuditEpisode,
  type EpisodeSourceSignals,
  type Measurements,
  type ObservationEvent,
  type ProjectState,
  serializeAuditEpisode,
} from './schema';
import { readSignals } from './store';
import { writeProjectState } from './state';

/**
 * Words / phrases the audit must NOT contain — § 11.4 / § 4.3 red lines.
 * Composer scans the rendered markdown for these before writing and
 * throws if found. This is belt-and-suspenders: the lens prompts already
 * forbid them, but the composer is the last gate before the user sees text.
 */
const FORBIDDEN_PHRASES = [
  'user is ',
  'user tends to',
  'user prefers',
  'the user always',
  'the user habitually',
  'personality',
  'type of developer',
];

export interface ComposeArgs {
  state: ProjectState;
  cronAt?: string;
  dryRun?: boolean;
}

export type ComposeResult =
  | {
      ok: true;
      episode: AuditEpisode;
      markdown: string;
      paths: { markdown: string; metadata: string };
    }
  | { ok: false; reason: string };

export function composeAudit(args: ComposeArgs): ComposeResult {
  const { state } = args;
  const strict = readSignals(state.project_id, 'strict-negative-space');
  const deferral = readSignals(state.project_id, 'anchored-deferral');
  const pivot = readSignals(state.project_id, 'user-initiated-pivot');

  if (strict.length === 0 && deferral.length === 0 && pivot.length === 0) {
    return { ok: false, reason: 'no events in signal store; sync first' };
  }

  // Build turn maps per session from cached digests, for M2 (latency) and M6 (position).
  const sessionTurnMaps = new Map<string, TurnMap>();
  for (const sid of unique([...strict, ...deferral, ...pivot].map((e) => e.session_id))) {
    const digestPath = digestFilePath(state.project_id, sid);
    if (existsSync(digestPath)) {
      sessionTurnMaps.set(sid, parseTurnMapFromDigest(readFileSync(digestPath, 'utf8')));
    } else {
      sessionTurnMaps.set(sid, { byId: new Map(), totalTurns: 0 });
    }
  }

  const measurements = computeMeasurements(strict, deferral, sessionTurnMaps);

  // Window = activity-time covered by these events, derived from digests.
  const window = computeWindow(sessionTurnMaps);

  // Fate updates: MVP-II does not auto-detect; manual annotation is MVP-III.
  // See plan § R3 / E5 finding: "same git repo ≠ same collaboration arc";
  // empty fate is honest, not blank.
  const fateUpdates: AuditEpisode['fate_updates_surfaced'] = [];

  const composedAt = new Date().toISOString();
  const date = composedAt.slice(0, 10);
  const episodeNum = state.next_episode_number;

  const sourceSignals: EpisodeSourceSignals[] = [
    {
      lens_id: 'strict-negative-space',
      lens_version: state.config.lens_versions['strict-negative-space'],
      event_ids: strict.map((e) => e.id),
      _extra: {},
    },
    {
      lens_id: 'anchored-deferral',
      lens_version: state.config.lens_versions['anchored-deferral'],
      event_ids: deferral.map((e) => e.id),
      _extra: {},
    },
    {
      lens_id: 'user-initiated-pivot',
      lens_version: state.config.lens_versions['user-initiated-pivot'],
      event_ids: pivot.map((e) => e.id),
      _extra: {},
    },
  ];

  const episode: AuditEpisode = {
    episode: episodeNum,
    project_id: state.project_id,
    composed_at: composedAt,
    window,
    source_signals: sourceSignals,
    fate_updates_surfaced: fateUpdates,
    measurements,
    trigger: {
      cron_at: args.cronAt ?? composedAt,
      new_events_since_last: state.new_events_since_last_compose,
      threshold: state.config.compose_threshold,
      _extra: {},
    },
    audit_path: `episodes/${episodeNum}-${date}.md`,
    _extra: {},
  };

  const markdown = renderAudit(episode, strict, deferral, pivot, sessionTurnMaps, state);

  // Hard rule check before write
  const lower = markdown.toLowerCase();
  for (const bad of FORBIDDEN_PHRASES) {
    if (lower.includes(bad)) {
      return {
        ok: false,
        reason: `audit contains forbidden phrase ${JSON.stringify(bad)} — § 11.4 red line`,
      };
    }
  }

  const mdPath = episodeMarkdownPath(state.project_id, episodeNum, date);
  const metaPath = episodeMetadataPath(state.project_id, episodeNum, date);

  if (!args.dryRun) {
    ensureEpisodesDir(state.project_id);
    writeFileSync(mdPath, markdown);
    writeFileSync(metaPath, JSON.stringify(serializeAuditEpisode(episode), null, 2) + '\n');
    try {
      chmodSync(mdPath, FILE_MODE);
      chmodSync(metaPath, FILE_MODE);
    } catch {
      /* ignore on filesystems that don't support chmod */
    }
    // Update state: increment episode counter, record episode ref, reset compose counter
    const updated: ProjectState = {
      ...state,
      next_episode_number: episodeNum + 1,
      new_events_since_last_compose: 0,
      episodes: [
        ...state.episodes,
        {
          episode: episodeNum,
          composed_at: composedAt,
          event_count: strict.length + deferral.length,
          _extra: {},
        },
      ],
    };
    writeProjectState(updated);
  }

  return { ok: true, episode, markdown, paths: { markdown: mdPath, metadata: metaPath } };
}

// =============================================================================
// Rendering
// =============================================================================

/**
 * Audit section headings, per analysis language. Only the heading strings are
 * localized — the per-event lens prose carries the user's language. English is
 * the fallback for any language without a table; more can be added incrementally.
 */
function auditHeadings(lang: string): {
  method: string; measurements: string; stance: string;
  strict: string; deferral: string; pivot: string;
  fate: string; limitations: string; sources: string;
} {
  const en = {
    method: '## Method',
    measurements: '## Measurements',
    stance: "## Stance distribution (the user's response side)",
    strict: '## Findings — Strict negative-space',
    deferral: '## Findings — Anchored deferral',
    pivot: '## Findings — User-initiated pivot',
    fate: '## Fate updates',
    limitations: '## Limitations',
    sources: '## Source index',
  };
  const zh = {
    method: '## 方法',
    measurements: '## 测量',
    stance: '## 姿态分布(用户的回应侧)',
    strict: '## 发现 — 严格负空间',
    deferral: '## 发现 — 锚定姿态',
    pivot: '## 发现 — 用户自发转向',
    fate: '## 命运更新',
    limitations: '## 局限',
    sources: '## 来源索引',
  };
  return lang === 'zh' ? zh : en;
}

function renderAudit(
  episode: AuditEpisode,
  strict: ObservationEvent[],
  deferral: ObservationEvent[],
  pivot: ObservationEvent[],
  turnMaps: Map<string, TurnMap>,
  state: ProjectState,
): string {
  const h = auditHeadings(state.config.analysis_language);
  const out: string[] = [];
  const windowDisplay = episode.window.start
    ? episode.window.start === episode.window.end
      ? episode.window.start
      : `${episode.window.start} → ${episode.window.end}`
    : '(unknown range)';

  const titleWord = state.config.analysis_language === 'zh' ? '审计' : 'Audit';
  const epWord = state.config.analysis_language === 'zh' ? '第 ' + episode.episode + ' 期' : 'Episode ' + episode.episode;
  out.push(`# ${titleWord} · ${state.display_name || state.project_id} · ${epWord} · ${windowDisplay}`);
  out.push('');

  // ── Scope ────────────────────────────────────────────────────────────────
  const sessionIds = unique([...strict, ...deferral].map((e) => e.session_id));
  const agents = unique([...strict, ...deferral].map((e) => e.agent));
  out.push(state.config.analysis_language === 'zh' ? '## 范围' : '## Scope');
  out.push('');
  out.push(`- Time window: ${windowDisplay}`);
  out.push(`- Sessions covered: ${sessionIds.length}`);
  out.push(`- Agent(s) seen: ${agents.join(', ') || '(none)'}`);
  out.push(`- Total turns across covered sessions: ${totalTurns(turnMaps)}`);
  out.push(
    `- Previous episode: ${
      state.episodes.length > 0
        ? `Episode ${state.episodes[state.episodes.length - 1]?.episode}, composed ${state.episodes[state.episodes.length - 1]?.composed_at.slice(0, 10)}`
        : 'none (this is the first)'
    }`,
  );
  out.push('');

  // ── Method ───────────────────────────────────────────────────────────────
  out.push(h.method);
  out.push('');
  out.push('Two lenses run independently over each session digest, each in an isolated');
  out.push('subagent context (no cross-contamination between lenses or between projects):');
  out.push('');
  out.push(
    `- **Lens 1 — strict-negative-space** (\`${state.config.lens_versions['strict-negative-space']}\`): macro pivots where AI made a specific proposal, user did not take it, subsequent work followed a different axis.`,
  );
  out.push(
    `- **Lens 2 — anchored-deferral** (\`${state.config.lens_versions['anchored-deferral']}\`): AI salience events (direct-ask / ≥2-named-options / explicit-uncertainty) and user stance (engaged / assented / deferred / overrode / ignored — assented = bare approval, kept distinct from engaged). For \`ignored\` stance, also captures the concrete new direction.`,
    `- **Lens 3 — user-initiated-pivot** (\`${state.config.lens_versions['user-initiated-pivot']}\`): direction the user injected when the AI exposed **no** decision point — an unprompted new concern / file / requirement that subsequent work took up. Covers the collaboration mode the other two lenses structurally cannot see.`,
  );
  out.push('');
  out.push(`Trigger: cron at ${episode.trigger.cron_at.slice(0, 19)}; new events since last compose = ${episode.trigger.new_events_since_last} (threshold ${episode.trigger.threshold}).`);
  out.push('');
  out.push('**Valence-stripping reminder (§ 8)**: strict-negative-space events do **not** carry');
  out.push('valence — the same event can read as "user pulled work off AI\'s proposed axis" *or*');
  out.push('"user pulled work onto a more pressing concern" — which reading applies depends on');
  out.push('context the lens cannot see and the reader can. The audit does not pick. Stance');
  out.push('labels (engaged / assented / deferred / overrode / ignored) are observation labels, not quality');
  out.push('grades — no stance is "better".');
  out.push('');

  // ── Measurements ─────────────────────────────────────────────────────────
  const m = episode.measurements;
  out.push(h.measurements);
  out.push('');
  out.push('Intrinsic counts and durations only. No normalised scores, no cross-collaboration');
  out.push('comparison. Reader attaches meaning.');
  out.push('');
  out.push('| ID | Measurement | Value | What it counts (not what it means) |');
  out.push('| -- | ----------- | ----- | ---------------------------------- |');
  out.push(
    `| M1 | Anchor density | ${deferral.length} anchors / ${totalTurns(turnMaps)} turns = **${m.m1_anchor_density_per_100t.toFixed(2)} per 100 turns** | How often this agent on this project exposed an explicit decision-point. Property of the agent's questioning style, not the user. |`,
  );
  out.push(
    `| M2 | Response latency | n=${m.m2_latency_seconds.n} · min=${fmtDur(m.m2_latency_seconds.min)} · median=${fmtDur(m.m2_latency_seconds.median)} · max=${fmtDur(m.m2_latency_seconds.max)} | Wall-clock time from AI anchor to next user message. Long latencies = thought OR distraction OR away-from-keyboard — lens does not distinguish. |`,
  );
  const pmStr =
    m.m3_pivot_magnitudes.length > 0
      ? m.m3_pivot_magnitudes.map((p) => `T${p.turn}: ${p.artifact_count}`).join(' · ')
      : '(no strict events)';
  out.push(
    `| M3 | Pivot magnitude (strict) | ${pmStr} | Count of \`backtick-quoted\` artifacts (file paths, commit shas, commands) named in each strict event's After section. |`,
  );
  out.push(
    `| M5 | Lens convergence | ${m.m5_convergence.convergent} / ${m.m5_convergence.total_strict} strict events share a primary turn with a deferral anchor | When both lenses fire on the same turn the moment has both (a) explicit AI decision-point AND (b) macro pivot. |`,
  );
  out.push(
    `| M6 | Anchor position (quintiles) | [${m.m6_anchor_positions.quintile_distribution.join(', ')}] · bimodality=${m.m6_anchor_positions.bimodality_score.toFixed(2)} | Distribution of anchor turn positions normalised to [0,1] of session length. Phase 2 E6 found ~73% of anchors land in first or last quintile — bimodality score > 0.6 means similar pattern here. |`,
  );
  out.push('');
  out.push('Each row is a **measurement** in the strict sense: if a different collaboration had identical values, the row would say identical things. No row says "high" or "low" or "your" — those would be evaluations.');
  out.push('');

  // ── Anchor distribution (BEFORE stance — v1 wrap-up punch list) ─────────
  const anchorTypes = countAnchorTypes(deferral);
  out.push(state.config.analysis_language === 'zh' ? '## 锚点分布(AI 决策点)' : "## Anchor distribution (the agent's salience-event side)");
  out.push('');
  out.push(`Total anchors: ${deferral.length} (${m.m1_anchor_density_per_100t.toFixed(2)} per 100 turns).`);
  out.push('');
  out.push('| Anchor type            | Count |');
  out.push('| ---------------------- | ----- |');
  out.push(`| direct-ask             | ${anchorTypes['direct-ask']} |`);
  out.push(`| ≥2-named-options       | ${anchorTypes['≥2-named-options']} |`);
  out.push(`| explicit-uncertainty   | ${anchorTypes['explicit-uncertainty']} |`);
  out.push('');
  out.push(
    '> This table is shown **before** the stance distribution on purpose: the stance counts below are conditional on these anchors existing. A user who looks "less engaged" may simply be in a session where the agent exposed fewer explicit decisions.',
  );
  out.push('');

  // ── Stance distribution ─────────────────────────────────────────────────
  const stances = countStances(deferral);
  out.push(h.stance);
  out.push('');
  out.push('Counts, not rates. Reported as a 5-tuple to preserve shape.');
  out.push('');
  out.push('Direction was **injected** in engaged / overrode / ignored, and **declined** in');
  out.push('assented / deferred — `assented` (bare approval of the AI\'s proposal) is kept');
  out.push('separate from `engaged` (the user substantively shaped the decision) so approval');
  out.push("does not read as engagement.");
  out.push('');
  out.push('| Stance     | Count | direction |');
  out.push('| ---------- | ----- | --------- |');
  out.push(`| engaged    | ${stances.engaged} | injected |`);
  out.push(`| overrode   | ${stances.overrode} | injected |`);
  out.push(`| ignored    | ${stances.ignored} | injected (elsewhere) |`);
  out.push(`| assented   | ${stances.assented} | declined |`);
  out.push(`| deferred   | ${stances.deferred} | declined |`);
  out.push('');
  out.push(
    `**Shape**: (e=${stances.engaged}, a=${stances.assented}, d=${stances.deferred}, o=${stances.overrode}, i=${stances.ignored}).`,
  );
  out.push('');

  // ── Findings — strict ────────────────────────────────────────────────────
  out.push(h.strict);
  out.push('');
  if (strict.length === 0) {
    out.push('**EMPTY-STATE**: no strict-negative-space events surfaced in this episode.');
    out.push('');
  } else {
    out.push(`${strict.length} event${strict.length === 1 ? '' : 's'} found.`);
    out.push('');
    const deferralTurns = new Set(deferral.map((d) => d.primary_turn));
    for (let i = 0; i < strict.length; i++) {
      const ev = strict[i];
      if (!ev) continue;
      const convergent = deferralTurns.has(ev.primary_turn);
      const convergentSuffix = convergent ? ' ↔ deferral anchor at same turn' : '';
      out.push(`### Strict event ${i + 1} · turns ${ev.turn_anchor}${convergentSuffix}`);
      out.push('');
      out.push(ev.payload);
      out.push('');
      out.push(`*Source refs*: ${formatSourceRefs(ev.source_refs)}`);
      out.push('');
      out.push('---');
      out.push('');
    }
  }

  // ── Findings — anchored deferral ─────────────────────────────────────────
  out.push(h.deferral);
  out.push('');
  if (deferral.length === 0) {
    out.push('**EMPTY-STATE**: no anchored-deferral events surfaced in this episode.');
    out.push('');
  } else {
    out.push(`${deferral.length} anchor event${deferral.length === 1 ? '' : 's'} found.`);
    out.push('');
    const strictTurns = new Set(strict.map((s) => s.primary_turn));
    out.push('### Per-anchor detail');
    out.push('');
    for (let i = 0; i < deferral.length; i++) {
      const ev = deferral[i];
      if (!ev) continue;
      const convergent = strictTurns.has(ev.primary_turn);
      const convergentSuffix = convergent ? ' ↔ strict event at same turn' : '';
      out.push(`#### Anchor ${i + 1} · turn ${ev.turn_anchor}${convergentSuffix}`);
      out.push('');
      out.push(ev.payload);
      out.push('');
      const turnMap = turnMaps.get(ev.session_id);
      const latency = turnMap ? nextUserResponseLatency(ev.primary_turn, turnMap) : null;
      if (latency != null) {
        out.push(`*Measurement*: response latency = ${fmtDur(latency)}`);
      }
      out.push(`*Source refs*: ${formatSourceRefs(ev.source_refs)}`);
      out.push('');
    }
  }

  // ── Findings — user-initiated pivot ──────────────────────────────────────
  out.push(h.pivot);
  out.push('');
  out.push('Direction the user injected where the AI exposed no decision point.');
  out.push('');
  // Leg-1 cross-lens guard: a pivot event whose turn coincides with a deferral
  // anchor is invalid — a deferral anchor IS an AI fork, so by definition the
  // user was not pivoting off "no decision point". Suppress it mechanically
  // rather than trusting the lens's self-check (same spirit as the grounding gate).
  const deferralAnchorTurns = new Set(deferral.map((d) => d.primary_turn));
  const pivotShown = pivot.filter((ev) => !deferralAnchorTurns.has(ev.primary_turn));
  const pivotSuppressed = pivot.length - pivotShown.length;
  if (pivotShown.length === 0) {
    out.push('**EMPTY-STATE**: no user-initiated-pivot events surfaced in this episode.');
    if (pivotSuppressed > 0) {
      out.push('');
      out.push(`(${pivotSuppressed} candidate${pivotSuppressed === 1 ? '' : 's'} suppressed as coinciding with a deferral anchor — an AI fork existed there, so the moment is owned by anchored-deferral.)`);
    }
    out.push('');
  } else {
    out.push(`${pivotShown.length} event${pivotShown.length === 1 ? '' : 's'} found.`);
    if (pivotSuppressed > 0) {
      out.push(`(${pivotSuppressed} candidate${pivotSuppressed === 1 ? '' : 's'} suppressed as coinciding with a deferral anchor.)`);
    }
    out.push('');
    for (let i = 0; i < pivotShown.length; i++) {
      const ev = pivotShown[i];
      if (!ev) continue;
      out.push(`### Pivot event ${i + 1} · turns ${ev.turn_anchor}`);
      out.push('');
      out.push(ev.payload);
      out.push('');
      out.push(`*Source refs*: ${formatSourceRefs(ev.source_refs)}`);
      out.push('');
      out.push('---');
      out.push('');
    }
  }

  // ── Fate updates ─────────────────────────────────────────────────────────
  out.push('---');
  out.push('');
  out.push(h.fate);
  out.push('');
  if (episode.fate_updates_surfaced.length === 0) {
    if (state.episodes.length === 0) {
      out.push('This is the first audit episode for this project — no prior events to update.');
    } else {
      out.push(
        '(none surfaced — Episode ' +
          episode.episode +
          " 's events did not detectably touch any prior episode's events. Per Phase 2 E5 finding: same git repo does not always mean same collaboration arc; silence here is honest, not blank.)",
      );
    }
  } else {
    out.push(`${episode.fate_updates_surfaced.length} fate update${episode.fate_updates_surfaced.length === 1 ? '' : 's'} surfaced from prior episodes:`);
    for (const f of episode.fate_updates_surfaced) {
      out.push(`- **${f.type}** detected in episode ${f.detected_in_episode}: ${describeRef(f.evidence_ref)}`);
    }
  }
  out.push('');
  out.push('Old events are append-only; their fate accrues but the original event records do not change. (§ 8)');
  out.push('');

  // ── Limitations ──────────────────────────────────────────────────────────
  out.push(h.limitations);
  out.push('');
  out.push('- **Recall is not validated.** Lens precision verified by participant review; how many events the lens *missed* is structurally unverifiable from precision-only checks (§ 14.1).');
  out.push('- **Run-to-run variance is real.** Stance counts can vary ±30% across re-scans of the same digest (Phase 2 E1, especially in the `overrode` and `engaged` categories). Treat single-run numbers as one sample, not ground truth.');
  out.push('- **Lens coverage is bounded.** Three lenses run (strict-negative-space, anchored-deferral, user-initiated-pivot); phenomena outside their definitions are invisible.');
  out.push('- **Fate-tracking is manual in MVP-II.** This audit does not auto-detect fate evolution of prior events; that requires topic-coherent arc detection (planned for MVP-III).');
  out.push('');

  // ── Source index ─────────────────────────────────────────────────────────
  out.push(h.sources);
  out.push('');
  out.push(`- Project: \`${state.project_id}\``);
  out.push(`- Sessions in this episode (${sessionIds.length}):`);
  for (const sid of sessionIds) {
    const tm = turnMaps.get(sid);
    const turnCount = tm?.totalTurns ?? '?';
    out.push(`  - \`${sid}\` (${turnCount} turns) — digest at \`digests/${sid}.md\``);
  }
  out.push(`- Episode metadata: \`${episode.audit_path.replace('.md', '.json')}\``);
  out.push(`- Raw events (gitignored — verbatim user/AI text): \`signals/strict-negative-space.jsonl\` + \`signals/anchored-deferral.jsonl\``);
  out.push('');

  return out.join('\n');
}

// =============================================================================
// Measurement computation
// =============================================================================

export function computeMeasurements(
  strict: ObservationEvent[],
  deferral: ObservationEvent[],
  turnMaps: Map<string, TurnMap>,
): Measurements {
  const total = totalTurns(turnMaps);
  const m1 = total > 0 ? (deferral.length / total) * 100 : 0;

  // M2 latency
  const latencies: number[] = [];
  for (const ev of deferral) {
    const tm = turnMaps.get(ev.session_id);
    if (!tm) continue;
    const lat = nextUserResponseLatency(ev.primary_turn, tm);
    if (lat != null) latencies.push(lat);
  }
  latencies.sort((a, b) => a - b);

  // M3 pivot magnitudes
  const pivots = strict.map((ev) => ({
    turn: ev.primary_turn,
    artifact_count: countBackticked(extractAfterSection(ev.payload)),
  }));

  // M5 lens convergence
  const strictPrimary = new Set(strict.map((e) => e.primary_turn));
  const deferralAnchors = new Set(deferral.map((e) => e.primary_turn));
  const convergent = [...strictPrimary].filter((t) => deferralAnchors.has(t)).length;

  // M6 anchor positions (deferral anchors only, position normalised per-session)
  const quintiles = [0, 0, 0, 0, 0];
  let positionsCount = 0;
  for (const ev of deferral) {
    const tm = turnMaps.get(ev.session_id);
    if (!tm || tm.totalTurns === 0) continue;
    const pos = ev.primary_turn / tm.totalTurns;
    const bucket = Math.min(4, Math.floor(pos * 5));
    const cur = quintiles[bucket];
    quintiles[bucket] = (cur ?? 0) + 1;
    positionsCount++;
  }
  const bimodality =
    positionsCount > 0 ? ((quintiles[0] ?? 0) + (quintiles[4] ?? 0)) / positionsCount : 0;

  return {
    m1_anchor_density_per_100t: round2(m1),
    m2_latency_seconds: {
      n: latencies.length,
      min: latencies.length > 0 ? round2(latencies[0] ?? 0) : null,
      median: latencies.length > 0 ? round2(median(latencies)) : null,
      max: latencies.length > 0 ? round2(latencies[latencies.length - 1] ?? 0) : null,
    },
    m3_pivot_magnitudes: pivots,
    m5_convergence: { convergent, total_strict: strict.length },
    m6_anchor_positions: {
      quintile_distribution: quintiles,
      bimodality_score: round2(bimodality),
    },
    _extra: {},
  };
}

// =============================================================================
// Helpers
// =============================================================================

export interface TurnMap {
  byId: Map<number, { role: string; ts: number | null }>;
  totalTurns: number;
}

/**
 * Parse digest markdown to recover turn-id → {role, ts} map.
 * Looks for headers like `**T<n> · <role> (<kind>) · @<iso-ts>**`.
 */
export function parseTurnMapFromDigest(digest: string): TurnMap {
  const byId = new Map<number, { role: string; ts: number | null }>();
  const re = /^\*\*T(\d+) · (\w+) \([^)]*\)(?: · @([0-9TZ:.\-]+))?\*\*/gm;
  let m: RegExpExecArray | null;
  let maxId = 0;
  while ((m = re.exec(digest)) !== null) {
    const id = parseInt(m[1] ?? '0', 10);
    const role = m[2] ?? '';
    const ts = m[3] ? new Date(m[3]).getTime() : null;
    if (!byId.has(id)) byId.set(id, { role, ts });
    if (id > maxId) maxId = id;
  }
  return { byId, totalTurns: maxId };
}

function nextUserResponseLatency(afterTurn: number, tm: TurnMap): number | null {
  const ids = [...tm.byId.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    if (id <= afterTurn) continue;
    const t = tm.byId.get(id);
    if (!t) continue;
    if (t.role === 'user') {
      const anchor = tm.byId.get(afterTurn);
      if (!anchor || anchor.ts == null || t.ts == null) return null;
      return (t.ts - anchor.ts) / 1000; // seconds
    }
  }
  return null;
}

function countAnchorTypes(deferral: ObservationEvent[]): {
  'direct-ask': number;
  '≥2-named-options': number;
  'explicit-uncertainty': number;
} {
  const out = { 'direct-ask': 0, '≥2-named-options': 0, 'explicit-uncertainty': 0 };
  for (const ev of deferral) {
    const m = /\*\*Anchor \(AI salience event\)\*\*:\s*([^\n*]+)/.exec(ev.payload);
    if (!m) continue;
    const t = (m[1] ?? '').trim();
    if (t === 'direct-ask' || t === '≥2-named-options' || t === 'explicit-uncertainty') {
      out[t] += 1;
    }
  }
  return out;
}

function countStances(deferral: ObservationEvent[]): {
  engaged: number;
  assented: number;
  deferred: number;
  overrode: number;
  ignored: number;
} {
  const out = { engaged: 0, assented: 0, deferred: 0, overrode: 0, ignored: 0 };
  for (const ev of deferral) {
    const m = /\*\*Stance\*\*:\s*(engaged|assented|deferred|overrode|ignored)/.exec(ev.payload);
    if (!m) continue;
    out[m[1] as keyof typeof out] += 1;
  }
  return out;
}

function extractAfterSection(payload: string): string {
  const m = /\*\*After — concrete artifacts\*\*:\s*([\s\S]*?)(?:\n\n\*\*Why|$)/.exec(payload);
  return m && m[1] ? m[1] : '';
}

function countBackticked(s: string): number {
  return (s.match(/`[^`\n]+`/g) ?? []).length;
}

function totalTurns(turnMaps: Map<string, TurnMap>): number {
  let sum = 0;
  for (const tm of turnMaps.values()) sum += tm.totalTurns;
  return sum;
}

function computeWindow(turnMaps: Map<string, TurnMap>): { start: string; end: string } {
  let minTs: number | null = null;
  let maxTs: number | null = null;
  for (const tm of turnMaps.values()) {
    for (const t of tm.byId.values()) {
      if (t.ts == null) continue;
      if (minTs === null || t.ts < minTs) minTs = t.ts;
      if (maxTs === null || t.ts > maxTs) maxTs = t.ts;
    }
  }
  if (minTs === null || maxTs === null) return { start: '', end: '' };
  return {
    start: new Date(minTs).toISOString().slice(0, 10),
    end: new Date(maxTs).toISOString().slice(0, 10),
  };
}

function formatSourceRefs(refs: ObservationEvent['source_refs']): string {
  if (refs.length === 0) return '(none recorded)';
  return refs
    .map((r) => {
      switch (r.type) {
        case 'turn':
          return `turn T${r.id}`;
        case 'turn-range':
          return `turns T${r.from}-T${r.to}`;
        case 'commit':
          return `commit ${r.sha}`;
        case 'file':
          return `file ${r.path}`;
      }
    })
    .join(', ');
}

function describeRef(r: ObservationEvent['source_refs'][0]): string {
  switch (r.type) {
    case 'turn':
      return `turn T${r.id} in ${r.session_id}`;
    case 'turn-range':
      return `turns T${r.from}-T${r.to} in ${r.session_id}`;
    case 'commit':
      return `commit ${r.sha}`;
    case 'file':
      return `file ${r.path}`;
  }
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? (arr[m] ?? 0) : ((arr[m - 1] ?? 0) + (arr[m] ?? 0)) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtDur(seconds: number | null): string {
  if (seconds == null) return 'n/a';
  if (seconds < 0) return '(neg)';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function ensureEpisodesDir(projectId: string): void {
  const dir = episodesDir(projectId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try {
      chmodSync(dir, DIR_MODE);
    } catch {
      /* ignore */
    }
  }
}
