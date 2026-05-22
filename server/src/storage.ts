// Filesystem helpers for the example server. All reports live under
// `data/reports/<project_id>/<date_range>/<username>.md` plus a sibling
// `<username>.meta.json` sidecar.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, dirname, sep } from "node:path";

import { runtimeConfig } from "./runtime-config";
import type { ReportMetaSidecar, ReportPayload, SourceEntry } from "./types";

// Resolve the data dir from the runtime config (set once at createServer time
// from opts.dataDir / CJ_SERVER_DATA_DIR / a build-output fallback). Reading
// getter-style each time keeps per-test isolation simple — no module-load-order
// surprise.
function dataDir(): string {
  return runtimeConfig().dataDir;
}

function reportsRoot(): string {
  return join(dataDir(), "reports");
}

function sessionsRoot(): string {
  return join(dataDir(), "sessions");
}

function worklogRoot(): string {
  return join(dataDir(), "worklog");
}

const ID_RE = /^[A-Za-z0-9_-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// session UUIDs and worklog entry ids (e.g. e_2026-05-07_a3f1) need dots,
// colons and underscores; still no "/" or ".." so they can't escape the dir.
const SUB_ID_RE = /^[A-Za-z0-9._:-]+$/;

export function isValidId(s: string): boolean {
  return typeof s === "string" && s.length > 0 && s.length <= 128 && ID_RE.test(s);
}

export function isValidDate(s: string): boolean {
  return typeof s === "string" && DATE_RE.test(s);
}

/** Validate a session_id / entry_id path segment. */
export function isValidSubId(s: string): boolean {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= 256 &&
    SUB_ID_RE.test(s) &&
    !s.includes("/") &&
    !s.includes("..")
  );
}

// A session's sidecar files (Claude Code's subagents/, tool-results/, …) carry
// a "/"-separated path relative to the <session_id>/ dir. Each segment is
// validated like a filename; "..", backslashes and absolute paths are rejected
// so an upload can never escape the session's own subtree.
const REL_SEG_RE = /^[A-Za-z0-9._-]+$/;

/** Validate a sidecar-file relative path (POSIX "/"-separated, repo-safe). */
export function isValidRelPath(s: string): boolean {
  if (typeof s !== "string" || s.length === 0 || s.length > 512) return false;
  if (s.startsWith("/") || s.includes("\\") || s.includes("..")) return false;
  return s.split("/").every((seg) => seg.length > 0 && seg.length <= 128 && REL_SEG_RE.test(seg));
}

export interface StoredReportLocation {
  storedAt: string; // path relative to repo root, for the response payload
  absolutePath: string;
  metaPath: string;
  overwritten: boolean;
}

export interface StoreInput {
  projectId: string;
  dateRange: string;
  /** Slug-safe user id ([A-Za-z0-9_-]+) — also the on-disk filename component. */
  username: string;
  /** Free-form display name. Stamped into the sidecar so the UI can render the user's natural name. */
  displayName: string;
  report: ReportPayload;
  /** Optional sidecar payload — written to <username>.entries.json when present. */
  sourceEntries?: SourceEntry[];
  payloadSha256: string;
  payloadSizeBytes: number;
  clientTs: string;
  receivedTs: string;
}

export function storeReport(input: StoreInput): StoredReportLocation {
  const dir = join(reportsRoot(), input.projectId, input.dateRange);
  mkdirSync(dir, { recursive: true });
  const mdPath = join(dir, `${input.username}.md`);
  const metaPath = join(dir, `${input.username}.meta.json`);
  const entriesPath = join(dir, `${input.username}.entries.json`);
  const overwritten = existsSync(mdPath);

  writeFileSync(mdPath, input.report.content, "utf-8");

  const sidecar: ReportMetaSidecar = {
    client_ts: input.clientTs,
    received_ts: input.receivedTs,
    format: input.report.format,
    language: input.report.language ?? null,
    payload_sha256: input.payloadSha256,
    payload_size_bytes: input.payloadSizeBytes,
    source_entry_ids: input.report.source_entry_ids,
    filename: input.report.filename,
    project_id: input.projectId,
    date_range: input.dateRange,
    username: input.username,
    display_name: input.displayName,
  };
  writeFileSync(metaPath, JSON.stringify(sidecar, null, 2) + "\n", "utf-8");

  // Sidecar entries file: written only when the client supplied source_entries.
  // We don't auto-create an empty file — `[]` and "no file" are both valid
  // and the read path treats them identically.
  if (input.sourceEntries && input.sourceEntries.length > 0) {
    writeFileSync(
      entriesPath,
      JSON.stringify(input.sourceEntries, null, 2) + "\n",
      "utf-8",
    );
  }

  // Return the path relative to the data dir's parent for response display.
  // (Bun original computed this against the repo root via import.meta.dir; the
  // data dir defaulted to <repo>/example-server/data so dirname(dirname(dataDir))
  // == repo root. Same expression here, just keyed off the resolved data dir.)
  const repoRoot = resolve(dataDir(), "..", "..");
  let storedAt = mdPath;
  if (mdPath.startsWith(repoRoot + "/")) {
    storedAt = mdPath.slice(repoRoot.length + 1);
  }
  return { storedAt, absolutePath: mdPath, metaPath, overwritten };
}

