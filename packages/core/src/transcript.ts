/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Framework-agnostic parsing & classification of coding-agent session transcripts (JSONL).
 *
 * Ported from the web browser's renderer (server/public/app.js) but stripped
 * of all HTML — these functions return plain data so a TUI (or any other renderer) can present
 * it however it likes.
 */

export type TranscriptAgent = 'claude-code' | 'codex' | 'cowork' | 'unknown';

export type EntryCategory =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'tool-result'
  | 'hook'
  | 'system'
  | 'meta'
  | 'other';

/** One parsed JSONL line. `entry._unparsed` is set when the line wasn't valid JSON. */
export interface TranscriptEntry {
  /** 1-based source line number */
  lineNo: number;
  entry: any;
}

/** A renderable block inside a message entry's detail. */
export type DetailBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; name: string; input: string }
  | { kind: 'tool_result'; isError: boolean; text: string; truncated: boolean }
  | { kind: 'image' }
  | { kind: 'json'; text: string };

/** Structured detail for one entry — what a viewer shows in its detail pane. */
export type EntryDetail =
  | { kind: 'unparsed'; lineNo: number; raw: string }
  | {
      kind: 'message';
      role: string;
      model?: string;
      timestamp?: string;
      category: EntryCategory;
      blocks: DetailBlock[];
      rawJson: string;
    }
  | { kind: 'fields'; rows: Array<[string, string]>; rawJson: string }
  | { kind: 'raw'; rawJson: string };

const SESSION_DETAIL_TEXT_MAX = 4000;

const CC_HOOK_TYPES = new Set([
  'hook_started',
  'hook_response',
  'hook_success',
  'hook_failure',
  'hook_additional_context',
  'hook_blocked',
  'hook',
]);

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Parse JSONL text → entries. Blank lines dropped; bad lines kept as `{ _unparsed }`. */
export function parseTranscript(text: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? '';
    if (ln.trim() === '') continue;
    let parsed: any;
    try {
      parsed = JSON.parse(ln);
    } catch {
      parsed = { _unparsed: ln };
    }
    out.push({ lineNo: i + 1, entry: parsed });
  }
  return out;
}

/** Pull the textual content out of a CC/Codex message-shaped object. */
export function messageText(content: any): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const bits: string[] = [];
  for (const block of content) {
    if (block == null) continue;
    if (typeof block === 'string') {
      bits.push(block);
      continue;
    }
    const t = block.type;
    if (t === 'text' && typeof block.text === 'string') bits.push(block.text);
    else if (t === 'output_text' && typeof block.text === 'string') bits.push(block.text);
    else if (t === 'input_text' && typeof block.text === 'string') bits.push(block.text);
    else if (t === 'tool_use' || t === 'server_tool_use') bits.push(`→ [${block.name || 'tool'}]`);
    else if (t === 'tool_result') {
      const r = block.content;
      bits.push(typeof r === 'string' ? r : messageText(r));
    } else if (t === 'image') bits.push('[image]');
    else if (typeof block.text === 'string') bits.push(block.text);
  }
  return bits.join(' ').replace(/\s+/g, ' ').trim();
}

function firstToolUse(content: any): any {
  if (!Array.isArray(content)) return null;
  for (const b of content) {
    if (b && (b.type === 'tool_use' || b.type === 'server_tool_use')) return b;
  }
  return null;
}

/** Map an entry to one of the badge categories. Best-effort; unknown shapes → "other". */
export function categorize(entry: any, agent: string): EntryCategory {
  if (!entry || typeof entry !== 'object') return 'other';
  if (entry._unparsed !== undefined) return 'other';
  const type = entry.type;

  if (agent === 'claude-code' || agent === 'cowork') {
    if (type === 'user') {
      const c = entry.message && entry.message.content;
      if (Array.isArray(c) && c.length && c.every((b: any) => b && b.type === 'tool_result')) {
        return 'tool-result';
      }
      return 'user';
    }
    if (type === 'assistant') {
      const c = entry.message && entry.message.content;
      return firstToolUse(c) ? 'tool' : 'assistant';
    }
    if (type === 'system') return 'system';
    if (
      type === 'summary' ||
      type === 'last-prompt' ||
      type === 'permission-mode' ||
      type === 'file-history-snapshot' ||
      type === 'command_permissions' ||
      type === 'skill_listing' ||
      type === 'deferred_tools_delta' ||
      type === 'task_reminder'
    ) {
      return 'meta';
    }
    const at = entry.attachment && entry.attachment.type;
    if (CC_HOOK_TYPES.has(type) || (at && CC_HOOK_TYPES.has(at))) return 'hook';
    return 'other';
  }

  if (agent === 'codex') {
    if (type === 'session_meta' || type === 'turn_context' || type === 'compacted' || type === 'turn_diff') {
      return 'meta';
    }
    if (type === 'event_msg') return 'system';
    if (type === 'response_item') {
      const p = entry.payload || {};
      const kind = p.type || p.role;
      if (kind === 'message') return p.role === 'user' || p.role === 'human' ? 'user' : 'assistant';
      if (kind === 'function_call' || kind === 'local_shell_call' || kind === 'custom_tool_call') return 'tool';
      if (
        kind === 'function_call_output' ||
        kind === 'local_shell_call_output' ||
        kind === 'custom_tool_call_output'
      ) {
        return 'tool-result';
      }
      if (kind === 'reasoning') return 'assistant';
      return 'other';
    }
    return 'other';
  }

  if (type === 'user') return 'user';
  if (type === 'assistant') return 'assistant';
  if (type === 'system') return 'system';
  return 'other';
}

