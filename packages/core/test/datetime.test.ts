/**
 * Unit tests for the timezone-aware reckoning helpers — deterministic against
 * fixed instants and pinned IANA zones (no dependency on the host's zone).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dateInTimezone,
  hostTimezone,
  isoInTimezone,
  splitIsoComponents,
  tzOffsetIso,
} from '../src/datetime';

// 2026-05-31T19:15:00Z is 2026-06-01 03:15 in UTC+8 — the exact midnight-
// straddle that motivated the fix (UTC date trails the local date by a day).
const STRADDLE = new Date('2026-05-31T19:15:00Z');

test('dateInTimezone resolves the calendar day in the target zone', () => {
  assert.equal(dateInTimezone(STRADDLE, 'UTC'), '2026-05-31');
  assert.equal(dateInTimezone(STRADDLE, 'Asia/Shanghai'), '2026-06-01');
  // America/Los_Angeles (-07:00 in summer) trails UTC: an early-UTC instant
  // lands on the previous local day.
  assert.equal(
    dateInTimezone(new Date('2026-07-01T03:00:00Z'), 'America/Los_Angeles'),
    '2026-06-30',
  );
});

test('isoInTimezone renders the wall-clock with the zone offset', () => {
  assert.equal(isoInTimezone(STRADDLE, 'Asia/Shanghai'), '2026-06-01T03:15:00+08:00');
  assert.equal(isoInTimezone(STRADDLE, 'UTC'), '2026-05-31T19:15:00+00:00');
});

test('tzOffsetIso tracks DST transitions', () => {
  // America/New_York: EST (-05:00) in winter, EDT (-04:00) in summer.
  assert.equal(tzOffsetIso(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), '-05:00');
  assert.equal(tzOffsetIso(new Date('2026-07-15T12:00:00Z'), 'America/New_York'), '-04:00');
  assert.equal(tzOffsetIso(STRADDLE, 'Asia/Shanghai'), '+08:00');
});

test('the filing-date invariant: splitIsoComponents(isoInTimezone) === dateInTimezone', () => {
  // This is the load-bearing equality the whole fix rests on — an entry's
  // created_at (isoInTimezone) is sliced by splitIsoComponents to file it, and
  // that filed date must equal how queries reckon the day (dateInTimezone).
  for (const tz of ['UTC', 'Asia/Shanghai', 'America/New_York', 'America/Los_Angeles']) {
    for (const iso of ['2026-05-31T19:15:00Z', '2026-07-01T03:00:00Z', '2026-01-01T00:30:00Z']) {
      const d = new Date(iso);
      assert.equal(
        splitIsoComponents(isoInTimezone(d, tz)).date,
        dateInTimezone(d, tz),
        `${iso} @ ${tz}`,
      );
    }
  }
});

test('hostTimezone returns a usable IANA zone', () => {
  const tz = hostTimezone();
  assert.equal(typeof tz, 'string');
  assert.ok(tz.length > 0);
  // It must be a zone Intl actually accepts.
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: tz }));
});
