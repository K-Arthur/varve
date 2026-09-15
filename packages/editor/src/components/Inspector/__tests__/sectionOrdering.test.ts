// @ts-nocheck
/**
 * Tests for section ordering operations.
 */
import { describe, expect, it } from 'vitest';
import { getSectionDefinition } from '../sectionRegistry';
import {
  createDefaultSectionState,
  getOrderedSectionIds,
  moveSectionAfter,
  moveSectionBefore,
  moveSectionDown,
  moveSectionToEnd,
  moveSectionToStart,
  moveSectionUp,
  resetSectionOrder,
} from '../sectionState';

describe('Section ordering', () => {
  it('stores registry order in the default state used by the renderer', () => {
    const state = createDefaultSectionState();

    for (const [id, sectionState] of Object.entries(state)) {
      expect(sectionState.order).toBe(getSectionDefinition(id)?.order);
    }
  });

  it('getOrderedSectionIds returns all IDs sorted by order', () => {
    const state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    expect(ordered.length).toBeGreaterThan(0);
    // Verify ascending order
    for (let i = 1; i < ordered.length; i++) {
      const a = state[ordered[i - 1]]?.order ?? 500;
      const b = state[ordered[i]]?.order ?? 500;
      expect(a).toBeLessThanOrEqual(b);
    }
  });

  it('moveSectionUp moves a section one position earlier', () => {
    let state = createDefaultSectionState();
    // Find two adjacent sections
    const ordered = getOrderedSectionIds(state);
    const target = ordered[2]; // Third section
    state = moveSectionUp(state, target);
    const newOrdered = getOrderedSectionIds(state);
    expect(newOrdered.indexOf(target)).toBe(1); // Now second
  });

  it('moveSectionDown moves a section one position later', () => {
    let state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const target = ordered[0]; // First section
    state = moveSectionDown(state, target);
    const newOrdered = getOrderedSectionIds(state);
    expect(newOrdered.indexOf(target)).toBe(1);
    // The original second section is now first
    expect(newOrdered[0]).toBe(ordered[1]);
  });

  it('moveSectionToStart moves a section to the beginning', () => {
    let state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const target = ordered[ordered.length - 1]; // Last section
    state = moveSectionToStart(state, target);
    const newOrdered = getOrderedSectionIds(state);
    expect(newOrdered[0]).toBe(target);
  });

  it('moveSectionToEnd moves a section to the end', () => {
    let state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const target = ordered[0]; // First section
    state = moveSectionToEnd(state, target);
    const newOrdered = getOrderedSectionIds(state);
    expect(newOrdered[newOrdered.length - 1]).toBe(target);
  });

  it('moveSectionBefore inserts before the target', () => {
    let state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const section = ordered[3];
    const target = ordered[1];
    state = moveSectionBefore(state, section, target);
    const newOrdered = getOrderedSectionIds(state);
    expect(newOrdered.indexOf(section)).toBeLessThan(newOrdered.indexOf(target));
  });

  it('moveSectionAfter inserts after the target', () => {
    let state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const section = ordered[0];
    const target = ordered[2];
    state = moveSectionAfter(state, section, target);
    const newOrdered = getOrderedSectionIds(state);
    expect(newOrdered.indexOf(section)).toBeGreaterThan(newOrdered.indexOf(target));
  });

  it('moves a section after an earlier target without jumping to the end', () => {
    const state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const section = ordered[2];
    const target = ordered[0];
    const result = moveSectionAfter(state, section, target);
    const newOrdered = getOrderedSectionIds(result);
    expect(newOrdered.slice(0, 3)).toEqual([target, section, ordered[1]]);
  });

  it('moves a section before a later target without jumping to the end', () => {
    const state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const section = ordered[0];
    const target = ordered[2];
    const result = moveSectionBefore(state, section, target);
    const newOrdered = getOrderedSectionIds(result);
    expect(newOrdered.slice(0, 3)).toEqual([ordered[1], section, target]);
  });

  it('limits a move to the supplied section subset', () => {
    const state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const subset = ordered.slice(0, 3);
    const result = moveSectionDown(state, subset[0]!, subset);
    expect(getOrderedSectionIds(result, subset)).toEqual([subset[1], subset[0], subset[2]]);
  });

  it('moveSectionBefore with same section is a no-op', () => {
    const state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const section = ordered[0];
    const result = moveSectionBefore(state, section, section);
    expect(getOrderedSectionIds(result)).toEqual(ordered);
  });

  it('moveSectionUp at first position is a no-op', () => {
    const state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const target = ordered[0];
    const result = moveSectionUp(state, target);
    expect(getOrderedSectionIds(result)[0]).toBe(target);
  });

  it('moveSectionDown at last position is a no-op', () => {
    const state = createDefaultSectionState();
    const ordered = getOrderedSectionIds(state);
    const target = ordered[ordered.length - 1];
    const result = moveSectionDown(state, target);
    const newOrdered = getOrderedSectionIds(result);
    expect(newOrdered[newOrdered.length - 1]).toBe(target);
  });

  it('resetSectionOrder restores registry defaults', () => {
    let state = createDefaultSectionState();
    // Scramble order
    state = moveSectionToEnd(state, 'position-size');
    state = moveSectionToStart(state, 'effects');
    const reset = resetSectionOrder(state);
    const ordered = getOrderedSectionIds(reset);
    // position-size (order 100) should be before effects (order 250)
    expect(ordered.indexOf('position-size')).toBeLessThan(ordered.indexOf('effects'));
  });

  it('preserves a persisted custom order during migration', async () => {
    const { migrateSectionState } = await import('../sectionState');
    const state = migrateSectionState({
      version: 1,
      sections: {
        effects: { collapsed: false, hidden: false, order: 17 },
      },
    });

    expect(state.effects.order).toBe(17);
  });

  it('assignStableOrders produces integer orders', () => {
    let state = createDefaultSectionState();
    state = moveSectionToEnd(state, 'position-size');
    // All orders should be multiples of 10
    for (const id of Object.keys(state)) {
      const order = state[id as keyof typeof state]?.order;
      if (order !== undefined) {
        expect(order % 10).toBe(0);
      }
    }
  });
});
