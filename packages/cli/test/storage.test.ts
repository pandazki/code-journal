/**
 * Integration tests via the CLI. Port of tests/test_storage.py.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_CATCHUP_LOOKBACK_DAYS, readIndex, scanEntries } from '@code-journal/core';

import { MOCK_ORG_ID, MOCK_USER_ID, TmpProject, entryMd, initArgv, makeTmpProject, runCli } from './helper';

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

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

test('init writes default config', async () => {
  const t = fresh();
  const r = await runCli(initArgv('proj-a', '--display-name', 'Project A'));
  assert.equal(r.exit_code, 0, r.output);
  const projRoot = t.projRootFor('proj-a');
  const cfg = readJson(path.join(projRoot, 'config.json')) as Record<string, unknown>;
  assert.equal(cfg.project_id, 'proj-a');
  assert.equal(cfg.display_name, 'Project A');
  const report = cfg.report as { catchup_lookback_days: number; language: string };
  assert.equal(report.catchup_lookback_days, DEFAULT_CATCHUP_LOOKBACK_DAYS);
  assert.equal(report.language, 'en');
  const schedule = cfg.schedule as { mode: string };
  assert.equal(schedule.mode, 'manual');
  // No submitters / triggers wrapper / secrets anywhere.
  assert.ok(!('submitters' in cfg));
  assert.ok(!('triggers' in cfg));
  assert.ok(!fs.existsSync(path.join(projRoot, 'secrets.json')));
  assert.ok(fs.statSync(path.join(projRoot, 'log', 'entries')).isDirectory());
  assert.ok(fs.statSync(path.join(projRoot, 'reports')).isDirectory());
  // Post no-pointer refactor: init writes ZERO files inside the cwd.
  // The cwd → project link is recorded only in `config.cwds[]` at the
  // user-home root.
  assert.ok(!fs.existsSync(path.join(t.tmpDir, '.code-journal')));
});

test('init auto-detects a host timezone when none is given', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  const r = await runCli(['config', 'get', 'timezone']);
  assert.equal(r.exit_code, 0, r.output);
  // A non-empty IANA zone the platform accepts — the auto-detected host zone.
  const tz = r.stdout.trim();
  assert.ok(tz.length > 0, 'timezone should be auto-detected, not empty');
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: tz }));
});

test('a pinned timezone flows into entry created_at and keeps today/yesterday consistent', async () => {
  fresh();
  // Pin a fixed zone so the assertions hold regardless of the host's zone or
  // the wall-clock moment the suite runs — the whole point of the config.
  await runCli(initArgv('proj-a', '--timezone', 'Asia/Shanghai'));
  assert.equal((await runCli(['config', 'get', 'timezone'])).stdout.trim(), 'Asia/Shanghai');

  await runCli(['append-entry', '--stdin'], { input: entryMd() });

  // The defaulted created_at carries the project zone's offset, so the date
  // sliced off it (how the entry is filed and windowed) is the Shanghai day.
  const rows = JSON.parse(
    (await runCli(['query', '--window', 'today', '--format', 'json'])).stdout,
  ) as Array<{ created_at: string }>;
  assert.equal(rows.length, 1);
  assert.ok(
    rows[0]!.created_at.endsWith('+08:00'),
    `created_at should carry the pinned +08:00 offset, got ${rows[0]!.created_at}`,
  );

  // Filing and "today" reckon in the same (pinned) zone, so today sees it and
  // yesterday does not — the consistency the host-vs-UTC split used to break.
  const yday = JSON.parse(
    (await runCli(['query', '--window', 'yesterday', '--format', 'json'])).stdout,
  ) as unknown[];
  assert.equal(yday.length, 0);
});

test('init is idempotent', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  const r = await runCli(initArgv('proj-a'));
  assert.equal(r.exit_code, 0);
  assert.match(r.output.toLowerCase(), /already initialized/);
});

test('init with report language stores it', async () => {
  const t = fresh();
  await runCli(initArgv('x', '--report-language', 'zh-CN'));
  const cfg = readJson(path.join(t.projRootFor('x'), 'config.json')) as {
    report: { language: string };
  };
  assert.equal(cfg.report.language, 'zh-CN');
});

test('init without report language defaults to en', async () => {
  const t = fresh();
  await runCli(initArgv('x'));
  const cfg = readJson(path.join(t.projRootFor('x'), 'config.json')) as {
    report: { language: string };
  };
  assert.equal(cfg.report.language, 'en');
});

// ---------------------------------------------------------------------------
// config get
// ---------------------------------------------------------------------------

test('config get dotted', async () => {
  fresh();
  await runCli(initArgv('proj-a'));

  let r = await runCli(['config', 'get', 'schedule.mode']);
  assert.equal(r.exit_code, 0);
  assert.equal(r.stdout.trim(), 'manual');

  r = await runCli(['config', 'get', 'report.catchup_lookback_days']);
  assert.equal(r.exit_code, 0);
  assert.equal(r.stdout.trim(), '14');

  r = await runCli(['config', 'get', 'does.not.exist']);
  assert.equal(r.exit_code, 1);
});

// ---------------------------------------------------------------------------
// append-entry
// ---------------------------------------------------------------------------

test('scanEntries parity: directory scan returns the same records as index.json', async () => {
  // Phase 1 of the index-removal refactor: scanEntries reads log/entries/
  // directly. After several appends, it must match readIndex() exactly so
  // every downstream caller can be redirected in Phase 2 without surprise.
  fresh();
  await runCli(initArgv('proj-a'));

  await runCli(['append-entry', '--stdin'], { input: entryMd({ summary: 'a' }) });
  await runCli(['append-entry', '--stdin'], { input: entryMd({ kind: 'decision', summary: 'b', task: 'T-2' }) });
  await runCli(['append-entry', '--stdin'], { input: entryMd({ summary: 'c', task: 'T-3' }) });

  const fromIndex = readIndex();
  const fromScan = scanEntries();
  assert.equal(fromScan.length, fromIndex.length);
  assert.deepEqual(fromScan, fromIndex);
});

test('append-entry writes file and indexes', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));

  const r = await runCli(['append-entry', '--stdin'], { input: entryMd() });
  assert.equal(r.exit_code, 0, r.output);

  const projRoot = t.projRootFor('proj-a');
  const entriesDir = path.join(projRoot, 'log', 'entries');
  const entries = walkMd(entriesDir);
  assert.equal(entries.length, 1);
  const text = fs.readFileSync(entries[0]!, 'utf8');
  assert.ok(text.includes('"summary": "did a thing"'));
  assert.ok(text.includes('## Narrative'));

  const fmStr = text.split('---', 3)[1]!.trim();
  const fm = JSON.parse(fmStr) as Record<string, unknown>;
  assert.ok((fm.id as string).startsWith('e_'));
  assert.equal(fm.project_id, 'proj-a');
  assert.equal(fm.agent_backend, 'manual');
  assert.ok('created_at' in fm);

  const idx = readIndex() as Array<Record<string, unknown>>;
  assert.equal(idx.length, 1);
  assert.equal(idx[0]!.kind, 'note');
  const refs0 = idx[0]!.refs as { task: string };
  assert.equal(refs0.task, 'T-1');
  assert.equal(idx[0]!.summary, 'did a thing');
  assert.ok(!('narrative' in idx[0]!));
  assert.ok((idx[0]!.file_path as string).startsWith('log/entries/'));
});

test('append-entry two entries same task share refs', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));
  await runCli(['append-entry', '--stdin'], { input: entryMd({ kind: 'task_started', task: 'T-7' }) });
  await runCli(['append-entry', '--stdin'], { input: entryMd({ kind: 'task_completed', task: 'T-7' }) });
  const idx = readIndex() as Array<Record<string, unknown>>;
  assert.equal(idx.length, 2);
  const kinds = new Set(idx.map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), ['task_completed', 'task_started']);
});

test('append-entry rejects unknown kind when not extended', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  const r = await runCli(['append-entry', '--stdin'], {
    input: entryMd({ kind: 'customer_meeting' }),
  });
  assert.notEqual(r.exit_code, 0);
  assert.match(r.output.toLowerCase(), /unknown kind/);
});

test('append-entry accepts custom kind when extended', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));
  const cfgPath = path.join(t.projRootFor('proj-a'), 'config.json');
  const cfg = readJson(cfgPath) as Record<string, unknown>;
  cfg.schema = { custom_kinds: ['customer_meeting'] };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = await runCli(['append-entry', '--stdin'], {
    input: entryMd({ kind: 'customer_meeting' }),
  });
  assert.equal(r.exit_code, 0, r.output);
});

test('append-entry with supplied created_at files in matching month', async () => {
  const t = fresh();
  await runCli(initArgv('proj-a'));
  const fm = { kind: 'note', created_at: '2024-03-15T10:30:00+00:00', summary: 'backfilled entry' };
  const md = `---\n${JSON.stringify(fm, null, 2)}\n---\nbody\n`;
  const r = await runCli(['append-entry', '--stdin'], { input: md });
  assert.equal(r.exit_code, 0, r.output);

  const projRoot = t.projRootFor('proj-a');
  const marchDir = path.join(projRoot, 'log', 'entries', '2024-03');
  const march = fs.readdirSync(marchDir).filter((f) => f.endsWith('.md'));
  assert.equal(march.length, 1);
  assert.ok(march[0]!.startsWith('2024-03-15T10-30-00_'));

  const idx = readIndex() as Array<Record<string, unknown>>;
  assert.equal(idx[0]!.created_at, '2024-03-15T10:30:00+00:00');
  assert.ok((idx[0]!.file_path as string).startsWith('log/entries/2024-03/'));
});

test('append-entry id uses created_at date', async () => {
  const t = fresh();
  await runCli(initArgv('p'));
  const fm = { kind: 'note', created_at: '2024-03-15T10:30:00+00:00', summary: 'backfilled' };
  const md = `---\n${JSON.stringify(fm, null, 2)}\n---\nbody\n`;
  const r = await runCli(['append-entry', '--stdin'], { input: md });
  assert.equal(r.exit_code, 0);
  const idx = readIndex() as Array<Record<string, unknown>>;
  assert.ok((idx[0]!.id as string).startsWith('e_2024-03-15_'));
});

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

test('query default is frontmatter-only', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  await runCli(['append-entry', '--stdin'], { input: entryMd({ summary: 'alpha' }) });
  const r = await runCli(['query', '--format', 'json']);
  assert.equal(r.exit_code, 0);
  const rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.summary, 'alpha');
  assert.ok(!('narrative' in rows[0]!));
  assert.ok(!r.stdout.includes('body text'));
});

test('query with --include-body returns narrative', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  await runCli(['append-entry', '--stdin'], { input: entryMd({ summary: 'alpha' }) });
  const r = await runCli(['query', '--format', 'json', '--include-body']);
  assert.equal(r.exit_code, 0);
  const rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.ok((rows[0]!.narrative as string).includes('body text'));
});

test('query window today vs yesterday', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  await runCli(['append-entry', '--stdin'], { input: entryMd() });
  const rToday = await runCli(['query', '--window', 'today', '--format', 'json']);
  const rYesterday = await runCli(['query', '--window', 'yesterday', '--format', 'json']);
  assert.equal((JSON.parse(rToday.stdout) as unknown[]).length, 1);
  assert.equal((JSON.parse(rYesterday.stdout) as unknown[]).length, 0);
});

test('query filters by kind and task', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  await runCli(['append-entry', '--stdin'], { input: entryMd({ kind: 'task_started', task: 'T-1' }) });
  await runCli(['append-entry', '--stdin'], { input: entryMd({ kind: 'task_completed', task: 'T-1' }) });
  await runCli(['append-entry', '--stdin'], { input: entryMd({ kind: 'note', task: 'T-2' }) });

  let r = await runCli(['query', '--kind', 'task_completed', '--format', 'json']);
  let rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, 'task_completed');

  r = await runCli(['query', '--task', 'T-1', '--format', 'json']);
  rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);
});

// ---------------------------------------------------------------------------
// Work-period entries
// ---------------------------------------------------------------------------

function entryMdWithPeriod(opts: {
  kind?: string;
  workStarted?: string;
  workEnded?: string;
  summary?: string;
}): string {
  const { kind = 'task_completed', workStarted, workEnded, summary = 'did a thing' } = opts;
  const fm: Record<string, unknown> = { kind, summary };
  if (workStarted) fm.work_started_at = workStarted;
  if (workEnded) fm.work_ended_at = workEnded;
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\nbody\n`;
}

test('append-entry with work period files by started_at', async () => {
  const t = fresh();
  await runCli(initArgv('p'));
  const md = entryMdWithPeriod({
    workStarted: '2026-03-15T10:00:00+00:00',
    workEnded: '2026-03-15T13:30:00+00:00',
  });
  const r = await runCli(['append-entry', '--stdin'], { input: md });
  assert.equal(r.exit_code, 0, r.output);

  const projRoot = t.projRootFor('p');
  const marchDir = path.join(projRoot, 'log', 'entries', '2026-03');
  const march = fs.readdirSync(marchDir).filter((f) => f.endsWith('.md'));
  assert.equal(march.length, 1);
  assert.ok(march[0]!.startsWith('2026-03-15T10-00-00_e_2026-03-15_'));

  const idx = readIndex() as Array<Record<string, unknown>>;
  assert.equal(idx[0]!.work_started_at, '2026-03-15T10:00:00+00:00');
  assert.equal(idx[0]!.work_ended_at, '2026-03-15T13:30:00+00:00');
  assert.ok((idx[0]!.id as string).startsWith('e_2026-03-15_'));
});

test('append-entry work_ended without started is rejected', async () => {
  fresh();
  await runCli(initArgv('p'));
  const md = entryMdWithPeriod({ workEnded: '2026-03-15T13:30:00+00:00' });
  const r = await runCli(['append-entry', '--stdin'], { input: md });
  assert.notEqual(r.exit_code, 0);
  assert.match(r.output.toLowerCase(), /work_ended_at/);
});

test('append-entry inverted period is rejected', async () => {
  fresh();
  await runCli(initArgv('p'));
  const md = entryMdWithPeriod({
    workStarted: '2026-03-15T13:30:00+00:00',
    workEnded: '2026-03-15T10:00:00+00:00',
  });
  const r = await runCli(['append-entry', '--stdin'], { input: md });
  assert.notEqual(r.exit_code, 0);
});

test('query window uses work_started_at when present', async () => {
  fresh();
  await runCli(initArgv('p'));
  const fm = {
    kind: 'task_completed',
    work_started_at: '2024-03-15T10:00:00+00:00',
    work_ended_at: '2024-03-15T13:30:00+00:00',
    summary: 'backfilled work',
  };
  const md = `---\n${JSON.stringify(fm, null, 2)}\n---\nbody\n`;
  await runCli(['append-entry', '--stdin'], { input: md });
  const r = await runCli(['query', '--window', '2024-03-15', '--format', 'json']);
  const rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.summary, 'backfilled work');
});

test('query window range-overlap finds multi-day entries', async () => {
  fresh();
  await runCli(initArgv('p'));
  const fm = {
    kind: 'task_completed',
    work_started_at: '2026-03-07T10:00:00+00:00',
    work_ended_at: '2026-03-09T17:00:00+00:00',
    summary: 'three-day work',
  };
  const md = `---\n${JSON.stringify(fm, null, 2)}\n---\nbody\n`;
  await runCli(['append-entry', '--stdin'], { input: md });

  for (const day of ['2026-03-07', '2026-03-08', '2026-03-09']) {
    const r = await runCli(['query', '--window', day, '--format', 'json']);
    const rows = JSON.parse(r.stdout) as unknown[];
    assert.equal(rows.length, 1, `day ${day} should match`);
  }
  for (const day of ['2026-03-06', '2026-03-10']) {
    const r = await runCli(['query', '--window', day, '--format', 'json']);
    assert.deepEqual(JSON.parse(r.stdout), [], `day ${day} should NOT match`);
  }
});

test('index is sorted by effective start date', async () => {
  const t = fresh();
  await runCli(initArgv('p'));

  const append = async (ws: string, summary: string) => {
    const fm = { kind: 'note', work_started_at: ws, summary };
    const md = `---\n${JSON.stringify(fm, null, 2)}\n---\nbody\n`;
    await runCli(['append-entry', '--stdin'], { input: md });
  };

  await append('2026-05-01T10:00:00+00:00', 'B');
  await append('2026-04-01T10:00:00+00:00', 'A');
  await append('2026-06-01T10:00:00+00:00', 'C');

  const idx = readIndex() as Array<Record<string, unknown>>;
  const summaries = idx.map((r) => r.summary);
  assert.deepEqual(summaries, ['A', 'B', 'C']);
});

test('append-entry passes through thinking fields into index', async () => {
  const t = fresh();
  await runCli(initArgv('p'));
  const md = `---\n${JSON.stringify({
    kind: 'note',
    summary: 'x',
    motivation: 'user wanted Y because Z',
    approach: 'considered A and B; picked B',
    attempts: ['tried A; gave up after D'],
    lessons: ['A breaks under E'],
    decisions: ['picked B over A'],
    next_steps: ['wire up C'],
    blockers: ['awaiting D approval'],
  })}\n---\n\nbody\n`;
  const r = await runCli(['append-entry', '--stdin'], { input: md });
  assert.equal(r.exit_code, 0, r.output);
  const idx = readIndex() as Array<Record<string, unknown>>;
  assert.ok((idx[0]!.motivation as string).startsWith('user wanted Y'));
  assert.ok((idx[0]!.approach as string).startsWith('considered'));
  assert.deepEqual(idx[0]!.attempts, ['tried A; gave up after D']);
  assert.deepEqual(idx[0]!.lessons, ['A breaks under E']);
  assert.deepEqual(idx[0]!.decisions, ['picked B over A']);
  assert.deepEqual(idx[0]!.next_steps, ['wire up C']);
  assert.deepEqual(idx[0]!.blockers, ['awaiting D approval']);
});

// ---------------------------------------------------------------------------
// Pointer + cwds + cross-cwd union
// ---------------------------------------------------------------------------

test('init writes no pointer or other file into the cwd', async () => {
  const t = fresh();
  const beforeEntries = new Set(fs.readdirSync(t.tmpDir));
  await runCli(initArgv('proj-a'));
  const afterEntries = new Set(fs.readdirSync(t.tmpDir));
  assert.deepEqual([...afterEntries].sort(), [...beforeEntries].sort(),
    'init must not create any file inside cwd (no-pointer design)');
});

test('init records cwd in config.json.cwds', async () => {
  const t = fresh();
  await runCli(initArgv('p', '--display-name', 'Project P'));
  const cfg = readJson(path.join(t.projRootFor('p'), 'config.json')) as Record<string, unknown>;
  assert.deepEqual(cfg.cwds, [t.tmpDir]);
  assert.ok('first_registered' in cfg);
  assert.ok('last_updated' in cfg);
});

test('init in second cwd with same id appends idempotent', async () => {
  const t = fresh();
  await runCli(initArgv('shared', '--display-name', 'Shared'));

  // Nested inside tmpDir so fixture cleanup removes it (avoids leakage
  // between test runs from stale pointer files in a fixed sibling path).
  const other = path.join(t.tmpDir, 'cj-shared-other');
  fs.mkdirSync(other, { recursive: true });
  t.chdir(other);
  await runCli(initArgv('shared', '--display-name', 'Different Name'));

  const cfg = readJson(path.join(t.projRootFor('shared'), 'config.json')) as {
    cwds: string[];
    display_name: string;
  };
  assert.equal(cfg.cwds.length, 2);
  assert.deepEqual([...cfg.cwds].sort(), cfg.cwds);
  assert.ok(cfg.cwds.includes(t.tmpDir));
  assert.ok(cfg.cwds.includes(other));
  assert.equal(cfg.display_name, 'Shared');
});

test('init refuses when cwd already registered to a different project', async () => {
  fresh();
  await runCli(initArgv('proj-a'));
  const r = await runCli(initArgv('proj-b'));
  assert.notEqual(r.exit_code, 0);
  assert.ok((r.stdout + r.stderr).toLowerCase().includes('proj-a'));
});

test('list-projects human format', async () => {
  const t = fresh();
  await runCli(initArgv('p', '--display-name', 'Project P'));
  const r = await runCli(['list-projects']);
  assert.equal(r.exit_code, 0, r.output);
  assert.ok(r.stdout.includes('p  (Project P)'));
  assert.ok(r.stdout.includes(t.tmpDir));
});

test('list-projects json format', async () => {
  fresh();
  await runCli(initArgv('p'));
  const r = await runCli(['list-projects', '--json']);
  assert.equal(r.exit_code, 0, r.output);
  const data = JSON.parse(r.stdout) as { version: number; projects: Record<string, unknown> };
  assert.ok(`${MOCK_USER_ID}/${MOCK_ORG_ID}/p` in data.projects);
  assert.equal(data.version, 1);
});

test('list-projects --ids-only', async () => {
  const t = fresh();
  await runCli(initArgv('p1'));
  const other = path.join(t.tmpDir, 'cj-other-proj');
  fs.mkdirSync(other, { recursive: true });
  t.chdir(other);
  await runCli(initArgv('p2'));
  const r = await runCli(['list-projects', '--ids-only']);
  assert.equal(r.exit_code, 0, r.output);
  const ids = r.stdout.trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(ids, [
    `${MOCK_USER_ID}/${MOCK_ORG_ID}/p1`,
    `${MOCK_USER_ID}/${MOCK_ORG_ID}/p2`,
  ]);
});

test('list-projects empty system is silent', async () => {
  fresh();
  const r = await runCli(['list-projects']);
  assert.equal(r.exit_code, 0, r.output);
  assert.equal(r.stdout, '');
});

test('query unions across cwds via shared project root', async () => {
  const t = fresh();
  await runCli(initArgv('shared'));
  await runCli(['append-entry', '--stdin'], {
    input: '---\n{"kind":"note","summary":"from cwd A"}\n---\n\nbody a',
  });
  const other = path.join(t.tmpDir, 'cj-shared-cwd-b');
  fs.mkdirSync(other, { recursive: true });
  t.chdir(other);
  await runCli(initArgv('shared'));
  await runCli(['append-entry', '--stdin'], {
    input: '---\n{"kind":"note","summary":"from cwd B"}\n---\n\nbody b',
  });
  let r = await runCli(['query', '--format', 'json']);
  let rows = (JSON.parse(r.stdout) as Array<{ summary: string }>).map((row) => row.summary).sort();
  assert.deepEqual(rows, ['from cwd A', 'from cwd B']);
  t.chdir(t.tmpDir);
  r = await runCli(['query', '--format', 'json']);
  rows = (JSON.parse(r.stdout) as Array<{ summary: string }>).map((row) => row.summary).sort();
  assert.deepEqual(rows, ['from cwd A', 'from cwd B']);
});

// ---------------------------------------------------------------------------
// delete-project
// ---------------------------------------------------------------------------

function deleteArgv(projectId: string, ...extra: string[]): string[] {
  return [
    'delete-project',
    '--user-id', MOCK_USER_ID,
    '--org-id', MOCK_ORG_ID,
    '--project-id', projectId,
    ...extra,
  ];
}

/** `--confirm <user/org/projectId>` — the new "actually delete" gate. */
function confirmFor(projectId: string): string[] {
  return ['--confirm', `${MOCK_USER_ID}/${MOCK_ORG_ID}/${projectId}`];
}

