import { describe, expect, it } from 'vitest';
import {
  isResetKey,
  matchMenuTypeAhead,
  shouldTypeAhead,
  TYPEAHEAD_RESET_MS,
  type TypeAheadItem,
} from './menuTypeAhead';

const items: TypeAheadItem[] = [
  { label: 'Open' },
  { label: 'Redo' },
  { label: 'Rename' },
  { label: 'Export' },
  { label: 'Close' },
];

describe('matchMenuTypeAhead', () => {
  it('returns null on empty buffer', () => {
    expect(matchMenuTypeAhead('', items, 0)).toBeNull();
  });

  it('returns null on empty items', () => {
    expect(matchMenuTypeAhead('r', [], 0)).toBeNull();
  });

  it('returns null when no match', () => {
    expect(matchMenuTypeAhead('z', items, 0)).toBeNull();
  });

  it('finds prefix match from start', () => {
    expect(matchMenuTypeAhead('o', items, 0)).toBe(0);
  });

  it('matches case-insensitively', () => {
    expect(matchMenuTypeAhead('O', items, 0)).toBe(0);
  });

  it('matches accent-insensitively via collator', () => {
    const accented: TypeAheadItem[] = [
      { label: 'Café' },
      { label: 'Cafe' },
      { label: 'Cafeteria' },
    ];
    const result = matchMenuTypeAhead('cafe', accented, -1);
    expect(result).toBe(0);
  });

  it('matches abbreviated with buffer', () => {
    expect(matchMenuTypeAhead('re', items, 0)).toBe(1);
  });

  it('search starts after current index', () => {
    expect(matchMenuTypeAhead('o', items, 3)).toBe(0);
  });

  it('search wraps around', () => {
    expect(matchMenuTypeAhead('o', items, 1)).toBe(0);
  });

  it('search after last item wraps to first', () => {
    expect(matchMenuTypeAhead('c', items, 4)).toBe(4);
  });

  it('skips disabled items for prefix match', () => {
    expect(matchMenuTypeAhead('r', items, 0)).toBe(1);
    const withDisabled: TypeAheadItem[] = [{ label: 'Redo', disabled: true }, { label: 'Rename' }];
    expect(matchMenuTypeAhead('r', withDisabled, -1)).toBe(1);
  });

  it('returns null if all items disabled', () => {
    const allDisabled = items.map((i) => ({ ...i, disabled: true }));
    expect(matchMenuTypeAhead('o', allDisabled, 0)).toBeNull();
  });

  it('buffer of two chars: "re" matches Rename (1), not Redo (0)', () => {
    expect(matchMenuTypeAhead('re', items, -1)).toBe(1);
  });
});

describe('matchMenuTypeAhead — repeated char cycling', () => {
  const cycleItems: TypeAheadItem[] = [
    { label: 'Redo' },
    { label: 'Export' },
    { label: 'Revert' },
    { label: 'Rename' },
  ];

  it('single "r" from -1 goes to first match (Redo)', () => {
    const result = matchMenuTypeAhead('r', cycleItems, -1);
    expect(result).toBe(0);
  });

  it('"r" from index 0 cycles to next match (Revert)', () => {
    const result = matchMenuTypeAhead('r', cycleItems, 0);
    expect(result).toBe(2);
  });

  it('"rr" cycles from index 0 to next match (Revert), not prefix "rr"', () => {
    const result = matchMenuTypeAhead('rr', cycleItems, 0);
    expect(result).toBe(2);
  });

  it('cycles from last match back to first', () => {
    const result = matchMenuTypeAhead('r', cycleItems, 2);
    expect(result).toBe(3);
  });

  it('wraps when at the last matching item', () => {
    const result = matchMenuTypeAhead('r', cycleItems, 3);
    expect(result).toBe(0);
  });

  it('skips disabled items in cycle', () => {
    const withDisabled: TypeAheadItem[] = [
      { label: 'Redo', disabled: true },
      { label: 'Export' },
      { label: 'Revert' },
    ];
    const result = matchMenuTypeAhead('r', withDisabled, -1);
    expect(result).toBe(2);
  });
});

