/** Two-pane transcript viewer — entry list on the left, structured detail on the right. */
import {
  badgeLabel,
  categorize,
  entryDetail,
  parseTranscript,
  previewLine,
  readSessionFile,
} from '@code-journal/core';
import { Box, Text } from 'ink';
import React, { useMemo, useState } from 'react';

import { HintBar, ScreenFrame } from '../components/ScreenFrame';
import { SelectList } from '../components/SelectList';
import { Spinner } from '../components/Spinner';
import { computeWindow, moveIndex } from '../components/windowing';
import type { Config, Credentials } from '../config/config';
import { useAsync } from '../hooks/useAsync';
import { useConfig } from '../hooks/useConfig';
import { useScreenInput } from '../hooks/useScreenInput';
import { useTerminalSize } from '../hooks/useTerminalSize';
import { type SessionLocator, type TranscriptRoute, useNav } from '../navigation';
import { makeS3Client } from '../s3/client';
import { getRemoteMeta, getRemoteSidecar, getRemoteTranscript, listRemoteSidecar } from '../s3/storage';
import { agentColor, categoryColor, theme } from '../theme';
import { clipLine } from '../text';
import { type DisplayLine, detailToLines } from './detailLines';
import { clip, shortId } from '../format';

interface Loaded {
  text: string;
  agent: string;
  /** sidecar-relative subagent transcript paths, e.g. "subagents/agent-a1.jsonl" */
  subagents: string[];
}

function isSubagentTranscript(rel: string): boolean {
  return rel.startsWith('subagents/') && rel.endsWith('.jsonl');
}

function requireS3(config: Config, credentials: Credentials | null): { s3: NonNullable<Config['s3']>; client: ReturnType<typeof makeS3Client> } {
  if (!config.s3 || !credentials) {
    throw new Error('S3 not configured — set it from Home (press s)');
  }
  return { s3: config.s3, client: makeS3Client(config.s3, credentials) };
}

async function loadTranscript(
  route: TranscriptRoute,
  config: Config,
  credentials: Credentials | null,
): Promise<Loaded> {
  if (route.kind === 'transcript') {
    const loc = route.locator;
    if (loc.kind === 'local') {
      return {
        text: readSessionFile(loc.ref.path),
        agent: loc.ref.agent,
        subagents: loc.ref.sidecarFiles.map((f) => f.relPath).filter(isSubagentTranscript).sort(),
      };
    }
    const { s3, client } = requireS3(config, credentials);
    const [text, meta, sidecar] = await Promise.all([
      getRemoteTranscript(client, s3, loc.projectId, loc.sessionId),
      getRemoteMeta(client, s3, loc.projectId, loc.sessionId),
      listRemoteSidecar(client, s3, loc.projectId, loc.sessionId),
    ]);
    return {
      text,
      agent: typeof meta?.agent === 'string' ? meta.agent : 'claude-code',
      subagents: sidecar.filter(isSubagentTranscript).sort(),
    };
  }
  // subagent route — load one sidecar transcript
  const parent = route.parent;
  if (parent.kind === 'local') {
    const file = parent.ref.sidecarFiles.find((f) => f.relPath === route.relPath);
    if (!file) throw new Error(`sidecar file not found: ${route.relPath}`);
    return { text: readSessionFile(file.absPath), agent: 'claude-code', subagents: [] };
  }
  const { s3, client } = requireS3(config, credentials);
  const text = await getRemoteSidecar(client, s3, parent.projectId, parent.sessionId, route.relPath);
  return { text, agent: 'claude-code', subagents: [] };
}

function locatorTitle(route: TranscriptRoute): string {
  if (route.kind === 'subagent') return route.title;
  return route.locator.kind === 'local' ? route.locator.ref.id : route.locator.sessionId;
}