/** A short badge label for an entry (the type name, basically). */
export function badgeLabel(entry: any, agent: string): string {
  if (!entry || typeof entry !== 'object') return '(json)';
  if (entry._unparsed !== undefined) return '(unparsed)';
  if (agent === 'codex' && entry.type === 'response_item') {
    const p = entry.payload || {};
    const k = p.type || p.role;
    return k ? `response · ${k}` : 'response_item';
  }
  if (agent === 'codex' && entry.type === 'event_msg') {
    const p = entry.payload || {};
    return p.type ? `event · ${p.type}` : 'event_msg';
  }
  if (agent === 'claude-code' || agent === 'cowork') {
    const at = entry.attachment && entry.attachment.type;
    if (at && CC_HOOK_TYPES.has(at)) return at;
    if (entry.type === 'system' && entry.subtype) return `system · ${entry.subtype}`;
  }
  return String(entry.type || '(json)');
}

/** A one-line preview string for the entry list. Plain text. */
export function previewLine(entry: any, agent: string): string {
  if (!entry || typeof entry !== 'object') return '(json)';
  if (entry._unparsed !== undefined) return truncate(String(entry._unparsed), 90);
  const type = entry.type;

  if (agent === 'claude-code' || agent === 'cowork') {
    if (type === 'permission-mode') return `permission mode: ${entry.permissionMode ?? '?'}`;
    if (type === 'summary') return truncate(String(entry.summary ?? ''), 90);
    if (type === 'last-prompt') return truncate(String(entry.lastPrompt ?? ''), 90);
    if (type === 'file-history-snapshot') return 'file history snapshot';
    if (type === 'command_permissions') return 'command permissions';
    if (type === 'skill_listing') return 'skill listing';
    if (type === 'deferred_tools_delta') return 'deferred tools delta';
    if (type === 'task_reminder') return 'task reminder';
    const at = entry.attachment && entry.attachment.type;
    if (CC_HOOK_TYPES.has(type) || (at && CC_HOOK_TYPES.has(at))) {
      const hn =
        entry.hookName ||
        (entry.attachment && entry.attachment.hookName) ||
        entry.hook_event_name ||
        (entry.attachment && entry.attachment.hook_event_name);
      return `hook: ${hn || at || type}`;
    }
    if (type === 'user') {
      const c = entry.message && entry.message.content;
      const txt = messageText(c);
      if (!txt && Array.isArray(c) && c.some((b: any) => b && b.type === 'tool_result')) {
        return '← [tool result]';
      }
      return truncate(txt || '(empty)', 88);
    }
    if (type === 'assistant') {
      const c = entry.message && entry.message.content;
      const tu = firstToolUse(c);
      const txt = messageText(c);
      if (tu) return `→ [${tu.name || 'tool'}]` + (txt ? ' ' + truncate(txt, 60) : ' …');
      return truncate(txt || '(empty)', 88);
    }
    if (type === 'system') {
      return truncate(messageText(entry.message?.content) || entry.content || entry.subtype || 'system', 90);
    }
  }

  if (agent === 'codex') {
    if (type === 'session_meta') return 'session meta';
    if (type === 'turn_context') return 'turn context';
    if (type === 'compacted') return 'compacted';
    if (type === 'turn_diff') return 'turn diff';
    if (type === 'event_msg') {
      const p = entry.payload || {};
      return `event: ${p.type || type}`;
    }
    if (type === 'response_item') {
      const p = entry.payload || {};
      const kind = p.type || p.role;
      if (kind === 'message') return truncate(messageText(p.content) || '(empty)', 88);
      if (kind === 'function_call' || kind === 'custom_tool_call') {
        return `→ [${p.name || 'fn'}]` + (p.arguments ? ' ' + truncate(String(p.arguments), 60) : ' …');
      }
      if (kind === 'local_shell_call') return '→ [shell]';
      if (
        kind === 'function_call_output' ||
        kind === 'custom_tool_call_output' ||
        kind === 'local_shell_call_output'
      ) {
        const out = p.output;
        return '← ' + truncate(typeof out === 'string' ? out : JSON.stringify(out ?? ''), 86);
      }
      if (kind === 'reasoning') return '💭 reasoning';
      return kind ? String(kind) : 'response_item';
    }
  }

  if (type) {
    const txt = messageText(entry.message?.content);
    if (txt) return truncate(txt, 90);
  }
  return truncate(prettyJson(entry).replace(/\s+/g, ' '), 90);
}

