#!/usr/bin/env node
/**
 * Recharacterize a lens against a reference session — Phase 2 E1
 * follow-up. Run this when bumping `lens_version` on either lens
 * spec to measure how stance-counts vary across N independent scans
 * on the same digest.
 *
 * Output: a one-page markdown report with per-stance min/max/stdev
 * and the variance budget the MVP-II audit composer should use when
 * rendering "stance counts ± range".
 *
 * Usage:
 *   node scripts/recharacterize-lens.mjs \
 *     --lens anchored-deferral \
 *     --reference ~/.code-journal/observations/<pid>/digests/<sid>.md \
 *     --n 5 \
 *     [--model sonnet|opus] \
 *     [--out ./variance-report-<lens>-<date>.md]
 *
 * Each scan dispatches `claude -p` with the lens prompt + the digest.
 * Cost: N × per-scan tokens (typically ~60K each at sonnet).
 *
 * Notes:
 *   - haiku is REJECTED (Phase 2 E1: misses ~50% of events).
 *   - Use the same session for every variance characterization so
 *     comparisons across versions are like-for-like.
 *   - This is intentionally NOT a workspace package script — it's a
 *     one-off operator tool. It uses tsx to call the observation
 *     library directly.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.lens || !args.reference) {
  process.stderr.write(
    'usage: recharacterize-lens.mjs --lens <strict-negative-space|anchored-deferral> --reference <digest.md> [--n 5] [--model sonnet|opus] [--out path]\n',
  );
  process.exit(2);
}
const lensId = args.lens;
const referencePath = resolve(String(args.reference));
const n = Math.max(2, Math.min(20, Number(args.n ?? 5)));
const model = String(args.model ?? 'sonnet');
if (model === 'haiku') {
  process.stderr.write('error: haiku is banned for production lens runs (Phase 2 E1).\n');
  process.exit(2);
}
const date = new Date().toISOString().slice(0, 10);
const outPath = args.out ? String(args.out) : resolve(`./variance-report-${lensId}-${date}.md`);

process.stdout.write(`recharacterize: ${lensId} × ${n} runs (model=${model})\n`);
process.stdout.write(`reference: ${referencePath}\n\n`);

// We use the package's lens-runner via a small inline TS evaluator.
// The CLI doesn't expose a single-shot lens run, so we shell to tsx.
const helperPath = resolve(import.meta.dirname, '_lens-runner-helper.mjs');
mkdirSync(dirname(helperPath), { recursive: true });
writeFileSync(
  helperPath,
  `import { runLens } from '@code-journal/observation';
import { readFileSync } from 'node:fs';

const digest = readFileSync(process.argv[2], 'utf8');
const r = runLens({
  lensId: process.argv[3],
  lensVersion: 'recharacterize',
  digestMarkdown: digest,
  projectId: '__recharacterize__',
  sessionId: '__recharacterize__',
  agent: 'claude-code',
  model: process.argv[4],
});
process.stdout.write(JSON.stringify(r) + '\\n');
`,
);

const runs = [];
for (let i = 1; i <= n; i++) {
  process.stdout.write(`  run ${i}/${n}... `);
  const t0 = Date.now();
  const result = spawnSync(
    'node',
    ['--import', 'tsx', helperPath, referencePath, lensId, model],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000 },
  );
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  if (result.status !== 0) {
    process.stdout.write(`failed (${dt}s)\n`);
    process.stderr.write(result.stderr ?? '(no stderr)\n');
    runs.push({ ok: false, dt });
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}');
  } catch (e) {
    process.stdout.write(`bad JSON (${dt}s)\n`);
    runs.push({ ok: false, dt });
    continue;
  }
  if (!parsed.ok) {
    process.stdout.write(`runLens.ok=false (${dt}s): ${parsed.reason}\n`);
    runs.push({ ok: false, dt });
    continue;
  }
  const stances = countStances(parsed.events ?? []);
  runs.push({
    ok: true,
    dt,
    total: parsed.events.length,
    ...stances,
  });
  process.stdout.write(`${parsed.events.length} events (${dt}s)\n`);
}

writeFileSync(outPath, renderReport(lensId, model, referencePath, n, runs));
process.stdout.write(`\nwrote variance report: ${outPath}\n`);

// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

function countStances(events) {
  const out = { engaged: 0, deferred: 0, overrode: 0, ignored: 0 };
  for (const e of events) {
    const m = /\*\*Stance\*\*:\s*(engaged|deferred|overrode|ignored)/.exec(e.payload ?? '');
    if (m) out[m[1]] += 1;
  }
  return out;
}

function stats(arr) {
  if (arr.length === 0) return { min: 0, max: 0, mean: 0, stdev: 0 };
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return { min, max, mean, stdev: Math.sqrt(variance) };
}

function renderReport(lensId, model, refPath, n, runs) {
  const ok = runs.filter((r) => r.ok);
  const out = [];
  out.push(`# Lens variance report — ${lensId}`);
  out.push('');
  out.push(`- Model: \`${model}\``);
  out.push(`- Reference digest: \`${refPath}\``);
  out.push(`- Runs: ${n} (${ok.length} succeeded)`);
  out.push(`- Generated: ${new Date().toISOString()}`);
  out.push('');
  out.push('## Per-run results');
  out.push('');
  out.push('| Run | total | engaged | deferred | overrode | ignored | duration |');
  out.push('|-----|-------|---------|----------|----------|---------|----------|');
  runs.forEach((r, i) => {
    if (r.ok) {
      out.push(
        `| ${i + 1} | ${r.total} | ${r.engaged} | ${r.deferred} | ${r.overrode} | ${r.ignored} | ${r.dt}s |`,
      );
    } else {
      out.push(`| ${i + 1} | (failed) | | | | | ${r.dt}s |`);
    }
  });
  out.push('');

  if (ok.length === 0) {
    out.push('## Variance budget');
    out.push('');
    out.push('No successful runs — cannot characterise variance.');
    return out.join('\n');
  }

  const cats = ['total', 'engaged', 'deferred', 'overrode', 'ignored'];
  out.push('## Variance budget');
  out.push('');
  out.push('| Category | min | max | mean | stdev | range |');
  out.push('|----------|-----|-----|------|-------|-------|');
  for (const c of cats) {
    const vals = ok.map((r) => r[c]);
    const s = stats(vals);
    out.push(`| ${c} | ${s.min} | ${s.max} | ${s.mean.toFixed(2)} | ${s.stdev.toFixed(2)} | ${s.max - s.min} |`);
  }
  out.push('');
  out.push('## How to use this report');
  out.push('');
  out.push('- The `range` column is the recommended "± budget" for stance counts in audits using this lens version. A category with range = 3 should be displayed as `count = X (typical range ±3 across reruns)`.');
  out.push('- If `total` range > 30% of the mean, consider the lens prompt unstable — refine wording before bumping `lens_version` for production.');
  out.push('- If only one category dominates the variance, the lens definition for that category may be too permissive (Phase 2 E1 saw this with `overrode`).');
  out.push('');
  out.push('## Cross-version comparison (manual)');
  out.push('');
  out.push('Compare this report against earlier `variance-report-<lens>-*.md` to track whether prompt edits widened or narrowed the budget. Material widening = roll back the change.');
  return out.join('\n');
}
