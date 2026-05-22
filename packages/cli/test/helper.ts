/**
 * Test helper mirroring conftest.py's `cli` + `tmp_project` fixtures.
 *
 * `runCli(argv, { input? })` invokes the CLI's main() in-process with
 * stdout/stderr captured. `makeTmpProject()` creates an isolated tmp cwd
 * + HOME so each test's user-home project tree
 * (`~/.code-journal/<userId>/<orgId>/projects/<projectId>/...`) lands in a
 * fresh sandbox.
 *
 * `MOCK_USER_ID` / `MOCK_ORG_ID` are the single-tenant defaults all tests
 * share; `initArgv()` slips them into every init invocation so individual
 * tests don't repeat them.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main } from '../src/index';

export const MOCK_USER_ID = 'mock-user';
export const MOCK_ORG_ID = 'mock-org';

export function initArgv(projectId: string, ...extra: string[]): string[] {
  return [
    'init',
    '--user-id', MOCK_USER_ID,
    '--org-id', MOCK_ORG_ID,
    '--project-id', projectId,
    ...extra,
  ];
}

export interface CliResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  output: string; // stdout + stderr concatenated, mirroring conftest.py
}

export async function runCli(argv: string[], opts: { input?: string } = {}): Promise<CliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown): boolean => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown): boolean => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
  let rc: number;
  try {
    rc = await main(argv, opts.input !== undefined ? { stdin: opts.input } : {});
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = origOut;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = origErr;
  }
  const stdout = stdoutChunks.join('');
  const stderr = stderrChunks.join('');
  return { exit_code: rc, stdout, stderr, output: stdout + stderr };
}

export interface TmpProject {
  tmpDir: string;
  homeDir: string;
  cleanup: () => void;
  projRootFor: (id: string) => string;
  chdir: (p: string) => void;
}

export function makeTmpProject(): TmpProject {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-test-')));
  const homeDir = path.join(tmpDir, '.home');
  fs.mkdirSync(homeDir);
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origCwd = process.cwd();
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.chdir(tmpDir);
  return {
    tmpDir,
    homeDir,
    cleanup: () => {
      try {
        process.chdir(origCwd);
      } catch {
        /* origCwd may have been deleted */
      }
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
    projRootFor: (projectId: string) =>
      path.join(homeDir, '.code-journal', MOCK_USER_ID, MOCK_ORG_ID, 'projects', projectId),
    chdir: (p: string) => process.chdir(p),
  };
}

/**
 * Build a stdin payload representing one entry's markdown.
 * Mirrors the `_entry_md` helper used in test_storage.py.
 */
export function entryMd(
  opts: { kind?: string; summary?: string; task?: string; body?: string } = {},
): string {
  const { kind = 'note', summary = 'did a thing', task = 'T-1', body = '## Narrative\n\nbody text\n' } = opts;
  const fm = { kind, refs: { task }, summary, tags: ['mvp'] };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\n${body}`;
}
