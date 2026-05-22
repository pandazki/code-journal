/** S3-compatible client construction + object-key layout. */
import { S3Client } from '@aws-sdk/client-s3';

import type { Credentials, S3Settings } from '../config/config';

/**
 * Reduce an endpoint to scheme + host (+ port) — an S3 endpoint must not carry
 * a path. Cloudflare R2's dashboard hands out a per-bucket URL ending in
 * `/<bucket>`; pasting that whole thing would address `/<bucket>/<bucket>/<key>`
 * under path-style, so any path component is stripped here.
 */
export function normalizeEndpoint(raw: string): string {
  const e = raw.trim();
  if (!e) return '';
  try {
    const u = new URL(e.includes('://') ? e : `https://${e}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return e;
  }
}

/**
 * Build an S3 client for any S3-compatible store (AWS S3, MinIO, Cloudflare R2,
 * Backblaze B2, …). `forcePathStyle` is required by MinIO and most non-AWS
 * stores; AWS itself works either way.
 */
export function makeS3Client(s3: S3Settings, creds: Credentials): S3Client {
  const endpoint = normalizeEndpoint(s3.endpoint);
  return new S3Client({
    region: s3.region.trim() || 'us-east-1',
    endpoint: endpoint || undefined,
    forcePathStyle: s3.forcePathStyle,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
    // Recent AWS SDKs add CRC checksums to every request by default; several
    // S3-compatible stores (R2, MinIO, B2) reject the unexpected headers.
    // Only send a checksum when the operation actually requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Join key segments, trimming stray slashes; empty segments drop out. */
export function joinKey(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length > 0)
    .join('/');
}

// Object layout — one self-contained folder per session:
//   <prefix>/sessions/<projectId>/<sessionId>/transcript.jsonl
//   <prefix>/sessions/<projectId>/<sessionId>/meta.json
//   <prefix>/sessions/<projectId>/<sessionId>/subagents/… , tool-results/… (sidecar)
// Nothing here is agent-specific — the transcript is always transcript.jsonl,
// so Claude Code / Codex / Cowork / future agents all share the layout.

/** `<prefix>/sessions/<projectId>/` — the listing prefix for a project. */
export function projectPrefix(s3: S3Settings, projectId: string): string {
  return joinKey(s3.prefix, 'sessions', projectId) + '/';
}

/** `<prefix>/sessions/<projectId>/<sessionId>/` — one session's folder. */
export function sessionPrefix(s3: S3Settings, projectId: string, sessionId: string): string {
  return joinKey(s3.prefix, 'sessions', projectId, sessionId) + '/';
}

export function transcriptKey(s3: S3Settings, projectId: string, sessionId: string): string {
  return joinKey(s3.prefix, 'sessions', projectId, sessionId, 'transcript.jsonl');
}

export function metaKey(s3: S3Settings, projectId: string, sessionId: string): string {
  return joinKey(s3.prefix, 'sessions', projectId, sessionId, 'meta.json');
}

export function sidecarKey(
  s3: S3Settings,
  projectId: string,
  sessionId: string,
  relPath: string,
): string {
  return joinKey(s3.prefix, 'sessions', projectId, sessionId, relPath);
}
