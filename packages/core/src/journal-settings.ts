/**
 * Per-project settings for the visual journal — a tiny, separate store from the
 * work-log `config.json` projects (journal projects are discovered by git repo,
 * keyed by the `projectIdFor` slug+hash, and have no config.json of their own).
 *
 * Today it holds only the timezone a project's day cards and activity heatmap
 * are reckoned in. Lives at `~/.code-journal/journal-settings.json` as a flat
 * `{ [projectId]: { timezone } }` map; missing/unset means "use the host zone".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { hostTimezone } from './datetime';
import { workMemoryRoot } from './paths';

export interface JournalProjectSettings {
  /** IANA zone (e.g. "Asia/Shanghai"); empty/absent = host auto-detected zone. */
  timezone?: string;
}

export type JournalSettings = Record<string, JournalProjectSettings>;

export function journalSettingsPath(): string {
  return join(workMemoryRoot(), 'journal-settings.json');
}

/** Read the settings map; an empty map on any error (missing file, bad JSON). */
export function readJournalSettings(): JournalSettings {
  try {
    const raw = JSON.parse(readFileSync(journalSettingsPath(), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JournalSettings) : {};
  } catch {
    return {};
  }
}

/**
 * The effective IANA zone a journal project reckons days in: its pinned
 * `timezone`, or the auto-detected host zone when unset. The single source of
 * truth threaded into `buildJournalFromDisk`'s day-bucketing.
 */
export function journalProjectTimezone(projectId: string, settings?: JournalSettings): string {
  const s = settings ?? readJournalSettings();
  return s[projectId]?.timezone || hostTimezone();
}

/**
 * Pin (or clear, with an empty string) a project's timezone and persist it.
 * Returns the updated settings map. Validates the zone is one `Intl` accepts;
 * throws otherwise so a typo can't silently disable day reckoning.
 */
export function setJournalProjectTimezone(projectId: string, timezone: string): JournalSettings {
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new Error(`unknown timezone: ${timezone}`);
    }
  }
  const settings = readJournalSettings();
  const entry = { ...(settings[projectId] ?? {}) };
  if (timezone) entry.timezone = timezone;
  else delete entry.timezone;
  settings[projectId] = entry;

  const p = journalSettingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(settings, null, 2) + '\n');
  return settings;
}
