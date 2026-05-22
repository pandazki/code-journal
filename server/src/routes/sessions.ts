// Raw-session upload + browse endpoints.
//
//   POST /api/projects/:id/sessions/:sessionId?agent=<a>&cwd=<c>
//   GET  /api/projects/:id/sessions
//   GET  /api/projects/:id/sessions/:sessionId
//   POST /api/projects/:id/sessions/:sessionId/files?path=<relPath>
//   GET  /api/projects/:id/sessions/:sessionId/files
//   GET  /api/projects/:id/sessions/:sessionId/files?path=<relPath>
//
// The POST body is the raw session file content (text/JSONL — stored verbatim,
// never JSON.parse'd). Re-POSTing the same (project_id, session_id) overwrites.
//
// The /files endpoints carry a session's sidecar dir — Claude Code's subagent
// transcripts (subagents/agent-*.jsonl) and spilled tool outputs
// (tool-results/*) — file-by-file, each addressed by its path relative to that
// dir via the `path` query param.

import {
  getSessionContent,
  getSessionFileContent,
  isValidId,
  isValidSubId,
  listSessionFiles,
  listSessions,
  storeSession,
  storeSessionFile,
} from "../storage";
import { errorResponse, jsonResponse, notFound } from "./common";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS },
  });
}

/** POST /api/projects/:id/sessions/:sessionId — store raw session content. */
export async function postSessionHandler(
  req: Request,
  projectId: string,
  sessionId: string,
  query: URLSearchParams,
): Promise<Response> {
  if (!isValidId(projectId)) {
    return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  }
  if (!isValidSubId(sessionId)) {
    return errorResponse(
      400,
      "bad_field",
      "session_id must match [A-Za-z0-9._:-]+ and contain no '/' or '..'",
    );
  }

  let content: string;
  try {
    content = await req.text();
  } catch {
    return errorResponse(400, "bad_field", "could not read request body");
  }
  if (content.length === 0) {
    return errorResponse(400, "bad_field", "request body must not be empty");
  }

  const agent = query.get("agent") || "unknown";
  const cwd = query.get("cwd") || "";
  // any other query params are the session's config snapshot (model / version / git branch / …)
  const config: Record<string, string> = {};
  for (const [k, v] of query.entries()) {
    if (k !== "agent" && k !== "cwd" && v) config[k] = v;
  }
  const receivedTs = new Date().toISOString();
  const stored = storeSession(projectId, sessionId, content, { agent, cwd, receivedTs, config });

  return jsonResponse({
    status: "ok",
    session_id: sessionId,
    stored_at: stored.storedAt,
    overwritten: stored.overwritten,
  });
}

/** GET /api/projects/:id/sessions — list stored sessions. */
export function listSessionsHandler(projectId: string): Response {
  if (!isValidId(projectId)) {
    return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  }
  return jsonResponse(listSessions(projectId));
}

/** GET /api/projects/:id/sessions/:sessionId — raw session content as text/plain. */
export function getSessionHandler(projectId: string, sessionId: string): Response {
  if (!isValidId(projectId)) {
    return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  }
  if (!isValidSubId(sessionId)) {
    return errorResponse(
      400,
      "bad_field",
      "session_id must match [A-Za-z0-9._:-]+ and contain no '/' or '..'",
    );
  }
  const content = getSessionContent(projectId, sessionId);
  if (content === null) return notFound("session not found");
  return textResponse(content);
}

const BAD_PROJECT = "project_id must match [A-Za-z0-9_-]+";
const BAD_SESSION = "session_id must match [A-Za-z0-9._:-]+ and contain no '/' or '..'";

/** POST /api/projects/:id/sessions/:sessionId/files?path=<relPath> — store one sidecar file. */
export async function postSessionFileHandler(
  req: Request,
  projectId: string,
  sessionId: string,
  query: URLSearchParams,
): Promise<Response> {
  if (!isValidId(projectId)) return errorResponse(400, "bad_field", BAD_PROJECT);
  if (!isValidSubId(sessionId)) return errorResponse(400, "bad_field", BAD_SESSION);

  const relPath = query.get("path") || "";
  let content: string;
  try {
    content = await req.text();
  } catch {
    return errorResponse(400, "bad_field", "could not read request body");
  }
  if (content.length === 0) {
    return errorResponse(400, "bad_field", "request body must not be empty");
  }

  const stored = storeSessionFile(projectId, sessionId, relPath, content);
  if (stored === null) {
    return errorResponse(
      400,
      "bad_field",
      "path must be a repo-safe relative path (no '..', no leading '/')",
    );
  }
  return jsonResponse({
    status: "ok",
    session_id: sessionId,
    path: relPath,
    stored_at: stored.storedAt,
    overwritten: stored.overwritten,
  });
}

/**
 * GET /api/projects/:id/sessions/:sessionId/files — list sidecar files (no `path`),
 * or return one file's raw content as text/plain (with `?path=<relPath>`).
 */
export function getSessionFilesHandler(
  projectId: string,
  sessionId: string,
  query: URLSearchParams,
): Response {
  if (!isValidId(projectId)) return errorResponse(400, "bad_field", BAD_PROJECT);
  if (!isValidSubId(sessionId)) return errorResponse(400, "bad_field", BAD_SESSION);

  const relPath = query.get("path");
  if (relPath === null) {
    return jsonResponse(listSessionFiles(projectId, sessionId));
  }
  const content = getSessionFileContent(projectId, sessionId, relPath);
  if (content === null) return notFound("session file not found");
  return textResponse(content);
}
