import {
  getUserDetail,
  isValidDate,
  isValidId,
  listUsers,
  listUserDateProjects,
} from "../storage";
import { errorResponse, jsonResponse, notFound } from "./common";

/** GET /api/users — flat list of user summaries. */
export function listUsersHandler(): Response {
  return jsonResponse(listUsers());
}

/** GET /api/users/:username — projects + dates the user has submitted to. */
export function getUserHandler(username: string): Response {
  if (!isValidId(username)) return errorResponse(400, "bad_field", "username must match [A-Za-z0-9_-]+");
  const detail = getUserDetail(username);
  if (!detail) return notFound("user not found");
  return jsonResponse(detail);
}

/** GET /api/users/:username/dates/:date — per-project entries on a given date. */
export function listUserDateHandler(username: string, date: string): Response {
  if (!isValidId(username)) return errorResponse(400, "bad_field", "username must match [A-Za-z0-9_-]+");
  if (!isValidDate(date)) return errorResponse(400, "bad_field", "date must be YYYY-MM-DD");
  const list = listUserDateProjects(username, date);
  if (list === null) return notFound("user/date not found");
  return jsonResponse(list);
}
