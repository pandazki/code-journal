/**
 * L4 projection — report path resolution, write, and pending-list.
 *
 * Port of code_journal/reports.py.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { projectRoot } from './paths';
import { DEFAULT_CATCHUP_LOOKBACK_DAYS } from './defaults';
import { isoLocalNow } from './datetime';
import { ReportMeta, serializeReportMeta } from './models';
import { atomicWriteFileSync, queryEntries, shiftDate, splitFrontmatter } from './storage';

export function reportPath(window: string, fmt: string, cwd?: string): string {
  return path.join(projectRoot(cwd), 'reports', `${window}-${fmt}.md`);
}

/**
 * A daily report is "stale" if it was generated on the same calendar day it
 * covers — i.e. `generated_at.slice(0,10) === window`. That marks a report
 * drafted while the day was still in progress: more entries may land
 * afterwards, so the next catch-up should regenerate.
 *
 * A report with no `generated_at` field (legacy reports written before the
 * field landed) is treated as **stable** — we don't go back and re-draft
 * old reports forever. The rule's scope is implicitly forward-only.
 *
 * Note for manual writers: if you author a report by hand and want it to
 * survive subsequent catch-ups, set `generated_at` to **a later day** than
 * `window` (or omit it entirely on a legacy-style write). Setting it to
 * the same day as `window` is the in-progress-draft marker and will be
 * picked up for regeneration.
 */
export function isReportStale(filePath: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  let fm;
  try {
    fm = splitFrontmatter(text).fm;
  } catch {
    return false;
  }
  const window = typeof fm.window === 'string' ? fm.window : '';
  const generated = typeof fm.generated_at === 'string' ? fm.generated_at : '';
  if (!window || !generated) return false;
  return generated.slice(0, 10) === window;
}

export interface WriteReportOptions {
  content: string;
  meta: ReportMeta;
  cwd?: string;
  /** Unconditionally overwrite an existing file. */
  force?: boolean;
  /**
   * If the existing report at the target path is "stale" (generated on the
   * same calendar day it covers — see `isReportStale`), overwrite it. Doesn't
   * touch stable reports. Use this when re-running the drafter to bring a
   * same-day draft up to the latest entries.
   */
  replaceIfStale?: boolean;
}

export function writeReport(opts: WriteReportOptions): string {
  const { content, meta, cwd, force = false, replaceIfStale = false } = opts;
  const p = reportPath(meta.window, meta.format, cwd);
  if (fs.existsSync(p) && !force) {
    if (!replaceIfStale || !isReportStale(p)) {
      throw new Error(`${p} already exists (use --force to overwrite)`);
    }
    // Existing file is stale — fall through and overwrite.
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Defense-in-depth: if a non-CLI caller forgot to populate `generated_at`,
  // fill it here so the file is never born "stable-because-empty" (which
  // would silently make it ineligible for next-day catch-up regeneration).
  // The CLI's cmdWriteReport also auto-fills earlier; this is the safety
  // net for any future caller bypassing the CLI.
  const metaWithGen: ReportMeta = meta.generated_at ? meta : { ...meta, generated_at: isoLocalNow() };
  const fm = serializeReportMeta(metaWithGen);
  const body = `---\n${JSON.stringify(fm, null, 2)}\n---\n\n${content.replace(/^\s+/, '')}`;
  atomicWriteFileSync(p, body);
  return p;
}

/**
 * List YYYY-MM-DD days within the lookback window that need (re)drafting.
 *
 * A date is "pending" if either:
 *   - no report file exists for it AND the day has entries, OR
 *   - a report file exists but is **stale** (generated on the same day it
 *     covers — see `isReportStale`) AND the day still has entries.
 *
 * Never includes today — `endBound = today − 1`. The catch-up orchestrator
 * is responsible for adding today separately when the user clicks Generate
 * (we don't know there if more work is coming after the click).
 */
export function listPendingDaily(opts: { lookbackDays?: number; cwd?: string } = {}): string[] {
  const { lookbackDays = DEFAULT_CATCHUP_LOOKBACK_DAYS, cwd } = opts;
  // Use the HOST'S LOCAL TIMEZONE for "today" — entries and reports are
  // dated by local wall-clock (see work-log-synthesizer step 1 and
  // `isReportStale`). A UTC-based boundary would silently drop yesterday's
  // report from the pending list near midnight in non-UTC zones (e.g.
  // UTC+8 at 09:00 local, UTC's "today" is still yesterday → endBound is
  // the day before that → real yesterday never gets drafted).
  const today = todayLocalDateString();
  const endBound = shiftDate(today, -1);
  const capFloor = shiftDate(today, -lookbackDays);
  const reportsDir = path.join(projectRoot(cwd), 'reports');

  // Distinguish "no file at all" (missing) from "file exists but stale".
  // Stable files cause the date to be excluded from pending; missing or
  // stale files put the date back in play.
  const stable = new Set<string>();
  try {
    for (const f of fs.readdirSync(reportsDir)) {
      if (!f.endsWith('-daily.md')) continue;
      const dateKey = f.replace(/-daily\.md$/, '');
      const fp = path.join(reportsDir, f);
      if (!isReportStale(fp)) stable.add(dateKey);
    }
  } catch {
    /* reports dir doesn't exist yet — all candidate dates are pending */
  }

  const out: string[] = [];
  let cur = capFloor;
  while (cur <= endBound) {
    if (!stable.has(cur)) {
      const rows = queryEntries({ window: cur, cwd });
      if (rows.length > 0) out.push(cur);
    }
    cur = shiftDate(cur, 1);
  }
  return out;
}

function todayLocalDateString(): string {
  // Slice the YYYY-MM-DD prefix off the host-local ISO string. Avoids
  // pulling Date getters individually and avoids any UTC conversion.
  return isoLocalNow().slice(0, 10);
}
