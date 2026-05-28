/**
 * Signal store — append-only JSONL events per (project, lens).
 *
 * Hard rules:
 *   - APPEND ONLY. No event payload is ever rewritten.
 *   - Dedup by `id` on append (so a re-scan of the same session under the
 *     same `lens_version` is a no-op).
 *   - Fate updates are appended via `addFateUpdate` which rewrites the
 *     event ID's line in-place — this is the ONE allowed mutation, and
 *     only to the fate sub-stream.
 *   - File permissions 0o600 (data files), dir 0o700.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';

import {
  DIR_MODE,
  FILE_MODE,
  signalFilePath,
  signalsDir,
} from './paths';
import {
  LENS_IDS,
  type FateUpdate,
  type LensId,
  type ObservationEvent,
  parseObservationEvent,
  serializeFateUpdate,
  serializeObservationEvent,
} from './schema';

/**
 * Read every event for one project + lens. Order is append-order
 * (chronological detection order, NOT event timespan order).
 */
export function readSignals(projectId: string, lensId: LensId): ObservationEvent[] {
  const path = signalFilePath(projectId, lensId);
  if (!existsSync(path)) return [];
  const out: ObservationEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      out.push(parseObservationEvent(JSON.parse(line)));
    } catch {
      // skip malformed lines — should not happen in practice
    }
  }
  return out;
}

/** Read every event across both lenses for one project. */
export function readAllSignals(projectId: string): ObservationEvent[] {
  return LENS_IDS.flatMap((lens) => readSignals(projectId, lens));
}

/**
 * Append events. Dedupes against existing ids — re-scans become no-ops.
 * Returns `{ appended, skipped }` counts.
 */
export function appendSignals(
  projectId: string,
  lensId: LensId,
  events: readonly ObservationEvent[],
): { appended: number; skipped: number } {
  ensureSignalsDir(projectId);
  const existing = new Set(readSignals(projectId, lensId).map((e) => e.id));
  let appended = 0;
  let skipped = 0;
  const lines: string[] = [];
  for (const ev of events) {
    if (existing.has(ev.id)) {
      skipped += 1;
      continue;
    }
    existing.add(ev.id);
    lines.push(JSON.stringify(serializeObservationEvent(ev)));
    appended += 1;
  }
  if (appended === 0) return { appended, skipped };

  const path = signalFilePath(projectId, lensId);
  const prefix = existsSync(path) ? '' : '';
  // Use append mode by reading-then-writing (small files; volume tiny):
  // for very large stores this should switch to fs.appendFileSync.
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const sep = prev.length > 0 && !prev.endsWith('\n') ? '\n' : '';
  const next = prev + sep + lines.join('\n') + '\n';
  writeFileSync(path, next);
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    // tolerate filesystems that don't support chmod (e.g. some FAT mounts)
  }
  return { appended, skipped };
}

/**
 * Append a fate update to a specific event. This is the only mutation
 * allowed on existing events — and it mutates only the `fate` sub-stream,
 * never the payload. Atomic write via temp file + rename.
 */
export function addFateUpdate(
  projectId: string,
  lensId: LensId,
  eventId: string,
  fate: FateUpdate,
): { ok: boolean; reason?: string } {
  const path = signalFilePath(projectId, lensId);
  if (!existsSync(path)) return { ok: false, reason: 'signal file missing' };
  const lines = readFileSync(path, 'utf8').split('\n');
  let touched = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    let event: ObservationEvent;
    try {
      event = parseObservationEvent(JSON.parse(line));
    } catch {
      continue;
    }
    if (event.id !== eventId) continue;
    event.fate.push(fate);
    lines[i] = JSON.stringify(serializeObservationEvent(event));
    touched = true;
    break;
  }
  if (!touched) return { ok: false, reason: 'event id not found' };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, lines.join('\n'));
  try {
    chmodSync(tmp, FILE_MODE);
  } catch {
    /* ignore */
  }
  renameSync(tmp, path);
  return { ok: true };
}

function ensureSignalsDir(projectId: string): void {
  const dir = signalsDir(projectId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try {
      chmodSync(dir, DIR_MODE);
    } catch {
      /* ignore */
    }
  }
}
