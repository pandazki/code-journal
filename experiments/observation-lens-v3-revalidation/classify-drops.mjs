import fs from 'node:fs';
import path from 'node:path';
import { digestClaudeCodeTranscript } from '/Users/pandazki/Codes/code-journal/packages/observation/src/lib/digest.ts';
import { turnsFromDigest, extractVerbatims } from '/Users/pandazki/Codes/code-journal/packages/observation/src/lib/grounding.ts';

const HOME = process.env.HOME;
const R = '/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation';
const P = {
  H: { dir: '-Users-pandazki-Codes-pneuma-craft', id: 'b1415317' },
  I: { dir: '-Users-pandazki-shortcraft-dogfeed', id: '17fddf78' },
};
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const turnsOf = (p) => {
  const pd = path.join(HOME, '.claude/projects', P[p].dir);
  const f = fs.readdirSync(pd).find((x) => x.startsWith(P[p].id) && x.endsWith('.jsonl'));
  return turnsFromDigest(digestClaudeCodeTranscript({ jsonlPath: path.join(pd, f), projectCode: p }).turns);
};
// find ALL turns containing head/tail/full of the snippet
const locateAll = (snippet, turns) => {
  const n = norm(snippet);
  if (n.length < 4) return [];
  const head = n.slice(0, Math.min(30, n.length));
  const tail = n.slice(-Math.min(30, n.length));
  const ids = [];
  for (const t of turns) {
    const tn = norm(t.text);
    if (tn.includes(n) || tn.includes(head) || tn.includes(tail)) ids.push(t.id);
  }
  return ids;
};
const drops = [
  ['H', 'deferral', 'anchored-deferral', 'T78-T79'],
  ['H', 'deferral', 'anchored-deferral', 'T479-T480'],
  ['H', 'pivot', 'user-initiated-pivot', 'T638'],
  ['I', 'strict', 'strict-negative-space', 'T86-T93'],
];
const out = [];
for (const [p, L, lid, anchor] of drops) {
  const turns = turnsOf(p);
  const j = JSON.parse(fs.readFileSync(`${R}/runs2/${p}-${L}.json`, 'utf8'));
  const e = j.events.find((x) => x.turn_anchor === anchor);
  const v = extractVerbatims({ ...e, lens_id: lid });
  const nums = anchor.match(/\d+/g).map(Number);
  const range = [Math.min(...nums), Math.max(...nums)];
  // full-string occurrences vs head-only occurrences
  const fullHits = v.proposal ? turns.filter((t) => norm(t.text).includes(norm(v.proposal))).map((t) => t.id) : [];
  const headHits = v.proposal ? locateAll(v.proposal, turns) : [];
  const nearAnchor = headHits.filter((id) => id >= range[0] - 2 && id <= range[1] + 2);
  let verdict;
  if (headHits.length === 0 && fullHits.length === 0) verdict = 'TRUE_FABRICATION (verbatim absent entirely)';
  else if (nearAnchor.length > 0) verdict = `FALSE_KILL (verbatim present near anchor at T${nearAnchor.join(',')}, but first-match elsewhere)`;
  else verdict = `MISCITE_or_PARTIAL (verbatim/head found at T${headHits.join(',')||'-'}, none near cited ${anchor})`;
  out.push(`### ${p}-${L} @${anchor}  [range ${range[0]}-${range[1]}]`);
  out.push(`  proposal head: ${JSON.stringify((v.proposal || '').slice(0, 55))}`);
  out.push(`  full-string occurrences: [${fullHits.join(', ')}]`);
  out.push(`  head/tail occurrences:   [${headHits.join(', ')}]`);
  out.push(`  near cited anchor:       [${nearAnchor.join(', ')}]`);
  out.push(`  VERDICT: ${verdict}`);
  out.push('');
}
fs.writeFileSync('/tmp/classify.out', out.join('\n') + '\n');
console.log('done');
