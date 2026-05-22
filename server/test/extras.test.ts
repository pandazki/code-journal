// Tests for the raw-sessions + raw-work-log upload/browse endpoints, plus the
// session_count / worklog_count fields on the project detail/summary responses.
//
// Mirrors server.test.ts's harness: start({ port: 0, dataDir: <tmp> }), fetch
// the returned url, server.close() in teardown.

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { existsSync, mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { start } from "../src/index";

let TMP_DATA: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  TMP_DATA = mkdtempSync(join(tmpdir(), "cj-extras-"));
  mkdirSync(join(TMP_DATA, "reports"), { recursive: true });
  const started = await start({
    port: 0,
    dataDir: TMP_DATA,
    publicDir: join(TMP_DATA, "public"),
    getUsername: () => "alice",
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

const SESSION_BODY = '{"type":"a"}\n{"type":"b"}\n';
const WORKLOG_BODY = '---\n{"id":"e_x_1","kind":"note","summary":"hi there"}\n---\nthe body text\n';

describe("raw sessions", () => {
  test("POST → list → content → re-POST overwrite", async () => {
    const r1 = await fetchServer(
      "/api/projects/demo/sessions/sess-1?agent=claude-code&cwd=/tmp/x",
      { method: "POST", body: SESSION_BODY },
    );
    assert.equal(r1.status, 200);
    const j1 = (await r1.json()) as Record<string, unknown>;
    assert.equal(j1.status, "ok");
    assert.equal(j1.session_id, "sess-1");
    assert.equal(j1.overwritten, false);
    assert.equal(typeof j1.stored_at, "string");

    // files on disk
    assert.equal(existsSync(join(TMP_DATA, "sessions", "demo", "sess-1.jsonl")), true);
    assert.equal(existsSync(join(TMP_DATA, "sessions", "demo", "sess-1.meta.json")), true);
    const meta = JSON.parse(readFileSync(join(TMP_DATA, "sessions", "demo", "sess-1.meta.json"), "utf8"));
    assert.equal(meta.agent, "claude-code");
    assert.equal(meta.cwd, "/tmp/x");
    assert.equal(meta.size_bytes, Buffer.byteLength(SESSION_BODY, "utf8"));
    assert.equal(typeof meta.received_ts, "string");

    // list
    const rList = await fetchServer("/api/projects/demo/sessions");
    assert.equal(rList.status, 200);
    const list = (await rList.json()) as Array<Record<string, unknown>>;
    assert.equal(list.length, 1);
    assert.equal(list[0]!.session_id, "sess-1");
    assert.equal(list[0]!.agent, "claude-code");
    assert.equal(list[0]!.cwd, "/tmp/x");
    assert.equal(list[0]!.size_bytes, Buffer.byteLength(SESSION_BODY, "utf8"));

    // content — exact echo
    const rContent = await fetchServer("/api/projects/demo/sessions/sess-1");
    assert.equal(rContent.status, 200);
    assert.ok(rContent.headers.get("Content-Type")?.startsWith("text/plain"));
    assert.equal(await rContent.text(), SESSION_BODY);

    // re-POST → overwritten
    const r2 = await fetchServer("/api/projects/demo/sessions/sess-1", {
      method: "POST",
      body: "new content\n",
    });
    assert.equal(r2.status, 200);
    assert.equal(((await r2.json()) as { overwritten: boolean }).overwritten, true);
    const rContent2 = await fetchServer("/api/projects/demo/sessions/sess-1");
    assert.equal(await rContent2.text(), "new content\n");
  });

  test("session list is [] when project dir absent", async () => {
    const r = await fetchServer("/api/projects/nope/sessions");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  });

  test("GET absent session → 404", async () => {
    const r = await fetchServer("/api/projects/demo/sessions/does-not-exist");
    assert.equal(r.status, 404);
  });

  test("CORS header on session GETs", async () => {
    const r = await fetchServer("/api/projects/demo/sessions");
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  });

  test("POST empty body → 400 bad_field", async () => {
    const r = await fetchServer("/api/projects/demo/sessions/s1", {
      method: "POST",
      body: "",
    });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "bad_field");
  });

  test("POST bad session_id (contains disallowed char) → 400 bad_field", async () => {
    const r = await fetchServer("/api/projects/demo/sessions/bad%20id%21", {
      method: "POST",
      body: SESSION_BODY,
    });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "bad_field");
  });

  test("session_id with dots/colons/underscores is accepted", async () => {
    const sid = "01abc-DEF.2026:07_x";
    const r = await fetchServer(`/api/projects/demo/sessions/${encodeURIComponent(sid)}`, {
      method: "POST",
      body: SESSION_BODY,
    });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { session_id: string }).session_id, sid);
    const rGet = await fetchServer(`/api/projects/demo/sessions/${encodeURIComponent(sid)}`);
    assert.equal(rGet.status, 200);
    assert.equal(await rGet.text(), SESSION_BODY);
  });
});

