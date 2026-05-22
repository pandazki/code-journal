/**
 * Presentational text field — shows the value, a placeholder when empty, and a
 * reverse-video cursor block when focused. It does NOT capture input; the
 * owning screen's `useInput` drives edits through `applyTextKey`.
 */
import { Text } from 'ink';
import React from 'react';

import { theme } from '../theme';

export function TextInput({
  value,
  focused,
  mask = false,
  placeholder = '',
}: {
  value: string;
  focused: boolean;
  mask?: boolean;
  placeholder?: string;
}): React.ReactElement {
  const cursor = focused ? (
    <Text inverse> </Text>
  ) : (
    <Text> </Text>
  );

  if (value.length === 0) {
    return (
      <Text>
        {cursor}
        {placeholder ? <Text color={theme.dim}>{placeholder}</Text> : null}
      </Text>
    );
  }

  const shown = mask ? '•'.repeat(value.length) : value;
  return (
    <Text>
      <Text color={focused ? theme.text : theme.dim}>{shown}</Text>
      {focused ? <Text inverse> </Text> : null}
    </Text>
  );
}
