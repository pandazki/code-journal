/**
 * Lens runner — dispatch an isolated subagent (`claude -p`) to apply a
 * single lens to a single digest and return the events.
 *
 * Same shell-out pattern as packages/app/src/narrate.ts:
 *   - no API key needed (uses the host coding agent)
 *   - prompt is self-contained (lens spec + schema + digest inlined)
 *   - timeout-bounded so a stuck subagent can't hang the cron tick
 *
 * Hard rules:
 *   - `haiku` is BANNED (Phase 2 E1: misses ~50% of events). Runtime
 *     check rejects model = haiku before spending tokens.
 *   - JSON-validate-then-retry once on parse failure (Phase 2 found ~33%
 *     raw failure rate before the escape rule was baked in; should be < 5%
 *     now, but a single retry mops up the residual)
 *   - The subagent prompt explicitly forbids reading other files or
 *     searching the codebase — but `-p` mode is already context-isolated
 *     so this is belt-and-suspenders.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  computeEventId,
  isAgentId,
  isLensId,
  type AgentId,
  type LensId,
  type ObservationEvent,
  type SourceRef,
} from './schema';

/**
 * Where the bundled lens spec markdown lives, relative to this file.
 *
 * Lens prompts always live at `<packageRoot>/src/lenses/`. We resolve
 * package root from `__filename`:
 *   - src/lib/lens-runner.ts (tsx)    → __filename = .../src/lib/lens-runner.ts → root = .../packages/observation
 *   - dist/lib/lens-runner.js (built) → __filename = .../dist/lib/lens-runner.js → root = .../packages/observation
 * Either way, going up two levels yields the package root.
 *
 * package.json's `files: ["dist", "src/lenses"]` ships the lens markdown
 * with the published artifact so consumers can read them at runtime.
 */
function packageRoot(): string {
  return join(dirname(__filename), '..', '..');
}

function lensSpecPath(lensId: LensId): string {
  return join(packageRoot(), 'src', 'lenses', `${lensId}.md`);
}

function eventSchemaPath(): string {
  return join(packageRoot(), 'src', 'lenses', 'event-schema.md');
}

export interface RunLensArgs {
  lensId: LensId;
  lensVersion: string;
  digestMarkdown: string;
  projectId: string;
  sessionId: string;
  agent: AgentId;
  /** sonnet (default) or opus. haiku rejected. */
  model?: 'sonnet' | 'opus';
  /** Timeout per scan in ms (default 10 min — big sessions take time on sonnet). */
  timeoutMs?: number;
}

export type RunLensResult =
  | { ok: true; events: ObservationEvent[]; emptyStateReason?: string }
  | { ok: false; reason: string };

/**
 * Run one lens on one digest. Returns parsed events or a failure reason.
 *
 * The runner does NOT persist events — the caller (sync.ts) appends to
 * the signal store. This split keeps lens-runner pure-ish: input prompt
 * + digest, output parsed events.
 */
