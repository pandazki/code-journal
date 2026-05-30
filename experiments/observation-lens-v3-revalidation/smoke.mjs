// End-to-end smoke of the NEW observation pipeline (post #1/#2/#3), driving the
// real library functions — digest → grounding gate → appendSignals → compose —
// without invoking the built CLI (which does TTY rendering). The only step not
// exercised here is the `claude -p` lens dispatch; the lens JSON was produced by
// isolated subagents (same shape runLens.finalize emits).

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import {
  digestClaudeCodeTranscript,
  computeEventId,
  appendSignals,
  composeAudit,
  newProjectState,
  checkEventGrounding,
  turnsFromDigest,
  digestFilePath,
  digestsDir,
  observationsDir,
} from '/Users/pandazki/Codes/code-journal/packages/observation/src/index.ts';

const ROOT = '/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation';
const RAW = `${process.env.HOME}/.claude/projects/-Users-pandazki-Codes-tanka-work-memory-plugin/6446d252-252d-4459-8932-0b141c1ee12c.jsonl`;
const SESSION = '6446d252-252d-4459-8932-0b141c1ee12c';
const PID = 'smoke-tanka-v3';

// Fresh project dir (clean any prior smoke run)
try { rmSync(projectRoot(PID), { recursive: true, force: true }); } catch {}

const state = newProjectState(PID, 'Smoke: tanka (v3 pipeline)');

// 1. Digest the raw transcript with the FIXED digester; cache where compose reads it.
const digest = digestClaudeCodeTranscript({ jsonlPath: RAW, projectCode: PID });
mkdirSync(digestsDir(PID), { recursive: true });
writeFileSync(digestFilePath(PID, SESSION), digest.markdown);
const turns = turnsFromDigest(digest.turns);
console.log(`digest: ${digest.turns.length} turns, ${digest.turns.filter(t=>t.role==='user'&&t.kind==='text').length} user-text turns`);

// 2. Load the three lens outputs (produced by subagents) and build events.
const lensFiles = {
  'strict-negative-space': `${ROOT}/runs/Bfix-strict-1.json`,
  'anchored-deferral': `${ROOT}/runs/Bfix-deferral-v3-1.json`,
  'user-initiated-pivot': `${ROOT}/runs/Bfix-pivot-1.json`,
};

const primaryTurn = (a) => { const m = /T?(\d+)/.exec(String(a)); return m ? parseInt(m[1],10) : 0; };

for (const [lensId, file] of Object.entries(lensFiles)) {
  const lensVersion = state.config.lens_versions[lensId];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const raw = (parsed.events || []).map((e) => ({
    id: computeEventId({ project_id: PID, session_id: SESSION, lens_id: lensId, turn_anchor: String(e.turn_anchor), lens_version: lensVersion }),
    lens_id: lensId, lens_version: lensVersion, project_id: PID, session_id: SESSION,
    turn_anchor: String(e.turn_anchor), primary_turn: primaryTurn(e.turn_anchor),
    timespan: null, source_refs: Array.isArray(e.source_refs) ? e.source_refs.map(r => ({...r, session_id: r.session_id ?? SESSION})) : [],
    payload: String(e.payload ?? ''), detected_at: '2026-05-30T00:00:00.000Z', agent: 'claude-code', fate: [], _extra: {},
  }));
  // 3. Grounding gate (same as scanOneSession)
  const grounded = [], dropped = [];
  for (const ev of raw) {
    const c = checkEventGrounding(ev, turns);
    (c.grounded ? grounded : dropped).push({ ev, c });
  }
  for (const d of dropped) {
    const failed = d.c.checks.filter(x=>x.fatal&&!x.pass).map(x=>x.name).join('+');
    console.log(`  ✗ GROUNDING DROP ${lensId} @${d.ev.turn_anchor} (${failed})`);
  }
  appendSignals(PID, lensId, grounded.map(g => g.ev));
  console.log(`${lensId}: ${raw.length} emitted → ${grounded.length} stored (${dropped.length} dropped)`);
}

// 4. Compose the audit.
const res = composeAudit({ state });
if (!res.ok) { console.log('COMPOSE FAILED:', res.reason); process.exit(1); }
console.log(`\nAUDIT_PATH=${res.paths.markdown}`);