describe("session sidecar files", () => {
  function postSession() {
    return fetchServer("/api/projects/demo/sessions/sess-1?agent=claude-code&cwd=/tmp/x", {
      method: "POST",
      body: SESSION_BODY,
    });
  }
  const filesUrl = (rel?: string) =>
    `/api/projects/demo/sessions/sess-1/files${rel ? `?path=${encodeURIComponent(rel)}` : ""}`;

  test("POST sidecar file → stored under <session_id>/, list + content echo + overwrite", async () => {
    await postSession();
    const rel = "subagents/agent-a1.jsonl";
    const body = '{"type":"sub"}\n';
    const r = await fetchServer(filesUrl(rel), { method: "POST", body });
    assert.equal(r.status, 200);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.status, "ok");
    assert.equal(j.path, rel);
    assert.equal(j.overwritten, false);

    // stored under the session's own subtree, nested dir preserved
    assert.equal(
      existsSync(join(TMP_DATA, "sessions", "demo", "sess-1", "subagents", "agent-a1.jsonl")),
      true,
    );

    // list
    const list = (await (await fetchServer(filesUrl())).json()) as Array<Record<string, unknown>>;
    assert.equal(list.length, 1);
    assert.equal(list[0]!.rel_path, rel);
    assert.equal(list[0]!.size_bytes, Buffer.byteLength(body, "utf8"));

    // content — exact echo, text/plain
    const rContent = await fetchServer(filesUrl(rel));
    assert.equal(rContent.status, 200);
    assert.ok(rContent.headers.get("Content-Type")?.startsWith("text/plain"));
    assert.equal(await rContent.text(), body);

    // re-POST overwrites
    const r2 = await fetchServer(filesUrl(rel), { method: "POST", body: "new\n" });
    assert.equal(((await r2.json()) as { overwritten: boolean }).overwritten, true);
    assert.equal(await (await fetchServer(filesUrl(rel))).text(), "new\n");
  });

  test("sidecar dir does not inflate the session list or session_count", async () => {
    await postSession();
    await fetchServer(filesUrl("subagents/agent-a1.jsonl"), { method: "POST", body: '{"x":1}\n' });
    const list = (await (await fetchServer("/api/projects/demo/sessions")).json()) as unknown[];
    assert.equal(list.length, 1);
    const proj = (await (await fetchServer("/api/projects/demo")).json()) as { session_count: number };
    assert.equal(proj.session_count, 1);
  });

  test("file list is [] when the session has no sidecar dir", async () => {
    await postSession();
    const r = await fetchServer(filesUrl());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  });

  test("GET absent sidecar file → 404", async () => {
    await postSession();
    const r = await fetchServer(filesUrl("subagents/nope.jsonl"));
    assert.equal(r.status, 404);
  });

  test("POST path-traversal rel path → 400 bad_field, nothing escapes", async () => {
    await postSession();
    const r = await fetchServer(filesUrl("../../escape.txt"), { method: "POST", body: "x" });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "bad_field");
    assert.equal(existsSync(join(TMP_DATA, "escape.txt")), false);
  });

  test("POST empty sidecar body → 400 bad_field", async () => {
    await postSession();
    const r = await fetchServer(filesUrl("subagents/a.jsonl"), { method: "POST", body: "" });
    assert.equal(r.status, 400);
  });

  test("CORS header on sidecar file GETs", async () => {
    const r = await fetchServer(filesUrl());
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  });
});