/** Read the per-report `<username>.entries.json` sidecar. Returns [] when absent. */
export function getReportSourceEntries(
  projectId: string,
  date: string,
  username: string,
): SourceEntry[] {
  if (!isValidId(projectId) || !isValidDate(date) || !isValidId(username)) return [];
  const entriesPath = join(reportsRoot(), projectId, date, `${username}.entries.json`);
  if (!existsSync(entriesPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(entriesPath, "utf-8"));
    return Array.isArray(parsed) ? (parsed as SourceEntry[]) : [];
  } catch {
    return [];
  }
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

interface ProjectDateUserEntry {
  username: string;
  meta: ReportMetaSidecar | null;
}

function readMeta(metaPath: string): ReportMetaSidecar | null {
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as ReportMetaSidecar;
  } catch {
    return null;
  }
}

export interface ProjectSummary {
  project_id: string;
  date_count: number;
  latest_date: string | null;
  report_count: number;
  users: string[];
  session_count: number;
  worklog_count: number;
}

export function listProjects(): ProjectSummary[] {
  const root = reportsRoot();
  const ids = new Set<string>();
  for (const id of safeReaddir(root)) {
    if (isValidId(id) && isDir(join(root, id))) ids.add(id);
  }
  for (const id of safeReaddir(sessionsRoot())) {
    if (isValidId(id) && isDir(join(sessionsRoot(), id))) ids.add(id);
  }
  for (const id of safeReaddir(worklogRoot())) {
    if (isValidId(id) && isDir(join(worklogRoot(), id))) ids.add(id);
  }
  const out: ProjectSummary[] = [];
  for (const projectId of ids) {
    const projDir = join(root, projectId);
    const dates: string[] = [];
    const users = new Set<string>();
    let reportCount = 0;
    for (const date of safeReaddir(projDir)) {
      if (!isValidDate(date)) continue;
      const dateDir = join(projDir, date);
      if (!isDir(dateDir)) continue;
      let any = false;
      for (const entry of safeReaddir(dateDir)) {
        if (entry.endsWith(".md")) {
          const username = entry.slice(0, -3);
          if (isValidId(username)) {
            users.add(username);
            reportCount++;
            any = true;
          }
        }
      }
      if (any) dates.push(date);
    }
    dates.sort().reverse();
    out.push({
      project_id: projectId,
      date_count: dates.length,
      latest_date: dates[0] ?? null,
      report_count: reportCount,
      users: [...users].sort(),
      session_count: countFilesWithExt(join(sessionsRoot(), projectId), ".jsonl"),
      worklog_count: countFilesWithExt(join(worklogRoot(), projectId), ".md"),
    });
  }
  out.sort((a, b) => a.project_id.localeCompare(b.project_id));
  return out;
}

export interface ProjectDetail {
  project_id: string;
  dates: string[];
  users: string[];
  total: number;
  session_count: number;
  worklog_count: number;
}

