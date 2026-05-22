/** Scheduled-upload modal — install / remove a system crontab job running `cj sync`. */
import { Box, Text } from 'ink';
import React, { useMemo, useState } from 'react';

import { HintBar, ScreenFrame } from '../components/ScreenFrame';
import { TextInput } from '../components/TextInput';
import { applyTextKey } from '../components/textEditing';
import { type CronStatus, cronAvailable, cronStatus, installCron, removeCron } from '../cron';
import { useScreenInput } from '../hooks/useScreenInput';
import { theme } from '../theme';

const PRESETS: Array<{ label: string; expr: string }> = [
  { label: 'every 15 minutes', expr: '*/15 * * * *' },
  { label: 'every 30 minutes', expr: '*/30 * * * *' },
  { label: 'hourly', expr: '0 * * * *' },
  { label: 'every 2 hours', expr: '0 */2 * * *' },
  { label: 'every 4 hours', expr: '0 */4 * * *' },
  { label: 'every 6 hours', expr: '0 */6 * * *' },
  { label: 'daily at 09:00', expr: '0 9 * * *' },
];
const DEFAULT_PRESET = Math.max(0, PRESETS.findIndex((p) => p.expr === '0 */4 * * *'));

export function CronModal({
  onClose,
  onContinue,
  wizardLabel,
}: {
  onClose: () => void;
  /** wizard mode: shows a "Continue →" row that advances the wizard */
  onContinue?: () => void;
  wizardLabel?: string;
}): React.ReactElement {
  const available = useMemo(() => cronAvailable(), []);
  const [status, setStatus] = useState<CronStatus>(() => cronStatus());
  const [binPath, setBinPath] = useState(process.execPath);
  const [presetIdx, setPresetIdx] = useState(() => {
    const matched = PRESETS.findIndex((p) => p.expr === status.expr);
    if (matched >= 0) return matched;
    return onContinue ? DEFAULT_PRESET : 1;
  });
  const [focus, setFocus] = useState(0);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const ROWS = onContinue ? 5 : 4;

  const doInstall = (): void => {
    try {
      installCron(binPath.trim(), PRESETS[presetIdx]!.expr);
      setStatus(cronStatus());
      setMsg({ text: 'scheduled upload installed', tone: 'ok' });
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'err' });
    }
  };
  const doRemove = (): void => {
    try {
      removeCron();
      setStatus(cronStatus());
      setMsg({ text: 'schedule removed', tone: 'ok' });
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'err' });
    }
  };

  useScreenInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if ((key.tab && key.shift) || key.upArrow) {
      setFocus((f) => (f + ROWS - 1) % ROWS);
      return;
    }
    if (key.tab || key.downArrow) {
      setFocus((f) => (f + 1) % ROWS);
      return;
    }
    if (focus === 0) {
      if (!key.return) setBinPath((s) => applyTextKey(s, input, key));
      return;
    }
    if (focus === 1) {
      if (key.leftArrow) setPresetIdx((i) => (i + PRESETS.length - 1) % PRESETS.length);
      else if (key.rightArrow || input === ' ') setPresetIdx((i) => (i + 1) % PRESETS.length);
      return;
    }
    if (focus === 2 && key.return) doInstall();
    if (focus === 3 && key.return) doRemove();
    if (focus === 4 && onContinue && key.return) onContinue();
  });

  const marker = (i: number): React.ReactElement => (
    <Text color={focus === i ? theme.brand : theme.dim}>{focus === i ? '❯ ' : '  '}</Text>
  );

  return (
    <ScreenFrame
      title="Scheduled upload"
      subtitle={wizardLabel ?? 'system cron'}
      footer={<HintBar hints={[['↑↓/tab', 'move'], ['←→', 'interval'], ['enter', 'activate'], ['esc', 'close']]} />}
    >
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color={status.installed ? theme.ok : theme.dim}>{status.installed ? '● ' : '○ '}</Text>
          <Text color={theme.dim}>
            {status.installed ? `installed — ${status.expr}` : 'not scheduled'}
          </Text>
        </Box>

        {!available ? (
          <Text color={theme.err}>system `crontab` is not available on this machine.</Text>
        ) : (
          <>
            <Box>
              {marker(0)}
              <Text color={focus === 0 ? theme.text : theme.dim}>{'cj binary'.padEnd(12)}</Text>
              <TextInput value={binPath} focused={focus === 0} placeholder="/path/to/cj" />
            </Box>
            <Box>
              {marker(1)}
              <Text color={focus === 1 ? theme.text : theme.dim}>{'interval'.padEnd(12)}</Text>
              <Text>{'◀ '}</Text>
              <Text color={theme.accent}>{PRESETS[presetIdx]!.label}</Text>
              <Text>{' ▶'}</Text>
            </Box>
            <Box marginTop={1}>
              {marker(2)}
              <Text color={focus === 2 ? theme.text : theme.dim} bold={focus === 2}>
                {status.installed ? 'Update schedule' : 'Install schedule'}
              </Text>
            </Box>
            <Box>
              {marker(3)}
              <Text color={focus === 3 ? theme.err : theme.dim} bold={focus === 3}>
                Remove schedule
              </Text>
            </Box>
            {onContinue ? (
              <Box>
                {marker(4)}
                <Text color={focus === 4 ? theme.brand : theme.dim} bold={focus === 4}>
                  Continue →
                </Text>
              </Box>
            ) : null}
            <Box marginTop={1}>
              <Text color={theme.dim}>
                runs `cj sync` — incremental upload of every project's new / changed sessions
              </Text>
            </Box>
            {msg ? (
              <Box marginTop={1}>
                <Text color={msg.tone === 'ok' ? theme.ok : theme.err}>
                  {`${msg.tone === 'ok' ? '✓' : '✗'} ${msg.text}`}
                </Text>
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </ScreenFrame>
  );
}
