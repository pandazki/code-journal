/**
 * The Board — the whole TUI. A persistent multi-panel view: a Projects panel,
 * a Sessions master-detail panel, an activity-log strip, and a stats header.
 * Secondary functions (S3, cron, auto-scan, project edit, log) open as modals;
 * reading a transcript is the only full drill-in.
 */
import { type SessionRef, discoverSessionsForProject } from '@code-journal/core';
import { Box, Text, useApp } from 'ink';
import { spawn } from 'node:child_process';
import React, { useMemo, useState } from 'react';

import { Spinner } from '../components/Spinner';
import { computeWindow, moveIndex } from '../components/windowing';
import { configPath } from '../config/paths';
import { type UploadManifest, type UploadStatusKind, loadManifest, recordUpload, uploadStatus } from '../config/uploads';
import { cronStatus } from '../cron';
import { useAsync } from '../hooks/useAsync';
import { useConfig } from '../hooks/useConfig';
import { useScreenInput } from '../hooks/useScreenInput';
import { useTerminalSize } from '../hooks/useTerminalSize';
import { log, readLogTail } from '../log';
import { CronModal } from '../modals/CronModal';
import { HelpModal } from '../modals/HelpModal';
import { LogModal } from '../modals/LogModal';
import { ScanModal } from '../modals/ScanModal';
import { useNav } from '../navigation';
import { makeS3Client } from '../s3/client';
import { type RemoteSession, listRemoteSessions, uploadSession } from '../s3/storage';
import { runSync } from '../sync';
import { agentColor, theme } from '../theme';
import { clip, fmtAge, fmtBytes, fmtRelTime, shortId } from '../format';
import { ProjectEditScreen } from './ProjectEditScreen';
import { S3ConfigScreen } from './S3ConfigScreen';

const AGENT_TAG: Record<string, string> = { 'claude-code': 'CC', codex: 'CDX', cowork: 'CW' };
const LOG_LINES = 3;

type ModalKind = 's3' | 'cron' | 'scan' | 'log' | 'help' | { project: string | null };
type Busy = { title: string; detail: string; done: number; total: number } | null;

function statusIcon(s: UploadStatusKind): { icon: string; color: string } {
  if (s === 'new') return { icon: '·', color: theme.dim };
  if (s === 'changed') return { icon: '⟳', color: theme.warn };
  return { icon: '✓', color: theme.ok };
}

function openConfigExternally(): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [configPath()], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* ignore — best effort */
  }
}

