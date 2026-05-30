import fs from 'node:fs';
import path from 'node:path';
import { digestClaudeCodeTranscript } from '/Users/pandazki/Codes/code-journal/packages/observation/src/lib/digest.ts';
import { turnsFromDigest, checkEventGrounding, extractVerbatims, locateSnippet } from '/Users/pandazki/Codes/code-journal/packages/observation/src/lib/grounding.ts';

const HOME = process.env.HOME;
const ROOT = '/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation';
const projects = [
  { code: 'G', name: 'advanced-agentic-dev-patterns', dir: '-Users-pandazki-Codes-advanced-agentic-dev-patterns', id: 'ad412bf5' },
  { code: 'H', name: 'pneuma-craft', dir: '-Users-pandazki-Codes-pneuma-craft', id: 'b1415317' },
  { code: 'I', name: 'shortcraft-dogfeed', dir: '-Users-pandazki-shortcraft-dogfeed', id: '17fddf78' },
];
const lensId = { strict: 'strict-negative-space', deferral: 'anchored-deferral', pivot: 'user-initiated-pivot' };
const stanceOf = (p) => (p.match(/\*\*Stance\*\*:\s*(engaged|assented|deferred|overrode|ignored)/) || [])[1] || '?';
const rng = (a) => { const n = String(a).match(/\d+/g); return n ? [Math.min(...n.map(Number)), Math.max(...n.map(Number))] : null; };

const out = ['# v3 generalization — 3 NEW unseen projects', ''];
const drops = [];
for (const proj of projects) {
  const pdir = path.join(HOME, '.claude/projects', proj.dir);
  const f = fs.readdirSync(pdir).find((x) => x.startsWith(proj.id) && x.endsWith('.jsonl'));
  const dg = digestClaudeCodeTranscript({ jsonlPath: path.join(pdir, f), projectCode: proj.code });
  const turns = turnsFromDigest(dg.turns);
  out.push(`## ${proj.code} · ${proj.name}`);
  out.push(`digest: ${dg.turns.length} turns, ${dg.turns.filter((t) => t.role === 'user' && t.kind === 'text').length} user-text; thinking=${dg.turns.filter((t) => t.kind === 'thinking').length}, task-notif=${(dg.markdown.match(/task-notification/g) || []).length}, continue=${(dg.markdown.match(/Continue from where/g) || []).length}`);
  for (const L of ['strict', 'deferral', 'pivot']) {
    let j;
    try { j = JSON.parse(fs.readFileSync(`${ROOT}/runs2/${proj.code}-${L}.json`, 'utf8')); } catch (e) { out.push(`  ${L}: BAD (${e.message})`); continue; }
    const evs = j.events || [];
    let kept = 0;
    const st = { engaged: 0, assented: 0, deferred: 0, overrode: 0, ignored: 0 };
    const dlist = [];
    for (const e of evs) {
      e.lens_id = lensId[L];
      const g = checkEventGrounding(e, turns);
      if (g.grounded) { kept++; if (L === 'deferral') { const s = stanceOf(e.payload || ''); if (st[s] != null) st[s]++; } }
      else {
        const reasons = g.checks.filter((c) => c.fatal && !c.pass).map((c) => c.name);
        const v = extractVerbatims(e);
        const propAt = v.proposal ? locateSnippet(v.proposal, turns) : -1;
        const r = rng(e.turn_anchor);
        let verdict;
        if (reasons.includes('proposal_found') && propAt < 0) verdict = 'fabricated(verbatim absent)';
        else if (reasons.includes('citation_accurate')) verdict = (propAt >= 0 && r && propAt >= r[0] - 2 && propAt <= r[1] + 2) ? 'MATCHER_BUG?' : `miscited(realT${propAt} vs ${e.turn_anchor})`;
        else if (reasons.includes('chronology')) verdict = 'chronology(resp before prop)';
        else if (reasons.includes('no_preceding_fork')) verdict = 'leg1(fork preceded)';
        else verdict = reasons.join('+');
        dlist.push(`${e.turn_anchor}:${verdict}`);
        drops.push({ id: `${proj.code}-${L}@${e.turn_anchor}`, reasons, verdict, propAt });
      }
    }
    let line = `  ${L.padEnd(8)}: ${evs.length} emitted → ${kept} kept, ${dlist.length} dropped`;
    if (dlist.length) line += ` [${dlist.join(' | ')}]`;
    if (L === 'deferral') line += `  shape e${st.engaged}/a${st.assented}/d${st.deferred}/o${st.overrode}/i${st.ignored}`;
    if (j.empty_state_reason) line += '  EMPTY';
    out.push(line);
  }
  out.push('');
}
// tally
const tally = {};
for (const d of drops) { const k = d.verdict.split('(')[0]; tally[k] = (tally[k] || 0) + 1; }
out.push('## drop tally: ' + JSON.stringify(tally));
out.push('total drops: ' + drops.length);
fs.writeFileSync('/tmp/cj-analyze2.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
