/**
 * Codex transcript digester — codex JSONL → turn-indexed markdown digest.
 *
 * Ported from experiments/observation-lens-v2/scripts/digest-codex.mjs.
 *
 * Codex schema differs from Claude Code:
 *   - Top-level `type` ∈ {session_meta, event_msg, response_item, turn_context}
 *   - `response_item` wraps `payload.type` ∈ {message, reasoning,
 *     function_call, function_call_output}
 *   - `message` has `role` ∈ {user, assistant, developer} and
 *     `content: [{type, text}]` (input_text / output_text)
 *
 * Output format MATCHES the Claude Code digester so the lens specs are
 * agent-agnostic.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';

import type { DigestResult, DigestTurn, DigestArgs } from './digest';

const TOOL_RESULT_MAX = 600;
const TEXT_MAX = 4000;

export function digestCodexTranscript(args: DigestArgs): DigestResult {
  const raw = readFileSync(args.jsonlPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  let sessionId = 'unknown';
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let cwd = '';
  const turns: DigestTurn[] = [];
  let nextTurnId = 1;

  for (const rawLine of lines) {
    let obj: any;
    try {
      obj = JSON.parse(rawLine);
    } catch {
      continue;
    }

    const t = obj.type;
    const ts = obj.timestamp;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    if (t === 'session_meta') {
      const p = obj.payload || {};
      sessionId = p.id || sessionId;
      cwd = p.cwd || cwd;
      continue;
    }

    if (t !== 'response_item') continue;

    const p = obj.payload || {};
    const ptype = p.type;

    if (ptype === 'message') {
      const role = p.role;
      if (role === 'developer') continue; // skip the developer-instructions wall
      const content: any[] = Array.isArray(p.content) ? p.content : [];
      const parts: string[] = [];
      for (const c of content) {
        const ct = c.type;
        if ((ct === 'input_text' || ct === 'output_text') && typeof c.text === 'string') {
          parts.push(c.text);
        }
      }
      const text = parts.join('\n\n').trim();
      if (text.length === 0) continue;
      const turnRole: 'user' | 'assistant' = role === 'user' ? 'user' : 'assistant';
      turns.push({
        id: nextTurnId++,
        role: turnRole,
        kind: 'text',
        ts: ts ?? null,
        text: truncate(text, TEXT_MAX),
      });
    } else if (ptype === 'reasoning') {
      const summary: any[] = Array.isArray(p.summary) ? p.summary : [];
      const txt = summary
        .map((s) => (typeof s === 'object' && s && s.text ? s.text : String(s)))
        .filter((s: string) => s && s.trim().length > 0)
        .join('\n')
        .trim();
      if (txt.length === 0) continue;
      turns.push({
        id: nextTurnId++,
        role: 'assistant',
        kind: 'thinking',
        ts: ts ?? null,
        text: truncate(txt, TEXT_MAX),
      });
    } else if (ptype === 'function_call') {
      const name = p.name || 'tool';
      let argsObj: any = {};
      try {
        argsObj = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments || {};
      } catch {
        argsObj = { _raw: p.arguments };
      }
      turns.push({
        id: nextTurnId++,
        role: 'assistant',
        kind: 'tool_use',
        ts: ts ?? null,
        toolName: name,
        toolInput: truncate(JSON.stringify(argsObj, null, 2), 500),
      });
    } else if (ptype === 'function_call_output') {
      const out = p.output || {};
      let text: string;
      if (typeof out === 'string') {
        text = out;
      } else if (out && typeof out === 'object') {
        text = typeof out.content === 'string' ? out.content : out.text || JSON.stringify(out);
      } else {
        text = String(out);
      }
      const isError = out && typeof out === 'object' && typeof out.exit_code === 'number' && out.exit_code !== 0;
      turns.push({
        id: nextTurnId++,
        role: 'user',
        kind: 'tool_result',
        ts: ts ?? null,
        isError: Boolean(isError),
        text: truncate(text, TOOL_RESULT_MAX),
      });
    }
  }

  const markdown = renderMarkdown(turns, {
    projectCode: args.projectCode,
    sessionId,
    firstTs,
    lastTs,
    rawLines: lines.length,
    cwd,
  });

  return {
    markdown,
    turns,
    meta: { sessionId, firstTs, lastTs, rawLines: lines.length, totalTurns: turns.length },
  };
}

function renderMarkdown(
  turns: DigestTurn[],
  hdr: {
    projectCode: string;
    sessionId: string;
    firstTs: string | null;
    lastTs: string | null;
    rawLines: number;
    cwd: string;
  },
): string {
  const out: string[] = [];
  out.push(`# Transcript digest — Project ${hdr.projectCode} · codex session ${shortId(hdr.sessionId)}`);
  out.push('');
  out.push(`- Agent: **codex** (cross-agent comparison material)`);
  out.push(`- cwd: \`${hdr.cwd || 'unknown'}\``);
  out.push(`- Total raw JSONL lines: ${hdr.rawLines}`);
  out.push(`- Total turns in digest: ${turns.length}`);
  if (hdr.firstTs) out.push(`- Started: \`${hdr.firstTs}\``);
  if (hdr.lastTs) out.push(`- Ended:   \`${hdr.lastTs}\``);
  out.push('');
  out.push('> Same format as the Claude Code digester — lens specs are agent-agnostic.');
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

function shortId(id: string): string {
  return id.length >= 8 ? id.slice(0, 8) : id;
}
