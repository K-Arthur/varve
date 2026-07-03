/**
 * Property path utilities for the motion system.
 *
 * Supports dot-notation property paths (e.g., "fills[0].color", "transform[4]",
 * "shape.w", "opacity") for addressing nested properties on SceneNode objects.
 * Used by TimelineSampler to read/write property values during animation
 * sampling.
 */

/** Split a dot-notation path into segments. */
export function parsePropertyPath(path: string): string[] {
  if (!path) return [];
  const segments: string[] = [];
  let current = '';
  let inBracket = false;

  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '[') {
      if (current) {
        segments.push(current);
        current = '';
      }
      inBracket = true;
    } else if (ch === ']') {
      if (current) {
        segments.push(current);
        current = '';
      }
      inBracket = false;
    } else if (ch === '.' && !inBracket) {
      if (current) {
        segments.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** Get a nested value from an object using a parsed path segments array. */
export function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Set a nested value on an object immutably.
 * Returns a new object with the value set at the given path.
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) return { ...obj };
  if (path.length === 1) {
    return { ...obj, [path[0]!]: value };
  }

  const [head, ...rest] = path;
  const child = obj[head!];
  const nextChild =
    typeof child === 'object' && child !== null
      ? setNestedValue(child as Record<string, unknown>, rest, value)
      : setNestedValue({}, rest, value);

  return { ...obj, [head!]: nextChild };
}

/** Registry of which properties are interpolable and their interpolation kind. */
export type InterpolationKind = 'number' | 'color' | 'affine' | 'path' | 'boolean' | 'discrete';

export const INTERPOLABLE_PROPERTIES: Record<string, InterpolationKind> = {
  // NodeBase
  opacity: 'number',
  rotation: 'number',
  'transform[0]': 'number',
  'transform[1]': 'number',
  'transform[2]': 'number',
  'transform[3]': 'number',
  'transform[4]': 'number',
  'transform[5]': 'number',
  'fill[0]': 'number',
  'fill[1]': 'number',
  'fill[2]': 'number',
  'fill[3]': 'number',

  // Shape-specific
  'shape.w': 'number',
  'shape.h': 'number',
  'shape.rx': 'number',
  'shape.ry': 'number',
  'shape.r': 'number',
  'shape.radius': 'number',
  'shape.outerRadius': 'number',
  'shape.innerRadius': 'number',
  'shape.points': 'path',

  // Frame
  w: 'number',
  h: 'number',
  cornerRadius: 'number',

  // Text
  fontSize: 'number',
  letterSpacing: 'number',
  lineHeight: 'number',
  paragraphSpacing: 'number',
};