describe("raw work-log entries", () => {
  test("POST → list parses frontmatter → content echoes", async () => {
    const r1 = await fetchServer("/api/projects/demo/worklog/e_x_1", {
      method: "POST",
      body: WORKLOG_BODY,
    });
    assert.equal(r1.status, 200);
    const j1 = (await r1.json()) as Record<string, unknown>;
    assert.equal(j1.status, "ok");
    assert.equal(j1.entry_id, "e_x_1");
    assert.equal(j1.overwritten, false);
    assert.equal(typeof j1.stored_at, "string");

    assert.equal(existsSync(join(TMP_DATA, "worklog", "demo", "e_x_1.md")), true);
    assert.equal(existsSync(join(TMP_DATA, "worklog", "demo", "e_x_1.meta.json")), true);
    assert.equal(readFileSync(join(TMP_DATA, "worklog", "demo", "e_x_1.md"), "utf8"), WORKLOG_BODY);

    const rList = await fetchServer("/api/projects/demo/worklog");
    assert.equal(rList.status, 200);
    const list = (await rList.json()) as Array<Record<string, unknown>>;
    assert.equal(list.length, 1);
    assert.equal(list[0]!.entry_id, "e_x_1");
    assert.equal(list[0]!.kind, "note");
    assert.equal(list[0]!.summary, "hi there");
    assert.equal(list[0]!.size_bytes, Buffer.byteLength(WORKLOG_BODY, "utf8"));

    const rContent = await fetchServer("/api/projects/demo/worklog/e_x_1");
    assert.equal(rContent.status, 200);
    assert.ok(rContent.headers.get("Content-Type")?.startsWith("text/markdown"));
    assert.equal(await rContent.text(), WORKLOG_BODY);

    // re-POST → overwritten
    const r2 = await fetchServer("/api/projects/demo/worklog/e_x_1", {
      method: "POST",
      body: "---\n{\"kind\":\"task_completed\"}\n---\nupdated\n",
    });
    assert.equal(r2.status, 200);
    assert.equal(((await r2.json()) as { overwritten: boolean }).overwritten, true);
  });

  test("worklog list omits kind/summary when frontmatter doesn't parse", async () => {
    await fetchServer("/api/projects/demo/worklog/e_raw", {
      method: "POST",
      body: "no frontmatter here, just text\n",
    });
    const r = await fetchServer("/api/projects/demo/worklog");
    const list = (await r.json()) as Array<Record<string, unknown>>;
    const e = list.find((x) => x.entry_id === "e_raw");
    assert.ok(e);
    assert.equal("kind" in e!, false);
    assert.equal("summary" in e!, false);
  });

  test("worklog list is [] when project dir absent", async () => {
    const r = await fetchServer("/api/projects/nope/worklog");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  });

  test("GET absent worklog entry → 404", async () => {
    const r = await fetchServer("/api/projects/demo/worklog/missing");
    assert.equal(r.status, 404);
  });

  test("POST empty body → 400 bad_field", async () => {
    const r = await fetchServer("/api/projects/demo/worklog/e1", {
      method: "POST",
      body: "",
    });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "bad_field");
  });

  test("POST bad entry_id → 400 bad_field", async () => {
    const r = await fetchServer("/api/projects/demo/worklog/bad%20id%21", {
      method: "POST",
      body: WORKLOG_BODY,
    });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "bad_field");
  });
});

describe("project counts", () => {
  test("GET /api/projects/:id includes session_count and worklog_count", async () => {
    await fetchServer("/api/projects/demo/sessions/s1?agent=cc", {
      method: "POST",
      body: SESSION_BODY,
    });
    await fetchServer("/api/projects/demo/sessions/s2?agent=cc", {
      method: "POST",
      body: SESSION_BODY,
    });
    await fetchServer("/api/projects/demo/worklog/e1", {
      method: "POST",
      body: WORKLOG_BODY,
    });

    const r = await fetchServer("/api/projects/demo");
    assert.equal(r.status, 200);
    const j = (await r.json()) as Record<string, unknown>;
    assert.equal(j.session_count, 2);
    assert.equal(j.worklog_count, 1);
  });

  test("GET /api/projects summary includes session_count / worklog_count", async () => {
    await fetchServer("/api/projects/demo/sessions/s1?agent=cc", {
      method: "POST",
      body: SESSION_BODY,
    });
    const r = await fetchServer("/api/projects");
    assert.equal(r.status, 200);
    const list = (await r.json()) as Array<Record<string, unknown>>;
    const p = list.find((x) => x.project_id === "demo");
    assert.ok(p);
    assert.equal(p!.session_count, 1);
    assert.equal(p!.worklog_count, 0);
  });
});
