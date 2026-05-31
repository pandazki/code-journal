/**
 * Observation-console data layer — reads `~/.code-journal/observations/` and
 * shapes it for the web console. Pure reads; never mutates the signal store.
 *
 *   overview()    → every project with episode + per-lens event counts
 *   episode(pid,n)→ one episode's metadata + the events that compose it,
 *                   grouped by lens (joined from the append-only signal store)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  observationsRoot,
  readProjectState,
  writeProjectState,
  readSignals,
  episodeMetadataPath,
  LENS_IDS,
  type LensId,
  type ObservationEvent,
} from '@code-journal/observation';

function listProjectIds(): string[] {
  const root = observationsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => {
    if (name.startsWith('_') || name.startsWith('.')) return false;
    try {
      return statSync(join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

const epDate = (composedAt: string): string => (composedAt || '').slice(0, 10);

export interface OverviewProject {
  id: string;
  display_name: string;
  agents: string[];
  episode_count: number;
  events: Record<LensId, number> & { total: number };
  lens_versions: Record<string, string>;
  config_model: 'sonnet' | 'opus';
  compose_threshold: number;
  last_scan: string | null;
  latest_episode: { episode: number; date: string; event_count: number } | null;
}

export function overview(): { projects: OverviewProject[] } {
  const projects: OverviewProject[] = [];
  for (const id of listProjectIds()) {
    let state;
    try {
      state = readProjectState(id, id);
    } catch {
      continue;
    }
    const events = {} as Record<LensId, number> & { total: number };
    let total = 0;
    for (const lens of LENS_IDS) {
      const n = safeRead(id, lens).length;
      events[lens] = n;
      total += n;
    }
    events.total = total;
    const eps = state.episodes ?? [];
    const latest = eps.length ? eps[eps.length - 1]! : null;
    projects.push({
      id,
      display_name: state.display_name || id,
      agents: state.agent_seen ?? [],
      episode_count: eps.length,
      events,
      lens_versions: state.config?.lens_versions ?? {},
      config_model: state.config?.model ?? 'sonnet',
      compose_threshold: state.config?.compose_threshold ?? 10,
      last_scan: state.last_scan?.at || null,
      latest_episode: latest
        ? { episode: latest.episode, date: epDate(latest.composed_at), event_count: latest.event_count }
        : null,
    });
  }
  projects.sort((a, b) => b.events.total - a.events.total); // densest first
  return { projects };
}

export interface EpisodeView {
  project: { id: string; display_name: string };
  episode: unknown; // AuditEpisode JSON, passed through
  episodes: { episode: number; date: string; event_count: number }[];
  events: Record<LensId, ObservationEvent[]>;
}

export function episode(pid: string, n: number): EpisodeView | { error: string } {
  let state;
  try {
    state = readProjectState(pid, pid);
  } catch {
    return { error: `no project '${pid}'` };
  }
  const ref = (state.episodes ?? []).find((e) => e.episode === n);
  if (!ref) return { error: `no episode ${n} in '${pid}'` };

  const metaPath = episodeMetadataPath(pid, ref.episode, epDate(ref.composed_at));
  let meta: unknown = null;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      meta = null;
    }
  }

  // Join: the episode's event ids → full events from the append-only store.
  const idSet = new Set<string>();
  const sourceSignals = (meta as { source_signals?: { event_ids?: string[] }[] } | null)
    ?.source_signals;
  if (Array.isArray(sourceSignals)) {
    for (const s of sourceSignals) for (const id of s.event_ids ?? []) idSet.add(id);
  }

  const events = {} as Record<LensId, ObservationEvent[]>;
  for (const lens of LENS_IDS) {
    const all = safeRead(pid, lens);
    events[lens] = idSet.size > 0 ? all.filter((e) => idSet.has(e.id)) : all;
  }

  return {
    project: { id: pid, display_name: state.display_name || pid },
    episode: meta,
    episodes: (state.episodes ?? []).map((e) => ({
      episode: e.episode,
      date: epDate(e.composed_at),
      event_count: e.event_count,
    })),
    events,
  };
}

function safeRead(pid: string, lens: LensId): ObservationEvent[] {
  try {
    return readSignals(pid, lens);
  } catch {
    return [];
  }
}

// ── config write ───────────────────────────────────────────────────────────
export interface ConfigPatch {
  pid: string;
  model?: string;
  compose_threshold?: number;
}

/** Update a project's observation config (model, compose_threshold). Returns the
 *  applied values. Validates inputs; haiku is rejected (too lossy for lenses). */
export function setConfig(patch: ConfigPatch): { ok: true; model: string; compose_threshold: number } {
  const id = String(patch.pid || '').trim();
  if (!id) throw new Error('pid required');
  // Path-segment guard — the id is used as a directory name downstream.
  if (id.includes('/') || id.includes('..') || id.includes('\\')) throw new Error('invalid pid');
  const root = observationsRoot();
  if (!existsSync(join(root, id))) throw new Error(`no project '${id}'`);

  const state = readProjectState(id, id);
  if (patch.model !== undefined) {
    const m = String(patch.model);
    if (m !== 'sonnet' && m !== 'opus') throw new Error(`invalid model '${m}' (sonnet | opus)`);
    state.config.model = m;
  }
  if (patch.compose_threshold !== undefined) {
    const n = Math.floor(Number(patch.compose_threshold));
    if (!Number.isFinite(n) || n < 1 || n > 999) throw new Error('compose_threshold must be 1–999');
    state.config.compose_threshold = n;
  }
  writeProjectState(state);
  return { ok: true, model: state.config.model, compose_threshold: state.config.compose_threshold };
}