test('delete-project dry-run prints summary, deletes nothing, exits 0', async () => {
  const t = fresh();
  await runCli(initArgv('p-del', '--display-name', 'P-Del'));
  await runCli(['append-entry', '--stdin'], {
    input: '---\n{"kind":"note","summary":"one entry"}\n---\n\nbody',
  });
  const projRoot = t.projRootFor('p-del');
  assert.ok(fs.existsSync(projRoot));

  const r = await runCli(deleteArgv('p-del'));
  assert.equal(r.exit_code, 0, r.output);
  const summary = JSON.parse(r.stdout) as {
    deleted: boolean;
    key: string;
    entry_count: number;
    project_root: string;
  };
  assert.equal(summary.deleted, false);
  assert.equal(summary.key, `${MOCK_USER_ID}/${MOCK_ORG_ID}/p-del`);
  assert.equal(summary.entry_count, 1);
  assert.equal(summary.project_root, projRoot);
  assert.ok(r.stderr.toLowerCase().includes('dry-run'));
  // Crucial: the project tree must still exist after a dry-run.
  assert.ok(fs.existsSync(projRoot));
  assert.ok(fs.existsSync(path.join(projRoot, 'config.json')));
});

test('delete-project --confirm removes the tree and prunes empty parents', async () => {
  const t = fresh();
  await runCli(initArgv('p-del'));
  const projRoot = t.projRootFor('p-del');
  const orgDir = path.dirname(path.dirname(projRoot)); // .../<user>/<org>
  const userDir = path.dirname(orgDir); // .../<user>
  assert.ok(fs.existsSync(projRoot));

  const r = await runCli(deleteArgv('p-del', ...confirmFor('p-del')));
  assert.equal(r.exit_code, 0, r.output);
  const summary = JSON.parse(r.stdout) as { deleted: boolean; parents_pruned: string[] };
  assert.equal(summary.deleted, true);

  assert.ok(!fs.existsSync(projRoot), 'project root must be gone');
  // org + user dirs were empty after delete → both pruned.
  assert.ok(!fs.existsSync(orgDir), `org dir should be pruned: ${orgDir}`);
  assert.ok(!fs.existsSync(userDir), `user dir should be pruned: ${userDir}`);
  assert.ok(summary.parents_pruned.length >= 1);
});

