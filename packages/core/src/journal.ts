/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The journal model — turns discovered coding-agent sessions into the day- and
 * project-organized structure the GUI renders.
 *
 * Three layers, smallest to largest:
 *   SessionDigest  — the facts mined from one transcript: timespan, opening
 *                    prompt, files read / edited, shell commands, tool tally.
 *   DayEntry       — one project's sessions filed under a local calendar date,
 *                    plus the aggregates a day card shows.
 *   ProjectJournal — a project's whole run of days, newest first.
 *
 * `buildJournal` is pure and disk-free: it takes already-discovered
 * `SessionRef`s and an injected `loadTranscript`, so it is fully unit-testable
 * with synthetic JSONL. Disk wiring (discovery, file reads, git) lives in the
 * caller.
 *
 * Everything here is pure metadata — no LLM. The narrative line a day card can
 * carry is generated separately by the host coding agent and layered on top.
 */
import { todayLocalDate } from './datetime';
import type { SessionAgent, SessionRef } from './sessions';
import { categorize, messageText, parseTranscript } from './transcript';

/** Tools whose target file counts as work *produced* in a session. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Tools whose target file counts as input *consumed* in a session. */
const READ_TOOLS = new Set(['Read']);
/** Tools that run a shell command. */
const SHELL_TOOLS = new Set(['Bash']);

const OPENING_PROMPT_MAX = 240;
const COMMAND_MAX = 400;
/** Default cap on entries kept in each digest's path / command lists. */
const DEFAULT_MAX_LIST_LEN = 300;
/**
 * A gap longer than this between transcript events counts as the user being
 * away, not working — so it isn't added to active time. Without this a session
 * resumed days later would report days of "work".
 */
const IDLE_GAP_MS = 10 * 60_000;
/** A day's active time can't exceed this — the ceiling for sessions that span
 * several calendar days (resumed sessions are filed under their start date). */
const DAY_MS = 24 * 3_600_000;

/**
 * Sum the gaps between consecutive (ascending) timestamps, ignoring idle ones —
 * a "time at the keyboard" estimate over an event stream. Merge several
 * sessions' timestamps before calling this and overlapping work isn't
 * double-counted.
 */
