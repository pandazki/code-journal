/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Discover the raw coding-agent session files that touched a given project, so a caller can
 * upload them (deduped by session id) for browsing.
 *
 * Discovery spans Claude Code, Codex, and Claude Cowork,
 * deduped by session id across each registered cwd.
 *
 * Claude Code stores per-project sessions under ~/.claude/projects/<encoded-cwd>/ (the dir name
 * is the absolute cwd with path separators turned into dashes). The encoded-dir match is the fast
 * path; for the slow path (and for cwds whose own encoded dir doesn't exist yet but other dirs
 * carry sessions that ran in their subtree) we probe the head of every .jsonl in every other dir.
 *
 * Codex stores rollouts under ~/.codex/sessions/<date>/<rollout>.jsonl — we probe the head for
 * session_meta.payload.{cwd,id}.
 *
 * Claude Cowork (Claude Code running in a Claude Desktop sandbox) stores sessions under
 * ~/Library/Application Support/Claude/local-agent-mode-sessions/ as .../local_<uuid>/ dirs, each
 * beside a local_<uuid>.json metadata file. The transcript's own cwd is a throwaway sandbox path,
 * so we scope on the metadata's userSelectedFolders[] (overlapping a registered root in either
 * direction) and upload the session's local_<uuid>/audit.jsonl.
 *
 * Dedup is per (agent, id) — a session that shows up under multiple match-paths only counts once.
 */

export type SessionAgent = 'claude-code' | 'codex' | 'cowork';

export interface SidecarFile {
  /** path relative to the sidecar dir, POSIX "/"-separated (e.g. "subagents/agent-a1.jsonl") */
  relPath: string;
  /** absolute path on disk */
  absPath: string;
  sizeBytes: number;
}

export interface SessionRef {
  /** session/rollout id — the dedup key */
  id: string;
  agent: SessionAgent;
  /** absolute path to the session .jsonl */
  path: string;
  /** cwd the session ran in (best-effort) */
  cwd: string;
  sizeBytes: number;
  mtimeMs: number;
  /**
   * Config snapshot the session recorded for itself — model, agent version, git branch, start
   * time, … (best-effort, extracted from the file's head). Values are strings; absent keys are
   * omitted.
   */
  meta: Record<string, string>;
  /**
   * Files in the sibling <id>/ sidecar dir Claude Code writes next to the transcript — subagent
   * transcripts (subagents/agent-*.jsonl) and spilled large tool outputs (tool-results/*).
   * Empty when there's no sidecar dir (and always empty for Codex / Cowork).
   */
  sidecarFiles: SidecarFile[];
}

const HEAD_BYTES = 64 * 1024;

function readHead(file: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** How Claude Code names a project's session dir: the absolute cwd with path separators → '-'. */
function claudeEncodedDir(absCwd: string): string {
  return absCwd.replace(/[/\\]/g, '-');
}

/** True iff `candidate` is at or beneath any of `roots`. */
function cwdMatchesAny(candidate: string | undefined, roots: readonly string[]): candidate is string {
  if (!candidate) return false;
  const r = path.resolve(candidate);
  for (const root of roots) {
    if (r === root || r.startsWith(root + path.sep)) return true;
  }
  return false;
}

/**
 * True iff `folder` overlaps any root — equal, an ancestor, or a descendant. Cowork's
 * userSelectedFolders is the access-granted directory and can sit on either side of a registered
 * cwd, so containment is tested both ways.
 */
function folderOverlapsAny(folder: string, roots: readonly string[]): boolean {
  const f = path.resolve(folder);
  for (const root of roots) {
    if (f === root || f.startsWith(root + path.sep) || root.startsWith(f + path.sep)) return true;
  }
  return false;
}

/**
 * List a cwd's git worktrees as absolute paths. Empty array when the dir isn't a git repo, git
 * isn't installed, or the command fails — we always degrade silently. Includes the cwd's own
 * root worktree, so callers can dedup against it.
 */
function gitWorktreesFor(cwd: string): string[] {
  try {
    const stdout = execFileSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const out: string[] = [];
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) out.push(path.resolve(line.slice('worktree '.length).trim()));
    }
    return out;
  } catch {
    return [];
  }
}

/** Resolve every registered cwd into the union {cwd, ...its-git-worktrees}, deduped. */
function expandToWorktreeUnion(cwds: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const c of cwds) {
    const abs = path.resolve(c);
    if (!seen.has(abs)) seen.add(abs);
    for (const w of gitWorktreesFor(abs)) {
      if (!seen.has(w)) seen.add(w);
    }
  }
  return [...seen];
}

function setMeta(meta: Record<string, string>, key: string, val: unknown): void {
  if (!(key in meta) && typeof val === 'string' && val.trim()) meta[key] = val.trim();
}

