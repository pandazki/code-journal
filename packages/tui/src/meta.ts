/**
 * `meta.json` — the code-journal metadata sidecar that travels next to every
 * uploaded transcript. It captures what the session's own JSONL does NOT:
 * which project it belongs to, the registered cwds, the sidecar manifest, and
 * the upload provenance.
 *
 * `agent` and `transcript.filename` are deliberately free strings so future
 * agent types (and non-JSONL transcripts) stay representable without a schema
 * bump.
 */
import type { SessionRef } from '@code-journal/core';

import type { Project } from './config/config';
import { CJ_VERSION } from './version';

export const META_SCHEMA = 'meta/1';

export interface MetaSidecarFile {
  rel_path: string;
  size_bytes: number;
}

export interface Meta {
  schema: typeof META_SCHEMA;
  session_id: string;
  /** coding agent — free string ('claude-code' | 'codex' | 'cowork' | …) */
  agent: string;
  project: { id: string; name: string; cwds: string[] };
  /** the session's own working directory (best-effort, from the transcript) */
  cwd: string;
  transcript: { filename: string; size_bytes: number; mtime_ms: number };
  sidecar: { file_count: number; files: MetaSidecarFile[] };
  /** config snapshot the session recorded for itself (model / version / branch / …) */
  session_config: Record<string, string>;
  uploaded_at: string;
  uploader: { tool: string; version: string };
}

/** Build the meta for a discovered session about to be uploaded under `project`. */
export function buildMeta(project: Project, ref: SessionRef): Meta {
  return {
    schema: META_SCHEMA,
    session_id: ref.id,
    agent: ref.agent,
    project: { id: project.id, name: project.name, cwds: project.cwds },
    cwd: ref.cwd,
    transcript: {
      filename: 'transcript.jsonl',
      size_bytes: ref.sizeBytes,
      mtime_ms: Math.round(ref.mtimeMs),
    },
    sidecar: {
      file_count: ref.sidecarFiles.length,
      files: ref.sidecarFiles.map((f) => ({ rel_path: f.relPath, size_bytes: f.sizeBytes })),
    },
    session_config: ref.meta,
    uploaded_at: new Date().toISOString(),
    uploader: { tool: 'cj', version: CJ_VERSION },
  };
}