export function getProjectDetail(projectId: string): ProjectDetail | null {
  if (!isValidId(projectId)) return null;
  const projDir = join(reportsRoot(), projectId);
  const sessDir = join(sessionsRoot(), projectId);
  const wlDir = join(worklogRoot(), projectId);
  const sessionCount = countFilesWithExt(sessDir, ".jsonl");
  const worklogCount = countFilesWithExt(wlDir, ".md");
  // A project can exist purely as sessions / worklog with no reports yet.
  if (!isDir(projDir) && sessionCount === 0 && worklogCount === 0) return null;
  const dates: string[] = [];
  const users = new Set<string>();
  let total = 0;
  for (const date of safeReaddir(projDir)) {
    if (!isValidDate(date)) continue;
    const dateDir = join(projDir, date);
    if (!isDir(dateDir)) continue;
    let any = false;
    for (const entry of safeReaddir(dateDir)) {
      if (entry.endsWith(".md")) {
        const username = entry.slice(0, -3);
        if (isValidId(username)) {
          users.add(username);
          total++;
          any = true;
        }
      }
    }
    if (any) dates.push(date);
  }
  dates.sort().reverse();
  return {
    project_id: projectId,
    dates,
    users: [...users].sort(),
    total,
    session_count: sessionCount,
    worklog_count: worklogCount,
  };
}

/** Count direct children of `dir` whose name ends in `ext` (and isn't a dir). */
function countFilesWithExt(dir: string, ext: string): number {
  let n = 0;
  for (const f of safeReaddir(dir)) {
    if (!f.endsWith(ext)) continue;
    if (isDir(join(dir, f))) continue;
    n++;
  }
  return n;
}

export interface DateUserListEntry {
  /** Slug-safe user id (filename + URL path segment). */
  username: string;
  /** Display name lifted out of the sidecar so the UI doesn't have to traverse meta. Falls back to username when the sidecar is missing or pre-display_name. */
  display_name: string;
  meta: ReportMetaSidecar | null;
  content_url: string;
}

export function listProjectDateUsers(
  projectId: string,
  date: string,
): DateUserListEntry[] | null {
  if (!isValidId(projectId) || !isValidDate(date)) return null;
  const dateDir = join(reportsRoot(), projectId, date);
  if (!isDir(dateDir)) return null;
  const out: DateUserListEntry[] = [];
  for (const entry of safeReaddir(dateDir)) {
    if (!entry.endsWith(".md")) continue;
    const username = entry.slice(0, -3);
    if (!isValidId(username)) continue;
    const metaPath = join(dateDir, `${username}.meta.json`);
    const meta = readMeta(metaPath);
    out.push({
      username,
      display_name: meta?.display_name || username,
      meta,
      content_url: `/api/projects/${projectId}/dates/${date}/users/${username}/content`,
    });
  }
  out.sort((a, b) => a.username.localeCompare(b.username));
  return out;
}

export interface SingleReport {
  meta: ReportMetaSidecar | null;
  content: string;
  /** Sidecar source-entry records when present; [] when no sidecar exists. */
  entries: SourceEntry[];
}

export function getReport(
  projectId: string,
  date: string,
  username: string,
): SingleReport | null {
  if (!isValidId(projectId) || !isValidDate(date) || !isValidId(username)) return null;
  const dir = join(reportsRoot(), projectId, date);
  const mdPath = join(dir, `${username}.md`);
  const metaPath = join(dir, `${username}.meta.json`);
  if (!existsSync(mdPath)) return null;
  return {
    meta: readMeta(metaPath),
    content: readFileSync(mdPath, "utf-8"),
    entries: getReportSourceEntries(projectId, date, username),
  };
}

export function getReportContent(
  projectId: string,
  date: string,
  username: string,
): string | null {
  const r = getReport(projectId, date, username);
  return r ? r.content : null;
}

export interface UserSummary {
  username: string;
  /** Display name from the latest sidecar carrying one. Falls back to username when none exists. */
  display_name: string;
  project_count: number;
  date_count: number;
  latest_submission_ts: string | null;
}