function activeMsOf(sortedTimestamps: readonly number[]): number {
  let ms = 0;
  for (let i = 1; i < sortedTimestamps.length; i++) {
    const gap = sortedTimestamps[i]! - sortedTimestamps[i - 1]!;
    if (gap > 0 && gap <= IDLE_GAP_MS) ms += gap;
  }
  return ms;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** The facts mined from one session transcript. */
export interface SessionDigest {
  /** session id — the dedup key */
  id: string;
  agent: SessionAgent;
  /** absolute path to the transcript .jsonl */
  path: string;
  cwd: string;
  /** local calendar date (YYYY-MM-DD) the session is filed under — the date of
   * its first recorded activity. A session that runs past midnight is still
   * filed whole under its start date. */
  date: string;
  /** ISO timestamp of the first recorded activity, or null when none is found */
  startedAt: string | null;
  /** ISO timestamp of the last recorded activity, or null when none is found */
  endedAt: string | null;
  /** time at the keyboard — wall-clock span with idle gaps (>10 min) removed */
  activeMs: number;
  model: string | null;
  gitBranch: string | null;
  /** the session's first human prompt, collapsed to one line and truncated */
  openingPrompt: string;
  /** count of human prompts (tool-result-only user turns excluded) */
  userTurns: number;
  /** count of assistant message entries */
  assistantTurns: number;
  /** distinct absolute paths written by Edit / Write / MultiEdit / NotebookEdit */
  filesEdited: string[];
  /** distinct absolute paths opened by Read */
  filesRead: string[];
  /** shell commands run, first-seen order, deduped */
  commands: string[];
  /** tool name → invocation count */
  toolCounts: Record<string, number>;
  sizeBytes: number;
  /** number of sidecar files (subagent transcripts, spilled tool output) */
  sidecarCount: number;
}

/** A git commit, filed under the local date it was authored. */
export interface GitCommit {
  sha: string;
  shortSha: string;
  /** local calendar date authored, YYYY-MM-DD */
  date: string;
  subject: string;
}

/** One project's sessions on one calendar day, with the day-card aggregates. */
export interface DayEntry {
  /** local calendar date, YYYY-MM-DD */
  date: string;
  projectId: string;
  /** the day's sessions, newest first */
  sessions: SessionDigest[];
  sessionCount: number;
  /** earliest session start that day, ISO; null when none has a timestamp */
  startedAt: string | null;
  /** latest session end that day, ISO; null when none has a timestamp */
  endedAt: string | null;
  /** sum of the day's session durations — a rough "time at the keyboard" proxy */
  activeMs: number;
  /** union of filesEdited across the day's sessions */
  filesEdited: string[];
  /** total shell commands run across the day */
  commandCount: number;
  /** the day-card headline: the earliest session's opening prompt */
  openingPrompt: string;
  /** distinct agents that ran that day */
  agents: SessionAgent[];
  /** git commits authored that day in this project */
  commits: GitCommit[];
  /** the day's recap, written by the narrative engine — absent until generated */
  story?: string[];
  /** a short title for the day, written by the narrative engine — absent until generated */
  title?: string;
}

/**
 * A contiguous stretch of a project's life — a chapter. Segmented purely from
 * the gaps in the project's activity; the narrative engine names and refines
 * these later. Until then a phase is known by its date range.
 */
export interface Phase {
  /** 1-based, chronological — Phase 1 is the project's start */
  index: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  sessionCount: number;
  /** the phase's days, newest first */
  days: DayEntry[];
  /** chapter title + summary from the narrative engine — absent until generated */
  title?: string;
  summary?: string;
}

/** A project's whole journal: every day it saw activity, newest first. */
export interface ProjectJournal {
  projectId: string;
  displayName: string;
  cwds: string[];
  /** days with activity, newest first */
  days: DayEntry[];
  /** the project's life cut into chapters, chronological */
  phases: Phase[];
  /** oldest active date, YYYY-MM-DD; null when the project has no sessions */
  firstDate: string | null;
  /** newest active date, YYYY-MM-DD; null when the project has no sessions */
  lastDate: string | null;
  totalSessions: number;
  totalActiveMs: number;
  totalCommits: number;
  /** the project's arc recap, written by the narrative engine — absent until generated */
  story?: string[];
}

/** One date's activity rolled up across every project — the overview heatmap. */
export interface ActivityDay {
  /** local calendar date, YYYY-MM-DD */
  date: string;
  sessionCount: number;
  /** number of distinct projects active that day */
  projectCount: number;
  activeMs: number;
}

/** The whole journal: every project, plus the cross-project activity timeline. */
export interface Journal {
  projects: ProjectJournal[];
  /** every active date across all projects, oldest first */
  activity: ActivityDay[];
  /** ISO timestamp this journal was assembled */
  generatedAt: string;
}

/** A project and its already-discovered sessions — the input to `buildJournal`. */
export interface ProjectInput {
  projectId: string;
  displayName: string;
  cwds: string[];
  sessions: SessionRef[];
  /** git commits the project's repo recorded — bucketed into days by date */
  commits?: GitCommit[];
}

export interface BuildJournalOptions {
  /** reads a transcript .jsonl off disk (or wherever) — injected so the build
   * stays pure and testable. Return '' for an unreadable path. */
  loadTranscript: (absPath: string) => string;
  /** cap on entries kept in each digest's path / command lists. Default 300. */
  maxListLen?: number;
}

// -----------------------------------------------------------------------------
// Session digest
// -----------------------------------------------------------------------------

function oneLine(s: string, max: number): string {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Leading tags whose content is pure machine noise — the whole entry is dropped. */
const NOISE_TAG =
  /^<(local-command|command-name|command-message|command-args|command-contents|bash-|task-notification|system-reminder|system-info|pneuma:|viewer-context|user-prompt-submit-hook|user_instructions|environment_context|INSTRUCTIONS)/i;

/**
 * Reduce a raw `user` message to the human prompt inside it, or '' when there
 * is none. Claude Code, Codex, the harness, and tools like Pneuma all inject
 * synthetic user entries — command output, task notifications, environment
 * context, the Codex AGENTS.md preamble — which yield ''. Content-bearing
 * wrappers (`<task>`, …) are unwrapped to the prose inside them.
 */
function cleanPrompt(raw: string): string {
  const t = raw.trim();
  if (t === '' || t.startsWith('[Request interrupted')) return '';
  if (t.startsWith('# AGENTS.md') || t.startsWith('# Files mentioned')) return '';
  if (NOISE_TAG.test(t)) return '';
  if (t.startsWith('<')) return t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

/** Pull the file path a file-touching tool acted on, if any. */
function toolFilePath(input: any): string | null {
  if (!input || typeof input !== 'object') return null;
  const p = input.file_path ?? input.notebook_path ?? input.path;
  return typeof p === 'string' && p.trim() ? p : null;
}

function safeJsonParse(s: unknown): any {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Codex's shell-running tools — its equivalent of Claude Code's `Bash`. */
const CODEX_SHELL_TOOLS = new Set(['exec_command', 'shell', 'local_shell', 'container.exec', 'run']);

/** Pull the command string out of a Codex shell tool's arguments. */
function codexCommandText(args: any): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  const c = args.command ?? args.cmd ?? args.script;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const flag = c.findIndex((x: unknown) => x === '-lc' || x === '-c');
    if (flag >= 0 && typeof c[flag + 1] === 'string') return c[flag + 1];
    return c.filter((x: unknown) => typeof x === 'string').join(' ');
  }
  return '';
}

/**
 * Pull the touched file paths out of a Codex `apply_patch` call's arguments,
 * which may arrive as a JSON string, a `{ input }` object, or the raw patch.
 */
function applyPatchFiles(raw: unknown): string[] {
  let patch = '';
  if (typeof raw === 'string') {
    const parsed = safeJsonParse(raw);
    const fromObj =
      parsed && typeof parsed === 'object'
        ? typeof parsed.input === 'string'
          ? parsed.input
          : typeof parsed.patch === 'string'
            ? parsed.patch
            : null
        : null;
    patch = fromObj ?? raw;
  } else if (raw && typeof raw === 'object') {
    const o = raw as any;
    patch = typeof o.input === 'string' ? o.input : typeof o.patch === 'string' ? o.patch : '';
  }
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\*\s+(?:Update|Add|Delete) File:\s*(.+)$/gm)) {
    const f = m[1]?.trim();
    if (f) out.push(f);
  }
  return out;
}

