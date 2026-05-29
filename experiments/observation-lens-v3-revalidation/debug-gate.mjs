import { extractVerbatims, locateSnippet } from "/Users/pandazki/Codes/code-journal/packages/observation/src/lib/grounding.ts";
import { readFileSync } from "node:fs";
function parseTurns(mdPath){
  const raw=readFileSync(mdPath,"utf8").split("\n");
  const re=/^\*\*(T\d+) · (user|assistant) \(([^)]+)\)/; const turns=[]; let cur=null;
  for(const l of raw){const m=l.match(re); if(m){if(cur)turns.push(cur); cur={id:+m[1].slice(1),body:[]};} else if(cur)cur.body.push(l);}
  if(cur)turns.push(cur); return turns.map(t=>({id:t.id,text:t.body.join("\n")}));
}
const base="/Users/pandazki/Codes/code-journal/experiments/observation-lens-v3-revalidation/";
for(const [rf,md] of [["runs/B-strict-1.json","../observation-lens-v1/digests/proj-B/session.md"],["runs/C-strict-1.json","../observation-lens-v1/digests/proj-C/session.md"]]){
  const j=JSON.parse(readFileSync(base+rf,"utf8")); const turns=parseTurns(base+md);
  console.log("####",rf);
  for(const e of (j.events||[])){
    const v=extractVerbatims(e);
    console.log("  anchor",e.turn_anchor);
    console.log("    proposal extracted:",v.proposal?JSON.stringify(v.proposal.slice(0,60)):"NULL","-> turn",v.proposal?locateSnippet(v.proposal,turns):"-");
    console.log("    response extracted:",v.response?JSON.stringify(v.response.slice(0,60)):"NULL","-> turn",v.response?locateSnippet(v.response,turns):"-");
  }
}
