/**
 * Upload manifest — a local record of which sessions have been pushed to S3,
 * so the browser can show an "uploaded" badge without a network round-trip.
 * The manifest is a cache, not a source of truth; a Remote-view refresh
 * reconciles it against the bucket.
 */
import type { SessionRef } from '@code-journal/core';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { uploadsPath } from './paths';

export interface UploadRecord {
  projectId: string;
  sessionId: string;
  agent: string;
  /** ISO timestamp of the most recent successful upload */
  uploadedAt: string;
  /** number of objects written (transcript + meta + sidecar files) */
  fileCount: number;
  sizeBytes: number;
  /** transcript mtime/size at upload time — the cheap change-detection signal */
  transcriptMtimeMs: number;
  transcriptSizeBytes: number;
}

/** new = never uploaded · changed = transcript moved since upload · current = up to date */
export type UploadStatusKind = 'new' | 'changed' | 'current';

export interface UploadManifest {
  version: 1;
  /** keyed by `${projectId}/${sessionId}` */
  entries: Record<string, UploadRecord>;
}

function manifestKey(projectId: string, sessionId: string): string {
  return `${projectId}/${sessionId}`;
}

export function loadManifest(): UploadManifest {
  try {
    const raw = JSON.parse(readFileSync(uploadsPath(), 'utf8')) as Partial<UploadManifest>;
    if (raw.entries && typeof raw.entries === 'object') {
      return { version: 1, entries: raw.entries as Record<string, UploadRecord> };
    }
  } catch {
    /* fall through */
  }
  return { version: 1, entries: {} };
}

export function saveManifest(manifest: UploadManifest): void {
  const path = uploadsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o644);
  } catch {
    /* best effort */
  }
}

export function isUploaded(manifest: UploadManifest, projectId: string, sessionId: string): boolean {
  return Boolean(manifest.entries[manifestKey(projectId, sessionId)]);
}

export function getUploadRecord(
  manifest: UploadManifest,
  projectId: string,
  sessionId: string,
): UploadRecord | undefined {
  return manifest.entries[manifestKey(projectId, sessionId)];
}

/** Record a successful upload and persist the manifest. Returns the updated manifest. */
export function recordUpload(manifest: UploadManifest, record: UploadRecord): UploadManifest {
  const next: UploadManifest = {
    version: 1,
    entries: { ...manifest.entries, [manifestKey(record.projectId, record.sessionId)]: record },
  };
  saveManifest(next);
  return next;
}

export function manifestFileExists(): boolean {
  return existsSync(uploadsPath());
}

/**
 * Compare a freshly-discovered session against the manifest. Claude Code (and
 * the others) only ever append to a transcript, so an mtime or size change is
 * a reliable "needs re-upload" signal without hashing the whole file.
 */
export function uploadStatus(
  manifest: UploadManifest,
  projectId: string,
  ref: SessionRef,
): UploadStatusKind {
  const rec = manifest.entries[manifestKey(projectId, ref.id)];
  if (!rec) return 'new';
  if (rec.transcriptMtimeMs !== Math.round(ref.mtimeMs) || rec.transcriptSizeBytes !== ref.sizeBytes) {
    return 'changed';
  }
  return 'current';
}