export function listUsers(): UserSummary[] {
  // Track display name alongside the latest_ts that contributed it, so the
  // shown name follows the user's most-recent identity (matters if they
  // renamed themselves at some point — old submissions carry the old name).
  const summaries = new Map<string, {
    projects: Set<string>;
    dates: Set<string>;
    latestTs: string | null;
    displayName: string | null;
    displayTs: string | null;
  }>();
  const root = reportsRoot();
  for (const projectId of safeReaddir(root)) {
    if (!isValidId(projectId)) continue;
    const projDir = join(root, projectId);
    if (!isDir(projDir)) continue;
    for (const date of safeReaddir(projDir)) {
      if (!isValidDate(date)) continue;
      const dateDir = join(projDir, date);
      if (!isDir(dateDir)) continue;
      for (const entry of safeReaddir(dateDir)) {
        if (!entry.endsWith(".md")) continue;
        const username = entry.slice(0, -3);
        if (!isValidId(username)) continue;
        let s = summaries.get(username);
        if (!s) {
          s = { projects: new Set(), dates: new Set(), latestTs: null, displayName: null, displayTs: null };
          summaries.set(username, s);
        }
        s.projects.add(projectId);
        s.dates.add(date);
        const meta = readMeta(join(dateDir, `${username}.meta.json`));
        if (meta && meta.received_ts) {
          if (!s.latestTs || meta.received_ts > s.latestTs) {
            s.latestTs = meta.received_ts;
          }
          if (meta.display_name && (!s.displayTs || meta.received_ts > s.displayTs)) {
            s.displayName = meta.display_name;
            s.displayTs = meta.received_ts;
          }
        }
      }
    }
  }
  const out: UserSummary[] = [];
  for (const [username, s] of summaries) {
    out.push({
      username,
      display_name: s.displayName || username,
      project_count: s.projects.size,
      date_count: s.dates.size,
      latest_submission_ts: s.latestTs,
    });
  }
  out.sort((a, b) => a.username.localeCompare(b.username));
  return out;
}

export interface UserDetail {
  username: string;
  /** Display name from the latest sidecar carrying one. Falls back to username. */
  display_name: string;
  projects: string[];
  dates: string[];
}

export function getUserDetail(username: string): UserDetail | null {
  if (!isValidId(username)) return null;
  const projects = new Set<string>();
  const dates = new Set<string>();
  let found = false;
  let displayName: string | null = null;
  let displayTs: string | null = null;
  const root = reportsRoot();
  for (const projectId of safeReaddir(root)) {
    if (!isValidId(projectId)) continue;
    const projDir = join(root, projectId);
    if (!isDir(projDir)) continue;
    for (const date of safeReaddir(projDir)) {
      if (!isValidDate(date)) continue;
      const dateDir = join(projDir, date);
      if (!isDir(dateDir)) continue;
      const md = join(dateDir, `${username}.md`);
      if (existsSync(md)) {
        found = true;
        projects.add(projectId);
        dates.add(date);
        const meta = readMeta(join(dateDir, `${username}.meta.json`));
        if (meta?.display_name && meta.received_ts) {
          if (!displayTs || meta.received_ts > displayTs) {
            displayName = meta.display_name;
            displayTs = meta.received_ts;
          }
        }
      }
    }
  }
  if (!found) return null;
  const sortedDates = [...dates].sort().reverse();
  return {
    username,
    display_name: displayName || username,
    projects: [...projects].sort(),
    dates: sortedDates,
  };
}

export interface UserDateProjectEntry {
  project_id: string;
  /** Display name from this entry's sidecar. Falls back to username when absent. */
  display_name: string;
  meta: ReportMetaSidecar | null;
  content_url: string;
}

