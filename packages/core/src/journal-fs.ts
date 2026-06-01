/**
 * Disk-backed journal assembly — the bridge from the pure journal model
 * (journal.ts) to the user's real coding-agent sessions on disk.
 *
 * One pass: discover every session, group it by git repository (a repo's
 * worktrees fold into one project), drop the throwaways, then run the pure
 * `buildJournal` over what's left.
 */
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

import { todayLocalDate } from './datetime';
import { buildJournal, type GitCommit, type Journal, type ProjectInput } from './journal';
import { discoverAllSessions, gitRepoKeyOf, readSessionFile, type SessionRef } from './sessions';

/** A project the journal covers — a git repo (or a lone cwd) and its cwds. */
export interface DiscoveredProject {
  /** URL-safe, stable id — the repo's basename slug plus a hash of its path */
  id: string;
  displayName: string;
  /** the working directories whose sessions belong to this project */
  cwds: string[];
}

/** One project plus the sessions discovered for it. */
export interface ProjectGroup {
  project: DiscoveredProject;
  sessions: SessionRef[];
  /** the git repo dir (or the bare cwd, when not in a repo) these sessions share */
  repoKey: string;
}

/** Names that never represent real project work — boot / healthcheck and hidden dirs. */
const JUNK_NAME = /^(\.|claude-code-boot)/;
/** A project needs at least this many sessions to earn a journal entry. */
const MIN_SESSIONS = 2;

/** FNV-1a, 6 base-36 chars — a short stable suffix that keeps project ids unique. */
function hash6(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(6, '0').slice(-6);
}

function projectIdFor(repoKey: string): string {
  const slug = basename(repoKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'project') + '-' + hash6(repoKey);
}

/**
 * Group sessions into projects by git repository: every session whose cwd
 * resolves to the same repo key lands in one project; the throwaways (boot
 * dirs, hidden dirs, single-session scratch dirs) are dropped.
 *
 * Pure — the repo-key lookup is injected — so it is unit-testable. Ordered by
 * session count, busiest project first.
 */
export function groupSessionsByRepo(
  sessions: readonly SessionRef[],
  repoKey: (cwd: string) => string | null,
): ProjectGroup[] {
  const buckets = new Map<string, SessionRef[]>();
  for (const s of sessions) {
    const key = repoKey(s.cwd) ?? s.cwd;
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(s);
  }
  const out: ProjectGroup[] = [];
  for (const [key, refs] of buckets) {
    const name = basename(key) || key;
    if (JUNK_NAME.test(name) || refs.length < MIN_SESSIONS) continue;
    out.push({
      project: {
        id: projectIdFor(key),
        displayName: name,
        cwds: [...new Set(refs.map((r) => r.cwd))].sort(),
      },
      sessions: refs,
      repoKey: key,
    });
  }
  return out.sort((a, b) => b.sessions.length - a.sessions.length);
}

/** Scan every session store once and group the result into projects. */
function discoverGroups(): ProjectGroup[] {
  const cache = new Map<string, string | null>();
  const repoKey = (cwd: string): string | null => {
    let k = cache.get(cwd);
    if (k === undefined) cache.set(cwd, (k = gitRepoKeyOf(cwd)));
    return k;
  };
  return groupSessionsByRepo(discoverAllSessions(), repoKey);
}

/** Discover every project with local coding-agent sessions, grouped by repo. */
export function discoverProjects(): DiscoveredProject[] {
  return discoverGroups().map((g) => g.project);
}

/**
 * The user's own commits in a repo, newest first — empty on any failure (not a
 * repo, git missing, …). Author-filtered to the repo's `user.email` so a
 * teammate's pulled commits don't land in your journal.
 */
function collectGitCommits(repoKey: string): GitCommit[] {
  const run = (args: string[]): string => {
    try {
      return execFileSync('git', ['-C', repoKey, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return '';
    }
  };
  const email = run(['config', 'user.email']).trim();
  const args = ['log', '--branches', '--no-merges', '--pretty=format:%H%x1f%aI%x1f%s', '-n', '5000'];
  if (email) args.push('--author=' + email);

  const out: GitCommit[] = [];
  for (const line of run(args).split('\n')) {
    const parts = line.split(String.fromCharCode(31)); // 0x1f field separator
    const sha = parts[0];
    if (!sha || parts.length < 2) continue;
    const ms = Date.parse(parts[1]!);
    if (Number.isNaN(ms)) continue;
    out.push({
      sha,
      shortSha: sha.slice(0, 7),
      date: todayLocalDate(new Date(ms)),
      subject: (parts[2] ?? '').trim(),
    });
  }
  return out;
}

/** Build the whole journal from disk — discovery, grouping, commits, then `buildJournal`. */
export function buildJournalFromDisk(): Journal {
  const inputs: ProjectInput[] = discoverGroups().map((g) => ({
    projectId: g.project.id,
    displayName: g.project.displayName,
    cwds: g.project.cwds,
    sessions: g.sessions,
    commits: collectGitCommits(g.repoKey),
  }));
  return buildJournal(inputs, { loadTranscript: readSessionFile });
}
