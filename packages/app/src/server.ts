/**
 * The local journal server — serves the SPA from `webDir` and the journal
 * itself at GET /api/journal. Loopback only, unauthenticated: this is your
 * machine talking to your own browser, nothing leaves it.
 */
import { readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { badgeLabel, categorize, parseTranscript, previewLine, type Journal } from '@code-journal/core';

import { overview, episode, setConfig } from './observations';

/** Cap on transcript entries returned — huge sessions are skimmed, not dumped. */
const TRANSCRIPT_CAP = 3000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * Start the server on `port` (0 picks an ephemeral one). The journal is
 * serialized once — it doesn't change over a run — so /api/journal is instant.
 */
export function startServer(journal: Journal, webDir: string, port: number): Promise<Server> {
  const root = resolve(webDir);
  const payload = JSON.stringify(journal);

  // Allowlist: only transcripts the journal already knows about may be read —
  // a path → agent map, so an arbitrary file can't be fetched off disk.
  const knownTranscripts = new Map<string, string>();
  for (const project of journal.projects) {
    for (const day of project.days) {
      for (const s of day.sessions) knownTranscripts.set(s.path, s.agent);
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/journal') {
      res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
      res.end(payload);
      return;
    }
    if (url.pathname === '/api/transcript') {
      const p = url.searchParams.get('path') ?? '';
      const agent = knownTranscripts.get(p);
      if (!agent) {
        res.writeHead(404, { 'content-type': MIME['.json']! });
        res.end('{"error":"unknown transcript"}');
        return;
      }
      let text = '';
      try {
        text = readFileSync(p, 'utf8');
      } catch {
        /* unreadable → empty transcript */
      }
      const all = parseTranscript(text);
      const entries = all.slice(0, TRANSCRIPT_CAP).map((e) => ({
        n: e.lineNo,
        cat: categorize(e.entry, agent),
        badge: badgeLabel(e.entry, agent),
        text: previewLine(e.entry, agent),
      }));
      res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
      res.end(JSON.stringify({ agent, total: all.length, entries }));
      return;
    }
    // Observation console — config write (POST). Loopback-only; reads body then
    // applies validated per-project config to ProjectState.
    if (url.pathname === '/api/observations/config' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 64 * 1024) req.destroy(); // tiny payload; bail on abuse
      });
      req.on('end', () => {
        try {
          const patch = JSON.parse(raw || '{}');
          const applied = setConfig(patch);
          res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
          res.end(JSON.stringify(applied));
        } catch (err) {
          res.writeHead(400, { 'content-type': MIME['.json']! });
          res.end(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
        }
      });
      return;
    }

    // Observation console — live reads (the signal store changes between syncs).
    if (url.pathname === '/api/observations') {
      try {
        res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
        res.end(JSON.stringify(overview()));
      } catch (err) {
        res.writeHead(500, { 'content-type': MIME['.json']! });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }
    if (url.pathname === '/api/observations/episode') {
      const pid = url.searchParams.get('pid') ?? '';
      const n = Number(url.searchParams.get('n') ?? '');
      if (!pid || !Number.isFinite(n)) {
        res.writeHead(400, { 'content-type': MIME['.json']! });
        res.end('{"error":"pid and n required"}');
        return;
      }
      try {
        const result = episode(pid, n);
        res.writeHead('error' in result ? 404 : 200, {
          'content-type': MIME['.json']!,
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'content-type': MIME['.json']! });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // The console is a single page; bare /observe and any /observe/<deep-link>
    // both serve observe.html (client-side hash routing takes over).
    if (url.pathname === '/observe' || url.pathname.startsWith('/observe/')) {
      url.pathname = '/observe.html';
    }

    // static files — resolved path must stay inside webDir
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = join(root, rel);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404, { 'content-type': MIME['.html']! });
      res.end('<!doctype html><meta charset=utf-8><title>404</title>Not found.');
    }
  });

  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen(server);
    });
  });
}
