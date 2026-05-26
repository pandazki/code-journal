#!/usr/bin/env node
/**
 * Audit composer — events from two lenses → one δ' markdown audit per project.
 *
 * Deterministic templating only. The narrative work was already done by the
 * lenses in each event's `payload` (5-section card or stance card). The
 * composer just lays them out in the audit-report structure (Scope / Method
 * / Findings / Fate / Limitations / Source index).
 *
 * Usage:
 *   node experiments/observation-lens-v1/scripts/compose.mjs --project A --out audits/proj-A.md
 *
 * Reads: events/proj-<X>-strict.json, events/proj-<X>-deferral.json,
 *        digests/proj-<X>/session.md (for scope metadata).
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

// Mine scope metadata from the digest header
const meta = mineHeader(digest);

// Stance distribution
const stances = { engaged: 0, deferred: 0, overrode: 0, ignored: 0 };
for (const ev of deferral.events) {
  const m = ev.payload.match(/\*\*Stance\*\*:\s*(engaged|deferred|overrode|ignored)/);
  if (m) stances[m[1]] += 1;
}

// Anchor type distribution
const anchorTypes = { 'direct-ask': 0, '≥2-named-options': 0, 'explicit-uncertainty': 0 };
for (const ev of deferral.events) {
  const m = ev.payload.match(/\*\*Anchor \(AI salience event\)\*\*:\s*([^\n*]+)/);
  if (m) {
    const t = m[1].trim();
    if (t in anchorTypes) anchorTypes[t] += 1;
  }
}

// Compose
const out = [];
out.push(`# Audit · Project ${PC} · Episode 1 · ${meta.dateRange || '(unknown range)'}`);
out.push('');
out.push('## Scope');
out.push('');
out.push(`- Time window: ${meta.dateRange || '(not detected)'}`);
out.push(`- Sessions covered: 1 (single-session episode)`);
out.push(`- Agent: claude-code`);
out.push(`- Total raw transcript lines: ${meta.rawLines || '?'}`);
out.push(`- Total turns in digest: ${meta.digestTurns || '?'}`);
out.push(`- Previous episode: none (this is the first)`);
out.push('');
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
out.push('  deferred / overrode / ignored. Phase 1 ledger produced 12-17 per session.');
out.push('');
out.push('Trigger for this episode: manual baseline scan (Phase 1 experiment, not yet driven');
out.push('by the cron + information-increment gate that the target architecture specifies).');
out.push('');
out.push('---');
out.push('');
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
    out.push(`### Strict event ${i + 1} · turns ${ev.turn_anchor}`);
    out.push('');
    out.push(ev.payload);
    out.push('');
    out.push(`*Source refs*: ${formatSourceRefs(ev.source_refs)}`);
    out.push('');
    out.push('---');
    out.push('');
  }
}

out.push('## Findings — Anchored deferral');
out.push('');
out.push(`${deferral.events.length} anchor event${deferral.events.length === 1 ? '' : 's'} found.`);
out.push('');
out.push('**Stance distribution** (for this single session — not extrapolable):');
out.push('');
out.push('| Stance     | Count |');
out.push('| ---------- | ----- |');
out.push(`| engaged    | ${stances.engaged} |`);
out.push(`| deferred   | ${stances.deferred} |`);
out.push(`| overrode   | ${stances.overrode} |`);
out.push(`| ignored    | ${stances.ignored} |`);
out.push('');
out.push('**Anchor-type distribution** (what kinds of salience events the AI exposed):');
out.push('');
out.push('| Anchor type            | Count |');
out.push('| ---------------------- | ----- |');
out.push(`| direct-ask             | ${anchorTypes['direct-ask']} |`);
out.push(`| ≥2-named-options       | ${anchorTypes['≥2-named-options']} |`);
out.push(`| explicit-uncertainty   | ${anchorTypes['explicit-uncertainty']} |`);
out.push('');
if (deferral.events.length > 0) {
  out.push('### Per-anchor detail');
  out.push('');
  for (let i = 0; i < deferral.events.length; i++) {
    const ev = deferral.events[i];
    out.push(`#### Anchor ${i + 1} · turn ${ev.turn_anchor}`);
    out.push('');
    out.push(ev.payload);
    out.push('');
    out.push(`*Source refs*: ${formatSourceRefs(ev.source_refs)}`);
    out.push('');
  }
}

out.push('---');
out.push('');
out.push('## Fate updates');
out.push('');
out.push('No fate updates — this is the first audit episode for this project. Subsequent');
out.push('episodes will list events from prior episodes whose fate has evolved (reverted,');
out.push('expanded, user-reframed, etc.). Old events are append-only; their fate accrues but');
out.push('the original event records do not change. (§ 8)');
out.push('');
out.push('## Limitations');
out.push('');
out.push('- **Single session per project.** This Phase 1 episode covers one transcript;');
out.push('  patterns across multiple sessions are not yet observable. Project arcs and');
out.push('  per-collaboration drift would require multi-session episodes.');
out.push('- **Recall is not validated.** The lens produced N events; how many gradient');
out.push('  events the lens *missed* is structurally unverifiable from a participant-');
out.push('  review alone. (§ 14.1 ceiling) Phase 2+ can attempt third-party reader');
out.push('  reconstruction or fate-driven back-inference.');
out.push('- **Lens coverage is bounded.** Only two lenses run; phenomena outside their');
out.push('  definitions (e.g., long silent stretches with no anchor at all) are invisible');
out.push('  to this audit.');
out.push('- **No baseline comparison within-collaboration.** § 9 二阶可预测性 (predicting');
out.push('  *where* the user injects direction) needs a trajectory prior across sessions —');
out.push('  Phase 1 cannot address this.');
out.push('');
out.push('## Source index');
out.push('');
out.push(`- Project code: \`${PC}\` (real project name in gitignored \`PROJECT-MAPPING.md\`)`);
out.push(`- Session: \`${meta.sessionId || strict.session_id}\``);
out.push(`- Transcript digest: \`experiments/observation-lens-v1/digests/proj-${PC}/session.md\``);
out.push(`- Raw events: \`experiments/observation-lens-v1/events/proj-${PC}-strict.json\` + \`...-deferral.json\` (both gitignored — contain verbatim user/AI text)`);
out.push('');

mkdirSync(dirname(ARGS.out), { recursive: true });
writeFileSync(ARGS.out, out.join('\n'));
process.stdout.write(`wrote audit: ${ARGS.out} (${strict.events.length} strict + ${deferral.events.length} deferral events)\n`);

// ────────────────────────────────────────────────────────────────────────────
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
