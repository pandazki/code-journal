/**
 * Headless incremental sync — discover every project's sessions and upload the
 * ones that are new or have changed since their last upload. Drives both the
 * `cj sync` cron command and the Board's "sync now" action (via `onEvent`).
 */
import { discoverSessionsForProject } from '@code-journal/core';

import { loadConfig, loadCredentials } from './config/config';
import { recordUpload, loadManifest, uploadStatus } from './config/uploads';
import { log } from './log';
import { makeS3Client } from './s3/client';
import { type UploadProgress, uploadSession } from './s3/storage';

export interface SyncEvent {
  phase: 'discover' | 'upload' | 'done';
  project?: string;
  session?: string;
  /** 1-based position within the pending set */
  index?: number;
  total?: number;
  fileProgress?: UploadProgress;
}

export interface SyncResult {
  uploaded: number;
  failed: number;
  /** sessions already current — nothing to do */
  skipped: number;
  errors: string[];
}

export interface SyncOptions {
  /** limit to one project; omitted = every project */
  projectId?: string;
  onEvent?: (e: SyncEvent) => void;
}

/** Run an incremental upload pass. Throws only when S3 isn't configured. */
export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  const config = loadConfig();
  const credentials = loadCredentials();
  if (!config.s3 || !credentials) {
    log('error', 'sync', 'aborted — S3 is not configured');
    throw new Error('S3 is not configured');
  }
  const s3 = config.s3;
  const client = makeS3Client(s3, credentials);
  const result: SyncResult = { uploaded: 0, failed: 0, skipped: 0, errors: [] };
  let manifest = loadManifest();

  const projects = opts.projectId
    ? config.projects.filter((p) => p.id === opts.projectId)
    : config.projects;

  for (const project of projects) {
    opts.onEvent?.({ phase: 'discover', project: project.id });
    const refs = discoverSessionsForProject(project.cwds);
    const pending = refs.filter((r) => uploadStatus(manifest, project.id, r) !== 'current');
    result.skipped += refs.length - pending.length;
    log('info', 'sync', `${project.id}: ${refs.length} sessions, ${pending.length} to upload`);

    let i = 0;
    for (const ref of pending) {
      i += 1;
      opts.onEvent?.({ phase: 'upload', project: project.id, session: ref.id, index: i, total: pending.length });
      try {
        const outcome = await uploadSession(client, s3, project, ref, (fileProgress) => {
          opts.onEvent?.({
            phase: 'upload',
            project: project.id,
            session: ref.id,
            index: i,
            total: pending.length,
            fileProgress,
          });
        });
        manifest = recordUpload(manifest, {
          projectId: project.id,
          sessionId: ref.id,
          agent: ref.agent,
          uploadedAt: new Date().toISOString(),
          fileCount: outcome.fileCount,
          sizeBytes: outcome.sizeBytes,
          transcriptMtimeMs: Math.round(ref.mtimeMs),
          transcriptSizeBytes: ref.sizeBytes,
        });
        result.uploaded += 1;
        log('info', 'sync', `uploaded ${project.id}/${ref.id} (${outcome.fileCount} files)`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        result.failed += 1;
        result.errors.push(`${project.id}/${ref.id}: ${msg}`);
        log('error', 'sync', `failed ${project.id}/${ref.id}: ${msg}`);
      }
    }
  }

  opts.onEvent?.({ phase: 'done' });
  log(
    result.failed > 0 ? 'warn' : 'info',
    'sync',
    `done — ${result.uploaded} uploaded, ${result.failed} failed, ${result.skipped} up-to-date`,
  );
  return result;
}
