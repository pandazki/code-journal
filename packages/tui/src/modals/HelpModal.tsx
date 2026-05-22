/** Keybinding reference modal. */
import { Box, Text } from 'ink';
import React from 'react';

import { HintBar, ScreenFrame } from '../components/ScreenFrame';
import { useScreenInput } from '../hooks/useScreenInput';
import { theme } from '../theme';

const KEYS: Array<[string, string]> = [
  ['tab', 'switch panel — Projects ⇄ Sessions'],
  ['↑ ↓ / j k', 'move within the focused panel'],
  ['enter', 'open transcript · or focus the sessions panel'],
  ['r', 'toggle Local / Remote (S3) sessions'],
  ['u', 'upload the selected session'],
  ['S', 'sync — upload every new / changed session in the project'],
  ['a', 'auto-scan & generate projects'],
  ['n / e', 'new project · edit selected project'],
  ['s', 'S3 settings'],
  ['c', 'scheduled upload (system cron)'],
  ['l', 'activity log'],
  ['o', 'open config.json in your editor'],
  ['R', 'refresh discovery'],
  ['?', 'this help'],
  ['q', 'quit'],
];

export function HelpModal({ onClose }: { onClose: () => void }): React.ReactElement {
  useScreenInput(() => onClose()); // any key dismisses

  return (
    <ScreenFrame title="Keys" footer={<HintBar hints={[['any key', 'close']]} />}>
      <Box flexDirection="column">
        {KEYS.map(([k, d]) => (
          <Box key={k}>
            <Text color={theme.accent}>{k.padEnd(13)}</Text>
            <Text color={theme.dim}>{d}</Text>
          </Box>
        ))}
      </Box>
    </ScreenFrame>
  );
}