export function listUserDateProjects(
  username: string,
  date: string,
): UserDateProjectEntry[] | null {
  if (!isValidId(username) || !isValidDate(date)) return null;
  const out: UserDateProjectEntry[] = [];
  const root = reportsRoot();
  for (const projectId of safeReaddir(root)) {
    if (!isValidId(projectId)) continue;
    const dateDir = join(root, projectId, date);
    if (!isDir(dateDir)) continue;
    const md = join(dateDir, `${username}.md`);
    if (!existsSync(md)) continue;
    const meta = readMeta(join(dateDir, `${username}.meta.json`));
    out.push({
      project_id: projectId,
      display_name: meta?.display_name || username,
      meta,
      content_url: `/api/projects/${projectId}/dates/${date}/users/${username}/content`,
    });
  }
  out.sort((a, b) => a.project_id.localeCompare(b.project_id));
  return out.length > 0 ? out : [];
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Raw sessions  (data/sessions/<project_id>/<session_id>.jsonl + .meta.json)
// ---------------------------------------------------------------------------

export interface SessionMetaSidecar {
  agent: string;
  cwd: string;
  received_ts: string;
  size_bytes: number;
  /** config snapshot the session recorded for itself (model / version / git branch / …), if any */
  config?: Record<string, string>;
}

export interface StoredBlobLocation {
  /** Path relative to the repo root (data dir's grandparent), for the response. */
  storedAt: string;
  absolutePath: string;
  overwritten: boolean;
}

/** Compute a repo-root-relative display path for a stored file (mirrors storeReport). */
function repoRelative(absPath: string): string {
  const repoRoot = resolve(dataDir(), "..", "..");
  if (absPath.startsWith(repoRoot + "/")) return absPath.slice(repoRoot.length + 1);
  return absPath;
}

export function storeSession(
  projectId: string,
  sessionId: string,
  content: string,
  meta: { agent: string; cwd: string; receivedTs: string; config?: Record<string, string> },
): StoredBlobLocation {
  const dir = join(sessionsRoot(), projectId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  const metaPath = join(dir, `${sessionId}.meta.json`);
  const overwritten = existsSync(filePath);
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  writeFileSync(filePath, content, "utf-8");
  const sidecar: SessionMetaSidecar = {
    agent: meta.agent,
    cwd: meta.cwd,
    received_ts: meta.receivedTs,
    size_bytes: sizeBytes,
    ...(meta.config && Object.keys(meta.config).length ? { config: meta.config } : {}),
  };
  writeFileSync(metaPath, JSON.stringify(sidecar, null, 2) + "\n", "utf-8");
  return { storedAt: repoRelative(filePath), absolutePath: filePath, overwritten };
}

export interface SessionListEntry {
  session_id: string;
  agent: string;
  cwd: string;
  size_bytes: number;
  received_ts: string | null;
  config?: Record<string, string>;
}

export function listSessions(projectId: string): SessionListEntry[] {
  if (!isValidId(projectId)) return [];
  const dir = join(sessionsRoot(), projectId);
  const out: SessionListEntry[] = [];
  for (const f of safeReaddir(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    if (isDir(join(dir, f))) continue;
    const sessionId = f.slice(0, -".jsonl".length);
    const meta = readSessionMeta(join(dir, `${sessionId}.meta.json`));
    let sizeBytes = meta?.size_bytes ?? 0;
    if (meta?.size_bytes === undefined) {
      try {
        sizeBytes = statSync(join(dir, f)).size;
      } catch {
        sizeBytes = 0;
      }
    }
    out.push({
      session_id: sessionId,
      agent: meta?.agent ?? "unknown",
      cwd: meta?.cwd ?? "",
      size_bytes: sizeBytes,
      received_ts: meta?.received_ts ?? null,
      ...(meta?.config && Object.keys(meta.config).length ? { config: meta.config } : {}),
    });
  }
  out.sort((a, b) => {
    const ta = a.received_ts ?? "";
    const tb = b.received_ts ?? "";
    if (ta !== tb) return tb.localeCompare(ta);
    return a.session_id.localeCompare(b.session_id);
  });
  return out;
}

function readSessionMeta(metaPath: string): SessionMetaSidecar | null {
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SessionMetaSidecar;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Raw session file content, or null if absent / invalid id. */
export function getSessionContent(projectId: string, sessionId: string): string | null {
  if (!isValidId(projectId) || !isValidSubId(sessionId)) return null;
  const filePath = join(sessionsRoot(), projectId, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session sidecar files  (data/sessions/<project_id>/<session_id>/<rel_path>)
//
// Claude Code writes a sibling <session_id>/ dir next to <session_id>.jsonl
// holding subagent transcripts (subagents/agent-*.jsonl) and spilled large
// tool outputs (tool-results/*). They're uploaded file-by-file — each keeping
// its path relative to that dir — and stored under the session's own subtree,
// which coexists with the flat <session_id>.jsonl / .meta.json (a directory
// name never ends in ".jsonl", so listSessions / countFilesWithExt skip it).
// ---------------------------------------------------------------------------

export interface SessionFileEntry {
  /** path relative to the session's sidecar dir, e.g. "subagents/agent-a1.jsonl" */
  rel_path: string;
  size_bytes: number;
}

/** Absolute path of a sidecar file, or null when any id / rel_path is unsafe. */
function sessionFilePath(projectId: string, sessionId: string, relPath: string): string | null {
  if (!isValidId(projectId) || !isValidSubId(sessionId) || !isValidRelPath(relPath)) return null;
  const dir = join(sessionsRoot(), projectId, sessionId);
  const target = resolve(dir, relPath);
  // Defence in depth — isValidRelPath already bars ".." and absolute paths.
  if (target !== dir && !target.startsWith(dir + sep)) return null;
  return target;
}

export function storeSessionFile(
  projectId: string,
  sessionId: string,
  relPath: string,
  content: string,
): StoredBlobLocation | null {
  const target = sessionFilePath(projectId, sessionId, relPath);
  if (target === null) return null;
  mkdirSync(dirname(target), { recursive: true });
  const overwritten = existsSync(target);
  writeFileSync(target, content, "utf-8");
  return { storedAt: repoRelative(target), absolutePath: target, overwritten };
}

/** Recursively list every sidecar file for a session, paths relative to its dir. */
export function listSessionFiles(projectId: string, sessionId: string): SessionFileEntry[] {
  if (!isValidId(projectId) || !isValidSubId(sessionId)) return [];
  const dir = join(sessionsRoot(), projectId, sessionId);
  const out: SessionFileEntry[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const name of safeReaddir(abs)) {
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(childAbs, childRel);
      else out.push({ rel_path: childRel, size_bytes: st.size });
    }
  };
  walk(dir, "");
  out.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  return out;
}

/** Raw content of one sidecar file, or null if absent / unsafe path. */
export function getSessionFileContent(
  projectId: string,
  sessionId: string,
  relPath: string,
): string | null {
  const target = sessionFilePath(projectId, sessionId, relPath);
  if (target === null || !existsSync(target)) return null;
  try {
    return readFileSync(target, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Raw work-log entries  (data/worklog/<project_id>/<entry_id>.md + .meta.json)
// ---------------------------------------------------------------------------

export interface WorklogMetaSidecar {
  received_ts: string;
  size_bytes: number;
}

export function storeWorklogEntry(
  projectId: string,
  entryId: string,
  content: string,
  receivedTs: string,
): StoredBlobLocation {
  const dir = join(worklogRoot(), projectId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${entryId}.md`);
  const metaPath = join(dir, `${entryId}.meta.json`);
  const overwritten = existsSync(filePath);
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  writeFileSync(filePath, content, "utf-8");
  const sidecar: WorklogMetaSidecar = { received_ts: receivedTs, size_bytes: sizeBytes };
  writeFileSync(metaPath, JSON.stringify(sidecar, null, 2) + "\n", "utf-8");
  return { storedAt: repoRelative(filePath), absolutePath: filePath, overwritten };
}

export interface WorklogListEntry {
  entry_id: string;
  kind?: string;
  summary?: string;
  work_started_at?: string;
  work_ended_at?: string;
  size_bytes: number;
  received_ts: string | null;
}

/**
 * Best-effort parse of the JSON frontmatter block at the top of an entry `.md`.
 * Layout: `---\n{json}\n---\n…body…`. Returns {} when there's no parseable block.
 */
function parseWorklogFrontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---")) return {};
  // Split into ["", "<json>", "<rest>"] — the first three "---"-delimited chunks.
  const parts = text.split("---");
  if (parts.length < 3) return {};
  const jsonChunk = (parts[1] ?? "").trim();
  if (!jsonChunk) return {};
  try {
    const parsed = JSON.parse(jsonChunk);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function readWorklogMeta(metaPath: string): WorklogMetaSidecar | null {
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as WorklogMetaSidecar;
    }
  } catch {
    // fall through
  }
  return null;
}

export function listWorklogEntries(projectId: string): WorklogListEntry[] {
  if (!isValidId(projectId)) return [];
  const dir = join(worklogRoot(), projectId);
  const out: WorklogListEntry[] = [];
  for (const f of safeReaddir(dir)) {
    if (!f.endsWith(".md")) continue;
    if (isDir(join(dir, f))) continue;
    const entryId = f.slice(0, -".md".length);
    const meta = readWorklogMeta(join(dir, `${entryId}.meta.json`));
    let sizeBytes = meta?.size_bytes;
    let receivedTs = meta?.received_ts ?? null;
    let frontmatter: Record<string, unknown> = {};
    try {
      const text = readFileSync(join(dir, f), "utf-8");
      frontmatter = parseWorklogFrontmatter(text);
      if (sizeBytes === undefined) sizeBytes = Buffer.byteLength(text, "utf-8");
    } catch {
      // unreadable — keep what the sidecar gave us
    }
    const entry: WorklogListEntry = {
      entry_id: entryId,
      size_bytes: sizeBytes ?? 0,
      received_ts: receivedTs,
    };
    if (typeof frontmatter.kind === "string") entry.kind = frontmatter.kind;
    if (typeof frontmatter.summary === "string") entry.summary = frontmatter.summary;
    if (typeof frontmatter.work_started_at === "string") {
      entry.work_started_at = frontmatter.work_started_at;
    }
    if (typeof frontmatter.work_ended_at === "string") {
      entry.work_ended_at = frontmatter.work_ended_at;
    }
    out.push(entry);
  }
  out.sort((a, b) => {
    const ta = a.work_started_at ?? a.received_ts ?? "";
    const tb = b.work_started_at ?? b.received_ts ?? "";
    if (ta !== tb) return tb.localeCompare(ta);
    return a.entry_id.localeCompare(b.entry_id);
  });
  return out;
}

/** Raw entry `.md` content, or null if absent / invalid id. */
export function getWorklogEntryContent(projectId: string, entryId: string): string | null {
  if (!isValidId(projectId) || !isValidSubId(entryId)) return null;
  const filePath = join(worklogRoot(), projectId, `${entryId}.md`);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin delete operations
// ---------------------------------------------------------------------------
//
// Each `deleteX` returns null when the path doesn't exist (caller maps to 404)
// and `{ count }` on success — count = number of report-file triples (.md +
// sidecars) removed, so a deleter can show "wiped 17 files" without the
// caller needing to walk the tree itself.

/** Count `.md` files under a dir tree (recursive, depth-2 is enough since the
 *  layout is reports/<project>/<date>/<user>.md). */
function countReportFiles(dir: string): number {
  let n = 0;
  for (const a of safeReaddir(dir)) {
    const subA = join(dir, a);
    if (!isDir(subA)) continue;
    for (const b of safeReaddir(subA)) {
      const subB = join(subA, b);
      if (!isDir(subB)) {
        // direct file under reports/<project>/ — shouldn't happen normally,
        // but tolerate it
        if (b.endsWith(".md")) n++;
        continue;
      }
      for (const f of safeReaddir(subB)) {
        if (f.endsWith(".md")) n++;
      }
    }
  }
  return n;
}

function countMdInDir(dir: string): number {
  let n = 0;
  for (const f of safeReaddir(dir)) {
    if (f.endsWith(".md")) n++;
  }
  return n;
}

export interface DeleteResult {
  count: number;
}

/** DELETE reports/<projectId>/ — recursive wipe of one project. */
export function deleteProject(projectId: string): DeleteResult | null {
  if (!isValidId(projectId)) return null;
  const dir = join(reportsRoot(), projectId);
  if (!isDir(dir)) return null;
  // Walk first to count, then nuke.
  let n = 0;
  for (const date of safeReaddir(dir)) {
    const dateDir = join(dir, date);
    if (!isDir(dateDir)) continue;
    n += countMdInDir(dateDir);
  }
  rmSync(dir, { recursive: true, force: true });
  return { count: n };
}

/** DELETE reports/<projectId>/<date>/ — wipe one date for one project. */
export function deleteProjectDate(projectId: string, date: string): DeleteResult | null {
  if (!isValidId(projectId) || !isValidDate(date)) return null;
  const dir = join(reportsRoot(), projectId, date);
  if (!isDir(dir)) return null;
  const n = countMdInDir(dir);
  rmSync(dir, { recursive: true, force: true });
  return { count: n };
}

/** DELETE the .md / .meta.json / .entries.json triple for one (project, date, user). */
export function deleteProjectDateUser(
  projectId: string,
  date: string,
  username: string,
): DeleteResult | null {
  if (!isValidId(projectId) || !isValidDate(date) || !isValidId(username)) return null;
  const dir = join(reportsRoot(), projectId, date);
  const md = join(dir, `${username}.md`);
  if (!existsSync(md)) return null;
  let count = 0;
  for (const suffix of [".md", ".meta.json", ".entries.json"]) {
    const path = join(dir, `${username}${suffix}`);
    if (existsSync(path)) {
      try {
        unlinkSync(path);
        if (suffix === ".md") count++;
      } catch {
        // ignore — partial delete is still progress
      }
    }
  }
  return { count };
}

/** Wipe reports/ entirely, preserving the directory itself. */
export function wipeAllReports(): DeleteResult {
  const root = reportsRoot();
  let n = 0;
  if (isDir(root)) {
    n = countReportFiles(root);
    for (const child of safeReaddir(root)) {
      const p = join(root, child);
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore — best-effort
      }
    }
  } else {
    mkdirSync(root, { recursive: true });
  }
  return { count: n };
}