function isMessageEntry(entry: any, agent: string): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (agent === 'claude-code' || agent === 'cowork') {
    return (
      (entry.type === 'user' || entry.type === 'assistant') &&
      entry.message &&
      typeof entry.message === 'object'
    );
  }
  if (agent === 'codex') {
    return (
      entry.type === 'response_item' &&
      entry.payload &&
      (entry.payload.type === 'message' || (entry.payload.role && entry.payload.content))
    );
  }
  return false;
}

/** Turn a message's `content` into renderable detail blocks. */
function messageBlocks(content: any): DetailBlock[] {
  if (content == null) return [];
  if (typeof content === 'string') {
    return content.trim() ? [{ kind: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [{ kind: 'json', text: prettyJson(content) }];
  const out: DetailBlock[] = [];
  for (const block of content) {
    if (block == null) continue;
    if (typeof block === 'string') {
      if (block.trim()) out.push({ kind: 'text', text: block });
      continue;
    }
    const t = block.type;
    if ((t === 'text' || t === 'output_text' || t === 'input_text') && typeof block.text === 'string') {
      if (block.text.trim()) out.push({ kind: 'text', text: block.text });
    } else if (t === 'thinking' || t === 'reasoning') {
      const rt =
        block.thinking ||
        block.text ||
        (Array.isArray(block.summary) ? block.summary.map((s: any) => s?.text || '').join('\n') : '');
      out.push({ kind: 'thinking', text: String(rt || '') });
    } else if (t === 'tool_use' || t === 'server_tool_use') {
      out.push({
        kind: 'tool_use',
        name: String(block.name || 'tool'),
        input: block.input !== undefined ? prettyJson(block.input) : '',
      });
    } else if (t === 'tool_result') {
      const raw = typeof block.content === 'string' ? block.content : messageText(block.content);
      const truncated = raw.length > SESSION_DETAIL_TEXT_MAX;
      out.push({
        kind: 'tool_result',
        isError: Boolean(block.is_error),
        text: truncated ? raw.slice(0, SESSION_DETAIL_TEXT_MAX) : raw || '(empty)',
        truncated,
      });
    } else if (t === 'image') {
      out.push({ kind: 'image' });
    } else {
      out.push({ kind: 'json', text: prettyJson(block) });
    }
  }
  return out;
}

const NOTABLE_FIELDS = [
  'type',
  'subtype',
  'summary',
  'lastPrompt',
  'permissionMode',
  'hookName',
  'hook_event_name',
  'timestamp',
  'uuid',
  'parentUuid',
  'sessionId',
  'version',
  'gitBranch',
  'cwd',
  'userType',
  'isSidechain',
  'requestId',
  'model',
  'id',
  'leafUuid',
  'level',
  'toolUseID',
  'isMeta',
  'isCompactSummary',
  'isApiErrorMessage',
];

/** Build the structured detail for one entry. */
export function entryDetail(entry: any, agent: string, lineNo: number): EntryDetail {
  if (!entry || typeof entry !== 'object') {
    return { kind: 'raw', rawJson: String(entry) };
  }
  if (entry._unparsed !== undefined) {
    return { kind: 'unparsed', lineNo, raw: String(entry._unparsed) };
  }

  if (isMessageEntry(entry, agent)) {
    let role: string;
    let model: string | undefined;
    let content: any;
    if (agent === 'claude-code' || agent === 'cowork') {
      const m = entry.message || {};
      role = String(m.role || entry.type);
      model = typeof m.model === 'string' ? m.model : undefined;
      content = m.content;
    } else {
      const p = entry.payload || {};
      role = String(p.role || 'assistant');
      model = typeof p.model === 'string' ? p.model : undefined;
      content = p.content;
    }
    return {
      kind: 'message',
      role,
      model,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
      category: categorize(entry, agent),
      blocks: messageBlocks(content),
      rawJson: prettyJson(entry),
    };
  }

  // non-message known type: a list of notable scalar fields.
  const rows: Array<[string, string]> = [];
  const seen = new Set<string>();
  const pushRow = (k: string, v: unknown): void => {
    if (seen.has(k)) return;
    if (v === undefined || v === null || v === '') return;
    if (typeof v === 'object') return;
    seen.add(k);
    rows.push([k, String(v)]);
  };
  for (const k of NOTABLE_FIELDS) pushRow(k, entry[k]);
  if (entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)) {
    for (const k of ['type', 'id', 'role', 'name', 'status', 'call_id', 'model', 'summary']) {
      pushRow('payload.' + k, entry.payload[k]);
    }
  }
  if (entry.attachment && typeof entry.attachment === 'object' && !Array.isArray(entry.attachment)) {
    for (const k of ['type', 'hookName', 'hook_event_name']) pushRow('attachment.' + k, entry.attachment[k]);
  }
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v !== 'object') pushRow(k, v);
  }

  if (rows.length === 0) return { kind: 'raw', rawJson: prettyJson(entry) };
  return { kind: 'fields', rows, rawJson: prettyJson(entry) };
}
