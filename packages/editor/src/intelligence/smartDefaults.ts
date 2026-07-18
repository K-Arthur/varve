import type { Document } from '@strata/scene';

export interface SmartDefaults {
  frameSize: { w: number; h: number };
  fontSize: number;
  spacingUnit: number;
}

export function getSmartDefaults(
  doc: Document,
  tracker?: import('./actionTracker').ActionTracker,
): SmartDefaults {
  const fontSize = findMostUsedFontSize(doc) ?? 16;
  const spacingUnit = findMostUsedSpacing(doc) ?? 8;
  const frameSize = tracker
    ? (findMostUsedFrameSizeFromTracker(tracker) ?? findMostUsedFrameSize(doc))
    : findMostUsedFrameSize(doc);

  return {
    frameSize,
    fontSize,
    spacingUnit,
  };
}

function findMostUsedFrameSizeFromTracker(
  tracker: import('./actionTracker').ActionTracker,
): { w: number; h: number } | null {
  const records = tracker.getRecentActions(30 * 24 * 60 * 60 * 1000);
  const sizeCounts = new Map<string, { w: number; h: number; count: number }>();

  for (const record of records) {
    if (record.actionId === 'createFrame' && record.context?.w && record.context?.h) {
      const key = `${record.context.w}x${record.context.h}`;
      const existing = sizeCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        sizeCounts.set(key, {
          w: Number(record.context.w),
          h: Number(record.context.h),
          count: 1,
        });
      }
    }
  }

  let best: { w: number; h: number } | null = null;
  let bestCount = 0;
  for (const entry of sizeCounts.values()) {
    if (entry.count > bestCount) {
      best = { w: entry.w, h: entry.h };
      bestCount = entry.count;
    }
  }

  return best;
}

function findMostUsedFontSize(doc: Document): number | null {
  const sizeCounts = new Map<number, number>();

  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'text' && node.fontSize) {
      sizeCounts.set(node.fontSize, (sizeCounts.get(node.fontSize) ?? 0) + 1);
    }
  }

  let bestSize: number | null = null;
  let bestCount = 0;
  for (const [size, count] of sizeCounts) {
    if (count > bestCount) {
      bestSize = size;
      bestCount = count;
    }
  }

  return bestSize;
}

function findMostUsedSpacing(doc: Document): number | null {
  const gapCounts = new Map<number, number>();

  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'frame' && node.layoutStyle?.gap != null) {
      const gap = node.layoutStyle.gap;
      gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1);
    }
  }

  let bestGap: number | null = null;
  let bestCount = 0;
  for (const [gap, count] of gapCounts) {
    if (count > bestCount) {
      bestGap = gap;
      bestCount = count;
    }
  }

  return bestGap;
}

function findMostUsedFrameSize(doc: Document): { w: number; h: number } {
  const sizeCounts = new Map<string, { w: number; h: number; count: number }>();

  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'frame' && 'w' in node && 'h' in node) {
      const key = `${node.w}x${node.h}`;
      const existing = sizeCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        sizeCounts.set(key, { w: node.w, h: node.h, count: 1 });
      }
    }
  }

  let best = { w: 1440, h: 900 };
  let bestCount = 0;
  for (const entry of sizeCounts.values()) {
    if (entry.count > bestCount) {
      best = { w: entry.w, h: entry.h };
      bestCount = entry.count;
    }
  }

  return best;
}
