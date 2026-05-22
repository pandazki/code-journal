import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { countSessionsForProject, discoverSessionsForProject } from '../src/sessions';

test('discoverSessionsForProject with no cwds discovers nothing', () => {
  assert.deepEqual(discoverSessionsForProject([]), []);
});

test('discoverSessionsForProject over an empty dir yields no sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cj-sessions-'));
  try {
    // A real but session-free directory: no agent has ever recorded a session whose cwd is here.
    assert.deepEqual(discoverSessionsForProject([dir]), []);
    assert.equal(countSessionsForProject([dir]), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('countSessionsForProject never throws', () => {
  assert.equal(countSessionsForProject([]), 0);
  assert.equal(typeof countSessionsForProject(['/nonexistent/path/xyz']), 'number');
});