test('delete-project --confirm keeps siblings under same org', async () => {
  const t = fresh();
  await runCli(initArgv('p-keep'));
  // Second project must be init'd from a different cwd, otherwise init refuses
  // (the original cwd already belongs to p-keep).
  const cwdDel = path.join(t.tmpDir, 'cj-sibling-cwd');
  fs.mkdirSync(cwdDel, { recursive: true });
  t.chdir(cwdDel);
  await runCli(initArgv('p-del'));
  t.chdir(t.tmpDir);
  const keepRoot = t.projRootFor('p-keep');
  const delRoot = t.projRootFor('p-del');
  const orgDir = path.dirname(path.dirname(delRoot));
  assert.ok(fs.existsSync(keepRoot));
  assert.ok(fs.existsSync(delRoot));

  const r = await runCli(deleteArgv('p-del', ...confirmFor('p-del')));
  assert.equal(r.exit_code, 0, r.output);
  assert.ok(!fs.existsSync(delRoot));
  // Sibling and shared org/user dirs must remain because the sibling lives there.
  assert.ok(fs.existsSync(keepRoot));
  assert.ok(fs.existsSync(orgDir));
});

test('delete-project missing project errors with exit 1', async () => {
  fresh();
  const r = await runCli(deleteArgv('does-not-exist', ...confirmFor('does-not-exist')));
  assert.notEqual(r.exit_code, 0);
  assert.ok(r.stderr.toLowerCase().includes('project not found'));
});

