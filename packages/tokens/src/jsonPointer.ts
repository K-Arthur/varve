/**
 * RFC 6901 JSON Pointer parsing and resolution (2025.10 format module
 * section 7.4). Implemented without `eval`; escapes are ~0 (tilde) and
 * ~1 (slash). Numeric segments act as array indices in array contexts.
 */

export interface JsonPointerSegment {
  /** Decoded segment (unescaped). */
  value: string;
  /** Whether the segment was numeric — candidate array index. */
  numeric: boolean;
}

export function parseJsonPointer(pointer: string): JsonPointerSegment[] {
  if (!pointer.startsWith('#')) {
    throw new Error(`JSON pointer must start with '#': ${pointer}`);
  }
  const raw = pointer.slice(1);
  if (raw === '' || raw === '/') return [];
  if (!raw.startsWith('/')) {
    throw new Error(`Invalid JSON pointer fragment: ${pointer}`);
  }
  const segments: JsonPointerSegment[] = [];
  for (const part of raw.slice(1).split('/')) {
    const value = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (/~[^01]/.test(part)) {
      throw new Error(`Invalid JSON pointer escape in ${pointer}`);
    }
    segments.push({ value, numeric: /^\d+$/.test(value) });
  }
  return segments;
}

export function encodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function buildJsonPointer(segments: readonly string[]): string {
  if (segments.length === 0) return '#';
  return `#/${segments.map(encodeJsonPointerSegment).join('/')}`;
}

export type JsonPointerTarget = Record<string, unknown> | unknown[] | unknown;

/**
 * Resolve a pointer against a parsed JSON document (root value).
 * Throws JsonPointerError with a stable code on failure.
 */
export function resolveJsonPointer(root: unknown, pointer: string): unknown {
  const segments = parseJsonPointer(pointer);
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!segment.numeric) {
        throw new JsonPointerError(
          'invalid-array-index',
          `Segment "${segment.value}" is not an array index`,
        );
      }
      const index = Number(segment.value);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new JsonPointerError('index-out-of-range', `Index ${index} out of range`);
      }
      current = current[index];
    } else if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>;
      if (!Object.hasOwn(record, segment.value)) {
        throw new JsonPointerError('property-not-found', `Property "${segment.value}" not found`);
      }
      current = record[segment.value];
    } else {
      throw new JsonPointerError('cannot-traverse', `cannot traverse into ${typeof current}`);
    }
  }
  return current;
}

export class JsonPointerError extends Error {
  constructor(
    readonly code:
      | 'invalid-syntax'
      | 'invalid-array-index'
      | 'index-out-of-range'
      | 'property-not-found'
      | 'cannot-traverse',
    message: string,
  ) {
    super(message);
    this.name = 'JsonPointerError';
  }
}