function probeClaude(head: string): { cwd?: string; id?: string; meta: Record<string, string> } {
  let cwd: string | undefined;
  let id: string | undefined;
  const meta: Record<string, string> = {};
  for (const line of head.split('\n').slice(0, 50)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o: any;
    try {
      o = JSON.parse(t);
    } catch {
      continue;
    }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    if (!id && typeof o.sessionId === 'string') id = o.sessionId;
    if (!id && typeof o.session_id === 'string') id = o.session_id;
    setMeta(meta, 'version', o.version);
    setMeta(meta, 'gitBranch', o.gitBranch);
    setMeta(meta, 'startedAt', o.timestamp);
    setMeta(meta, 'model', o.message?.model ?? o.model);
    if (cwd && id && meta.model && meta.version) break;
  }
  return { cwd, id, meta };
}

function probeCodex(head: string): { cwd?: string; id?: string; meta: Record<string, string> } {
  let cwd: string | undefined;
  let id: string | undefined;
  const meta: Record<string, string> = {};
  for (const line of head.split('\n').slice(0, 50)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o: any;
    try {
      o = JSON.parse(t);
    } catch {
      continue;
    }
    const p = o.payload && typeof o.payload === 'object' ? o.payload : o;
    if (!cwd && typeof p.cwd === 'string') cwd = p.cwd;
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    if (!id && typeof p.id === 'string') id = p.id;
    if (!id && typeof p.session_id === 'string') id = p.session_id;
    setMeta(meta, 'startedAt', p.timestamp ?? o.timestamp);
    setMeta(meta, 'model', p.model);
    setMeta(meta, 'version', p.cli_version ?? p.codex_version);
    setMeta(meta, 'originator', p.originator);
    if (cwd && id && meta.model) break;
  }
  return { cwd, id, meta };
}

function walkJsonl(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (e.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Recursively list every file under a session's sidecar dir, returning each with its POSIX
 * relative path. Depth-limited (the real tree is shallow) and silently degrading.
 */
export function walkSidecar(root: string): SidecarFile[] {
  const out: SidecarFile[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e);
      const childRel = rel ? `${rel}/${e}` : e;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs, childRel, depth + 1);
      else out.push({ relPath: childRel, absPath: abs, sizeBytes: st.size });
    }
  };
  walk(root, '', 0);
  return out;
}

