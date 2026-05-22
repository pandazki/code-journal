// Resolved runtime configuration for the embedded preview server.
//
// `createServer(opts)` calls `applyRuntimeConfig(opts)` once, which freezes the
// resolved data dir, public dir and a username thunk here; storage.ts and route
// handlers read from `runtimeConfig` instead of touching `import.meta.*` or
// `process.env`.
//
// Resolution order (highest priority first):
//   dataDir:        opts.dataDir → env CJ_SERVER_DATA_DIR  (cli.ts folds its
//                   __dirname-relative default into opts.dataDir before calling)
//   publicDir:      opts.publicDir  (cli.ts likewise supplies its default)
//   getUsername:    opts.getUsername → () => "local"
//                   MUST return a slug ([A-Za-z0-9_-]+) — used as the on-disk
//                   filename component and URL path segment, so any non-slug
//                   character makes the report silently invisible to the read
//                   paths (which all gate on isValidId). The host
//                   passes a stable user id here, NOT a display name.
//   getDisplayName: opts.getDisplayName → falls back to getUsername()
//                   Free-form display string (any characters, ≤ 64). Stamped
//                   into the sidecar so the preview UI can render the user's
//                   natural name (e.g. "Brian Lee") even though the filename
//                   uses the slug (e.g. "brian"). Read per-request so a
//                   userName change propagates without restart.

import { resolve } from "node:path";

export interface RuntimeConfig {
  /** Absolute path to the data dir (holds `reports/`). */
  dataDir: string;
  /** Absolute path to the static assets dir (`index.html` / `styles.css` / `app.js`). */
  publicDir: string;
  /** Slug-safe user id stamped on stored reports (filename component + URL path). */
  getUsername: () => string;
  /** Free-form display name for UI rendering. Persisted alongside the slug in the sidecar. */
  getDisplayName: () => string;
}

export interface RuntimeConfigInput {
  dataDir?: string;
  publicDir?: string;
  getUsername?: () => string;
  getDisplayName?: () => string;
}

let current: RuntimeConfig | null = null;

/** Resolve + freeze the runtime config. Called once per `createServer`. */
export function applyRuntimeConfig(input: RuntimeConfigInput): RuntimeConfig {
  const rawDataDir = input.dataDir ?? process.env.CJ_SERVER_DATA_DIR;
  if (!rawDataDir) {
    throw new Error(
      "runtime-config: dataDir not resolvable — pass opts.dataDir or set CJ_SERVER_DATA_DIR",
    );
  }
  if (!input.publicDir) {
    throw new Error("runtime-config: publicDir not resolvable — pass opts.publicDir");
  }
  const getUsername = input.getUsername ?? (() => "local");
  // When the host doesn't supply a display name, fall back to the slug — the
  // UI will just render "brian" instead of "Brian Lee". That's the right
  // degradation for tests and the standalone CLI.
  const getDisplayName = input.getDisplayName ?? getUsername;
  current = {
    dataDir: resolve(rawDataDir),
    publicDir: resolve(input.publicDir),
    getUsername,
    getDisplayName,
  };
  return current;
}

/** The resolved config. Throws if `applyRuntimeConfig` hasn't run yet. */
export function runtimeConfig(): RuntimeConfig {
  if (!current) {
    throw new Error(
      "runtime-config: not initialized — createServer()/start() must run before storage is used",
    );
  }
  return current;
}

/** Test/dev helper: clear the resolved config so a fresh createServer() re-resolves. */
export function _resetRuntimeConfig(): void {
  current = null;
}
