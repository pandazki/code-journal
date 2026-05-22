/**
 * Scheduled upload via the system `crontab`. The job is kept in a marked block
 * so install/remove only ever touch our own lines, never the user's other
 * cron entries.
 */
import { execFileSync } from 'node:child_process';

import { logPath } from './log';

const BEGIN = '# >>> code-journal-tui >>>';
const END = '# <<< code-journal-tui <<<';

export interface CronStatus {
  installed: boolean;
  /** the schedule line currently installed, if any */
  line: string | null;
  /** the cron expression alone (the 5 schedule fields) */
  expr: string | null;
}

function readCrontab(): string {
  try {
    return execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return ''; // no crontab yet, or crontab unavailable
  }
}

function writeCrontab(content: string): void {
  execFileSync('crontab', ['-'], { input: content });
}

/** Drop our marked block from a crontab body, leaving everything else intact. */
function stripBlock(tab: string): string {
  const re = new RegExp(`\\n?${BEGIN}\\n[\\s\\S]*?\\n${END}\\n?`, 'g');
  return tab.replace(re, '\n').replace(/^\n+/, '');
}

export function cronStatus(): CronStatus {
  const tab = readCrontab();
  const m = new RegExp(`${BEGIN}\\n([\\s\\S]*?)\\n${END}`).exec(tab);
  if (!m) return { installed: false, line: null, expr: null };
  const line = m[1]!.split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) ?? null;
  const expr = line ? line.trim().split(/\s+/).slice(0, 5).join(' ') : null;
  return { installed: true, line, expr };
}

/**
 * Install (or replace) the scheduled-upload job. `cronExpr` is the 5-field
 * schedule, e.g. "*​/30 * * * *". The job runs `<binPath> sync` and appends
 * output to the cj log.
 */
export function installCron(binPath: string, cronExpr: string): void {
  const line = `${cronExpr} "${binPath}" sync >> "${logPath()}" 2>&1`;
  const block = `${BEGIN}\n${line}\n${END}`;
  const base = stripBlock(readCrontab()).trimEnd();
  writeCrontab((base ? base + '\n' : '') + block + '\n');
}

export function removeCron(): void {
  const base = stripBlock(readCrontab()).trimEnd();
  writeCrontab(base ? base + '\n' : '');
}

/** True iff a system `crontab` binary is callable at all. */
export function cronAvailable(): boolean {
  try {
    execFileSync('crontab', ['-l'], { stdio: 'ignore' });
    return true;
  } catch (e: unknown) {
    // exit 1 with "no crontab for user" still means crontab exists
    return e instanceof Error && 'status' in e;
  }
}
