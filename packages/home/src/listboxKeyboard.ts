import type { KeyboardEvent } from 'react';

/**
 * Keyboard contract for the small button-based listboxes used by Home
 * popovers: ArrowUp/Down move focus with wrapping, Home/End jump to the ends,
 * Enter/Space choose, and printable characters run type-ahead over option
 * labels. Escape and focus return are owned by the hosting `Popover`.
 *
 * The listbox is a single tab stop (roving `tabIndex` is managed by the
 * consumer); options are focused directly while open.
 */
export function handleListboxKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onChoose: () => void,
): void {
  const option = event.currentTarget;
  const listbox = option.closest<HTMLElement>('[role="listbox"]') ?? option.parentElement;
  if (!listbox) return;
  const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
  const index = options.indexOf(option);
  if (index === -1) return;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onChoose();
    return;
  }

  let nextIndex: number | null = null;
  switch (event.key) {
    case 'ArrowDown':
      nextIndex = (index + 1) % options.length;
      break;
    case 'ArrowUp':
      nextIndex = (index - 1 + options.length) % options.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = options.length - 1;
      break;
    default:
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        nextIndex = findTypeAhead(options, index, event.key, listbox);
      }
  }
  if (nextIndex === null || nextIndex === index) return;
  event.preventDefault();
  options[nextIndex]?.focus();
}

const TYPE_AHEAD_RESET_MS = 600;
const typeAheadBuffers = new WeakMap<HTMLElement, { text: string; timer: number | null }>();

function findTypeAhead(
  options: HTMLElement[],
  fromIndex: number,
  key: string,
  listbox: HTMLElement,
): number | null {
  const entry = typeAheadBuffers.get(listbox) ?? { text: '', timer: null };
  if (entry.timer !== null) window.clearTimeout(entry.timer);
  entry.text += key.toLowerCase();
  entry.timer = window.setTimeout(() => {
    entry.text = '';
    entry.timer = null;
  }, TYPE_AHEAD_RESET_MS);
  typeAheadBuffers.set(listbox, entry);

  const repeated = entry.text.length > 1 && /^(.)\1+$/.test(entry.text);
  const needle = repeated ? entry.text.charAt(0) : entry.text;
  const start = repeated ? fromIndex + 1 : 0;
  for (let step = 0; step < options.length; step++) {
    const candidateIndex = (start + step) % options.length;
    const label = (options[candidateIndex]?.textContent ?? '').trim().toLowerCase();
    if (label.startsWith(needle)) return candidateIndex;
  }
  return null;
}