export function TranscriptScreen({ route }: { route: TranscriptRoute }): React.ReactElement {
  const nav = useNav();
  const { config, credentials } = useConfig();
  const { rows: termRows, columns: termCols } = useTerminalSize();

  const depKey =
    route.kind === 'subagent'
      ? `sub:${describe(route.parent)}:${route.relPath}`
      : `txn:${describe(route.locator)}`;
  const loaded = useAsync<Loaded>(() => loadTranscript(route, config, credentials), [depKey]);

  const [sel, setSel] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [rawMode, setRawMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSel, setPickerSel] = useState(0);

  const entries = useMemo(
    () => (loaded.data ? parseTranscript(loaded.data.text) : []),
    [loaded.data],
  );
  const agent = loaded.data?.agent ?? 'unknown';
  const rowMeta = useMemo(
    () =>
      entries.map(({ lineNo, entry }) => ({
        lineNo,
        badge: badgeLabel(entry, agent),
        category: categorize(entry, agent),
        preview: previewLine(entry, agent),
      })),
    [entries, agent],
  );

  const leftW = Math.min(46, Math.max(24, Math.floor(termCols * 0.42)));
  const rightW = Math.max(20, termCols - leftW - 6);
  const bodyHeight = Math.max(4, termRows - 10);

  const selIdx = Math.min(sel, Math.max(0, entries.length - 1));
  const selectedEntry = entries[selIdx]?.entry;

  const detailLines = useMemo<DisplayLine[]>(() => {
    if (!selectedEntry) return [];
    if (rawMode) {
      const raw =
        selectedEntry._unparsed !== undefined
          ? String(selectedEntry._unparsed)
          : JSON.stringify(selectedEntry, null, 2);
      return raw.split('\n').map((l): DisplayLine => ({ text: clipLine(l, rightW), dim: true }));
    }
    return detailToLines(entryDetail(selectedEntry, agent, entries[selIdx]?.lineNo ?? 0), rightW);
  }, [selectedEntry, agent, rawMode, rightW, selIdx, entries]);

  const subagents = loaded.data?.subagents ?? [];

  useScreenInput((input, key) => {
    if (pickerOpen) {
      if (key.escape) setPickerOpen(false);
      else if (key.upArrow || input === 'k') setPickerSel((s) => moveIndex(s, -1, subagents.length));
      else if (key.downArrow || input === 'j') setPickerSel((s) => moveIndex(s, 1, subagents.length));
      else if (key.return && subagents.length > 0) {
        const rel = subagents[pickerSel]!;
        setPickerOpen(false);
        const parent: SessionLocator =
          route.kind === 'transcript' ? route.locator : route.parent;
        nav.openTranscript({
          kind: 'subagent',
          projectId: route.projectId,
          parent,
          relPath: rel,
          title: rel.replace(/^subagents\//, '').replace(/\.jsonl$/, ''),
        });
      }
      return;
    }
    if (key.escape) {
      nav.back();
      return;
    }
    if (key.upArrow || input === 'k') {
      setSel(moveIndex(selIdx, -1, entries.length));
      setDetailScroll(0);
    } else if (key.downArrow || input === 'j') {
      setSel(moveIndex(selIdx, 1, entries.length));
      setDetailScroll(0);
    } else if (input === 'g') {
      setSel(0);
      setDetailScroll(0);
    } else if (input === 'G') {
      setSel(Math.max(0, entries.length - 1));
      setDetailScroll(0);
    } else if (key.pageDown || input === ']') {
      setDetailScroll((s) => Math.min(Math.max(0, detailLines.length - bodyHeight), s + bodyHeight - 1));
    } else if (key.pageUp || input === '[') {
      setDetailScroll((s) => Math.max(0, s - (bodyHeight - 1)));
    } else if (input === 'r') {
      setRawMode((m) => !m);
      setDetailScroll(0);
    } else if (input === 's' && subagents.length > 0) {
      setPickerSel(0);
      setPickerOpen(true);
    }
  });

  // ── loading / error ───────────────────────────────────────
  if (loaded.status === 'loading') {
    return (
      <ScreenFrame title="Transcript" footer={<HintBar hints={[['esc', 'back']]} />}>
        <Spinner label="loading transcript…" />
      </ScreenFrame>
    );
  }
  if (loaded.status === 'error') {
    return (
      <ScreenFrame title="Transcript" footer={<HintBar hints={[['esc', 'back']]} />}>
        <Text color={theme.err}>{`✗ ${loaded.error}`}</Text>
      </ScreenFrame>
    );
  }

  // ── subagent picker overlay ───────────────────────────────
  if (pickerOpen) {
    return (
      <ScreenFrame
        title="Subagent transcripts"
        subtitle={`${subagents.length} found`}
        footer={<HintBar hints={[['↑↓', 'move'], ['enter', 'open'], ['esc', 'cancel']]} />}
      >
        <SelectList
          items={subagents.map((rel) => ({ label: rel.replace(/^subagents\//, '') }))}
          selectedIndex={pickerSel}
          height={bodyHeight}
        />
      </ScreenFrame>
    );
  }

  // ── two-pane viewer ───────────────────────────────────────
  const listWin = computeWindow(rowMeta, selIdx, bodyHeight);
  const detailWin = detailLines.slice(detailScroll, detailScroll + bodyHeight);
  const lnWidth = String(entries[entries.length - 1]?.lineNo ?? 0).length;

  return (
    <ScreenFrame
      title={route.kind === 'subagent' ? 'Subagent' : 'Transcript'}
      subtitle={clip(locatorTitle(route), 40)}
      footer={
        <HintBar
          hints={[
            ['↑↓', 'entry'],
            ['[ ]', 'scroll detail'],
            ['r', rawMode ? 'structured' : 'raw'],
            ...(subagents.length > 0 ? ([['s', `subagents (${subagents.length})`]] as Array<[string, string]>) : []),
            ['esc', 'back'],
          ]}
        />
      }
    >
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color={agentColor(agent)}>{agent}</Text>
          <Text color={theme.dim}>{`   ${entries.length} entries`}</Text>
          {rawMode ? <Text color={theme.accent}>{'   [raw]'}</Text> : null}
        </Box>

        {entries.length === 0 ? (
          <Text color={theme.dim}>This transcript has no parseable lines.</Text>
        ) : (
          <Box>
            {/* left — entry list */}
            <Box flexDirection="column" width={leftW} marginRight={2}>
              {listWin.hiddenAbove > 0 ? (
                <Text color={theme.dim}>{`  ↑ ${listWin.hiddenAbove}`}</Text>
              ) : (
                <Text> </Text>
              )}
              {listWin.items.map((m, i) => {
                const idx = listWin.start + i;
                const selected = idx === selIdx;
                return (
                  <Box key={m.lineNo}>
                    <Text color={selected ? theme.brand : undefined}>{selected ? '❯' : ' '}</Text>
                    <Text color={theme.dim}>{String(m.lineNo).padStart(lnWidth)} </Text>
                    <Text color={categoryColor[m.category]}>{clip(m.badge, 12).padEnd(12)}</Text>
                    <Text color={selected ? theme.text : theme.dim}>
                      {' ' + clip(m.preview, Math.max(4, leftW - lnWidth - 16))}
                    </Text>
                  </Box>
                );
              })}
              {listWin.hiddenBelow > 0 ? (
                <Text color={theme.dim}>{`  ↓ ${listWin.hiddenBelow}`}</Text>
              ) : null}
            </Box>

            {/* right — detail */}
            <Box flexDirection="column" width={rightW}>
              {detailWin.length === 0 ? (
                <Text color={theme.dim}>(no detail)</Text>
              ) : (
                detailWin.map((l, i) => (
                  <Text key={detailScroll + i} color={l.color} dimColor={l.dim} bold={l.bold}>
                    {l.text.length > 0 ? l.text : ' '}
                  </Text>
                ))
              )}
              {detailLines.length > bodyHeight ? (
                <Text color={theme.dim}>
                  {`  — ${detailScroll + 1}–${Math.min(detailLines.length, detailScroll + bodyHeight)} / ${detailLines.length} —`}
                </Text>
              ) : null}
            </Box>
          </Box>
        )}
      </Box>
    </ScreenFrame>
  );
}

function describe(loc: SessionLocator): string {
  return loc.kind === 'local' ? `local:${loc.ref.path}` : `remote:${loc.projectId}/${loc.sessionId}`;
}
