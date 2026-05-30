import fs from 'node:fs';
import path from 'node:path';
import { digestClaudeCodeTranscript } from '/Users/pandazki/Codes/code-journal/packages/observation/src/lib/digest.ts';

const root = process.env.HOME + '/.claude/projects';
const targets = [
  { code: 'G-aadp', dir: '-Users-pandazki-Codes-advanced-agentic-dev-patterns', id: 'ad412bf5' },
  { code: 'H-pcraft', dir: '-Users-pandazki-Codes-pneuma-craft', id: 'b1415317' },
  { code: 'I-shortcraft', dir: '-Users-pandazki-shortcraft-dogfeed', id: '17fddf78' },
];
const outDir = '/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation/digests-gen';
fs.mkdirSync(outDir, { recursive: true });

const report = [];
for (const t of targets) {
  const pdir = path.join(root, t.dir);
  const f = fs.readdirSync(pdir).find((x) => x.startsWith(t.id) && x.endsWith('.jsonl'));
  if (!f) { report.push(`${t.code}: NO FILE for ${t.id}`); continue; }
  const r = digestClaudeCodeTranscript({ jsonlPath: path.join(pdir, f), projectCode: t.code });
  fs.writeFileSync(path.join(outDir, `${t.code}.md`), r.markdown);
  const userText = r.turns.filter((x) => x.role === 'user' && x.kind === 'text').length;
  report.push(
    `${t.code}: ${r.turns.length} turns, ${userText} user-text, thinking=${r.turns.filter((x) => x.kind === 'thinking').length}, task-notif=${(r.markdown.match(/task-notification/g) || []).length}, continue=${(r.markdown.match(/Continue from where you left off/g) || []).length}  sid=${r.meta.sessionId.slice(0, 8)}`,
  );
}
fs.writeFileSync('/tmp/cj-gen.txt', report.join('\n') + '\n');
console.log(report.join('\n'));
