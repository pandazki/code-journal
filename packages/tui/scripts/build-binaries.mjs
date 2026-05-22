/**
 * Cross-platform release binaries via `bun build --compile`.
 *
 * Bun cross-compiles from any host — no per-target toolchain — and bundles
 * Ink's yoga-wasm asset into the binary. Bun is a build-time tool only; the
 * app's dev/test runtime stays Node.
 *
 *   node scripts/build-binaries.mjs                  # all targets
 *   node scripts/build-binaries.mjs darwin-arm64     # one target by name
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(pkgDir, 'src/cli.tsx');
const outDir = join(pkgDir, 'dist');

/** Bun --target → output binary name. Bun cross-compiles every one from any host. */
const TARGETS = [
  { name: 'darwin-arm64', bunTarget: 'bun-darwin-arm64' },
  { name: 'darwin-x64', bunTarget: 'bun-darwin-x64' },
  { name: 'linux-x64', bunTarget: 'bun-linux-x64' },
  { name: 'linux-arm64', bunTarget: 'bun-linux-arm64' },
];

const want = process.argv.slice(2);
const targets = want.length ? TARGETS.filter((t) => want.includes(t.name)) : TARGETS;
if (targets.length === 0) {
  console.error(`no matching target. known: ${TARGETS.map((t) => t.name).join(', ')}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const { name, bunTarget } of targets) {
  const outfile = join(outDir, `cj-${name}`);
  process.stdout.write(`▶ ${name} (${bunTarget}) … `);
  execFileSync(
    'bun',
    ['build', '--compile', `--target=${bunTarget}`, entry, '--outfile', outfile],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const mb = (statSync(outfile).size / 1024 / 1024).toFixed(1);
  console.log(`✓ ${outfile} (${mb} MB)`);
}
