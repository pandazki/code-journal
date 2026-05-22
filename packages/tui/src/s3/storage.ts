/**
 * Session storage against an S3-compatible bucket.
 *
 * Each session is one self-contained folder (see client.ts for the layout):
 *   <prefix>/sessions/<projectId>/<sessionId>/transcript.jsonl
 *   <prefix>/sessions/<projectId>/<sessionId>/meta.json
 *   <prefix>/sessions/<projectId>/<sessionId>/<relPath>   (sidecar files)
 *
 * meta.json is written last — its presence marks a complete upload.
 */
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';

import type { Project, S3Settings } from '../config/config';
import { buildMeta } from '../meta';
import { joinKey, projectPrefix, sessionPrefix, sidecarKey, transcriptKey, metaKey } from './client';
import type { SessionRef } from '@code-journal/core';

export interface UploadProgress {
  label: string;
  done: number;
  total: number;
}

export interface UploadOutcome {
  fileCount: number;
  sizeBytes: number;
}

export interface RemoteSession {
  sessionId: string;
  sizeBytes: number;
  /** epoch ms of the transcript object's LastModified */
  lastModified: number;
  sidecarCount: number;
  hasMeta: boolean;
}

const RESERVED = new Set(['transcript.jsonl', 'meta.json']);

function contentTypeFor(path: string): string {
  if (path.endsWith('.jsonl')) return 'application/x-ndjson';
  if (path.endsWith('.json')) return 'application/json';
  return 'text/plain; charset=utf-8';
}

/** Verify the bucket is reachable, credentials work, and it's listable. */
export async function testConnection(client: S3Client, s3: S3Settings): Promise<void> {
  await client.send(
    new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: joinKey(s3.prefix), MaxKeys: 1 }),
  );
}

/** Upload one discovered session as a folder — transcript, sidecar files, then meta. */
export async function uploadSession(
  client: S3Client,
  s3: S3Settings,
  project: Project,
  ref: SessionRef,
  onProgress: (p: UploadProgress) => void,
): Promise<UploadOutcome> {
  const sidecar = ref.sidecarFiles.filter((f) => f.sizeBytes > 0);
  const total = 2 + sidecar.length; // transcript + sidecar files + meta
  let done = 0;
  let sizeBytes = 0;

  const put = async (key: string, body: Buffer | string, label: string): Promise<void> => {
    onProgress({ label, done, total });
    await client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentTypeFor(key),
      }),
    );
    sizeBytes += Buffer.byteLength(body);
    done += 1;
  };

  await put(transcriptKey(s3, project.id, ref.id), readFileSync(ref.path), 'transcript.jsonl');
  for (const f of sidecar) {
    await put(sidecarKey(s3, project.id, ref.id, f.relPath), readFileSync(f.absPath), f.relPath);
  }
  // meta last — its presence is the "upload complete" marker.
  const meta = buildMeta(project, ref);
  await put(metaKey(s3, project.id, ref.id), JSON.stringify(meta, null, 2) + '\n', 'meta.json');

  onProgress({ label: 'done', done, total });
  return { fileCount: total, sizeBytes };
}

/** List every session folder already uploaded for a project, from one paginated sweep. */
export async function listRemoteSessions(
  client: S3Client,
  s3: S3Settings,
  projectId: string,
): Promise<RemoteSession[]> {
  const prefix = projectPrefix(s3, projectId);
  const byId = new Map<string, RemoteSession & { hasTranscript: boolean }>();
  const ensure = (id: string): RemoteSession & { hasTranscript: boolean } => {
    let r = byId.get(id);
    if (!r) {
      r = { sessionId: id, sizeBytes: 0, lastModified: 0, sidecarCount: 0, hasMeta: false, hasTranscript: false };
      byId.set(id, r);
    }
    return r;
  };

  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of page.Contents ?? []) {
      const key = obj.Key;
      if (!key || !key.startsWith(prefix)) continue;
      const m = /^([^/]+)\/(.+)$/.exec(key.slice(prefix.length));
      if (!m) continue;
      const [, sid, tail] = m as unknown as [string, string, string];
      const r = ensure(sid);
      if (tail === 'transcript.jsonl') {
        r.hasTranscript = true;
        r.sizeBytes = obj.Size ?? 0;
        r.lastModified = obj.LastModified ? obj.LastModified.getTime() : 0;
      } else if (tail === 'meta.json') {
        r.hasMeta = true;
      } else {
        r.sidecarCount += 1;
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return [...byId.values()]
    .filter((r) => r.hasTranscript)
    .map(({ hasTranscript: _drop, ...rest }) => rest)
    .sort((a, b) => b.lastModified - a.lastModified);
}

async function getText(client: S3Client, bucket: string, key: string): Promise<string> {
  const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!r.Body) return '';
  return (r.Body as { transformToString: () => Promise<string> }).transformToString();
}

/** Fetch a remote transcript's raw content. */
export function getRemoteTranscript(
  client: S3Client,
  s3: S3Settings,
  projectId: string,
  sessionId: string,
): Promise<string> {
  return getText(client, s3.bucket, transcriptKey(s3, projectId, sessionId));
}

/** Fetch + parse a remote session's meta.json; null when absent / unreadable. */
export async function getRemoteMeta(
  client: S3Client,
  s3: S3Settings,
  projectId: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await getText(client, s3.bucket, metaKey(s3, projectId, sessionId))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** List a remote session's sidecar files (relative paths; transcript + meta excluded). */
export async function listRemoteSidecar(
  client: S3Client,
  s3: S3Settings,
  projectId: string,
  sessionId: string,
): Promise<string[]> {
  const prefix = sessionPrefix(s3, projectId, sessionId);
  const out: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || !obj.Key.startsWith(prefix)) continue;
      const rel = obj.Key.slice(prefix.length);
      if (rel && !RESERVED.has(rel)) out.push(rel);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out.sort();
}

/** Fetch one remote sidecar file's content. */
export function getRemoteSidecar(
  client: S3Client,
  s3: S3Settings,
  projectId: string,
  sessionId: string,
  relPath: string,
): Promise<string> {
  return getText(client, s3.bucket, sidecarKey(s3, projectId, sessionId, relPath));
}