/** Find every Cowork session-metadata file (local_<uuid>.json) under a root, depth-limited. */
function walkCoworkMetas(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const isMeta = /^local_[0-9a-fA-F-]+\.json$/;
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (isMeta.test(e)) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Discover sessions across all of a project's registered cwds plus their git worktrees.
 *
 * Empty `cwds` is treated as "discover nothing" (returns []) — a project with no registered
 * cwds simply has nothing to sweep.
 */
export function discoverSessionsForProject(cwds: readonly string[]): SessionRef[] {
  const roots = expandToWorktreeUnion(cwds);
  if (roots.length === 0) return [];
  const fastDirNames = new Set(roots.map(claudeEncodedDir));

  const out: SessionRef[] = [];
  const seen = new Set<string>();
  const add = (ref: SessionRef): void => {
    const key = `${ref.agent}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  // ── Claude Code ──────────────────────────────────────────
  const ccRoot = path.join(os.homedir(), '.claude', 'projects');
  if (isDir(ccRoot)) {
    let dirNames: string[] = [];
    try {
      dirNames = readdirSync(ccRoot).filter((d) => isDir(path.join(ccRoot, d)));
    } catch {
      /* ignore */
    }
    for (const d of dirNames) {
      const dirPath = path.join(ccRoot, d);
      const isFast = fastDirNames.has(d);
      let files: string[] = [];
      try {
        files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const fp = path.join(dirPath, f);
        let st;
        try {
          st = statSync(fp);
        } catch {
          continue;
        }
        const probed = probeClaude(readHead(fp));
        const fallbackId = f.replace(/\.jsonl$/, '');
        // Claude Code's sibling <id>/ dir holds subagent transcripts and spilled tool outputs.
        const sidecarDir = path.join(dirPath, fallbackId);
        const sidecarFiles = isDir(sidecarDir) ? walkSidecar(sidecarDir) : [];
        if (isFast) {
          const resolvedCwd = probed.cwd
            ? path.resolve(probed.cwd)
            : (roots.find((r) => claudeEncodedDir(r) === d) ?? roots[0]!);
          add({
            id: probed.id ?? fallbackId,
            agent: 'claude-code',
            path: fp,
            cwd: resolvedCwd,
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
            meta: probed.meta,
            sidecarFiles,
          });
        } else if (cwdMatchesAny(probed.cwd, roots)) {
          add({
            id: probed.id ?? fallbackId,
            agent: 'claude-code',
            path: fp,
            cwd: path.resolve(probed.cwd),
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
            meta: probed.meta,
            sidecarFiles,
          });
        }
      }
    }
  }

  // ── Codex ────────────────────────────────────────────────
  const cxRoot = path.join(os.homedir(), '.codex', 'sessions');
  if (isDir(cxRoot)) {
    for (const fp of walkJsonl(cxRoot, 4)) {
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      const probed = probeCodex(readHead(fp));
      if (probed.id && cwdMatchesAny(probed.cwd, roots)) {
        add({
          id: probed.id,
          agent: 'codex',
          path: fp,
          cwd: path.resolve(probed.cwd),
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          meta: probed.meta,
          sidecarFiles: [],
        });
      }
    }
  }

  // ── Claude Cowork ────────────────────────────────────────
  const cwRoot = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'local-agent-mode-sessions',
  );
  if (isDir(cwRoot)) {
    for (const metaPath of walkCoworkMetas(cwRoot, 4)) {
      let m: any;
      try {
        m = JSON.parse(readFileSync(metaPath, 'utf8'));
      } catch {
        continue;
      }
      const folders: string[] = Array.isArray(m.userSelectedFolders)
        ? m.userSelectedFolders.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      const anchor = folders.find((f) => folderOverlapsAny(f, roots));
      if (!anchor) continue;
      const auditPath = path.join(metaPath.replace(/\.json$/, ''), 'audit.jsonl');
      let st;
      try {
        st = statSync(auditPath);
      } catch {
        continue;
      }
      const id =
        typeof m.sessionId === 'string' && m.sessionId ? m.sessionId : path.basename(metaPath, '.json');
      const meta: Record<string, string> = {};
      setMeta(meta, 'model', m.model);
      setMeta(meta, 'title', m.title);
      if (typeof m.createdAt === 'number') setMeta(meta, 'startedAt', new Date(m.createdAt).toISOString());
      add({
        id,
        agent: 'cowork',
        path: auditPath,
        cwd: path.resolve(anchor),
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        meta,
        sidecarFiles: [],
      });
    }
  }

  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/** Cheap count for dashboards. */
export function countSessionsForProject(cwds: readonly string[]): number {
  try {
    return discoverSessionsForProject(cwds).length;
  } catch {
    return 0;
  }
}

/** Read a session .jsonl (or sidecar file) from disk; '' on any error. */
export function readSessionFile(absPath: string): string {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

/** The git repository root containing `cwd`, or null when it isn't in a repo. */
export function gitRootOf(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const root = out.trim();
    return root ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

export interface ScannedCwd {
  /** absolute working directory a coding agent recorded sessions for */
  cwd: string;
  agent: SessionAgent;
  sessionCount: number;
}

/**
 * Sweep every agent's session store for the distinct cwds they recorded, with
 * per-agent session counts — the input to the TUI's "auto-scan → generate
 * projects" flow. Cheap by design: one cwd-probe per Claude Code project dir
 * (all files in a dir share a cwd), not one probe per file.
 */
export function scanSessionCwds(): ScannedCwd[] {
  const out: ScannedCwd[] = [];

  // Claude Code — one dir per cwd
  const ccRoot = path.join(os.homedir(), '.claude', 'projects');
  if (isDir(ccRoot)) {
    let dirNames: string[] = [];
    try {
      dirNames = readdirSync(ccRoot).filter((d) => isDir(path.join(ccRoot, d)));
    } catch {
      /* ignore */
    }
    for (const d of dirNames) {
      const dirPath = path.join(ccRoot, d);
      let files: string[] = [];
      try {
        files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      if (files.length === 0) continue;
      const probed = probeClaude(readHead(path.join(dirPath, files[0]!)));
      if (probed.cwd) {
        out.push({ cwd: path.resolve(probed.cwd), agent: 'claude-code', sessionCount: files.length });
      }
    }
  }

  // Codex — sessions scattered by date; tally by probed cwd
  const cxRoot = path.join(os.homedir(), '.codex', 'sessions');
  if (isDir(cxRoot)) {
    const counts = new Map<string, number>();
    for (const fp of walkJsonl(cxRoot, 4)) {
      const probed = probeCodex(readHead(fp));
      if (probed.cwd) {
        const c = path.resolve(probed.cwd);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    for (const [cwd, sessionCount] of counts) out.push({ cwd, agent: 'codex', sessionCount });
  }

  // Cowork — anchor on the metadata's userSelectedFolders
  const cwRoot = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'local-agent-mode-sessions',
  );
  if (isDir(cwRoot)) {
    const counts = new Map<string, number>();
    for (const metaPath of walkCoworkMetas(cwRoot, 4)) {
      let m: any;
      try {
        m = JSON.parse(readFileSync(metaPath, 'utf8'));
      } catch {
        continue;
      }
      const folders: string[] = Array.isArray(m.userSelectedFolders)
        ? m.userSelectedFolders.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      if (folders[0]) {
        const c = path.resolve(folders[0]);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    for (const [cwd, sessionCount] of counts) out.push({ cwd, agent: 'cowork', sessionCount });
  }

  return out;
}

/**
 * A stable identity for the git repository containing `cwd`, shared across all
 * of the repo's worktrees: the directory that holds the common `.git`. Null
 * when `cwd` isn't in a git repo.
 *
 * Use this — not `gitRootOf` — to group sessions into projects. `gitRootOf`
 * returns each worktree's own top level, which would split one project into
 * one entry per worktree.
 */
export function gitRepoKeyOf(cwd: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const common = out.trim();
    if (!common) return null;
    const dir = path.resolve(common);
    // the common dir is "<repo>/.git"; the repo is its parent.
    return path.basename(dir) === '.git' ? path.dirname(dir) : dir;
  } catch {
    return null;
  }
}

/**
 * Discover every coding-agent session on disk in one pass — Claude Code, Codex,
 * and Cowork — with no project scoping. The journal groups these by repository
 * itself (see journal-fs). Deduped per (agent, id); newest first.
 *
 * Sessions whose cwd can't be determined are skipped — they can't be placed.
 */
export function discoverAllSessions(): SessionRef[] {
  const out: SessionRef[] = [];
  const seen = new Set<string>();
  const add = (ref: SessionRef): void => {
    const key = `${ref.agent}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  // ── Claude Code ──────────────────────────────────────────
  const ccRoot = path.join(os.homedir(), '.claude', 'projects');
  if (isDir(ccRoot)) {
    let dirNames: string[] = [];
    try {
      dirNames = readdirSync(ccRoot).filter((d) => isDir(path.join(ccRoot, d)));
    } catch {
      /* ignore */
    }
    for (const d of dirNames) {
      const dirPath = path.join(ccRoot, d);
      let files: string[] = [];
      try {
        files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const fp = path.join(dirPath, f);
        let st;
        try {
          st = statSync(fp);
        } catch {
          continue;
        }
        const probed = probeClaude(readHead(fp));
        if (!probed.cwd) continue;
        const fallbackId = f.replace(/\.jsonl$/, '');
        const sidecarDir = path.join(dirPath, fallbackId);
        add({
          id: probed.id ?? fallbackId,
          agent: 'claude-code',
          path: fp,
          cwd: path.resolve(probed.cwd),
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          meta: probed.meta,
          sidecarFiles: isDir(sidecarDir) ? walkSidecar(sidecarDir) : [],
        });
      }
    }
  }

  // ── Codex ────────────────────────────────────────────────
  const cxRoot = path.join(os.homedir(), '.codex', 'sessions');
  if (isDir(cxRoot)) {
    for (const fp of walkJsonl(cxRoot, 4)) {
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      const probed = probeCodex(readHead(fp));
      if (!probed.id || !probed.cwd) continue;
      add({
        id: probed.id,
        agent: 'codex',
        path: fp,
        cwd: path.resolve(probed.cwd),
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        meta: probed.meta,
        sidecarFiles: [],
      });
    }
  }

  // ── Claude Cowork ────────────────────────────────────────
  const cwRoot = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'local-agent-mode-sessions',
  );
  if (isDir(cwRoot)) {
    for (const metaPath of walkCoworkMetas(cwRoot, 4)) {
      let m: any;
      try {
        m = JSON.parse(readFileSync(metaPath, 'utf8'));
      } catch {
        continue;
      }
      const folders: string[] = Array.isArray(m.userSelectedFolders)
        ? m.userSelectedFolders.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      if (!folders[0]) continue;
      const auditPath = path.join(metaPath.replace(/\.json$/, ''), 'audit.jsonl');
      let st;
      try {
        st = statSync(auditPath);
      } catch {
        continue;
      }
      const id =
        typeof m.sessionId === 'string' && m.sessionId
          ? m.sessionId
          : path.basename(metaPath, '.json');
      const meta: Record<string, string> = {};
      setMeta(meta, 'model', m.model);
      setMeta(meta, 'title', m.title);
      if (typeof m.createdAt === 'number') {
        setMeta(meta, 'startedAt', new Date(m.createdAt).toISOString());
      }
      add({
        id,
        agent: 'cowork',
        path: auditPath,
        cwd: path.resolve(folders[0]),
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        meta,
        sidecarFiles: [],
      });
    }
  }

  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
