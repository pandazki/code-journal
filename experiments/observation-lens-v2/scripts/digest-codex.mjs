#!/usr/bin/env node
/**
 * Codex transcript digester — codex JSONL → turn-indexed markdown digest.
 *
 * Codex format differs from Claude Code:
 *   - Top-level `type` field with values: `session_meta`, `event_msg`,
 *     `response_item`, `turn_context`
 *   - `response_item` wraps `payload.type` ∈ {message, reasoning,
 *     function_call, function_call_output}
 *   - `message` payloads have `role` ∈ {user, assistant, developer} and
 *     `content: [{type, text}]` where type ∈ {input_text, output_text}
 *   - `function_call` / `function_call_output` are tool use / results
 *     (codex flattens to bash + apply_patch + custom MCP tools)
 *
 * Output format matches the Claude Code digester so the same lens specs
 * apply to both: turn-indexed, role-labelled, timestamps preserved.
 *
 * Usage:
 *   node experiments/observation-lens-v2/scripts/digest-codex.mjs \
 *     --in <codex.jsonl> --out <digest.md> --project-code <X>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ARGS = parseArgs(process.argv.slice(2));
if (!ARGS.in || !ARGS.out || !ARGS['project-code']) {
  process.stderr.write('usage: digest-codex.mjs --in <jsonl> --out <md> --project-code <X>\n');
  process.exit(2);
}

const RAW = readFileSync(ARGS.in, 'utf8');
const LINES = RAW.split('\n').filter((l) => l.trim().length > 0);

const TOOL_RESULT_MAX = 600;
const TEXT_MAX = 4000;

// Codex session id lives in session_meta line (payload.id) — first line
let sessionId = 'unknown';
let firstTs = null;
let lastTs = null;
let cwd = '';
const turns = [];
let nextTurnId = 1;

for (const raw of LINES) {
  let obj;
  try {
    obj = JSON.parse(raw);
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

  if (t !== 'response_item') continue; // skip event_msg, turn_context, token_count etc.

  const p = obj.payload || {};
  const ptype = p.type;

  if (ptype === 'message') {
    const role = p.role || 'unknown';
    // Skip the developer-instructions wall (large permissions/system prompt)
    if (role === 'developer') continue;
    const content = Array.isArray(p.content) ? p.content : [];
    const parts = [];
    for (const c of content) {
      const ct = c.type;
      if (ct === 'input_text' || ct === 'output_text') {
        if (typeof c.text === 'string') parts.push(c.text);
      }
    }
    const text = parts.join('\n\n').trim();
    if (text.length === 0) continue;
    turns.push({
      id: nextTurnId++,
      role,
      kind: 'text',
      ts,
      text: truncate(text, TEXT_MAX),
    });
  } else if (ptype === 'reasoning') {
    // Reasoning blocks (codex's internal thinking)
    const summary = Array.isArray(p.summary) ? p.summary : [];
    const txt = summary
      .map((s) => (typeof s === 'object' && s.text ? s.text : String(s)))
      .filter((s) => s && s.trim().length > 0)
      .join('\n')
      .trim();
    if (txt.length === 0) continue;
    turns.push({
      id: nextTurnId++,
      role: 'assistant',
      kind: 'thinking',
      ts,
      text: truncate(txt, TEXT_MAX),
    });
  } else if (ptype === 'function_call') {
    const name = p.name || 'tool';
    let args = {};
    try {
      args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : (p.arguments || {});
    } catch {
      args = { _raw: p.arguments };
    }
    turns.push({
      id: nextTurnId++,
      role: 'assistant',
      kind: 'tool_use',
      ts,
      toolName: name,
      toolInput: truncate(JSON.stringify(args, null, 2), 500),
    });
  } else if (ptype === 'function_call_output') {
    const out = p.output || {};
    let text;
    if (typeof out === 'string') text = out;
    else if (out && typeof out === 'object') {
      text = typeof out.content === 'string' ? out.content : (out.text || JSON.stringify(out));
    } else {
      text = String(out);
    }
    turns.push({
      id: nextTurnId++,
      role: 'user',
      kind: 'tool_result',
      ts,
      isError: !!out.success === false && out.exit_code != null && out.exit_code !== 0,
      text: truncate(text, TOOL_RESULT_MAX),
    });
  }
}

const out = [];
out.push(`# Transcript digest — Project ${ARGS['project-code']} · codex session ${shortId(sessionId)}`);
out.push('');
out.push(`- Agent: **codex** (cross-agent comparison material)`);
out.push(`- cwd: \`${cwd || 'unknown'}\``);
out.push(`- Total raw JSONL lines: ${LINES.length}`);
out.push(`- Total turns in digest: ${turns.length}`);
if (firstTs) out.push(`- Started: \`${firstTs}\``);
if (lastTs) out.push(`- Ended:   \`${lastTs}\``);
out.push('');
out.push('> Each entry is one indexed turn. `T<n>` is the turn identifier used in lens output.');
out.push('> Same format as the Claude Code digester — the lens specs are agent-agnostic.');
out.push('');
out.push('---');
out.push('');

for (const t of turns) {
  const tsSuffix = t.ts ? ` · @${t.ts}` : '';
  const head = `**T${t.id} · ${t.role}`;
  if (t.kind === 'text') {
    out.push(`${head} (text)${tsSuffix}**`);
    out.push('');
    out.push(t.text);
  } else if (t.kind === 'thinking') {
    out.push(`${head} (thinking)${tsSuffix}**`);
    out.push('');
    out.push('> ' + t.text.split('\n').join('\n> '));
  } else if (t.kind === 'tool_use') {
    out.push(`${head} (tool_use → ${t.toolName})${tsSuffix}**`);
    out.push('');
    out.push('```');
    out.push(t.toolInput);
    out.push('```');
  } else if (t.kind === 'tool_result') {
    const tag = t.isError ? 'tool_result · ERROR' : 'tool_result';
    out.push(`${head} (${tag})${tsSuffix}**`);
    out.push('');
    out.push('```');
    out.push(t.text);
    out.push('```');
  }
  out.push('');
}

mkdirSync(dirname(ARGS.out), { recursive: true });
writeFileSync(ARGS.out, out.join('\n'));
process.stdout.write(
  `wrote codex digest: ${ARGS.out} (${turns.length} turns, ${LINES.length} raw lines, ${(out.join('\n').length / 1024).toFixed(1)} KB)\n`,
);

// ────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

function truncate(s, n) {
  if (typeof s !== 'string') s = String(s);
  if (s.length <= n) return s;
  return s.slice(0, n - 80) + `\n…(truncated, original ${s.length} chars)…\n` + s.slice(-40);
}

function shortId(id) {
  return id && id.length >= 8 ? id.slice(0, 8) : (id || 'unknown');
}
