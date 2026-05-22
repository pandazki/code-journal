// Request handler for the code-journal preview server. Wires routes; transport
// is bridged by http-adapter.ts (Bun.serve in the original — node:http here).
// No auth — the server is embedded in the desktop app and reachable only on
// loopback. Username for stored reports comes from runtimeConfig().getUsername().

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

import { runtimeConfig } from "./runtime-config";
import { healthHandler } from "./routes/health";
import { errorResponse } from "./routes/common";
import { getProjectHandler, listProjectsHandler } from "./routes/projects";
import {
  getReportContentHandler,
  getReportEntriesHandler,
  getReportHandler,
  listProjectDateHandler,
  postReportsHandler,
} from "./routes/reports";
import { getUserHandler, listUserDateHandler, listUsersHandler } from "./routes/users";
import {
  getSessionFilesHandler,
  getSessionHandler,
  listSessionsHandler,
  postSessionFileHandler,
  postSessionHandler,
} from "./routes/sessions";
import {
  getWorklogHandler,
  listWorklogHandler,
  postWorklogHandler,
} from "./routes/worklog";

function methodNotAllowed(): Response {
  return errorResponse(405, "method_not_allowed", "method not allowed for this endpoint");
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Static asset fallback. Serves /, /index.html, /styles.css from public/. */
function serveStatic(pathname: string): Response | null {
  // The public dir is resolved once at createServer time (opts.publicDir or a
  // build-output fallback). Original read import.meta.dir; same logic otherwise.
  const PUBLIC_DIR = runtimeConfig().publicDir;
  // Map to a public-relative path. Reject anything that climbs out.
  let rel = pathname === "/" ? "/index.html" : pathname;
  if (rel.includes("..")) return null;
  rel = rel.replace(/^\/+/, "");
  const abs = normalize(join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR)) return null;
  if (!existsSync(abs)) return null;
  try {
    if (!statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  const body = readFileSync(abs);
  let contentType = "application/octet-stream";
  if (abs.endsWith(".html")) contentType = "text/html; charset=utf-8";
  else if (abs.endsWith(".css")) contentType = "text/css; charset=utf-8";
  else if (abs.endsWith(".js")) contentType = "application/javascript; charset=utf-8";
  else if (abs.endsWith(".json")) contentType = "application/json; charset=utf-8";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  // Permissive CORS preflight for all paths — browse endpoints already
  // emit Access-Control-Allow-Origin, this just acknowledges OPTIONS.
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Reports POST endpoint.
  if (pathname === "/api/reports") {
    if (method !== "POST") return methodNotAllowed();
    return await postReportsHandler(req);
  }

  // Health.
  if (pathname === "/api/health") {
    if (method !== "GET") return methodNotAllowed();
    return healthHandler();
  }

  // /api/projects[/...]
  if (pathname === "/api/projects") {
    if (method !== "GET") return methodNotAllowed();
    return listProjectsHandler();
  }
  // /api/projects/:id
  // /api/projects/:id/dates/:date
  // /api/projects/:id/dates/:date/users/:username
  // /api/projects/:id/dates/:date/users/:username/content
  // /api/projects/:id/sessions[/:sessionId]
  // /api/projects/:id/worklog[/:entryId]
  if (pathname.startsWith("/api/projects/")) {
    const parts = pathname.slice("/api/projects/".length).split("/").map(decodeSegment);

    // --- sessions: GET list (length 2) / POST + GET content (length 3) ---
    if (parts.length === 2 && parts[1] === "sessions") {
      if (method !== "GET") return methodNotAllowed();
      return listSessionsHandler(parts[0] as string);
    }
    if (parts.length === 3 && parts[1] === "sessions") {
      if (method === "POST") {
        return await postSessionHandler(req, parts[0] as string, parts[2] as string, url.searchParams);
      }
      if (method === "GET") {
        return getSessionHandler(parts[0] as string, parts[2] as string);
      }
      return methodNotAllowed();
    }
    // --- session sidecar files: POST store / GET list-or-content (length 4) ---
    if (parts.length === 4 && parts[1] === "sessions" && parts[3] === "files") {
      if (method === "POST") {
        return await postSessionFileHandler(req, parts[0] as string, parts[2] as string, url.searchParams);
      }
      if (method === "GET") {
        return getSessionFilesHandler(parts[0] as string, parts[2] as string, url.searchParams);
      }
      return methodNotAllowed();
    }

    // --- worklog: GET list (length 2) / POST + GET content (length 3) ---
    if (parts.length === 2 && parts[1] === "worklog") {
      if (method !== "GET") return methodNotAllowed();
      return listWorklogHandler(parts[0] as string);
    }
    if (parts.length === 3 && parts[1] === "worklog") {
      if (method === "POST") {
        return await postWorklogHandler(req, parts[0] as string, parts[2] as string);
      }
      if (method === "GET") {
        return getWorklogHandler(parts[0] as string, parts[2] as string);
      }
      return methodNotAllowed();
    }

    // --- everything else under /api/projects/ is GET-only ---
    if (method !== "GET") return methodNotAllowed();
    if (parts.length === 1) return getProjectHandler(parts[0] as string);
    if (parts.length === 3 && parts[1] === "dates") {
      return listProjectDateHandler(parts[0] as string, parts[2] as string);
    }
    if (parts.length === 5 && parts[1] === "dates" && parts[3] === "users") {
      return getReportHandler(parts[0] as string, parts[2] as string, parts[4] as string);
    }
    if (parts.length === 6 && parts[1] === "dates" && parts[3] === "users" && parts[5] === "content") {
      return getReportContentHandler(parts[0] as string, parts[2] as string, parts[4] as string);
    }
    if (parts.length === 6 && parts[1] === "dates" && parts[3] === "users" && parts[5] === "entries") {
      return getReportEntriesHandler(parts[0] as string, parts[2] as string, parts[4] as string);
    }
    return errorResponse(404, "not_found", "no such projects route");
  }

  // /api/users[/...]
  if (pathname === "/api/users") {
    if (method !== "GET") return methodNotAllowed();
    return listUsersHandler();
  }
  if (pathname.startsWith("/api/users/")) {
    if (method !== "GET") return methodNotAllowed();
    const parts = pathname.slice("/api/users/".length).split("/").map(decodeSegment);
    if (parts.length === 1) return getUserHandler(parts[0] as string);
    if (parts.length === 3 && parts[1] === "dates") {
      return listUserDateHandler(parts[0] as string, parts[2] as string);
    }
    return errorResponse(404, "not_found", "no such users route");
  }

  // Static fallback for the placeholder UI.
  if (method === "GET") {
    const r = serveStatic(pathname);
    if (r) return r;
  }

  return errorResponse(404, "not_found", `no route for ${method} ${pathname}`);
}
