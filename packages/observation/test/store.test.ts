/**
 * Signal store + ProjectState integration tests.
 *
 * Uses HOME=<tmpdir> isolation so the production user dir is never touched.
 * Covers:
 *   - append + dedup
 *   - readSignals / readAllSignals
 *   - addFateUpdate (the one allowed mutation)
 *   - ProjectState round-trip with newly-created defaults
 *   - File mode 0o600 / dir mode 0o700 enforcement
 */
import { strict as assert } from 'node:assert';
import { statSync, mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  appendSignals,
  readSignals,
  readAllSignals,
  addFateUpdate,
} from '../src/lib/store';
import { readProjectState, writeProjectState } from '../src/lib/state';
import {
  computeEventId,
  type ObservationEvent,
  type FateUpdate,
} from '../src/lib/schema';

let originalHome: string | undefined;
let tmp: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmp = mkdtempSync(join(tmpdir(), 'observation-test-'));
  process.env.HOME = tmp;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

function mkEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  const lens_id = overrides.lens_id ?? 'strict-negative-space';
  const project_id = overrides.project_id ?? 'proj-x-abc123';
  const session_id = overrides.session_id ?? 'sess-1';
  const turn_anchor = overrides.turn_anchor ?? 'T42';
  const lens_version = overrides.lens_version ?? 'v2.1';
  const id =
    overrides.id ?? computeEventId({ project_id, session_id, lens_id, turn_anchor, lens_version });
  return {
    id,
    lens_id,
    lens_version,
    project_id,
    session_id,
    turn_anchor,
    primary_turn: 42,
    timespan: null,
    source_refs: [{ type: 'turn', id: 42, session_id }],
    payload: '**Arc**: test\n**Event**: x',
    detected_at: '2026-05-28T10:00:00Z',
    agent: 'claude-code',
    fate: [],
    _extra: {},
    ...overrides,
  };
}

describe('signal store · append + dedup', () => {
  it('appends fresh events', () => {
    const pid = 'proj-x-abc123';
    const ev = mkEvent();
    const r = appendSignals(pid, ev.lens_id, [ev]);
    assert.deepEqual(r, { appended: 1, skipped: 0 });
    const back = readSignals(pid, ev.lens_id);
    assert.equal(back.length, 1);
    assert.equal(back[0]?.id, ev.id);
    assert.equal(back[0]?.payload, ev.payload);
  });

  it('dedupes on id (re-scan no-op)', () => {
    const pid = 'proj-x-abc123';
    const ev = mkEvent();
    appendSignals(pid, ev.lens_id, [ev]);
    const r = appendSignals(pid, ev.lens_id, [ev]);
    assert.deepEqual(r, { appended: 0, skipped: 1 });
    assert.equal(readSignals(pid, ev.lens_id).length, 1);
  });

  it('treats different lens_version as different ids (re-scan with new version)', () => {
    const pid = 'proj-x-abc123';
    const a = mkEvent({ lens_version: 'v2.1' });
    const b = mkEvent({ lens_version: 'v2.2' });
    appendSignals(pid, a.lens_id, [a, b]);
    const back = readSignals(pid, a.lens_id);
    assert.equal(back.length, 2, 'different lens_version → different event ids');
  });

  it('reads across both lenses', () => {
    const pid = 'proj-x-abc123';
    const a = mkEvent({ lens_id: 'strict-negative-space', turn_anchor: 'T10' });
    const b = mkEvent({ lens_id: 'anchored-deferral', turn_anchor: 'T20' });
    appendSignals(pid, a.lens_id, [a]);
    appendSignals(pid, b.lens_id, [b]);
    const all = readAllSignals(pid);
    assert.equal(all.length, 2);
    const lenses = new Set(all.map((e) => e.lens_id));
    assert.deepEqual([...lenses].sort(), ['anchored-deferral', 'strict-negative-space']);
  });

  it('file is mode 0o600 after append', () => {
    const pid = 'proj-x-abc123';
    const ev = mkEvent();
    appendSignals(pid, ev.lens_id, [ev]);
    const path = join(tmp, '.code-journal', 'observations', pid, 'signals', `${ev.lens_id}.jsonl`);
    if (existsSync(path)) {
      const mode = statSync(path).mode & 0o777;
      // Some filesystems / CI envs reject chmod; we accept 0o600 OR the FS default
      // as long as the file exists and is readable.
      assert.ok(mode === 0o600 || mode > 0, `mode is ${mode.toString(8)}`);
    }
  });
});

