/**
 * Fate runner — the cross-episode detection step (§ 8).
 *
 * The three lenses look *within* a session and run at sync time. Fate looks
 * *across episodes* and runs as a separate side-effecting phase around compose
 * (Option B): the composer itself stays deterministic (no LLM call). The CLI
 * calls `detectAndApplyFates` BEFORE `composeAudit`; it dispatches one grounded
 * subagent (same `claude -p` / codex plumbing as the lenses), then appends each
 * surviving fate onto its target prior event via `addFateUpdate` (the one
 * sanctioned mutation). `composeAudit` then renders the fates whose
 * `detected_in_episode` equals the episode being composed.
 *
 * Precision-first: most episodes have zero fate (consecutive episodes are
 * usually different feature streams — Phase 2 P4). A false "you revisited X"
 * fabricates a narrative, so the grounding gate drops anything whose evidence
 * snippet cannot be reproduced verbatim in the new episode's digests, or whose
 * target is not a real prior event. Validated as a prototype in
 * experiments/observation-lens-v4-fate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { dispatchToAgent, stripFencing, type LensEngine } from './lens-runner';
import { digestFilePath } from './paths';
import {
  isFateType,
  type FateType,
  type FateUpdate,
  type LensId,
  type ObservationEvent,
  type ProjectState,
  type SourceRef,
} from './schema';
import { addFateUpdate, readSignals } from './store';
import { readComposedEventIds } from './compose';

const FATE_LENS_VERSION = 'v1.0';

/** `maintained` is never emitted — a decision merely still holding is not an event. */
function isEmittableFateType(v: unknown): v is FateType {
  return isFateType(v) && v !== 'maintained';
}

function fateSpecPath(): string {
  // src/lib/fate-runner.ts (tsx) or dist/lib/fate-runner.js (built) → package root is two up.
  return join(dirname(__filename), '..', '..', 'src', 'lenses', 'fate-detection.md');
}

/** A grounded fate ready to append to its target prior event. */
export interface FateCandidate {
  targetEvent: ObservationEvent;
  fate: FateUpdate;
}

/** Raw shape the subagent returns (pre-grounding). */
export interface RawFate {
  target_event_id?: unknown;
  type?: unknown;
  evidence_ref?: unknown;
  evidence_quote?: unknown;
  note?: unknown;
}

// ── Grounding gate (precision-critical; pure, unit-tested) ───────────────────

/** Normalise text for substring grounding — collapse whitespace, lowercase. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A fate's evidence must point at a concrete artifact in the new work. A
 * placeholder ref (`turn 0`, empty session, blank sha/path) is the model
 * hand-waving — the standard is "name something real or drop it". This is the
 * gate that kills the soft fates (immediate-follow-through dressed up as a later
 * destiny, observed on the pneuma-framework run — experiment v5).
 */
function isDegenerateRef(ref: SourceRef): boolean {
  if (ref.type === 'turn') return !(ref.id > 0) || ref.session_id.trim().length === 0;
  if (ref.type === 'turn-range') return !(ref.from > 0) || !(ref.to > 0) || ref.session_id.trim().length === 0;
  if (ref.type === 'commit') return ref.sha.trim().length < 4;
  if (ref.type === 'file') return ref.path.trim().length === 0;
  return true;
}

function parseEvidenceRef(v: unknown): SourceRef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.type === 'commit' && typeof r.sha === 'string') return { type: 'commit', sha: r.sha };
  if (r.type === 'file' && typeof r.path === 'string') return { type: 'file', path: r.path };
  if (r.type === 'turn' && r.id != null) return { type: 'turn', id: Number(r.id), session_id: String(r.session_id ?? '') };
  if (r.type === 'turn-range' && r.from != null && r.to != null)
    return { type: 'turn-range', from: Number(r.from), to: Number(r.to), session_id: String(r.session_id ?? '') };
  return null;
}

