#!/usr/bin/env node
/**
 * Audit composer — events from two lenses → one δ' markdown audit per project.
 *
 * Deterministic templating only. Lenses already did the narrative work in
 * each event's `payload` (5-section card or stance card). The composer:
 *
 *   1. lays events out in the δ' audit-report structure
 *   2. computes structural MEASUREMENTS (intrinsic counts, not scores)
 *      from event lists + digest's turn → {role, ts} map
 *   3. marks same-turn cross-lens convergence with a ↔ marker
 *   4. renders the `Redirected to` field for ignored-stance events
 *
 * No LLM in this step. No ratios that look like evaluations. Counts and
 * durations only — interpretation belongs to the reader.
 *
 * Usage:
 *   node experiments/observation-lens-v1/scripts/compose.mjs --project A --out audits/proj-A.md
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ARGS = parseArgs(process.argv.slice(2));
if (!ARGS.project || !ARGS.out) {
  process.stderr.write('usage: compose.mjs --project <A|B|C> --out <audit.md>\n');
  process.exit(2);
}

const ROOT = resolve(process.cwd(), 'experiments/observation-lens-v1');
const PC = ARGS.project;
const strictPath = `${ROOT}/events/proj-${PC}-strict.json`;
const deferralPath = `${ROOT}/events/proj-${PC}-deferral.json`;
const digestPath = `${ROOT}/digests/proj-${PC}/session.md`;

const strict = JSON.parse(readFileSync(strictPath, 'utf8'));
const deferral = JSON.parse(readFileSync(deferralPath, 'utf8'));
const digest = readFileSync(digestPath, 'utf8');

const meta = mineHeader(digest);
const turnMap = buildTurnMap(digest); // turn id → { role, ts }

// ─────────────────────────────────────────────────────────────────────────────
// Per-event extraction
// ─────────────────────────────────────────────────────────────────────────────

// Strict events: primary anchor turn = first turn in turn_anchor range
function primaryTurn(turnAnchor) {
  const m = String(turnAnchor).match(/T?(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const strictPrimaryTurns = strict.events.map((e) => primaryTurn(e.turn_anchor)).filter((x) => x != null);

// Deferral events: anchor turn = first turn in turn_anchor range
const deferralAnchorTurns = deferral.events.map((e) => primaryTurn(e.turn_anchor)).filter((x) => x != null);
const deferralAnchorSet = new Set(deferralAnchorTurns);

// Cross-lens convergence: strict events whose primary turn matches a deferral anchor
const strictConvergent = new Set(strictPrimaryTurns.filter((t) => deferralAnchorSet.has(t)));
const convergenceCount = strictConvergent.size;

// Stance distribution
const stances = { engaged: 0, deferred: 0, overrode: 0, ignored: 0 };
for (const ev of deferral.events) {
  const m = ev.payload.match(/\*\*Stance\*\*:\s*(engaged|deferred|overrode|ignored)/);
  if (m) stances[m[1]] += 1;
}

// Anchor-type distribution
const anchorTypes = { 'direct-ask': 0, '≥2-named-options': 0, 'explicit-uncertainty': 0 };
for (const ev of deferral.events) {
  const m = ev.payload.match(/\*\*Anchor \(AI salience event\)\*\*:\s*([^\n*]+)/);
  if (m) {
    const t = m[1].trim();
    if (t in anchorTypes) anchorTypes[t] += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Measurements (M1-M5). Each is a count or duration — never a normalized
// "rate" or "score". Reader attaches meaning.
// ─────────────────────────────────────────────────────────────────────────────

const digestTurnsTotal = meta.digestTurns ? parseInt(meta.digestTurns, 10) : turnMap.size;

// M1: anchor density per 100 turns (raw count + denominator, no ratio adjective)
const M1_density_per_100 = digestTurnsTotal > 0
  ? (deferral.events.length / digestTurnsTotal * 100).toFixed(2)
  : null;

// M2: response latency — for each deferral event, find next user turn after anchor
// and compute clock-time delta. Aggregate as min / median / max (counts only).
const latencies = [];
for (const ev of deferral.events) {
  const anchorTurn = primaryTurn(ev.turn_anchor);
  if (anchorTurn == null) continue;
  const lat = nextUserResponseLatency(anchorTurn, turnMap);
  if (lat != null) latencies.push(lat);
}
const M2_latencies = latencies.slice().sort((a, b) => a - b);

// M3: pivot magnitude — for each strict event, count concrete artifact mentions
// in the "After — concrete artifacts" section. Artifacts = `…backtick…` spans.
const pivotMagnitudes = strict.events.map((ev) => {
  const after = (ev.payload.match(/\*\*After — concrete artifacts\*\*:\s*([\s\S]*?)(?:\n\n\*\*Why|$)/) || [, ''])[1];
  const ticks = (after.match(/`[^`\n]+`/g) || []).length;
  return { turn: primaryTurn(ev.turn_anchor), count: ticks };
});

// M4: anchor-to-response turn distance — counted in turn ids (the digest is
// turn-by-turn so this is the number of intervening turns).
const M4_distances = [];
for (const ev of deferral.events) {
  const anchorTurn = primaryTurn(ev.turn_anchor);
  if (anchorTurn == null) continue;
  const respTurn = nextUserResponseTurn(anchorTurn, turnMap);
  if (respTurn != null) M4_distances.push(respTurn - anchorTurn);
}

// M5: lens convergence per session = # strict events whose primary turn is
// also a deferral anchor / # strict events. Raw fraction, no qualitative label.
const M5_convergence = strict.events.length > 0
  ? `${convergenceCount} / ${strict.events.length}`
  : '0 / 0';

// ─────────────────────────────────────────────────────────────────────────────
// Compose
// ─────────────────────────────────────────────────────────────────────────────

const out = [];
out.push(`# Audit · Project ${PC} · Episode 1 · ${meta.dateRange || '(unknown range)'}`);
out.push('');

// ── Scope ────────────────────────────────────────────────────────────────────
out.push('## Scope');
out.push('');
out.push(`- Time window: ${meta.dateRange || '(not detected)'}`);
out.push(`- Sessions covered: 1 (single-session episode)`);
out.push(`- Agent: claude-code`);
out.push(`- Total raw transcript lines: ${meta.rawLines || '?'}`);
out.push(`- Total turns in digest: ${digestTurnsTotal || '?'}`);
out.push(`- Previous episode: none (this is the first)`);
out.push('');

// ── Method ───────────────────────────────────────────────────────────────────
out.push('## Method');
out.push('');
out.push('Two lenses run independently over the same transcript digest, each in an isolated');
out.push('subagent context (no cross-contamination between lenses or between projects):');
out.push('');
out.push('- **Lens 1 — strict-negative-space**: scans for events where (a) the AI made an');
out.push('  identifiable specific proposal, (b) the user did not take it up, (c) subsequent');
out.push('  work clearly went along a different axis. Sparse by design — Phase 1 ledger');
out.push('  produced 2-4 events per session.');
out.push('- **Lens 2 — anchored-deferral**: finds AI salience events (direct-ask, ≥2-named-');
out.push('  options, explicit-uncertainty) and classifies user response into engaged /');
out.push('  deferred / overrode / ignored. For `ignored` stance, additionally captures');
out.push('  the concrete new direction the user introduced.');
out.push('');
out.push('Trigger for this episode: manual baseline scan (Phase 1 experiment).');
out.push('');
out.push('**Valence-stripping reminder (§ 8)**: strict-negative-space events do **not**');
out.push('carry valence. The same event can read as "user pulled work off AI\'s proposed');
out.push('axis" *or* "user pulled work onto a more pressing concern" — which reading');
out.push('applies depends on context the lens cannot see and the reader can. The audit');
out.push('does not pick. anchored-deferral stances (engaged / deferred / overrode /');
out.push('ignored) are observation labels, not quality grades — no stance is "better".');
out.push('');

// ── Measurements ─────────────────────────────────────────────────────────────
out.push('## Measurements');
out.push('');
out.push('Intrinsic counts and durations only. No normalised scores, no cross-collaboration');
out.push('comparison. Reader attaches meaning.');
out.push('');
out.push('| ID | Measurement | Value | What it counts (not what it means) |');
out.push('| -- | ----------- | ----- | ---------------------------------- |');
out.push(`| M1 | Anchor density | ${deferral.events.length} anchors / ${digestTurnsTotal} turns = **${M1_density_per_100} per 100 turns** | How often this agent on this project exposed an explicit decision-point. Property of the agent's questioning style, not the user. |`);
out.push(`| M2 | Response latency | n=${latencies.length} · min=${fmtDur(M2_latencies[0])} · median=${fmtDur(median(M2_latencies))} · max=${fmtDur(M2_latencies[M2_latencies.length - 1])} | Wall-clock time from each AI anchor to the next user message. Long latencies = thought OR distraction OR away-from-keyboard — lens does not distinguish. |`);
out.push(`| M3 | Pivot magnitude (strict) | ${pivotMagnitudes.map((p) => `T${p.turn}: ${p.count}`).join(' · ')} | Count of \`backtick-quoted\` artifacts (file paths, commit shas, commands) named in each strict event's "After" section. Larger = bigger landing surface for the new direction; smaller = lighter pivot. |`);
out.push(`| M4 | Anchor-to-response turn distance | n=${M4_distances.length} · min=${minOf(M4_distances)} · median=${median(M4_distances)} · max=${maxOf(M4_distances)} | Turns between AI anchor and user response. ≥ 2 implies intervening AI activity (tool calls, follow-up thinking) between anchor and human reply. |`);
out.push(`| M5 | Lens convergence | ${M5_convergence} strict events share a primary turn with a deferral anchor (${convergenceCount} convergent / ${strict.events.length} strict) | When both lenses fire on the same turn the moment has both (a) explicit AI decision-point AND (b) macro pivot. Low convergence = explicit AI decisions and macro pivots are usually on different turns. |`);
out.push('');
out.push('Each row is a **measurement** in the strict sense: if a different collaboration had identical values, the row would say identical things. No row says "high" or "low" or "your" — those would be evaluations.');
out.push('');

// ── Anchor density / type distribution (moved before stance per audit ordering) ──
out.push('## Anchor distribution (the agent\'s salience-event side)');
out.push('');
out.push(`Total anchors: ${deferral.events.length} (${M1_density_per_100} per 100 turns).`);
out.push('');
out.push('| Anchor type            | Count |');
out.push('| ---------------------- | ----- |');
out.push(`| direct-ask             | ${anchorTypes['direct-ask']} |`);
out.push(`| ≥2-named-options       | ${anchorTypes['≥2-named-options']} |`);
out.push(`| explicit-uncertainty   | ${anchorTypes['explicit-uncertainty']} |`);
out.push('');
out.push('> This table is shown **before** the stance distribution on purpose: the stance counts below are conditional on these anchors existing. A user who looks "less engaged" may simply be in a session where the agent exposed fewer explicit decisions.');
out.push('');

// ── Stance distribution ──────────────────────────────────────────────────────
out.push('## Stance distribution (the user\'s response side)');
out.push('');
out.push('Counts, not rates. Reported as a 4-tuple to preserve shape (e.g., zero in one cell is structurally meaningful).');
out.push('');
out.push('| Stance     | Count |');
out.push('| ---------- | ----- |');
out.push(`| engaged    | ${stances.engaged} |`);
out.push(`| deferred   | ${stances.deferred} |`);
out.push(`| overrode   | ${stances.overrode} |`);
out.push(`| ignored    | ${stances.ignored} |`);
out.push('');
out.push(`**Shape**: (e=${stances.engaged}, d=${stances.deferred}, o=${stances.overrode}, i=${stances.ignored}). No collapsed-to-scalar reduction (e.g., no "engagement rate") — those would lose shape information.`);
out.push('');

// ── Findings — Strict negative-space ─────────────────────────────────────────
out.push('## Findings — Strict negative-space');
out.push('');
if (strict.events.length === 0) {
  out.push(`**EMPTY-STATE**: ${strict.empty_state_reason || 'No qualifying events found.'}`);
  out.push('');
} else {
  out.push(`${strict.events.length} event${strict.events.length === 1 ? '' : 's'} found.`);
  out.push('');
  for (let i = 0; i < strict.events.length; i++) {
    const ev = strict.events[i];
    const pTurn = primaryTurn(ev.turn_anchor);
    const conv = pTurn != null && deferralAnchorSet.has(pTurn);
    const convMarker = conv ? ' ↔ deferral anchor at same turn (D' + (deferralAnchorTurns.indexOf(pTurn) + 1) + ')' : '';
    out.push(`### Strict event ${i + 1} · turns ${ev.turn_anchor}${convMarker}`);
    out.push('');
    out.push(ev.payload);
    out.push('');
    const pm = pivotMagnitudes[i];
    if (pm) out.push(`*Pivot magnitude (M3)*: ${pm.count} concrete artifact${pm.count === 1 ? '' : 's'} named in After`);
    out.push(`*Source refs*: ${formatSourceRefs(ev.source_refs)}`);
    out.push('');
    out.push('---');
    out.push('');
  }
}

// ── Findings — Anchored deferral ─────────────────────────────────────────────
out.push('## Findings — Anchored deferral');
out.push('');
out.push(`${deferral.events.length} anchor event${deferral.events.length === 1 ? '' : 's'} found.`);
out.push('');
if (deferral.events.length > 0) {
  out.push('### Per-anchor detail');
  out.push('');
  for (let i = 0; i < deferral.events.length; i++) {
    const ev = deferral.events[i];
    const aTurn = primaryTurn(ev.turn_anchor);
    const conv = aTurn != null && strictPrimaryTurns.includes(aTurn);
    const convMarker = conv ? ' ↔ strict event at same turn' : '';
    out.push(`#### Anchor ${i + 1} · turn ${ev.turn_anchor}${convMarker}`);
    out.push('');
    out.push(ev.payload);
    out.push('');
    // Per-event measurements
    const lat = aTurn != null ? nextUserResponseLatency(aTurn, turnMap) : null;
    const dist = aTurn != null ? (() => { const r = nextUserResponseTurn(aTurn, turnMap); return r != null ? r - aTurn : null; })() : null;
    const bits = [];
    if (lat != null) bits.push(`latency = ${fmtDur(lat)}`);
    if (dist != null) bits.push(`turn-distance = ${dist}`);
    if (bits.length) out.push(`*Measurements*: ${bits.join(' · ')}`);
    out.push(`*Source refs*: ${formatSourceRefs(ev.source_refs)}`);
    out.push('');
  }
}

// ── Fate updates ─────────────────────────────────────────────────────────────
out.push('---');
out.push('');
out.push('## Fate updates');
out.push('');
out.push('No fate updates — this is the first audit episode for this project. Subsequent');
out.push('episodes will list events from prior episodes whose fate has evolved (reverted,');
out.push('expanded, user-reframed, etc.). Old events are append-only; their fate accrues but');
out.push('the original event records do not change. (§ 8)');
out.push('');

// ── Limitations ──────────────────────────────────────────────────────────────
out.push('## Limitations');
out.push('');
out.push('- **Single session per project.** This Phase 1 episode covers one transcript;');
out.push('  patterns across multiple sessions are not yet observable.');
out.push('- **Recall is not validated.** The lens produced N events; how many gradient');
out.push('  events the lens *missed* is structurally unverifiable from a participant');
out.push('  review alone. (§ 14.1 ceiling)');
out.push('- **Run-to-run variance is real.** Re-running the lens on the same digest can');
out.push('  produce somewhat different event counts (especially in the looser stance');
out.push('  categories). Treat single-run numbers as one sample, not ground truth.');
out.push('- **Lens coverage is bounded.** Only two lenses run; phenomena outside their');
out.push('  definitions are invisible to this audit.');
out.push('- **No baseline comparison within-collaboration.** § 9 二阶可预测性 (predicting');
out.push('  *where* the user injects direction) needs a trajectory prior across sessions —');
out.push('  Phase 1 cannot address this.');
out.push('');

// ── Source index ─────────────────────────────────────────────────────────────
out.push('## Source index');
out.push('');
out.push(`- Project code: \`${PC}\` (real project name in gitignored \`PROJECT-MAPPING.md\`)`);
out.push(`- Session: \`${meta.sessionId || strict.session_id}\``);
out.push(`- Transcript digest: \`experiments/observation-lens-v1/digests/proj-${PC}/session.md\``);
out.push(`- Raw events: \`experiments/observation-lens-v1/events/proj-${PC}-strict.json\` + \`...-deferral.json\` (both gitignored — contain verbatim user/AI text)`);
out.push('');

mkdirSync(dirname(ARGS.out), { recursive: true });
writeFileSync(ARGS.out, out.join('\n'));
process.stdout.write(`wrote audit: ${ARGS.out} (${strict.events.length} strict + ${deferral.events.length} deferral · convergence ${convergenceCount}/${strict.events.length})\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

function mineHeader(digest) {
  const head = digest.split('---')[0] || '';
  const sessionId = (head.match(/session\s+([a-f0-9]+)/i) || [])[1] || null;
  const startedM = head.match(/Started:\s+`([^`]+)`/);
  const endedM = head.match(/Ended:\s+`([^`]+)`/);
  let dateRange = null;
  if (startedM && endedM) {
    const s = startedM[1].slice(0, 10);
    const e = endedM[1].slice(0, 10);
    dateRange = s === e ? s : `${s} → ${e}`;
  }
  const rawLines = (head.match(/raw JSONL lines:\s+(\d+)/) || [])[1] || null;
  const digestTurns = (head.match(/turns in digest:\s+(\d+)/) || [])[1] || null;
  return { sessionId, dateRange, rawLines, digestTurns };
}

// Parse turn headers from digest: `**T<n> · <role> (<kind>) · @<iso-ts>**`
function buildTurnMap(digest) {
  const map = new Map();
  const re = /^\*\*T(\d+) · (\w+) \([^)]*\)(?: · @([0-9TZ:.\-]+))?\*\*/gm;
  let m;
  while ((m = re.exec(digest)) !== null) {
    const id = parseInt(m[1], 10);
    if (!map.has(id)) {
      map.set(id, { role: m[2], ts: m[3] ? new Date(m[3]).getTime() : null });
    }
  }
  return map;
}

