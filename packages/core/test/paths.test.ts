/**
 * Path-resolution unit tests. Focused on the project-root fast-path and
 * its companion write-side guard in `addCwdToConfig` — exercising them
 * directly against the core module rather than through the CLI, so
 * defense-in-depth invariants still get covered even when upper layers
 * intercept the failure case earlier.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addCwdToConfig,
  defaultProject,
  ensureDirs,
  findProjectKeyForCwd,
  isProjectRootPath,
  makeProjectKey,
  projectRootFor,
  writeProject,
} from '../src/index';

interface Tmp {
  tmpDir: string;
  homeDir: string;
  cleanup: () => void;
}

let cur: Tmp | null = null;

afterEach(() => {
  if (cur) {
    cur.cleanup();
    cur = null;
  }
});

function fresh(): Tmp {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-core-test-')));
  const homeDir = path.join(tmpDir, '.home');
  fs.mkdirSync(homeDir);
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  cur = {
    tmpDir,
    homeDir,
    cleanup: () => {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (origUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = origUserProfile;
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
  return cur;
}

function bootstrapProject(): { key: ReturnType<typeof makeProjectKey>; root: string } {
  const key = makeProjectKey('alice', 'acme', 'demo');
  const root = projectRootFor(key);
  const proj = defaultProject(key, { displayName: 'Demo' });
  writeProject(proj, root, { cwds: [], first_registered: '', last_updated: '' });
  ensureDirs(root);
  return { key, root };
}

test('findProjectKeyForCwd resolves via fast-path when cwd IS the project root', () => {
  fresh();
  const { root } = bootstrapProject();
  const resolved = findProjectKeyForCwd(root);
  assert.ok(resolved, 'expected fast-path to resolve');
  assert.equal(resolved!.userId, 'alice');
  assert.equal(resolved!.orgId, 'acme');
  assert.equal(resolved!.projectId, 'demo');
});

test('findProjectKeyForCwd: fast-path declines when config.json is missing', () => {
  const t = fresh();
  // Create the shape under user-home but skip writing config.json.
  const fakeRoot = path.join(t.homeDir, '.code-journal', 'u', 'o', 'projects', 'p');
  fs.mkdirSync(fakeRoot, { recursive: true });
  assert.equal(findProjectKeyForCwd(fakeRoot), null);
});

test('isProjectRootPath flags paths inside a project tree', () => {
  fresh();
  const { root } = bootstrapProject();
  // Exact project root.
  assert.equal(isProjectRootPath(root), true);
  // One level shallower: outside any project tree.
  assert.equal(isProjectRootPath(path.dirname(root)), false);
  // Project-internal subdirs (.synth/, log/, reports/) all live UNDER a
  // project root and should be recognized as project-internal so that
  // (a) the work-log-synthesizer can spawn in .synth/current and still
  // resolve its project, and (b) addCwdToConfig refuses to register them.
  assert.equal(isProjectRootPath(path.join(root, 'log', 'entries')), true);
  assert.equal(isProjectRootPath(path.join(root, '.synth', 'current')), true);
});

test('addCwdToConfig refuses to register a project-root path', () => {
  fresh();
  const { key, root } = bootstrapProject();
  // Defense-in-depth: the call would be intercepted upstream in normal
  // CLI flow, but the guard fires when invoked directly.
  assert.throws(
    () => addCwdToConfig(key, root),
    /refusing to register project-root path/i,
  );
});

test('addCwdToConfig accepts a normal cwd outside the workMemoryRoot tree', () => {
  const t = fresh();
  const { key } = bootstrapProject();
  const normal = path.join(t.tmpDir, 'some-code-repo');
  fs.mkdirSync(normal, { recursive: true });
  addCwdToConfig(key, normal);
  // Verify it landed.
  const cfg = JSON.parse(fs.readFileSync(path.join(projectRootFor(key), 'config.json'), 'utf8'));
  assert.ok((cfg.cwds as string[]).some((c) => fs.realpathSync.native(c) === fs.realpathSync.native(normal)));
});
