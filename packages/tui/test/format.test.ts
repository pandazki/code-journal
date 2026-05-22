import assert from 'node:assert/strict';
import test from 'node:test';

import { clip, fmtBytes, fmtRelTime, shortId } from '../src/format';
import { wrapText } from '../src/text';
import { computeWindow, moveIndex } from '../src/components/windowing';

test('fmtBytes scales units', () => {
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(2048), '2.0 KB');
  assert.equal(fmtBytes(5 * 1024 * 1024), '5.0 MB');
});

test('fmtRelTime produces relative strings', () => {
  assert.equal(fmtRelTime(Date.now() - 5000), '5s ago');
  assert.equal(fmtRelTime(Date.now() - 3 * 60_000), '3m ago');
  assert.equal(fmtRelTime(0), '—');
});

test('shortId trims to the leading UUID segment', () => {
  assert.equal(shortId('bc43824f-ec23-40e5-9653-c31c95a23a50'), 'bc43824f');
  assert.equal(shortId('short'), 'short');
});

test('clip adds an ellipsis past the width', () => {
  assert.equal(clip('hello world', 8), 'hello w…');
  assert.equal(clip('hi', 8), 'hi');
});

test('wrapText breaks long lines and keeps newlines', () => {
  const lines = wrapText('one two three four five', 9);
  assert.ok(lines.every((l) => l.length <= 9));
  assert.equal(wrapText('a\nb', 20).length, 2);
});

test('computeWindow keeps the cursor on screen', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const w = computeWindow(items, 50, 10);
  assert.equal(w.items.length, 10);
  assert.ok(w.items.includes(50));
  assert.equal(w.hiddenAbove + w.items.length + w.hiddenBelow, 100);
});

test('moveIndex clamps to bounds', () => {
  assert.equal(moveIndex(0, -1, 5), 0);
  assert.equal(moveIndex(4, 1, 5), 4);
  assert.equal(moveIndex(2, 1, 5), 3);
});
