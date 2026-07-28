export function parsePropertyPath(path: string): string[] {
  const segments: string[] = [];
  const parts = path.split('.');
  for (const part of parts) {
    const match = /^([^[]+)((?:\[[^\]]+\])*)$/.exec(part);
    if (!match) {
      segments.push(part);
      continue;
    }
    const [, first, second] = match;
    if (first) segments.push(first);
    const bracketGroups = second ? second.matchAll(/\[([^\]]+)\]/g) : [];
    for (const m of bracketGroups) {
      const [, inner] = m;
      if (inner) segments.push(inner);
    }
  }
  return segments;
}

function setAtPath(value: unknown, segments: string[], newValue: unknown): unknown {
  if (segments.length === 0) return newValue;
  const [head, ...tail] = segments;
  if (Array.isArray(value)) {
    const idx = Number(head);
    if (Number.isNaN(idx)) return value;
    const next = value[idx] ?? (tail.length > 0 && /^\d+$/.test(tail[0]!) ? [] : {});
    const copy = [...value];
    copy[idx] = setAtPath(next, tail, newValue);
    return copy;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const next = record[head!] ?? (tail.length > 0 && /^\d+$/.test(tail[0]!) ? [] : {});
    return { ...record, [head!]: setAtPath(next, tail, newValue) };
  }
  return value;
}

export function applyPropertyPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = parsePropertyPath(path);
  const head = segments[0]!;
  const tail = segments.slice(1);
  target[head] = setAtPath(target[head], tail, value);
}
