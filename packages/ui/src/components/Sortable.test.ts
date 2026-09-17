import { describe, expect, it } from 'vitest';
import { pointerWithinOrClosestCenter, reorderSortableItems } from './Sortable';

const rect = (top: number) => ({
  top,
  left: 0,
  right: 100,
  bottom: top + 40,
  width: 100,
  height: 40,
});

function collisionArgs(pointerCoordinates: { x: number; y: number } | null) {
  const droppableContainers = ['first', 'second'].map((id) => ({
    id,
    key: id,
    data: { current: {} },
    disabled: false,
    node: { current: null },
    rect: { current: rect(id === 'first' ? 0 : 50) },
  }));
  return {
    active: {} as never,
    collisionRect: rect(50),
    droppableRects: new Map([
      ['first', rect(0)],
      ['second', rect(50)],
    ]),
    droppableContainers,
    pointerCoordinates,
  };
}

describe('pointerWithinOrClosestCenter', () => {
  it('falls back to nearest geometry for keyboard dragging', () => {
    const collisions = pointerWithinOrClosestCenter(collisionArgs(null));
    expect(collisions[0]?.id).toBe('second');
  });

  it('keeps pointer hit-testing when coordinates are available', () => {
    const collisions = pointerWithinOrClosestCenter(collisionArgs({ x: 50, y: 10 }));
    expect(collisions[0]?.id).toBe('first');
  });
});

describe('reorderSortableItems', () => {
  it('moves stable IDs to the destination position', () => {
    expect(reorderSortableItems(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(reorderSortableItems(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('rejects no-op, missing, and cancelled drops', () => {
    expect(reorderSortableItems(['a', 'b'], 'a', 'a')).toBeNull();
    expect(reorderSortableItems(['a', 'b'], 'missing', 'a')).toBeNull();
    expect(reorderSortableItems(['a', 'b'], 'a', 'missing')).toBeNull();
    expect(reorderSortableItems(['a', 'b'], 'a', null)).toBeNull();
  });

  it('does not mutate the caller-owned list', () => {
    const items = ['a', 'b', 'c'];
    reorderSortableItems(items, 'b', 'c');
    expect(items).toEqual(['a', 'b', 'c']);
  });
});
