/**
 * Append-only activity log at ~/.code-journal/tui/cj.log — written by both the
 * interactive TUI and the headless `cj sync` cron runs, so there's one place
 * to see what happened. Logging must never throw.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { cjHome } from './config/paths';

export type LogLevel = 'info' | 'warn' | 'error';

const MAX_LOG_BYTES = 1_000_000; // 1 MB — past this, keep the most recent half

export function logPath(): string {
  return join(cjHome(), 'cj.log');
}

function rotateIfLarge(path: string): void {
  try {
    if (statSync(path).size > MAX_LOG_BYTES) {
      const text = readFileSync(path, 'utf8');
      writeFileSync(path, text.slice(-Math.floor(MAX_LOG_BYTES / 2)));
    }
  } catch {
    /* file may not exist yet */
  }
}

/** Append one line. Tagged with the source ('tui' | 'sync') so the log reads clearly. */
export function log(level: LogLevel, source: string, msg: string): void {
  try {
    const path = logPath();
    mkdirSync(dirname(path), { recursive: true });
    rotateIfLarge(path);
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${msg}\n`;
    appendFileSync(path, line);
  } catch {
    /* logging must never break the caller */
  }
}

/** Last `maxLines` log lines, oldest-first. Empty when the log doesn't exist. */
export function readLogTail(maxLines: number): string[] {
  try {
    const lines = readFileSync(logPath(), 'utf8').split('\n').filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

export function clearLog(): void {
  try {
    writeFileSync(logPath(), '');
  } catch {
    /* ignore */
  }
}
