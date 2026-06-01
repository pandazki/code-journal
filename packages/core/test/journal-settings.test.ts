/**
 * Journal per-project settings store — round-trip, host-zone fallback, and
 * zone validation. Isolated to a temp $HOME so it never touches the real
 * ~/.code-journal tree.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  hostTimezone,
  journalProjectTimezone,
  readJournalSettings,
  setJournalProjectTimezone,
} from '../src/index';

let restore: (() => void) | null = null;

afterEach(() => {
  if (restore) {
    restore();
    restore = null;
  }
});

function freshHome(): void {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-jsettings-')));
  const homeDir = path.join(tmpDir, '.home');
  fs.mkdirSync(homeDir);
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  restore = () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
}

test('unset project falls back to the host timezone', () => {
  freshHome();
  assert.deepEqual(readJournalSettings(), {});
  assert.equal(journalProjectTimezone('proj-abc123'), hostTimezone());
});

test('a pinned timezone round-trips and is read back', () => {
  freshHome();
  setJournalProjectTimezone('proj-abc123', 'Asia/Shanghai');
  assert.equal(journalProjectTimezone('proj-abc123'), 'Asia/Shanghai');
  // Persisted to disk, not just in memory.
  assert.equal(readJournalSettings()['proj-abc123']?.timezone, 'Asia/Shanghai');
  // Other projects are unaffected → still host.
  assert.equal(journalProjectTimezone('proj-other'), hostTimezone());
});

test('clearing a timezone (empty string) reverts to host', () => {
  freshHome();
  setJournalProjectTimezone('p', 'America/New_York');
  setJournalProjectTimezone('p', '');
  assert.equal(journalProjectTimezone('p'), hostTimezone());
  assert.ok(!('timezone' in (readJournalSettings().p ?? {})));
});

test('an unknown timezone is rejected', () => {
  freshHome();
  assert.throws(() => setJournalProjectTimezone('p', 'Mars/Olympus'), /unknown timezone/);
  // Nothing was written.
  assert.deepEqual(readJournalSettings(), {});
});
