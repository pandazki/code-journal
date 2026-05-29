/**
 * Schema round-trip + invariant tests.
 *
 * The hard rules from the MVP-II plan are encoded here as test cases:
 *   - parse(serialize(x)) === x for every type
 *   - unknown keys round-trip through _extra
 *   - computeEventId is stable across same inputs, differs when lens_version differs
 *   - newProjectState gives sane defaults (compose_threshold=10, model=sonnet, NOT haiku)
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type ObservationEvent,
  type FateUpdate,
  type SourceRef,
  type AuditEpisode,
  type ProjectState,
  type Measurements,
  computeEventId,
  newProjectState,
  parseFateUpdate,
  parseObservationEvent,
  parseAuditEpisode,
  parseProjectState,
  parseSourceRef,
  parseMeasurements,
  serializeFateUpdate,
  serializeObservationEvent,
  serializeAuditEpisode,
  serializeProjectState,
  serializeSourceRef,
  serializeMeasurements,
  isLensId,
  isAgentId,
  isFateType,
  LENS_IDS,
} from '../src/lib/schema';

describe('LensId / AgentId / FateType guards', () => {
  it('accepts valid identifiers', () => {
    assert.ok(isLensId('strict-negative-space'));
    assert.ok(isLensId('anchored-deferral'));
    assert.ok(isAgentId('claude-code'));
    assert.ok(isAgentId('codex'));
    assert.ok(isAgentId('cowork'));
    assert.ok(isFateType('reverted'));
    assert.ok(isFateType('maintained'));
  });
  it('rejects unknowns', () => {
    assert.equal(isLensId('made-up-lens'), false);
    assert.equal(isAgentId('cursor'), false);
    assert.equal(isFateType('promoted'), false);
  });
  it('LENS_IDS lists both lenses', () => {
    assert.deepEqual([...LENS_IDS].sort(), ['anchored-deferral', 'strict-negative-space']);
  });
});

describe('SourceRef round-trip', () => {
  const cases: SourceRef[] = [
    { type: 'turn', id: 42, session_id: 'sess-1' },
    { type: 'turn-range', from: 25, to: 52, session_id: 'sess-1' },
    { type: 'commit', sha: 'a1b2c3d' },
    { type: 'file', path: 'src/x.ts' },
  ];
  for (const ref of cases) {
    it(`round-trips ${ref.type}`, () => {
      const serialized = serializeSourceRef(ref);
      const parsed = parseSourceRef(serialized);
      assert.deepEqual(parsed, ref);
    });
  }
});

describe('FateUpdate round-trip', () => {
  it('preserves all fields', () => {
    const f: FateUpdate = {
      type: 'reverted',
      detected_at: '2026-05-28T10:00:00Z',
      detected_in_episode: 2,
      evidence_ref: { type: 'commit', sha: 'deadbeef' },
      user_note: 'we changed our minds',
      _extra: {},
    };
    const round = parseFateUpdate(serializeFateUpdate(f));
    assert.deepEqual(round, f);
  });
  it('omits optional user_note when absent', () => {
    const f: FateUpdate = {
      type: 'maintained',
      detected_at: '2026-05-28T11:00:00Z',
      detected_in_episode: 3,
      evidence_ref: { type: 'turn', id: 100, session_id: 's' },
      _extra: {},
    };
    const serialized = serializeFateUpdate(f);
    assert.equal('user_note' in serialized, false);
    const round = parseFateUpdate(serialized);
    assert.equal(round.user_note, undefined);
  });
  it('rejects unknown fate type', () => {
    assert.throws(() =>
      parseFateUpdate({
        type: 'promoted',
        detected_at: '',
        detected_in_episode: 0,
        evidence_ref: { type: 'turn', id: 1, session_id: 's' },
      }),
    );
  });
  it('passes unknown keys through _extra', () => {
    const f = parseFateUpdate({
      type: 'expanded',
      detected_at: '2026-05-28T12:00:00Z',
      detected_in_episode: 4,
      evidence_ref: { type: 'turn', id: 7, session_id: 's' },
      future_field: 'value',
    });
    assert.equal(f._extra.future_field, 'value');
    const round = parseFateUpdate(serializeFateUpdate(f));
    assert.equal(round._extra.future_field, 'value');
  });
});

describe('ObservationEvent round-trip', () => {
  it('preserves all fields', () => {
    const e: ObservationEvent = {
      id: 'ev_abc123',
      lens_id: 'strict-negative-space',
      lens_version: 'v2.1',
      project_id: 'proj-x',
      session_id: 'sess-y',
      turn_anchor: 'T42-T58',
      primary_turn: 42,
      timespan: { start: '2026-05-28T09:00:00Z', end: '2026-05-28T09:15:00Z' },
      source_refs: [
        { type: 'turn', id: 42, session_id: 'sess-y' },
        { type: 'turn-range', from: 43, to: 58, session_id: 'sess-y' },
      ],
      payload: '**Arc**: ...\n**Event**: ...',
      detected_at: '2026-05-28T10:00:00Z',
      agent: 'claude-code',
      fate: [],
      _extra: {},
    };
    const round = parseObservationEvent(serializeObservationEvent(e));
    assert.deepEqual(round, e);
  });
  it('extracts primary_turn from turn_anchor when omitted', () => {
    const e = parseObservationEvent({
      id: 'ev_x',
      lens_id: 'strict-negative-space',
      project_id: 'p',
      session_id: 's',
      turn_anchor: 'T108-T116',
      payload: 'x',
    });
    assert.equal(e.primary_turn, 108);
  });
  it('defaults agent to claude-code if not provided', () => {
    const e = parseObservationEvent({
      id: 'ev_x',
      lens_id: 'anchored-deferral',
      project_id: 'p',
      session_id: 's',
      turn_anchor: 'T7',
      payload: 'x',
    });
    assert.equal(e.agent, 'claude-code');
  });
  it('fails loud on missing required fields', () => {
    assert.throws(() => parseObservationEvent({ id: 'ev_x' }));
  });
});

describe('computeEventId stability', () => {
  it('produces the same id for same inputs', () => {
    const parts = {
      project_id: 'p',
      session_id: 's',
      lens_id: 'strict-negative-space' as const,
      turn_anchor: 'T42',
      lens_version: 'v2.1',
    };
    assert.equal(computeEventId(parts), computeEventId(parts));
  });
  it('produces different ids when lens_version differs', () => {
    const a = computeEventId({
      project_id: 'p',
      session_id: 's',
      lens_id: 'strict-negative-space',
      turn_anchor: 'T42',
      lens_version: 'v2.1',
    });
    const b = computeEventId({
      project_id: 'p',
      session_id: 's',
      lens_id: 'strict-negative-space',
      turn_anchor: 'T42',
      lens_version: 'v2.2',
    });
    assert.notEqual(a, b);
  });
  it('produces different ids when turn_anchor differs', () => {
    const a = computeEventId({
      project_id: 'p',
      session_id: 's',
      lens_id: 'anchored-deferral',
      turn_anchor: 'T42',
      lens_version: 'v2.1',
    });
    const b = computeEventId({
      project_id: 'p',
      session_id: 's',
      lens_id: 'anchored-deferral',
      turn_anchor: 'T43',
      lens_version: 'v2.1',
    });
    assert.notEqual(a, b);
  });
  it('starts with the `ev_` prefix', () => {
    const id = computeEventId({
      project_id: 'p',
      session_id: 's',
      lens_id: 'strict-negative-space',
      turn_anchor: 'T1',
      lens_version: 'v2.1',
    });
    assert.ok(id.startsWith('ev_'));
  });
});

describe('Measurements round-trip', () => {
  it('preserves all fields including M6 quintiles', () => {
    const m: Measurements = {
      m1_anchor_density_per_100t: 3.81,
      m2_latency_seconds: { n: 8, min: 10.7, median: 60, max: 246 },
      m3_pivot_magnitudes: [
        { turn: 32, artifact_count: 3 },
        { turn: 85, artifact_count: 2 },
      ],
      m5_convergence: { convergent: 2, total_strict: 2 },
      m6_anchor_positions: {
        quintile_distribution: [13, 0, 5, 2, 7],
        bimodality_score: 0.74,
      },
      _extra: {},
    };
    const round = parseMeasurements(serializeMeasurements(m));
    assert.deepEqual(round, m);
  });
  it('defaults quintile_distribution to 5 zeros if missing', () => {
    const m = parseMeasurements({ m1_anchor_density_per_100t: 0 });
    assert.deepEqual(m.m6_anchor_positions.quintile_distribution, [0, 0, 0, 0, 0]);
  });
});

describe('AuditEpisode round-trip', () => {
  it('preserves all fields', () => {
    const e: AuditEpisode = {
      episode: 1,
      project_id: 'proj-x',
      composed_at: '2026-05-28T15:00:00Z',
      window: { start: '2026-05-20', end: '2026-05-27' },
      source_signals: [
        {
          lens_id: 'strict-negative-space',
          lens_version: 'v2.1',
          event_ids: ['ev_1', 'ev_2'],
          _extra: {},
        },
      ],
      fate_updates_surfaced: [],
      measurements: {
        m1_anchor_density_per_100t: 1.0,
        m2_latency_seconds: { n: 0, min: null, median: null, max: null },
        m3_pivot_magnitudes: [],
        m5_convergence: { convergent: 0, total_strict: 0 },
        m6_anchor_positions: { quintile_distribution: [0, 0, 0, 0, 0], bimodality_score: 0 },
        _extra: {},
      },
      trigger: {
        cron_at: '2026-05-28T14:30:00Z',
        new_events_since_last: 12,
        threshold: 10,
        _extra: {},
      },
      audit_path: 'episodes/1-2026-05-28.md',
      _extra: {},
    };
    const round = parseAuditEpisode(serializeAuditEpisode(e));
    assert.deepEqual(round, e);
  });
});

describe('ProjectState defaults', () => {
  it('newProjectState defaults are sane', () => {
    const s = newProjectState('proj-x', 'Project X');
    assert.equal(s.project_id, 'proj-x');
    assert.equal(s.display_name, 'Project X');
    assert.equal(s.next_episode_number, 1);
    assert.equal(s.new_events_since_last_compose, 0);
    assert.equal(s.config.compose_threshold, 10);
    assert.equal(s.config.model, 'sonnet', 'haiku must NOT be the default (E1 finding)');
    assert.equal(s.config.lens_versions['strict-negative-space'], 'v2.1');
    assert.equal(s.config.lens_versions['anchored-deferral'], 'v3.0');
    assert.deepEqual(s.episodes, []);
    assert.deepEqual(s.agent_seen, []);
  });
  it('round-trips through serialize/parse', () => {
    const s = newProjectState('proj-y', 'Project Y');
    s.agent_seen = ['claude-code', 'codex'];
    s.last_scan = {
      at: '2026-05-28T10:00:00Z',
      sessions_scanned: ['sess-1', 'sess-2'],
      _extra: {},
    };
    s.episodes = [{ episode: 1, composed_at: '2026-05-28T11:00:00Z', event_count: 5, _extra: {} }];
    s.next_episode_number = 2;
    s.new_events_since_last_compose = 3;
    const round = parseProjectState(serializeProjectState(s));
    assert.deepEqual(round, s);
  });
  it('rejects haiku via the model union type (parser coerces unknowns to sonnet)', () => {
    const s = parseProjectState({
      project_id: 'p',
      config: { model: 'haiku' as unknown as string },
    });
    assert.equal(s.config.model, 'sonnet', 'parser must coerce non-sonnet/opus to sonnet');
  });
});