test('delete-project requires the three id flags', async () => {
  fresh();
  const r = await runCli(['delete-project']);
  assert.equal(r.exit_code, 2);
  assert.ok(r.stderr.includes('--user-id'));
});

test('delete-project --confirm with wrong key is rejected with exit 2', async () => {
  const t = fresh();
  await runCli(initArgv('p-key'));
  // Caller passes a confirm value that doesn't match the project — refuse hard.
  const r = await runCli(deleteArgv('p-key', '--confirm', 'mock-user/mock-org/different'));
  assert.equal(r.exit_code, 2, r.output);
  assert.ok(r.stderr.toLowerCase().includes('does not match'));
  // Crucially: project must still exist.
  assert.ok(fs.existsSync(t.projRootFor('p-key')));
});

test('delete-project --key parses composite triple', async () => {
  const t = fresh();
  await runCli(initArgv('p-key'));
  const r = await runCli([
    'delete-project',
    '--key', `${MOCK_USER_ID}/${MOCK_ORG_ID}/p-key`,
    '--confirm', `${MOCK_USER_ID}/${MOCK_ORG_ID}/p-key`,
  ]);
  assert.equal(r.exit_code, 0, r.output);
  assert.ok(!fs.existsSync(t.projRootFor('p-key')));
});

test('delete-project followed by whoami in the same cwd reports MISSING', async () => {
  const t = fresh();
  await runCli(initArgv('p-del'));
  // Sanity: cwd is registered.
  let r = await runCli(['whoami']);
  assert.equal(r.exit_code, 0);
  assert.ok(r.stdout.includes('p-del'));

  await runCli(deleteArgv('p-del', ...confirmFor('p-del')));

  // After delete: whoami should fail (no project owns this cwd anymore).
  r = await runCli(['whoami']);
  assert.notEqual(r.exit_code, 0);
  void t; // suppress unused-var lint
});

