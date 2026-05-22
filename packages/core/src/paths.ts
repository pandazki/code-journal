/**
 * Pointer-less path resolution.
 *
 * On-disk hierarchy mirrors the URL pattern `/:userId/:orgId/:projectId`:
 *
 *   ~/.code-journal/<userId>/<orgId>/projects/<projectId>/
 *                                                       ├── config.json
 *                                                       ├── index.json
 *                                                       ├── log/entries/
 *                                                       ├── reports/
 *                                                       └── .logs/
 *
 * There is no `<cwd>/.code-journal` pointer file. The project a cwd belongs
 * to is the project whose `config.cwds[]` contains that cwd — a reverse
 * scan over `~/.code-journal/<user>/<org>/projects/*​/config.json`.
 * `config.cwds[]` is the single source of truth; init is responsible for
 * keeping it in sync.
 *
 * Each tier is validated as a slug (`[A-Za-z0-9][A-Za-z0-9_-]*`); the
 * names `projects` / `agents` / `memory` are reserved at the userId/orgId
 * tiers so we can later add sibling categories under each user/org root.
 */
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export const USER_ROOT_DIR = '.code-journal';
export const PROJECTS_TIER = 'projects';
export const CONFIG_JSON = 'config.json';

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RESERVED_TIER_NAMES = new Set(['projects', 'agents', 'memory', '.', '..']);

export interface ProjectKey {
  userId: string;
  orgId: string;
  projectId: string;
}

export function assertSlug(field: string, value: string): void {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) {
    throw new Error(`${field} must match ${SLUG_RE} (got ${JSON.stringify(value)})`);
  }
  if (RESERVED_TIER_NAMES.has(value)) {
    throw new Error(`${field} ${JSON.stringify(value)} is reserved`);
  }
}

export function makeProjectKey(userId: string, orgId: string, projectId: string): ProjectKey {
  assertSlug('userId', userId);
  assertSlug('orgId', orgId);
  assertSlug('projectId', projectId);
  return { userId, orgId, projectId };
}

export function formatProjectKey(k: ProjectKey): string {
  return `${k.userId}/${k.orgId}/${k.projectId}`;
}

/** Absolute project root for a key:
 *  `~/.code-journal/<userId>/<orgId>/projects/<projectId>/`. */
export function projectRootFor(key: ProjectKey): string {
  return path.join(
    homedir(),
    USER_ROOT_DIR,
    key.userId,
    key.orgId,
    PROJECTS_TIER,
    key.projectId,
  );
}

/** Top-level user-home tree: `~/.code-journal/`. */
export function workMemoryRoot(): string {
  return path.join(homedir(), USER_ROOT_DIR);
}

/**
 * Canonicalize a cwd for comparison against entries in `config.cwds[]`.
 * `path.resolve` doesn't follow symlinks; we follow them where the path
 * exists so a project registered under the real path is still found when
 * the user later cd's via a symlinked alias (and vice versa). Falls back
 * to `path.resolve` when the path is missing — comparisons on
 * already-stored cwds against a recently-deleted dir still need to work.
 */
export function canonicalizeCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Comparison helper. macOS (APFS default) and Windows (NTFS) are
 * case-insensitive on the filesystem, so two strings that hit the same
 * inode must compare equal here too. Linux is case-sensitive, so on
 * Linux we keep strict equality.
 */
function cwdEquals(a: string, b: string): boolean {
  if (a === b) return true;
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return false;
}

interface CwdMatch {
  key: ProjectKey;
  configPath: string;
}

/**
 * Walk every project's `config.cwds[]` and return *all* projects that
 * claim `cwd`. Most flows want at most one match; the multi-match case
 * is treated as a hard error at call sites — it means two projects
 * have a colliding registration, which can't produce a correct routing
 * decision and is almost always the result of a hand-edit or a botched
 * restore.
 */
