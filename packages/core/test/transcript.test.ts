import assert from 'node:assert/strict';
import test from 'node:test';

import {
  badgeLabel,
  categorize,
  entryDetail,
  messageText,
  parseTranscript,
  previewLine,
} from '../src/transcript';

const TRANSCRIPT = [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello there' } }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [
        { type: 'text', text: 'reading the file' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/x.ts' } },
      ],
    },
  }),
  '{ this is not json',
  '',
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }] },
  }),
].join('\n');

test('parseTranscript drops blank lines, keeps bad lines as _unparsed, tracks lineNo', () => {
  const entries = parseTranscript(TRANSCRIPT);
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((e) => e.lineNo),
    [1, 2, 3, 5],
  );
  assert.equal(entries[2]!.entry._unparsed, '{ this is not json');
});

test('categorize classifies Claude Code entries', () => {
  const e = parseTranscript(TRANSCRIPT);
  assert.equal(categorize(e[0]!.entry, 'claude-code'), 'user');
  assert.equal(categorize(e[1]!.entry, 'claude-code'), 'tool'); // assistant w/ tool_use
  assert.equal(categorize(e[2]!.entry, 'claude-code'), 'other'); // unparsed
  assert.equal(categorize(e[3]!.entry, 'claude-code'), 'tool-result'); // user w/ only tool_result
});

test('badgeLabel and previewLine produce plain text', () => {
  const e = parseTranscript(TRANSCRIPT);
  assert.equal(badgeLabel(e[2]!.entry, 'claude-code'), '(unparsed)');
  assert.equal(badgeLabel(e[0]!.entry, 'claude-code'), 'user');
  assert.match(previewLine(e[0]!.entry, 'claude-code'), /hello there/);
  assert.match(previewLine(e[1]!.entry, 'claude-code'), /\[Read\]/);
});

test('messageText flattens block arrays', () => {
  assert.equal(messageText('plain'), 'plain');
  assert.equal(messageText([{ type: 'text', text: 'a' }, { type: 'image' }]), 'a [image]');
});

test('entryDetail returns a structured message detail with blocks', () => {
  const e = parseTranscript(TRANSCRIPT);
  const d = entryDetail(e[1]!.entry, 'claude-code', 2);
  assert.equal(d.kind, 'message');
  if (d.kind !== 'message') return;
  assert.equal(d.role, 'assistant');
  assert.equal(d.model, 'claude-opus-4-7');
  assert.equal(d.category, 'tool');
  const tu = d.blocks.find((b) => b.kind === 'tool_use');
  assert.ok(tu && tu.kind === 'tool_use' && tu.name === 'Read');
});

test('entryDetail flags an unparsed line', () => {
  const e = parseTranscript(TRANSCRIPT);
  const d = entryDetail(e[2]!.entry, 'claude-code', 3);
  assert.equal(d.kind, 'unparsed');
});
