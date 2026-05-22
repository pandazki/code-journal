/**
 * Auto-scan — sweep every agent's sessions and propose Projects, grouped by git
 * repo root. The user deselects unwanted ones and can merge adjacent rows into
 * a single multi-folder Project. Used both standalone (Board) and as the
 * wizard's first step.
 */
import { type ScannedCwd, gitRootOf, scanSessionCwds } from '@code-journal/core';
import { Box, Text } from 'ink';
import { basename, sep } from 'node:path';
import React, { useState } from 'react';

import { HintBar, ScreenFrame } from '../components/ScreenFrame';
import { Spinner } from '../components/Spinner';
import { computeWindow, moveIndex } from '../components/windowing';
import type { Project } from '../config/config';
import { useAsync } from '../hooks/useAsync';
import { useConfig } from '../hooks/useConfig';
import { useScreenInput } from '../hooks/useScreenInput';
import { useTerminalSize } from '../hooks/useTerminalSize';
import { theme } from '../theme';

interface Proposal {
  /** stable identity across merges */
  key: string;
  id: string;
  name: string;
  /** one or more cwds — more than one after a merge */
  roots: string[];
  sessionCount: number;
  agents: string[];
  covered: boolean;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Group scanned cwds by git repo root (worktrees + subdirs collapse). */
function buildProposals(scanned: ScannedCwd[], existing: Project[]): Proposal[] {
  const knownRoots: string[] = [];
  const rootFor = (cwd: string): string => {
    for (const r of knownRoots) if (cwd === r || cwd.startsWith(r + sep)) return r;
    const gr = gitRootOf(cwd) ?? cwd;
    if (!knownRoots.includes(gr)) knownRoots.push(gr);
    return gr;
  };
  const groups = new Map<string, { count: number; agents: Set<string> }>();
  for (const sc of scanned) {
    const root = rootFor(sc.cwd);
    let g = groups.get(root);
    if (!g) {
      g = { count: 0, agents: new Set() };
      groups.set(root, g);
    }
    g.count += sc.sessionCount;
    g.agents.add(sc.agent);
  }

  const existingCwds = new Set(existing.flatMap((p) => p.cwds));
  const usedIds = new Set(existing.map((p) => p.id));
  const out: Proposal[] = [];
  for (const [root, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
    const base = slug(basename(root)) || 'project';
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    out.push({
      key: root,
      id,
      name: basename(root) || root,
      roots: [root],
      sessionCount: g.count,
      agents: [...g.agents],
      covered: existingCwds.has(root),
    });
  }
  return out;
}

export function ScanModal({
  onDone,
  onCancel,
  wizardLabel,
}: {
  /** called after the chosen projects have been written to config */
  onDone: () => void;
  onCancel: () => void;
  wizardLabel?: string;
}): React.ReactElement {
  const { config, setConfig } = useConfig();
  const { rows } = useTerminalSize();
  const scan = useAsync<Proposal[]>(
    () => Promise.resolve().then(() => buildProposals(scanSessionCwds(), config.projects)),
    [],
  );

  const [edited, setEdited] = useState<{ proposals: Proposal[]; picked: Set<string> } | null>(null);
  const [sel, setSel] = useState(0);

  if (scan.status === 'ok' && edited === null) {
    const ps = scan.data ?? [];
    setEdited({ proposals: ps, picked: new Set(ps.filter((p) => !p.covered).map((p) => p.key)) });
  }

  const proposals = edited?.proposals ?? [];
  const picked = edited?.picked ?? new Set<string>();
  const height = Math.max(4, rows - 12);

  const mergeUp = (): void => {
    if (!edited || sel <= 0) return;
    const ps = [...edited.proposals];
    const a = ps[sel - 1]!;
    const b = ps[sel]!;
    if (a.covered || b.covered) return; // don't fold an already-imported project
    const merged: Proposal = {
      ...a,
      roots: [...a.roots, ...b.roots],
      sessionCount: a.sessionCount + b.sessionCount,
      agents: [...new Set([...a.agents, ...b.agents])],
    };
    ps.splice(sel - 1, 2, merged);
    const nextPicked = new Set(edited.picked);
    const wasPicked = nextPicked.has(a.key) || nextPicked.has(b.key);
    nextPicked.delete(b.key);
    if (wasPicked) nextPicked.add(a.key);
    setEdited({ proposals: ps, picked: nextPicked });
    setSel(sel - 1);
  };

  const apply = (): void => {
    const additions: Project[] = proposals
      .filter((p) => picked.has(p.key))
      .map((p) => ({ id: p.id, name: p.name, cwds: p.roots }));
    if (additions.length > 0) {
      setConfig({ ...config, projects: [...config.projects, ...additions] });
    }
    onDone();
  };

  useScreenInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (scan.status !== 'ok' || proposals.length === 0) return;
    if (key.upArrow || input === 'k') setSel((s) => moveIndex(s, -1, proposals.length));
    else if (key.downArrow || input === 'j') setSel((s) => moveIndex(s, 1, proposals.length));
    else if (input === 'm') mergeUp();
    else if (input === ' ') {
      const p = proposals[sel];
      if (!p || p.covered || !edited) return;
      const next = new Set(edited.picked);
      if (next.has(p.key)) next.delete(p.key);
      else next.add(p.key);
      setEdited({ proposals: edited.proposals, picked: next });
    } else if (key.return) apply();
  });