function nextUserResponseTurn(afterTurn, turnMap) {
  // Find smallest turn id > afterTurn whose role is 'user'
  const ids = Array.from(turnMap.keys()).sort((a, b) => a - b);
  for (const id of ids) {
    if (id <= afterTurn) continue;
    const t = turnMap.get(id);
    if (t.role === 'user') return id;
  }
  return null;
}

function nextUserResponseLatency(anchorTurn, turnMap) {
  const respId = nextUserResponseTurn(anchorTurn, turnMap);
  if (respId == null) return null;
  const anchor = turnMap.get(anchorTurn);
  const resp = turnMap.get(respId);
  if (!anchor || !resp || anchor.ts == null || resp.ts == null) return null;
  return (resp.ts - anchor.ts) / 1000; // seconds
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function minOf(arr) { return arr && arr.length ? Math.min(...arr) : null; }
function maxOf(arr) { return arr && arr.length ? Math.max(...arr) : null; }

function fmtDur(seconds) {
  if (seconds == null) return 'n/a';
  if (seconds < 0) return '(neg)'; // shouldn't happen unless event order is wrong
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatSourceRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return '(none recorded)';
  return refs
    .map((r) => {
      if (r.type === 'turn') return `turn T${r.id}`;
      if (r.type === 'turn-range') return `turns T${r.from}-T${r.to}`;
      if (r.type === 'commit') return `commit ${r.sha}`;
      return JSON.stringify(r);
    })
    .join(', ');
}
