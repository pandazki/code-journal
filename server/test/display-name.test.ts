// Tests for the display_name layer — the C-route fix for the path/regex
// mismatch where a host passes a free-form display name (
// allows spaces) through getUsername, which then landed as the .md filename but
// was filtered out by every read path's isValidId gate.
//
// The fix splits identity into two thunks:
//   getUsername    → slug-safe id ([A-Za-z0-9_-]+), used as filename + URL.
//                    The route rejects non-slug values with 500 instead of
//                    silently writing an invisible file.
//   getDisplayName → free-form name, stamped into the sidecar's `display_name`
//                    field and surfaced verbatim through every list response.

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { start } from "../src/index";

const SLUG = "brian";
const DISPLAY = "Brian Lee"; // space — would fail isValidId

let TMP_DATA: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  TMP_DATA = mkdtempSync(join(tmpdir(), "cj-display-"));
  mkdirSync(join(TMP_DATA, "reports"), { recursive: true });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(TMP_DATA, { recursive: true, force: true });
});

async function startServer(opts: { getUsername: () => string; getDisplayName?: () => string }): Promise<void> {
  const started = await start({
    port: 0,
    dataDir: TMP_DATA,
    publicDir: join(TMP_DATA, "public"),
    ...opts,
  });
  server = started.server;
  baseUrl = started.url;
}

function fetchServer(input: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${input}`, init);
}

function reportBody(): Record<string, unknown> {
  return {
    project_id: "proj-a",
    date_range: "2026-05-19",
    report: {
      filename: "2026-05-19-daily.md",
      content: "# hello\n",
      format: "daily",
      source_entry_ids: [],
      language: "en",
    },
    payload_sha256: "deadbeef",
    payload_size_bytes: 8,
    client_ts: "2026-05-19T10:00:00+08:00",
  };
}

describe("display_name flows through every surface", () => {
  test("POST response carries display_name; sidecar persists it; all list endpoints surface it", async () => {
    await startServer({
      getUsername: () => SLUG,
      getDisplayName: () => DISPLAY,
    });

    // POST: response carries both slug + display_name
    const post = await fetchServer("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportBody()),
    });
    assert.equal(post.status, 200);
    const postJson = (await post.json()) as Record<string, unknown>;
    assert.equal(postJson.username, SLUG);
    assert.equal(postJson.display_name, DISPLAY);

    // Sidecar on disk has display_name
    const sidecarPath = join(TMP_DATA, "reports", "proj-a", "2026-05-19", `${SLUG}.meta.json`);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;
    assert.equal(sidecar.username, SLUG);
    assert.equal(sidecar.display_name, DISPLAY);

    // GET /api/projects/:id/dates/:date — list of contributors
    const dateUsers = await (await fetchServer("/api/projects/proj-a/dates/2026-05-19")).json();
    assert.equal(Array.isArray(dateUsers), true);
    assert.equal((dateUsers as Array<Record<string, unknown>>)[0]?.username, SLUG);
    assert.equal((dateUsers as Array<Record<string, unknown>>)[0]?.display_name, DISPLAY);

    // GET /api/users
    const users = await (await fetchServer("/api/users")).json();
    const u = (users as Array<Record<string, unknown>>).find((r) => r.username === SLUG);
    assert.ok(u, "user listed");
    assert.equal(u!.display_name, DISPLAY);

    // GET /api/users/:slug
    const userDetail = await (await fetchServer(`/api/users/${SLUG}`)).json() as Record<string, unknown>;
    assert.equal(userDetail.username, SLUG);
    assert.equal(userDetail.display_name, DISPLAY);

    // GET /api/users/:slug/dates/:date
    const userDate = await (await fetchServer(`/api/users/${SLUG}/dates/2026-05-19`)).json();
    assert.equal((userDate as Array<Record<string, unknown>>)[0]?.display_name, DISPLAY);
  });

  test("display_name defaults to the slug when host omits getDisplayName", async () => {
    // Backward-compat path: tests / standalone CLI / older Electron builds that
    // only set getUsername should keep working. The sidecar then carries the
    // slug in display_name (a no-op duplication, but a clean fallback).
    await startServer({ getUsername: () => SLUG });

    const post = await fetchServer("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportBody()),
    });
    assert.equal(post.status, 200);
    const postJson = (await post.json()) as Record<string, unknown>;
    assert.equal(postJson.display_name, SLUG);

    const sidecarPath = join(TMP_DATA, "reports", "proj-a", "2026-05-19", `${SLUG}.meta.json`);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;
    assert.equal(sidecar.display_name, SLUG);
  });
});

describe("non-slug username is rejected at the boundary", () => {
  test("getUsername returning a string with a space → 500 bad_runtime_config (NOT a silent write)", async () => {
    // This is the regression test for the original bug: a host wiring
    // a free-form display name (which allows spaces) through getUsername used to write
    // a "Brian Lee.md" file that every read path then filtered out via
    // isValidId. The fix surfaces the misconfiguration loudly instead.
    await startServer({
      getUsername: () => DISPLAY, // space inside — invalid slug
    });

    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportBody()),
    });
    assert.equal(r.status, 500);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.status, "error");
    assert.equal(j.error, "bad_runtime_config");
    assert.match(String(j.message), /not a valid slug/);
  });
});
