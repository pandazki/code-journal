/**
 * Transcript digester — Claude Code JSONL → turn-indexed markdown digest.
 *
 * Ported from experiments/observation-lens-v1/scripts/digest.mjs with one
 * MVP-II addition: results returned as both a `string` (for the lens
 * subagent to read) and a `DigestTurnIndex` (for compose.mjs to compute
 * latency / convergence / M6 quintile positions without re-parsing).
 *
 * Heavy tool_result payloads are truncated to keep digests in subagent
 * context. The lens's "skip if AI proposal isn't specific enough" rule
 * naturally handles truncation-induced ambiguity.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';

const TOOL_RESULT_MAX = 600; // chars
const TEXT_MAX = 4000; // chars

export interface DigestTurn {
  id: number;
  role: 'user' | 'assistant';
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  ts: string | null; // ISO-8601 from raw line
  text?: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
}

export interface DigestResult {
  /** Markdown digest as the lens subagent will read it */
  markdown: string;
  /** Turn id → metadata, for composer use */
  turns: DigestTurn[];
  /** Headline metadata mined from the source */
  meta: {
    sessionId: string;
    firstTs: string | null;
    lastTs: string | null;
    rawLines: number;
    totalTurns: number;
  };
}

export interface DigestArgs {
  jsonlPath: string;
  projectCode: string;
}

export function digestClaudeCodeTranscript(args: DigestArgs): DigestResult {
  const raw = readFileSync(args.jsonlPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  const sessionId = extractSessionIdFromFilename(args.jsonlPath);

  let firstTs: string | null = null;
  let lastTs: string | null = null;
  const turns: DigestTurn[] = [];
  let nextTurnId = 1;

  for (const rawLine of lines) {
    let obj: any;
    try {
      obj = JSON.parse(rawLine);
    } catch {
      continue;
    }

    if (obj.timestamp) {
      if (!firstTs) firstTs = obj.timestamp;
      lastTs = obj.timestamp;
    }

    const t = obj.type;
    if (t !== 'user' && t !== 'assistant') continue; // skip queue-operation, hook_*, meta, etc.

    const msg = obj.message;
    if (!msg) continue;
    const blocks: any[] = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];

    for (const b of blocks) {
      if (b == null) continue;
      const turn = extractTurn(t, b, obj.timestamp ?? null, nextTurnId);
      if (turn) {
        turns.push(turn);
        nextTurnId += 1;
      }
    }
  }

  const markdown = renderMarkdown(turns, {
    projectCode: args.projectCode,
    sessionId,
    firstTs,
    lastTs,
    rawLines: lines.length,
  });

  return {
    markdown,
    turns,
    meta: {
      sessionId,
      firstTs,
      lastTs,
      rawLines: lines.length,
      totalTurns: turns.length,
    },
  };
}

function extractTurn(
  role: 'user' | 'assistant',
  block: any,
  ts: string | null,
  id: number,
): DigestTurn | null {
  const bt = block.type;
  if (bt === 'text' || bt === 'output_text' || bt === 'input_text') {
    const text = String(block.text ?? '').trim();
    if (text.length === 0) return null;
    return { id, role, kind: 'text', ts, text: truncate(text, TEXT_MAX) };
  }
  if (bt === 'thinking') {
    const text = String(block.thinking ?? block.text ?? '').trim();
    if (text.length === 0) return null;
    return { id, role, kind: 'thinking', ts, text: truncate(text, TEXT_MAX) };
  }
  if (bt === 'tool_use' || bt === 'server_tool_use') {
    const name = String(block.name || 'tool');
    const input = block.input || {};
    return {
      id,
      role,
      kind: 'tool_use',
      ts,
      toolName: name,
      toolInput: briefToolInput(name, input),
    };
  }
  if (bt === 'tool_result') {
    const content = block.content;
    const text = typeof content === 'string' ? content : flattenContent(content);
    return {
      id,
      role,
      kind: 'tool_result',
      ts,
      isError: Boolean(block.is_error),
      text: truncate(text, TOOL_RESULT_MAX),
    };
  }
  return null;
}