export function runLens(args: RunLensArgs): RunLensResult {
  if (((args.model as string) ?? 'sonnet') === 'haiku') {
    return { ok: false, reason: 'haiku is banned for production lens runs (Phase 2 E1: ~50% recall)' };
  }
  if (!isLensId(args.lensId)) {
    return { ok: false, reason: `unknown lens_id ${JSON.stringify(args.lensId)}` };
  }
  if (!isAgentId(args.agent)) {
    return { ok: false, reason: `unknown agent ${JSON.stringify(args.agent)}` };
  }

  let lensSpec: string;
  let schemaSpec: string;
  try {
    lensSpec = readFileSync(lensSpecPath(args.lensId), 'utf8');
    schemaSpec = readFileSync(eventSchemaPath(), 'utf8');
  } catch (err) {
    return {
      ok: false,
      reason: `lens spec or schema unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const basePrompt = buildPrompt({
    lensSpec,
    schemaSpec,
    digestMarkdown: args.digestMarkdown,
    lensId: args.lensId,
    projectId: args.projectId,
    sessionId: args.sessionId,
    retryReminder: false,
  });

  const result = dispatchAndParse(basePrompt, args);
  if (result.kind === 'parsed') {
    return finalize(result.parsed, args);
  }
  // Retry once with explicit JSON-escape reminder
  const retryPrompt = buildPrompt({
    lensSpec,
    schemaSpec,
    digestMarkdown: args.digestMarkdown,
    lensId: args.lensId,
    projectId: args.projectId,
    sessionId: args.sessionId,
    retryReminder: true,
  });
  const retry = dispatchAndParse(retryPrompt, args);
  if (retry.kind === 'parsed') {
    return finalize(retry.parsed, args);
  }
  return { ok: false, reason: `JSON parse failed twice: ${retry.reason}` };
}

type DispatchOutcome =
  | { kind: 'parsed'; parsed: ParsedLensJSON }
  | { kind: 'failed'; reason: string };

function dispatchAndParse(prompt: string, args: RunLensArgs): DispatchOutcome {
  const model = args.model ?? 'sonnet';
  const timeoutMs = args.timeoutMs ?? 600_000;
  // Pipe the prompt through stdin instead of argv to avoid ARG_MAX
  // (macOS default ~262144 chars; big digests easily blow this). claude -p
  // reads stdin when no positional prompt arg is provided.
  const result = spawnSync('claude', ['-p', '--model', model], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error) {
    return { kind: 'failed', reason: `claude -p failed: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').slice(0, 500);
    return {
      kind: 'failed',
      reason: `claude -p exit ${result.status}: ${stderr || '(no stderr)'}`,
    };
  }
  const stdout = result.stdout ?? '';
  const cleaned = stripFencing(stdout);
  let parsed: ParsedLensJSON;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { kind: 'failed', reason: `JSON.parse: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { kind: 'parsed', parsed };
}

function finalize(parsed: ParsedLensJSON, args: RunLensArgs): RunLensResult {
  const events: ObservationEvent[] = [];
  for (const raw of parsed.events ?? []) {
    const turnAnchor = String(raw.turn_anchor ?? '');
    if (!turnAnchor) continue;
    const id = computeEventId({
      project_id: args.projectId,
      session_id: args.sessionId,
      lens_id: args.lensId,
      turn_anchor: turnAnchor,
      lens_version: args.lensVersion,
    });
    events.push({
      id,
      lens_id: args.lensId,
      lens_version: args.lensVersion,
      project_id: args.projectId,
      session_id: args.sessionId,
      turn_anchor: turnAnchor,
      primary_turn: extractPrimaryTurn(turnAnchor),
      timespan: parseTimespan(raw.timespan),
      source_refs: Array.isArray(raw.source_refs)
        ? (raw.source_refs as SourceRef[]).map((r) => normaliseSourceRef(r, args.sessionId))
        : [],
      payload: String(raw.payload ?? ''),
      detected_at: new Date().toISOString(),
      agent: args.agent,
      fate: [],
      _extra: {},
    });
  }
  const out: RunLensResult = { ok: true, events };
  if (parsed.empty_state_reason) {
    (out as { ok: true; events: ObservationEvent[]; emptyStateReason?: string }).emptyStateReason = String(
      parsed.empty_state_reason,
    );
  }
  return out;
}

interface ParsedLensJSON {
  events?: Array<{
    turn_anchor?: unknown;
    timespan?: unknown;
    source_refs?: unknown;
    payload?: unknown;
  }>;
  empty_state_reason?: unknown;
}

function buildPrompt(args: {
  lensSpec: string;
  schemaSpec: string;
  digestMarkdown: string;
  lensId: LensId;
  projectId: string;
  sessionId: string;
  retryReminder: boolean;
}): string {
  const reminderLine = args.retryReminder
    ? '\n**Critical**: your previous output was not strict JSON. Re-output as STRICT JSON. Every `"` inside verbatim text MUST be `\\"`. Alternatively use Chinese curly quotes 「」 for inner-quoted phrases.\n'
    : '';
  return `You are a single-purpose observation lens. You will scan ONE transcript digest and emit zero or more events as strict JSON.

Work in isolation: do not look at other files, do not search the codebase, do not look at other sessions. Output ONLY the JSON object — no preamble, no markdown, no commentary.

# Lens spec

${args.lensSpec}

# Event schema

${args.schemaSpec}

# Project / session context

- project_id: ${args.projectId}
- session_id: ${args.sessionId}
- lens_id: ${args.lensId}

# Transcript digest

${args.digestMarkdown}

# Your output

Apply the lens to the digest. Emit one JSON object per the schema. Strict JSON only — no markdown wrapper, no preamble. If no events qualify, output an EMPTY-STATE record with a concrete \`empty_state_reason\`.
${reminderLine}`;
}

function stripFencing(s: string): string {
  // Models sometimes wrap output in ```json ... ``` despite explicit
  // instructions; strip lightly.
  const trimmed = s.trim();
  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n');
    const withoutOpen = firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed.slice(3);
    const closeIdx = withoutOpen.lastIndexOf('```');
    return closeIdx >= 0 ? withoutOpen.slice(0, closeIdx).trim() : withoutOpen.trim();
  }
  return trimmed;
}

function extractPrimaryTurn(turnAnchor: string): number {
  const m = /T?(\d+)/.exec(turnAnchor);
  return m && m[1] !== undefined ? parseInt(m[1], 10) : 0;
}

function parseTimespan(v: unknown): { start: string; end: string } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as { start?: unknown; end?: unknown };
  if (o.start === undefined && o.end === undefined) return null;
  return { start: String(o.start ?? ''), end: String(o.end ?? '') };
}

function normaliseSourceRef(r: any, sessionId: string): SourceRef {
  const t = r?.type;
  if (t === 'turn') return { type: 'turn', id: Number(r.id), session_id: String(r.session_id ?? sessionId) };
  if (t === 'turn-range')
    return {
      type: 'turn-range',
      from: Number(r.from),
      to: Number(r.to),
      session_id: String(r.session_id ?? sessionId),
    };
  if (t === 'commit') return { type: 'commit', sha: String(r.sha) };
  if (t === 'file') return { type: 'file', path: String(r.path) };
  // Tolerate the common case where the lens omits session_id on turn refs
  if (typeof r?.id === 'number') return { type: 'turn', id: r.id, session_id: sessionId };
  return { type: 'turn', id: 0, session_id: sessionId };
}
