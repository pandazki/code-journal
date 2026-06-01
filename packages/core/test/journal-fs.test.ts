import assert from 'node:assert/strict';
import test from 'node:test';

import { groupSessionsByRepo } from '../src/journal-fs';
import type { SessionRef } from '../src/sessions';

function ref(id: string, cwd: string): SessionRef {
  return {
    id,
    agent: 'claude-code',
    path: '/s/' + id + '.jsonl',
    cwd,
    sizeBytes: 1,
    mtimeMs: 1,
    meta: {},
    sidecarFiles: [],
  };
}

test("groupSessionsByRepo folds a repo's worktrees into one project", () => {
  const repoKey = (cwd: string) => (cwd.startsWith('/work/app') ? '/work/app' : null);
  const groups = groupSessionsByRepo(
    [
      ref('a', '/work/app'),
      ref('b', '/work/app-wt'), // a worktree of the same repo
      ref('c', '/work/app/pkg'),
      ref('d', '/solo'),
      ref('e', '/solo'),
    ],
    repoKey,
  );
  const app = groups.find((g) => g.project.displayName === 'app')!;
  assert.equal(app.sessions.length, 3); // main + worktree + subdir, one project
  const solo = groups.find((g) => g.project.displayName === 'solo')!;
  assert.equal(solo.sessions.length, 2);
});

test('groupSessionsByRepo drops boot dirs, hidden dirs, and single-session dirs', () => {
  const groups = groupSessionsByRepo(
    [
      ref('a', '/x/claude-code-boot-AaBb'),
      ref('b', '/x/claude-code-boot-AaBb'),
      ref('c', '/x/.codex'),
      ref('d', '/x/.codex'),
      ref('e', '/x/realproj'),
      ref('f', '/x/realproj'),
      ref('g', '/x/oneoff'),
    ],
    () => null,
  );
  assert.deepEqual(
    groups.map((g) => g.project.displayName),
    ['realproj'],
  );
});

test('groupSessionsByRepo ids are url-safe and path-distinct', () => {
  const id = (cwd: string) =>
    groupSessionsByRepo([ref('a', cwd), ref('b', cwd)], () => null)[0]!.project.id;
  assert.match(id('/a/app'), /^[a-z0-9-]+$/);
  assert.notEqual(id('/a/app'), id('/b/app')); // same basename, different path → different id
});
