/**
 * Observation domain types — Event / FateUpdate / SourceRef / AuditEpisode /
 * ProjectState / Measurements / lens identifiers.
 *
 * Same parse/serialize/_extra-passthrough discipline as
 * @code-journal/core's models.ts:
 *   - parseX validates + fills defaults + captures unknown keys into `_extra`
 *   - serializeX emits the JSON-friendly dict; optional fields omitted when absent
 *   - unknown top-level keys ride `_extra` and round-trip losslessly
 *     (forward-compat: future schema bumps don't break old records)
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

// -----------------------------------------------------------------------------
// Lens identifiers
// -----------------------------------------------------------------------------

export type LensId = 'strict-negative-space' | 'anchored-deferral' | 'user-initiated-pivot';

export const LENS_IDS: readonly LensId[] = [
  'strict-negative-space',
  'anchored-deferral',
  'user-initiated-pivot',
] as const;

export function isLensId(v: unknown): v is LensId {
  return (
    v === 'strict-negative-space' || v === 'anchored-deferral' || v === 'user-initiated-pivot'
  );
}

export type AgentId = 'claude-code' | 'codex' | 'cowork';

export function isAgentId(v: unknown): v is AgentId {
  return v === 'claude-code' || v === 'codex' || v === 'cowork';
}

// -----------------------------------------------------------------------------
// SourceRef — pointer back to the evidence in raw transcripts / git history
// -----------------------------------------------------------------------------

export type SourceRef =
  | { type: 'turn'; id: number; session_id: string }
  | { type: 'turn-range'; from: number; to: number; session_id: string }
  | { type: 'commit'; sha: string }
  | { type: 'file'; path: string };

export function parseSourceRef(d: JsonObject): SourceRef {
  const t = d.type;
  if (t === 'turn') {
    return { type: 'turn', id: Number(d.id), session_id: String(d.session_id ?? '') };
  }
  if (t === 'turn-range') {
    return {
      type: 'turn-range',
      from: Number(d.from),
      to: Number(d.to),
      session_id: String(d.session_id ?? ''),
    };
  }
  if (t === 'commit') {
    return { type: 'commit', sha: String(d.sha ?? '') };
  }
  if (t === 'file') {
    return { type: 'file', path: String(d.path ?? '') };
  }
  throw new Error(`SourceRef: unknown type ${JSON.stringify(t)}`);
}

export function serializeSourceRef(r: SourceRef): JsonObject {
  switch (r.type) {
    case 'turn':
      return { type: 'turn', id: r.id, session_id: r.session_id };
    case 'turn-range':
      return { type: 'turn-range', from: r.from, to: r.to, session_id: r.session_id };
    case 'commit':
      return { type: 'commit', sha: r.sha };
    case 'file':
      return { type: 'file', path: r.path };
  }
}

// -----------------------------------------------------------------------------
// FateUpdate — append-only sub-stream on Events (§ 8)
// -----------------------------------------------------------------------------

export type FateType = 'maintained' | 'expanded' | 'user_reframed' | 'reverted' | 'caused_rework';

const FATE_TYPES = new Set<FateType>([
  'maintained',
  'expanded',
  'user_reframed',
  'reverted',
  'caused_rework',
]);

export function isFateType(v: unknown): v is FateType {
  return typeof v === 'string' && FATE_TYPES.has(v as FateType);
}

export interface FateUpdate {
  type: FateType;
  detected_at: string;
  detected_in_episode: number;
  evidence_ref: SourceRef;
  user_note?: string;
  _extra: JsonObject;
}

const FATE_KNOWN = new Set([
  'type',
  'detected_at',
  'detected_in_episode',
  'evidence_ref',
  'user_note',
]);

export function parseFateUpdate(d: JsonObject): FateUpdate {
  if (!isFateType(d.type)) {
    throw new Error(`FateUpdate: invalid type ${JSON.stringify(d.type)}`);
  }
  if (!d.evidence_ref || typeof d.evidence_ref !== 'object') {
    throw new Error('FateUpdate: evidence_ref is required');
  }
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!FATE_KNOWN.has(k)) extra[k] = v;
  const out: FateUpdate = {
    type: d.type,
    detected_at: String(d.detected_at ?? ''),
    detected_in_episode: Number(d.detected_in_episode ?? 0),
    evidence_ref: parseSourceRef(d.evidence_ref as JsonObject),
    _extra: extra,
  };
  if (typeof d.user_note === 'string' && d.user_note.length > 0) {
    out.user_note = d.user_note;
  }
  return out;
}

export function serializeFateUpdate(f: FateUpdate): JsonObject {
  const out: JsonObject = {
    type: f.type,
    detected_at: f.detected_at,
    detected_in_episode: f.detected_in_episode,
    evidence_ref: serializeSourceRef(f.evidence_ref),
  };
  if (f.user_note !== undefined) out.user_note = f.user_note;
  for (const [k, v] of Object.entries(f._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// ObservationEvent — the unit produced by a lens scan
// -----------------------------------------------------------------------------

export interface ObservationEvent {
  /** Stable across runs: fnv hash of (project_id, session_id, lens_id, turn_anchor) */
  id: string;
  lens_id: LensId;
  lens_version: string;
  project_id: string;
  session_id: string;
  turn_anchor: string; // 'T42' or 'T25-T52'
  primary_turn: number; // first turn in range, for cross-lens convergence
  timespan: { start: string; end: string } | null;
  source_refs: SourceRef[];
  payload: string; // markdown — lens-specific 5-section card or stance card
  detected_at: string;
  agent: AgentId;
  /** Append-only fate sub-stream — empty on first detection */
  fate: FateUpdate[];
  /** Forward-compat passthrough */
  _extra: JsonObject;
}