/**
 * A session's digest plus its raw event timestamps. The timestamps stay
 * internal — used to merge active time across a day's sessions — and never
 * reach `SessionDigest` or the API.
 */
interface Digested {
  digest: SessionDigest;
  /** event timestamps (ms), ascending */
  timestamps: number[];
}

/** Per-day accumulator while a transcript is being walked. */
interface DaySlice {
  timestamps: number[];
  model: string | null;
  openingPrompt: string;
  userTurns: number;
  assistantTurns: number;
  filesEdited: Set<string>;
  filesRead: Set<string>;
  commands: string[];
  commandSeen: Set<string>;
  toolCounts: Record<string, number>;
}

/**
 * Mine a transcript into per-day digests. A session that spans several
 * calendar days yields one `Digested` per day, each holding only that day's
 * activity — so a session resumed across days counts toward every day it
 * actually touched, in the heatmap and in active time alike.
 */
function digestInternal(
  ref: SessionRef,
  transcriptText: string,
  maxListLen: number = DEFAULT_MAX_LIST_LEN,
): Digested[] {
  const entries = parseTranscript(transcriptText);
  const gitBranch: string | null = ref.meta.gitBranch ?? null;

  const slices = new Map<string, DaySlice>();
  const fallbackDate = todayLocalDate(new Date(ref.mtimeMs));
  let currentDate = fallbackDate;

  const sliceFor = (date: string): DaySlice => {
    let s = slices.get(date);
    if (!s) {
      s = {
        timestamps: [],
        model: ref.meta.model ?? null,
        openingPrompt: '',
        userTurns: 0,
        assistantTurns: 0,
        filesEdited: new Set<string>(),
        filesRead: new Set<string>(),
        commands: [],
        commandSeen: new Set<string>(),
        toolCounts: {},
      };
      slices.set(date, s);
    }
    return s;
  };

  // A timestamp both advances the current day and joins that day's stream.
  const noteTime = (v: unknown): void => {
    if (typeof v !== 'string') return;
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) return;
    currentDate = todayLocalDate(new Date(ms));
    sliceFor(currentDate).timestamps.push(ms);
  };
  const addPath = (set: Set<string>, p: string): void => {
    if (set.size < maxListLen) set.add(p);
  };
  const addCommand = (s: DaySlice, raw: string): void => {
    const c = oneLine(raw, COMMAND_MAX);
    if (!c || s.commandSeen.has(c)) return;
    s.commandSeen.add(c);
    if (s.commands.length < maxListLen) s.commands.push(c);
  };
  const recordTool = (s: DaySlice, name: string, input: any): void => {
    s.toolCounts[name] = (s.toolCounts[name] ?? 0) + 1;
    if (EDIT_TOOLS.has(name)) {
      const p = toolFilePath(input);
      if (p) addPath(s.filesEdited, p);
    } else if (READ_TOOLS.has(name)) {
      const p = toolFilePath(input);
      if (p) addPath(s.filesRead, p);
    } else if (SHELL_TOOLS.has(name)) {
      if (input && typeof input.command === 'string') addCommand(s, input.command);
    }
  };

  noteTime(ref.meta.startedAt);

  for (const { entry } of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const e: any = entry;
    noteTime(e.timestamp);
    noteTime(e.payload?.timestamp);
    const slice = sliceFor(currentDate);

    if (ref.agent === 'codex') {
      if (e.type === 'turn_context' && typeof e.payload?.model === 'string') {
        slice.model = e.payload.model;
      }
      if (e.type !== 'response_item') continue;
      const p = e.payload ?? {};
      const kind = p.type;
      if (kind === 'message') {
        if (p.role === 'user' || p.role === 'human') {
          const text = cleanPrompt(messageText(p.content));
          if (text) {
            slice.userTurns++;
            if (!slice.openingPrompt) slice.openingPrompt = oneLine(text, OPENING_PROMPT_MAX);
          }
        } else {
          slice.assistantTurns++;
        }
      } else if (kind === 'function_call' || kind === 'custom_tool_call') {
        const name = String(p.name || 'fn');
        slice.toolCounts[name] = (slice.toolCounts[name] ?? 0) + 1;
        const rawArgs = p.arguments ?? p.input;
        if (name === 'apply_patch') {
          for (const f of applyPatchFiles(rawArgs)) addPath(slice.filesEdited, f);
        } else if (CODEX_SHELL_TOOLS.has(name)) {
          const cmd = codexCommandText(safeJsonParse(rawArgs));
          if (cmd) addCommand(slice, cmd);
        }
      } else if (kind === 'local_shell_call') {
        slice.toolCounts.shell = (slice.toolCounts.shell ?? 0) + 1;
        const cmd = codexCommandText(p.action ?? p);
        if (cmd) addCommand(slice, cmd);
      }
      continue;
    }

    // claude-code / cowork
    if (e.type === 'user' && categorize(e, ref.agent) === 'user') {
      if (e.isMeta !== true && e.isCompactSummary !== true) {
        const text = cleanPrompt(messageText(e.message?.content));
        if (text) {
          slice.userTurns++;
          if (!slice.openingPrompt) slice.openingPrompt = oneLine(text, OPENING_PROMPT_MAX);
        }
      }
    } else if (e.type === 'assistant') {
      slice.assistantTurns++;
      if (typeof e.message?.model === 'string') slice.model = e.message.model;
    }
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || (b.type !== 'tool_use' && b.type !== 'server_tool_use')) continue;
        recordTool(slice, String(b.name || 'tool'), b.input);
      }
    }
  }

  if (slices.size === 0) sliceFor(fallbackDate);

  const out: Digested[] = [];
  for (const [date, s] of slices) {
    s.timestamps.sort((a, b) => a - b);
    const startMs = s.timestamps.length ? s.timestamps[0]! : null;
    const endMs = s.timestamps.length ? s.timestamps[s.timestamps.length - 1]! : null;
    out.push({
      digest: {
        id: ref.id,
        agent: ref.agent,
        path: ref.path,
        cwd: ref.cwd,
        date,
        startedAt: startMs != null ? new Date(startMs).toISOString() : null,
        endedAt: endMs != null ? new Date(endMs).toISOString() : null,
        activeMs: activeMsOf(s.timestamps),
        model: s.model,
        gitBranch,
        openingPrompt: s.openingPrompt,
        userTurns: s.userTurns,
        assistantTurns: s.assistantTurns,
        filesEdited: [...s.filesEdited],
        filesRead: [...s.filesRead],
        commands: s.commands,
        toolCounts: s.toolCounts,
        sizeBytes: ref.sizeBytes,
        sidecarCount: ref.sidecarFiles.length,
      },
      timestamps: s.timestamps,
    });
  }
  out.sort((a, b) => a.digest.date.localeCompare(b.digest.date));
  return out;
}

