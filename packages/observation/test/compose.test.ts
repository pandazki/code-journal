/**
 * Compose tests — integration of store + state + compose, using HOME isolation.
 *
 * Covers:
 *   - First episode composes from a small synthetic event set
 *   - Measurements computed correctly (M1/M2/M3/M5/M6)
 *   - Audit markdown contains all required sections
 *   - Forbidden phrases trigger composition failure
 *   - ProjectState updates after compose (episode++, counter reset)
 *   - Cross-lens convergence marker rendered when applicable
 *   - Empty stance categories show as zero rather than being omitted
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { composeAudit, parseTurnMapFromDigest, computeMeasurements } from '../src/lib/compose';
import { appendSignals } from '../src/lib/store';
import { readProjectState, writeProjectState } from '../src/lib/state';
import {
  computeEventId,
  type ObservationEvent,
} from '../src/lib/schema';
import { digestFilePath } from '../src/lib/paths';

let originalHome: string | undefined;
let tmp: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmp = mkdtempSync(join(tmpdir(), 'compose-test-'));
  process.env.HOME = tmp;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

const PID = 'proj-c-test99';
const SID = 'sess-compose-1';

function syntheticDigest(turns: Array<{ id: number; role: 'user' | 'assistant'; ts: string }>): string {
  const out: string[] = [`# Transcript digest — Project C-test · session ${SID.slice(0, 8)}`];
  out.push('');
  out.push(`- Total turns in digest: ${turns.length}`);
  out.push('');
  out.push('---');
  out.push('');
  for (const t of turns) {
    out.push(`**T${t.id} · ${t.role} (text) · @${t.ts}**`);
    out.push('');
    out.push(`turn ${t.id} content`);
    out.push('');
  }
  return out.join('\n');
}

function mkEvent(overrides: Partial<ObservationEvent>): ObservationEvent {
  const lens_id = overrides.lens_id ?? 'strict-negative-space';
  const turn_anchor = overrides.turn_anchor ?? 'T10';
  const lens_version = overrides.lens_version ?? 'v2.1';
  const project_id = overrides.project_id ?? PID;
  const session_id = overrides.session_id ?? SID;
  const id =
    overrides.id ??
    computeEventId({ project_id, session_id, lens_id, turn_anchor, lens_version });
  return {
    id,
    lens_id,
    lens_version,
    project_id,
    session_id,
    turn_anchor,
    primary_turn: Number((turn_anchor.match(/T(\d+)/) ?? [])[1] ?? 0),
    timespan: null,
    source_refs: [{ type: 'turn', id: 10, session_id }],
    payload: '**Arc**: test\n**Event**: x',
    detected_at: '2026-05-28T10:00:00Z',
    agent: 'claude-code',
    fate: [],
    _extra: {},
    ...overrides,
  };
}

function seedDigest(turns: Array<{ id: number; role: 'user' | 'assistant'; ts: string }>): void {
  const path = digestFilePath(PID, SID);
  mkdirSync(join(tmp, '.code-journal', 'observations', PID, 'digests'), { recursive: true });
  writeFileSync(path, syntheticDigest(turns));
}

describe('parseTurnMapFromDigest', () => {
  it('extracts turn ids and timestamps', () => {
    const digest =
      '**T1 · user (text) · @2026-05-28T10:00:00Z**\n\nhello\n\n' +
      '**T2 · assistant (text) · @2026-05-28T10:01:00Z**\n\nhi\n';
    const tm = parseTurnMapFromDigest(digest);
    assert.equal(tm.totalTurns, 2);
    assert.equal(tm.byId.get(1)?.role, 'user');
    assert.equal(tm.byId.get(2)?.role, 'assistant');
    assert.ok(tm.byId.get(1)?.ts != null);
  });

  it('handles digests without timestamps', () => {
    const digest = '**T1 · user (text)**\n\nx\n';
    const tm = parseTurnMapFromDigest(digest);
    assert.equal(tm.totalTurns, 1);
    assert.equal(tm.byId.get(1)?.ts, null);
  });
});

describe('computeMeasurements', () => {
  it('M1 anchor density', () => {
    const tm = parseTurnMapFromDigest(
      syntheticDigest([
        { id: 1, role: 'user', ts: '2026-05-28T10:00:00Z' },
        { id: 2, role: 'assistant', ts: '2026-05-28T10:01:00Z' },
        { id: 3, role: 'user', ts: '2026-05-28T10:02:00Z' },
        { id: 4, role: 'assistant', ts: '2026-05-28T10:03:00Z' },
      ]),
    );
    const turnMaps = new Map([[SID, tm]]);
    const deferral = [mkEvent({ lens_id: 'anchored-deferral', turn_anchor: 'T2' })];
    const m = computeMeasurements([], deferral, turnMaps);
    assert.equal(m.m1_anchor_density_per_100t, 25); // 1 anchor / 4 turns × 100
  });

  it('M5 lens convergence', () => {
    const tm = parseTurnMapFromDigest(
      syntheticDigest([
        { id: 10, role: 'assistant', ts: '2026-05-28T10:00:00Z' },
        { id: 11, role: 'user', ts: '2026-05-28T10:01:00Z' },
        { id: 20, role: 'assistant', ts: '2026-05-28T10:02:00Z' },
      ]),
    );
    const turnMaps = new Map([[SID, tm]]);
    const strict = [
      mkEvent({ lens_id: 'strict-negative-space', turn_anchor: 'T10' }),
      mkEvent({ lens_id: 'strict-negative-space', turn_anchor: 'T20' }),
    ];
    const deferral = [
      mkEvent({ lens_id: 'anchored-deferral', turn_anchor: 'T10' }), // converges with strict E1
    ];
    const m = computeMeasurements(strict, deferral, turnMaps);
    assert.equal(m.m5_convergence.convergent, 1);
    assert.equal(m.m5_convergence.total_strict, 2);
  });

  it('M6 anchor position quintile distribution + bimodality', () => {
    // 10-turn session; anchors at T1 (first 20%), T2 (first 20%), T9 (last 20%)
    const turns = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      role: 'assistant' as const,
      ts: '2026-05-28T10:00:00Z',
    }));
    const tm = parseTurnMapFromDigest(syntheticDigest(turns));
    const turnMaps = new Map([[SID, tm]]);
    const deferral = [
      mkEvent({ lens_id: 'anchored-deferral', turn_anchor: 'T1' }),
      mkEvent({ lens_id: 'anchored-deferral', turn_anchor: 'T2' }),
      mkEvent({ lens_id: 'anchored-deferral', turn_anchor: 'T9' }),
    ];
    const m = computeMeasurements([], deferral, turnMaps);
    // T1/10 = 0.1, T2/10 = 0.2 → buckets [0,1,...]
    // T9/10 = 0.9 → bucket 4
    assert.equal(m.m6_anchor_positions.quintile_distribution[0], 1);
    assert.equal(m.m6_anchor_positions.quintile_distribution[1], 1);
    assert.equal(m.m6_anchor_positions.quintile_distribution[4], 1);
    assert.ok(m.m6_anchor_positions.bimodality_score > 0);
  });
});

describe('compose · end-to-end with synthetic events', () => {
  it('first episode composes and updates state', () => {
    seedDigest([
      { id: 10, role: 'assistant', ts: '2026-05-28T10:00:00Z' },
      { id: 11, role: 'user', ts: '2026-05-28T10:01:30Z' },
    ]);
    const state = readProjectState(PID, 'Test Project');
    writeProjectState(state);
    const strict = mkEvent({ lens_id: 'strict-negative-space', turn_anchor: 'T10' });
    const deferral = mkEvent({
      lens_id: 'anchored-deferral',
      turn_anchor: 'T10',
      payload:
        '**Anchor (AI salience event)**: direct-ask\n\n**Anchor verbatim**: x\n\n**User response verbatim**: y\n\n**Stance**: engaged\n\n**Why this stance**: z',
    });
    appendSignals(PID, strict.lens_id, [strict]);
    appendSignals(PID, deferral.lens_id, [deferral]);

    const result = composeAudit({ state });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.episode.episode, 1);
    assert.ok(result.markdown.includes('# Audit · Test Project · Episode 1'));
    assert.ok(result.markdown.includes('## Scope'));
    assert.ok(result.markdown.includes('## Method'));
    assert.ok(result.markdown.includes('## Measurements'));
    assert.ok(result.markdown.includes('## Anchor distribution'));
    assert.ok(result.markdown.includes('## Stance distribution'));
    assert.ok(result.markdown.includes('assented'), 'stance table includes the assented row');
    assert.ok(/\*\*Shape\*\*: \(e=\d+, a=\d+, d=\d+, o=\d+, i=\d+\)/.test(result.markdown), '5-tuple shape');
    assert.ok(result.markdown.includes('## Findings — Strict negative-space'));
    assert.ok(result.markdown.includes('## Findings — Anchored deferral'));
    assert.ok(result.markdown.includes('## Fate updates'));
    assert.ok(result.markdown.includes('## Limitations'));
    assert.ok(result.markdown.includes('## Source index'));
    // Cross-lens marker should be present (both events at T10)
    assert.ok(result.markdown.includes('↔ deferral anchor at same turn'));
    assert.ok(result.markdown.includes('↔ strict event at same turn'));

    // State advanced
    const back = readProjectState(PID, 'Test Project');
    assert.equal(back.next_episode_number, 2);
    assert.equal(back.new_events_since_last_compose, 0);
    assert.equal(back.episodes.length, 1);
    assert.equal(back.episodes[0]?.event_count, 2);
  });

  it('refuses to compose when signal store is empty', () => {
    const state = readProjectState(PID, 'Empty');
    const result = composeAudit({ state });
    assert.equal(result.ok, false);
  });

  it('dry-run produces markdown without persisting', () => {
    seedDigest([{ id: 10, role: 'assistant', ts: '2026-05-28T10:00:00Z' }]);
    const state = readProjectState(PID, 'Dry');
    const e = mkEvent({});
    appendSignals(PID, e.lens_id, [e]);
    const result = composeAudit({ state, dryRun: true });
    assert.equal(result.ok, true);
    const back = readProjectState(PID, 'Dry');
    assert.equal(back.next_episode_number, 1, 'state must not advance under dry-run');
    assert.equal(back.episodes.length, 0);
  });

  it('renders empty-state for strict findings when only deferral events exist', () => {
    seedDigest([
      { id: 5, role: 'assistant', ts: '2026-05-28T10:00:00Z' },
      { id: 6, role: 'user', ts: '2026-05-28T10:00:30Z' },
    ]);
    const state = readProjectState(PID, 'Half');
    const deferral = mkEvent({
      lens_id: 'anchored-deferral',
      turn_anchor: 'T5',
      payload:
        '**Anchor (AI salience event)**: direct-ask\n**Stance**: ignored\n**Redirected to**: nothing\n**Why**: x',
    });
    appendSignals(PID, deferral.lens_id, [deferral]);
    const result = composeAudit({ state });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(
      result.markdown.includes(
        '**EMPTY-STATE**: no strict-negative-space events surfaced in this episode.',
      ),
    );
  });

  it('blocks forbidden phrases (§ 11.4 red line)', () => {
    seedDigest([{ id: 10, role: 'assistant', ts: '2026-05-28T10:00:00Z' }]);
    const state = readProjectState(PID, 'Forbidden');
    const ev = mkEvent({
      lens_id: 'strict-negative-space',
      turn_anchor: 'T10',
      payload: 'something that says the user is an architect-type developer',
    });
    appendSignals(PID, ev.lens_id, [ev]);
    const result = composeAudit({ state });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes('forbidden phrase'));
    }
  });

  it('episodes are disjoint — Episode 2 covers only events Episode 1 did not', () => {
    seedDigest([
      { id: 10, role: 'assistant', ts: '2026-05-28T10:00:00Z' },
      { id: 20, role: 'assistant', ts: '2026-05-28T10:05:00Z' },
    ]);
    let state = readProjectState(PID, 'Sequence');
    const ev1 = mkEvent({ turn_anchor: 'T10' });
    appendSignals(PID, ev1.lens_id, [ev1]);
    const r1 = composeAudit({ state });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const ep1Ids = r1.episode.source_signals.flatMap((s) => s.event_ids);
    assert.deepEqual(ep1Ids, [ev1.id], 'Episode 1 covers ev1');

    // Sync appends a second event into the same append-only store.
    state = readProjectState(PID, 'Sequence');
    const ev2 = mkEvent({ turn_anchor: 'T20' });
    appendSignals(PID, ev2.lens_id, [ev2]);
    const r2 = composeAudit({ state });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;

    // The core of the fix: Episode 2's source_signals is the NEW slice only —
    // ev2 present, ev1 (already composed by Episode 1) excluded. Before the
    // fix, compose re-pulled the whole store and ep2 would have cited both.
    const ep2Ids = r2.episode.source_signals.flatMap((s) => s.event_ids);
    assert.deepEqual(ep2Ids, [ev2.id], 'Episode 2 covers only the uncomposed event');
    assert.ok(!ep2Ids.includes(ev1.id), 'Episode 2 must not re-pull Episode 1 events');

    // Fate is genuinely empty now (disjoint), not empty-because-re-audited.
    assert.ok(r2.markdown.includes('(none surfaced'));
  });

  it('skips a recompose when no new events since last episode — even under --force', () => {
    seedDigest([{ id: 10, role: 'assistant', ts: '2026-05-28T10:00:00Z' }]);
    let state = readProjectState(PID, 'Dup');
    const ev = mkEvent({ turn_anchor: 'T10' });
    appendSignals(PID, ev.lens_id, [ev]);
    const r1 = composeAudit({ state });
    assert.equal(r1.ok, true);

    // Re-read state (one episode on record) and compose again with no new
    // events — must skip rather than emit a duplicate episode.
    state = readProjectState(PID, 'Dup');
    const r2 = composeAudit({ state });
    assert.equal(r2.ok, false);
    if (!r2.ok) {
      assert.equal(r2.skipped, true);
      assert.ok(r2.reason.includes('no new events'));
    }

    // Under the disjoint-episode model `force` no longer re-pulls a prior
    // episode's events, so it cannot fabricate a duplicate Episode 2 from an
    // empty new slice — it skips too.
    const r3 = composeAudit({ state, force: true });
    assert.equal(r3.ok, false, 'force does not re-pull already-composed events');
    assert.equal(
      readProjectState(PID, 'Dup').episodes.length,
      1,
      'no second episode written',
    );
  });

  it('rendered file path matches episode metadata audit_path', () => {
    seedDigest([{ id: 10, role: 'assistant', ts: '2026-05-28T10:00:00Z' }]);
    const state = readProjectState(PID, 'PathTest');
    const ev = mkEvent({ turn_anchor: 'T10' });
    appendSignals(PID, ev.lens_id, [ev]);
    const r = composeAudit({ state });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.paths.markdown.endsWith(r.episode.audit_path));
    const written = readFileSync(r.paths.markdown, 'utf8');
    assert.ok(written.length > 200);
  });
});
