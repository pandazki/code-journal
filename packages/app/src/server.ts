/**
 * The local journal server — serves the SPA from `webDir` and the journal
 * itself at GET /api/journal. Unauthenticated; binds loopback by default (your
 * machine talking to your own browser). The bind host is overridable via
 * main.ts's `--host`/`--lan` for LAN access — opt-in, with a startup warning,
 * since there is no auth.
 */
import { readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import {
  badgeLabel,
  categorize,
  hostTimezone,
  parseTranscript,
  previewLine,
  projectConfig,
  readJournalSettings,
  rebuildProjectJournal,
  rollUpActivity,
  setProjectConfig,
  type Journal,
} from '@code-journal/core';

import { loadNarratives } from './narrate';
import { overview, episode, setConfig } from './observations';

/** The IANA zones offered in the Settings dropdown — the full platform list
 *  when available (Node 18+), else a small fallback covering common offsets. */
function supportedTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const zones = fn?.('timeZone');
    if (zones && zones.length) return zones;
  } catch {
    /* fall through to the curated list */
  }
  return [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
}

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
 * Start the server on `port` (0 picks an ephemeral one), bound to `host`
 * (default loopback — see main.ts for the `--host`/`--lan` opt-in and its
 * security warning). The journal is serialized once — it doesn't change over a
 * run — so /api/journal is instant.
 */
export function startServer(
  journal: Journal,
  webDir: string,
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const root = resolve(webDir);

  // The journal is rebuilt in place when a project's timezone changes, so the
  // serialized payload and the transcript allowlist are recomputed by reindex()
  // rather than frozen at startup.
  let payload = '';
  let knownTranscripts = new Map<string, string>();
  function reindex(): void {
    payload = JSON.stringify(journal);
    const known = new Map<string, string>();
    for (const project of journal.projects) {
      for (const day of project.days) {
        for (const s of day.sessions) known.set(s.path, s.agent);
      }
    }
    knownTranscripts = known;
  }
  reindex();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/journal') {
      res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
      res.end(payload);
      return;
    }

    // Journal settings — per-project timezone the day cards / heatmap reckon in.
    if (url.pathname === '/api/journal/settings' && req.method === 'GET') {
      const legacy = readJournalSettings(); // pre-registry timezones, for fallback
      const projects = journal.projects.map((p) => ({
        id: p.projectId,
        displayName: p.displayName,
        // '' means "auto" (host zone); the UI shows the resolved host zone.
        timezone: projectConfig(p.projectId).timezone || legacy[p.projectId]?.timezone || '',
      }));
      res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
      res.end(JSON.stringify({ projects, zones: supportedTimeZones(), host: hostTimezone() }));
      return;
    }
    if (url.pathname === '/api/journal/settings' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const { projectId, timezone } = JSON.parse(raw || '{}') as {
            projectId?: string;
            timezone?: string;
          };
          const proj = journal.projects.find((p) => p.projectId === projectId);
          if (!projectId || !proj) {
            res.writeHead(404, { 'content-type': MIME['.json']! });
            res.end(JSON.stringify({ error: 'unknown projectId' }));
            return;
          }
          const tz = timezone ?? '';
          if (tz) {
            try {
              new Intl.DateTimeFormat('en-US', { timeZone: tz });
            } catch {
              res.writeHead(400, { 'content-type': MIME['.json']! });
              res.end(JSON.stringify({ error: `unknown timezone: ${tz}` }));
              return;
            }
          }
          // Persist to the unified Project registry, then rebuild just this
          // project in its new zone and swap it in — far cheaper than re-running
          // the whole multi-repo discovery.
          setProjectConfig(projectId, { timezone: tz }, proj.displayName);
          const rebuilt = rebuildProjectJournal(projectId);
          if (!rebuilt) {
            res.writeHead(404, { 'content-type': MIME['.json']! });
            res.end(JSON.stringify({ error: 'project no longer discoverable' }));
            return;
          }
          journal.projects = journal.projects.map((p) =>
            p.projectId === projectId ? rebuilt : p,
          );
          journal.activity = rollUpActivity(journal.projects);
          loadNarratives(journal); // re-attach any narratives whose keys still match
          reindex();
          res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
          res.end(
            JSON.stringify({ ok: true, projectId, timezone: projectConfig(projectId).timezone || '' }),
          );
        } catch (err) {
          res.writeHead(400, { 'content-type': MIME['.json']! });
          res.end(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
        }
      });
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
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveListen(server);
    });
  });
}