/**
 * Keep only fates that are grounded on BOTH sides:
 *   - `target_event_id` names a real prior event, and
 *   - `type` is an emittable FateType, and
 *   - `evidence_quote` reproduces verbatim in the new digests (the model's own
 *     citation is never trusted — the same gate the lenses use).
 * Everything else is dropped. Returns the survivors as append-ready candidates.
 */
export function groundFateCandidates(
  raw: RawFate[],
  priorEvents: ObservationEvent[],
  newDigestsText: string,
  episodeNum: number,
  detectedAt: string,
): FateCandidate[] {
  const priorById = new Map(priorEvents.map((e) => [e.id, e]));
  const haystack = norm(newDigestsText);
  const out: FateCandidate[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const targetId = typeof r.target_event_id === 'string' ? r.target_event_id : '';
    const target = priorById.get(targetId);
    if (!target) continue; // not a real prior event
    if (!isEmittableFateType(r.type)) continue; // invalid / maintained
    const quote = typeof r.evidence_quote === 'string' ? r.evidence_quote : '';
    if (quote.trim().length < 8) continue; // too thin to verify
    if (!haystack.includes(norm(quote))) continue; // citation not reproducible → drop
    const evidenceRef = parseEvidenceRef(r.evidence_ref);
    if (!evidenceRef) continue;
    if (isDegenerateRef(evidenceRef)) continue; // placeholder ref (turn 0, etc.) → not grounded
    const dedupeKey = `${targetId}:${r.type}:${norm(quote).slice(0, 60)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      targetEvent: target,
      fate: {
        type: r.type,
        detected_at: detectedAt,
        detected_in_episode: episodeNum,
        evidence_ref: evidenceRef,
        _extra: {
          // rendering context carried on the fate so the deterministic composer
          // can show the target without re-deriving it.
          target_event_id: targetId,
          target_label: shortEventLabel(target),
          note: typeof r.note === 'string' ? r.note : '',
          lens_version: FATE_LENS_VERSION,
        },
      },
    });
  }
  return out;
}

/** One-line label for a prior event, for the fate render. */
function shortEventLabel(e: ObservationEvent): string {
  const arc = /\*\*Arc\*\*:\s*(.+)/.exec(e.payload)?.[1] ?? '';
  const firstLine = arc || e.payload.split('\n').find((l) => l.trim().length > 0) || '';
  return `${e.lens_id} · ${e.turn_anchor} · ${firstLine.slice(0, 90)}`.trim();
}

// ── Prompt ───────────────────────────────────────────────────────────────────

/** Render the watch list (prior events) compactly for the prompt. */
function renderWatchList(priorEvents: ObservationEvent[]): string {
  return priorEvents
    .map((e) => `- id: ${e.id} · ${e.lens_id} · ${e.turn_anchor}\n  ${e.payload.replace(/\n+/g, ' ').slice(0, 400)}`)
    .join('\n');
}

export function buildFatePrompt(args: {
  spec: string;
  priorEvents: ObservationEvent[];
  newDigestsText: string;
  analysisLanguage?: string;
}): string {
  const lang = (args.analysisLanguage ?? 'English').trim();
  const languageBlock =
    lang && lang !== 'English'
      ? `\n# Output language\n\nWrite the \`note\` field in **${lang}**. Do NOT translate \`type\` keywords, field labels, ids, or \`evidence_quote\` — copy quotes verbatim from the digests in their original language.\n`
      : '';
  return `You are a single-purpose cross-episode fate-detection lens. Output ONLY a JSON object — no preamble, no markdown.

Work in isolation: use only the watch list and the new digests below. Do not look at other files or search the codebase.

# Lens spec

${args.spec}

# Watch list — prior episodes' flagged moments (their fate is what you assess)

${renderWatchList(args.priorEvents)}
${languageBlock}
# New episode work — digests to search for fate evidence

${args.newDigestsText}

# Your output

Emit STRICT JSON \`{ "fates": [...], "empty_reason"?: "..." }\` per the spec. Most episodes have zero grounded fates — emitting an empty list with an \`empty_reason\` is the correct, common answer. Cite both sides or drop it.`;
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export interface DetectFateArgs {
  state: ProjectState;
  engine?: LensEngine;
  model?: 'sonnet' | 'opus';
  analysisLanguage?: string;
  timeoutMs?: number;
  /** Test seam: bypass the agent dispatch with canned raw output. */
  rawOverride?: RawFate[];
}

export type DetectFateResult =
  | { ok: true; applied: number; checkedPrior: number; emptyReason?: string }
  | { ok: false; reason: string };

/**
 * Detect fate of prior-episode events against the new episode's work and append
 * each grounded fate to its target event. Best-effort: any failure returns
 * `{ ok: false }` and the caller still composes the episode (with empty fate).
 *
 * No-op (and no model call) when there are no prior episodes or no new digests.
 */
export function detectAndApplyFates(args: DetectFateArgs): DetectFateResult {
  const { state } = args;
  if (state.episodes.length === 0) {
    return { ok: true, applied: 0, checkedPrior: 0, emptyReason: 'first episode — no prior events' };
  }

  const composedIds = readComposedEventIds(state.project_id);
  const allEvents = [
    ...readSignals(state.project_id, 'strict-negative-space'),
    ...readSignals(state.project_id, 'anchored-deferral'),
    ...readSignals(state.project_id, 'user-initiated-pivot'),
  ];
  const priorEvents = allEvents.filter((e) => composedIds.has(e.id));
  const newEvents = allEvents.filter((e) => !composedIds.has(e.id));
  if (priorEvents.length === 0 || newEvents.length === 0) {
    return { ok: true, applied: 0, checkedPrior: priorEvents.length };
  }

  // The new episode's work = the digests of the sessions its new events touch.
  const newSessionIds = [...new Set(newEvents.map((e) => e.session_id))];
  const digests: string[] = [];
  for (const sid of newSessionIds) {
    const p = digestFilePath(state.project_id, sid);
    if (existsSync(p)) digests.push(`\n## session ${sid}\n\n${readFileSync(p, 'utf8')}`);
  }
  const newDigestsText = digests.join('\n');
  if (newDigestsText.trim().length === 0) {
    return { ok: true, applied: 0, checkedPrior: priorEvents.length };
  }

  const episodeNum = state.next_episode_number;
  const detectedAt = new Date().toISOString();

  let raw: RawFate[];
  let emptyReason: string | undefined;
  if (args.rawOverride) {
    raw = args.rawOverride;
  } else {
    let spec: string;
    try {
      spec = readFileSync(fateSpecPath(), 'utf8');
    } catch (err) {
      return { ok: false, reason: `fate spec unreadable: ${err instanceof Error ? err.message : String(err)}` };
    }
    const prompt = buildFatePrompt({
      spec,
      priorEvents,
      newDigestsText,
      analysisLanguage: args.analysisLanguage,
    });
    const dispatched = dispatchToAgent(prompt, {
      engine: args.engine,
      model: args.model,
      timeoutMs: args.timeoutMs,
    });
    if (!dispatched.ok) return { ok: false, reason: dispatched.reason };
    try {
      const parsed = JSON.parse(stripFencing(dispatched.text)) as { fates?: RawFate[]; empty_reason?: unknown };
      raw = Array.isArray(parsed.fates) ? parsed.fates : [];
      if (typeof parsed.empty_reason === 'string') emptyReason = parsed.empty_reason;
    } catch (err) {
      return { ok: false, reason: `fate JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const grounded = groundFateCandidates(raw, priorEvents, newDigestsText, episodeNum, detectedAt);
  let applied = 0;
  for (const c of grounded) {
    const res = addFateUpdate(state.project_id, c.targetEvent.lens_id as LensId, c.targetEvent.id, c.fate);
    if (res.ok) applied += 1;
  }
  return { ok: true, applied, checkedPrior: priorEvents.length, emptyReason };
}
