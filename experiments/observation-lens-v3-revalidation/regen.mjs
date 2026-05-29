import { digestClaudeCodeTranscript } from "/Users/pandazki/Codes/code-journal/packages/observation/src/lib/digest.ts";
import { writeFileSync } from "node:fs";
for (const [code, path, out] of [
  ["B", process.argv[2], "/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation/digests-fixed/proj-B.md"],
  ["C", process.argv[3], "/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation/digests-fixed/proj-C.md"],
]) {
  const r = digestClaudeCodeTranscript({ jsonlPath: path, projectCode: code });
  writeFileSync(out, r.markdown);
  const userTextTurns = r.turns.filter(t => t.role === "user" && t.kind === "text").length;
  const thinking = r.turns.filter(t => t.kind === "thinking").length;
  console.log(`proj-${code}: ${r.turns.length} turns, ${userTextTurns} user-text turns, ${thinking} thinking`);
}