// ---------------------------------------------------------------------------
// cwd-overlap / canonicalization / unregister-cwd
// ---------------------------------------------------------------------------

test('whoami detects multi-project overlap and refuses to choose silently', async () => {
  const t = fresh();
  // Init two projects from sibling cwds.
  await runCli(initArgv('p-a'));
  const cwdB = path.join(t.tmpDir, 'cj-overlap-b');
  fs.mkdirSync(cwdB, { recursive: true });
  t.chdir(cwdB);
  await runCli(initArgv('p-b'));
  t.chdir(t.tmpDir);

  // Manually corrupt: also add t.tmpDir into p-b's cwds[] (simulating a
  // restored backup / hand-edit). This is exactly the failure mode the
  // multi-match check exists to catch.
  const pBConfig = path.join(t.projRootFor('p-b'), 'config.json');
  const cfg = JSON.parse(fs.readFileSync(pBConfig, 'utf8')) as { cwds: string[] };
  cfg.cwds.push(t.tmpDir);
  fs.writeFileSync(pBConfig, JSON.stringify(cfg, null, 2) + '\n');

  // Now both p-a and p-b claim t.tmpDir. whoami should refuse loudly.
  const r = await runCli(['whoami']);
  assert.notEqual(r.exit_code, 0);
  assert.ok(
    r.stderr.toLowerCase().includes('multiple projects'),
    `expected overlap error, got: ${r.stderr}`,
  );
  assert.ok(r.stderr.includes('p-a'));
  assert.ok(r.stderr.includes('p-b'));
});

