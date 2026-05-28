/**
 * Path resolution for `~/.code-journal/observations/`.
 *
 * Layout (see MVP-II plan § 5.2):
 *
 *   ~/.code-journal/observations/
 *   ├── _projects.json                cross-project index (display names + ids)
 *   ├── <pid>/
 *   │   ├── state.json                ProjectState
 *   │   ├── signals/
 *   │   │   ├── strict-negative-space.jsonl
 *   │   │   └── anchored-deferral.jsonl
 *   │   ├── digests/
 *   │   │   └── <session-id>.md
 *   │   └── episodes/
 *   │       ├── 1-2026-05-28.md       audit markdown (immutable)
 *   │       └── 1.json                AuditEpisode metadata (immutable)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { LensId } from './schema';

export function observationsRoot(): string {
  return join(homedir(), '.code-journal', 'observations');
}

export function projectsIndexPath(): string {
  return join(observationsRoot(), '_projects.json');
}

export function projectRoot(projectId: string): string {
  return join(observationsRoot(), safe(projectId));
}

export function stateFilePath(projectId: string): string {
  return join(projectRoot(projectId), 'state.json');
}

export function signalsDir(projectId: string): string {
  return join(projectRoot(projectId), 'signals');
}

export function signalFilePath(projectId: string, lensId: LensId): string {
  return join(signalsDir(projectId), `${lensId}.jsonl`);
}

export function digestsDir(projectId: string): string {
  return join(projectRoot(projectId), 'digests');
}

export function digestFilePath(projectId: string, sessionId: string): string {
  return join(digestsDir(projectId), `${safe(sessionId)}.md`);
}

export function episodesDir(projectId: string): string {
  return join(projectRoot(projectId), 'episodes');
}

export function episodeMarkdownPath(projectId: string, episode: number, date: string): string {
  return join(episodesDir(projectId), `${episode}-${date}.md`);
}

export function episodeMetadataPath(projectId: string, episode: number, date: string): string {
  return join(episodesDir(projectId), `${episode}-${date}.json`);
}

/**
 * Restrictive permission bits per § 8.3 / ADR-12:
 *   - data files (events / digests / audits / state): 0o600
 *   - directories: 0o700
 */
export const FILE_MODE = 0o600;
export const DIR_MODE = 0o700;

/** Sanitise an id segment so it can't escape the observations root. */
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}
