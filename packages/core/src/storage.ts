/**
 * L2 storage IO — the only place that writes entries (single write gate).
 *
 * Port of code_journal/storage.py. JSON output uses 2-space indent and a
 * trailing newline to byte-match the Python originals; key insertion order
 * mirrors Python dict insertion order (which is what the existing tests
 * assert against).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  CONFIG_JSON,
  PROJECTS_TIER,
  ProjectKey,
  canonicalizeCwd,
  findAllProjectsClaimingCwd,
  findProjectKeyForCwd,
  formatProjectKey,
  isProjectRootPath,
  projectConfigPath,
  projectRoot,
  projectRootFor,
  requireProjectKeyForCwd,
  toPosixRel,
  workMemoryRoot,
} from './paths';
import {
  JsonObject,
  Project,
  ReportConfig,
  parseProject,
  serializeProject,
} from './models';
import { DEFAULT_CATCHUP_LOOKBACK_DAYS } from './defaults';
import {
  dateInTimezone,
  hostTimezone,
  isoInTimezone,
  isoUtcNow,
  splitIsoComponents,
} from './datetime';

export { CONFIG_JSON } from './paths';

// ---------------------------------------------------------------------------
// JSON serialization helpers — produce Python-equivalent output.
// ---------------------------------------------------------------------------

function jsonDumpPretty(obj: unknown): string {
  // Python: json.dumps(x, indent=2, ensure_ascii=False) + "\n"
  // Node JSON.stringify with null,2 produces identical formatting (spaces
  // after colons, no trailing comma, newlines for nested values). The
  // trailing "\n" is appended by callers, matching the Python convention.
  return JSON.stringify(obj, null, 2);
}

function readJson(p: string): unknown {
  const text = fs.readFileSync(p, 'utf8');
  return text.trim() === '' ? {} : JSON.parse(text);
}

function readJsonOr<T>(p: string, fallback: T): unknown {
  try {
    return readJson(p);
  } catch {
    return fallback;
  }
}

/**
 * Write a file atomically: stream into a sibling `.tmp-<pid>-<ts>` then
 * `fs.renameSync` it over the target. Rename is atomic on POSIX and on
 * Windows (since Node 14) when the destination exists, so a concurrent
 * reader (or a SIGTERM landing mid-write) leaves either the old file or
 * the new one — never a torn write. The PID + timestamp suffix dodges
 * collisions when the same process writes the same target twice in
 * quick succession.
 *
 * Use this for every on-disk artifact that a long-running claude run can
 * be interrupted in the middle of (entry .md, report .md, config.json).
 */
export function atomicWriteFileSync(p: string, content: string | Buffer): void {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, p);
  } catch (err) {
    // writeFileSync may have left a partial tmp; best-effort unlink so we
    // don't accumulate garbage under the project dir. (SIGTERM-on-the-process
    // path doesn't enter this catch — the kernel kills us outright — but the
    // partial tmp it leaves is harmless: the target file is untouched, and
    // the next run picks a fresh timestamp.)
    try { fs.unlinkSync(tmp); } catch { /* tmp may not exist */ }
    throw err;
  }
}

function writeJson(p: string, obj: unknown): void {
  atomicWriteFileSync(p, jsonDumpPretty(obj) + '\n');
}

// ---------------------------------------------------------------------------
// Project registry — backed by per-project config.json.cwds[]
//
// The on-disk tree is three tiers under the user-home root:
//   ~/.code-journal/<userId>/<orgId>/projects/<projectId>/
// `listRegisteredProjects()` walks all three tiers; the map key is the
// formatted "userId/orgId/projectId" triple so downstream consumers (CLI
// list-projects, drafter dispatch) can round-trip the identifier verbatim.
// ---------------------------------------------------------------------------

export interface ProjectRegistryEntry {
  user_id: string;
  org_id: string;
  project_id: string;
  display_name: string;
  cwds: string[];
  first_registered: string;
  last_updated: string;
}

