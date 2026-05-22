/**
 * §11 acceptance walkthrough — port of tests/test_acceptance_e2e.py.
 *
 * Exercises the public CLI surface end-to-end. The hook-script step from
 * the Python version is intentionally deferred to Phase 3 (when hooks
 * become Node files).
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

test('full §11 acceptance e2e (CLI surface)', async () => {
  cur = makeTmpProject();
  const t = cur;

  // §11 step 2: init writes default config (no submitters, no secrets,
  // singular report block, flat schedule).
  let r = await runCli(initArgv('cj-acceptance', '--display-name', 'CJ Acceptance Project'));
  assert.equal(r.exit_code, 0, r.output);

  const projRoot = t.projRootFor('cj-acceptance');
  const cfgPath = path.join(projRoot, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  assert.equal(cfg.project_id, 'cj-acceptance');
  const report = cfg.report as { language: string };
  assert.equal(report.language, 'en');
  const schedule = cfg.schedule as { mode: string };
  assert.equal(schedule.mode, 'manual');
  assert.ok(!('submitters' in cfg));
  assert.ok(!('triggers' in cfg));
  assert.ok(!fs.existsSync(path.join(projRoot, 'secrets.json')));

  // §11 step 4: append three entries.
  for (const [kind, task, summary] of [
    ['note', 'T-100', 'kicked off feature X'],
    ['task_started', 'T-101', 'started bugfix'],
    ['task_completed', 'T-101', 'shipped bugfix'],
  ] as Array<[string, string, string]>) {
    const fm = { kind, refs: { task }, summary };
    const md = `---\n${JSON.stringify(fm, null, 2)}\n---\nbody for ${summary}\n`;
    r = await runCli(['append-entry', '--stdin'], { input: md });
    assert.equal(r.exit_code, 0, r.output);
  }
  const idx = readIndex() as Array<Record<string, unknown>>;
  assert.equal(idx.length, 3);

  // Backdate first entry by 2 days.
  const now = new Date();
  const backdated = new Date(now.getTime() - 2 * 86400_000);
  const backdatedIso = backdated.toISOString().slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);

  const rec = idx[0]!;
  const oldPath = path.join(projRoot, rec.file_path as string);
  const text = fs.readFileSync(oldPath, 'utf8');
  const firstIdx = text.indexOf('---');
  const secondIdx = text.indexOf('---', firstIdx + 3);
  const fmObj = JSON.parse(text.slice(firstIdx + 3, secondIdx).trim()) as Record<string, unknown>;
  fmObj.created_at = backdated.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const newText = `---\n${JSON.stringify(fmObj, null, 2)}\n---${text.slice(secondIdx + 3)}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyymm = `${backdated.getUTCFullYear()}-${pad(backdated.getUTCMonth() + 1)}`;
  const newDir = path.join(projRoot, 'log', 'entries', yyyymm);
  fs.mkdirSync(newDir, { recursive: true });
  const tsSafe = `${backdated.getUTCFullYear()}-${pad(backdated.getUTCMonth() + 1)}-${pad(
    backdated.getUTCDate(),
  )}T${pad(backdated.getUTCHours())}-${pad(backdated.getUTCMinutes())}-${pad(backdated.getUTCSeconds())}`;
  const newName = `${tsSafe}_${rec.id as string}.md`;
  const newPath = path.join(newDir, newName);
  fs.unlinkSync(oldPath);
  fs.writeFileSync(newPath, newText);

  // §11 step 5: list-pending-reports sees backdated date.
  r = await runCli(['list-pending-reports', '--type', 'daily']);
  assert.equal(r.exit_code, 0, r.output);
  let pending = (JSON.parse(r.stdout) as { pending: string[] }).pending;
  assert.ok(pending.includes(backdatedIso));
  assert.ok(!pending.includes(todayIso));

  // §11 step 6: write-report. (Submit retired — Electron handles uploads now.)
  const meta = JSON.stringify({ window: backdatedIso, format: 'daily', source_entry_ids: [] });
  const body = `# Daily ${backdatedIso}\n\n- backdated work\n`;
  r = await runCli(['write-report', '--content', '-', '--meta', '-'], {
    input: `---META---\n${meta}\n---CONTENT---\n${body}`,
  });
  assert.equal(r.exit_code, 0, r.output);

  const reportPath = path.join(projRoot, 'reports', `${backdatedIso}-daily.md`);
  assert.ok(fs.existsSync(reportPath));

  // §11 step 8: list-pending-reports drops dates that now have a report.
  r = await runCli(['list-pending-reports', '--type', 'daily']);
  assert.equal(r.exit_code, 0, r.output);
  pending = (JSON.parse(r.stdout) as { pending: string[] }).pending;
  assert.ok(!pending.includes(backdatedIso));

  // §11 step 9: config get reflects new shape.
  r = await runCli(['config', 'get', 'schedule.mode']);
  assert.equal(r.exit_code, 0);
  assert.equal(r.stdout.trim(), 'manual');
  r = await runCli(['config', 'get', 'report.language']);
  assert.equal(r.exit_code, 0);
  assert.equal(r.stdout.trim(), 'en');
});