const EVENT_KNOWN = new Set([
  'id',
  'lens_id',
  'lens_version',
  'project_id',
  'session_id',
  'turn_anchor',
  'primary_turn',
  'timespan',
  'source_refs',
  'payload',
  'detected_at',
  'agent',
  'fate',
]);

export function parseObservationEvent(d: JsonObject): ObservationEvent {
  for (const req of ['id', 'lens_id', 'project_id', 'session_id', 'turn_anchor', 'payload']) {
    if (!(req in d)) throw new Error(`ObservationEvent: ${JSON.stringify(req)} is required`);
  }
  if (!isLensId(d.lens_id)) {
    throw new Error(`ObservationEvent: invalid lens_id ${JSON.stringify(d.lens_id)}`);
  }
  if (!isAgentId(d.agent)) {
    // Default to claude-code for back-compat — early events may pre-date agent stamping
    // (we won't have any in practice, but the parser stays forgiving)
  }
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!EVENT_KNOWN.has(k)) extra[k] = v;
  const turnAnchor = String(d.turn_anchor);
  const primaryTurn = d.primary_turn !== undefined ? Number(d.primary_turn) : extractPrimaryTurn(turnAnchor);
  return {
    id: String(d.id),
    lens_id: d.lens_id,
    lens_version: String(d.lens_version ?? 'unversioned'),
    project_id: String(d.project_id),
    session_id: String(d.session_id),
    turn_anchor: turnAnchor,
    primary_turn: primaryTurn,
    timespan: parseTimespan(d.timespan),
    source_refs: asList(d.source_refs).map((s) => parseSourceRef(s as JsonObject)),
    payload: String(d.payload),
    detected_at: String(d.detected_at ?? ''),
    agent: isAgentId(d.agent) ? d.agent : 'claude-code',
    fate: asList(d.fate).map((f) => parseFateUpdate(f as JsonObject)),
    _extra: extra,
  };
}

export function serializeObservationEvent(e: ObservationEvent): JsonObject {
  const out: JsonObject = {
    id: e.id,
    lens_id: e.lens_id,
    lens_version: e.lens_version,
    project_id: e.project_id,
    session_id: e.session_id,
    turn_anchor: e.turn_anchor,
    primary_turn: e.primary_turn,
    timespan: e.timespan ? { start: e.timespan.start, end: e.timespan.end } : null,
    source_refs: e.source_refs.map(serializeSourceRef),
    payload: e.payload,
    detected_at: e.detected_at,
    agent: e.agent,
    fate: e.fate.map(serializeFateUpdate),
  };
  for (const [k, v] of Object.entries(e._extra)) out[k] = v;
  return out;
}

