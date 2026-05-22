/**
 * @code-journal/tui — entry point.
 *
 *   cj              launch the Ink board
 *   cj sync [proj]  headless incremental upload (cron target), then exit
 *   cj --version    print version
 *   cj --check      render one frame and exit 0 (binary smoke-test)
 */
import { EventEmitter } from 'node:events';
import { render } from 'ink';
import React from 'react';

import { App } from './app';
import { cronStatus, installCron, removeCron } from './cron';
import { runSync } from './sync';
import { CJ_VERSION } from './version';

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === '--version' || cmd === '-v') {
  console.log(`cj ${CJ_VERSION}`);
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h') {
  console.log(
    [
      `cj ${CJ_VERSION} — code-journal session manager`,
      '',
      'Usage:',
      '  cj                     launch the TUI board',
      '  cj sync [project]      upload new / changed sessions and exit (cron target)',
      '  cj cron install [expr] install the scheduled-upload job (default: 0 */4 * * *)',
      '  cj cron status         show the scheduled-upload job',
      '  cj cron remove         remove the scheduled-upload job',
      '  cj --version           print version',
      '  cj --help              show this help',
    ].join('\n'),
  );
  process.exit(0);
}

if (cmd === 'cron') {
  const sub = argv[1];
  try {
    if (sub === 'status') {
      const st = cronStatus();
      console.log(st.installed ? `installed: ${st.expr}` : 'not installed');
      process.exit(0);
    }
    if (sub === 'remove') {
      removeCron();
      console.log('scheduled upload removed');
      process.exit(0);
    }
    if (sub === 'install') {
      const expr = argv[2] || '0 */4 * * *';
      installCron(process.execPath, expr);
      console.log(`scheduled upload installed: ${expr}  →  ${process.execPath} sync`);
      process.exit(0);
    }
    console.error('usage: cj cron <status|install [cron-expr]|remove>');
    process.exit(1);
  } catch (e: unknown) {
    console.error(`cron: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

if (cmd === 'sync') {
  try {
    const result = await runSync({ projectId: argv[1] });
    console.log(
      `sync: ${result.uploaded} uploaded, ${result.failed} failed, ${result.skipped} up-to-date`,
    );
    for (const err of result.errors.slice(0, 10)) console.error(`  ${err}`);
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (e: unknown) {
    console.error(`sync failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

const checkMode = argv.includes('--check');

/**
 * Ink 7 throws if handed the real `process.stdin` when it's not a TTY — exactly
 * the --check / CI case. An inert stub sidesteps that while still rendering.
 */
function inertStdin(): NodeJS.ReadStream {
  const s = new EventEmitter() as unknown as NodeJS.ReadStream;
  Object.assign(s, {
    isTTY: false,
    setRawMode: () => s,
    ref: () => s,
    unref: () => s,
    read: () => null,
    setEncoding: () => s,
    resume: () => s,
    pause: () => s,
  });
  return s;
}

const { waitUntilExit } = render(<App checkMode={checkMode} />, {
  stdin: checkMode ? inertStdin() : process.stdin,
});
await waitUntilExit();