test('addCwdToConfig refuses to register a cwd already owned by another project', async () => {
  const t = fresh();
  await runCli(initArgv('p-a'));
  // Try to also init the SAME cwd as p-b. The reverse-scan path will see
  // p-a already claims this cwd and refuse with a clear message naming p-a.
  const r = await runCli(initArgv('p-b'));
  assert.notEqual(r.exit_code, 0);
  assert.ok(r.output.toLowerCase().includes('p-a'));
  // p-b's tree must NOT exist (init refused before writing anything).
  assert.ok(!fs.existsSync(t.projRootFor('p-b')));
});

test('unregister-cwd removes the registration and frees the cwd', async () => {
  const t = fresh();
  await runCli(initArgv('p-a'));
  let r = await runCli(['whoami']);
  assert.equal(r.exit_code, 0);
  assert.ok(r.stdout.includes('p-a'));

  // Unregister with no args — auto-detects from current cwd + only owner.
  r = await runCli(['unregister-cwd']);
  assert.equal(r.exit_code, 0, r.output);
  assert.ok(r.stdout.toLowerCase().includes('unregistered'));

  // whoami now reports MISSING.
  r = await runCli(['whoami']);
  assert.notEqual(r.exit_code, 0);

  // And the cwd can be re-init'd to a different project without overlap.
  r = await runCli(initArgv('p-b'));
  assert.equal(r.exit_code, 0, r.output);
  assert.ok(fs.existsSync(t.projRootFor('p-b')));
});