/**
 * Compute the stable event id from its inputs. Two events with the same
 * (project, session, lens, turn_anchor) MUST produce the same id, so the
 * append-only store can dedup re-scans.
 *
 * Note: lens_version is intentionally NOT included — a re-scan with a
 * bumped lens version produces a *different* event id, so old + new
 * coexist and the audit can show both.
 */
export function computeEventId(parts: {
  project_id: string;
  session_id: string;
  lens_id: LensId;
  turn_anchor: string;
  lens_version: string;
}): string {
  const base = `${parts.project_id}|${parts.session_id}|${parts.lens_id}|${parts.turn_anchor}|${parts.lens_version}`;
  return 'ev_' + fnv(base);
}

// -----------------------------------------------------------------------------
// Measurements (M1, M2, M3, M5, M6) — see Phase 2 E3 verdict, drops M4
// -----------------------------------------------------------------------------

export interface Measurements {
  /** M1 — anchor density per 100 turns (deferral events / digest turns × 100) */
  m1_anchor_density_per_100t: number;
  /** M2 — wall-clock response latency stats (seconds) */
  m2_latency_seconds: {
    n: number;
    min: number | null;
    median: number | null;
    max: number | null;
  };
  /** M3 — pivot magnitude per strict event (count of backtick-quoted artifacts in After section) */
  m3_pivot_magnitudes: Array<{ turn: number; artifact_count: number }>;
  /** M5 — lens convergence (strict primary turns ∩ deferral anchor turns) */
  m5_convergence: { convergent: number; total_strict: number };
  /** M6 — anchor position quintile distribution, normalised to [0, 1] */
  m6_anchor_positions: {
    quintile_distribution: number[]; // length 5, counts per [0-0.2, 0.2-0.4, ..., 0.8-1.0]
    bimodality_score: number; // (q[0] + q[4]) / total — 1.0 = fully bimodal
  };
  _extra: JsonObject;
}

const MEAS_KNOWN = new Set([
  'm1_anchor_density_per_100t',
  'm2_latency_seconds',
  'm3_pivot_magnitudes',
  'm5_convergence',
  'm6_anchor_positions',
]);

export function parseMeasurements(d: JsonObject): Measurements {
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!MEAS_KNOWN.has(k)) extra[k] = v;

  const m2raw = (d.m2_latency_seconds ?? {}) as JsonObject;
  const m5raw = (d.m5_convergence ?? {}) as JsonObject;
  const m6raw = (d.m6_anchor_positions ?? {}) as JsonObject;
  const m6quint = asList(m6raw.quintile_distribution).map((x) => Number(x));

  return {
    m1_anchor_density_per_100t: Number(d.m1_anchor_density_per_100t ?? 0),
    m2_latency_seconds: {
      n: Number(m2raw.n ?? 0),
      min: m2raw.min === null || m2raw.min === undefined ? null : Number(m2raw.min),
      median: m2raw.median === null || m2raw.median === undefined ? null : Number(m2raw.median),
      max: m2raw.max === null || m2raw.max === undefined ? null : Number(m2raw.max),
    },
    m3_pivot_magnitudes: asList(d.m3_pivot_magnitudes).map((x) => {
      const o = x as JsonObject;
      return { turn: Number(o.turn ?? 0), artifact_count: Number(o.artifact_count ?? 0) };
    }),
    m5_convergence: {
      convergent: Number(m5raw.convergent ?? 0),
      total_strict: Number(m5raw.total_strict ?? 0),
    },
    m6_anchor_positions: {
      quintile_distribution: m6quint.length === 5 ? m6quint : [0, 0, 0, 0, 0],
      bimodality_score: Number(m6raw.bimodality_score ?? 0),
    },
    _extra: extra,
  };
}

