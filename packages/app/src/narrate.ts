/**
 * The narrative engine's runtime half — calls the host coding agent (`claude
 * -p`) to write day and project recaps, and caches them under
 * `~/.code-journal/narratives/`. The journal is fully usable without this;
 * narrative is enrichment layered on when present.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  buildDayPrompt,
  buildProjectPrompt,
  dayNarrativeKey,
  parseDayNarrative,
  parseStory,
  projectNarrativeKey,
  type CachedNarrative,
  type Journal,
} from '@code-journal/core';

const CACHE_DIR = join(homedir(), '.code-journal', 'narratives');

function cachePath(kind: 'days' | 'projects', id: string): string {
  return join(CACHE_DIR, kind, id.replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
}

function readCache(p: string): CachedNarrative | null {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as CachedNarrative;
  } catch {
    return null;
  }
}

function writeCache(p: string, n: CachedNarrative): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(n, null, 2));
}

/**
 * Attach every cached narrative to the journal, in place. A narrative is shown
 * whenever one exists — even slightly stale (the day kept moving after it was
 * written) beats none. `generateNarratives` is what acts on the staleness key.
 */
export function loadNarratives(journal: Journal): void {
  for (const project of journal.projects) {
    const pc = readCache(cachePath('projects', project.projectId));
    if (pc) project.story = pc.story;
    for (const day of project.days) {
      const dc = readCache(cachePath('days', project.projectId + '__' + day.date));
      if (dc) {
        day.story = dc.story;
        if (dc.title) day.title = dc.title;
      }
    }
  }
}

/** Ask the host coding agent a single prompt, headless. */
function callAgent(prompt: string): string {
  return execFileSync('claude', ['-p', prompt], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 240_000,
  });
}

/**
 * Generate the missing or stale narratives — day recaps newest-first up to
 * `limit`, then a fresh arc recap for every project a new day landed in.
 * `projectFilter` (case-insensitive name substrings) scopes it to those
 * projects; empty means every project.
 */
export function generateNarratives(
  journal: Journal,
  limit: number,
  projectFilter: string[] = [],
): void {
  const inScope = (name: string): boolean =>
    projectFilter.length === 0 || projectFilter.some((f) => name.toLowerCase().includes(f));
  const days = journal.projects
    .filter((p) => inScope(p.displayName))
    .flatMap((p) => p.days.map((d) => ({ p, d })))
    .sort((a, b) => b.d.date.localeCompare(a.d.date));

  let done = 0;
  let skipped = 0;
  const touched = new Set<string>();
  for (const { p, d } of days) {
    if (done >= limit) break;
    const key = dayNarrativeKey(d);
    const path = cachePath('days', p.projectId + '__' + d.date);
    const cached = readCache(path);
    if (cached && cached.key === key && cached.title) {
      skipped++;
      continue;
    }
    process.stdout.write(`  · ${p.displayName} · ${d.date}\n`);
    try {
      const { title, story } = parseDayNarrative(callAgent(buildDayPrompt(d, p.displayName)));
      if (story.length) {
        writeCache(path, { key, title, story, generatedAt: new Date().toISOString() });
        d.story = story;
        d.title = title;
        done++;
        touched.add(p.projectId);
      }
    } catch (err) {
      process.stdout.write(`    failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  for (const project of journal.projects) {
    if (!touched.has(project.projectId)) continue;
    const key = projectNarrativeKey(project);
    const path = cachePath('projects', project.projectId);
    if (readCache(path)?.key === key) continue;
    process.stdout.write(`  · ${project.displayName} · arc\n`);
    try {
      const story = parseStory(callAgent(buildProjectPrompt(project)));
      if (story.length) {
        writeCache(path, { key, story, generatedAt: new Date().toISOString() });
        project.story = story;
      }
    } catch (err) {
      process.stdout.write(`    failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  process.stdout.write(`  ${done} narratives written, ${skipped} already current\n`);
}
