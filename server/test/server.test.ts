// Ported from ../../example-server/tests/server.test.ts (bun:test → node:test).
//
// The Bun original drove the in-memory `handler` directly with a per-test
// CJ_SERVER_DATA_DIR override. Here we `start({ port: 0, dataDir: <tmp> })`,
// `fetch` the returned url, and `server.close()` in teardown — same coverage.

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { existsSync, mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { start } from "../src/index";

const FIXED_USER = "alice";

let TMP_DATA: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  TMP_DATA = mkdtempSync(join(tmpdir(), "cj-example-"));
  mkdirSync(join(TMP_DATA, "reports"), { recursive: true });
  const started = await start({
    port: 0,
    dataDir: TMP_DATA,
    publicDir: join(TMP_DATA, "public"),
    getUsername: () => FIXED_USER,
  });
  server = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(TMP_DATA, { recursive: true, force: true });
  delete process.env.CJ_SERVER_DATA_DIR;
});

function fetchServer(input: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${input}`, init);
}

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: "proj-a",
    date_range: "2026-05-08",
    report: {
      filename: "2026-05-08-daily.md",
      content: "# hello\n",
      format: "daily",
      source_entry_ids: ["e_x_1"],
      language: "en",
    },
    payload_sha256: "deadbeefcafe",
    payload_size_bytes: 8,
    client_ts: "2026-05-08T10:00:00+08:00",
    ...overrides,
  };
}

describe("/api/health", () => {
  test("returns ok 200", async () => {
    const r = await fetchServer("/api/health");
    assert.equal(r.status, 200);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.status, "ok");
    assert.equal(typeof j.uptime_ms, "number");
    assert.equal(typeof j.started_at, "string");
  });
});

describe("POST /api/reports happy + idempotent", () => {
  test("writes file under data/reports/<proj>/<date>/<user>.md", async () => {
    const body = makeBody({ report: { filename: "2026-05-08-daily.md", content: "# hello\nbody\n", format: "daily", source_entry_ids: ["e_y_2"], language: "en" } });
    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.status, "ok");
    assert.equal(j.username, FIXED_USER);
    assert.equal(j.overwritten, false);

    const expected = join(TMP_DATA, "reports", "proj-a", "2026-05-08", "alice.md");
    const onDisk = readFileSync(expected, "utf8");
    assert.equal(onDisk, "# hello\nbody\n");
  });

  test("second submission for same triple sets overwritten=true and updates content", async () => {
    const first = makeBody({ report: { filename: "f.md", content: "first\n", format: "daily", source_entry_ids: [] } });
    const r1 = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(first),
    });
    assert.equal(r1.status, 200);
    assert.equal(((await r1.json()) as { overwritten: boolean }).overwritten, false);

    const second = makeBody({ report: { filename: "f.md", content: "second\n", format: "daily", source_entry_ids: [] } });
    const r2 = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(second),
    });
    assert.equal(r2.status, 200);
    assert.equal(((await r2.json()) as { overwritten: boolean }).overwritten, true);

    const expected = join(TMP_DATA, "reports", "proj-a", "2026-05-08", "alice.md");
    const onDisk = readFileSync(expected, "utf8");
    assert.equal(onDisk, "second\n");
  });
});

describe("POST /api/reports validation", () => {
  test("missing project_id → 400", async () => {
    const body = makeBody();
    delete (body as { project_id?: unknown }).project_id;
    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 400);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.error, "missing_field");
  });

  test("malformed JSON → 400 invalid_json", async () => {
    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: "{not json",
    });
    assert.equal(r.status, 400);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.error, "invalid_json");
  });

  test("non-POST on /api/reports → 405", async () => {
    const r = await fetchServer("/api/reports", { method: "GET" });
    assert.equal(r.status, 405);
  });
});

describe("GET browse endpoints", () => {
  async function seed(): Promise<void> {
    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(makeBody({ report: { filename: "2026-05-08-daily.md", content: "# alice content\n", format: "daily", source_entry_ids: ["e_x"] } })),
    });
    assert.equal(r.status, 200);
  }

  test("/api/projects after seeding lists the project", async () => {
    await seed();
    const r = await fetchServer("/api/projects");
    assert.equal(r.status, 200);
    const list = (await r.json()) as Array<Record<string, unknown>>;
    assert.ok(list.length >= 1);
    const p = list.find((x) => x.project_id === "proj-a");
    assert.ok(p);
    assert.equal(p!.report_count, 1);
    assert.deepEqual(p!.users, ["alice"]);
  });

  test("/api/projects/:id/dates/:date/users/:user/content returns raw markdown", async () => {
    await seed();
    const r = await fetchServer("/api/projects/proj-a/dates/2026-05-08/users/alice/content");
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("Content-Type")?.startsWith("text/markdown"));
    const text = await r.text();
    assert.equal(text, "# alice content\n");
  });

  test("CORS header on GET browse endpoints", async () => {
    await seed();
    const r = await fetchServer("/api/projects");
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  });

  test("/api/users lists submitters", async () => {
    await seed();
    const r = await fetchServer("/api/users");
    assert.equal(r.status, 200);
    const list = (await r.json()) as Array<Record<string, unknown>>;
    const u = list.find((x) => x.username === "alice");
    assert.ok(u);
    assert.equal(u!.project_count, 1);
  });

  test("path traversal rejected with 400", async () => {
    // Encoded "/" inside the project_id segment would decode after split, so
    // exercise the validator directly with a literal `..` segment which the
    // splitter treats as part of an ID slot.
    const r = await fetchServer("/api/projects/..%2F..%2Fetc/dates/2026-05-08");
    assert.equal(r.status, 400);
  });
});

describe("source_entries sidecar", () => {
  const sampleEntries = [
    {
      id: "e_2026-05-09_x1",
      kind: "task_completed",
      summary: "wrestled with cli_busy gate decision",
      motivation: "user pushed back on the original API shape after dogfood",
      attempts: ["initial inline state in ws-bridge — leaks across sessions"],
      lessons: ["session-scoped state belongs in SessionState, not bridge"],
      refs: { commit_sha: "abc1234" },
    },
    {
      id: "e_2026-05-09_x2",
      kind: "decision",
      summary: "shipped 3.0.1 instead of folding into 3.1",
      decisions: ["pick 3.0.1 to unblock dogfooders"],
    },
  ];

  test("POST with source_entries succeeds and writes sidecar", async () => {
    const body = makeBody({ source_entries: sampleEntries });
    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);

    const sidecar = join(TMP_DATA, "reports", "proj-a", "2026-05-08", "alice.entries.json");
    assert.equal(existsSync(sidecar), true);
    const onDisk = JSON.parse(readFileSync(sidecar, "utf8"));
    assert.deepEqual(onDisk, sampleEntries);
  });

  test("POST without source_entries succeeds and creates no sidecar", async () => {
    const body = makeBody();
    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);

    const sidecar = join(TMP_DATA, "reports", "proj-a", "2026-05-08", "alice.entries.json");
    assert.equal(existsSync(sidecar), false);
  });

  test("GET entries endpoint returns sidecar JSON when present", async () => {
    await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(makeBody({ source_entries: sampleEntries })),
    });
    const r = await fetchServer(
      "/api/projects/proj-a/dates/2026-05-08/users/alice/entries",
    );
    assert.equal(r.status, 200);
    const got = (await r.json()) as Array<Record<string, unknown>>;
    assert.deepEqual(got, sampleEntries);
  });

  test("GET entries endpoint returns [] when no sidecar exists", async () => {
    // Submit without source_entries.
    await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(makeBody()),
    });
    const r = await fetchServer(
      "/api/projects/proj-a/dates/2026-05-08/users/alice/entries",
    );
    assert.equal(r.status, 200);
    const got = await r.json();
    assert.deepEqual(got, []);
  });

  test("POST with malformed source_entries (not an array) → 400", async () => {
    const body = makeBody({ source_entries: { not: "an array" } });
    const r = await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 400);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.error, "bad_field");
    assert.ok(String(j.message).includes("source_entries"));
  });

  test("GET single-report endpoint includes entries field when sidecar present", async () => {
    await fetchServer("/api/reports", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(makeBody({ source_entries: sampleEntries })),
    });
    const r = await fetchServer(
      "/api/projects/proj-a/dates/2026-05-08/users/alice",
    );
    assert.equal(r.status, 200);
    const j = (await r.json()) as Record<string, unknown>;
    assert.deepEqual(j.entries, sampleEntries);
    assert.equal(typeof j.content, "string");
  });
});
