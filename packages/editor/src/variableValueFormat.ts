/**
 * Safe, readable rendering of a stored or resolved variable value.
 *
 * Variables can hold structured values — DTCG dimension objects, color
 * objects — and `String(value)` throws on them (and on any parser-produced
 * null-prototype object). Everything that displays a variable value goes
 * through here instead of interpolating raw.
 */

interface Colorish {
  colorSpace?: unknown;
  components?: unknown;
  alpha?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatColor(record: Colorish): string | undefined {
  const { colorSpace, components, alpha } = record;
  if (typeof colorSpace !== 'string' || !Array.isArray(components)) return undefined;
  if (!components.every((c) => typeof c === 'number')) return undefined;
  const numbers = components as number[];
  const inUnit = (n: number) => n >= 0 && n <= 1;
  if (colorSpace === 'srgb' && numbers.length === 3 && numbers.every(inUnit)) {
    const hex = numbers
      .map((n) =>
        Math.round(n * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
    const alphaHex =
      typeof alpha === 'number' && alpha < 1
        ? Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
            .toString(16)
            .padStart(2, '0')
        : '';
    return `#${hex}${alphaHex}`;
  }
  return `${colorSpace}(${numbers.join(' ')})`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '—';
  } catch {
    return '—';
  }
}

export function formatVariableValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => formatVariableValue(item)).join(', ');
  if (isRecord(value)) {
    if (typeof value.value === 'number') {
      return typeof value.unit === 'string' ? `${value.value} ${value.unit}` : String(value.value);
    }
    const color = formatColor(value as Colorish);
    if (color !== undefined) return color;
    return safeStringify(value);
  }
  return safeStringify(value);
}
