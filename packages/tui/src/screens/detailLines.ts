/** Flatten an EntryDetail into uniformly-scrollable display lines. */
import type { DetailBlock, EntryDetail } from '@code-journal/core';

import { clipLine, wrapText } from '../text';
import { categoryColor, theme } from '../theme';

export interface DisplayLine {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

function appendBlock(out: DisplayLine[], block: DetailBlock, width: number): void {
  const push = (text: string, opts: Partial<DisplayLine> = {}): void => {
    out.push({ text, ...opts });
  };
  const wrapped = (text: string, opts: Partial<DisplayLine> = {}): void => {
    for (const l of wrapText(text, width)) push(l, opts);
  };

  switch (block.kind) {
    case 'text':
      wrapped(block.text);
      break;
    case 'thinking':
      push('💭 thinking', { color: theme.dim, bold: true });
      wrapped(block.text, { dim: true });
      break;
    case 'tool_use':
      push(`→ [${block.name}]`, { color: 'yellow', bold: true });
      if (block.input) {
        for (const l of block.input.split('\n')) push(clipLine(l, width), { dim: true });
      }
      break;
    case 'tool_result':
      push(`← tool result${block.isError ? ' (error)' : ''}`, {
        color: block.isError ? theme.err : 'magenta',
        bold: true,
      });
      wrapped(block.text, { dim: true });
      if (block.truncated) push('… (truncated)', { color: theme.dim });
      break;
    case 'image':
      push('[image]', { color: theme.dim });
      break;
    case 'json':
      for (const l of block.text.split('\n')) push(clipLine(l, width), { dim: true });
      break;
  }
}

/** Build the structured detail-pane lines for an entry. */
export function detailToLines(detail: EntryDetail, width: number): DisplayLine[] {
  const out: DisplayLine[] = [];

  if (detail.kind === 'unparsed') {
    out.push({ text: `line ${detail.lineNo} — not valid JSON, shown verbatim`, color: theme.warn });
    out.push({ text: '' });
    for (const l of wrapText(detail.raw, width)) out.push({ text: l, dim: true });
    return out;
  }

  if (detail.kind === 'raw') {
    for (const l of detail.rawJson.split('\n')) out.push({ text: clipLine(l, width), dim: true });
    return out;
  }

  if (detail.kind === 'fields') {
    for (const [k, v] of detail.rows) {
      const wrapped = wrapText(`${k}: ${v}`, width);
      wrapped.forEach((l, i) => out.push({ text: l, color: i === 0 ? undefined : theme.dim }));
    }
    return out;
  }

  // message
  const head = [detail.role, detail.model, detail.timestamp].filter(Boolean).join('   ·   ');
  out.push({ text: head, bold: true, color: categoryColor[detail.category] });
  out.push({ text: '' });
  detail.blocks.forEach((block, i) => {
    if (i > 0) out.push({ text: '' });
    appendBlock(out, block, width);
  });
  if (detail.blocks.length === 0) out.push({ text: '(no renderable content)', color: theme.dim });
  return out;
}
