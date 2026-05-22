/** Shared colors. Plain Ink color names so it works on any 16-color terminal. */
import type { EntryCategory } from '@code-journal/core';

export const theme = {
  brand: 'cyan',
  accent: 'yellow',
  ok: 'green',
  warn: 'yellow',
  err: 'red',
  dim: 'gray',
  text: 'white',
} as const;

/** Badge color per transcript entry category. */
export const categoryColor: Record<EntryCategory, string> = {
  user: 'cyan',
  assistant: 'green',
  tool: 'yellow',
  'tool-result': 'magenta',
  hook: 'blue',
  system: 'gray',
  meta: 'gray',
  other: 'white',
};

/** Color per coding-agent. */
export function agentColor(agent: string): string {
  if (agent === 'claude-code') return 'magenta';
  if (agent === 'codex') return 'green';
  if (agent === 'cowork') return 'blue';
  return 'gray';
}
