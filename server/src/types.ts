// Shared TypeScript types mirroring the contract documented in README.md.
// Keep these in sync with claude-plugin/code_journal/submitters.py.

export interface ReportPayload {
  filename: string;
  content: string;
  format: string;
  source_entry_ids: string[];
  language?: string | null;
}

/**
 * Trimmed source-entry record shipped alongside a report.
 *
 * Backstop for the evidence chain: the rendered markdown is what humans
 * read, but it can render thinking sparsely. The structured fields below
 * preserve the thinking-relevant entry data so it survives even when the
 * report itself is artifact-heavy.
 *
 * Required fields are always populated by the index. Everything else is
 * conditional — present only when the underlying entry has it, never
 * synthesized. Anti-fabrication: the client only forwards what entries
 * actually carry.
 */
export interface SourceEntry {
  id: string;
  kind: string;
  summary: string;
  work_started_at?: string;
  work_ended_at?: string;
  refs?: Record<string, unknown>;
  tags?: string[];
  motivation?: string;
  approach?: string;
  attempts?: string[];
  lessons?: string[];
  decisions?: string[];
  next_steps?: string[];
  blockers?: string[];
}

export interface SubmitRequestBody {
  project_id: string;
  date_range: string;
  report: ReportPayload;
  /** Optional. Older clients (and remote types that don't care) may omit this. */
  source_entries?: SourceEntry[];
  payload_sha256: string;
  payload_size_bytes: number;
  client_ts: string;
}

export interface ReportMetaSidecar {
  client_ts: string;
  received_ts: string;
  format: string;
  language: string | null;
  payload_sha256: string;
  payload_size_bytes: number;
  source_entry_ids: string[];
  filename: string;
  project_id: string;
  date_range: string;
  /** Slug-safe user id ([A-Za-z0-9_-]+) — also the .md filename's basename. */
  username: string;
  /**
   * Free-form display name for UI rendering. Optional because legacy sidecars
   * predate this field. When absent, consumers should fall back to `username`.
   */
  display_name?: string;
}

export interface SubmitOkResponse {
  status: "ok";
  stored_at: string;
  /** Slug-safe user id under which the report was filed. */
  username: string;
  /** Display name stamped into the sidecar. Omitted when host didn't supply one. */
  display_name?: string;
  received_ts: string;
  overwritten: boolean;
}

export interface ErrorResponse {
  status: "error";
  error: string;
  message: string;
}
