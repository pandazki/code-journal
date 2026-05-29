/**
 * Digester correctness tests — added during the v3 re-validation, which
 * surfaced three grounding-relevant bugs:
 *   1. isMeta user messages ("Continue from where you left off") leaked in
 *      as real user turns.
 *   2. AskUserQuestion — the most decision-bearing tool — was truncated,
 *      destroying the option text the lens must quote.
 *   3. assistant `thinking` blocks were emitted, feeding the negative-space
 *      lens the AI's private "I could do A or B" monologue (phantom proposals).
 *
 * Uses a temp .jsonl whose name matches the session-id regex.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { digestClaudeCodeTranscript } from '../src/lib/digest';

let dir: string;
let jsonlPath: string;

function writeJsonl(lines: object[]): string {
  const p = join(dir, '11111111-2222-3333-4444-555555555555.jsonl');
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'digest-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('digestClaudeCodeTranscript', () => {
  it('skips isMeta user messages (system-injected pseudo-user turns)', () => {
    jsonlPath = writeJsonl([
      {
        type: 'user',
        timestamp: '2026-05-20T08:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: '帮我加个功能' }] },
      },
      {
        type: 'user',
        isMeta: true,
        timestamp: '2026-05-20T08:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off.' }] },
      },
    ]);
    const { markdown, turns } = digestClaudeCodeTranscript({ jsonlPath, projectCode: 'X' });
    assert.equal(turns.length, 1, 'only the real user turn survives');
    assert.equal(turns[0].text, '帮我加个功能');
    assert.ok(!markdown.includes('Continue from where you left off'), 'isMeta text not rendered');
  });

  it('skips system-injected user-channel text (task-notification arriving as type:user)', () => {
    jsonlPath = writeJsonl([
      {
        type: 'user',
        timestamp: '2026-05-20T08:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '<task-notification>\n<task-id>abc</task-id>\n…' }],
        },
      },
      {
        type: 'user',
        timestamp: '2026-05-20T08:00:02.000Z',
        message: { role: 'user', content: [{ type: 'text', text: '真正的人类指令' }] },
      },
    ]);
    const { turns, markdown } = digestClaudeCodeTranscript({ jsonlPath, projectCode: 'X' });
    assert.equal(turns.length, 1, 'task-notification user turn dropped');
    assert.equal(turns[0].text, '真正的人类指令');
    assert.ok(!markdown.includes('task-notification'));
  });

  it('skips queue-operation (task-notification) and other non user/assistant types', () => {
    jsonlPath = writeJsonl([
      { type: 'queue-operation', operation: 'enqueue', content: '<task-notification>...' },
      { type: 'system', content: 'system note' },
      { type: 'file-history-snapshot' },
      {
        type: 'assistant',
        timestamp: '2026-05-20T08:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
      },
    ]);
    const { turns } = digestClaudeCodeTranscript({ jsonlPath, projectCode: 'X' });
    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, 'assistant');
  });

  it('does not emit assistant thinking blocks', () => {
    jsonlPath = writeJsonl([
      {
        type: 'assistant',
        timestamp: '2026-05-20T08:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I could do A or B internally' },
            { type: 'text', text: '我建议用 A。' },
          ],
        },
      },
    ]);
    const { markdown, turns } = digestClaudeCodeTranscript({ jsonlPath, projectCode: 'X' });
    assert.equal(turns.length, 1, 'thinking dropped, only the surfaced text remains');
    assert.equal(turns[0].kind, 'text');
    assert.ok(!markdown.includes('could do A or B'), 'private monologue not in digest');
  });

  it('renders AskUserQuestion options in full (no truncation of decision content)', () => {
    const longDescA = 'A'.repeat(400);
    const longDescB = 'B'.repeat(400);
    jsonlPath = writeJsonl([
      {
        type: 'assistant',
        timestamp: '2026-05-20T08:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'AskUserQuestion',
              input: {
                questions: [
                  {
                    question: 'Which approach?',
                    header: 'Approach',
                    options: [
                      { label: 'Option-One', description: longDescA },
                      { label: 'Option-Two', description: longDescB },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ]);
    const { markdown } = digestClaudeCodeTranscript({ jsonlPath, projectCode: 'X' });
    assert.ok(markdown.includes('Option-One'), 'first option label present');
    assert.ok(markdown.includes('Option-Two'), 'second option label present');
    assert.ok(markdown.includes(longDescA), 'first option description not truncated');
    assert.ok(markdown.includes(longDescB), 'second option description not truncated');
    assert.ok(markdown.includes('Which approach?'), 'question text present');
  });
});