export function Board(): React.ReactElement {
  const { exit } = useApp();
  const { config, credentials } = useConfig();
  const nav = useNav();
  const { rows, columns } = useTerminalSize();

  const projects = config.projects;
  const [projIdx, setProjIdx] = useState(0);
  const [focus, setFocus] = useState<'projects' | 'sessions'>('projects');
  const [view, setView] = useState<'local' | 'remote'>('local');
  const [sessIdx, setSessIdx] = useState(0);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [nonce, setNonce] = useState(0);
  const [manifest, setManifest] = useState<UploadManifest>(() => loadManifest());
  const [cron, setCron] = useState(() => cronStatus());
  const [logTail, setLogTail] = useState<string[]>(() => readLogTail(LOG_LINES));

  const projIdxC = Math.min(projIdx, Math.max(0, projects.length - 1));
  const project = projects[projIdxC] ?? null;

  const local = useAsync<SessionRef[]>(
    () => Promise.resolve().then(() => (project ? discoverSessionsForProject(project.cwds) : [])),
    [project?.id, nonce],
  );
  const remote = useAsync<RemoteSession[]>(() => {
    if (!project) return Promise.resolve([]);
    if (!config.s3 || !credentials) return Promise.reject(new Error('S3 not configured — press s'));
    return listRemoteSessions(makeS3Client(config.s3, credentials), config.s3, project.id);
  }, [project?.id, nonce]);

  const localList = local.data ?? [];
  const remoteList = remote.data ?? [];
  const sessCount = view === 'local' ? localList.length : remoteList.length;
  const sessIdxC = Math.min(sessIdx, Math.max(0, sessCount - 1));

  // ── layout sizing ─────────────────────────────────────────
  // Rows are fixed-width by construction so nothing wraps (a wrap would break
  // the fixed-height panels). The detail column simply takes what's left.
  const listH = Math.max(4, rows - 13);
  const projW = 22;
  const sessListW = 32;
  const detailW = Math.max(16, columns - projW - sessListW - 12);

  const closeModal = (): void => {
    setModal(null);
    setCron(cronStatus());
    setManifest(loadManifest());
    setLogTail(readLogTail(LOG_LINES));
    setNonce((n) => n + 1);
  };

  // ── actions ───────────────────────────────────────────────
  const uploadOne = async (ref: SessionRef): Promise<void> => {
    if (!project || !config.s3 || !credentials) return;
    const s3 = config.s3;
    setBusy({ title: `Uploading ${shortId(ref.id)}`, detail: 'starting…', done: 0, total: 0 });
    try {
      const client = makeS3Client(s3, credentials);
      const outcome = await uploadSession(client, s3, project, ref, (p) =>
        setBusy({ title: `Uploading ${shortId(ref.id)}`, detail: p.label, done: p.done, total: p.total }),
      );
      setManifest(
        recordUpload(loadManifest(), {
          projectId: project.id,
          sessionId: ref.id,
          agent: ref.agent,
          uploadedAt: new Date().toISOString(),
          fileCount: outcome.fileCount,
          sizeBytes: outcome.sizeBytes,
          transcriptMtimeMs: Math.round(ref.mtimeMs),
          transcriptSizeBytes: ref.sizeBytes,
        }),
      );
      log('info', 'tui', `uploaded ${project.id}/${ref.id} (${outcome.fileCount} files)`);
    } catch (e: unknown) {
      log('error', 'tui', `upload failed ${ref.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(null);
    setLogTail(readLogTail(LOG_LINES));
    setNonce((n) => n + 1);
  };

  const syncProject = async (): Promise<void> => {
    if (!project) return;
    setBusy({ title: `Sync · ${project.name}`, detail: 'discovering…', done: 0, total: 0 });
    try {
      await runSync({
        projectId: project.id,
        onEvent: (e) => {
          if (e.phase === 'upload') {
            setBusy({
              title: `Sync · ${project.name}`,
              detail: `${e.session ? shortId(e.session) : ''} ${e.fileProgress?.label ?? ''}`.trim(),
              done: e.index ?? 0,
              total: e.total ?? 0,
            });
          }
        },
      });
    } catch (e: unknown) {
      log('error', 'tui', `sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(null);
    setManifest(loadManifest());
    setLogTail(readLogTail(LOG_LINES));
    setNonce((n) => n + 1);
  };

  // ── input ─────────────────────────────────────────────────
  useScreenInput((input, key) => {
    if (key.escape) {
      return;
    }
    if (input === 'q') {
      exit();
      return;
    }
    if (input === '?') {
      setModal('help');
      return;
    }
    if (input === 's') {
      setModal('s3');
      return;
    }
    if (input === 'c') {
      setModal('cron');
      return;
    }
    if (input === 'a') {
      setModal('scan');
      return;
    }
    if (input === 'l') {
      setModal('log');
      return;
    }
    if (input === 'n') {
      setModal({ project: null });
      return;
    }
    if (input === 'o') {
      openConfigExternally();
      return;
    }
    if (input === 'R') {
      setNonce((n) => n + 1);
      return;
    }
    if (key.tab) {
      setFocus((f) => (f === 'projects' ? 'sessions' : 'projects'));
      return;
    }
    if (input === 'r') {
      setView((v) => (v === 'local' ? 'remote' : 'local'));
      setSessIdx(0);
      return;
    }
    if (input === 'e' && project) {
      setModal({ project: project.id });
      return;
    }
    if (input === 'S' && project) {
      void syncProject();
      return;
    }

    if (focus === 'projects') {
      if (key.upArrow || input === 'k') setProjIdx(moveIndex(projIdxC, -1, projects.length));
      else if (key.downArrow || input === 'j') setProjIdx(moveIndex(projIdxC, 1, projects.length));
      else if (key.return && projects.length > 0) {
        setFocus('sessions');
        setSessIdx(0);
      }
      return;
    }
    // focus === 'sessions'
    if (key.upArrow || input === 'k') setSessIdx(moveIndex(sessIdxC, -1, sessCount));
    else if (key.downArrow || input === 'j') setSessIdx(moveIndex(sessIdxC, 1, sessCount));
    else if (input === 'u' && view === 'local' && localList[sessIdxC]) {
      void uploadOne(localList[sessIdxC]!);
    } else if (key.return && sessCount > 0 && project) {
      if (view === 'local') {
        nav.openTranscript({
          kind: 'transcript',
          projectId: project.id,
          locator: { kind: 'local', ref: localList[sessIdxC]! },
        });
      } else {
        const r = remoteList[sessIdxC]!;
        nav.openTranscript({
          kind: 'transcript',
          projectId: project.id,
          locator: { kind: 'remote', projectId: project.id, sessionId: r.sessionId, sizeBytes: r.sizeBytes },
        });
      }
    }
  }, modal === null && busy === null);

  // ── modal / busy overlays ─────────────────────────────────
  if (busy) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color={theme.brand}>
          {busy.title}
        </Text>
        <Box marginTop={1}>
          <Spinner label={busy.detail || 'working…'} />
        </Box>
        {busy.total > 0 ? (
          <Text color={theme.dim}>{`  ${busy.done}/${busy.total}`}</Text>
        ) : null}
      </Box>
    );
  }
  if (modal === 's3') return <S3ConfigScreen onSaved={closeModal} onCancel={closeModal} />;
  if (modal === 'cron') return <CronModal onClose={closeModal} />;
  if (modal === 'scan') return <ScanModal onDone={closeModal} onCancel={closeModal} />;
  if (modal === 'log') return <LogModal onClose={closeModal} />;
  if (modal === 'help') return <HelpModal onClose={closeModal} />;
  if (modal && typeof modal === 'object') {
    return <ProjectEditScreen projectId={modal.project} onClose={closeModal} />;
  }

  // ── board ─────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        config={config}
        cronLabel={cron.installed ? (cron.expr ?? 'on') : null}
        projectCount={projects.length}
      />

      <Box marginTop={1}>
        <ProjectsPanel
          projects={projects.map((p) => ({ name: p.name, cwds: p.cwds.length }))}
          selected={projIdxC}
          focused={focus === 'projects'}
          height={listH}
          width={projW}
        />
        <Box marginLeft={1} flexGrow={1}>
          <SessionsPanel
            project={project}
            view={view}
            focused={focus === 'sessions'}
            height={listH}
            listWidth={sessListW}
            detailWidth={detailW}
            local={{ status: local.status, error: local.error, list: localList }}
            remote={{ status: remote.status, error: remote.error, list: remoteList }}
            selected={sessIdxC}
            manifest={manifest}
          />
        </Box>
      </Box>

      <LogStrip lines={logTail} width={columns} />

      <Box>
        <Text color={theme.dim}>
          <Text color={theme.accent}>tab</Text> panel{'  '}
          <Text color={theme.accent}>↑↓</Text> move{'  '}
          <Text color={theme.accent}>enter</Text> open{'  '}
          <Text color={theme.accent}>r</Text> local/remote{'  '}
          <Text color={theme.accent}>u</Text> upload{'  '}
          <Text color={theme.accent}>S</Text> sync{'  '}
          <Text color={theme.accent}>a</Text> scan{'  '}
          <Text color={theme.accent}>n/e</Text> project{'  '}
          <Text color={theme.accent}>s</Text> S3{'  '}
          <Text color={theme.accent}>c</Text> cron{'  '}
          <Text color={theme.accent}>l</Text> log{'  '}
          <Text color={theme.accent}>o</Text> config{'  '}
          <Text color={theme.accent}>?</Text> help{'  '}
          <Text color={theme.accent}>q</Text> quit
        </Text>
      </Box>
    </Box>
  );
}

