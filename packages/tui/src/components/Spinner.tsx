/** Braille spinner. Self-animating; no input. */
import { Text } from 'ink';
import React, { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ color = 'cyan', label }: { color?: string; label?: string }): React.ReactElement {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <Text color={color}>
      {FRAMES[i]}
      {label ? ` ${label}` : ''}
    </Text>
  );
}