/**
 * Mine one session's transcript into per-day digests — a session that spans
 * several calendar days yields one `SessionDigest` per day. Single-day
 * sessions yield a one-element array.
 */
export function digestSession(
  ref: SessionRef,
  transcriptText: string,
  maxListLen: number = DEFAULT_MAX_LIST_LEN,
): SessionDigest[] {
  return digestInternal(ref, transcriptText, maxListLen).map((d) => d.digest);
}

// -----------------------------------------------------------------------------
// Day / project assembly
// -----------------------------------------------------------------------------

function buildDayEntry(
  projectId: string,
  date: string,
  items: Digested[],
  commits: GitCommit[],
): DayEntry {
  const sessions = items.map((i) => i.digest);
  const filesEdited = new Set<string>();
  const agents = new Set<SessionAgent>();
  let commandCount = 0;
  let startedAt: string | null = null;
  let endedAt: string | null = null;

  for (const s of sessions) {
    for (const f of s.filesEdited) filesEdited.add(f);
    commandCount += s.commands.length;
    agents.add(s.agent);
    if (s.startedAt && (startedAt === null || s.startedAt < startedAt)) startedAt = s.startedAt;
    if (s.endedAt && (endedAt === null || s.endedAt > endedAt)) endedAt = s.endedAt;
  }

  // Active time: gap-sum over ALL the day's events merged, so sessions that
  // overlap in wall-clock time aren't double-counted. Capped at 24h.
  const merged = items.flatMap((i) => i.timestamps).sort((a, b) => a - b);
  const activeMs = Math.min(activeMsOf(merged), DAY_MS);

  // The day card's headline is the first thing asked that day.
  const earliest = [...sessions].sort((a, b) =>
    (a.startedAt ?? '~').localeCompare(b.startedAt ?? '~'),
  )[0];

  return {
    date,
    projectId,
    sessions,
    sessionCount: sessions.length,
    startedAt,
    endedAt,
    activeMs,
    filesEdited: [...filesEdited],
    commandCount,
    openingPrompt: earliest?.openingPrompt ?? '',
    agents: [...agents],
    commits,
  };
}

