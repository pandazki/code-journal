import { jsonResponse } from "./common";

const STARTED_AT = new Date();

export function healthHandler(): Response {
  return jsonResponse({
    status: "ok",
    uptime_ms: Date.now() - STARTED_AT.getTime(),
    started_at: STARTED_AT.toISOString(),
  });
}
