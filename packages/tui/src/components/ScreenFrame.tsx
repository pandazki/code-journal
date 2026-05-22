/** Consistent screen chrome: a title bar, the body, and a footer key-hint line. */
import { Box, Text } from 'ink';
import React from 'react';

import { theme } from '../theme';

export function ScreenFrame({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box>
        <Text backgroundColor={theme.brand} color="black" bold>
          {' cj '}
        </Text>
        <Text bold>{` ${title}`}</Text>
        {subtitle ? <Text color={theme.dim}>{`  ·  ${subtitle}`}</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
      {footer ? (
        <Box marginTop={1}>
          <Text color={theme.dim}>{footer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** A dim "key  action" hint, e.g. <Hint k="↑↓" act="move" />. */
export function Hint({ k, act }: { k: string; act: string }): React.ReactElement {
  return (
    <Text>
      <Text color={theme.accent}>{k}</Text>
      <Text color={theme.dim}>{` ${act}`}</Text>
    </Text>
  );
}

/** Join hints with a separator. */
export function HintBar({ hints }: { hints: Array<[string, string]> }): React.ReactElement {
  return (
    <Text>
      {hints.map(([k, act], i) => (
        <Text key={k}>
          {i > 0 ? <Text color={theme.dim}>{'   '}</Text> : null}
          <Text color={theme.accent}>{k}</Text>
          <Text color={theme.dim}>{` ${act}`}</Text>
        </Text>
      ))}
    </Text>
  );
}
