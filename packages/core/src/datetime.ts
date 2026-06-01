/**
 * Datetime formatting helpers shaped to match Python's behaviour.
 *
 * Python's `datetime.now(timezone.utc).isoformat()` produces strings like
 * `"2026-05-13T14:30:00+00:00"` (no sub-second) or
 * `"2026-05-13T14:30:00.123456+00:00"` (with microseconds). Node only has
 * millisecond precision; we pad microseconds with three trailing zeros so
 * the string shape stays Python-compatible.
 */

export function isoUtcNow(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  const ms = d.getUTCMilliseconds();
  const sub = ms === 0 ? '' : `.${pad(ms, 3)}000`;
  return `${y}-${mo}-${da}T${h}:${mi}:${s}${sub}+00:00`;
}

/**
 * Wall-clock ISO 8601 in the host's local timezone — e.g. `2026-05-13T15:30:00+08:00`.
 *
 * Used for report-meta `generated_at`, where readers (and the drafter's
 * rendered "Generated <date>" line) think in wall-clock terms, not UTC.
 * For machine-comparable timestamps (sorting, log boundaries) keep using
 * `isoUtcNow`.
 */
export function isoLocalNow(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  // getTimezoneOffset is minutes WEST of UTC, so flip the sign.
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offMin);
  const offHH = pad(Math.floor(absMin / 60));
  const offMM = pad(absMin % 60);
  return `${y}-${mo}-${da}T${h}:${mi}:${s}${sign}${offHH}:${offMM}`;
}

/**
 * Today's date string in the host's local timezone — `YYYY-MM-DD`.
 *
 * Used by synth-context to compute the discovery window in local-tz natural
 * days. UTC-based date math would surprise a
 * user in UTC+8 at 8am: they'd see "yesterday" because UTC is still on the
 * prior calendar day. Local-tz dates match how the user thinks about
 * "today's work."
 */
export function todayLocalDate(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Timezone-aware reckoning (configurable, IANA zones)
//
// The host-local helpers above read the *process* timezone via Date getters.
// These let a project pin which timezone its days are reckoned in (entry
// filing date, "today" boundaries, report staleness) independent of where the
// process happens to run — defaulting to the auto-detected host zone. All of
// them route through `Intl` so any IANA zone (e.g. "Asia/Shanghai") works.
// ---------------------------------------------------------------------------

/** The host's IANA timezone (e.g. "Asia/Shanghai"); "UTC" if undetectable. */
export function hostTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Wall-clock parts of instant `d` as seen in IANA zone `tz`. */
function partsInTimezone(
  d: Date,
  tz: string,
): { y: number; mo: number; da: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23', // 00–23; avoids the "24:00" quirk of hour12:false
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) if (p.type !== 'literal') m[p.type] = p.value;
  return {
    y: Number(m.year),
    mo: Number(m.month),
    da: Number(m.day),
    h: Number(m.hour),
    mi: Number(m.minute),
    s: Number(m.second),
  };
}

/** `tz`'s UTC offset in minutes (east positive) at instant `d`. */
function tzOffsetMinutes(d: Date, tz: string): number {
  const p = partsInTimezone(d, tz);
  const asIfUtc = Date.UTC(p.y, p.mo - 1, p.da, p.h, p.mi, p.s);
  // asIfUtc reads the local wall-clock as though it were UTC; its distance
  // from the real instant is the zone's offset. Rounded to the minute (all
  // real zones are whole-minute; `d`'s sub-second never crosses a boundary).
  return Math.round((asIfUtc - d.getTime()) / 60_000);
}

/**
 * `YYYY-MM-DD` for instant `d` in zone `tz` (default: host). The single
 * source of truth for "what day did this happen on" once a project pins a
 * timezone.
 */
export function dateInTimezone(d: Date = new Date(), tz: string = hostTimezone()): string {
  const p = partsInTimezone(d, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.da)}`;
}

/** `tz`'s UTC offset at instant `d` in ISO form (`+08:00` / `-05:00`). */
export function tzOffsetIso(d: Date = new Date(), tz: string = hostTimezone()): string {
  const off = tzOffsetMinutes(d, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/**
 * Wall-clock ISO 8601 for instant `d` in zone `tz` (default: host) — e.g.
 * `2026-06-01T03:15:00+08:00`. Used for entry `created_at` so the literal
 * date sliced off it (how entries are filed) is the project-timezone day.
 */
export function isoInTimezone(d: Date = new Date(), tz: string = hostTimezone()): string {
  const p = partsInTimezone(d, tz);
  const off = tzOffsetMinutes(d, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${p.y}-${pad(p.mo)}-${pad(p.da)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}

/**
 * Host local-tz UTC offset in ISO-8601 form (`+08:00` / `-05:00`).
 *
 * Surfaced to the synthesizer so it can build local-tz timestamps
 * (work_started_at / work_ended_at with the user's offset preserved) without
 * recomputing the offset from scratch.
 */
export function localTzOffsetIso(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offMin);
  return `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
}

/**
 * Add (or subtract) days to a `YYYY-MM-DD` string — pure string math, no
 * timezone involvement. Day-rollover at month/year boundaries handled.
 */
export function shiftLocalDate(yyyymmdd: string, deltaDays: number): string {
  const m = yyyymmdd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`bad date: ${yyyymmdd}`);
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + deltaDays);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export interface IsoComponents {
  date: string; // "YYYY-MM-DD"
  yyyymm: string; // "YYYY-MM"
  tsSafe: string; // "YYYY-MM-DDTHH-MM-SS" (colons replaced by dashes)
}

/**
 * Parse out the components of an ISO-8601 datetime string by pure string
 * extraction — no Date conversion, so a value like "2026-03-15T10:00:00+00:00"
 * always produces "2026-03-15T10-00-00" regardless of local timezone offsets.
 */
export function splitIsoComponents(iso: string): IsoComponents {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`bad ISO datetime: ${iso}`);
  const [, y, mo, d, h, mi, s] = m;
  return {
    date: `${y}-${mo}-${d}`,
    yyyymm: `${y}-${mo}`,
    tsSafe: `${y}-${mo}-${d}T${h}-${mi}-${s}`,
  };
}