// ── header ───────────────────────────────────────────────────
function Header({
  config,
  cronLabel,
  projectCount,
}: {
  config: ReturnType<typeof useConfig>['config'];
  cronLabel: string | null;
  projectCount: number;
}): React.ReactElement {
  return (
    <Box>
      <Text backgroundColor={theme.brand} color="black" bold>
        {' cj '}
      </Text>
      <Text bold>{' code-journal'}</Text>
      <Box flexGrow={1} justifyContent="flex-end">
        <Text>
          <Text color={config.s3 ? theme.ok : theme.dim}>{config.s3 ? '● ' : '○ '}</Text>
          <Text color={theme.dim}>{`S3 ${config.s3 ? config.s3.bucket : 'not set'}`}</Text>
          <Text>{'   '}</Text>
          <Text color={cronLabel ? theme.ok : theme.dim}>{cronLabel ? '● ' : '○ '}</Text>
          <Text color={theme.dim}>{`cron ${cronLabel ?? 'off'}`}</Text>
          <Text color={theme.dim}>{`   ${projectCount} projects`}</Text>
        </Text>
      </Box>
    </Box>
  );
}

// ── projects panel ───────────────────────────────────────────
function ProjectsPanel({
  projects,
  selected,
  focused,
  height,
  width,
}: {
  projects: Array<{ name: string; cwds: number }>;
  selected: number;
  focused: boolean;
  height: number;
  width: number;
}): React.ReactElement {
  const win = computeWindow(projects, selected, height);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? theme.brand : theme.dim}
      width={width}
      paddingX={1}
    >
      <Text bold color={focused ? theme.brand : undefined}>
        PROJECTS
      </Text>
      {projects.length === 0 ? (
        <Text color={theme.dim}>press n / a</Text>
      ) : (
        win.items.map((p, i) => {
          const idx = win.start + i;
          const sel = idx === selected;
          return (
            <Text key={idx} color={sel ? theme.brand : undefined} bold={sel}>
              {sel ? '❯ ' : '  '}
              {clip(p.name, width - 7)}
            </Text>
          );
        })
      )}
      {Array.from({ length: Math.max(0, height - win.items.length - (projects.length === 0 ? 1 : 0)) }).map(
        (_, i) => (
          <Text key={`pad${i}`}> </Text>
        ),
      )}
    </Box>
  );
}

