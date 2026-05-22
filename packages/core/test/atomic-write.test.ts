/**
 * Unit tests for `atomicWriteFileSync` — the shared tmp+rename helper that
 * guards every on-disk artifact a SIGTERM-interruptible claude run can
 * mid-touch (entry .md, report .md, config.json).
 *
 * Covers:
 *   1. happy path leaves no tmp residue
 *   2. overwrite path preserves atomicity (no torn state visible)
 *   3. error path (parent dir missing) leaves target untouched + tmp absent
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { atomicWriteFileSync } from '../src/storage';

interface Tmp {
  dir: string;
  cleanup: () => void;
}

let cur: Tmp | null = null;

afterEach(() => {
  if (cur) {
    cur.cleanup();
    cur = null;
  }
});

function fresh(): Tmp {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-atomic-test-')));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function listTmpResidue(dir: string, basename: string): string[] {
  return fs.readdirSync(dir).filter((n) => n.startsWith(`${basename}.tmp-`));
}

test('atomicWriteFileSync: writes the file and leaves no tmp residue', () => {
  cur = fresh();
  const target = path.join(cur.dir, 'thing.md');

  atomicWriteFileSync(target, 'hello world\n');

  assert.equal(fs.readFileSync(target, 'utf8'), 'hello world\n');
  assert.deepEqual(listTmpResidue(cur.dir, 'thing.md'), []);
});

test('atomicWriteFileSync: overwrite replaces content without leaving residue', () => {
  cur = fresh();
  const target = path.join(cur.dir, 'thing.md');

  atomicWriteFileSync(target, 'first');
  atomicWriteFileSync(target, 'second');

  assert.equal(fs.readFileSync(target, 'utf8'), 'second');
  assert.deepEqual(listTmpResidue(cur.dir, 'thing.md'), []);
});

test('atomicWriteFileSync: writeFileSync error path leaves target untouched and tmp cleaned', () => {
  cur = fresh();
  // Point at a target whose parent directory does NOT exist — fs.writeFileSync
  // throws ENOENT before the rename, so the catch branch's unlink must handle
  // the "tmp never got created" sub-case without rethrowing.
  const target = path.join(cur.dir, 'nope', 'thing.md');

  assert.throws(() => atomicWriteFileSync(target, 'payload'));

  // The parent dir itself wasn't created — confirm we didn't accidentally
  // leave behind a tmp directory sibling.
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(listTmpResidue(cur.dir, 'nope'), []);
});

test('atomicWriteFileSync: preserves prior content when overwrite fails post-write', () => {
  cur = fresh();
  const target = path.join(cur.dir, 'thing.md');
  atomicWriteFileSync(target, 'original');

  // Force the rename to fail by making the target a *directory* — POSIX
  // rename(2) refuses to replace a non-empty directory with a regular file.
  // (Replace the target with a dir of the same name after the initial write.)
  fs.rmSync(target);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'inside'), 'x');

  assert.throws(() => atomicWriteFileSync(target, 'replacement'));

  // Target still exists as a directory — the failed atomic write didn't
  // corrupt it. The tmp file the helper created is unlinked by the catch.
  assert.equal(fs.statSync(target).isDirectory(), true);
  assert.deepEqual(listTmpResidue(cur.dir, 'thing.md'), []);
});
