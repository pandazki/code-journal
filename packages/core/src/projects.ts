/**
 * The unified Project concept — one identity and one config home shared by the
 * journal and the observation lens.
 *
 * A discovered session lives in some git repo (its "repo key" — the common
 * `.git` dir, shared across worktrees). By default each repo is its own
 * Project (slug + path-hash id), which is exactly the historical behavior. But
 * a user can REGISTER a Project that groups several repos/folders under one id
 * with one display name — "docs live here, code lives there, same thing" — and
 * the journal day-cards/heatmap and observation scans then treat them as one.
 *
 * Per-Project config (timezone, analysis/report language, lens model, compose
 * threshold) lives here too, so both products read the same source of truth.
 *
 * The registry is `~/.code-journal/projects.json`. Sessions whose repo isn't
 * named by any registered Project fall back to an auto-Project — so an empty
 * registry reproduces today's behavior exactly.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { workMemoryRoot } from './paths';
import { gitRepoKeyOf, type SessionRef } from './sessions';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Per-Project configuration, shared by journal + observation. All optional;
 *  an absent field means "use the default" (host timezone, auto language, …). */
export interface ProjectConfig {
  /** IANA zone the Project reckons calendar days in; absent/'' = host zone. */
  timezone?: string;
  /** Analysis / report language code (e.g. 'en', 'zh-CN'). */
  language?: string;
  /** Observation: keep auto-detecting the language each sync (default true). */
  languageAuto?: boolean;
  /** Observation lens model. */
  model?: 'sonnet' | 'opus';
  /** Observation: new events before sync auto-composes an episode. */
  composeThreshold?: number;
}

/** A Project the user has explicitly registered (named + grouped folders). */
export interface RegisteredProject {
  id: string;
  displayName: string;
  /** repo keys (absolute repo roots) grouped into this Project. */
  members: string[];
  config: ProjectConfig;
}

export interface ProjectRegistry {
  version: 1;
  projects: RegisteredProject[];
}

/** A Project as seen after resolving discovered sessions against the registry. */
export interface DiscoveredProject {
  /** stable id — a registered Project's id, or the auto slug+hash for a lone repo */
  id: string;
  displayName: string;
  /** the working directories whose sessions belong to this Project */
  cwds: string[];
  /** the repo roots this Project spans (one for an auto-Project, N when grouped) */
  members: string[];
}

/** One Project plus the sessions discovered for it. */
export interface ProjectGroup {
  project: DiscoveredProject;
  sessions: SessionRef[];
}

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

/** FNV-1a, 6 base-36 chars — a short stable suffix that keeps auto ids unique. */
function hash6(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(6, '0').slice(-6);
}

/** The auto-Project id for a repo key — `<slug>-<hash>` (url-safe, path-distinct). */
export function projectIdFor(repoKey: string): string {
  const slug = basename(repoKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'project') + '-' + hash6(repoKey);
}

/** Names that never represent real project work — boot / healthcheck and hidden dirs. */
const JUNK_NAME = /^(\.|claude-code-boot)/;
/** An auto-Project needs at least this many sessions to earn an entry. */
const MIN_SESSIONS = 2;

// -----------------------------------------------------------------------------
// Registry I/O
// -----------------------------------------------------------------------------

export function projectsRegistryPath(): string {
  return join(workMemoryRoot(), 'projects.json');
}

const EMPTY_REGISTRY: ProjectRegistry = { version: 1, projects: [] };

/** Read the registry; an empty registry on any error (missing file, bad JSON). */
export function readProjectRegistry(): ProjectRegistry {
  try {
    const raw = JSON.parse(readFileSync(projectsRegistryPath(), 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) return { ...EMPTY_REGISTRY };
    const projects: RegisteredProject[] = raw.projects
      .filter((p: unknown): p is RegisteredProject => !!p && typeof (p as RegisteredProject).id === 'string')
      .map((p: RegisteredProject) => ({
        id: String(p.id),
        displayName: typeof p.displayName === 'string' ? p.displayName : p.id,
        members: Array.isArray(p.members) ? p.members.map(String) : [],
        config: p.config && typeof p.config === 'object' ? p.config : {},
      }));
    return { version: 1, projects };
  } catch {
    return { ...EMPTY_REGISTRY };
  }
}

export function writeProjectRegistry(reg: ProjectRegistry): void {
  const p = projectsRegistryPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ version: 1, projects: reg.projects }, null, 2) + '\n');
}

// -----------------------------------------------------------------------------
// Resolution + grouping
// -----------------------------------------------------------------------------

/** Map each registered member repo key → its Project, for fast resolution. */
function memberIndex(reg: ProjectRegistry): Map<string, RegisteredProject> {
  const m = new Map<string, RegisteredProject>();
  for (const p of reg.projects) for (const member of p.members) m.set(member, p);
  return m;
}

/** A cached `cwd → repo key` resolver backed by `gitRepoKeyOf`. */
export function defaultRepoKeyResolver(): (cwd: string) => string | null {
  const cache = new Map<string, string | null>();
  return (cwd: string) => {
    let k = cache.get(cwd);
    if (k === undefined) cache.set(cwd, (k = gitRepoKeyOf(cwd)));
    return k;
  };
}

