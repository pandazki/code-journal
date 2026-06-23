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
  groupSessionsByProject,
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
  detectAndApplyFates,
  checkEventGrounding,
  turnsFromDigest,
  detectLanguage,
  languagePromptName,
  languageLabel,
  LENS_IDS,
  type ProjectState,
  type LensId,
  type LensEngine,
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

/**
 * Cross-episode fate detection — the side-effecting phase that runs before the
 * deterministic composer (Option B). Appends grounded fates onto prior events;
 * compose then surfaces them. Best-effort: a failure is logged but never blocks
 * the episode from composing.
 */
function runFateDetection(
  state: ProjectState,
  engine: LensEngine,
  label: string,
  verbose = false,
): void {
  const r = detectAndApplyFates({
    state,
    engine,
    model: state.config.model,
    analysisLanguage: languagePromptName(state.config.analysis_language),
  });
  if (!r.ok) {
    process.stderr.write(`[${label}] fate detection failed (episode still composes): ${r.reason}\n`);
    return;
  }
  if (r.applied > 0) {
    process.stdout.write(
      `[${label}] fate: ${r.applied} update${r.applied === 1 ? '' : 's'} surfaced from ${r.checkedPrior} prior events\n`,
    );
  } else if (verbose) {
    process.stdout.write(`[${label}] fate: none surfaced (${r.checkedPrior} prior events checked)\n`);
  }
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
      // Which coding-agent CLI applies the lenses: 'claude' (default) or
      // 'codex' (typically faster). Codex ignores the per-project model.
      engine: { type: 'string' },
      // Scan order for picking the --limit slice: 'recent' (default — newest
      // unscanned first) or 'oldest' (oldest first, for backfilling a project's
      // history chronologically so episodes form earliest → latest).
      order: { type: 'string' },
    },
    allowPositionals: false,
  });
  const projectFilter = ((values.project as string[]) ?? []).map((s) => s.toLowerCase());
  const scanOnly = Boolean(values['scan-only']);
  const verbose = Boolean(values.verbose);
  const engine = (values.engine as string | undefined) ?? 'claude';
  if (engine !== 'claude' && engine !== 'codex') {
    process.stderr.write(`sync: invalid --engine '${engine}' (use 'claude' or 'codex')\n`);
    return 2;
  }
  const limit = values.limit != null ? Math.max(1, Number(values.limit)) : Infinity;
  if (values.limit != null && !Number.isFinite(Number(values.limit))) {
    process.stderr.write(`sync: invalid --limit '${values.limit}'\n`);
    return 2;
  }
  const order = (values.order as string | undefined) ?? 'recent';
  if (order !== 'recent' && order !== 'oldest') {
    process.stderr.write(`sync: invalid --order '${order}' (use 'recent' or 'oldest')\n`);
    return 2;
  }

  const sessions = discoverAllSessions();
  const groups = groupSessionsByProject(sessions, { repoKey: (cwd) => gitRepoKeyOf(cwd) });
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
    // Default ('recent'): bias toward the most-recent unscanned sessions so a
    // --limit slice picks meaningful ones (not the oldest tiny bootstrap
    // session). 'oldest': scan earliest-first, for backfilling history in order
    // so episodes form chronologically (Episode 1 = earliest work).
    const sortedNew = [...allNew].sort((a, b) =>
      order === 'oldest' ? (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0) : (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0),
    );
    const newSessions = sortedNew.slice(0, Number.isFinite(limit) ? limit : sortedNew.length);
    total.discovered += group.sessions.length;
    if (verbose && newSessions.length < allNew.length) {
      process.stdout.write(
        `  (--limit ${limit}: scanning ${newSessions.length}/${allNew.length} new sessions, ${order === 'oldest' ? 'oldest first' : 'most recent first'})\n`,
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
        const result = scanOneSession(projectId, session, state, verbose, engine);
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
      runFateDetection(updated, engine, project.displayName, verbose);
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
    `sync [${engine}]: ${total.scanned} sessions scanned, ${total.eventsAppended} events appended, ${total.composed} audits composed, ${total.failed} failures\n`,
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
  engine: LensEngine,
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

  // Skip the observation runner's own `claude -p` subagent transcripts. Before
  // the cwd→tmpdir fix in lens-runner, every lens call wrote a "You are a
  // single-purpose observation lens…" session into the analyzed project, which
  // then got re-scanned as if it were a real user session (self-pollution).
  // Returning early marks it scanned (so it won't be retried) without spending
  // any lens calls. New runs no longer leak these; this catches the backlog.
  const firstUserText = digestResult.turns.find(
    (t) => t.role === 'user' && t.kind === 'text' && t.text,
  )?.text as string | undefined;
  if (firstUserText?.startsWith('You are a single-purpose observation lens')) {
    if (verbose) {
      process.stdout.write(
        `  · ${session.id.slice(0, 8)} skipped (observation lens subagent transcript)\n`,
      );
    }
    return { appended: 0 };
  }

  // Step 1.5: auto-detect the analysis language from the USER's own turns only
  // (type === 'user', text turns) — never the AI's output or tool noise. Cheap
  // char-script heuristic, no model call. Runs only while auto; pinning a
  // language in Settings sets analysis_language_auto = false and skips this.
  // Mutates state.config in place; the sync loop persists it.
  if (state.config.analysis_language_auto) {
    const userText = digestResult.turns
      .filter((t) => t.role === 'user' && t.kind === 'text' && t.text)
      .map((t) => t.text as string);
    if (userText.length > 0) {
      const detected = detectLanguage(userText);
      if (detected !== state.config.analysis_language) {
        if (verbose) {
          process.stdout.write(
            `  · analysis language auto-detected from user turns: ${languageLabel(detected)} (was ${languageLabel(state.config.analysis_language)})\n`,
          );
        }
        state.config.analysis_language = detected;
      }
    }
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
      engine,
      model: state.config.model,
      analysisLanguage: languagePromptName(state.config.analysis_language),
    });
    if (!result.ok) {
      throw new Error(`${lensId} failed: ${result.reason}`);
    }
    // Grounding gate: drop events whose AI-proposal verbatim can't be located
    // at the cited turn (or that violate proposal-before-response chronology)
    // before they enter the append-only store. The store is immutable, so an
    // ungrounded/fabricated event there is permanent — gate at ingestion.
    const turns = turnsFromDigest(digestResult.turns);
    const grounded: typeof result.events = [];
    let droppedCount = 0;
    for (const ev of result.events) {
      const check = checkEventGrounding(ev, turns);
      if (check.grounded) {
        grounded.push(ev);
      } else {
        droppedCount += 1;
        if (verbose) {
          const failed = check.checks.filter((c) => c.fatal && !c.pass).map((c) => c.name).join('+');
          process.stdout.write(`    ✗ dropped ungrounded ${lensId} event @${ev.turn_anchor} (${failed})\n`);
        }
      }
    }
    if (droppedCount > 0 && !verbose) {
      process.stdout.write(`  → ${session.id.slice(0, 8)} · ${lensId}: dropped ${droppedCount} ungrounded event(s)\n`);
    }
    const { appended } = appendSignals(projectId, lensId, grounded);
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
      force: { type: 'boolean', default: false },
      engine: { type: 'string' },
    },
    allowPositionals: false,
  });
  const projectArg = values.project as string | undefined;
  if (!projectArg) {
    process.stderr.write('compose: --project <name|id> is required\n');
    return 2;
  }
  const dryRun = Boolean(values['dry-run']);
  const force = Boolean(values.force);
  const engine = (values.engine as string | undefined) ?? 'claude';
  if (engine !== 'claude' && engine !== 'codex') {
    process.stderr.write(`compose: invalid --engine '${engine}' (use 'claude' or 'codex')\n`);
    return 2;
  }

  const resolved = resolveProjectFromArg(projectArg);
  if (!resolved) {
    process.stderr.write(`compose: no project matches '${projectArg}'\n`);
    return 1;
  }

  const state = readProjectState(resolved.id, resolved.displayName);
  // Fate detection runs as a separate phase BEFORE the (deterministic) composer:
  // it appends grounded cross-episode fates onto prior events, which compose then
  // surfaces. Skipped under dry-run (no mutations, no model call). Best-effort —
  // a failure never blocks the episode.
  if (!dryRun) runFateDetection(state, engine, resolved.displayName);
  const result = composeAudit({ state, dryRun, force });
  if (!result.ok) {
    // A deliberate no-op (nothing new to compose) is a clean exit, not an
    // error — keeps the rerun script's trailing compose quiet after sync
    // already auto-composed.
    if (result.skipped) {
      process.stdout.write(`compose: ${result.reason}\n`);
      return 0;
    }
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
  const groups = groupSessionsByProject(sessions, { repoKey: (cwd) => gitRepoKeyOf(cwd) });
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
    const pivotCount = readSignals(projectId, 'user-initiated-pivot').length;

    process.stdout.write(`\nProject ${group.project.displayName} (pid=${projectId})\n`);
    process.stdout.write(`  agents seen: ${state.agent_seen.join(', ') || '(none yet)'}\n`);
    process.stdout.write(
      `  sessions on disk: ${group.sessions.length}; scanned: ${state.last_scan.sessions_scanned.length}` +
        (state.last_scan.at ? ` (last sync ${state.last_scan.at.slice(0, 19)})` : '') +
        '\n',
    );
    process.stdout.write(
      `  signal store: ${strictCount + deferralCount + pivotCount} events ` +
        `(strict: ${strictCount}, deferral: ${deferralCount}, pivot: ${pivotCount})\n`,
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
        `  lens versions: strict-negative-space=${state.config.lens_versions['strict-negative-space']}, anchored-deferral=${state.config.lens_versions['anchored-deferral']}, user-initiated-pivot=${state.config.lens_versions['user-initiated-pivot']}, model=${state.config.model}, language=${languageLabel(state.config.analysis_language)}${state.config.analysis_language_auto ? ' (auto)' : ''}\n`,
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
  const groups = groupSessionsByProject(sessions, { repoKey: (cwd) => gitRepoKeyOf(cwd) });
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
