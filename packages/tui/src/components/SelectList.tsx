/**
 * Presentational scrolling list. The owning screen tracks `selectedIndex` and
 * drives it from its own `useInput`; this component only renders the window.
 */
import { Box, Text } from 'ink';
import React from 'react';

import { theme } from '../theme';
import { computeWindow } from './windowing';

export interface SelectItem {
  label: string;
  hint?: string;
}

export function SelectList({
  items,
  selectedIndex,
  height = 10,
  emptyText = '(nothing here)',
}: {
  items: SelectItem[];
  selectedIndex: number;
  height?: number;
  emptyText?: string;
}): React.ReactElement {
  if (items.length === 0) {
    return <Text color={theme.dim}>{emptyText}</Text>;
  }
  const win = computeWindow(items, selectedIndex, height);
  return (
    <Box flexDirection="column">
      {win.hiddenAbove > 0 ? <Text color={theme.dim}>{`  ↑ ${win.hiddenAbove} more`}</Text> : null}
      {win.items.map((item, i) => {
        const idx = win.start + i;
        const selected = idx === selectedIndex;
        return (
          <Box key={idx}>
            <Text color={selected ? theme.brand : undefined} bold={selected}>
              {selected ? '❯ ' : '  '}
              {item.label}
            </Text>
            {item.hint ? <Text color={theme.dim}>{`  ${item.hint}`}</Text> : null}
          </Box>
        );
      })}
      {win.hiddenBelow > 0 ? <Text color={theme.dim}>{`  ↓ ${win.hiddenBelow} more`}</Text> : null}
    </Box>
  );
}
