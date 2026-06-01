#!/usr/bin/env node
/**
 * `code-journal` — build the journal from the local coding-agent sessions,
 * serve it on loopback, and open the browser.
 *
 *   code-journal [--port N] [--no-open] [--host H | --lan]   build + serve
 *   code-journal narrate [--limit N]      write recaps via the host coding agent
 *
 * Binds 127.0.0.1 by default. `--host 0.0.0.0` (or `--lan`) exposes the
 * unauthenticated server on the local network — see the startup warning.
 */
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { buildJournalFromDisk } from '@code-journal/core';

import { generateNarratives, loadNarratives } from './narrate';
import { startServer } from './server';

const DEFAULT_PORT = 4319;

function parseArgs(argv: string[]): { port: number; open: boolean; host: string } {
  let port = DEFAULT_PORT;
  let open = true;
  // Default to loopback — the server is unauthenticated and serves your
  // transcripts/paths/observations. `--host 0.0.0.0` (or `--lan`) opts into
  // exposing it on the local network; see the warning printed at startup.
  let host = '127.0.0.1';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]) || DEFAULT_PORT;
    else if (argv[i] === '--no-open') open = false;
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i]!;
    else if (argv[i] === '--lan') host = '0.0.0.0';
  }
  return { port, open, host };
}

/** Non-loopback bind → the server is reachable by other machines. */
function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** Best-effort LAN IPv4 of this machine, for the "reachable at" hint. */
function lanAddress(): string | null {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const ni of ifaces ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => {
    /* best-effort — the URL is printed regardless */
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // `code-journal narrate [--limit N] [--project NAME]…` — write recaps via the
  // host coding agent. `--project` (repeatable) scopes it to matching projects.
  if (argv[0] === 'narrate') {
    const projects: string[] = [];
    let limit = 0;
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === '--project' && argv[i + 1]) projects.push(argv[++i]!.toLowerCase());
      else if (argv[i] === '--limit' && argv[i + 1]) limit = Math.max(1, Number(argv[++i]) || 0);
    }
    if (limit === 0) limit = projects.length > 0 ? 1000 : 12;
    process.stdout.write('code-journal — writing narratives via the host coding agent…\n');
    const j = buildJournalFromDisk();
    generateNarratives(j, limit, projects);
    return;
  }

  const { port, open, host } = parseArgs(argv);

  process.stdout.write('code-journal — reading your coding-agent sessions…\n');
  const started = Date.now();
  const journal = buildJournalFromDisk();
  loadNarratives(journal);
  const sessions = journal.projects.reduce((n, p) => n + p.totalSessions, 0);
  process.stdout.write(
    `  ${journal.projects.length} projects · ${sessions} sessions · ${journal.activity.length} active days` +
      `  (${((Date.now() - started) / 1000).toFixed(1)}s)\n`,
  );

  const webDir = join(__dirname, '..', 'web');
  const server = await startServer(journal, webDir, port, host);
  const actual = (server.address() as AddressInfo).port;
  // Open the browser at loopback regardless of bind host (0.0.0.0 includes it).
  const localUrl = `http://127.0.0.1:${actual}/`;
  if (isLoopbackHost(host)) {
    process.stdout.write(`  journal at ${localUrl}  (Ctrl-C to stop)\n`);
  } else {
    const lan = lanAddress();
    process.stdout.write(
      `  ⚠ listening on ${host}:${actual} — UNAUTHENTICATED and reachable by other\n` +
        `    machines on your network. It serves your transcripts, file paths, and\n` +
        `    observation audits. Only do this on a trusted network.\n` +
        `  journal at ${localUrl}` +
        (lan ? `  ·  on your LAN: http://${lan}:${actual}/` : '') +
        `  (Ctrl-C to stop)\n`,
    );
  }
  if (open) openBrowser(localUrl);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write('code-journal failed: ' + msg + '\n');
  process.exit(1);
});
