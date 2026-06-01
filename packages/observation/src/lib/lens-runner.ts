/**
 * Lens runner — dispatch an isolated subagent (`claude -p` or `codex exec`)
 * to apply a single lens to a single digest and return the events.
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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * Which coding-agent CLI applies the lens.
 *   - 'claude' (default): `claude -p` — uses `model` (sonnet/opus).
 *   - 'codex': `codex exec` — typically faster; ignores `model` and uses
 *     Codex's configured default. Runs `--ephemeral` (no session persisted,
 *     so no self-pollution) and captures the final message via `-o`.
 */
export type LensEngine = 'claude' | 'codex';

export interface RunLensArgs {
  lensId: LensId;
  lensVersion: string;
  digestMarkdown: string;
  projectId: string;
  sessionId: string;
  agent: AgentId;
  /** Which CLI runs the lens. Default 'claude'. */
  engine?: LensEngine;
  /** sonnet (default) or opus. haiku rejected. Claude engine only. */
  model?: 'sonnet' | 'opus';
  /**
   * Prompt phrase for the language the lens writes PROSE in (e.g. "English",
   * "Chinese (match the user's variant)"). Structural tokens + verbatim quotes
   * are never translated. Omit → English. Use languagePromptName(code).
   */
  analysisLanguage?: string;
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
  if ((args.engine ?? 'claude') === 'claude' && ((args.model as string) ?? 'sonnet') === 'haiku') {
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
    analysisLanguage: args.analysisLanguage,
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
    analysisLanguage: args.analysisLanguage,
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

/**
 * Oversized-digest guard. A single `claude -p` pass has a finite context
 * window; a multi-thousand-turn session digest overflows it and the subagent
 * exits non-zero with no stderr (observed on a 2780-turn session). Above this
 * many prompt chars we skip with an explicit, actionable reason instead of
 * letting the user hit a cryptic `exit 1: (no stderr)`. ~600k chars leaves
 * headroom for the lens spec + schema + the model's own JSON output.
 * Chunked/windowed digestion of giant sessions is future work.
 */
const MAX_PROMPT_CHARS = 600_000;

type RawOutcome = { ok: true; text: string } | { ok: false; reason: string };

function dispatchAndParse(prompt: string, args: RunLensArgs): DispatchOutcome {
  const timeoutMs = args.timeoutMs ?? 600_000;
  if (prompt.length > MAX_PROMPT_CHARS) {
    return {
      kind: 'failed',
      reason: `digest too large for a single lens pass: ${prompt.length} chars > ${MAX_PROMPT_CHARS} limit — session skipped (split or raise the limit to process it)`,
    };
  }
  const raw =
    (args.engine ?? 'claude') === 'codex'
      ? runCodex(prompt, timeoutMs)
      : runClaude(prompt, args.model ?? 'sonnet', timeoutMs);
  if (!raw.ok) return { kind: 'failed', reason: raw.reason };

  const cleaned = stripFencing(raw.text);
  let parsed: ParsedLensJSON;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { kind: 'failed', reason: `JSON.parse: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { kind: 'parsed', parsed };
}

/**
 * `claude -p` engine. Prompt goes through stdin (not argv) to dodge ARG_MAX
 * (~262k on macOS; big digests blow it). cwd is a throwaway temp dir, NOT the
 * target project: `claude -p` writes a transcript under the project derived
 * from its cwd, and if that were the analyzed repo every lens call would leak
 * a "You are a single-purpose observation lens…" transcript back into the scan
 * window (self-pollution). tmpdir() keeps those out.
 */
function runClaude(prompt: string, model: string, timeoutMs: number): RawOutcome {
  const result = spawnSync('claude', ['-p', '--model', model], {
    input: prompt,
    cwd: tmpdir(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error) return { ok: false, reason: `claude -p failed: ${result.error.message}` };
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').slice(0, 500);
    return { ok: false, reason: `claude -p exit ${result.status}: ${stderr || '(no stderr)'}` };
  }
  return { ok: true, text: result.stdout ?? '' };
}

/**
 * `codex exec` engine — typically faster than `claude -p`. Flags chosen for a
 * headless, side-effect-free lens pass:
 *   --ephemeral        don't persist a session to ~/.codex/sessions (so the
 *                      lens run can't pollute a later Codex scan — Codex's
 *                      native equivalent of the claude cwd→tmpdir trick)
 *   --sandbox read-only + --skip-git-repo-check   the lens emits JSON, runs no
 *                      commands; read-only in a throwaway dir keeps it safe and
 *                      prompt-free
 *   -o <file>          write ONLY the final agent message (our JSON) to a file,
 *                      so we never have to parse it out of Codex's stdout logs
 * Model is Codex's configured default (sonnet/opus don't apply here).
 */
function runCodex(prompt: string, timeoutMs: number): RawOutcome {
  const dir = mkdtempSync(join(tmpdir(), 'cj-lens-'));
  const outFile = join(dir, 'last-message.txt');
  try {
    const result = spawnSync(
      'codex',
      [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        '-C',
        dir,
        '-o',
        outFile,
        '-', // read the prompt from stdin
      ],
      { input: prompt, cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
    );
    if (result.error) return { ok: false, reason: `codex exec failed: ${result.error.message}` };
    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').slice(0, 500);
      return { ok: false, reason: `codex exec exit ${result.status}: ${stderr || '(no stderr)'}` };
    }
    // Prefer the -o file (just the final message); fall back to stdout.
    let text: string;
    try {
      text = readFileSync(outFile, 'utf8');
    } catch {
      text = result.stdout ?? '';
    }
    return { ok: true, text };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
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
  analysisLanguage?: string;
  retryReminder: boolean;
}): string {
  // Localize ONLY the model-authored prose. Field labels, stance keywords, and
  // verbatim quotes stay exactly as the lens spec defines them — the grounding
  // gate and audit composer parse those, and quotes must stay in the user's words.
  const lang = (args.analysisLanguage ?? 'English').trim();
  const languageBlock =
    lang && lang !== 'English'
      ? `\n# Output language\n\nWrite every prose field you author — the Arc, Before, After, "Why" explanations, "Redirected to", and any empty_state_reason — in **${lang}**. Do NOT translate: field labels (e.g. \`**Stance**:\`), the classification/stance keywords (engaged / assented / deferred / overrode / ignored / negative-space / user-initiated-pivot), or any verbatim quotes — copy quotes exactly as they appear in the transcript, in their original language.\n`
      : '';
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
${languageBlock}
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
