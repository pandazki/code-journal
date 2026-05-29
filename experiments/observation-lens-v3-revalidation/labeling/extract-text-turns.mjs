#!/usr/bin/env node
// Extract only the text turns (user text + assistant text) from a digest,
// dropping tool_use / tool_result noise, to produce a human labeling sheet.
// The human marks, per USER text turn, whether they injected direction there.
//
// Usage: node extract-text-turns.mjs <digest.md> <out-sheet.md>

import { readFileSync, writeFileSync } from "node:fs";

const [, , digestPath, outPath] = process.argv;
if (!digestPath || !outPath) {
  console.error("usage: extract-text-turns.mjs <digest.md> <out.md>");
  process.exit(1);
}

const raw = readFileSync(digestPath, "utf8");
const lines = raw.split("\n");

// Header form: **T<n> · <role> (<kind>) · @<ts>**
const headerRe = /^\*\*(T\d+) · (user|assistant) \(([^)]+)\) · (@[^*]+)\*\*\s*$/;

const turns = [];
let cur = null;
for (const line of lines) {
  const m = line.match(headerRe);
  if (m) {
    if (cur) turns.push(cur);
    cur = { id: m[1], role: m[2], kind: m[3], ts: m[4], body: [] };
  } else if (cur) {
    cur.body.push(line);
  }
}
if (cur) turns.push(cur);

const textTurns = turns.filter((t) => t.kind.trim() === "text");
const userTextTurns = textTurns.filter((t) => t.role === "user");

const clean = (t) => t.body.join("\n").replace(/\n{3,}/g, "\n\n").trim();

const out = [];
out.push(`# Labeling sheet — Project B (tanka) · session 6446d252`);
out.push("");
out.push(
  `> Mark every USER turn where **you injected direction** — steered the work, ` +
    `changed the plan, introduced a new concern/file/term, declined what was on the table, ` +
    `or made a call that mattered. Ignore turns that are just acknowledgement ("ok", "好") ` +
    `or pure clarification questions with no steer.`,
);
out.push(">");
out.push(
  `> For each user turn below, put **[Y]** (direction injected) or **[N]** in the \`mark:\` line, ` +
    `and optionally a few words on *what* you steered. Tool turns are hidden; this is the ` +
    `conversation only. AI text turns are shown for context but you don't mark them.`,
);
out.push(">");
out.push(
  `> ${textTurns.length} text turns shown (of 210 total turns) — ` +
    `${userTextTurns.length} of them are user turns to mark.`,
);
out.push("");
out.push("---");
out.push("");

for (const t of textTurns) {
  const body = clean(t);
  if (t.role === "assistant") {
    out.push(`### ${t.id} · 🤖 assistant`);
    out.push("");
    // assistant text can be long; keep it but flag
    out.push(body.length > 1600 ? body.slice(0, 1600) + "\n\n…(truncated)…" : body);
    out.push("");
  } else {
    out.push(`### ${t.id} · 🧑 USER`);
    out.push("");
    out.push(body);
    out.push("");
    out.push("`mark: [ ]   what: `");
    out.push("");
  }
  out.push("---");
  out.push("");
}

writeFileSync(outPath, out.join("\n"));
console.error(
  `wrote ${outPath}: ${textTurns.length} text turns (${userTextTurns.length} user turns to mark)`,
);
