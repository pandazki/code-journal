import { getProjectDetail, isValidId, listProjects } from "../storage";
import { errorResponse, jsonResponse, notFound } from "./common";

/** GET /api/projects — flat list of project summaries. */
export function listProjectsHandler(): Response {
  return jsonResponse(listProjects());
}

/** GET /api/projects/:id — dates and users for a single project. */
export function getProjectHandler(projectId: string): Response {
  if (!isValidId(projectId)) return errorResponse(400, "bad_field", "project_id must match [A-Za-z0-9_-]+");
  const detail = getProjectDetail(projectId);
  if (!detail) return notFound("project not found");
  return jsonResponse(detail);
}
