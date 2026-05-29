import { readFileSync, readdirSync } from "node:fs";
const dir = "runs";
const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const stanceOf = (p) => {
  const m = p.match(/\*\*Stance\*\*:\s*(engaged|deferred|overrode|ignored)/i);
  return m ? m[1].toLowerCase() : "?";
};
const byKey = {};
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); }
  catch (e) { console.log(`PARSE FAIL ${f}: ${e.message}`); continue; }
  const evs = j.events || [];
  const anchors = evs.map(e => e.turn_anchor);
  byKey[f] = { n: evs.length, anchors, stances: evs.map(e => stanceOf(e.payload||"")) };
}
for (const [f, v] of Object.entries(byKey)) {
  if (f.includes("deferral")) {
    const c = {engaged:0,deferred:0,overrode:0,ignored:0};
    for (const s of v.stances) c[s] = (c[s]||0)+1;
    console.log(`${f.padEnd(20)} n=${v.n}  e${c.engaged}/d${c.deferred}/o${c.overrode}/i${c.ignored}  anchors=[${v.anchors.join(", ")}]`);
  } else {
    console.log(`${f.padEnd(20)} n=${v.n}  anchors=[${v.anchors.join(", ")}]`);
  }
}