export function findAllProjectsClaimingCwd(cwd: string): CwdMatch[] {
  const target = canonicalizeCwd(cwd);
  const matches: CwdMatch[] = [];
  const root = workMemoryRoot();
  let users: fs.Dirent[];
  try {
    users = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return matches;
  }
  for (const userEnt of users) {
    if (!userEnt.isDirectory() || userEnt.name.startsWith('.')) continue;
    const userDir = path.join(root, userEnt.name);
    let orgs: fs.Dirent[];
    try {
      orgs = fs.readdirSync(userDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const orgEnt of orgs) {
      if (!orgEnt.isDirectory() || orgEnt.name.startsWith('.')) continue;
      const projectsDir = path.join(userDir, orgEnt.name, PROJECTS_TIER);
      let projs: fs.Dirent[];
      try {
        projs = fs.readdirSync(projectsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const projEnt of projs) {
        if (!projEnt.isDirectory() || projEnt.name.startsWith('.')) continue;
        const cfgPath = path.join(projectsDir, projEnt.name, CONFIG_JSON);
        let data: { cwds?: unknown };
        try {
          data = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as typeof data;
        } catch {
          continue;
        }
        const cwds = Array.isArray(data.cwds) ? (data.cwds as unknown[]).map(String) : [];
        const hit = cwds.some((stored) => cwdEquals(canonicalizeCwd(stored), target));
        if (hit) {
          // Trust the directory name, not `data.project_id` — the directory
          // is the on-disk identity; the field is display-mutable and can
          // drift (hand-rename, half-baked rename-project, restored backup).
          matches.push({
            key: { userId: userEnt.name, orgId: orgEnt.name, projectId: projEnt.name },
            configPath: cfgPath,
          });
        }
      }
    }
  }
  return matches;
}

/**
 * Fast-path resolution: if `cwd` (after canonicalization) sits inside a
 * project root — `<workMemoryRoot>/<userId>/<orgId>/projects/<projectId>/...`
 * — and a `config.json` exists at that project root, that IS the project,
 * no `config.cwds[]` lookup needed. This lets the daily-report-drafter
 * (and any other tool that has no reason to be in a code-repo) spawn
 * directly inside the project's user-home dir, AND it lets the
 * work-log-synthesizer spawn inside `<projectRoot>/.synth/current`
 * (which is a project-internal scratch directory, never registered in
 * `cwds[]`) and still resolve the parent project from its location.
 *
 * Matches exactly at the project root OR anywhere underneath it — the
 * first 4 path segments under `workMemoryRoot` identify the project,
 * everything deeper is project-internal.
 *
 * Returns the key based solely on the on-disk path shape (does NOT
 * round-trip through `assertSlug` / `makeProjectKey` — the directory
 * names are trusted as already-existing). Downstream callers that want
 * a "validated" key must re-validate themselves.
 */
function projectKeyFromRootShape(canonical: string): ProjectKey | null {
  const root = workMemoryRoot();
  const rel = path.relative(root, canonical);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length < 4) return null;
  if (parts[2] !== PROJECTS_TIER) return null;
  const projRoot = path.join(root, parts[0]!, parts[1]!, parts[2]!, parts[3]!);
  if (!fs.existsSync(path.join(projRoot, CONFIG_JSON))) return null;
  return { userId: parts[0]!, orgId: parts[1]!, projectId: parts[3]! };
}

/**
 * Reverse scan: find the project whose `config.cwds[]` contains `cwd`.
 * Returns null if no project claims this cwd; throws (loudly) if multiple
 * projects do — that's a corruption signal, never a valid runtime state.
 *
 * First tries the project-root fast-path (cwd IS some project's home dir),
 * then falls back to scanning every project's `config.cwds[]`. The
 * fast-path silently wins over reverse-scan; this is safe because
 * `addCwdToConfig` refuses to register any path that already matches the
 * project-root shape, so a project root can never simultaneously appear
 * in another project's `cwds[]`. (The write-side guard is what makes the
 * read-side fast-path safe.)
 */
export function findProjectKeyForCwd(cwd: string = process.cwd()): ProjectKey | null {
  const canonical = canonicalizeCwd(cwd);
  const direct = projectKeyFromRootShape(canonical);
  if (direct) return direct;
  const matches = findAllProjectsClaimingCwd(cwd);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const keys = matches.map((m) => formatProjectKey(m.key)).join(', ');
    throw new Error(
      `cwd ${canonical} is registered to multiple projects (${keys}). ` +
      `Run \`code-journal unregister-cwd --user-id … --org-id … --project-id …\` in N-1 of them to fix.`,
    );
  }
  return matches[0]!.key;
}

/**
 * Public helper: is this path a code-journal project root (shape-wise)?
 * Used by `addCwdToConfig` to keep project-root paths out of `cwds[]`.
 */
export function isProjectRootPath(p: string): boolean {
  return projectKeyFromRootShape(canonicalizeCwd(p)) !== null;
}

/**
 * Same as findProjectKeyForCwd but throws when nothing claims the cwd —
 * the right helper for read-after-init commands (query, append-entry, etc.).
 */
export function requireProjectKeyForCwd(cwd: string = process.cwd()): ProjectKey {
  const key = findProjectKeyForCwd(cwd);
  if (!key) {
    throw new Error(
      `No code-journal project registered for ${canonicalizeCwd(cwd)}. Run \`code-journal init --user-id <id> --org-id <id> --project-id <id>\` first.`,
    );
  }
  return key;
}

/** Resolve project root via the reverse cwd lookup. Throws if unregistered. */
export function projectRoot(cwd: string = process.cwd()): string {
  return projectRootFor(requireProjectKeyForCwd(cwd));
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return path.join(projectRoot(cwd), CONFIG_JSON);
}

/**
 * Convert an OS-native relative path into the POSIX form we always store
 * in index.json's `file_path`. Stored values use forward slashes regardless
 * of platform, so consumers (drafter, query --include-body) can resolve
 * them cross-platform without dealing with backslashes.
 */
export function toPosixRel(parts: string[]): string {
  return parts.join('/');
}

/**
 * Inverse: split a stored POSIX rel path into segments suitable for path.join.
 */
export function fromPosixRel(rel: string): string[] {
  return rel.split('/');
}
