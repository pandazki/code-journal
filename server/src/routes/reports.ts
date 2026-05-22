import { runtimeConfig } from "../runtime-config";
import {
  getReport,
  getReportContent,
  getReportSourceEntries,
  isValidDate,
  isValidId,
  listProjectDateUsers,
  storeReport,
} from "../storage";
import type { SourceEntry, SubmitOkResponse, SubmitRequestBody } from "../types";
import { errorResponse, jsonResponse, markdownResponse, notFound } from "./common";

const REQUIRED_TOP = ["project_id", "date_range", "report", "payload_sha256", "payload_size_bytes", "client_ts"] as const;
const REQUIRED_REPORT = ["filename", "content", "format", "source_entry_ids"] as const;

function validateBody(raw: unknown): { ok: true; body: SubmitRequestBody } | { ok: false; error: string; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "bad_field", message: "request body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  for (const k of REQUIRED_TOP) {
    if (!(k in obj)) return { ok: false, error: "missing_field", message: `missing field: ${k}` };
  }
  if (typeof obj.project_id !== "string" || !isValidId(obj.project_id)) {
    return { ok: false, error: "bad_field", message: "project_id must match [A-Za-z0-9_-]+" };
  }
  if (typeof obj.date_range !== "string" || !isValidDate(obj.date_range)) {
    return { ok: false, error: "bad_field", message: "date_range must be YYYY-MM-DD" };
  }
  if (typeof obj.payload_sha256 !== "string" || obj.payload_sha256.length === 0) {
    return { ok: false, error: "bad_field", message: "payload_sha256 must be a non-empty string" };
  }
  if (typeof obj.payload_size_bytes !== "number" || !Number.isFinite(obj.payload_size_bytes) || obj.payload_size_bytes < 0) {
    return { ok: false, error: "bad_field", message: "payload_size_bytes must be a non-negative number" };
  }
  if (typeof obj.client_ts !== "string" || obj.client_ts.length === 0) {
    return { ok: false, error: "bad_field", message: "client_ts must be a non-empty string" };
  }
  const report = obj.report;
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { ok: false, error: "bad_field", message: "report must be an object" };
  }
  const r = report as Record<string, unknown>;
  for (const k of REQUIRED_REPORT) {
    if (!(k in r)) return { ok: false, error: "missing_field", message: `missing report.${k}` };
  }
  if (typeof r.filename !== "string" || r.filename.length === 0 || r.filename.includes("/") || r.filename.includes("..")) {
    return { ok: false, error: "bad_field", message: "report.filename must be a simple filename" };
  }
  if (typeof r.content !== "string") {
    return { ok: false, error: "bad_field", message: "report.content must be a string" };
  }
  if (typeof r.format !== "string" || r.format.length === 0) {
    return { ok: false, error: "bad_field", message: "report.format must be a non-empty string" };
  }
  if (!Array.isArray(r.source_entry_ids) || !r.source_entry_ids.every((s) => typeof s === "string")) {
    return { ok: false, error: "bad_field", message: "report.source_entry_ids must be string[]" };
  }
  if (r.language !== undefined && r.language !== null && typeof r.language !== "string") {
    return { ok: false, error: "bad_field", message: "report.language must be a string or null" };
  }
  // source_entries is optional. When present it MUST be an array of objects;
  // each object must carry id/kind/summary as strings. Conditional thinking
  // fields (motivation/approach/attempts/lessons/decisions/next_steps/refs/
  // tags/work_*) are accepted as-is — we don't enforce a tight shape here so
  // future schema additions don't require server changes.
  if (obj.source_entries !== undefined) {
    if (!Array.isArray(obj.source_entries)) {
      return { ok: false, error: "bad_field", message: "source_entries must be an array" };
    }
    for (const e of obj.source_entries) {
      if (!e || typeof e !== "object" || Array.isArray(e)) {
        return { ok: false, error: "bad_field", message: "source_entries[i] must be an object" };
      }
      const rec = e as Record<string, unknown>;
      for (const k of ["id", "kind", "summary"] as const) {
        if (typeof rec[k] !== "string" || (rec[k] as string).length === 0) {
          return { ok: false, error: "bad_field", message: `source_entries[i].${k} must be a non-empty string` };
        }
      }
    }
  }
  return { ok: true, body: obj as unknown as SubmitRequestBody };
}