export interface GroupOptions {
  /** registry to resolve against; defaults to the on-disk registry. */
  registry?: ProjectRegistry;
  /** cwd → repo key; defaults to a cached `gitRepoKeyOf`. */
  repoKey?: (cwd: string) => string | null;
  /** min sessions for an AUTO project to appear (registered ones always appear). */
  minSessions?: number;
}

const cwdsOf = (sessions: readonly SessionRef[]): string[] =>
  [...new Set(sessions.map((s) => s.cwd))].sort();

/**
 * Group discovered sessions into Projects, honoring the registry: sessions
 * whose repo is a member of a registered Project fold into it (always shown,
 * user-named); the rest become auto-Projects (one per repo, junk/single-session
 * dirs dropped — today's behavior). Busiest Project first.
 *
 * Pure given `registry` + `repoKey`, so it is unit-testable.
 */
export function groupSessionsByProject(
  sessions: readonly SessionRef[],
  opts: GroupOptions = {},
): ProjectGroup[] {
  const registry = opts.registry ?? readProjectRegistry();
  const repoKey = opts.repoKey ?? defaultRepoKeyResolver();
  const minSessions = opts.minSessions ?? MIN_SESSIONS;
  const members = memberIndex(registry);

  interface Bucket {
    sessions: SessionRef[];
    repoKeys: Set<string>;
    registered?: RegisteredProject;
  }
  const buckets = new Map<string, Bucket>();
  for (const s of sessions) {
    const rk = repoKey(s.cwd) ?? s.cwd;
    const reg = members.get(rk);
    const pid = reg ? reg.id : projectIdFor(rk);
    let b = buckets.get(pid);
    if (!b) buckets.set(pid, (b = { sessions: [], repoKeys: new Set(), registered: reg }));
    b.sessions.push(s);
    b.repoKeys.add(rk);
  }

  const out: ProjectGroup[] = [];
  for (const [pid, b] of buckets) {
    if (b.registered) {
      const reg = b.registered;
      out.push({
        project: {
          id: reg.id,
          displayName: reg.displayName || basename([...b.repoKeys][0] ?? pid) || pid,
          cwds: cwdsOf(b.sessions),
          // every member repo (incl. ones without sessions this scan), for commits
          members: [...new Set([...reg.members, ...b.repoKeys])],
        },
        sessions: b.sessions,
      });
    } else {
      const rk = [...b.repoKeys][0]!; // an auto-Project is a single repo
      const name = basename(rk) || rk;
      if (JUNK_NAME.test(name) || b.sessions.length < minSessions) continue;
      out.push({
        project: { id: pid, displayName: name, cwds: cwdsOf(b.sessions), members: [rk] },
        sessions: b.sessions,
      });
    }
  }
  return out.sort((a, b) => b.sessions.length - a.sessions.length);
}

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

/** The config for a Project id — the registered Project's config, or `{}`. */
export function projectConfig(projectId: string, registry?: ProjectRegistry): ProjectConfig {
  const reg = (registry ?? readProjectRegistry()).projects.find((p) => p.id === projectId);
  return reg ? { ...reg.config } : {};
}

// -----------------------------------------------------------------------------
// Mutations (used by the CLI / GUI to organize Projects)
// -----------------------------------------------------------------------------

/**
 * Ensure a registered Project exists for `id`, applying `patch` (displayName /
 * members / config merge). Auto-Projects need no entry until the user
 * customizes them — this is how that first customization is persisted.
 * Returns the updated registry.
 */
export function upsertProject(
  id: string,
  patch: { displayName?: string; members?: string[]; config?: ProjectConfig },
): ProjectRegistry {
  const reg = readProjectRegistry();
  let proj = reg.projects.find((p) => p.id === id);
  if (!proj) {
    proj = { id, displayName: patch.displayName ?? id, members: [], config: {} };
    reg.projects.push(proj);
  }
  if (patch.displayName !== undefined) proj.displayName = patch.displayName;
  if (patch.members !== undefined) proj.members = [...new Set(patch.members)];
  if (patch.config !== undefined) proj.config = { ...proj.config, ...patch.config };
  writeProjectRegistry(reg);
  return reg;
}

/** Merge `config` into a Project's config (creating the entry if needed). */
export function setProjectConfig(id: string, config: ProjectConfig, displayName?: string): ProjectRegistry {
  return upsertProject(id, { config, ...(displayName !== undefined ? { displayName } : {}) });
}

/** Add a repo key to a Project's members, removing it from any other Project. */
export function assignMember(id: string, repoKey: string, displayName?: string): ProjectRegistry {
  const reg = readProjectRegistry();
  for (const p of reg.projects) p.members = p.members.filter((m) => m !== repoKey);
  let proj = reg.projects.find((p) => p.id === id);
  if (!proj) {
    proj = { id, displayName: displayName ?? id, members: [], config: {} };
    reg.projects.push(proj);
  }
  if (displayName !== undefined) proj.displayName = displayName;
  proj.members = [...new Set([...proj.members, repoKey])];
  writeProjectRegistry(reg);
  return reg;
}