export function serializeMeasurements(m: Measurements): JsonObject {
  const out: JsonObject = {
    m1_anchor_density_per_100t: m.m1_anchor_density_per_100t,
    m2_latency_seconds: {
      n: m.m2_latency_seconds.n,
      min: m.m2_latency_seconds.min,
      median: m.m2_latency_seconds.median,
      max: m.m2_latency_seconds.max,
    },
    m3_pivot_magnitudes: m.m3_pivot_magnitudes.map((p) => ({
      turn: p.turn,
      artifact_count: p.artifact_count,
    })),
    m5_convergence: {
      convergent: m.m5_convergence.convergent,
      total_strict: m.m5_convergence.total_strict,
    },
    m6_anchor_positions: {
      quintile_distribution: [...m.m6_anchor_positions.quintile_distribution],
      bimodality_score: m.m6_anchor_positions.bimodality_score,
    },
  };
  for (const [k, v] of Object.entries(m._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// AuditEpisode — one frozen audit, persisted as `episodes/<N>-<date>.json`
//                with the rendered markdown adjacent at `episodes/<N>-<date>.md`
// -----------------------------------------------------------------------------

export interface EpisodeSourceSignals {
  lens_id: LensId;
  lens_version: string;
  event_ids: string[];
  _extra: JsonObject;
}

export interface EpisodeTrigger {
  cron_at: string;
  new_events_since_last: number;
  threshold: number;
  _extra: JsonObject;
}

export interface AuditEpisode {
  episode: number;
  project_id: string;
  composed_at: string;
  window: { start: string; end: string };
  source_signals: EpisodeSourceSignals[];
  fate_updates_surfaced: FateUpdate[];
  measurements: Measurements;
  trigger: EpisodeTrigger;
  audit_path: string;
  _extra: JsonObject;
}

const EPISODE_KNOWN = new Set([
  'episode',
  'project_id',
  'composed_at',
  'window',
  'source_signals',
  'fate_updates_surfaced',
  'measurements',
  'trigger',
  'audit_path',
]);

export function parseAuditEpisode(d: JsonObject): AuditEpisode {
  for (const req of ['episode', 'project_id', 'composed_at', 'window']) {
    if (!(req in d)) throw new Error(`AuditEpisode: ${JSON.stringify(req)} is required`);
  }
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!EPISODE_KNOWN.has(k)) extra[k] = v;
  const window = d.window as JsonObject;
  return {
    episode: Number(d.episode),
    project_id: String(d.project_id),
    composed_at: String(d.composed_at),
    window: { start: String(window.start ?? ''), end: String(window.end ?? '') },
    source_signals: asList(d.source_signals).map((s) => parseEpisodeSourceSignals(s as JsonObject)),
    fate_updates_surfaced: asList(d.fate_updates_surfaced).map((f) =>
      parseFateUpdate(f as JsonObject),
    ),
    measurements: parseMeasurements((d.measurements ?? {}) as JsonObject),
    trigger: parseEpisodeTrigger((d.trigger ?? {}) as JsonObject),
    audit_path: String(d.audit_path ?? ''),
    _extra: extra,
  };
}

export function serializeAuditEpisode(e: AuditEpisode): JsonObject {
  const out: JsonObject = {
    episode: e.episode,
    project_id: e.project_id,
    composed_at: e.composed_at,
    window: { start: e.window.start, end: e.window.end },
    source_signals: e.source_signals.map(serializeEpisodeSourceSignals),
    fate_updates_surfaced: e.fate_updates_surfaced.map(serializeFateUpdate),
    measurements: serializeMeasurements(e.measurements),
    trigger: serializeEpisodeTrigger(e.trigger),
    audit_path: e.audit_path,
  };
  for (const [k, v] of Object.entries(e._extra)) out[k] = v;
  return out;
}

function parseEpisodeSourceSignals(d: JsonObject): EpisodeSourceSignals {
  if (!isLensId(d.lens_id)) {
    throw new Error(`EpisodeSourceSignals: invalid lens_id ${JSON.stringify(d.lens_id)}`);
  }
  const known = new Set(['lens_id', 'lens_version', 'event_ids']);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!known.has(k)) extra[k] = v;
  return {
    lens_id: d.lens_id,
    lens_version: String(d.lens_version ?? 'unversioned'),
    event_ids: asStringList(d.event_ids),
    _extra: extra,
  };
}

function serializeEpisodeSourceSignals(s: EpisodeSourceSignals): JsonObject {
  const out: JsonObject = {
    lens_id: s.lens_id,
    lens_version: s.lens_version,
    event_ids: [...s.event_ids],
  };
  for (const [k, v] of Object.entries(s._extra)) out[k] = v;
  return out;
}

function parseEpisodeTrigger(d: JsonObject): EpisodeTrigger {
  const known = new Set(['cron_at', 'new_events_since_last', 'threshold']);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!known.has(k)) extra[k] = v;
  return {
    cron_at: String(d.cron_at ?? ''),
    new_events_since_last: Number(d.new_events_since_last ?? 0),
    threshold: Number(d.threshold ?? 0),
    _extra: extra,
  };
}

