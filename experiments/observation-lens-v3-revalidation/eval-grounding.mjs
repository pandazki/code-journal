import { checkEventGrounding } from "/Users/pandazki/Codes/code-journal/packages/observation/src/lib/grounding.ts";
import { readFileSync } from "node:fs";

function parseTurns(mdPath){
  const raw=readFileSync(mdPath,"utf8").split("\n");
  const re=/^\*\*(T\d+) · (user|assistant) \(([^)]+)\)/;
  const turns=[]; let cur=null;
  for(const l of raw){const m=l.match(re); if(m){if(cur)turns.push(cur); cur={id:+m[1].slice(1),body:[]};} else if(cur)cur.body.push(l);}
  if(cur)turns.push(cur);
  return turns.map(t=>({id:t.id,text:t.body.join("\n")}));
}
// run file -> digest md
const map=[
  ["runs/B-deferral-1.json","../observation-lens-v1/digests/proj-B/session.md"],
  ["runs/B-strict-1.json","../observation-lens-v1/digests/proj-B/session.md"],
  ["runs/C-deferral-1.json","../observation-lens-v1/digests/proj-C/session.md"],
  ["runs/C-strict-1.json","../observation-lens-v1/digests/proj-C/session.md"],
  ["runs/Bfix-strict-1.json","digests-fixed/proj-B.md"],
  ["runs/Bfix-strict-2.json","digests-fixed/proj-B.md"],
  ["runs/Bfix-deferral-1.json","digests-fixed/proj-B.md"],
  ["baseline/TW1-strict-1.json","baseline/tripwire-1-digest.md"],
  ["baseline/TW1-deferral-1.json","baseline/tripwire-1-digest.md"],
  ["baseline/NC-deferral.json","baseline/neg-control-digest.md"],
];
const base="/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation/";
for(const [rf,md] of map){
  const j=JSON.parse(readFileSync(base+rf,"utf8"));
  const turns=parseTurns(base+md);
  const evs=j.events||[];
  let pass=0,rej=0; const rejReasons=[];
  for(const e of evs){
    const r=checkEventGrounding(e,turns);
    if(r.grounded)pass++; else {rej++; rejReasons.push(`${e.turn_anchor}: ${r.checks.filter(c=>!c.pass).map(c=>c.name).join("+")}`);}
  }
  console.log(`${rf.padEnd(28)} events=${evs.length} grounded=${pass} REJECTED=${rej}${rej?"  ["+rejReasons.join(" | ")+"]":""}`);
}
