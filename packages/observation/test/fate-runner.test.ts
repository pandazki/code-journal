/**
 * Fate runner tests.
 *
 *   - groundFateCandidates: the precision gate (pure) — keeps both-sides-grounded
 *     fates, drops bad target / bad type / maintained / uncited / too-thin / dupes.
 *   - detectAndApplyFates: end-to-end via the rawOverride seam (no model call) —
 *     appends a grounded fate onto its prior event, which compose then surfaces.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { groundFateCandidates, detectAndApplyFates, type RawFate } from '../src/lib/fate-runner';
import { composeAudit } from '../src/lib/compose';
import { appendSignals, readSignals } from '../src/lib/store';
import { readProjectState, writeProjectState } from '../src/lib/state';
import { computeEventId, type ObservationEvent } from '../src/lib/schema';
import { digestFilePath } from '../src/lib/paths';

let originalHome: string | undefined;
let tmp: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmp = mkdtempSync(join(tmpdir(), 'fate-test-'));
  process.env.HOME = tmp;
});
afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

const PID = 'proj-fate-test1';

function mkEvent(over: Partial<ObservationEvent>): ObservationEvent {
  const lens_id = over.lens_id ?? 'strict-negative-space';
  const turn_anchor = over.turn_anchor ?? 'T10';
  const lens_version = over.lens_version ?? 'v2.1';
  const session_id = over.session_id ?? 'sess-1';
  const id = over.id ?? computeEventId({ project_id: PID, session_id, lens_id, turn_anchor, lens_version });
  return {
    id, lens_id, lens_version, project_id: PID, session_id, turn_anchor,
    primary_turn: Number((turn_anchor.match(/T(\d+)/) ?? [])[1] ?? 0),
    timespan: null, source_refs: [{ type: 'turn', id: 10, session_id }],
    payload: '**Arc**: prior decision about X', detected_at: '2026-05-28T10:00:00Z',
    agent: 'claude-code', fate: [], _extra: {}, ...over,
  };
}

describe('groundFateCandidates · precision gate', () => {
  const prior = [mkEvent({ turn_anchor: 'T10' }), mkEvent({ turn_anchor: 'T20' })];
  const digest = 'later work: commit fix(x): persist the torn-off state across reload — done';
  const base: RawFate = {
    target_event_id: prior[0]!.id,
    type: 'expanded',
    evidence_ref: { type: 'commit', sha: 'abc1234' },
    evidence_quote: 'persist the torn-off state across reload',
    note: 'took up the deferred edge',
  };

  it('keeps a both-sides-grounded fate', () => {
    const out = groundFateCandidates([base], prior, digest, 2, '2026-06-22T00:00:00Z');
    assert.equal(out.length, 1);
    assert.equal(out[0]!.targetEvent.id, prior[0]!.id);
    assert.equal(out[0]!.fate.type, 'expanded');
    assert.equal(out[0]!.fate.detected_in_episode, 2);
    assert.equal(out[0]!.fate._extra.note, 'took up the deferred edge');
  });

  it('drops a fate whose target is not a prior event', () => {
    assert.equal(groundFateCandidates([{ ...base, target_event_id: 'ev_nope' }], prior, digest, 2, 'x').length, 0);
  });

  it('drops `maintained` (not an event) and invalid types', () => {
    assert.equal(groundFateCandidates([{ ...base, type: 'maintained' }], prior, digest, 2, 'x').length, 0);
    assert.equal(groundFateCandidates([{ ...base, type: 'nonsense' }], prior, digest, 2, 'x').length, 0);
  });

  it('drops a fate whose evidence_quote is not reproducible in the new digests', () => {
    const out = groundFateCandidates([{ ...base, evidence_quote: 'a quote that never appears anywhere' }], prior, digest, 2, 'x');
    assert.equal(out.length, 0);
  });

  it('drops a too-thin quote and dedupes identical candidates', () => {
    assert.equal(groundFateCandidates([{ ...base, evidence_quote: 'short' }], prior, digest, 2, 'x').length, 0);
    assert.equal(groundFateCandidates([base, { ...base }], prior, digest, 2, 'x').length, 1);
  });

  it('drops a fate whose evidence_ref is a degenerate placeholder (raised bar)', () => {
    // turn 0 / empty session — the soft-fate signature seen on the v5 run.
    assert.equal(
      groundFateCandidates([{ ...base, evidence_ref: { type: 'turn', id: 0, session_id: '' } }], prior, digest, 2, 'x').length,
      0,
    );
    assert.equal(groundFateCandidates([{ ...base, evidence_ref: { type: 'commit', sha: '' } }], prior, digest, 2, 'x').length, 0);
    assert.equal(groundFateCandidates([{ ...base, evidence_ref: { type: 'file', path: '' } }], prior, digest, 2, 'x').length, 0);
  });
});

describe('detectAndApplyFates · end-to-end via rawOverride', () => {
  function seedDigest(sid: string, body: string): void {
    mkdirSync(join(tmp, '.code-journal', 'observations', PID, 'digests'), { recursive: true });
    writeFileSync(digestFilePath(PID, sid), `# digest ${sid}\n\n- Total turns in digest: 2\n\n${body}\n`);
  }

  it('appends a grounded fate to a prior event and compose surfaces it', () => {
    // Episode 1: a prior decision event (becomes "composed").
    seedDigest('sess-1', '**T10 · assistant** prior decision about X');
    let state = readProjectState(PID, 'Fate E2E');
    writeProjectState(state);
    const prior = mkEvent({ session_id: 'sess-1', turn_anchor: 'T10' });
    appendSignals(PID, prior.lens_id, [prior]);
    const r1 = composeAudit({ state });
    assert.equal(r1.ok, true);

    // Episode 2: a new event in a new session whose digest carries the evidence.
    state = readProjectState(PID, 'Fate E2E');
    const newEv = mkEvent({ session_id: 'sess-2', turn_anchor: 'T5' });
    appendSignals(PID, newEv.lens_id, [newEv]);
    seedDigest('sess-2', 'commit fix: persist torn-off state across main-window reload');

    const det = detectAndApplyFates({
      state,
      rawOverride: [{
        target_event_id: prior.id,
        type: 'expanded',
        evidence_ref: { type: 'commit', sha: '7c1a2f0' },
        evidence_quote: 'persist torn-off state across main-window reload',
        note: 'the ignored reload-persistence edge was taken up',
      }],
    });
    assert.equal(det.ok, true);
    if (!det.ok) return;
    assert.equal(det.applied, 1, 'one fate applied');

    // The fate is now persisted on the PRIOR event (append-only mutation).
    const priorReread = readSignals(PID, 'strict-negative-space').find((e) => e.id === prior.id);
    assert.equal(priorReread?.fate.length, 1);
    assert.equal(priorReread?.fate[0]?.type, 'expanded');
    assert.equal(priorReread?.fate[0]?.detected_in_episode, 2);

    // Compose Episode 2 surfaces it in the Fate updates section.
    const r2 = composeAudit({ state });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.episode.fate_updates_surfaced.length, 1);
    assert.ok(r2.markdown.includes('**expanded**'), 'fate type rendered');
    assert.ok(r2.markdown.includes('taken up'), 'fate note rendered');
    assert.ok(!r2.markdown.includes('(none surfaced'), 'not the empty-state line');
  });

  it('is a no-op with no prior episodes (first episode)', () => {
    const state = readProjectState(PID, 'NoPrior');
    const det = detectAndApplyFates({ state, rawOverride: [] });
    assert.equal(det.ok, true);
    if (det.ok) assert.equal(det.applied, 0);
  });
});