  const win = computeWindow(proposals, sel, height);
  const countLabel = `${proposals.length} repos · ${picked.size} selected`;

  return (
    <ScreenFrame
      title="Auto-scan projects"
      subtitle={wizardLabel ? `${wizardLabel} · ${countLabel}` : countLabel}
      footer={
        <HintBar
          hints={[
            ['↑↓', 'move'],
            ['space', 'include'],
            ['m', 'merge into prev'],
            ['enter', 'add selected'],
            ['esc', wizardLabel ? 'quit' : 'cancel'],
          ]}
        />
      }
    >
      <Box flexDirection="column">
        {scan.status === 'loading' ? (
          <Spinner label="scanning all agents' sessions — probing cwds + git roots…" />
        ) : scan.status === 'error' ? (
          <Text color={theme.err}>{`✗ ${scan.error}`}</Text>
        ) : proposals.length === 0 ? (
          <Text color={theme.dim}>No coding-agent sessions found anywhere.</Text>
        ) : (
          <Box flexDirection="column">
            {win.hiddenAbove > 0 ? <Text color={theme.dim}>{`  ↑ ${win.hiddenAbove}`}</Text> : null}
            {win.items.map((p, i) => {
              const idx = win.start + i;
              const active = idx === sel;
              const checked = picked.has(p.key);
              const box = p.covered ? '·' : checked ? '✓' : ' ';
              const dirs = p.roots.length > 1 ? ` +${p.roots.length - 1} dir` : '';
              return (
                <Box key={p.key}>
                  <Text color={active ? theme.brand : undefined}>{active ? '❯ ' : '  '}</Text>
                  <Text color={p.covered ? theme.dim : checked ? theme.ok : theme.dim}>{`[${box}] `}</Text>
                  <Text color={p.covered ? theme.dim : active ? theme.text : undefined}>
                    {(p.name + dirs).padEnd(26)}
                  </Text>
                  <Text color={theme.dim}>
                    {`${String(p.sessionCount).padStart(4)} sessions  ${p.agents.join('/')}`}
                    {p.covered ? '  (already a project)' : ''}
                  </Text>
                </Box>
              );
            })}
            {win.hiddenBelow > 0 ? <Text color={theme.dim}>{`  ↓ ${win.hiddenBelow}`}</Text> : null}
            {proposals[sel] ? (
              <Box marginTop={1} flexDirection="column">
                {proposals[sel]!.roots.map((r) => (
                  <Text key={r} color={theme.dim}>{`  ${r}`}</Text>
                ))}
              </Box>
            ) : null}
          </Box>
        )}
      </Box>
    </ScreenFrame>
  );
}
