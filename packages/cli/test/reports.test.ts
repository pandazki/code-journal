/**
 * Port of tests/test_reports.py — write-report + list-pending-reports.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { readIndex } from '@code-journal/core';

import { TmpProject, initArgv, makeTmpProject, runCli } from './helper';

let cur: TmpProject | null = null;
afterEach(() => {
  if (cur) {
    cur.cleanup();
    cur = null;
  }
});
function fresh(): TmpProject {
  cur = makeTmpProject();
  return cur;
}

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('write-report saves with frontmatter', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));

  const content = '# Daily 2026-05-07\n\n- did a thing\n';
  const meta = JSON.stringify({
    window: '2026-05-07',
    format: 'daily',
    source_entry_ids: ['e_x_1', 'e_x_2'],
  });
  const r = await runCli(
    ['write-report', '--content', '-', '--meta', '-'],
    { input: `---META---\n${meta}\n---CONTENT---\n${content}` },
  );
  assert.equal(r.exit_code, 0, r.output);

  const projRoot = t.projRootFor('proj-a');
  const reports = fs.readdirSync(path.join(projRoot, 'reports')).filter((f) => f.endsWith('.md'));
  assert.equal(reports.length, 1);
  const text = fs.readFileSync(path.join(projRoot, 'reports', reports[0]!), 'utf8');
  assert.ok(text.startsWith('---\n'));
  const fmText = text.split('---', 3)[1]!.trim();
  const fm = JSON.parse(fmText) as Record<string, unknown>;
  assert.equal(fm.window, '2026-05-07');
  assert.equal(fm.format, 'daily');
  assert.deepEqual(fm.source_entry_ids, ['e_x_1', 'e_x_2']);
  assert.ok(text.includes('did a thing'));
  assert.equal(reports[0], '2026-05-07-daily.md');
});

test('write-report refuses clobber without --force', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  const meta = JSON.stringify({ window: '2026-05-07', format: 'daily', source_entry_ids: [] });
  const payload = `---META---\n${meta}\n---CONTENT---\nbody1`;

  const r1 = await runCli(['write-report', '--content', '-', '--meta', '-'], { input: payload });
  assert.equal(r1.exit_code, 0);

  const r2 = await runCli(['write-report', '--content', '-', '--meta', '-'], { input: payload });
  assert.notEqual(r2.exit_code, 0);
  assert.match(r2.output.toLowerCase(), /exists/);

  const r3 = await runCli(['write-report', '--content', '-', '--meta', '-', '--force'], { input: payload });
  assert.equal(r3.exit_code, 0);
});

async function seedEntryAt(projRoot: string, dt: Date, opts: { kind?: string; task?: string } = {}): Promise<void> {
  const { kind = 'note', task = 'T-1' } = opts;
  const dateIso = dt.toISOString().slice(0, 10);
  const fm = { kind, refs: { task }, summary: `at ${dateIso}` };
  const md = `---\n${JSON.stringify(fm, null, 2)}\n---\nbody\n`;
  await runCli(['append-entry', '--stdin'], { input: md });

  const idx = readIndex() as Array<Record<string, unknown>>;
  const rec = idx[idx.length - 1]!;
  const oldPath = path.join(projRoot, rec.file_path as string);
  const text = fs.readFileSync(oldPath, 'utf8');
  const firstIdx = text.indexOf('---');
  const secondIdx = text.indexOf('---', firstIdx + 3);
  const fmObj = JSON.parse(text.slice(firstIdx + 3, secondIdx).trim()) as Record<string, unknown>;
  fmObj.created_at = dt.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const newText = `---\n${JSON.stringify(fmObj, null, 2)}\n---${text.slice(secondIdx + 3)}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyymm = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
  const newDir = path.join(projRoot, 'log', 'entries', yyyymm);
  fs.mkdirSync(newDir, { recursive: true });
  const tsSafe = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(
    dt.getUTCHours(),
  )}-${pad(dt.getUTCMinutes())}-${pad(dt.getUTCSeconds())}`;
  const newName = `${tsSafe}_${rec.id as string}.md`;
  const newPath = path.join(newDir, newName);
  fs.unlinkSync(oldPath);
  fs.writeFileSync(newPath, newText);
  // No index to update — readers rescan log/entries/ and pick up the
  // moved file + rewritten frontmatter directly.
}

test('list-pending-reports diffs against existing', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));
  const projRoot = t.projRootFor('proj-a');
  const today = new Date();
  for (const n of [5, 3, 1]) {
    const dt = new Date(today.getTime() - n * 86400_000);
    await seedEntryAt(projRoot, dt);
  }
  const day3 = new Date(today.getTime() - 3 * 86400_000).toISOString().slice(0, 10);
  const meta = JSON.stringify({ window: day3, format: 'daily', source_entry_ids: [] });
  await runCli(['write-report', '--content', '-', '--meta', '-'], {
    input: `---META---\n${meta}\n---CONTENT---\nbody`,
  });
  const r = await runCli(['list-pending-reports', '--type', 'daily']);
  assert.equal(r.exit_code, 0, r.output);
  const out = JSON.parse(r.stdout) as { pending: string[] };
  const pending = [...out.pending].sort();
  const expected = [
    new Date(today.getTime() - 5 * 86400_000).toISOString().slice(0, 10),
    new Date(today.getTime() - 1 * 86400_000).toISOString().slice(0, 10),
  ].sort();
  assert.deepEqual(pending, expected);
});

test('list-pending-reports excludes empty days', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));
  const projRoot = t.projRootFor('proj-a');
  const today = new Date();
  const dt = new Date(today.getTime() - 2 * 86400_000);
  await seedEntryAt(projRoot, dt);
  const r = await runCli(['list-pending-reports', '--type', 'daily']);
  const out = JSON.parse(r.stdout) as { pending: string[] };
  assert.deepEqual(out.pending, [dt.toISOString().slice(0, 10)]);
});

test('list-pending-reports respects lookback cap', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));
  const projRoot = t.projRootFor('proj-a');
  const today = new Date();
  await seedEntryAt(projRoot, new Date(today.getTime() - 60 * 86400_000));
  await seedEntryAt(projRoot, new Date(today.getTime() - 2 * 86400_000));
  const r = await runCli(['list-pending-reports', '--type', 'daily', '--lookback-days', '30']);
  const out = JSON.parse(r.stdout) as { pending: string[] };
  assert.deepEqual(out.pending, [
    new Date(today.getTime() - 2 * 86400_000).toISOString().slice(0, 10),
  ]);
});
