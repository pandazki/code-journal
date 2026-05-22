// Raw work-log entry upload + browse endpoints.
//
//   POST /api/projects/:id/worklog/:entryId
//   GET  /api/projects/:id/worklog
//   GET  /api/projects/:id/worklog/:entryId
//
// The POST body is the raw entry `.md` content (JSON frontmatter between
// `---` `---`, then markdown body — stored verbatim). Re-POSTing the same
// (project_id, entry_id) overwrites.

import {
  getWorklogEntryContent,
  isValidId,
  isValidSubId,
  listWorklogEntries,
  storeWorklogEntry,
} from "../storage";
import { errorResponse, jsonResponse, markdownResponse, notFound } from "./common";

/** POST /api/projects/:id/worklog/:entryId — store raw entry markdown. */
export async function postWorklogHandler(
  req: Request,
  projectId: string,
  entryId: string,
): Promise<Response> {
  if (!isValidId(projectId)) {
    return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  }
  if (!isValidSubId(entryId)) {
    return errorResponse(
      400,
      "bad_field",
      "entry_id must match [A-Za-z0-9._:-]+ and contain no '/' or '..'",
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

  const receivedTs = new Date().toISOString();
  const stored = storeWorklogEntry(projectId, entryId, content, receivedTs);

  return jsonResponse({
    status: "ok",
    entry_id: entryId,
    stored_at: stored.storedAt,
    overwritten: stored.overwritten,
  });
}

/** GET /api/projects/:id/worklog — list stored work-log entries. */
export function listWorklogHandler(projectId: string): Response {
  if (!isValidId(projectId)) {
    return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  }
  return jsonResponse(listWorklogEntries(projectId));
}

/** GET /api/projects/:id/worklog/:entryId — raw `.md` content as text/markdown. */
export function getWorklogHandler(projectId: string, entryId: string): Response {
  if (!isValidId(projectId)) {
    return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  }
  if (!isValidSubId(entryId)) {
    return errorResponse(
      400,
      "bad_field",
      "entry_id must match [A-Za-z0-9._:-]+ and contain no '/' or '..'",
    );
  }
  const content = getWorklogEntryContent(projectId, entryId);
  if (content === null) return notFound("worklog entry not found");
  return markdownResponse(content);
}
