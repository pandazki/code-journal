/**
 * `useInput` wrapper that auto-disables when raw mode isn't available (piped
 * stdin / --check), so a screen never crashes off a TTY. Every screen uses
 * exactly one of these — no competing input handlers.
 */
import { type Key, useInput, useStdin } from 'ink';

export type InputHandler = (input: string, key: Key) => void;

export function useScreenInput(handler: InputHandler, isActive = true): void {
  const { isRawModeSupported } = useStdin();
  useInput(handler, { isActive: isActive && isRawModeSupported });
}
