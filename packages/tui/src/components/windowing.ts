/** Scroll-window math shared by every list/pane that may overflow the screen. */

export interface ListWindow<T> {
  /** the slice of items currently on screen */
  items: T[];
  /** index in the full array of the first visible item */
  start: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

/**
 * Pick the slice of `items` to show given the cursor at `selected`, keeping the
 * cursor roughly centred and never scrolling past either end.
 */
export function computeWindow<T>(items: T[], selected: number, height: number): ListWindow<T> {
  const h = Math.max(1, height);
  if (items.length <= h) {
    return { items, start: 0, hiddenAbove: 0, hiddenBelow: 0 };
  }
  let start = selected - Math.floor(h / 2);
  start = Math.max(0, Math.min(start, items.length - h));
  return {
    items: items.slice(start, start + h),
    start,
    hiddenAbove: start,
    hiddenBelow: items.length - start - h,
  };
}

/** Clamp an index move within [0, length). */
export function moveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, current + delta));
}
