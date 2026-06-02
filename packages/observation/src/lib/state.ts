/**
 * ProjectState persistence — `~/.code-journal/observations/<pid>/state.json`.
 *
 * Atomic via temp-file + rename. File mode 0o600.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { projectConfig } from '@code-journal/core';

import { DIR_MODE, FILE_MODE, projectRoot, stateFilePath } from './paths';
import {
  newProjectState,
  parseProjectState,
  serializeProjectState,
  type ProjectState,
} from './schema';

/**
 * Overlay the unified Project registry config (the single per-Project config
 * home — see core/projects.ts) onto the observation state's own config. The
 * registry wins for the user-facing shared fields (model, compose threshold,
 * language); state.json keeps observation-internal bookkeeping (cursors,
 * episodes, lens versions) and the auto-detected language when nothing is
 * pinned. So Settings written anywhere land in one place and both products agree.
 */
function overlayRegistryConfig(state: ProjectState): ProjectState {
  const c = projectConfig(state.project_id);
  if (c.model === 'sonnet' || c.model === 'opus') state.config.model = c.model;
  if (typeof c.composeThreshold === 'number' && c.composeThreshold > 0) {
    state.config.compose_threshold = Math.floor(c.composeThreshold);
  }
  if (typeof c.language === 'string' && c.language) {
    // a pinned language overrides + disables auto-detection
    state.config.analysis_language = c.language;
    state.config.analysis_language_auto = false;
  } else if (c.languageAuto === true) {
    state.config.analysis_language_auto = true;
  }
  return state;
}

/**
 * Read project state, returning `newProjectState(...)` defaults if no
 * state.json exists yet. The unified registry config is overlaid on top.
 */
export function readProjectState(projectId: string, displayName: string): ProjectState {
  const path = stateFilePath(projectId);
  let state: ProjectState;
  if (!existsSync(path)) {
    state = newProjectState(projectId, displayName);
  } else {
    try {
      state = parseProjectState(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      // Malformed — start fresh; the user will see a fresh-feeling project,
      // but signal store is the source of truth so we don't lose events.
      state = newProjectState(projectId, displayName);
    }
  }
  return overlayRegistryConfig(state);
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
