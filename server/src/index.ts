// Public API for the embedded code-journal preview server.
//
// Node port of ../../example-server (Bun-specific). `createServer(opts)` returns
// an unstarted `http.Server`; `start(opts)` creates + listens. No auth — the
// server runs inside the desktop app on loopback.
//
// Identity thunks:
//   getUsername — slug-safe user id used as filename + URL path segment.
//                 MUST match [A-Za-z0-9_-]+. The host passes a stable user id.
//   getDisplayName — free-form name for UI rendering. Stamped into the
//                    sidecar. The host passes a display name.
// Tests can omit both and get "local"/"local".

import http from "node:http";

import { applyRuntimeConfig } from "./runtime-config";
import { nodeToWebRequest, writeWebResponse } from "./http-adapter";
import { handler } from "./server";

export interface PreviewServerOptions {
  /** TCP port to listen on. Omitted / 0 → ephemeral port chosen by the OS. */
  port?: number;
  /** Data dir (holds `reports/`). Falls back to env CJ_SERVER_DATA_DIR. */
  dataDir?: string;
  /** Static assets dir (the SPA: index.html / styles.css / app.js). Required (cli.ts supplies a __dirname-relative default). */
  publicDir?: string;
  /** Slug-safe user id stamped on stored reports (filename + URL path). Read per request. Defaults to () => "local". */
  getUsername?: () => string;
  /** Free-form display name stamped into the report sidecar for UI rendering. Read per request. Falls back to getUsername() when omitted. */
  getDisplayName?: () => string;
}

/**
 * Build an unstarted `http.Server` wired to the ported request handler.
 * Applies `opts` to the runtime config before any request is served.
 */
export function createServer(opts?: PreviewServerOptions): http.Server {
  applyRuntimeConfig({
    dataDir: opts?.dataDir,
    publicDir: opts?.publicDir,
    getUsername: opts?.getUsername,
    getDisplayName: opts?.getDisplayName,
  });

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const host = req.headers.host ?? "127.0.0.1";
        const baseUrl = `http://${host}`;
        const webReq = await nodeToWebRequest(req, baseUrl);
        const webRes = await handler(webReq);
        await writeWebResponse(res, webRes);
      } catch (err) {
        // Defensive — the ported handler doesn't throw, but the adapter (or a
        // malformed request) might. Mirror the handler's JSON error shape.
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        }
        res.end(
          JSON.stringify({
            status: "error",
            error: "internal_error",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    })();
  });
}

const MAX_PORT_RETRIES = 20;

/**
 * Create + start the server.
 *
 * - `port` omitted / 0 → an ephemeral port is chosen by the OS.
 * - a fixed `port` that's already in use → retry `port+1`, `port+2`, … up to
 *   ~20 attempts, then reject.
 * - resolves once the server emits `'listening'`. `url` = `http://127.0.0.1:${port}`.
 */
export function start(
  opts?: PreviewServerOptions,
): Promise<{ server: http.Server; port: number; url: string }> {
  const server = createServer(opts);
  const wantPort = opts?.port;
  const fixedPort = typeof wantPort === "number" && wantPort > 0 ? wantPort : null;

  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryListen(port: number): void {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener("listening", onListening);
        if (fixedPort !== null && err.code === "EADDRINUSE" && attempt < MAX_PORT_RETRIES) {
          attempt += 1;
          tryListen(fixedPort + attempt);
          return;
        }
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        const addr = server.address();
        const boundPort = typeof addr === "object" && addr ? addr.port : port;
        resolve({
          server,
          port: boundPort,
          url: `http://127.0.0.1:${boundPort}`,
        });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      // host omitted → Node binds to all interfaces; we report 127.0.0.1 in the url.
      server.listen(port);
    }

    tryListen(fixedPort ?? 0);
  });
}
