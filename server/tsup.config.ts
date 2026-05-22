import { defineConfig } from "tsup";

// tsup config for the server — `tsup src/cli.ts` for the standalone build,
// `tsup src/index.ts test/*.test.ts` for the node:test runner.
//
// The one thing that matters here: keep the `node:` import prefix. tsup 8.x
// strips it by default (`removeNodeProtocol: true`), which turns
// `import ... from "node:test"` into `require("test")` — and there is no bare
// `test` builtin, so the test runner can't load. Pinning it to `false` keeps
// `node:test` (and the rest) intact.
export default defineConfig({
  format: ["cjs"],
  target: "node20",
  platform: "node",
  removeNodeProtocol: false,
  external: ["electron"],
});