/**
 * Markdown layout — turn headers carry `· @<iso-ts>` so the composer can
 * recover turn → timestamp map for M2 (response latency) without
 * re-parsing the JSONL.
 */
function renderMarkdown(
  turns: DigestTurn[],
  hdr: {
    projectCode: string;
    sessionId: string;
    firstTs: string | null;
    lastTs: string | null;
    rawLines: number;
  },
): string {
  const out: string[] = [];
  out.push(`# Transcript digest — Project ${hdr.projectCode} · session ${shortId(hdr.sessionId)}`);
  out.push('');
  out.push(`- Total raw JSONL lines: ${hdr.rawLines}`);
  out.push(`- Total turns in digest: ${turns.length}`);
  if (hdr.firstTs) out.push(`- Started: \`${hdr.firstTs}\``);
  if (hdr.lastTs) out.push(`- Ended:   \`${hdr.lastTs}\``);
  out.push('');
  out.push('> Each entry is one indexed turn. `T<n>` is the turn identifier used in lens output.');
  out.push('> Tool inputs/results are truncated to keep the digest in context. Long file contents');
  out.push('> in tool_result are shown only as head/tail signal. Anchor lens citations to `T<n>`.');
  out.push('');
  out.push('---');
  out.push('');

  for (const t of turns) {
    const tsSuffix = t.ts ? ` · @${t.ts}` : '';
    const head = `**T${t.id} · ${t.role}`;
    if (t.kind === 'text') {
      out.push(`${head} (text)${tsSuffix}**`);
      out.push('');
      out.push(t.text ?? '');
    } else if (t.kind === 'thinking') {
      out.push(`${head} (thinking)${tsSuffix}**`);
      out.push('');
      out.push('> ' + (t.text ?? '').split('\n').join('\n> '));
    } else if (t.kind === 'tool_use') {
      out.push(`${head} (tool_use → ${t.toolName})${tsSuffix}**`);
      out.push('');
      out.push('```');
      out.push(t.toolInput ?? '');
      out.push('```');
    } else if (t.kind === 'tool_result') {
      const tag = t.isError ? 'tool_result · ERROR' : 'tool_result';
      out.push(`${head} (${tag})${tsSuffix}**`);
      out.push('');
      out.push('```');
      out.push(t.text ?? '');
      out.push('```');
    }
    out.push('');
  }

  return out.join('\n');
}

function truncate(s: string, n: number): string {
  if (typeof s !== 'string') s = String(s);
  if (s.length <= n) return s;
  return s.slice(0, n - 80) + `\n…(truncated, original ${s.length} chars)…\n` + s.slice(-40);
}

function flattenContent(c: any): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return JSON.stringify(c);
  return c
    .map((b: any) => {
      if (typeof b === 'string') return b;
      if (b && typeof b === 'object') {
        if (typeof b.text === 'string') return b.text;
        return JSON.stringify(b);
      }
      return String(b);
    })
    .join(' ');
}

function shortId(id: string): string {
  return id.length >= 8 ? id.slice(0, 8) : id;
}

function extractSessionIdFromFilename(path: string): string {
  const m = /([a-f0-9-]{36})\.jsonl$/i.exec(path);
  return m && m[1] ? m[1] : 'unknown';
}

function briefToolInput(name: string, input: any): string {
  if (!input || typeof input !== 'object') return JSON.stringify(input ?? null);
  const keep: Record<string, string[]> = {
    Bash: ['command', 'description'],
    Read: ['file_path', 'limit', 'offset'],
    Edit: ['file_path'],
    Write: ['file_path'],
    Glob: ['pattern', 'path'],
    Grep: ['pattern', 'path', 'glob'],
    WebFetch: ['url', 'prompt'],
    TodoWrite: ['todos'],
    Task: ['description', 'subagent_type'],
    AskUserQuestion: ['questions'],
  };
  const keys = keep[name] ?? Object.keys(input).slice(0, 3);
  const slim: any = {};
  for (const k of keys) if (k in input) slim[k] = input[k];
  return truncate(JSON.stringify(slim, null, 2), 500);
}
