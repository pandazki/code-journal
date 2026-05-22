/**
 * @code-journal/cli — argv → core router.
 *
 * Subcommands match code_journal/cli.py byte-for-byte where output matters
 * (e.g. JSON formatting, error messages tested by the integration tests).
 *
 * Exposes a `main(argv): Promise<number>` plus a CommonJS top-level invocation
 * when run as a script (the tsup bundle's shebang is what makes it executable).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import {
  CONFIG_JSON,
  DEFAULT_CATCHUP_LOOKBACK_DAYS,
  JsonObject,
  ProjectKey,
  ReportMeta,
  addCwdToConfig,
  advanceSynthesisCursors,
  appendEntryFromText,
  atomicWriteFileSync,
  canonicalizeCwd,
  cwdsForProject,
  defaultProject,
  deleteProject,
  ensureDirs,
  findAllProjectsClaimingCwd,
  findProjectKeyForCwd,
  formatProjectKey,
  getDotted,
  isoLocalNow,
  isoUtcNow,
  listPendingDaily,
  listRegisteredProjects,
  loadProject,
  localTzOffsetIso,
  makeProjectKey,
  parseReportMeta,
  projectConfigPath,
  projectRoot,
  projectRootFor,
  queryEntries,
  readSynthesisState,
  recentEntriesMarkdown,
  removeCwdFromConfig,
  requireProjectKeyForCwd,
  shiftLocalDate,
  summarizeProjectForDelete,
  todayLocalDate,
  writeProject,
  writeReport,
} from '@code-journal/core';

const CLI_VERSION = '0.2.0-dev';

type ExitCode = number;

interface CliContext {
  cwd: string;
  stdin?: string;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

async function cmdInit(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      'user-id': { type: 'string' },
      'org-id': { type: 'string' },
      'project-id': { type: 'string' },
      'display-name': { type: 'string', default: '' },
      'report-language': { type: 'string' },
    },
    allowPositionals: false,
  });
  const userId = values['user-id'] as string | undefined;
  const orgId = values['org-id'] as string | undefined;
  const projectId = values['project-id'] as string | undefined;
  if (!userId || !orgId || !projectId) {
    process.stderr.write('init: --user-id, --org-id, and --project-id are all required\n');
    return 2;
  }
  let key: ProjectKey;
  try {
    key = makeProjectKey(userId, orgId, projectId);
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 2;
  }
  const keyStr = formatProjectKey(key);
  // Canonicalize so symlink / case-variant aliases match what we'd later
  // try to look up via findProjectKeyForCwd.
  const cwd = canonicalizeCwd(process.cwd());
  const projRoot = projectRootFor(key);
  const cfgPath = path.join(projRoot, CONFIG_JSON);

  // Reverse-lookup: is this cwd already registered to some project? Source
  // of truth is `config.cwds[]`; there is no <cwd>/.code-journal pointer
  // anymore (deleted as part of the no-pointer refactor, 2026-05-13).
  let existingForCwd;
  try {
    existingForCwd = findProjectKeyForCwd(cwd);
  } catch (exc) {
    // Multi-project overlap detected — refuse hard so the user sees the
    // corruption signal instead of silently routing to the wrong project.
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
  if (existingForCwd) {
    const existingStr = formatProjectKey(existingForCwd);
    if (existingStr !== keyStr) {
      process.stderr.write(
        `this cwd is already registered to project '${existingStr}'; refusing to switch to '${keyStr}'. Manually remove ${cwd} from that project's config.cwds[] first.\n`,
      );
      return 1;
    }
    // Same key: idempotent no-op (refresh dirs + bump last_updated).
    process.stdout.write(`code-journal already initialized at ${cfgPath}\n`);
    ensureDirs(projRoot);
    // Skip addCwdToConfig when cwd IS the project root itself — project
    // roots resolve via the fast-path and are explicitly disallowed from
    // any cwds[] entry. There's nothing to register; the project already
    // identifies itself by its on-disk location.
    if (canonicalizeCwd(cwd) !== canonicalizeCwd(projRoot)) {
      addCwdToConfig(key, cwd);
    }
    return 0;
  }

  if (fs.existsSync(cfgPath)) {
    // Project root exists at the requested key (from another cwd), but the
    // current cwd isn't yet in its cwds[]. Join: append cwd, refresh dirs.
    ensureDirs(projRoot);
    addCwdToConfig(key, cwd);
    process.stdout.write(`code-journal already initialized at ${cfgPath}\n`);
    process.stdout.write(`  → joined existing project '${keyStr}'; cwd recorded.\n`);
    return 0;
  }

  // Fresh project — config.json is written ONCE with cwds + timestamps
  // already in place. Previously this was two writes (writeProject then
  // a read-modify-write to stamp cwds), which left a brief observable
  // `cwds: []` state that concurrent `whoami` / `list-projects` calls
  // could pick up.
  const proj = defaultProject(key, {
    displayName: (values['display-name'] as string) || '',
    reportLanguage: (values['report-language'] as string) || undefined,
  });
  const now = isoUtcNow();
  writeProject(proj, projRoot, { cwds: [cwd], first_registered: now, last_updated: now });
  ensureDirs(projRoot);

  process.stdout.write(`Initialized code-journal at ${cfgPath}\n`);
  process.stdout.write(`  → registered cwd: ${cwd}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// append-entry
// ---------------------------------------------------------------------------

async function cmdAppendEntry(rest: string[], ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      file: { type: 'string' },
      stdin: { type: 'boolean', default: false },
      // --dry-run: parse + validate the entry and compute the would-be id /
      // file_path, but don't write the file or update index.json. Lets agents
      // and humans probe the schema (or a hand-written candidate) without
      // leaving a half-baked row that has to be cleaned up after.
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const srcFile = (values.file as string) ?? null;
  const fromStdin = Boolean(values.stdin);
  if ((srcFile === null) === !fromStdin) {
    process.stderr.write('Provide exactly one of --file or --stdin.\n');
    return 2;
  }
  let md: string;
  if (srcFile !== null) {
    const p = path.resolve(srcFile);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      process.stderr.write(`--file: '${srcFile}' is not a file\n`);
      return 2;
    }
    md = fs.readFileSync(p, 'utf8');
  } else {
    md = ctx.stdin ?? (await readAllStdin());
  }
  const dryRun = Boolean(values['dry-run']);
  try {
    const rec = appendEntryFromText(md, undefined, { dryRun });
    const verb = dryRun ? 'would append' : 'appended';
    process.stdout.write(`${verb} ${rec.id} → ${rec.file_path}\n`);
    return 0;
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// config get
// ---------------------------------------------------------------------------

async function cmdConfig(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  // first positional is subcommand: "get"
  if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
    printConfigHelp();
    return 0;
  }
  if (rest[0] !== 'get') {
    printConfigHelp();
    return 0;
  }
  const dottedKey = rest[1];
  if (!dottedKey) {
    process.stderr.write('config get: dotted-key required\n');
    return 2;
  }
  try {
    const data = JSON.parse(fs.readFileSync(projectConfigPath(), 'utf8') || '{}');
    const value = getDotted(data, dottedKey);
    if (typeof value === 'boolean') {
      process.stdout.write(value ? 'true\n' : 'false\n');
    } else if (value !== null && typeof value === 'object') {
      process.stdout.write(JSON.stringify(value) + '\n');
    } else {
      process.stdout.write(String(value) + '\n');
    }
    return 0;
  } catch (err) {
    // Surface the underlying failure (KeyError, missing config.json, etc.)
    // so the user can tell "this key doesn't exist" from "the CLI broke."
    process.stderr.write(`config get ${dottedKey}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function printConfigHelp(): void {
  process.stdout.write('usage: code-journal config get <dotted.key>\n');
}

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

async function cmdQuery(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      window: { type: 'string' },
      kind: { type: 'string', multiple: true },
      task: { type: 'string' },
      spec: { type: 'string' },
      session: { type: 'string' },
      'include-body': { type: 'boolean', default: false },
      format: { type: 'string', default: 'frontmatter-only' },
    },
    allowPositionals: false,
  });
  const fmt = String(values.format ?? 'frontmatter-only');
  if (fmt !== 'json' && fmt !== 'frontmatter-only' && fmt !== 'md') {
    process.stderr.write(`query: invalid --format '${fmt}'\n`);
    return 2;
  }
  const rows = queryEntries({
    window: (values.window as string) ?? undefined,
    kind: ((values.kind as string[]) ?? []).length > 0 ? (values.kind as string[]) : undefined,
    task: (values.task as string) ?? undefined,
    spec: (values.spec as string) ?? undefined,
    session: (values.session as string) ?? undefined,
    includeBody: Boolean(values['include-body']) || fmt === 'md',
  });
  if (fmt === 'json') {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else if (fmt === 'frontmatter-only') {
    const bare = rows.map((r) => {
      const out: JsonObject = { ...r };
      delete out.narrative;
      return out;
    });
    process.stdout.write(JSON.stringify(bare, null, 2) + '\n');
  } else {
    for (const r of rows) {
      process.stdout.write(
        `## ${r.summary ?? ''}  [${r.kind ?? ''}] (${r.created_at ?? ''})\n`,
      );
      process.stdout.write(((r.narrative as string) ?? '') + '\n\n');
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// write-report
// ---------------------------------------------------------------------------

async function cmdWriteReport(rest: string[], ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      content: { type: 'string' },
      meta: { type: 'string' },
      'meta-format': { type: 'string', default: 'json' },
      force: { type: 'boolean', default: false },
      // Permit overwriting an existing report iff it's "stale" — i.e. its
      // `generated_at` falls on the same calendar day as its `window`. Stable
      // reports (generated after the day they cover ended) still refuse the
      // write. Used by the daily-report-drafter / Electron catch-up to keep
      // today's in-progress draft fresh without clobbering yesterday's final.
      'replace-if-stale': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const content = values.content as string | undefined;
  const meta = values.meta as string | undefined;
  if (!content || !meta) {
    process.stderr.write('write-report: --content and --meta are required\n');
    return 2;
  }
  let bodyText: string;
  let metaText: string;
  if (content === '-' && meta === '-') {
    const raw = ctx.stdin ?? (await readAllStdin());
    const parts = raw.split('---META---\n');
    if (parts.length < 2) {
      process.stderr.write('write-report: stdin missing ---META--- marker\n');
      return 2;
    }
    const tail = parts[1] ?? '';
    const splitIdx = tail.indexOf('---CONTENT---\n');
    if (splitIdx < 0) {
      process.stderr.write('write-report: stdin missing ---CONTENT--- marker\n');
      return 2;
    }
    metaText = tail.slice(0, splitIdx);
    bodyText = tail.slice(splitIdx + '---CONTENT---\n'.length);
  } else {
    bodyText = content === '-' ? (ctx.stdin ?? (await readAllStdin())) : fs.readFileSync(content, 'utf8');
    metaText = meta === '-' ? (ctx.stdin ?? (await readAllStdin())) : fs.readFileSync(meta, 'utf8');
  }
  const metaObj = JSON.parse(metaText) as JsonObject;
  if (!metaObj.created_at) metaObj.created_at = isoUtcNow();
  // generated_at is the wall-clock generation time (host local TZ). Most
  // drafters won't set this explicitly — the CLI fills it in so every
  // report file documents WHEN it was produced (vs `window`, which is the
  // *period covered* by the report). Drafters can still override by
  // sending an explicit generated_at in meta.
  if (!metaObj.generated_at) metaObj.generated_at = isoLocalNow();
  let rm: ReportMeta;
  try {
    rm = parseReportMeta(metaObj);
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
  try {
    const p = writeReport({
      content: bodyText,
      meta: rm,
      force: Boolean(values.force),
      replaceIfStale: Boolean(values['replace-if-stale']),
    });
    const rel = path.relative(projectRoot(), p);
    process.stdout.write(`wrote report → ${rel}\n`);
    return 0;
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// list-projects
// ---------------------------------------------------------------------------

async function cmdListProjects(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      json: { type: 'boolean', default: false },
      'ids-only': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const projects = listRegisteredProjects();
  if (values.json) {
    process.stdout.write(
      JSON.stringify({ version: 1, projects }, null, 2) + '\n',
    );
    return 0;
  }
  const ids = Object.keys(projects).sort();
  if (values['ids-only']) {
    for (const pid of ids) process.stdout.write(pid + '\n');
    return 0;
  }
  if (ids.length === 0) return 0;
  for (const pid of ids) {
    const entry = projects[pid]!;
    const display = entry.display_name || pid;
    process.stdout.write(`${pid}  (${display})\n`);
    for (const cwd of entry.cwds) process.stdout.write(`  ${cwd}\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// list-pending-reports
// ---------------------------------------------------------------------------

async function cmdListPendingReports(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      type: { type: 'string', default: 'daily' },
      'lookback-days': { type: 'string', default: String(DEFAULT_CATCHUP_LOOKBACK_DAYS) },
    },
    allowPositionals: false,
  });
  if (values.type !== 'daily') {
    process.stderr.write(`list-pending-reports: only --type=daily supported\n`);
    return 2;
  }
  const lookback = Number(values['lookback-days']);
  const pending = listPendingDaily({
    lookbackDays: Number.isFinite(lookback) ? lookback : DEFAULT_CATCHUP_LOOKBACK_DAYS,
  });
  process.stdout.write(JSON.stringify({ pending }) + '\n');
  return 0;
}


// ---------------------------------------------------------------------------
// whoami — "which project does this cwd belong to?"
// ---------------------------------------------------------------------------

async function cmdWhoami(_rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const key = findProjectKeyForCwd();
  if (!key) {
    process.stderr.write('not a code-journal project (cwd not registered in any config.cwds[])\n');
    return 1;
  }
  process.stdout.write(formatProjectKey(key) + '\n');
  return 0;
}

// ---------------------------------------------------------------------------
// unregister-cwd — drop a cwd from a project's config.cwds[]
//
// The sanctioned way to disconnect a cwd from a project without deleting
// the project. Without this, users would resort to hand-editing
// `config.json` — which is exactly the failure mode that produces the
// "multiple projects claim same cwd" corruption findProjectKeyForCwd
// now hard-rejects. Use cases: directory moved or renamed, project key
// scheme changed, accidental init in the wrong cwd.
// ---------------------------------------------------------------------------

async function cmdUnregisterCwd(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      cwd: { type: 'string' },
      'user-id': { type: 'string' },
      'org-id': { type: 'string' },
      'project-id': { type: 'string' },
      key: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  const targetCwd = canonicalizeCwd((values.cwd as string) ?? process.cwd());

  // Resolve which project owns this cwd. Three modes:
  //   (a) Explicit --user-id/--org-id/--project-id or --key — use that.
  //   (b) Nothing — auto-detect via findAllProjectsClaimingCwd; require
  //       exactly one match, otherwise ask the user to disambiguate.
  let userId = values['user-id'] as string | undefined;
  let orgId = values['org-id'] as string | undefined;
  let projectId = values['project-id'] as string | undefined;
  const composite = values.key as string | undefined;
  if (composite) {
    const parts = composite.split('/');
    if (parts.length !== 3 || parts.some((p) => !p)) {
      process.stderr.write(`--key must look like 'userId/orgId/projectId' (got '${composite}')\n`);
      return 2;
    }
    [userId, orgId, projectId] = parts as [string, string, string];
  }

  let key: ProjectKey;
  if (userId && orgId && projectId) {
    try {
      key = makeProjectKey(userId, orgId, projectId);
    } catch (err) {
      process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
      return 2;
    }
  } else if (!userId && !orgId && !projectId) {
    const matches = findAllProjectsClaimingCwd(targetCwd);
    if (matches.length === 0) {
      process.stderr.write(`no project has ${targetCwd} in its config.cwds[]\n`);
      return 1;
    }
    if (matches.length > 1) {
      const keys = matches.map((m) => formatProjectKey(m.key)).join(', ');
      process.stderr.write(
        `${targetCwd} is claimed by multiple projects (${keys}). ` +
        `Pass --user-id/--org-id/--project-id (or --key) to pick one.\n`,
      );
      return 1;
    }
    key = matches[0]!.key;
  } else {
    process.stderr.write(
      'specify the project via --user-id, --org-id, --project-id (or --key u/o/p), ' +
      'or omit all three to auto-detect from the cwd.\n',
    );
    return 2;
  }

  const removed = removeCwdFromConfig(key, targetCwd);
  if (!removed) {
    process.stderr.write(
      `${targetCwd} was not in project '${formatProjectKey(key)}' config.cwds[]\n`,
    );
    return 1;
  }
  process.stdout.write(`unregistered ${targetCwd} from ${formatProjectKey(key)}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// delete-project — wipes a project's user-home tree (gated by --confirm)
// ---------------------------------------------------------------------------

async function cmdDeleteProject(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      'user-id': { type: 'string' },
      'org-id': { type: 'string' },
      'project-id': { type: 'string' },
      key: { type: 'string' },
      // `--confirm` now takes the project key as a string value: the caller
      // must echo back `<userId>/<orgId>/<projectId>` exactly. A bare boolean
      // flag is too easy to trip on by accident (an Electron app misfiring,
      // an argv shim, a shell history mishap). Echoing the key forces the
      // caller — human or program — to compute it from real state.
      confirm: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  let userId = values['user-id'] as string | undefined;
  let orgId = values['org-id'] as string | undefined;
  let projectId = values['project-id'] as string | undefined;
  const composite = values.key as string | undefined;
  if (composite) {
    const parts = composite.split('/');
    if (parts.length !== 3 || parts.some((p) => !p)) {
      process.stderr.write(`--key must look like 'userId/orgId/projectId' (got '${composite}')\n`);
      return 2;
    }
    [userId, orgId, projectId] = parts as [string, string, string];
  }
  if (!userId || !orgId || !projectId) {
    process.stderr.write(
      'delete-project requires --user-id, --org-id, --project-id (or --key userId/orgId/projectId)\n',
    );
    return 2;
  }

  let key: ProjectKey;
  try {
    key = makeProjectKey(userId, orgId, projectId);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    return 2;
  }
  const expectedKey = formatProjectKey(key);
  const confirmValue = values.confirm as string | undefined;

  // Validate `--confirm` value (when given): must match the project key.
  if (confirmValue !== undefined && confirmValue !== expectedKey) {
    process.stderr.write(
      `--confirm value '${confirmValue}' does not match project key '${expectedKey}'. ` +
      `Pass --confirm ${expectedKey} to actually delete.\n`,
    );
    return 2;
  }
  const shouldDelete = confirmValue === expectedKey;

  let summary;
  try {
    summary = shouldDelete ? deleteProject(key) : summarizeProjectForDelete(key);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    return 1;
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (!shouldDelete) {
    process.stderr.write(
      `dry-run: pass --confirm ${expectedKey} to permanently delete ${summary.project_root} ` +
      `(${summary.entry_count} entries, ${summary.report_count} reports)\n`,
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// synth-context — bundle everything the work-log-synthesizer needs
//
// One CLI call returns the project's identity, the full set of registered
// cwds (so the synthesizer can union session sources without re-running
// list-projects), the discovery window in the user's LOCAL timezone (so
// "today" matches their wall clock), the per-session cursors that mark
// "already-processed up to," and the recent entries' full markdown so the
// synthesizer can sustain vocabulary and decide extend-vs-open.
//
// Format: `--format json` is the only supported output today (the agent
// always parses); we accept the flag so we can add `text` later without
// breaking callers.
// ---------------------------------------------------------------------------

async function cmdSynthContext(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      format: { type: 'string', default: 'json' },
      'recent-entries-limit': { type: 'string', default: '5' },
    },
    allowPositionals: false,
  });
  if (values.format !== 'json') {
    process.stderr.write(`synth-context: only --format=json is supported (got '${values.format}')\n`);
    return 2;
  }
  const limit = Number(values['recent-entries-limit']);
  const recentLimit = Number.isFinite(limit) && limit >= 0 ? limit : 5;

  let key: ProjectKey;
  try {
    key = requireProjectKeyForCwd();
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
  const projRoot = projectRootFor(key);
  const cwds = cwdsForProject(key);

  // Discovery window in local-tz natural days. Honors
  // `report.catchup_lookback_days`; if the config is unreadable / missing
  // the key, falls back to the project-level default (DEFAULT_CATCHUP_LOOKBACK_DAYS)
  // — consistent with what a fresh `defaultProject` would have produced,
  // rather than a separate "recovery floor" that was silently narrower.
  let lookbackDays = DEFAULT_CATCHUP_LOOKBACK_DAYS;
  try {
    const data = JSON.parse(fs.readFileSync(projectConfigPath(), 'utf8') || '{}');
    const v = getDotted(data, 'report.catchup_lookback_days');
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) lookbackDays = Math.floor(n);
  } catch {
    // No config / no report block — default to 1 day.
  }
  const todayLocal = todayLocalDate();
  const startLocal = shiftLocalDate(todayLocal, -(lookbackDays - 1));
  const window = `${startLocal}..${todayLocal}`;
  const tzOffset = localTzOffsetIso();

  const synthDir = path.join(projRoot, '.synth', 'current');
  try {
    fs.mkdirSync(synthDir, { recursive: true });
  } catch {
    // best-effort; not fatal — caller can still spawn elsewhere
  }

  const state = readSynthesisState();
  const recent = recentLimit > 0 ? recentEntriesMarkdown(recentLimit) : '';

  const payload = {
    version: 1,
    project_key: formatProjectKey(key),
    project_id: key.projectId,
    project_root: projRoot,
    cwds,
    synth_workdir: synthDir,
    window: { start_local: startLocal, today_local: todayLocal, range: window, tz_offset: tzOffset, lookback_days: lookbackDays },
    session_cursors: state.session_cursors,
    last_run_at: state.last_run_at,
    recent_entries_md: recent,
    recent_entries_limit: recentLimit,
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  return 0;
}

// ---------------------------------------------------------------------------
// synth-state — get / advance per-session cursors
// ---------------------------------------------------------------------------

async function cmdSynthState(rest: string[], ctx: CliContext): Promise<ExitCode> {
  if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
    process.stdout.write(
      'usage: code-journal synth-state get | synth-state advance --stdin\n',
    );
    return 0;
  }
  const sub = rest[0]!;
  const subRest = rest.slice(1);
  try {
    requireProjectKeyForCwd();
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
  if (sub === 'get') {
    const state = readSynthesisState();
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    return 0;
  }
  if (sub === 'advance') {
    const { values } = parseArgs({
      args: subRest,
      options: { stdin: { type: 'boolean', default: false } },
      allowPositionals: false,
    });
    if (!values.stdin) {
      process.stderr.write('synth-state advance: --stdin is required (pipe JSON {session_cursors: {...}})\n');
      return 2;
    }
    const raw = ctx.stdin ?? (await readAllStdin());
    let parsed: JsonObject;
    try {
      parsed = JSON.parse(raw || '{}') as JsonObject;
    } catch (exc) {
      process.stderr.write(`synth-state advance: invalid JSON on stdin (${(exc as Error).message})\n`);
      return 2;
    }
    const cursors: Record<string, string> = {};
    const src = (parsed.session_cursors as JsonObject) ?? {};
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string' && v !== '') cursors[k] = v;
    }
    const merged = advanceSynthesisCursors(cursors);
    process.stdout.write(JSON.stringify(merged, null, 2) + '\n');
    return 0;
  }
  process.stderr.write(`synth-state: unknown subcommand '${sub}' (expected 'get' or 'advance')\n`);
  return 2;
}

// ---------------------------------------------------------------------------
// schedule — get / set the recurring synth schedule (top-level `schedule`)
// ---------------------------------------------------------------------------

async function cmdSchedule(rest: string[], _ctx: CliContext): Promise<ExitCode> {
  if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
    process.stdout.write(
      [
        'usage:',
        '  code-journal schedule get',
        '  code-journal schedule set --mode manual',
        '  code-journal schedule set --mode daily --time HH:MM',
        '  code-journal schedule set --mode weekly --time HH:MM --weekday 0-6',
      ].join('\n') + '\n',
    );
    return 0;
  }
  let key: ProjectKey;
  try {
    key = requireProjectKeyForCwd();
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
  const cfgPath = path.join(projectRootFor(key), CONFIG_JSON);

  if (rest[0] === 'get') {
    const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8') || '{}') as JsonObject;
    const schedule = (data.schedule as JsonObject) ?? { mode: 'manual' };
    process.stdout.write(JSON.stringify(schedule, null, 2) + '\n');
    return 0;
  }
  if (rest[0] === 'set') {
    const { values } = parseArgs({
      args: rest.slice(1),
      options: {
        mode: { type: 'string' },
        time: { type: 'string' },
        weekday: { type: 'string' },
      },
      allowPositionals: false,
    });
    const mode = values.mode as string | undefined;
    if (!mode || (mode !== 'manual' && mode !== 'daily' && mode !== 'weekly')) {
      process.stderr.write(`schedule set: --mode must be 'manual', 'daily', or 'weekly'\n`);
      return 2;
    }
    const time = values.time as string | undefined;
    const weekdayStr = values.weekday as string | undefined;

    if (mode !== 'manual' && !time) {
      process.stderr.write(`schedule set: --time is required when --mode is '${mode}'\n`);
      return 2;
    }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      process.stderr.write(`schedule set: --time must be HH:MM (24h, got '${time}')\n`);
      return 2;
    }
    let weekday: number | null = null;
    if (mode === 'weekly') {
      if (!weekdayStr) {
        process.stderr.write(`schedule set: --weekday is required when --mode is 'weekly'\n`);
        return 2;
      }
      const n = Number(weekdayStr);
      if (!Number.isInteger(n) || n < 0 || n > 6) {
        process.stderr.write(`schedule set: --weekday must be 0-6 (Sun=0, got '${weekdayStr}')\n`);
        return 2;
      }
      weekday = n;
    }

    // Read-modify-write the project config. Belt-and-braces:
    //  - If parse fails entirely, throw (don't fall back to an empty object;
    //    that would clobber a valid-but-unreadable file on next write).
    //  - If parse succeeds but the config is missing `project_id`, refuse to
    //    write. The CLI elsewhere requires a Project to be set up, so an
    //    empty/half-baked config here means another writer truncated it (or
    //    we picked up a stale temp) — overwriting with just `schedule` +
    //    `last_updated` would destroy the rest of the config.
    let data: JsonObject;
    try {
      data = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as JsonObject;
    } catch (exc) {
      process.stderr.write(
        `schedule set: could not parse ${cfgPath} (${(exc as Error).message}); refusing to overwrite.\n`,
      );
      return 1;
    }
    if (!data || typeof data !== 'object' || !('project_id' in data) || !('cwds' in data)) {
      process.stderr.write(
        `schedule set: refusing to write — ${cfgPath} is missing project_id/cwds. Re-run \`code-journal init\` to repair, then retry.\n`,
      );
      return 1;
    }
    const next: JsonObject = { mode };
    if (mode !== 'manual') next.time = time as string;
    if (mode === 'weekly') next.weekday = weekday as number;
    data.schedule = next;
    data.last_updated = isoUtcNow();
    atomicWriteFileSync(cfgPath, JSON.stringify(data, null, 2) + '\n');
    process.stdout.write(JSON.stringify(next, null, 2) + '\n');
    return 0;
  }
  process.stderr.write(`schedule: unknown subcommand '${rest[0]}' (expected 'get' or 'set')\n`);
  return 2;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function printHelp(): void {
  process.stdout.write(
    [
      'code-journal: project code-journal CLI.',
      '',
      'Commands:',
      '  init                   Initialize a code-journal project at the cwd.',
      '  append-entry           Validate and append one Entry to the canonical log.',
      '  query                  Query the canonical log.',
      '  write-report           Save a report markdown.',
      '  list-projects          List every code-journal project under ~/.code-journal/projects/.',
      '  list-pending-reports   Print JSON {pending: [...]} for catchup.',
      '  config get             Read a value from config.json by dotted path.',
      '  whoami                 Print the project key (userId/orgId/projectId) for the current cwd.',
      '  unregister-cwd         Drop a cwd from a project\'s config.cwds[]. Defaults to current cwd',
      '                         + auto-detected project; pass --user-id/--org-id/--project-id to override.',
      '  delete-project         Delete a project tree. Dry-run unless --confirm <userId/orgId/projectId>.',
      '                         Requires --user-id/--org-id/--project-id (or --key userId/orgId/projectId).',
      '  synth-context          Emit JSON bundle the work-log-synthesizer needs: cwds[],',
      '                         discovery window, per-session cursors, recent entries\' markdown.',
      '  synth-state            get | advance --stdin — per-session cursor hints for incremental synth.',
      '  schedule               get | set --mode manual|daily|weekly [--time HH:MM] [--weekday 0-6]',
      '',
    ].join('\n'),
  );
}

type Handler = (rest: string[], ctx: CliContext) => Promise<ExitCode>;

const COMMANDS: Record<string, Handler> = {
  init: cmdInit,
  'append-entry': cmdAppendEntry,
  config: cmdConfig,
  query: cmdQuery,
  'write-report': cmdWriteReport,
  'list-projects': cmdListProjects,
  'list-pending-reports': cmdListPendingReports,
  whoami: cmdWhoami,
  'unregister-cwd': cmdUnregisterCwd,
  'delete-project': cmdDeleteProject,
  'synth-context': cmdSynthContext,
  'synth-state': cmdSynthState,
  schedule: cmdSchedule,
};

export async function main(argv: string[], ctx: Partial<CliContext> = {}): Promise<number> {
  const cwd = ctx.cwd ?? process.cwd();
  const context: CliContext = { cwd, stdin: ctx.stdin };

  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    process.stdout.write(`code-journal ${CLI_VERSION}\n`);
    return 0;
  }
  const cmd = argv[0]!;
  const rest = argv.slice(1);
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`code-journal: unknown command '${cmd}'\n`);
    return 2;
  }
  try {
    return await handler(rest, context);
  } catch (exc) {
    process.stderr.write(`${(exc as Error).message}\n`);
    return 1;
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Only auto-invoke when run as a script (not when imported by tests).
if (require.main === module) {
  void main(process.argv.slice(2)).then((rc) => {
    process.exit(rc);
  });
}
