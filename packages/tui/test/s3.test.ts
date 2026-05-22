import assert from 'node:assert/strict';
import test from 'node:test';

import type { S3Settings } from '../src/config/config';
import {
  joinKey,
  normalizeEndpoint,
  projectPrefix,
  sessionPrefix,
  sidecarKey,
  transcriptKey,
  metaKey,
} from '../src/s3/client';

const withPrefix: S3Settings = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'b',
  prefix: 'team/cj',
  forcePathStyle: true,
};
const noPrefix: S3Settings = { ...withPrefix, prefix: '' };

test('joinKey trims stray slashes and drops empty segments', () => {
  assert.equal(joinKey('a', 'b', 'c'), 'a/b/c');
  assert.equal(joinKey('/a/', '', '/b/'), 'a/b');
  assert.equal(joinKey(''), '');
});

test('object keys use the folder-per-session layout, with a prefix', () => {
  assert.equal(transcriptKey(withPrefix, 'demo', 's1'), 'team/cj/sessions/demo/s1/transcript.jsonl');
  assert.equal(metaKey(withPrefix, 'demo', 's1'), 'team/cj/sessions/demo/s1/meta.json');
  assert.equal(
    sidecarKey(withPrefix, 'demo', 's1', 'subagents/agent-a1.jsonl'),
    'team/cj/sessions/demo/s1/subagents/agent-a1.jsonl',
  );
  assert.equal(projectPrefix(withPrefix, 'demo'), 'team/cj/sessions/demo/');
  assert.equal(sessionPrefix(withPrefix, 'demo', 's1'), 'team/cj/sessions/demo/s1/');
});

test('object keys work with an empty prefix', () => {
  assert.equal(transcriptKey(noPrefix, 'demo', 's1'), 'sessions/demo/s1/transcript.jsonl');
  assert.equal(projectPrefix(noPrefix, 'demo'), 'sessions/demo/');
});

test('normalizeEndpoint strips any path — the common R2 paste mistake', () => {
  // R2 dashboard hands out a per-bucket URL; only scheme+host may survive.
  assert.equal(
    normalizeEndpoint('https://acct.r2.cloudflarestorage.com/coding-agent-sessions'),
    'https://acct.r2.cloudflarestorage.com',
  );
  assert.equal(normalizeEndpoint('https://s3.example.com'), 'https://s3.example.com');
  assert.equal(normalizeEndpoint('minio.local:9000'), 'https://minio.local:9000');
  assert.equal(normalizeEndpoint('  '), '');
});
