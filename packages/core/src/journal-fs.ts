/**
 * Disk-backed journal assembly — the bridge from the pure journal model
 * (journal.ts) to the user's real coding-agent sessions on disk.
 *
 * One pass: discover every session, group it into Projects (via the unified
 * registry — see projects.ts; a repo's worktrees fold into one Project, and a
 * user can group several repos under one Project), drop the throwaways, then
 * run the pure `buildJournal` over what's left.
 */
import { execFileSync } from 'node:child_process';

import { dateInTimezone } from './datetime';
import {
  buildJournal,
  buildProjectJournal,
  type GitCommit,
  type Journal,
  type ProjectInput,
  type ProjectJournal,
} from './journal';
import { journalProjectTimezone } from './journal-settings';
import {
  defaultRepoKeyResolver,
  groupSessionsByProject,
  projectConfig,
  type DiscoveredProject,
  type ProjectGroup,
  type ProjectRegistry,
} from './projects';
import { discoverAllSessions, readSessionFile } from './sessions';

/**
 * Back-compat: group sessions by git repo only (no registry). Retained for
 * existing callers/tests; new code should use `groupSessionsByProject`, which
 * also honors the user's Project groupings.
 */
export function groupSessionsByRepo(
  sessions: Parameters<typeof groupSessionsByProject>[0],
  repoKey: (cwd: string) => string | null,
): ProjectGroup[] {
  const empty: ProjectRegistry = { version: 1, projects: [] };
  return groupSessionsByProject(sessions, { registry: empty, repoKey });
}

/** Scan every session store once and group the result into Projects. */
function discoverGroups(): ProjectGroup[] {
  return groupSessionsByProject(discoverAllSessions(), { repoKey: defaultRepoKeyResolver() });
}

/** Discover every Project with local coding-agent sessions. */
export function discoverProjects(): DiscoveredProject[] {
  return discoverGroups().map((g) => g.project);
}

/** The timezone a Project reckons days in: registry config, then the legacy
 *  journal-settings.json fallback, then the host zone. */
function projectTimezone(projectId: string): string {
  return projectConfig(projectId).timezone || journalProjectTimezone(projectId);
}

/**
 * The user's own commits in a repo, newest first — empty on any failure (not a
 * repo, git missing, …). Author-filtered to the repo's `user.email` so a
 * teammate's pulled commits don't land in your journal.
 */
function collectGitCommits(repoKey: string, tz: string): GitCommit[] {
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
      date: dateInTimezone(new Date(ms), tz),
      subject: (parts[2] ?? '').trim(),
    });
  }
  return out;
}

/** Commits across all of a Project's member repos, deduped by sha. */
function collectProjectCommits(members: readonly string[], tz: string): GitCommit[] {
  const seen = new Set<string>();
  const out: GitCommit[] = [];
  for (const repo of members) {
    for (const c of collectGitCommits(repo, tz)) {
      if (seen.has(c.sha)) continue;
      seen.add(c.sha);
      out.push(c);
    }
  }
  return out;
}

function inputFor(group: ProjectGroup): ProjectInput {
  const timezone = projectTimezone(group.project.id);
  return {
    projectId: group.project.id,
    displayName: group.project.displayName,
    cwds: group.project.cwds,
    sessions: group.sessions,
    commits: collectProjectCommits(group.project.members, timezone),
    timezone,
  };
}

/** Build the whole journal from disk — discovery, grouping, commits, then `buildJournal`. */
export function buildJournalFromDisk(): Journal {
  const inputs: ProjectInput[] = discoverGroups().map(inputFor);
  return buildJournal(inputs, { loadTranscript: readSessionFile });
}

/**
 * Rebuild a single Project's journal from disk in its (current) timezone — the
 * cheap path the journal server takes when the user changes a Project's
 * timezone in Settings, instead of re-running the whole multi-repo build.
 * Returns null when no discovered Project matches `projectId`.
 */
export function rebuildProjectJournal(projectId: string): ProjectJournal | null {
  const group = discoverGroups().find((g) => g.project.id === projectId);
  if (!group) return null;
  return buildProjectJournal(inputFor(group), { loadTranscript: readSessionFile });
}