test('unregister-cwd reports "not in config.cwds[]" when there is no match', async () => {
  fresh();
  // Initialize a project, then try to unregister a cwd that's not registered.
  await runCli(initArgv('p-a'));
  const r = await runCli([
    'unregister-cwd',
    '--cwd', '/some/path/never/registered',
    '--user-id', MOCK_USER_ID,
    '--org-id', MOCK_ORG_ID,
    '--project-id', 'p-a',
  ]);
  assert.notEqual(r.exit_code, 0);
  assert.ok(r.stderr.toLowerCase().includes('was not in'));
});

// ---------------------------------------------------------------------------
// project-root fast-path: whoami / query work when cwd IS the project home
// ---------------------------------------------------------------------------

test('whoami resolves when cwd is the project root dir (no cwds[] entry)', async () => {
  const t = fresh();
  await runCli(initArgv('p-root'));
  // Append an entry from the registered cwd so there's something to query.
  await runCli(['append-entry', '--stdin'], {
    input: '---\n{"kind":"note","summary":"from registered cwd"}\n---\n\nbody',
  });
  // Now chdir into the project's user-home dir — which is NOT in any
  // project's config.cwds[]. The fast-path should resolve it directly.
  const projRoot = t.projRootFor('p-root');
  t.chdir(projRoot);

  const whoami = await runCli(['whoami']);
  assert.equal(whoami.exit_code, 0, whoami.output);
  assert.ok(whoami.stdout.includes('p-root'), `unexpected whoami: ${whoami.stdout}`);

  // query should also work from the project root.
  const q = await runCli(['query', '--format', 'json']);
  assert.equal(q.exit_code, 0, q.output);
  const rows = JSON.parse(q.stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, 'from registered cwd');
});

