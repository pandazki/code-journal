#!/usr/bin/env node
// Cheap heuristic baseline for "direction injection" detection.
// Question it answers: how much of the LLM lens's output could a dumb
// regex reproduce? If the baseline flags the same user turns the lens
// anchors, the LLM isn't earning its cost.
//
// Strategy: a user text turn is a "direction-injection candidate" if it is
// substantive (not a bare ack) AND contains a redirect/decline/new-axis
// marker OR introduces a new file/path/term not raised by the AI just before.
//
// Usage: node heuristic-baseline.mjs <digest.md>

import { readFileSync } from "node:fs";

const digestPath = process.argv[2];
const raw = readFileSync(digestPath, "utf8");
const lines = raw.split("\n");
const headerRe = /^\*\*(T\d+) · (user|assistant) \(([^)]+)\) · (@[^*]+)\*\*\s*$/;

const turns = [];
let cur = null;
for (const line of lines) {
  const m = line.match(headerRe);
  if (m) {
    if (cur) turns.push(cur);
    cur = { id: m[1], n: +m[1].slice(1), role: m[2], kind: m[3].trim(), body: [] };
  } else if (cur) cur.body.push(line);
}
if (cur) turns.push(cur);

const text = (t) => t.body.join("\n").trim();
const userText = turns.filter((t) => t.role === "user" && t.kind === "text");

// markers (zh + en)
const redirect = /算了|不要|别|改成|换成|换个|其实|等等|先别|不对|应该是|我觉得|我想|不如|wait|actually|instead|no,? |let'?s not|forget|rather|hold on|scrap/i;
const decline = /不行|不可以|不需要|没必要|don'?t|skip|drop/i;
const ack = /^(好的?|ok|okay|嗯+|可以|继续|go on|sounds good|👍|赞|对的?|是的|行)[。\.!！~]*$/i;
const pathLike = /[\w./-]+\.(ts|js|md|json|py|tsx|jsx|sh|html|css)|`[^`]+`/;

const flagged = [];
for (const t of userText) {
  const body = text(t);
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) continue;
  const isAck = ack.test(compact) || compact.length < 6;
  const hasRedirect = redirect.test(body) || decline.test(body);
  const hasPath = pathLike.test(body);
  const substantive = compact.length >= 12 && !isAck;
  const score = (hasRedirect ? 2 : 0) + (hasPath ? 1 : 0) + (substantive ? 1 : 0);
  const flag = !isAck && (hasRedirect || (substantive && hasPath) || compact.length >= 40);
  flagged.push({ id: t.id, n: t.n, flag, score, hasRedirect, hasPath, substantive, preview: compact.slice(0, 70) });
}

console.log(`# user text turns: ${userText.length}`);
console.log(`# baseline-flagged: ${flagged.filter((f) => f.flag).length}`);
console.log("");
for (const f of flagged) {
  console.log(`${f.flag ? "▶ FLAG" : "  ----"} ${f.id.padStart(5)} score=${f.score} redir=${+f.hasRedirect} path=${+f.hasPath}  "${f.preview}"`);
}
console.log("");
console.log("FLAGGED_TURNS=" + flagged.filter((f) => f.flag).map((f) => f.id).join(","));
