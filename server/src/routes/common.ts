// Shared response helpers. Browse endpoints get permissive CORS; POST stays
// gated by the bearer-token check in routes/reports.ts.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

export function errorResponse(
  status: number,
  error: string,
  message: string,
): Response {
  return jsonResponse({ status: "error", error, message }, status);
}

export function markdownResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

export function notFound(message = "not found"): Response {
  return errorResponse(404, "not_found", message);
}