test('init from inside a project root refuses to switch to a different project', async () => {
  // With the fast-path, cmdInit's findProjectKeyForCwd intercepts before
  // addCwdToConfig — so the user-facing message says "already registered
  // to <self>; refusing to switch to <other>" rather than the deeper
  // "refusing to register project-root" guard. End result is the same:
  // the project-root path never lands in any other project's cwds[].
  const t = fresh();
  await runCli(initArgv('p-root'));
  const projRoot = t.projRootFor('p-root');

  // From inside p-root's home dir, try to init it as a different project.
  t.chdir(projRoot);
  const r = await runCli(initArgv('p-other'));
  assert.notEqual(r.exit_code, 0);
  assert.ok(
    r.output.toLowerCase().includes("already registered to project 'mock-user/mock-org/p-root'"),
    `expected "already registered" message, got: ${r.output}`,
  );
  // The other project must NOT have been created.
  assert.ok(!fs.existsSync(t.projRootFor('p-other')));
});

test('init from inside a project root is idempotent for the matching key', async () => {
  // Same project key from inside the project root → no-op refresh,
  // not an error. (whoami already proves the fast-path resolves it.)
  const t = fresh();
  await runCli(initArgv('p-root'));
  t.chdir(t.projRootFor('p-root'));
  const r = await runCli(initArgv('p-root'));
  assert.equal(r.exit_code, 0, r.output);
  assert.match(r.output.toLowerCase(), /already initialized/);
});

// ---------------------------------------------------------------------------
// query window validation
// ---------------------------------------------------------------------------

test('query --window rejects garbage date strings', async () => {
  fresh();
  await runCli(initArgv('p-q'));
  const r = await runCli(['query', '--window', 'not-a-date', '--format', 'json']);
  assert.notEqual(r.exit_code, 0);
  assert.ok(r.stderr.toLowerCase().includes('invalid window'));
});

// ---------------------------------------------------------------------------
// config get error surfacing
// ---------------------------------------------------------------------------

test('config get prints the underlying error on miss', async () => {
  fresh();
  await runCli(initArgv('p-c'));
  const r = await runCli(['config', 'get', 'does.not.exist']);
  assert.equal(r.exit_code, 1);
  assert.ok(r.stderr.includes('config get does.not.exist'));
  assert.ok(r.stderr.toLowerCase().includes('keyerror'));
});

// ---------------------------------------------------------------------------
// splitFrontmatter — body can contain a '---' horizontal rule
// ---------------------------------------------------------------------------

test('append-entry preserves --- inside the markdown body', async () => {
  const t = fresh();
  await runCli(initArgv('p-md'));
  const body = '## Intro\n\nFirst section.\n\n---\n\nSecond section after a horizontal rule.\n';
  const md = `---\n${JSON.stringify({ kind: 'note', summary: 'hr in body' })}\n---\n\n${body}`;
  const r = await runCli(['append-entry', '--stdin'], { input: md });
  assert.equal(r.exit_code, 0, r.output);
  // Read back via query --include-body and confirm the body still has the hr.
  const q = await runCli(['query', '--window', 'today', '--include-body', '--format', 'json']);
  assert.equal(q.exit_code, 0, q.output);
  const rows = JSON.parse(q.stdout) as Array<{ narrative?: string }>;
  assert.equal(rows.length, 1);
  const narrative = rows[0]?.narrative ?? '';
  assert.ok(narrative.includes('Second section after a horizontal rule'), `body truncated: ${JSON.stringify(narrative)}`);
  assert.ok(narrative.includes('---'), 'horizontal rule should be preserved');
  void t;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkMd(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMd(full));
    else if (ent.name.endsWith('.md')) out.push(full);
  }
  return out;
}