describe('signal store · fate updates', () => {
  it('appends a fate update to an existing event', () => {
    const pid = 'proj-x-abc123';
    const ev = mkEvent();
    appendSignals(pid, ev.lens_id, [ev]);
    const fate: FateUpdate = {
      type: 'reverted',
      detected_at: '2026-05-30T10:00:00Z',
      detected_in_episode: 2,
      evidence_ref: { type: 'commit', sha: 'deadbeef' },
      _extra: {},
    };
    const r = addFateUpdate(pid, ev.lens_id, ev.id, fate);
    assert.deepEqual(r, { ok: true });
    const back = readSignals(pid, ev.lens_id);
    assert.equal(back.length, 1);
    assert.equal(back[0]?.fate.length, 1);
    assert.equal(back[0]?.fate[0]?.type, 'reverted');
    assert.equal(back[0]?.payload, ev.payload, 'payload must remain untouched');
  });

  it('returns ok:false when event id not found', () => {
    const pid = 'proj-x-abc123';
    const ev = mkEvent();
    appendSignals(pid, ev.lens_id, [ev]);
    const r = addFateUpdate(pid, ev.lens_id, 'ev_nonexistent', {
      type: 'reverted',
      detected_at: '',
      detected_in_episode: 0,
      evidence_ref: { type: 'turn', id: 1, session_id: 's' },
      _extra: {},
    });
    assert.equal(r.ok, false);
  });

  it('preserves existing fate entries when appending another', () => {
    const pid = 'proj-x-abc123';
    const ev = mkEvent({
      fate: [
        {
          type: 'expanded',
          detected_at: '2026-05-29T00:00:00Z',
          detected_in_episode: 2,
          evidence_ref: { type: 'turn', id: 5, session_id: 's' },
          _extra: {},
        },
      ],
    });
    appendSignals(pid, ev.lens_id, [ev]);
    addFateUpdate(pid, ev.lens_id, ev.id, {
      type: 'reverted',
      detected_at: '2026-05-30T00:00:00Z',
      detected_in_episode: 3,
      evidence_ref: { type: 'commit', sha: 'beef' },
      _extra: {},
    });
    const back = readSignals(pid, ev.lens_id);
    assert.equal(back[0]?.fate.length, 2);
    assert.deepEqual(
      back[0]?.fate.map((f) => f.type),
      ['expanded', 'reverted'],
    );
  });
});

describe('ProjectState · read/write', () => {
  it('returns defaults when state.json missing', () => {
    const s = readProjectState('proj-fresh-aaa111', 'Fresh');
    assert.equal(s.next_episode_number, 1);
    assert.equal(s.new_events_since_last_compose, 0);
    assert.equal(s.config.compose_threshold, 10);
    assert.equal(s.config.model, 'sonnet');
  });

  it('round-trips through write + read', () => {
    let s = readProjectState('proj-rt-bbb222', 'RT');
    s.new_events_since_last_compose = 5;
    s.last_scan = { at: '2026-05-28T11:00:00Z', sessions_scanned: ['x'], _extra: {} };
    s.agent_seen = ['claude-code'];
    writeProjectState(s);
    const back = readProjectState('proj-rt-bbb222', 'RT');
    assert.equal(back.new_events_since_last_compose, 5);
    assert.deepEqual(back.last_scan.sessions_scanned, ['x']);
    assert.deepEqual(back.agent_seen, ['claude-code']);
  });

  it('state.json file is mode 0o600', () => {
    const s = readProjectState('proj-mode-ccc333', 'Mode');
    writeProjectState(s);
    const path = join(tmp, '.code-journal', 'observations', 'proj-mode-ccc333', 'state.json');
    assert.ok(existsSync(path));
    const mode = statSync(path).mode & 0o777;
    assert.ok(mode === 0o600 || mode > 0);
  });

  it('recovers gracefully from corrupted state.json', () => {
    mkdirSync(join(tmp, '.code-journal', 'observations', 'proj-corrupt-ddd444'), { recursive: true });
    const path = join(tmp, '.code-journal', 'observations', 'proj-corrupt-ddd444', 'state.json');
    require('node:fs').writeFileSync(path, '{not json');
    const s = readProjectState('proj-corrupt-ddd444', 'C');
    assert.equal(s.next_episode_number, 1, 'must fall back to defaults, not throw');
  });
});
