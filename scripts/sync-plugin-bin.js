/**
 * Copy the freshly-built CLI bundle into the Claude Code plugin's bin/ dir.
 *
 * Runs from the workspace root's postinstall (and the release CI). The built
 * artifact is not committed — the wrapper scripts in the plugin's bin/ expect
 * this file to be generated at install time.
 */
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const built = path.join(repo, 'packages', 'cli', 'dist', 'index.js');
const dest = path.join(repo, 'claude-plugin', 'bin', 'code-journal.js');

if (!fs.existsSync(built)) {
  console.error(`sync-plugin-bin: ${built} missing; run 'npm run build' first`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(built, dest);
fs.chmodSync(dest, 0o755);

// Also copy the source map if present (helps with crash diagnostics).
const mapBuilt = built + '.map';
const mapDest = dest + '.map';
if (fs.existsSync(mapBuilt)) {
  fs.copyFileSync(mapBuilt, mapDest);
}

console.log(`sync-plugin-bin: ${path.relative(repo, dest)} ← ${path.relative(repo, built)}`);