/** Whole days from `a` to `b` (both YYYY-MM-DD); negative if `b` precedes `a`. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000);
}

/** A new phase opens after this many idle days … */
const PHASE_GAP_DAYS = 4;
/** … or once the current phase has already run this long. */
const PHASE_MAX_SPAN_DAYS = 30;

/**
 * Cut a project's days into phases at its activity gaps — the metadata-only
 * segmentation. A pause longer than PHASE_GAP_DAYS, or a phase that has run
 * past PHASE_MAX_SPAN_DAYS, opens the next one. The narrative engine titles
 * and re-segments these later; until then a phase is just its date range.
 */
function segmentPhases(daysNewestFirst: readonly DayEntry[]): Phase[] {
  if (daysNewestFirst.length === 0) return [];
  const chrono = [...daysNewestFirst].reverse();
  const groups: DayEntry[][] = [];
  let cur: DayEntry[] = [];
  for (const day of chrono) {
    if (cur.length > 0) {
      const gap = daysBetween(cur[cur.length - 1]!.date, day.date);
      const span = daysBetween(cur[0]!.date, day.date);
      if (gap > PHASE_GAP_DAYS || span > PHASE_MAX_SPAN_DAYS) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(day);
  }
  if (cur.length > 0) groups.push(cur);

  return groups.map((g, i) => ({
    index: i + 1,
    startDate: g[0]!.date,
    endDate: g[g.length - 1]!.date,
    dayCount: g.length,
    sessionCount: g.reduce((sum, d) => sum + d.sessionCount, 0),
    days: [...g].reverse(),
  }));
}

/** Assemble one project's journal from its already-discovered sessions. */
export function buildProjectJournal(
  input: ProjectInput,
  opts: BuildJournalOptions,
): ProjectJournal {
  const maxListLen = opts.maxListLen ?? DEFAULT_MAX_LIST_LEN;
  // One session can span several days — flatMap yields its per-day digests.
  const digested = input.sessions.flatMap((ref) =>
    digestInternal(ref, opts.loadTranscript(ref.path), maxListLen),
  );

  const byDate = new Map<string, Digested[]>();
  for (const item of digested) {
    const arr = byDate.get(item.digest.date);
    if (arr) arr.push(item);
    else byDate.set(item.digest.date, [item]);
  }

  // commits the project's repo recorded, bucketed by the date they were authored
  const commitsByDate = new Map<string, GitCommit[]>();
  for (const c of input.commits ?? []) {
    const arr = commitsByDate.get(c.date);
    if (arr) arr.push(c);
    else commitsByDate.set(c.date, [c]);
  }

  const days: DayEntry[] = [];
  for (const [date, items] of byDate) {
    items.sort((a, b) => (b.digest.startedAt ?? '').localeCompare(a.digest.startedAt ?? ''));
    days.push(buildDayEntry(input.projectId, date, items, commitsByDate.get(date) ?? []));
  }
  days.sort((a, b) => b.date.localeCompare(a.date));

  return {
    projectId: input.projectId,
    displayName: input.displayName,
    cwds: [...input.cwds],
    days,
    phases: segmentPhases(days),
    firstDate: days.length ? days[days.length - 1]!.date : null,
    lastDate: days.length ? days[0]!.date : null,
    totalSessions: input.sessions.length,
    totalActiveMs: days.reduce((sum, d) => sum + d.activeMs, 0),
    totalCommits: days.reduce((sum, d) => sum + d.commits.length, 0),
  };
}

/** Assemble the whole journal — every project plus the cross-project timeline. */
export function buildJournal(inputs: ProjectInput[], opts: BuildJournalOptions): Journal {
  const projects = inputs.map((i) => buildProjectJournal(i, opts));

  const byDate = new Map<string, { sessionCount: number; projects: Set<string>; activeMs: number }>();
  for (const p of projects) {
    for (const day of p.days) {
      const a = byDate.get(day.date) ?? { sessionCount: 0, projects: new Set<string>(), activeMs: 0 };
      a.sessionCount += day.sessionCount;
      a.projects.add(p.projectId);
      a.activeMs += day.activeMs;
      byDate.set(day.date, a);
    }
  }

  const activity: ActivityDay[] = [...byDate.entries()]
    .map(([date, a]) => ({
      date,
      sessionCount: a.sessionCount,
      projectCount: a.projects.size,
      activeMs: a.activeMs,
    }))
    .sort((x, y) => x.date.localeCompare(y.date));

  return { projects, activity, generatedAt: new Date().toISOString() };
}
