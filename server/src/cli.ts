// Standalone entry — `node <compiled cli.js>` runs the preview server for
// manual testing. The Electron main process uses `start()` from index.ts
// directly (passing dataDir / publicDir / getUsername explicitly); this file
// is just the CLI shim.
//
// Replaces the Bun original's `if (import.meta.main) { Bun.serve(...) }` block.
// __dirname is available because the build output is CJS.

import { existsSync } from "node:fs";
import path from "node:path";

import { start, type PreviewServerOptions } from "./index";

/** Fall back to `<__dirname>/../data` for the data dir (env CJ_SERVER_DATA_DIR
 *  still wins). When tsup builds cli.ts → `dist/cli.js`, that resolves to
 *  `server/data`. */
function fallbackDataDir(): string {
  return path.join(__dirname, "..", "data");
}

/** Fall back to `<__dirname>/../public` for the SPA assets, then to a couple
 *  of cwd-relative locations (covers running a one-off build whose out-dir
 *  isn't next to `public/` — the build output is detached from the source). */
function fallbackPublicDir(): string {
  const beside = path.join(__dirname, "..", "public");
  const candidates = [
    beside,
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "server", "public"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return beside;
}

function defaultOpts(): PreviewServerOptions {
  return {
    port: Number(process.env.PORT) || 8787,
    dataDir: process.env.CJ_SERVER_DATA_DIR || fallbackDataDir(),
    publicDir: fallbackPublicDir(),
  };
}

export async function runCli(): Promise<void> {
  const { url } = await start(defaultOpts());
  console.log(`code-journal preview-server listening on ${url}`);
}

if (require.main === module) {
  void runCli();
}
