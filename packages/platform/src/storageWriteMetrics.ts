/**
 * Local-only write telemetry for the browser storage path.
 *
 * IndexedDB does not expose physical flash writes. These counters therefore
 * describe the bytes Varve asks the structured-clone layer to persist, which
 * is the useful signal for write amplification regressions and is explicitly
 * not a claim about eMMC throughput.
 */

export type StorageWriteKind = 'document-content' | 'file-metadata' | 'other';

export interface StorageWriteMetrics {
  writes: number;
  logicalBytes: number;
  clonedBytes: number;
  byKind: Record<StorageWriteKind, { writes: number; logicalBytes: number; clonedBytes: number }>;
}

function emptyMetrics(): StorageWriteMetrics {
  return {
    writes: 0,
    logicalBytes: 0,
    clonedBytes: 0,
    byKind: {
      'document-content': { writes: 0, logicalBytes: 0, clonedBytes: 0 },
      'file-metadata': { writes: 0, logicalBytes: 0, clonedBytes: 0 },
      other: { writes: 0, logicalBytes: 0, clonedBytes: 0 },
    },
  };
}

let metrics = emptyMetrics();

export function recordStorageWrite(
  kind: StorageWriteKind,
  logicalBytes: number,
  clonedBytes = logicalBytes,
): void {
  const logical = Number.isFinite(logicalBytes) && logicalBytes > 0 ? logicalBytes : 0;
  const cloned = Number.isFinite(clonedBytes) && clonedBytes > 0 ? clonedBytes : 0;
  const bucket = metrics.byKind[kind];
  metrics = {
    ...metrics,
    writes: metrics.writes + 1,
    logicalBytes: metrics.logicalBytes + logical,
    clonedBytes: metrics.clonedBytes + cloned,
    byKind: {
      ...metrics.byKind,
      [kind]: {
        writes: bucket.writes + 1,
        logicalBytes: bucket.logicalBytes + logical,
        clonedBytes: bucket.clonedBytes + cloned,
      },
    },
  };
}

export function getStorageWriteMetrics(): StorageWriteMetrics {
  return {
    ...metrics,
    byKind: Object.fromEntries(
      Object.entries(metrics.byKind).map(([kind, value]) => [kind, { ...value }]),
    ) as StorageWriteMetrics['byKind'],
  };
}

export function resetStorageWriteMetrics(): void {
  metrics = emptyMetrics();
}
