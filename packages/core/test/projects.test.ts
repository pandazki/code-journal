/**
 * Unified Project foundation — resolution/grouping is pure (registry + repoKey
 * injected); registry I/O + mutations run against an isolated $HOME so they
 * never touch the real ~/.code-journal tree.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  groupSessionsByProject,
  projectConfig,
  projectIdFor,
  readProjectRegistry,
  setProjectConfig,
  assignMember,
  upsertProject,
  type ProjectRegistry,
} from '../src/projects';
import type { SessionRef } from '../src/sessions';

function ref(id: string, cwd: string): SessionRef {
  return { id, agent: 'claude-code', path: '/s/' + id + '.jsonl', cwd, sizeBytes: 1, mtimeMs: 1, meta: {}, sidecarFiles: [] };
}
const EMPTY: ProjectRegistry = { version: 1, projects: [] };

// ── grouping (pure) ──────────────────────────────────────────────────────

test('empty registry reproduces auto-Project behavior (one repo = one project, junk/single dropped)', () => {
  const groups = groupSessionsByProject(
    [
      ref('a', '/work/app'),
      ref('b', '/work/app-wt'), // worktree of /work/app
      ref('c', '/x/.codex'), // hidden → dropped
      ref('d', '/x/.codex'),
      ref('e', '/x/oneoff'), // single session → dropped
      ref('f', '/work/app'),
    ],
    { registry: EMPTY, repoKey: (cwd) => (cwd.startsWith('/work/app') ? '/work/app' : null) },
  );
  assert.deepEqual(groups.map((g) => g.project.displayName), ['app']);
  assert.equal(groups[0]!.sessions.length, 3);
  assert.deepEqual(groups[0]!.project.members, ['/work/app']);
});

test('a registered Project groups several repos into one, with the user name', () => {
  const registry: ProjectRegistry = {
    version: 1,
    projects: [{ id: 'mything', displayName: 'My Thing', members: ['/code/api', '/docs/site'], config: {} }],
  };
  const groups = groupSessionsByProject(
    [
      ref('a', '/code/api'),
      ref('b', '/code/api'),
      ref('c', '/docs/site'),
      ref('d', '/other'),
      ref('e', '/other'),
    ],
    { registry, repoKey: (cwd) => cwd }, // each cwd is its own repo
  );
  const mine = groups.find((g) => g.project.id === 'mything')!;
  assert.equal(mine.project.displayName, 'My Thing');
  assert.equal(mine.sessions.length, 3); // 2 api + 1 docs, folded together
  assert.deepEqual(mine.project.members.sort(), ['/code/api', '/docs/site']);
  // the unrelated repo is still its own auto-Project
  assert.ok(groups.some((g) => g.project.id === projectIdFor('/other')));
});

test('a registered Project appears even below the auto min-session threshold', () => {
  const registry: ProjectRegistry = {
    version: 1,
    projects: [{ id: 'solo', displayName: 'Solo', members: ['/lone'], config: {} }],
  };
  const groups = groupSessionsByProject([ref('a', '/lone')], { registry, repoKey: (cwd) => cwd });
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.project.id, 'solo');
});

test('projectConfig returns the registered config, else empty', () => {
  const registry: ProjectRegistry = {
    version: 1,
    projects: [{ id: 'p', displayName: 'P', members: [], config: { timezone: 'Asia/Tokyo', model: 'opus' } }],
  };
  assert.deepEqual(projectConfig('p', registry), { timezone: 'Asia/Tokyo', model: 'opus' });
  assert.deepEqual(projectConfig('nope', registry), {});
});

// ── registry I/O + mutations (isolated $HOME) ──────────────────────────────

let restore: (() => void) | null = null;
afterEach(() => { if (restore) { restore(); restore = null; } });
function freshHome(): void {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-proj-')));
  const home = path.join(tmp, '.home');
  fs.mkdirSync(home);
  const oh = process.env.HOME, ou = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  restore = () => {
    oh === undefined ? delete process.env.HOME : (process.env.HOME = oh);
    ou === undefined ? delete process.env.USERPROFILE : (process.env.USERPROFILE = ou);
    fs.rmSync(tmp, { recursive: true, force: true });
  };
}

test('registry starts empty and round-trips config + members', () => {
  freshHome();
  assert.deepEqual(readProjectRegistry().projects, []);

  setProjectConfig('demo-abc123', { timezone: 'Asia/Shanghai', composeThreshold: 20 }, 'Demo');
  let reg = readProjectRegistry();
  assert.equal(reg.projects.length, 1);
  assert.equal(reg.projects[0]!.displayName, 'Demo');
  assert.equal(projectConfig('demo-abc123').timezone, 'Asia/Shanghai');
  assert.equal(projectConfig('demo-abc123').composeThreshold, 20);

  // config merges, doesn't clobber
  setProjectConfig('demo-abc123', { model: 'opus' });
  assert.equal(projectConfig('demo-abc123').timezone, 'Asia/Shanghai');
  assert.equal(projectConfig('demo-abc123').model, 'opus');
});

test('assignMember moves a repo to exactly one Project', () => {
  freshHome();
  upsertProject('p1', { displayName: 'One', members: ['/r/a', '/r/b'] });
  assignMember('p2', '/r/b', 'Two'); // steal /r/b from p1
  const reg = readProjectRegistry();
  assert.deepEqual(reg.projects.find((p) => p.id === 'p1')!.members, ['/r/a']);
  assert.deepEqual(reg.projects.find((p) => p.id === 'p2')!.members, ['/r/b']);
});