// ── sessions panel (master-detail) ───────────────────────────
interface ListState<T> {
  status: 'loading' | 'ok' | 'error';
  error?: string;
  list: T[];
}

function SessionsPanel({
  project,
  view,
  focused,
  height,
  listWidth,
  detailWidth,
  local,
  remote,
  selected,
  manifest,
}: {
  project: { id: string; name: string } | null;
  view: 'local' | 'remote';
  focused: boolean;
  height: number;
  listWidth: number;
  detailWidth: number;
  local: ListState<SessionRef>;
  remote: ListState<RemoteSession>;
  selected: number;
  manifest: UploadManifest;
}): React.ReactElement {
  const state = view === 'local' ? local : remote;
  const count = view === 'local' ? local.list.length : remote.list.length;

  const body = (): React.ReactElement => {
    if (!project) return <Text color={theme.dim}>no project selected</Text>;
    if (state.status === 'loading') {
      return <Spinner label={view === 'local' ? 'discovering…' : 'listing bucket…'} />;
    }
    if (state.status === 'error') return <Text color={theme.err}>{`✗ ${state.error}`}</Text>;
    if (count === 0) {
      return <Text color={theme.dim}>{view === 'local' ? 'no sessions discovered' : 'nothing uploaded'}</Text>;
    }
    return (
      <Box>
        <Box flexDirection="column" width={listWidth}>
          {view === 'local'
            ? renderLocalRows(local.list, selected, height, project.id, manifest)
            : renderRemoteRows(remote.list, selected, height)}
        </Box>
        <Box marginLeft={1} flexGrow={1} flexDirection="column">
          {view === 'local'
            ? renderDetail(
                localDetail(local.list[selected], project.id, manifest),
                local.list[selected]?.id,
                height,
                detailWidth,
              )
            : renderDetail(
                remoteDetail(remote.list[selected]),
                remote.list[selected]?.sessionId,
                height,
                detailWidth,
              )}
        </Box>
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? theme.brand : theme.dim}
      flexGrow={1}
      paddingX={1}
    >
      <Text bold color={focused ? theme.brand : undefined}>
        {`SESSIONS · ${project ? project.name : '—'} · `}
        <Text color={theme.accent}>{view === 'local' ? 'Local' : 'Remote'}</Text>
        <Text color={theme.dim}>{`  (${count})`}</Text>
      </Text>
      {body()}
    </Box>
  );
}

