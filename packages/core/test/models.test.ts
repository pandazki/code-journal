/**
 * Unit tests for models — port of tests/test_models.py.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEntryRefs,
  parseProject,
  parseReportMeta,
  serializeEntryRefs,
  serializeProject,
  serializeReportMeta,
} from '../src/models';
import { DEFAULT_CATCHUP_LOOKBACK_DAYS } from '../src/defaults';

test('project round-trip with extensions', () => {
  const p = parseProject({
    project_id: 'proj-a',
    display_name: 'Project A',
    schema: {
      custom_kinds: ['customer_meeting'],
      custom_fields: [{ name: 'customer', type: 'string' }],
    },
    report: {
      // 21 is deliberately non-default — this round-trip test verifies that
      // an explicit value survives parse/serialize unchanged. Don't read
      // this literal as "the default"; defaults live in defaults.ts.
      catchup_lookback_days: 21,
      language: 'zh-CN',
    },
    schedule: { mode: 'daily', time: '18:00' },
  });
  assert.equal(p.project_id, 'proj-a');
  assert.equal(p.report!.catchup_lookback_days, 21);
  assert.equal(p.report!.language, 'zh-CN');
  assert.equal(p.schedule.mode, 'daily');
  assert.equal(p.schedule.time, '18:00');
});

test('project_id required', () => {
  assert.throws(() => parseProject({ display_name: 'x' }), /project_id/);
});

test('project dump uses `schema` (alias) for JSON', () => {
  const p = parseProject({ project_id: 'p', schema: { custom_kinds: ['k1'] } });
  const dumped = serializeProject(p);
  assert.ok('schema' in dumped);
  assert.ok(!('schema_' in dumped));
  const s = dumped.schema as { custom_kinds: string[] };
  assert.deepEqual(s.custom_kinds, ['k1']);
});

test('ReportConfig defaults: language en, lookback DEFAULT', () => {
  const p = parseProject({ project_id: 'x', report: {} });
  assert.equal(p.report!.language, 'en');
  assert.equal(p.report!.catchup_lookback_days, DEFAULT_CATCHUP_LOOKBACK_DAYS);
});

test('ReportConfig language round-trip', () => {
  const p = parseProject({
    project_id: 'x',
    report: { language: 'zh-CN' },
  });
  assert.equal(p.report!.language, 'zh-CN');
  const dumped = serializeProject(p);
  const r = dumped.report as { language: string };
  assert.equal(r.language, 'zh-CN');
});

test('timezone round-trips and defaults to empty (= host) when absent', () => {
  const pinned = parseProject({ project_id: 'x', timezone: 'Asia/Shanghai' });
  assert.equal(pinned.timezone, 'Asia/Shanghai');
  assert.equal((serializeProject(pinned) as { timezone?: string }).timezone, 'Asia/Shanghai');

  // Absent → empty string (the "use host zone" sentinel), and an empty zone
  // is omitted from the serialized config to avoid churn.
  const bare = parseProject({ project_id: 'x' });
  assert.equal(bare.timezone, '');
  assert.ok(!('timezone' in serializeProject(bare)));
});

test('project without report block auto-upgrades to default ReportConfig (legacy --no-daily-reports)', () => {
  const p = parseProject({ project_id: 'x' });
  assert.equal(p.report.catchup_lookback_days, DEFAULT_CATCHUP_LOOKBACK_DAYS);
  assert.equal(p.report.language, 'en');
  const dumped = serializeProject(p);
  assert.ok('report' in dumped);
});

test('project with explicit report: null also auto-upgrades to default ReportConfig', () => {
  // Legacy projects init'd with --no-daily-reports persisted `report: null`.
  // Parser tolerates that input shape, treating it as "use defaults".
  const p = parseProject({ project_id: 'x', report: null });
  assert.equal(p.report.catchup_lookback_days, DEFAULT_CATCHUP_LOOKBACK_DAYS);
  assert.equal(p.report.language, 'en');
});

test('project extra keys round-trip', () => {
  const p = parseProject({
    project_id: 'p',
    future_field: { alpha: 1, beta: [2, 3] },
  });
  const dumped = serializeProject(p);
  assert.deepEqual(dumped.future_field, { alpha: 1, beta: [2, 3] });
});

test('EntryRefs extra keys round-trip', () => {
  const refs = parseEntryRefs({
    spec: 'S-1',
    task: 'T-1',
    future_link: 'https://example.com/x',
  });
  assert.equal(refs.task, 'T-1');
  assert.deepEqual(refs._extra, { future_link: 'https://example.com/x' });
  const out = serializeEntryRefs(refs);
  assert.equal(out.future_link, 'https://example.com/x');
});

test('ReportMeta language round-trip', () => {
  const rm = parseReportMeta({
    window: '2026-05-09',
    format: 'daily',
    created_at: '2026-05-09T00:00:00+00:00',
    source_entry_ids: ['e_x'],
    language: 'zh-CN',
  });
  assert.equal(rm.language, 'zh-CN');
  const d = serializeReportMeta(rm);
  assert.equal(d.language, 'zh-CN');
});

test('ReportMeta language omitted when unset', () => {
  const rm = parseReportMeta({
    window: '2026-05-09',
    format: 'daily',
    created_at: '2026-05-09T00:00:00+00:00',
  });
  assert.equal(rm.language, null);
  const d = serializeReportMeta(rm);
  assert.ok(!('language' in d));
});
