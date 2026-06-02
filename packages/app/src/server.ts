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
  assignMember,
  badgeLabel,
  buildJournalFromDisk,
  categorize,
  createProject,
  defaultRepoKeyResolver,
  discoverAllSessions,
  hostTimezone,
  parseTranscript,
  previewLine,
  projectConfig,
  projectIdFor,
  readJournalSettings,
  readProjectRegistry,
  removeProject,
  setProjectConfig,
  unassignMember,
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

  // Structural Project edits (assign / rename / timezone / delete) change how
  // sessions group, so the journal must be rebuilt to reflect them. The rebuild
  // is EXPENSIVE (reads every transcript + a `git` spawn per repo — tens of
  // seconds) and synchronous, so we do NOT run it on every edit (that froze the
  // server and made the next click hang). Instead we just flag the journal
  // stale; the user rebuilds on demand via the "Rebuild" action.
  let registryDirty = false;
  function rebuildNow(): void {
    const fresh = buildJournalFromDisk();
    journal.projects = fresh.projects;
    journal.activity = fresh.activity;
    journal.generatedAt = fresh.generatedAt;
    loadNarratives(journal);
    reindex();
    tallyCache = null; // new sessions may have landed; refresh the folder list
    registryDirty = false;
  }

  // Folder discovery is expensive (reads every session + a `git` spawn per
  // distinct cwd — seconds). The repo→session-count tally only changes when new
  // sessions land on disk, NOT when Projects are reorganized, so cache it and
  // recompute just the cheap registry overlay on each /api/projects request.
  // Without this, every create/assign re-ran the full scan (the ~10s lag).
  let tallyCache: Map<string, number> | null = null;
  function repoTally(): Map<string, number> {
    if (tallyCache) return tallyCache;
    const repoKey = defaultRepoKeyResolver();
    const t = new Map<string, number>();
    for (const s of discoverAllSessions()) {
      const rk = repoKey(s.cwd) ?? s.cwd;
      t.set(rk, (t.get(rk) ?? 0) + 1);
    }
    tallyCache = t;
    return t;
  }

  /**
   * Folders worth organizing: every repo that earns a journal entry (≥2
   * sessions, non-junk), plus any repo a Project already claims. Mirrors the
   * journal's own filter so the list isn't drowned by one-off scratch cwds.
   */
  function discoverFolders(): Array<{ repoKey: string; name: string; sessionCount: number; projectId: string }> {
    const reg = readProjectRegistry();
    const member = new Map<string, string>();
    for (const p of reg.projects) for (const m of p.members) member.set(m, p.id);
    const junk = (name: string) => /^(\.|claude-code-boot)/.test(name);
    return [...repoTally().entries()]
      .map(([rk, n]) => ({ repoKey: rk, name: rk.split('/').pop() || rk, sessionCount: n }))
      .filter((f) => member.has(f.repoKey) || (!junk(f.name) && f.sessionCount >= 2))
      .map((f) => ({ ...f, projectId: member.get(f.repoKey) ?? projectIdFor(f.repoKey) }))
      .sort((a, b) => b.sessionCount - a.sessionCount);
  }

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
      res.end(JSON.stringify({ projects, zones: supportedTimeZones(), host: hostTimezone(), dirty: registryDirty }));
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
          // Persist to the registry and flag the journal stale — the (slow)
          // re-bucketing happens on the next manual Rebuild, not on every edit.
          setProjectConfig(projectId, { timezone: tz }, proj.displayName);
          registryDirty = true;
          res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
          res.end(JSON.stringify({ ok: true, projectId, timezone: tz, dirty: true }));
        } catch (err) {
          res.writeHead(400, { 'content-type': MIME['.json']! });
          res.end(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
        }
      });
      return;
    }

    // Projects management — list folders + registered Projects (for the
    // organize screen). Derived from discovery + registry; no journal build.
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const reg = readProjectRegistry();
      res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
      res.end(
        JSON.stringify({
          folders: discoverFolders(),
          projects: reg.projects.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            members: p.members,
            config: p.config,
          })),
          zones: supportedTimeZones(),
          host: hostTimezone(),
          dirty: registryDirty,
        }),
      );
      return;
    }
    if (url.pathname === '/api/projects' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const body = JSON.parse(raw || '{}') as Record<string, unknown>;
          const action = String(body.action ?? '');
          switch (action) {
            case 'create': {
              const { id } = createProject(String(body.displayName ?? '').trim() || 'Project');
              res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
              res.end(JSON.stringify({ ok: true, id })); // empty Project: no regroup, not dirty
              return;
            }
            case 'rename':
              setProjectConfig(String(body.id), {}, String(body.displayName ?? '').trim());
              registryDirty = true; // display name shows in the journal
              break;
            case 'timezone':
              setProjectConfig(String(body.id), { timezone: String(body.timezone ?? '') });
              registryDirty = true;
              break;
            case 'assign': {
              const repoKey = String(body.repoKey ?? '');
              const target = String(body.projectId ?? '');
              if (!repoKey) throw new Error('repoKey required');
              if (target) assignMember(target, repoKey);
              else unassignMember(repoKey); // '' → revert to its own auto-Project
              registryDirty = true;
              break;
            }
            case 'delete':
              removeProject(String(body.id));
              registryDirty = true;
              break;
            case 'rebuild':
              rebuildNow(); // the one place the expensive re-scan runs — on demand
              break;
            default:
              throw new Error(`unknown action '${action}'`);
          }
          res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
          res.end(JSON.stringify({ ok: true, dirty: registryDirty }));
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