function serializeEpisodeTrigger(t: EpisodeTrigger): JsonObject {
  const out: JsonObject = {
    cron_at: t.cron_at,
    new_events_since_last: t.new_events_since_last,
    threshold: t.threshold,
  };
  for (const [k, v] of Object.entries(t._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// ProjectState — per-project runtime state, persisted as `state.json`
// -----------------------------------------------------------------------------

export interface ProjectStateConfig {
  /** Default 10. § 5 grilling settled on loose default; users can tune later. */
  compose_threshold: number;
  /** Pinned per project so re-scans use the right prompts */
  lens_versions: { [K in LensId]: string };
  /** § 6.4: haiku is banned for production; default sonnet */
  model: 'sonnet' | 'opus';
  /**
   * Language the lenses write their PROSE in (Arc/Before/After/Why/empty-state).
   * Structural tokens, stance keywords, and verbatim quotes are never translated.
   * A code from LANGUAGES (default 'en'). See language.ts.
   */
  analysis_language: string;
  /**
   * When true, first sync may overwrite analysis_language by detecting the user's
   * language from their own turns. Set false once a user pins it in Settings.
   */
  analysis_language_auto: boolean;
  _extra: JsonObject;
}

export interface ProjectStateLastScan {
  at: string;
  sessions_scanned: string[];
  _extra: JsonObject;
}

export interface ProjectStateEpisodeRef {
  episode: number;
  composed_at: string;
  event_count: number;
  _extra: JsonObject;
}

export interface ProjectState {
  project_id: string;
  display_name: string;
  agent_seen: AgentId[];
  last_scan: ProjectStateLastScan;
  episodes: ProjectStateEpisodeRef[];
  next_episode_number: number;
  new_events_since_last_compose: number;
  config: ProjectStateConfig;
  _extra: JsonObject;
}

const PROJECT_STATE_KNOWN = new Set([
  'project_id',
  'display_name',
  'agent_seen',
  'last_scan',
  'episodes',
  'next_episode_number',
  'new_events_since_last_compose',
  'config',
]);

export function parseProjectState(d: JsonObject): ProjectState {
  if (!('project_id' in d)) {
    throw new Error("ProjectState: 'project_id' is required");
  }
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!PROJECT_STATE_KNOWN.has(k)) extra[k] = v;

  const agentSeen = asList(d.agent_seen)
    .map((x) => String(x))
    .filter((x): x is AgentId => isAgentId(x));

  return {
    project_id: String(d.project_id),
    display_name: String(d.display_name ?? ''),
    agent_seen: agentSeen,
    last_scan: parseProjectStateLastScan((d.last_scan ?? {}) as JsonObject),
    episodes: asList(d.episodes).map((e) => parseProjectStateEpisodeRef(e as JsonObject)),
    next_episode_number: Number(d.next_episode_number ?? 1),
    new_events_since_last_compose: Number(d.new_events_since_last_compose ?? 0),
    config: parseProjectStateConfig((d.config ?? {}) as JsonObject),
    _extra: extra,
  };
}

export function serializeProjectState(s: ProjectState): JsonObject {
  const out: JsonObject = {
    project_id: s.project_id,
    display_name: s.display_name,
    agent_seen: [...s.agent_seen],
    last_scan: serializeProjectStateLastScan(s.last_scan),
    episodes: s.episodes.map(serializeProjectStateEpisodeRef),
    next_episode_number: s.next_episode_number,
    new_events_since_last_compose: s.new_events_since_last_compose,
    config: serializeProjectStateConfig(s.config),
  };
  for (const [k, v] of Object.entries(s._extra)) out[k] = v;
  return out;
}

function parseProjectStateLastScan(d: JsonObject): ProjectStateLastScan {
  const known = new Set(['at', 'sessions_scanned']);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!known.has(k)) extra[k] = v;
  return {
    at: String(d.at ?? ''),
    sessions_scanned: asStringList(d.sessions_scanned),
    _extra: extra,
  };
}

function serializeProjectStateLastScan(s: ProjectStateLastScan): JsonObject {
  const out: JsonObject = {
    at: s.at,
    sessions_scanned: [...s.sessions_scanned],
  };
  for (const [k, v] of Object.entries(s._extra)) out[k] = v;
  return out;
}

function parseProjectStateEpisodeRef(d: JsonObject): ProjectStateEpisodeRef {
  const known = new Set(['episode', 'composed_at', 'event_count']);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!known.has(k)) extra[k] = v;
  return {
    episode: Number(d.episode ?? 0),
    composed_at: String(d.composed_at ?? ''),
    event_count: Number(d.event_count ?? 0),
    _extra: extra,
  };
}

