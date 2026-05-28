/**
 * ProjectState persistence — `~/.code-journal/observations/<pid>/state.json`.
 *
 * Atomic via temp-file + rename. File mode 0o600.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { DIR_MODE, FILE_MODE, projectRoot, stateFilePath } from './paths';
import {
  newProjectState,
  parseProjectState,
  serializeProjectState,
  type ProjectState,
} from './schema';

/**
 * Read project state, returning `newProjectState(...)` defaults if no
 * state.json exists yet.
 */
export function readProjectState(projectId: string, displayName: string): ProjectState {
  const path = stateFilePath(projectId);
  if (!existsSync(path)) return newProjectState(projectId, displayName);
  try {
    return parseProjectState(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    // Malformed — start fresh; the user will see a fresh-feeling project,
    // but signal store is the source of truth so we don't lose events.
    return newProjectState(projectId, displayName);
  }
}

/** Atomically write project state. */
export function writeProjectState(state: ProjectState): void {
  const path = stateFilePath(state.project_id);
  ensureProjectDir(state.project_id);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(serializeProjectState(state), null, 2) + '\n');
  try {
    chmodSync(tmp, FILE_MODE);
  } catch {
    /* ignore */
  }
  renameSync(tmp, path);
}

function ensureProjectDir(projectId: string): void {
  const dir = projectRoot(projectId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try {
      chmodSync(dir, DIR_MODE);
    } catch {
      /* ignore */
    }
  }
}
