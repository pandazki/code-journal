/** Plain-text layout helpers for the transcript panes. */

/** Word-wrap text to a column width, preserving existing newlines. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(8, width);
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length <= w) {
      out.push(raw);
      continue;
    }
    let line = raw;
    while (line.length > w) {
      let brk = line.lastIndexOf(' ', w);
      if (brk < w * 0.6) brk = w; // no sensible space → hard break
      out.push(line.slice(0, brk));
      line = line.slice(brk).replace(/^ +/, '');
    }
    out.push(line);
  }
  return out;
}

/** Hard-clip a single line to a width (no ellipsis — for dense JSON). */
export function clipLine(s: string, width: number): string {
  return s.length > width ? s.slice(0, Math.max(0, width)) : s;
}