function sortedDirEntries(dir: string): fs.Dirent[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  // Skip macOS/Windows clutter and reserved tier-name dirs.
  entries = entries.filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

export function listRegisteredProjects(): Record<string, ProjectRegistryEntry> {
  const out: Record<string, ProjectRegistryEntry> = {};
  const root = workMemoryRoot();
  for (const userEnt of sortedDirEntries(root)) {
    const userDir = path.join(root, userEnt.name);
    for (const orgEnt of sortedDirEntries(userDir)) {
      const projectsDir = path.join(userDir, orgEnt.name, PROJECTS_TIER);
      for (const projEnt of sortedDirEntries(projectsDir)) {
        const cfgPath = path.join(projectsDir, projEnt.name, CONFIG_JSON);
        if (!fs.existsSync(cfgPath)) continue;
        let data: JsonObject;
        try {
          data = readJsonOr(cfgPath, {}) as JsonObject;
        } catch {
          continue;
        }
        // The directory IS the identity. `data.project_id` is display
        // metadata only — never use it to construct the canonical key.
        const projectId = projEnt.name;
        const key = `${userEnt.name}/${orgEnt.name}/${projectId}`;
        const displayName = (data.display_name as string) || '';
        out[key] = {
          user_id: userEnt.name,
          org_id: orgEnt.name,
          project_id: projectId,
          display_name: displayName.length > 0 ? displayName : projectId,
          cwds: Array.isArray(data.cwds) ? (data.cwds as string[]).map(String) : [],
          first_registered: (data.first_registered as string) ?? '',
          last_updated: (data.last_updated as string) ?? '',
        };
      }
    }
  }
  return out;
}

export function cwdsForProject(key: ProjectKey): string[] {
  const cfgPath = path.join(projectRootFor(key), CONFIG_JSON);
  if (!fs.existsSync(cfgPath)) return [];
  let data: JsonObject;
  try {
    data = readJsonOr(cfgPath, {}) as JsonObject;
  } catch {
    return [];
  }
  return Array.isArray(data.cwds) ? (data.cwds as string[]).map(String) : [];
}

/**
 * Add `cwd` to the project's `config.cwds[]`. Refuses if any *other*
 * project already claims this cwd — the cwd→project mapping is a 1-to-N
 * (one cwd belongs to at most one project, one project can have many
 * cwds), and writing an overlap would silently confuse every later
 * reverse-scan. The check uses `canonicalizeCwd` + case-fold semantics
 * so symlinks / case-variant aliases are caught.
 *
 * Also refuses if `cwd` is itself a project-root path (matches the
 * `<workMemoryRoot>/<u>/<o>/projects/<p>/` shape). Project roots are
 * self-identifying via the fast-path in `findProjectKeyForCwd` — storing
 * them in any `cwds[]` (including their own — that'd be circular) would
 * silently create the kind of overlap the fast-path is meant to skip
 * past, defeating the invariant that makes the fast-path safe.
 */
export function addCwdToConfig(key: ProjectKey, cwd: string): void {
  const root = projectRootFor(key);
  const cfgPath = path.join(root, CONFIG_JSON);
  if (!fs.existsSync(cfgPath)) return;
  const canonical = canonicalizeCwd(cwd);
  if (isProjectRootPath(canonical)) {
    throw new Error(
      `refusing to register project-root path ${canonical} in cwds[] — ` +
      `project roots are resolved by location, not by cwds[] membership.`,
    );
  }
  // Refuse cross-project overlap (idempotent inside the same project).
  const claimants = findAllProjectsClaimingCwd(cwd).filter(
    (m) =>
      !(m.key.userId === key.userId && m.key.orgId === key.orgId && m.key.projectId === key.projectId),
  );
  if (claimants.length > 0) {
    const others = claimants.map((m) => formatProjectKey(m.key)).join(', ');
    throw new Error(
      `cwd ${canonical} is already registered to project '${others}'. ` +
      `One cwd can belong to only one project — unregister it there first.`,
    );
  }
  const data = readJsonOr(cfgPath, {}) as JsonObject;
  const cwds = Array.isArray(data.cwds) ? (data.cwds as string[]).map(String) : [];
  const now = isoUtcNow();
  if (!cwds.includes(canonical)) {
    cwds.push(canonical);
    cwds.sort();
  }
  data.cwds = cwds;
  if (!('first_registered' in data)) data.first_registered = now;
  data.last_updated = now;
  writeJson(cfgPath, data);
}

/**
 * Remove `cwd` from the named project's `config.cwds[]`. Returns true if
 * the entry was found and removed, false if it wasn't present.
 * Powers the `unregister-cwd` subcommand — the only sanctioned way to
 * drop a cwd registration without nuking the whole project.
 */
export function removeCwdFromConfig(key: ProjectKey, cwd: string): boolean {
  const cfgPath = path.join(projectRootFor(key), CONFIG_JSON);
  if (!fs.existsSync(cfgPath)) return false;
  const data = readJsonOr(cfgPath, {}) as JsonObject;
  const cwds = Array.isArray(data.cwds) ? (data.cwds as string[]).map(String) : [];
  const target = canonicalizeCwd(cwd);
  const next = cwds.filter((stored) => canonicalizeCwd(stored) !== target);
  if (next.length === cwds.length) return false;
  data.cwds = next;
  data.last_updated = isoUtcNow();
  writeJson(cfgPath, data);
  return true;
}

// ---------------------------------------------------------------------------
// Project + secrets IO
// ---------------------------------------------------------------------------

export function loadProject(cwd?: string): Project {
  const p = projectConfigPath(cwd);
  if (!fs.existsSync(p)) throw new Error(`No code-journal project at ${p}`);
  const data = readJsonOr(p, {}) as JsonObject;
  return parseProject(data);
}

/**
 * Write the project's config.json. Post-dump cleanup: drops the `schema`
 * block when empty.
 *
 * `extras` lets `init` stamp `cwds[]` / `first_registered` / `last_updated`
 * in the same atomic write — collapsing what used to be two writes (with
 * an observable "cwds:[]" middle state) into one.
 */
export function writeProject(project: Project, root?: string, extras?: JsonObject): string {
  const p = root ? path.join(root, CONFIG_JSON) : projectConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const data = serializeProject(project);
  const schema = (data.schema as JsonObject) ?? {};
  const customKinds = Array.isArray(schema.custom_kinds) ? schema.custom_kinds : [];
  const customFields = Array.isArray(schema.custom_fields) ? schema.custom_fields : [];
  if (customKinds.length === 0 && customFields.length === 0) {
    delete data.schema;
  }
  if (extras) {
    for (const [k, v] of Object.entries(extras)) data[k] = v;
  }
  writeJson(p, data);
  return p;
}

export function ensureDirs(root?: string): void {
  const base = root ?? projectRoot();
  fs.mkdirSync(path.join(base, 'log', 'entries'), { recursive: true });
  fs.mkdirSync(path.join(base, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(base, '.logs'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Project deletion
//
// Destructive: removes the entire `<root>/<userId>/<orgId>/projects/<projectId>/`
// subtree and prunes the org/user parents if they become empty. The caller is
// responsible for any UX-level confirmation; this function just performs the
// mutation. `summarizeProjectForDelete` is the read-only counterpart used to
// drive a "are you sure?" dialog before invoking `deleteProject`.
// ---------------------------------------------------------------------------

export interface DeleteProjectSummary {
  key: string;
  user_id: string;
  org_id: string;
  project_id: string;
  display_name: string;
  project_root: string;
  cwds: string[];
  entry_count: number;
  report_count: number;
  /** absolute paths the deletion will (or did) remove, in order */
  paths_to_remove: string[];
  /** parent dirs that became empty after delete and were pruned (absolute) */
  parents_pruned: string[];
  /** false for `summarize…`, true after `deleteProject` returns. */
  deleted: boolean;
}

function countReports(root: string): number {
  try {
    return fs
      .readdirSync(path.join(root, 'reports'))
      .filter((f) => f.endsWith('.md'))
      .length;
  } catch {
    return 0;
  }
}

function readEntryCount(root: string): number {
  // Count .md files under log/entries/<YYYY-MM>/* directly — no need to
  // parse them, and no dependency on a cache file that no longer exists.
  const entriesRoot = path.join(root, 'log', 'entries');
  let total = 0;
  try {
    for (const month of fs.readdirSync(entriesRoot)) {
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      try {
        total += fs.readdirSync(path.join(entriesRoot, month)).filter((f) => f.endsWith('.md')).length;
      } catch {
        /* month dir missing or unreadable — skip */
      }
    }
  } catch {
    /* entries root missing — 0 */
  }
  return total;
}

export function summarizeProjectForDelete(key: ProjectKey): DeleteProjectSummary {
  const root = projectRootFor(key);
  if (!fs.existsSync(root)) {
    throw new Error(`project not found: ${formatProjectKey(key)} (expected at ${root})`);
  }
  const cfgPath = path.join(root, CONFIG_JSON);
  let displayName = key.projectId;
  let cwds: string[] = [];
  try {
    const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as JsonObject;
    if (typeof data.display_name === 'string' && data.display_name.length > 0) {
      displayName = data.display_name;
    }
    if (Array.isArray(data.cwds)) cwds = (data.cwds as unknown[]).map(String);
  } catch {
    // Missing/corrupt config: still allow delete — the directory exists.
  }
  return {
    key: formatProjectKey(key),
    user_id: key.userId,
    org_id: key.orgId,
    project_id: key.projectId,
    display_name: displayName,
    project_root: root,
    cwds,
    entry_count: readEntryCount(root),
    report_count: countReports(root),
    paths_to_remove: [root],
    parents_pruned: [],
    deleted: false,
  };
}

/**
 * `rmdir` a directory if (and only if) it's empty. Returns true on success.
 * Any error (including ENOTEMPTY) is swallowed and returns false — pruning
 * is best-effort and must never block the primary delete.
 */
function tryRmdirEmpty(dir: string): boolean {
  try {
    fs.rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

export function deleteProject(key: ProjectKey): DeleteProjectSummary {
  const summary = summarizeProjectForDelete(key);
  // Primary delete — recursive, force so we don't trip on read-only quirks.
  fs.rmSync(summary.project_root, { recursive: true, force: true });
  // Prune empty parents up the chain: projects/, <orgId>/, <userId>/.
  // Stop at the user-home root so we never touch `~/.code-journal/` itself.
  const projectsDir = path.dirname(summary.project_root); // .../<u>/<o>/projects
  const orgDir = path.dirname(projectsDir); // .../<u>/<o>
  const userDir = path.dirname(orgDir); // .../<u>
  const root = workMemoryRoot();
  const pruned: string[] = [];
  if (tryRmdirEmpty(projectsDir)) pruned.push(projectsDir);
  if (tryRmdirEmpty(orgDir)) pruned.push(orgDir);
  // Only prune the user tier if we're still inside ~/.code-journal/.
  if (path.dirname(userDir) === root && tryRmdirEmpty(userDir)) {
    pruned.push(userDir);
  }
  summary.parents_pruned = pruned;
  summary.deleted = true;
  return summary;
}

// ---------------------------------------------------------------------------
// defaultProject
// ---------------------------------------------------------------------------

export interface DefaultProjectOptions {
  displayName?: string;
  reportLanguage?: string;
  /** IANA zone to reckon days in; defaults to the auto-detected host zone. */
  timezone?: string;
}

export function defaultProject(key: ProjectKey, opts: DefaultProjectOptions = {}): Project {
  const projectId = key.projectId;
  const { displayName = '', reportLanguage = 'en', timezone = hostTimezone() } = opts;

  return {
    project_id: projectId,
    display_name: displayName || projectId,
    schema_: { custom_kinds: [], custom_fields: [], _extra: {} },
    report: {
      catchup_lookback_days: DEFAULT_CATCHUP_LOOKBACK_DAYS,
      language: reportLanguage,
      _extra: {},
    },
    schedule: { mode: 'manual', time: null, weekday: null, _extra: {} },
    timezone,
    _extra: {},
  };
}

/**
 * The IANA timezone the project at `cwd` reckons calendar days in — the
 * config's pinned `timezone`, or the auto-detected host zone when unset or
 * the cwd isn't a registered project. The single source of truth threaded
 * through entry filing, query windows, and report staleness.
 */
export function projectTimezone(cwd?: string): string {
  try {
    return loadProject(cwd).timezone || hostTimezone();
  } catch {
    return hostTimezone();
  }
}

// ---------------------------------------------------------------------------
// Dotted-path lookup
// ---------------------------------------------------------------------------

export function getDotted(obj: unknown, dottedPath: string): unknown {
  let cur: unknown = obj;
  for (const part of dottedPath.split('.')) {
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) throw new Error(`KeyError: ${dottedPath}`);
      if (idx < 0 || idx >= cur.length) throw new Error(`IndexError: ${dottedPath}`);
      cur = cur[idx];
    } else if (cur && typeof cur === 'object') {
      const rec = cur as Record<string, unknown>;
      if (!(part in rec)) throw new Error(`KeyError: ${dottedPath}`);
      cur = rec[part];
    } else {
      throw new Error(`KeyError: ${dottedPath}`);
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Entry append (the L2 single write gate)
// ---------------------------------------------------------------------------

export const PRESET_KINDS = new Set<string>([
  'session_summary',
  'spec_authored',
  'plan_drafted',
  'task_started',
  'task_progress',
  'task_completed',
  'decision',
  'blocker',
  'note',
]);

/**
 * Split the file into `---` frontmatter and the markdown body.
 *
 * We anchor the closing fence on a newline (`\n---\n` or `\n---` at EOF)
 * rather than the bare `---` substring, so a body containing a markdown
 * horizontal rule (`---` on its own line *inside* the narrative) doesn't
 * get mistaken for the closing fence and truncated.
 */
export function splitFrontmatter(md: string): { fm: JsonObject; body: string } {
  if (!md.startsWith('---')) {
    throw new Error('entry must start with JSON frontmatter (---).');
  }
  // Strip the opening fence (the leading `---` and the newline after it).
  const afterOpen = md.slice(3).replace(/^\r?\n/, '');
  // Locate the closing fence: a line that is exactly `---`.
  const closeMatch = afterOpen.match(/(?:^|\r?\n)---(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    throw new Error("malformed frontmatter — missing closing '---'.");
  }
  const fmText = afterOpen.slice(0, closeMatch.index).trim();
  const fm = fmText ? (JSON.parse(fmText) as JsonObject) : {};
  let body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  // Python's lstrip("\n") drops leading newlines only.
  body = body.replace(/^\n+/, '');
  return { fm, body };
}

function allowedKinds(project: Project): Set<string> {
  const out = new Set(PRESET_KINDS);
  for (const k of project.schema_.custom_kinds) out.add(k);
  return out;
}

export interface AppendEntryResult extends JsonObject {
  id: string;
  created_at: string;
  kind: string;
  refs: JsonObject;
  tags: string[];
  summary: string;
  file_path: string;
}

export interface AppendEntryOptions {
  /**
   * When true, run the full parse + validate pipeline and compute the would-be
   * `id` / `file_path`, but DO NOT write the entry file or index.json. Lets
   * first-run synthesizers (or skill authors) probe the schema without
   * persisting test rows that then have to be cleaned up. The returned
   * AppendEntryResult is byte-identical to a real write — including the
   * generated `id` — so callers can diff/inspect before committing.
   */
  dryRun?: boolean;
}

export function appendEntryFromText(
  md: string,
  cwd?: string,
  opts: AppendEntryOptions = {},
): AppendEntryResult {
  const project = loadProject(cwd);
  const projRoot = projectRoot(cwd);
  const { fm, body } = splitFrontmatter(md);

  const kind = fm.kind as string | undefined;
  if (!kind) throw new Error("entry frontmatter missing 'kind'.");
  if (!allowedKinds(project).has(kind)) {
    throw new Error(`unknown kind: ${JSON.stringify(kind)} (not in preset or custom_kinds).`);
  }

  // Stamp `now` in the project's timezone so the date sliced off `created_at`
  // (which is how the entry is filed and later windowed — see
  // splitIsoComponents below and queryEntries) is the project-tz calendar day,
  // not UTC. A manually-supplied created_at is honored verbatim.
  const now = isoInTimezone(new Date(), project.timezone || hostTimezone());
  fm.project_id = (fm.project_id as string) || project.project_id;
  fm.created_at = (fm.created_at as string) || now;
  fm.updated_at = (fm.updated_at as string) || now;
  fm.agent_backend = (fm.agent_backend as string) || 'manual';
  if (!('summary' in fm)) fm.summary = '(no summary)';

  const createdIso = fm.created_at as string;
  const workStartedIso = (fm.work_started_at as string | undefined) ?? null;
  const workEndedIso = (fm.work_ended_at as string | undefined) ?? null;
  if (workEndedIso !== null && workStartedIso === null) {
    throw new Error('work_ended_at without work_started_at');
  }
  if (workStartedIso !== null && workEndedIso !== null && workStartedIso > workEndedIso) {
    throw new Error('work_ended_at < work_started_at');
  }
  const effectiveIso = workStartedIso ?? createdIso;
  const eff = splitIsoComponents(effectiveIso);

  const entryId = (fm.id as string) || `e_${eff.date}_${randomBytes(2).toString('hex')}`;
  fm.id = entryId;

  // <project_root>/log/entries/<YYYY-MM>/<YYYY-MM-DDTHH-MM-SS>_<id>.md
  const tsSafe = eff.tsSafe; // "YYYY-MM-DDTHH-MM-SS"
  const monthDir = path.join(projRoot, 'log', 'entries', eff.yyyymm);
  const filePath = path.join(monthDir, `${tsSafe}_${entryId}.md`);
  if (!opts.dryRun) {
    fs.mkdirSync(monthDir, { recursive: true });
    const fmJson = JSON.stringify(fm, null, 2);
    atomicWriteFileSync(filePath, `---\n${fmJson}\n---\n\n${body}`);
  }

  const relPath = toPosixRel(['log', 'entries', eff.yyyymm, `${tsSafe}_${entryId}.md`]);

  const record = frontmatterToRecord(fm, relPath) as AppendEntryResult;
  // No index cache to maintain — readers scan log/entries/ directly. The
  // .md file written above is the only durable mutation.
  return record;
}

/**
 * Project an entry's full frontmatter down to the canonical index/query
 * record shape. Drops fields that aren't useful for indexing
 * (project_id — implied by directory; agent_backend — debug only;
 * updated_at — entries are effectively append-only) and includes only
 * the rich-content fields when present and non-empty.
 *
 * This is shared by `appendEntryFromText` (write path) and `scanEntries`
 * (read path), so any callsite that previously saw an index.json record
 * sees byte-identical fields from a directory scan.
 */
function frontmatterToRecord(fm: JsonObject, relPath: string): JsonObject {
  const record: JsonObject = {
    id: fm.id as string,
    created_at: fm.created_at as string,
    kind: fm.kind as string,
    refs: (fm.refs as JsonObject) ?? {},
    tags: Array.isArray(fm.tags) ? (fm.tags as string[]).map(String) : [],
    summary: fm.summary as string,
    file_path: relPath,
  };
  if (fm.work_started_at) record.work_started_at = fm.work_started_at;
  if (fm.work_ended_at) record.work_ended_at = fm.work_ended_at;
  if (fm.motivation) record.motivation = fm.motivation;
  if (fm.approach) record.approach = fm.approach;
  if (Array.isArray(fm.attempts) && fm.attempts.length > 0) {
    record.attempts = [...fm.attempts];
  }
  if (Array.isArray(fm.lessons) && fm.lessons.length > 0) {
    record.lessons = [...fm.lessons];
  }
  if (Array.isArray(fm.decisions) && fm.decisions.length > 0) {
    record.decisions = [...fm.decisions];
  } else if (fm.decisions && !Array.isArray(fm.decisions)) {
    record.decisions = fm.decisions;
  }
  if (Array.isArray(fm.next_steps) && fm.next_steps.length > 0) {
    record.next_steps = [...fm.next_steps];
  } else if (fm.next_steps && !Array.isArray(fm.next_steps)) {
    record.next_steps = fm.next_steps;
  }
  if (Array.isArray(fm.blockers) && fm.blockers.length > 0) {
    record.blockers = [...fm.blockers];
  } else if (fm.blockers && !Array.isArray(fm.blockers)) {
    record.blockers = fm.blockers;
  }
  if (fm.per_day_summaries && typeof fm.per_day_summaries === 'object' && !Array.isArray(fm.per_day_summaries)) {
    const map = fm.per_day_summaries as Record<string, unknown>;
    const trimmed: Record<string, string> = {};
    for (const [day, text] of Object.entries(map)) {
      if (typeof text === 'string' && text.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        trimmed[day] = text;
      }
    }
    if (Object.keys(trimmed).length > 0) record.per_day_summaries = trimmed;
  }
  return record;
}

/** Stable sort order for scanned records: chronological by work_started_at
 *  (falling back to created_at), tie-broken by id. */
function indexSortKey(rec: JsonObject): [string, string] {
  const a = (rec.work_started_at as string) || (rec.created_at as string) || '';
  const b = (rec.id as string) || '';
  return [a, b];
}

// ---------------------------------------------------------------------------
// synthesis-state.json — per-project incremental hints
//
// Stored at <project_root>/synthesis-state.json. Holds per-session cursors
// (which session was processed up to when), so the next synthesizer run
// knows where the prior run left off. Cursors are hints, not filters — the
// agent still sees pre-cursor content for context, but synthesizes only
// post-cursor events. `synth-state advance` is idempotent and only moves
// cursors forward; running it with older timestamps is a no-op.
// ---------------------------------------------------------------------------

export const SYNTHESIS_STATE_JSON = 'synthesis-state.json';

export interface SynthesisState {
  version: number;
  session_cursors: Record<string, string>;
  last_run_at: string | null;
}

function synthesisStatePath(cwd?: string): string {
  return path.join(projectRoot(cwd), SYNTHESIS_STATE_JSON);
}

function emptySynthesisState(): SynthesisState {
  return { version: 1, session_cursors: {}, last_run_at: null };
}

export function readSynthesisState(cwd?: string): SynthesisState {
  const p = synthesisStatePath(cwd);
  if (!fs.existsSync(p)) return emptySynthesisState();
  const raw = readJsonOr(p, {}) as JsonObject;
  const cursors: Record<string, string> = {};
  const src = (raw.session_cursors as JsonObject) ?? {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string' && v !== '') cursors[k] = v;
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    session_cursors: cursors,
    last_run_at: typeof raw.last_run_at === 'string' ? raw.last_run_at : null,
  };
}

export function writeSynthesisState(state: SynthesisState, cwd?: string): void {
  const p = synthesisStatePath(cwd);
  writeJson(p, {
    version: state.version,
    session_cursors: state.session_cursors,
    last_run_at: state.last_run_at,
  });
}

/**
 * Merge incoming cursors into the on-disk state. Monotonic forward: for any
 * session key, the stored timestamp only moves up. Always bumps `last_run_at`
 * to `now()` so callers don't need to pass it in.
 *
 * Returns the merged state (post-write) for the caller to surface.
 */
export function advanceSynthesisCursors(
  updates: Record<string, string>,
  cwd?: string,
): SynthesisState {
  const cur = readSynthesisState(cwd);
  for (const [sid, ts] of Object.entries(updates)) {
    if (typeof ts !== 'string' || ts === '') continue;
    const prev = cur.session_cursors[sid];
    if (!prev || ts > prev) cur.session_cursors[sid] = ts;
  }
  cur.last_run_at = isoUtcNow();
  writeSynthesisState(cur, cwd);
  return cur;
}

// ---------------------------------------------------------------------------
// recentEntriesMarkdown — concatenated full-text of the N most recent entries
//
// The synth-context CLI surfaces this so the synthesizer can sustain
// vocabulary, decide "extend vs open new," and avoid double-attributing
// commits. Returns up to `limit` entries, newest first, separated by a
// machine-recognizable fence (`\n\n===WORK-MEMORY-ENTRY-BOUNDARY===\n\n`).
// Sort key: work_ended_at || work_started_at || created_at, descending.
// ---------------------------------------------------------------------------

const ENTRY_BOUNDARY = '\n\n===WORK-MEMORY-ENTRY-BOUNDARY===\n\n';

export function recentEntriesMarkdown(limit: number, cwd?: string): string {
  const projRoot = projectRoot(cwd);
  const rows = readIndex(cwd);
  const sortKey = (r: JsonObject): string =>
    (r.work_ended_at as string) ||
    (r.work_started_at as string) ||
    (r.created_at as string) ||
    '';
  const sorted = [...rows].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka === kb) return 0;
    return ka < kb ? 1 : -1;
  });
  const head = sorted.slice(0, Math.max(0, limit));
  const chunks: string[] = [];
  for (const r of head) {
    const rel = r.file_path as string | undefined;
    if (!rel) continue;
    const abs = path.join(projRoot, ...rel.split('/'));
    try {
      const text = fs.readFileSync(abs, 'utf8');
      chunks.push(text.trim());
    } catch {
      // Index references a missing file — skip silently rather than fail.
    }
  }
  return chunks.join(ENTRY_BOUNDARY);
}

/**
 * Returns every entry record for the project. Historically read from a
 * cached `index.json`; now sourced directly from the .md files under
 * `log/entries/<YYYY-MM>/`. Kept under the original name because every
 * caller treats it as "give me the full record list" — the underlying
 * implementation change is transparent.
 */
export function readIndex(cwd?: string): JsonObject[] {
  return scanEntries({ cwd });
}

export function readIndexRecordsByIds(ids: string[], cwd?: string): JsonObject[] {
  const byId = new Map<string, JsonObject>();
  for (const r of readIndex(cwd)) {
    const rid = r.id as string | undefined;
    if (rid && !byId.has(rid)) byId.set(rid, r);
  }
  const out: JsonObject[] = [];
  for (const id of ids) {
    const rec = byId.get(id);
    if (rec) out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// scanEntries — the durable read path. Walks log/entries/<YYYY-MM>/*.md
// directly, parses each frontmatter, and projects to the canonical entry
// record shape. The single source of truth for all queries; .md files on
// disk are the only authoritative copy.
//
// Monthly partition + ISO-prefixed filenames give us a free range filter:
// when a window is passed we only walk month dirs <= windowEnd, and skip
// individual files whose filename-date is past windowEnd. Lower bound
// is deferred to per-record overlap filtering in queryEntries — an
// entry filed in month M can have work_ended_at extending past M, so
// dropping months strictly before windowStart would silently miss those.
// ---------------------------------------------------------------------------

export interface ScanEntriesOptions {
  cwd?: string;
  /** Inclusive YYYY-MM-DD start of window. If unset, no lower bound. */
  windowStart?: string;
  /** Inclusive YYYY-MM-DD end of window. If unset, no upper bound. */
  windowEnd?: string;
}

/** YYYY-MM-DDTHH-MM-SS_e_… → date portion (YYYY-MM-DD). */
const FILENAME_DATE_RE = /^(\d{4}-\d{2}-\d{2})T/;

/** Enumerate YYYY-MM directories that may contain entries overlapping the
 *  window. We only apply an *upper* bound: entries are filed by
 *  work_started_at, so a month strictly before windowStart can still hold
 *  an entry whose work_ended_at extends into the window (cross-month
 *  work). Dropping lower months would silently lose those entries —
 *  caller-side per-record overlap filtering catches them instead.  */
function monthDirsForWindow(
  entriesRoot: string,
  _windowStart: string | undefined,
  windowEnd: string | undefined,
): string[] {
  let allMonths: string[];
  try {
    allMonths = fs
      .readdirSync(entriesRoot)
      .filter((d) => /^\d{4}-\d{2}$/.test(d))
      .sort();
  } catch {
    return [];
  }
  if (!windowEnd) return allMonths.map((m) => path.join(entriesRoot, m));
  const endMonth = windowEnd.slice(0, 7);
  return allMonths.filter((m) => m <= endMonth).map((m) => path.join(entriesRoot, m));
}

export function scanEntries(opts: ScanEntriesOptions = {}): JsonObject[] {
  const projRoot = projectRoot(opts.cwd);
  const entriesRoot = path.join(projRoot, 'log', 'entries');
  const monthDirs = monthDirsForWindow(entriesRoot, opts.windowStart, opts.windowEnd);

  const records: JsonObject[] = [];
  for (const monthDir of monthDirs) {
    let files: string[];
    try {
      files = fs.readdirSync(monthDir);
    } catch {
      continue;
    }
    const monthName = path.basename(monthDir);
    for (const fn of files) {
      if (!fn.endsWith('.md')) continue;
      // Filename-level pre-filter: an entry's date is the prefix of its
      // filename, so we can skip files outside the window without opening them.
      // We allow the entry through if its filename-date OR its work_ended_at
      // (read from frontmatter) intersects the window — but the cheap check
      // first: if the filename date is strictly outside [start, end], drop it.
      if (opts.windowStart || opts.windowEnd) {
        const m = FILENAME_DATE_RE.exec(fn);
        const fnDate = m?.[1];
        if (fnDate) {
          if (opts.windowEnd && fnDate > opts.windowEnd) continue;
          // Lower bound is fuzzier — an entry that *started* before the
          // window may have *ended* inside it (cross-day work). So we
          // can't strictly drop on filename < windowStart. Defer to the
          // frontmatter check below.
        }
      }
      const abs = path.join(monthDir, fn);
      let text: string;
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      let fm: JsonObject;
      try {
        ({ fm } = splitFrontmatter(text));
      } catch {
        // Malformed frontmatter: skip rather than fail the whole scan.
        continue;
      }
      const relPath = toPosixRel(['log', 'entries', monthName, fn]);
      records.push(frontmatterToRecord(fm, relPath));
    }
  }

  records.sort((x, y) => {
    const kx = indexSortKey(x);
    const ky = indexSortKey(y);
    if (kx[0] !== ky[0]) return kx[0] < ky[0] ? -1 : 1;
    if (kx[1] !== ky[1]) return kx[1] < ky[1] ? -1 : 1;
    return 0;
  });
  return records;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertYmd(value: string): void {
  if (!YMD_RE.test(value)) {
    throw new Error(
      `invalid window date '${value}' — expected ISO date YYYY-MM-DD (or the words 'today' / 'yesterday', or 'YYYY-MM-DD..YYYY-MM-DD' for a range)`,
    );
  }
}

function parseWindow(window: string, tz: string): [string, string] {
  const today = dateInTimezone(new Date(), tz);
  if (window === 'today') return [today, today];
  if (window === 'yesterday') {
    const y = shiftDate(today, -1);
    return [y, y];
  }
  if (window.includes('..')) {
    const [a, b] = window.split('..', 2) as [string, string];
    assertYmd(a);
    assertYmd(b);
    return [a, b];
  }
  assertYmd(window);
  return [window, window];
}

export function shiftDate(yyyymmdd: string, deltaDays: number): string {
  const parts = yyyymmdd.split('-');
  if (parts.length !== 3) throw new Error(`bad date: ${yyyymmdd}`);
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export interface QueryOptions {
  window?: string;
  kind?: string[];
  task?: string;
  spec?: string;
  session?: string;
  includeBody?: boolean;
  cwd?: string;
}

export function queryEntries(opts: QueryOptions = {}): JsonObject[] {
  const { window, kind, task, spec, session, includeBody = false, cwd } = opts;
  const projRoot = projectRoot(cwd);
  let rows: JsonObject[] = [...readIndex(cwd)];
  if (window) {
    const [start, end] = parseWindow(window, projectTimezone(cwd));
    rows = rows.filter((rec) => {
      try {
        const startTs = (rec.work_started_at as string) || (rec.created_at as string);
        const endTs = (rec.work_ended_at as string) || startTs;
        if (!startTs) return false;
        const dStart = startTs.slice(0, 10);
        const dEnd = endTs.slice(0, 10);
        return dStart <= end && dEnd >= start;
      } catch {
        return false;
      }
    });
  }
  if (kind && kind.length > 0) {
    const kindSet = new Set(kind);
    rows = rows.filter((r) => kindSet.has(r.kind as string));
  }
  if (task) rows = rows.filter((r) => ((r.refs as JsonObject) ?? {}).task === task);
  if (spec) rows = rows.filter((r) => ((r.refs as JsonObject) ?? {}).spec === spec);
  if (session) rows = rows.filter((r) => r.session_id === session);

  if (!includeBody) return [...rows];

  const out: JsonObject[] = [];
  for (const r of rows) {
    const full: JsonObject = { ...r };
    try {
      const filePath = path.join(projRoot, ...(r.file_path as string).split('/'));
      const text = fs.readFileSync(filePath, 'utf8');
      const { body } = splitFrontmatter(text);
      full.narrative = body.trim();
    } catch {
      full.narrative = '';
    }
    out.push(full);
  }
  return out;
}
