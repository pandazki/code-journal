/**
 * Observation lens CLI subcommands: sync / compose / status.
 *
 * Per docs/plans/mvp-ii.md § 4. Wired into packages/cli/src/index.ts's
 * COMMANDS map. The split keeps the existing CLI's surface unchanged
 * — observation is an additive layer that runs over @code-journal/core's
 * session discovery.
 */
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import {
  discoverAllSessions,
  gitRepoKeyOf,
  groupSessionsByRepo,
  type SessionRef,
} from '@code-journal/core';

import {
  composeAudit,
  digestClaudeCodeTranscript,
  digestCodexTranscript,
  appendSignals,
  readSignals,
  readProjectState,
  writeProjectState,
  runLens,
  LENS_IDS,
  type ProjectState,
  type LensId,
  type AgentId,
  DIR_MODE,
  FILE_MODE,
  digestFilePath,
  digestsDir,
} from '@code-journal/observation';

type ExitCode = number;

interface ObsCliContext {
  cwd: string;
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

export async function cmdObservationSync(rest: string[], _ctx: ObsCliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: 'string', multiple: true },
      'scan-only': { type: 'boolean', default: false },
      limit: { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const projectFilter = ((values.project as string[]) ?? []).map((s) => s.toLowerCase());
  const scanOnly = Boolean(values['scan-only']);
  const verbose = Boolean(values.verbose);
  const limit = values.limit != null ? Math.max(1, Number(values.limit)) : Infinity;
  if (values.limit != null && !Number.isFinite(Number(values.limit))) {
    process.stderr.write(`sync: invalid --limit '${values.limit}'\n`);
    return 2;
  }

  const sessions = discoverAllSessions();
  const groups = groupSessionsByRepo(sessions, (cwd) => gitRepoKeyOf(cwd));
  const inScope = (project: { id: string; displayName: string }): boolean => {
    if (projectFilter.length === 0) return true;
    return projectFilter.some((f) => {
      // Match against project.id (exact or substring) or displayName substring
      return (
        project.id.toLowerCase() === f ||
        project.id.toLowerCase().includes(f) ||
        project.displayName.toLowerCase().includes(f)
      );
    });
  };
  const targeted = groups.filter((g) => inScope(g.project));

  if (targeted.length === 0) {
    process.stdout.write('no projects found in scope\n');
    return 0;
  }

  let total = { discovered: 0, scanned: 0, eventsAppended: 0, composed: 0, failed: 0 };

  for (const group of targeted) {
    const project = group.project;
    const projectId = project.id;
    const state = readProjectState(projectId, project.displayName);

    const alreadyScanned = new Set(state.last_scan.sessions_scanned);
    const allNew = group.sessions.filter((s) => !alreadyScanned.has(s.id));
    // Bias toward the most-recent unscanned sessions so the limit picks
    // meaningful ones (not the oldest tiny bootstrap session).
    const sortedNew = [...allNew].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
    const newSessions = sortedNew.slice(0, Number.isFinite(limit) ? limit : sortedNew.length);
    total.discovered += group.sessions.length;
    if (verbose && newSessions.length < allNew.length) {
      process.stdout.write(
        `  (--limit ${limit}: scanning ${newSessions.length}/${allNew.length} new sessions, most recent first)\n`,
      );
    }

    if (verbose) {
      process.stdout.write(
        `[${project.displayName}] ${group.sessions.length} sessions, ${newSessions.length} new\n`,
      );
    }
    if (newSessions.length === 0) continue;

    let agentsTouched = new Set<AgentId>(state.agent_seen);
    let projectEventsAppended = 0;
    const successfullyScanned: string[] = [];

    for (const session of newSessions) {
      try {
        const result = scanOneSession(projectId, session, state, verbose);
        agentsTouched.add(session.agent as AgentId);
        projectEventsAppended += result.appended;
        total.scanned += 1;
        total.eventsAppended += result.appended;
        // Only successful scans land in sessions_scanned. Failed sessions
        // get retried on next sync — important for transient failures
        // (timeouts, rate limits) and prompt fixes. If a session
        // permanently fails (e.g. too big), the user can manually
        // exclude it later.
        successfullyScanned.push(session.id);
      } catch (err) {
        total.failed += 1;
        process.stderr.write(
          `[${project.displayName}] ${session.id}: failed (${err instanceof Error ? err.message : String(err)})\n`,
        );
      }
    }

    // Update state — only record successfully-scanned sessions to avoid
    // permanently shadowing a session that hit a transient failure.
    const updated: ProjectState = {
      ...state,
      display_name: state.display_name || project.displayName,
      agent_seen: [...agentsTouched],
      last_scan: {
        at: new Date().toISOString(),
        sessions_scanned: [...new Set([...alreadyScanned, ...successfullyScanned])],
        _extra: state.last_scan._extra,
      },
      new_events_since_last_compose: state.new_events_since_last_compose + projectEventsAppended,
    };
    writeProjectState(updated);

    // Auto-compose if threshold crossed and not in scan-only mode
    if (
      !scanOnly &&
      updated.new_events_since_last_compose >= updated.config.compose_threshold
    ) {
      if (verbose) {
        process.stdout.write(
          `[${project.displayName}] threshold reached (${updated.new_events_since_last_compose} ≥ ${updated.config.compose_threshold}) — composing\n`,
        );
      }
      const composeResult = composeAudit({ state: updated });
      if (composeResult.ok) {
        total.composed += 1;
        process.stdout.write(
          `[${project.displayName}] composed Episode ${composeResult.episode.episode} → ${composeResult.paths.markdown}\n`,
        );
      } else {
        process.stderr.write(`[${project.displayName}] compose failed: ${composeResult.reason}\n`);
        total.failed += 1;
      }
    }
  }

  process.stdout.write(
    `sync: ${total.scanned} sessions scanned, ${total.eventsAppended} events appended, ${total.composed} audits composed, ${total.failed} failures\n`,
  );
  return total.failed > 0 ? 1 : 0;
}

interface ScanResult {
  appended: number;
}

function scanOneSession(
  projectId: string,
  session: SessionRef,
  state: ProjectState,
  verbose: boolean,
): ScanResult {
  // Step 1: digest the session
  const digestResult =
    session.agent === 'codex'
      ? digestCodexTranscript({
          jsonlPath: session.path,
          projectCode: state.display_name || projectId,
        })
      : digestClaudeCodeTranscript({
          jsonlPath: session.path,
          projectCode: state.display_name || projectId,
        });

  // Persist digest for later compose reads
  const digestPath = digestFilePath(projectId, session.id);
  ensureDir(digestsDir(projectId));
  writeFileSync(digestPath, digestResult.markdown);
  try {
    chmodSync(digestPath, FILE_MODE);
  } catch {
    /* ignore */
  }

  // Step 2: run both lenses in sequence (sync flow). Could parallelise via
  // worker_threads in MVP-III if cost matters; for MVP-II keep sequential
  // to make logs / errors per session legible.
  let appendedTotal = 0;
  for (const lensId of LENS_IDS) {
    const lensVersion = state.config.lens_versions[lensId];
    if (verbose) {
      process.stdout.write(
        `  → ${session.id.slice(0, 8)} · ${lensId} · ${digestResult.meta.totalTurns} turns\n`,
      );
    }
    const result = runLens({
      lensId,
      lensVersion,
      digestMarkdown: digestResult.markdown,
      projectId,
      sessionId: session.id,
      agent: session.agent as AgentId,
      model: state.config.model,
    });
    if (!result.ok) {
      throw new Error(`${lensId} failed: ${result.reason}`);
    }
    const { appended } = appendSignals(projectId, lensId, result.events);
    appendedTotal += appended;
  }
  return { appended: appendedTotal };
}

// ---------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------

export async function cmdObservationCompose(rest: string[], _ctx: ObsCliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const projectArg = values.project as string | undefined;
  if (!projectArg) {
    process.stderr.write('compose: --project <name|id> is required\n');
    return 2;
  }
  const dryRun = Boolean(values['dry-run']);

  const resolved = resolveProjectFromArg(projectArg);
  if (!resolved) {
    process.stderr.write(`compose: no project matches '${projectArg}'\n`);
    return 1;
  }

  const state = readProjectState(resolved.id, resolved.displayName);
  const result = composeAudit({ state, dryRun });
  if (!result.ok) {
    process.stderr.write(`compose: ${result.reason}\n`);
    return 1;
  }
  const verb = dryRun ? 'would write' : 'wrote';
  process.stdout.write(
    `compose: ${verb} Episode ${result.episode.episode} → ${result.paths.markdown}\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function cmdObservationStatus(rest: string[], _ctx: ObsCliContext): Promise<ExitCode> {
  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const projectFilter = (values.project as string | undefined)?.toLowerCase();
  const verbose = Boolean(values.verbose);

  const sessions = discoverAllSessions();
  const groups = groupSessionsByRepo(sessions, (cwd) => gitRepoKeyOf(cwd));
  const targeted = projectFilter
    ? groups.filter((g) => g.project.displayName.toLowerCase().includes(projectFilter))
    : groups;

  if (targeted.length === 0) {
    process.stdout.write('no projects found\n');
    return 0;
  }

  for (const group of targeted) {
    const projectId = group.project.id;
    const state = readProjectState(projectId, group.project.displayName);
    const strictCount = readSignals(projectId, 'strict-negative-space').length;
    const deferralCount = readSignals(projectId, 'anchored-deferral').length;

    process.stdout.write(`\nProject ${group.project.displayName} (pid=${projectId})\n`);
    process.stdout.write(`  agents seen: ${state.agent_seen.join(', ') || '(none yet)'}\n`);
    process.stdout.write(
      `  sessions on disk: ${group.sessions.length}; scanned: ${state.last_scan.sessions_scanned.length}` +
        (state.last_scan.at ? ` (last sync ${state.last_scan.at.slice(0, 19)})` : '') +
        '\n',
    );
    process.stdout.write(
      `  signal store: ${strictCount + deferralCount} events (strict: ${strictCount}, deferral: ${deferralCount})\n`,
    );
    if (state.episodes.length === 0) {
      process.stdout.write(`  episodes: none yet\n`);
    } else {
      process.stdout.write(`  episodes:\n`);
      for (const ep of state.episodes) {
        process.stdout.write(
          `    [${ep.episode}] composed ${ep.composed_at.slice(0, 10)} (${ep.event_count} events)\n`,
        );
      }
    }
    const need = state.config.compose_threshold - state.new_events_since_last_compose;
    if (state.new_events_since_last_compose === 0) {
      process.stdout.write(`  new events since last compose: 0 (threshold: ${state.config.compose_threshold})\n`);
    } else if (need <= 0) {
      process.stdout.write(
        `  new events since last compose: ${state.new_events_since_last_compose} (ready to compose, threshold ${state.config.compose_threshold})\n`,
      );
    } else {
      process.stdout.write(
        `  new events since last compose: ${state.new_events_since_last_compose}  (need ${need} more for next compose at threshold ${state.config.compose_threshold})\n`,
      );
    }
    if (verbose) {
      process.stdout.write(
        `  lens versions: strict-negative-space=${state.config.lens_versions['strict-negative-space']}, anchored-deferral=${state.config.lens_versions['anchored-deferral']}, model=${state.config.model}\n`,
      );
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProjectFromArg(arg: string): { id: string; displayName: string } | null {
  const sessions = discoverAllSessions();
  const groups = groupSessionsByRepo(sessions, (cwd) => gitRepoKeyOf(cwd));
  // Try exact id match first, then case-insensitive name substring
  const byId = groups.find((g) => g.project.id === arg);
  if (byId) return { id: byId.project.id, displayName: byId.project.displayName };
  const byName = groups.find((g) =>
    g.project.displayName.toLowerCase().includes(arg.toLowerCase()),
  );
  if (byName) return { id: byName.project.id, displayName: byName.project.displayName };
  return null;
}

function ensureDir(p: string): void {
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true });
    try {
      chmodSync(p, DIR_MODE);
    } catch {
      /* ignore */
    }
  }
}