function renderLocalRows(
  list: SessionRef[],
  selected: number,
  height: number,
  projectId: string,
  manifest: UploadManifest,
): React.ReactElement[] {
  const win = computeWindow(list, selected, height);
  return win.items.map((r, i) => {
    const idx = win.start + i;
    const sel = idx === selected;
    const st = statusIcon(uploadStatus(manifest, projectId, r));
    return (
      <Text key={r.id} color={sel ? theme.brand : undefined}>
        {sel ? '❯' : ' '}
        <Text color={sel ? theme.text : undefined}>{` ${clip(shortId(r.id), 8).padEnd(8)}`}</Text>
        <Text color={agentColor(r.agent)}>{` ${(AGENT_TAG[r.agent] ?? '?').padEnd(3)}`}</Text>
        <Text color={theme.dim}>{` ${fmtBytes(r.sizeBytes).padStart(7)} ${fmtAge(r.mtimeMs).padStart(4)} `}</Text>
        <Text color={st.color}>{st.icon}</Text>
      </Text>
    );
  });
}

function renderRemoteRows(list: RemoteSession[], selected: number, height: number): React.ReactElement[] {
  const win = computeWindow(list, selected, height);
  return win.items.map((r, i) => {
    const idx = win.start + i;
    const sel = idx === selected;
    return (
      <Text key={r.sessionId} color={sel ? theme.brand : undefined}>
        {sel ? '❯' : ' '}
        <Text color={sel ? theme.text : undefined}>{` ${clip(shortId(r.sessionId), 12).padEnd(12)}`}</Text>
        <Text color={theme.dim}>{` ${fmtBytes(r.sizeBytes).padStart(7)} ${fmtAge(r.lastModified).padStart(4)} `}</Text>
        <Text color={r.hasMeta ? theme.ok : theme.warn}>{r.hasMeta ? '✓' : '!'}</Text>
      </Text>
    );
  });
}

function renderDetail(
  rows: Array<[string, string]>,
  title: string | undefined,
  height: number,
  width: number,
): React.ReactElement {
  const shown = rows.slice(0, Math.max(0, height - 2));
  return (
    <>
      <Text bold color={theme.text}>
        {clip(title ?? '—', width)}
      </Text>
      <Text> </Text>
      {shown.map(([k, v], i) => (
        <Text key={`${k}${i}`}>
          <Text color={theme.dim}>{k.padEnd(13)}</Text>
          <Text>{clip(v, Math.max(4, width - 13))}</Text>
        </Text>
      ))}
    </>
  );
}

function localDetail(
  ref: SessionRef | undefined,
  projectId: string,
  manifest: UploadManifest,
): Array<[string, string]> {
  if (!ref) return [];
  const sub = ref.sidecarFiles.filter((f) => f.relPath.startsWith('subagents/')).length;
  const tr = ref.sidecarFiles.filter((f) => f.relPath.startsWith('tool-results/')).length;
  const st = uploadStatus(manifest, projectId, ref);
  const rows: Array<[string, string]> = [
    ['agent', ref.agent],
    ['cwd', ref.cwd],
    ['size', fmtBytes(ref.sizeBytes)],
    ['modified', fmtRelTime(ref.mtimeMs)],
    ['subagents', String(sub)],
    ['tool-results', String(tr)],
    ['status', st === 'new' ? 'not uploaded' : st === 'changed' ? 'changed — re-upload' : 'uploaded'],
  ];
  for (const [k, v] of Object.entries(ref.meta)) rows.push([k, v]);
  return rows;
}

function remoteDetail(r: RemoteSession | undefined): Array<[string, string]> {
  if (!r) return [];
  return [
    ['size', fmtBytes(r.sizeBytes)],
    ['uploaded', fmtRelTime(r.lastModified)],
    ['sidecar', `${r.sidecarCount} files`],
    ['meta', r.hasMeta ? 'present' : 'missing'],
  ];
}

// ── log strip ────────────────────────────────────────────────
function LogStrip({ lines, width }: { lines: string[]; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.dim} paddingX={1} marginTop={1}>
      <Text bold color={theme.dim}>
        LOG
      </Text>
      {lines.length === 0 ? (
        <Text color={theme.dim}>(no activity yet)</Text>
      ) : (
        lines.map((l, i) => (
          <Text key={i} color={theme.dim}>
            {clip(l, Math.max(20, width - 6))}
          </Text>
        ))
      )}
    </Box>
  );
}