/** POST /api/reports — accepts a submission, writes filesystem, returns receipt. */
export async function postReportsHandler(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "invalid_json", "request body is not valid JSON");
  }
  const v = validateBody(raw);
  if (!v.ok) return errorResponse(400, v.error, v.message);

  const body = v.body;
  const cfg = runtimeConfig();
  const username = cfg.getUsername();
  const displayName = cfg.getDisplayName();
  // Defensive: reject if the host wired a non-slug username through getUsername.
  // This is the boundary that previously let "Brian Lee" land as a filename and
  // then become invisible to every read path. Failing loudly here surfaces the
  // misconfiguration instead of swallowing reports.
  if (!isValidId(username)) {
    return errorResponse(
      500,
      "bad_runtime_config",
      `getUsername() returned ${JSON.stringify(username)}, which is not a valid slug ([A-Za-z0-9_-]+)`,
    );
  }
  const receivedTs = new Date().toISOString();
  const stored = storeReport({
    projectId: body.project_id,
    dateRange: body.date_range,
    username,
    displayName,
    report: body.report,
    sourceEntries: body.source_entries,
    payloadSha256: body.payload_sha256,
    payloadSizeBytes: body.payload_size_bytes,
    clientTs: body.client_ts,
    receivedTs,
  });

  const resp: SubmitOkResponse = {
    status: "ok",
    stored_at: stored.storedAt,
    username,
    display_name: displayName,
    received_ts: receivedTs,
    overwritten: stored.overwritten,
  };
  return jsonResponse(resp);
}

/** GET /api/projects/:id/dates/:date — list users who submitted on that date. */
export function listProjectDateHandler(projectId: string, date: string): Response {
  if (!isValidId(projectId)) return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  if (!isValidDate(date)) return errorResponse(400, "bad_field", "date must be YYYY-MM-DD");
  const list = listProjectDateUsers(projectId, date);
  if (list === null) return notFound("project/date not found");
  return jsonResponse(list);
}

/** GET /api/projects/:id/dates/:date/users/:username — { meta, content }. */
export function getReportHandler(projectId: string, date: string, username: string): Response {
  if (!isValidId(projectId)) return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  if (!isValidDate(date)) return errorResponse(400, "bad_field", "date must be YYYY-MM-DD");
  if (!isValidId(username)) return errorResponse(400, "bad_field", "username must match [A-Za-z0-9_-]+");
  const r = getReport(projectId, date, username);
  if (!r) return notFound("report not found");
  return jsonResponse(r);
}

/** GET /api/projects/:id/dates/:date/users/:username/content — raw markdown body. */
export function getReportContentHandler(projectId: string, date: string, username: string): Response {
  if (!isValidId(projectId)) return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  if (!isValidDate(date)) return errorResponse(400, "bad_field", "date must be YYYY-MM-DD");
  if (!isValidId(username)) return errorResponse(400, "bad_field", "username must match [A-Za-z0-9_-]+");
  const c = getReportContent(projectId, date, username);
  if (c === null) return notFound("report not found");
  return markdownResponse(c);
}

/**
 * GET /api/projects/:id/dates/:date/users/:username/entries — sidecar source-entries.
 *
 * Returns the structured thinking-relevant fields of the entries that backed
 * the rendered report. Returns `[]` when the report has no sidecar (e.g.
 * submitted before the wire field landed, or by a client that omits it).
 */
export function getReportEntriesHandler(projectId: string, date: string, username: string): Response {
  if (!isValidId(projectId)) return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  if (!isValidDate(date)) return errorResponse(400, "bad_field", "date must be YYYY-MM-DD");
  if (!isValidId(username)) return errorResponse(400, "bad_field", "username must match [A-Za-z0-9_-]+");
  const entries: SourceEntry[] = getReportSourceEntries(projectId, date, username);
  return jsonResponse(entries);
}
