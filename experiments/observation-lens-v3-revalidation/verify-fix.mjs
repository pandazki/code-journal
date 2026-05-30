import fs from 'node:fs';
import path from 'node:path';
import { digestClaudeCodeTranscript } from '/Users/pandazki/Codes/code-journal/packages/observation/src/lib/digest.ts';
import { turnsFromDigest, checkEventGrounding } from '/Users/pandazki/Codes/code-journal/packages/observation/src/lib/grounding.ts';

const HOME = process.env.HOME;
const R = '/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation';
const projs = {
  H: { dir: '-Users-pandazki-Codes-pneuma-craft', id: 'b1415317' },
  I: { dir: '-Users-pandazki-shortcraft-dogfeed', id: '17fddf78' },
  B: { dir: '-Users-pandazki-Codes-tanka-work-memory-plugin', id: '6446d252' },
};
const turnsOf = (p) => {
  const pd = path.join(HOME, '.claude/projects', projs[p].dir);
  const f = fs.readdirSync(pd).find((x) => x.startsWith(projs[p].id) && x.endsWith('.jsonl'));
  return turnsFromDigest(digestClaudeCodeTranscript({ jsonlPath: path.join(pd, f), projectCode: p }).turns);
};
// (project, runfile, lens_id, anchor, expectation)
const cases = [
  ['H', 'runs2/H-pivot.json', 'user-initiated-pivot', 'T638', 'KEEP (was false-kill)'],
  ['I', 'runs2/I-strict.json', 'strict-negative-space', 'T86-T93', 'DROP (true fabrication)'],
  ['H', 'runs2/H-deferral.json', 'anchored-deferral', 'T78-T79', 'DROP (paraphrased anchor)'],
  ['H', 'runs2/H-deferral.json', 'anchored-deferral', 'T479-T480', 'KEEP (was false-kill: **A.**/**B.** bold markers truncated extraction)'],
  ['B', 'runs/B-strict-1.json', 'strict-negative-space', 'T85-T95', 'DROP (T127 fabrication regression)'],
];
const out = [];
const tcache = {};
for (const [p, rf, lid, anchor, exp] of cases) {
  if (!tcache[p]) tcache[p] = turnsOf(p);
  const turns = tcache[p];
  const j = JSON.parse(fs.readFileSync(`${R}/${rf}`, 'utf8'));
  const e = j.events.find((x) => x.turn_anchor === anchor);
  if (!e) { out.push(`${p} @${anchor}: EVENT NOT FOUND in ${rf}`); continue; }
  e.lens_id = lid;
  const g = checkEventGrounding(e, turns);
  const fails = g.checks.filter((c) => c.fatal && !c.pass).map((c) => c.name).join('+') || '(none)';
  out.push(`${p} @${anchor}: ${g.grounded ? 'KEPT' : 'DROP'} [${fails}]  — expected: ${exp}`);
}
fs.writeFileSync('experiments/observation-lens-v3-revalidation/_verifyfix.txt', out.join('\n') + '\n');
console.log('done');
