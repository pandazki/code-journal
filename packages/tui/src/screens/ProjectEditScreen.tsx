/** Create or edit a project — id, name, and the list of cwds to discover sessions from. */
import { Box, Text } from 'ink';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { useMemo, useState } from 'react';

import { HintBar, ScreenFrame } from '../components/ScreenFrame';
import { TextInput } from '../components/TextInput';
import { applyTextKey } from '../components/textEditing';
import { PROJECT_ID_RE, type Project } from '../config/config';
import { useConfig } from '../hooks/useConfig';
import { useScreenInput } from '../hooks/useScreenInput';
import { theme } from '../theme';

type Row =
  | { kind: 'id' }
  | { kind: 'name' }
  | { kind: 'cwdInput' }
  | { kind: 'cwd'; index: number }
  | { kind: 'save' }
  | { kind: 'delete' };

export function ProjectEditScreen({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}): React.ReactElement {
  const { config, setConfig } = useConfig();
  const existing = projectId ? config.projects.find((p) => p.id === projectId) ?? null : null;
  const editing = existing !== null;

  const [id, setId] = useState(existing?.id ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [cwdInput, setCwdInput] = useState('');
  const [cwds, setCwds] = useState<string[]>(existing?.cwds ?? []);
  const [focus, setFocus] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [];
    if (!editing) r.push({ kind: 'id' });
    r.push({ kind: 'name' }, { kind: 'cwdInput' });
    cwds.forEach((_, i) => r.push({ kind: 'cwd', index: i }));
    r.push({ kind: 'save' });
    if (editing) r.push({ kind: 'delete' });
    return r;
  }, [editing, cwds]);

  const focusIdx = Math.min(focus, rows.length - 1);
  const current = rows[focusIdx]!;

  const addCwd = (): void => {
    const raw = cwdInput.trim();
    if (!raw) return;
    const abs = resolve(raw);
    try {
      if (!statSync(abs).isDirectory()) {
        setError(`not a directory: ${abs}`);
        return;
      }
    } catch {
      setError(`path does not exist: ${abs}`);
      return;
    }
    if (cwds.includes(abs)) {
      setError('cwd already added');
      return;
    }
    setCwds((c) => [...c, abs]);
    setCwdInput('');
    setError(null);
  };

  const save = (): void => {
    const finalId = editing ? existing!.id : id.trim();
    if (!editing && !PROJECT_ID_RE.test(finalId)) {
      setError('id must start alphanumeric, then [A-Za-z0-9_-]');
      return;
    }
    if (!editing && config.projects.some((p) => p.id === finalId)) {
      setError(`a project with id "${finalId}" already exists`);
      return;
    }
    if (!name.trim()) {
      setError('name is required');
      return;
    }
    if (cwds.length === 0) {
      setError('add at least one cwd');
      return;
    }
    const project: Project = { id: finalId, name: name.trim(), cwds };
    const projects = editing
      ? config.projects.map((p) => (p.id === finalId ? project : p))
      : [...config.projects, project];
    setConfig({ ...config, projects });
    onClose();
  };

  const removeProject = (): void => {
    setConfig({ ...config, projects: config.projects.filter((p) => p.id !== existing!.id) });
    onClose();
  };

  useScreenInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if ((key.tab && key.shift) || key.upArrow) {
      setFocus((f) => (Math.min(f, rows.length - 1) + rows.length - 1) % rows.length);
      setConfirmDelete(false);
      return;
    }
    if (key.tab || key.downArrow) {
      setFocus((f) => (Math.min(f, rows.length - 1) + 1) % rows.length);
      setConfirmDelete(false);
      return;
    }
    if (current.kind === 'cwd') {
      if (input === 'd' || key.delete || key.backspace) {
        setCwds((c) => c.filter((_, i) => i !== current.index));
        setError(null);
      }
      return;
    }
    if (current.kind === 'save') {
      if (key.return) save();
      return;
    }
    if (current.kind === 'delete') {
      if (key.return) {
        if (confirmDelete) removeProject();
        else setConfirmDelete(true);
      }
      return;
    }
    // text rows: id / name / cwdInput
    if (key.return) {
      if (current.kind === 'cwdInput') addCwd();
      else setFocus((f) => (Math.min(f, rows.length - 1) + 1) % rows.length);
      return;
    }
    if (current.kind === 'id') setId((s) => applyTextKey(s, input, key));
    else if (current.kind === 'name') setName((s) => applyTextKey(s, input, key));
    else if (current.kind === 'cwdInput') setCwdInput((s) => applyTextKey(s, input, key));
  });

  const rowMarker = (active: boolean): React.ReactElement => (
    <Text color={active ? theme.brand : theme.dim}>{active ? '❯ ' : '  '}</Text>
  );

  return (
    <ScreenFrame
      title={editing ? `Edit project · ${existing!.id}` : 'New project'}
      footer={
        <HintBar
          hints={[
            ['↑↓/tab', 'move'],
            ['enter', 'activate / add'],
            ['d', 'remove cwd'],
            ['esc', 'back'],
          ]}
        />
      }
    >
      <Box flexDirection="column">
        {!editing ? (
          <Box>
            {rowMarker(current.kind === 'id')}
            <Text color={current.kind === 'id' ? theme.text : theme.dim}>{'id'.padEnd(14)}</Text>
            <TextInput value={id} focused={current.kind === 'id'} placeholder="my-project" />
          </Box>
        ) : (
          <Box>
            <Text>{'  '}</Text>
            <Text color={theme.dim}>{'id'.padEnd(14)}</Text>
            <Text color={theme.dim}>{existing!.id}</Text>
          </Box>
        )}
        <Box>
          {rowMarker(current.kind === 'name')}
          <Text color={current.kind === 'name' ? theme.text : theme.dim}>{'name'.padEnd(14)}</Text>
          <TextInput value={name} focused={current.kind === 'name'} placeholder="Display name" />
        </Box>

        <Box marginTop={1}>
          {rowMarker(current.kind === 'cwdInput')}
          <Text color={current.kind === 'cwdInput' ? theme.text : theme.dim}>{'add cwd'.padEnd(14)}</Text>
          <TextInput
            value={cwdInput}
            focused={current.kind === 'cwdInput'}
            placeholder="/abs/path/to/repo  (enter to add)"
          />
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          {cwds.length === 0 ? (
            <Text color={theme.dim}>  (no cwds yet — discovery needs at least one)</Text>
          ) : (
            cwds.map((c, i) => {
              const active = current.kind === 'cwd' && current.index === i;
              return (
                <Box key={c}>
                  <Text color={active ? theme.brand : theme.dim}>{active ? '❯ ' : '  '}</Text>
                  <Text color={active ? theme.text : undefined}>{c}</Text>
                  {active ? <Text color={theme.dim}>{'   d to remove'}</Text> : null}
                </Box>
              );
            })
          )}
        </Box>

        <Box marginTop={1}>
          {rowMarker(current.kind === 'save')}
          <Text color={current.kind === 'save' ? theme.text : theme.dim} bold={current.kind === 'save'}>
            Save project
          </Text>
        </Box>
        {editing ? (
          <Box>
            {rowMarker(current.kind === 'delete')}
            <Text color={current.kind === 'delete' ? theme.err : theme.dim} bold={current.kind === 'delete'}>
              {confirmDelete ? 'Delete project — press enter again to confirm' : 'Delete project'}
            </Text>
          </Box>
        ) : null}

        {error ? (
          <Box marginTop={1}>
            <Text color={theme.err}>{`✗ ${error}`}</Text>
          </Box>
        ) : null}
      </Box>
    </ScreenFrame>
  );
}
