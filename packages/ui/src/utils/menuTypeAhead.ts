export const TYPEAHEAD_RESET_MS = 500;

export function getTypeAheadResetMs(): number {
  const win =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, number | undefined>)
      : undefined;
  if (win && win.__STRATA_TYPEAHEAD_MS !== undefined) {
    return win.__STRATA_TYPEAHEAD_MS;
  }
  return TYPEAHEAD_RESET_MS;
}

export interface TypeAheadItem {
  label: string;
  disabled?: boolean;
}

function makeCollator(locale?: string): Intl.Collator {
  return new Intl.Collator(locale ?? 'en', {
    sensitivity: 'base',
    usage: 'search',
  });
}

export function matchMenuTypeAhead(
  buffer: string,
  items: TypeAheadItem[],
  currentIndex: number,
  locale?: string,
): number | null {
  if (!buffer || items.length === 0) return null;

  const collator = makeCollator(locale);

  const searchableIndices = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !item.disabled);

  if (searchableIndices.length === 0) return null;

  const allSameChar = buffer.length > 0 && buffer.split('').every((c) => c === buffer[0]);

  if (allSameChar) {
    const searchChar = buffer[0]!;
    const matchingIndices = searchableIndices.filter((entry) => {
      const label = entry.item.label;
      return label != null && collator.compare(label.slice(0, 1), searchChar) === 0;
    });

    if (matchingIndices.length === 0) return null;

    const currentPos = matchingIndices.findIndex((m) => m.idx === currentIndex);
    const nextPos = (currentPos + 1) % matchingIndices.length;
    return matchingIndices[nextPos]!.idx;
  }

  for (let offset = 0; offset < items.length; offset++) {
    const checkIdx = (currentIndex + 1 + offset) % items.length;
    const item = items[checkIdx];
    if (!item || item.disabled) continue;

    const prefix = item.label?.slice(0, buffer.length) ?? '';
    if (collator.compare(prefix, buffer) === 0) {
      return checkIdx;
    }
  }

  return null;
}

export function shouldTypeAhead(
  e: KeyboardEvent | React.KeyboardEvent,
  currentBuffer: string,
): boolean {
  if ('isComposing' in e && e.isComposing) return false;
  if ((e as unknown as { keyCode?: number }).keyCode === 229) return false;
  if (e.repeat) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const { key } = e;
  if (key.length !== 1) return false;

  if (key === ' ' && currentBuffer === '') return false;

  return true;
}

export function isResetKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  switch (e.key) {
    case 'Escape':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Enter':
    case 'Tab':
      return true;
    default:
      return false;
  }
}
