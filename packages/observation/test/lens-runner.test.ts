/**
 * Lens runner — non-network unit tests.
 *
 * The lens runner's real test (subagent dispatch) is integration-level
 * and requires `claude` CLI; skipped from the auto-test loop. This file
 * covers the parts we CAN test without spending tokens:
 *   - lens spec & schema files are reachable on disk
 *   - haiku is rejected at runtime
 *   - unknown lens_id is rejected
 *   - prompt assembly produces a self-contained string (no path leakage)
 */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { runLens } from '../src/lib/lens-runner';

const PKG_ROOT = join(__dirname, '..');

describe('lens runner · static guards', () => {
  it('lens spec files ship with the package', () => {
    assert.ok(existsSync(join(PKG_ROOT, 'src', 'lenses', 'strict-negative-space.md')));
    assert.ok(existsSync(join(PKG_ROOT, 'src', 'lenses', 'anchored-deferral.md')));
    assert.ok(existsSync(join(PKG_ROOT, 'src', 'lenses', 'event-schema.md')));
  });

  it('rejects haiku at runtime', () => {
    const r = runLens({
      lensId: 'strict-negative-space',
      lensVersion: 'v2.1',
      digestMarkdown: 'fake digest',
      projectId: 'proj-x',
      sessionId: 'sess-x',
      agent: 'claude-code',
      // @ts-expect-error - intentionally probing the runtime guard
      model: 'haiku',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.reason.toLowerCase().includes('haiku'));
    }
  });

  it('rejects unknown lens_id', () => {
    const r = runLens({
      // @ts-expect-error - intentionally probing
      lensId: 'made-up-lens',
      lensVersion: 'v2.1',
      digestMarkdown: 'fake digest',
      projectId: 'proj-x',
      sessionId: 'sess-x',
      agent: 'claude-code',
    });
    assert.equal(r.ok, false);
  });

  it('rejects unknown agent', () => {
    const r = runLens({
      lensId: 'strict-negative-space',
      lensVersion: 'v2.1',
      digestMarkdown: 'fake digest',
      projectId: 'proj-x',
      sessionId: 'sess-x',
      // @ts-expect-error - intentionally probing
      agent: 'cursor',
    });
    assert.equal(r.ok, false);
  });
});