describe('matchMenuTypeAhead — edge cases', () => {
  it('non-repeated multi-char buffer is prefix-match, not cycle', () => {
    const items: TypeAheadItem[] = [{ label: 'Redo' }, { label: 'Revert' }, { label: 'Rename' }];
    const result = matchMenuTypeAhead('re', items, -1);
    expect(result).toBe(0);
  });

  it('buffer with same char as only matching item stays on same item on repeat', () => {
    const single: TypeAheadItem[] = [{ label: 'Save' }];
    expect(matchMenuTypeAhead('s', single, 0)).toBe(0);
    expect(matchMenuTypeAhead('ss', single, 0)).toBe(0);
  });

  it('currentIndex out of range does not crash', () => {
    expect(matchMenuTypeAhead('o', items, 999)).toBe(0);
    expect(matchMenuTypeAhead('o', items, -5)).toBe(0);
  });
});

describe('shouldTypeAhead', () => {
  function mockEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key: 'a',
      isComposing: false,
      keyCode: 65,
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...overrides,
    } as unknown as KeyboardEvent;
  }

  it('allows a normal printable character', () => {
    expect(shouldTypeAhead(mockEvent(), '')).toBe(true);
  });

  it('rejects if isComposing', () => {
    expect(shouldTypeAhead(mockEvent({ isComposing: true }), '')).toBe(false);
  });

  it('rejects if keyCode is 229 (IME)', () => {
    expect(shouldTypeAhead(mockEvent({ keyCode: 229 } as Partial<KeyboardEvent>), '')).toBe(false);
  });

  it('rejects repeat events', () => {
    expect(shouldTypeAhead(mockEvent({ repeat: true }), '')).toBe(false);
  });

  it('rejects if ctrl held', () => {
    expect(shouldTypeAhead(mockEvent({ ctrlKey: true }), '')).toBe(false);
  });

  it('rejects if meta held', () => {
    expect(shouldTypeAhead(mockEvent({ metaKey: true }), '')).toBe(false);
  });

  it('rejects if alt held', () => {
    expect(shouldTypeAhead(mockEvent({ altKey: true }), '')).toBe(false);
  });

  it('rejects empty string buffer + space key', () => {
    expect(shouldTypeAhead(mockEvent({ key: ' ' }), '')).toBe(false);
  });

  it('allows space when buffer is non-empty', () => {
    expect(shouldTypeAhead(mockEvent({ key: ' ' }), 'sa')).toBe(true);
  });

  it('rejects non-printable keys', () => {
    expect(shouldTypeAhead(mockEvent({ key: 'ArrowDown' }), '')).toBe(false);
    expect(shouldTypeAhead(mockEvent({ key: 'Escape' }), '')).toBe(false);
    expect(shouldTypeAhead(mockEvent({ key: 'Enter' }), '')).toBe(false);
    expect(shouldTypeAhead(mockEvent({ key: 'Tab' }), '')).toBe(false);
  });
});

describe('isResetKey', () => {
  function mkEvent(key: string): KeyboardEvent {
    return { key } as KeyboardEvent;
  }

  it('returns true for Escape', () => {
    expect(isResetKey(mkEvent('Escape'))).toBe(true);
  });
  it('returns true for ArrowUp', () => {
    expect(isResetKey(mkEvent('ArrowUp'))).toBe(true);
  });
  it('returns true for ArrowDown', () => {
    expect(isResetKey(mkEvent('ArrowDown'))).toBe(true);
  });
  it('returns true for ArrowLeft', () => {
    expect(isResetKey(mkEvent('ArrowLeft'))).toBe(true);
  });
  it('returns true for ArrowRight', () => {
    expect(isResetKey(mkEvent('ArrowRight'))).toBe(true);
  });
  it('returns true for Enter', () => {
    expect(isResetKey(mkEvent('Enter'))).toBe(true);
  });
  it('returns true for Tab', () => {
    expect(isResetKey(mkEvent('Tab'))).toBe(true);
  });
  it('returns false for printable keys', () => {
    expect(isResetKey(mkEvent('a'))).toBe(false);
    expect(isResetKey(mkEvent('Z'))).toBe(false);
    expect(isResetKey(mkEvent(' '))).toBe(false);
  });
  it('returns false for non-reserved keys', () => {
    expect(isResetKey(mkEvent('Home'))).toBe(false);
    expect(isResetKey(mkEvent('End'))).toBe(false);
    expect(isResetKey(mkEvent('PageUp'))).toBe(false);
  });
});

describe('TYPEAHEAD_RESET_MS', () => {
  it('is 500', () => {
    expect(TYPEAHEAD_RESET_MS).toBe(500);
  });
});
