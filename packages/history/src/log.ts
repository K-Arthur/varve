/**
 * Append-only operation segments (ADR-0020).
 *
 * Operations are appended in immutable, checksummed segments. A segment is
 * JSON-serializable so every backend (memory, IndexedDB, SQLite) stores the
 * same bytes; the checksum is SHA-256 over the serialized operations and is
 * verified on read. Timestamps never participate — ordering comes from the
 * document-scoped logical sequence and the segment index.
 */
import { sha256Utf8 } from '@varve/scene';
import type { LogPosition, StoredOperation } from './types';

export const LOG_SEGMENT_FORMAT_VERSION = 1;

export interface LogSegment {
  formatVersion: number;
  documentId: string;
  segmentIndex: number;
  /** SHA-256 over the canonical segment payload. */
  checksum: string;
  operations: StoredOperation[];
}

export interface AppendOperationsInput {
  documentId: string;
  /** Operations to append; logicalSequence must continue the manifest. */
  operations: StoredOperation[];
  /** First segment index to use for this append. */
  segmentIndex: number;
  /** Next logical sequence after this append (from the manifest). */
  nextLogicalSequence: number;
}

/** Serialize a segment's content (everything except the checksum). */
export function serializeSegmentContent(segment: Omit<LogSegment, 'checksum'>): string {
  return JSON.stringify({
    formatVersion: segment.formatVersion,
    documentId: segment.documentId,
    segmentIndex: segment.segmentIndex,
    operations: segment.operations,
  });
}

export function computeSegmentChecksum(segment: Omit<LogSegment, 'checksum'>): string {
  return sha256Utf8(serializeSegmentContent(segment));
}

/** Build a complete segment with its checksum. */
export function buildSegment(input: AppendOperationsInput): {
  segment: LogSegment;
  nextSegmentIndex: number;
} {
  const segment = {
    formatVersion: LOG_SEGMENT_FORMAT_VERSION,
    documentId: input.documentId,
    segmentIndex: input.segmentIndex,
    checksum: '',
    operations: input.operations,
  };
  segment.checksum = computeSegmentChecksum(segment);
  return { segment, nextSegmentIndex: input.segmentIndex + 1 };
}

/** Verify a segment's checksum; returns the mismatch description or null. */
export function verifySegmentChecksum(segment: LogSegment): string | null {
  if (segment.formatVersion !== LOG_SEGMENT_FORMAT_VERSION) {
    return `unsupported segment format version ${segment.formatVersion}`;
  }
  const expected = computeSegmentChecksum(segment);
  if (expected !== segment.checksum) {
    return `segment ${segment.segmentIndex} checksum mismatch`;
  }
  // Sequence must be contiguous within the segment.
  for (let i = 1; i < segment.operations.length; i++) {
    if (segment.operations[i]!.logicalSequence !== segment.operations[i - 1]!.logicalSequence + 1) {
      return `segment ${segment.segmentIndex} has a non-contiguous logical sequence`;
    }
  }
  return null;
}

/** Absolute operation count for a position (segment prefix length + offset). */
export function positionToGlobalOffset(position: LogPosition, segment: LogSegment): number {
  let offset = position.offset;
  offset += segment.operations.length;
  return offset;
}

/** Whether `a` is at or after `b` (same segment) or in a later segment. */
export function isPositionAfter(a: LogPosition, b: LogPosition): boolean {
  if (a.segment !== b.segment) return a.segment > b.segment;
  return a.offset >= b.offset;
}
