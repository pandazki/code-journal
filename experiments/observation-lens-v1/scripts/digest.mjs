#!/usr/bin/env node
/**
 * Transcript digester — JSONL → turn-indexed markdown.
 *
 * Strips heavy tool-result payloads so the digest fits in a subagent's
 * context window, while preserving the conversational structure the lens
 * needs (turn IDs, who said what, what tool was used, brief result).
 *
 * Usage:
 *   node experiments/observation-lens-v1/scripts/digest.mjs \
 *     --in <path/to/session.jsonl> \
 *     --out <path/to/digest.md> \
 *     --project-code <A|B|C>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ARGS = parseArgs(process.argv.slice(2));
if (!ARGS.in || !ARGS.out || !ARGS['project-code']) {
  process.stderr.write('usage: digest.mjs --in <jsonl> --out <md> --project-code <A|B|C>\n');
  process.exit(2);
}

const RAW = readFileSync(ARGS.in, 'utf8');
const LINES = RAW.split('\n').filter((l) => l.trim().length > 0);

const TOOL_RESULT_MAX = 600; // chars
const TEXT_MAX = 4000; // chars

const sessionId = (() => {
  const m = ARGS.in.match(/([a-f0-9-]{36})\.jsonl$/i);
  return m ? m[1] : 'unknown';
})();

let firstTs = null;
let lastTs = null;
const turns = []; // { id, role, text, toolName?, toolInput?, toolResult? }
let nextTurnId = 1;

for (const raw of LINES) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    continue;
  }

  if (obj.timestamp) {
    if (!firstTs) firstTs = obj.timestamp;
    lastTs = obj.timestamp;
  }

  // Claude Code format: { type: "user"|"assistant", message: { content: [...] } }
  // Some lines are queue ops, hooks, etc. — skip those for digest purposes.
  const t = obj.type;
  if (t === 'user' || t === 'assistant') {
    const msg = obj.message;
    if (!msg) continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];

    // Collapse a single user/assistant entry into possibly multiple sub-events:
    // text → one entry; tool_use → one entry; tool_result → one entry.
    for (const b of blocks) {
      if (b == null) continue;
      const bt = b.type;
      if (bt === 'text' || bt === 'output_text' || bt === 'input_text') {
        const text = String(b.text ?? '').trim();
        if (text.length === 0) continue;
        turns.push({
          id: nextTurnId++,
          role: t,
          kind: 'text',
          ts: obj.timestamp || null,
          text: truncate(text, TEXT_MAX),
        });
      } else if (bt === 'thinking') {
        // include but mark — relevant for lens (esp. AI uncertainty)
        const text = String(b.thinking ?? b.text ?? '').trim();
        if (text.length === 0) continue;
        turns.push({
          id: nextTurnId++,
          role: t,
          kind: 'thinking',
          ts: obj.timestamp || null,
          text: truncate(text, TEXT_MAX),
        });
      } else if (bt === 'tool_use' || bt === 'server_tool_use') {
        const name = String(b.name || 'tool');
        const input = b.input || {};
        // shrink: keep only the most signal-bearing fields per common CC tools
        const inputBrief = briefToolInput(name, input);
        turns.push({
          id: nextTurnId++,
          role: t,
          kind: 'tool_use',
          ts: obj.timestamp || null,
          toolName: name,
          toolInput: inputBrief,
        });
      } else if (bt === 'tool_result') {
        const content = b.content;
        const text = typeof content === 'string' ? content : flattenContent(content);
        turns.push({
          id: nextTurnId++,
          role: t,
          kind: 'tool_result',
          ts: obj.timestamp || null,
          isError: !!b.is_error,
          text: truncate(text, TOOL_RESULT_MAX),
        });
      }
    }
  }
  // Other types (queue-operation, hook_*, meta, file-history-snapshot) are
  // skipped — they're plumbing, not conversation.
}

// Compose digest markdown
const out = [];
out.push(`# Transcript digest — Project ${ARGS['project-code']} · session ${shortId(sessionId)}`);
out.push('');
out.push(`- Total raw JSONL lines: ${LINES.length}`);
out.push(`- Total turns in digest: ${turns.length}`);
if (firstTs) out.push(`- Started: \`${firstTs}\``);
if (lastTs) out.push(`- Ended:   \`${lastTs}\``);
out.push('');
out.push('> Each entry is one indexed turn. `T<n>` is the turn identifier used in lens output.');
out.push('> Tool inputs/results are truncated to keep the digest in context. Long file contents');
out.push('> in tool_result are shown only as head/tail signal. Anchor lens citations to `T<n>`.');
out.push('');
out.push('---');
out.push('');

for (const t of turns) {
  // Turn headers now carry an ISO-8601 timestamp suffix so the composer can
  // recover turn → ts mapping for response-latency measurements (M2). The
  // suffix uses a stable parseable form: `· @<ISO>`.
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

const outPath = ARGS.out;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out.join('\n'));
process.stdout.write(
  `wrote digest: ${outPath} (${turns.length} turns, ${LINES.length} raw lines, ${(out.join('\n').length / 1024).toFixed(1)} KB)\n`,
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

function flattenContent(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return JSON.stringify(c);
  return c
    .map((b) => {
      if (typeof b === 'string') return b;
      if (b && typeof b === 'object') {
        if (typeof b.text === 'string') return b.text;
        return JSON.stringify(b);
      }
      return String(b);
    })
    .join(' ');
}

function shortId(id) {
  return id.length >= 8 ? id.slice(0, 8) : id;
}

function briefToolInput(name, input) {
  if (!input || typeof input !== 'object') return JSON.stringify(input ?? null);
  // Keep brief headers per common CC tools; this is signal-bearing, not the whole payload
  const keep = {
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
  const keys = keep[name] || Object.keys(input).slice(0, 3);
  const slim = {};
  for (const k of keys) if (k in input) slim[k] = input[k];
  return truncate(JSON.stringify(slim, null, 2), 500);
}