function serializeProjectStateEpisodeRef(e: ProjectStateEpisodeRef): JsonObject {
  const out: JsonObject = {
    episode: e.episode,
    composed_at: e.composed_at,
    event_count: e.event_count,
  };
  for (const [k, v] of Object.entries(e._extra)) out[k] = v;
  return out;
}

function parseProjectStateConfig(d: JsonObject): ProjectStateConfig {
  const known = new Set([
    'compose_threshold',
    'lens_versions',
    'model',
    'analysis_language',
    'analysis_language_auto',
  ]);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) if (!known.has(k)) extra[k] = v;
  const lvRaw = (d.lens_versions ?? {}) as JsonObject;
  const model: 'sonnet' | 'opus' = d.model === 'opus' ? 'opus' : 'sonnet';
  return {
    compose_threshold: Number(d.compose_threshold ?? 10),
    lens_versions: {
      'strict-negative-space': String(lvRaw['strict-negative-space'] ?? 'v2.1'),
      'anchored-deferral': String(lvRaw['anchored-deferral'] ?? 'v3.0'),
      'user-initiated-pivot': String(lvRaw['user-initiated-pivot'] ?? 'v1.0'),
    },
    model,
    analysis_language: String(d.analysis_language ?? 'en'),
    analysis_language_auto: d.analysis_language_auto !== false,
    _extra: extra,
  };
}

function serializeProjectStateConfig(c: ProjectStateConfig): JsonObject {
  const out: JsonObject = {
    compose_threshold: c.compose_threshold,
    lens_versions: {
      'strict-negative-space': c.lens_versions['strict-negative-space'],
      'anchored-deferral': c.lens_versions['anchored-deferral'],
      'user-initiated-pivot': c.lens_versions['user-initiated-pivot'],
    },
    model: c.model,
    analysis_language: c.analysis_language,
    analysis_language_auto: c.analysis_language_auto,
  };
  for (const [k, v] of Object.entries(c._extra)) out[k] = v;
  return out;
}

/**
 * Default ProjectState for a freshly-discovered project (sync's first encounter).
 */
export function newProjectState(projectId: string, displayName: string): ProjectState {
  return {
    project_id: projectId,
    display_name: displayName,
    agent_seen: [],
    last_scan: { at: '', sessions_scanned: [], _extra: {} },
    episodes: [],
    next_episode_number: 1,
    new_events_since_last_compose: 0,
    config: {
      compose_threshold: 10,
      lens_versions: {
        'strict-negative-space': 'v2.1',
        'anchored-deferral': 'v3.0',
        'user-initiated-pivot': 'v1.0',
      },
      model: 'sonnet',
      analysis_language: 'en',
      analysis_language_auto: true,
      _extra: {},
    },
    _extra: {},
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function asList(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  return [];
}

function asStringList(v: unknown): string[] {
  return asList(v).map((x) => String(x));
}

function parseTimespan(v: unknown): { start: string; end: string } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as JsonObject;
  if (o.start === undefined && o.end === undefined) return null;
  return {
    start: String(o.start ?? ''),
    end: String(o.end ?? ''),
  };
}

function extractPrimaryTurn(turnAnchor: string): number {
  const m = /T?(\d+)/.exec(turnAnchor);
  return m && m[1] !== undefined ? parseInt(m[1], 10) : 0;
}

/** FNV-1a, 8 hex chars — same shape as core/journal-fs's hash6 but a bit wider. */
function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
