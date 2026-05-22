/**
 * Keyboard → text-field edits. Screens own their single `useInput`; when a
 * text field is focused they route the keypress through here. The cursor is
 * always at the end — enough for entering paths, ids, and credentials.
 */
import type { Key } from 'ink';

export function applyTextKey(value: string, input: string, key: Key): string {
  if (key.ctrl && (input === 'u' || input === 'U')) return '';
  if (key.backspace || key.delete) return value.slice(0, -1);
  // navigation / control keys never mutate the text
  if (
    key.return ||
    key.tab ||
    key.escape ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.ctrl ||
    key.meta
  ) {
    return value;
  }
  if (input) return value + input;
  return value;
}
