/**
 * The narrative engine's pure half — building the prompts the host coding
 * agent answers, the cache keys, and reply parsing. The agent call and disk
 * caching are environment-specific and live in the app; this module stays
 * pure and testable.
 *
 * Narrative is enrichment: the journal is fully usable on metadata alone. When
 * a narrative exists it is layered onto `DayEntry.story` / `ProjectJournal.story`.
 */
import type { DayEntry, ProjectJournal } from './journal';

/** A cached narrative — `key` ties it to the exact data it was written from. */
export interface CachedNarrative {
  /** content key; when the source data changes this changes and the cache goes stale */
  key: string;
  /** a short headline (day narratives only) */
  title?: string;
  /** the recap, one entry per paragraph */
  story: string[];
  generatedAt: string;
}

/** FNV-1a, base-36 — a compact content key. */
function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const base = (p: string): string => p.split('/').pop() ?? p;

/** A stable content key for a day — changes when the day's work changes. */
export function dayNarrativeKey(day: DayEntry): string {
  return fnv(
    [
      day.date,
      day.sessionCount,
      Math.round(day.activeMs / 60000),
      day.commandCount,
      day.filesEdited.join(','),
      day.commits.map((c) => c.sha).join(','),
      day.sessions.map((s) => s.openingPrompt).join('|'),
    ].join('§'),
  );
}

/** A stable content key for a project's arc. */
export function projectNarrativeKey(project: ProjectJournal): string {
  return fnv(
    [
      project.projectId,
      project.totalSessions,
      project.totalCommits,
      String(project.firstDate),
      String(project.lastDate),
      project.days.map((d) => d.date).join(','),
    ].join('§'),
  );
}

const DAY_GUIDANCE =
  'Output exactly this shape:\n' +
  '- Line 1: a title — at most 8 words, plain text, no quotes or markdown, naming what the ' +
  'day was about.\n' +
  '- Then a blank line.\n' +
  "- Then 2 short paragraphs recapping the day from the developer's point of view: what they " +
  'set out to do and how it went. Name the actual modules, features, and files worked on, ' +
  'concretely. Past tense. No praise, no filler, never say "the developer".';

/** Build the prompt that asks the host agent to recap one day. */
export function buildDayPrompt(day: DayEntry, projectName: string): string {
  const lines = ["You are writing one day's entry in a developer's work journal.", ''];
  lines.push(`Project: ${projectName}`, `Date: ${day.date}`, '', 'Sessions, oldest first:');
  for (const s of [...day.sessions].reverse()) {
    const files = s.filesEdited.slice(0, 6).map(base).join(', ');
    lines.push(
      `- "${s.openingPrompt || '(no opening prompt)'}" — ` +
        `${s.filesEdited.length} files edited${files ? ' (' + files + ')' : ''}, ` +
        `${s.commands.length} commands`,
    );
  }
  if (day.commits.length) {
    lines.push('', 'Commits:');
    for (const c of day.commits.slice(0, 24)) lines.push(`- ${c.subject}`);
  }
  lines.push('', DAY_GUIDANCE);
  return lines.join('\n');
}

const PROJECT_GUIDANCE =
  "Write 2 short paragraphs telling this project's arc so far, from the developer's point " +
  'of view — how it began, how it shifted, where it stands now. Name the actual features ' +
  'and concerns. Past tense. No praise, no filler. Output only the two paragraphs, ' +
  'separated by one blank line.';

/** Build the prompt that asks the host agent to recap a project's arc. */
export function buildProjectPrompt(project: ProjectJournal): string {
  const lines = ["You are writing the opening of a project's chapter in a developer's work journal.", ''];
  lines.push(
    `Project: ${project.displayName}`,
    `${project.totalSessions} sessions over ${project.days.length} active days, ` +
      `${project.firstDate} to ${project.lastDate}.`,
    '',
    'The work, day by day (oldest first):',
  );
  for (const d of [...project.days].reverse()) {
    lines.push(`- ${d.date}: ${d.openingPrompt || base(d.filesEdited[0] ?? 'misc')}`);
  }
  lines.push('', PROJECT_GUIDANCE);
  return lines.join('\n');
}

/** Split an agent's reply into paragraphs (blank-line separated). */
export function parseStory(reply: string): string[] {
  return reply
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Split a day reply into its title line and the paragraphs that follow it. */
export function parseDayNarrative(reply: string): { title: string; story: string[] } {
  const paras = parseStory(reply);
  if (paras.length === 0) return { title: '', story: [] };
  const title = paras[0]!.replace(/^["'#*\s]+|["'*\s]+$/g, '').slice(0, 90);
  return { title, story: paras.slice(1) };
}
