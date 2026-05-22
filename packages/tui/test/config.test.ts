import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  configExists,
  emptyConfig,
  loadConfig,
  loadCredentials,
  saveConfig,
  saveCredentials,
} from '../src/config/config';
import { credentialsPath } from '../src/config/paths';
import { isUploaded, loadManifest, recordUpload } from '../src/config/uploads';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cj-tui-cfg-'));
  process.env.CJ_HOME = home;
});
afterEach(() => {
  delete process.env.CJ_HOME;
  rmSync(home, { recursive: true, force: true });
});

test('config does not exist on a fresh home, then round-trips', () => {
  assert.equal(configExists(), false);
  assert.deepEqual(loadConfig(), emptyConfig());

  const cfg = {
    version: 1 as const,
    projects: [{ id: 'demo', name: 'Demo', cwds: ['/tmp/a', '/tmp/b'] }],
    s3: { endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'b', prefix: 'p', forcePathStyle: true },
  };
  saveConfig(cfg);
  assert.equal(configExists(), true);
  assert.deepEqual(loadConfig(), cfg);
});

test('credentials persist with 0600 permissions', () => {
  assert.equal(loadCredentials(), null);
  saveCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'shh' });
  assert.deepEqual(loadCredentials(), { accessKeyId: 'AKIA', secretAccessKey: 'shh' });
  const mode = statSync(credentialsPath()).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('a corrupt config file falls back to empty rather than throwing', () => {
  saveConfig(emptyConfig());
  // clobber it with garbage
  saveCredentials({ accessKeyId: 'x', secretAccessKey: 'y' }); // unrelated, just to touch the dir
  rmSync(join(home, 'config.json'));
  assert.deepEqual(loadConfig(), emptyConfig());
});

test('upload manifest records and reports uploaded sessions', () => {
  let mf = loadManifest();
  assert.equal(isUploaded(mf, 'demo', 's1'), false);
  mf = recordUpload(mf, {
    projectId: 'demo',
    sessionId: 's1',
    agent: 'claude-code',
    uploadedAt: new Date().toISOString(),
    fileCount: 3,
    sizeBytes: 1234,
    transcriptMtimeMs: 1700000000000,
    transcriptSizeBytes: 999,
  });
  assert.equal(isUploaded(mf, 'demo', 's1'), true);
  // a fresh load sees the persisted record
  assert.equal(isUploaded(loadManifest(), 'demo', 's1'), true);
  assert.equal(isUploaded(loadManifest(), 'demo', 's2'), false);
});
