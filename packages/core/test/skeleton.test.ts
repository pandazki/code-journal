import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/index';

test('core: VERSION is a semver-ish string', () => {
  assert.equal(typeof VERSION, 'string');
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test('core: VERSION tracks package.json', () => {
  // The exported VERSION constant must be bumped together with package.json.
  assert.equal(VERSION, '0.1.0');
});
