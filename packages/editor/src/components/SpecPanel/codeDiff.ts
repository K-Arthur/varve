/**
 * Minimal line diff for the code panel's change summary.
 *
 * The previous "summary" subtracted line counts, so it reported `+4 -4` for a
 * four-line edit anywhere in the file and `+0 -0` for an edit that changed
 * content without changing length. A change summary has to describe actual
 * line changes, not a length delta.
 *
 * Implemented as a longest-common-subsequence walk with a bounded table: past
 * the cap the summary is reported as unavailable rather than silently becoming
 * an approximation. The panel is a preview surface, not a review tool.
 */

export interface LineDiffSummary {
  added: number;
  removed: number;
}

/** Largest line count the LCS table will be built for. */
export const LINE_DIFF_MAX_LINES = 4000;

/**
 * Count added/removed lines between two texts, or `null` when either input is
 * too large to compare exactly.
 */
export function computeLineDiff(previous: string, next: string): LineDiffSummary | null {
  if (previous === next) return { added: 0, removed: 0 };

  // An empty string is zero lines, not one empty line — otherwise adding a
  // first line reads as "1 added, 1 removed".
  const splitLines = (text: string): string[] => (text.length === 0 ? [] : text.split('\n'));
  const a = splitLines(previous);
  const b = splitLines(next);
  if (a.length > LINE_DIFF_MAX_LINES || b.length > LINE_DIFF_MAX_LINES) return null;

  // Trim the common prefix and suffix first: generated code usually changes in
  // one region, which keeps the table small in practice.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const left = a.slice(start, endA);
  const right = b.slice(start, endB);
  if (left.length === 0) return { added: right.length, removed: 0 };
  if (right.length === 0) return { added: 0, removed: left.length };

  // LCS length table over the (already trimmed) differing regions.
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        left[i] === right[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }

  const common = table[0] ?? 0;
  return { added: right.length - common, removed: left.length - common };
}
