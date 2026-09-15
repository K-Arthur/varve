import { describe, expect, it } from 'vitest';
import type { ToolbarGroup, ToolbarSlot } from './toolbarComposition';
import {
  groupRetention,
  nextGroupToCollapse,
  nextSlotToCollapse,
  slotRetention,
  toolRetention,
} from './toolbarRetention';

function group(id: string, toolIds: string[]): ToolbarGroup {
  return {
    id,
    slots: toolIds.map((toolId) => ({ kind: 'tool' as const, toolId: toolId as never })),
  };
}

function slot(toolId: string): ToolbarSlot {
  return { kind: 'tool', toolId: toolId as never };
}

function flyout(id: string, toolIds: string[]): ToolbarSlot {
  return { kind: 'flyout', id, label: id, tools: toolIds as never };
}

describe('toolbarRetention', () => {
  it('ranks creation tools above measurement and AI tools', () => {
    expect(toolRetention('rect')).toBeGreaterThan(toolRetention('eyedropper'));
    expect(toolRetention('text')).toBeGreaterThan(toolRetention('pixelProbe'));
    expect(toolRetention('frame')).toBeGreaterThan(toolRetention('inspect'));
    expect(toolRetention('pen')).toBeGreaterThan(toolRetention('warp'));
    expect(toolRetention('rect')).toBeGreaterThan(toolRetention('sam2Segment'));
  });

  it('treats boolean operations as the first thing to yield', () => {
    for (const op of ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude']) {
      expect(toolRetention(op as never)).toBe(0);
      expect(toolRetention(op as never)).toBeLessThan(toolRetention('inspect'));
    }
  });

  it('scores a group by its least durable member', () => {
    expect(groupRetention(group('shapes', ['rect', 'ellipse']))).toBe(toolRetention('rect'));
    // A group with one low-retention member is only as durable as that member.
    const mixed = group('mixed', ['rect', 'warp']);
    expect(groupRetention(mixed)).toBe(toolRetention('warp'));
  });

  it('collapses the lowest-retention candidate first', () => {
    const candidates = [group('shapes', ['rect', 'ellipse']), group('ai', ['sam2Segment'])];
    expect(nextGroupToCollapse(candidates, [])?.id).toBe('ai');
  });

  it('never proposes an already-collapsed group and returns null when exhausted', () => {
    const candidates = [group('shapes', ['rect']), group('ai', ['sam2Segment'])];
    expect(nextGroupToCollapse(candidates, ['ai'])?.id).toBe('shapes');
    expect(nextGroupToCollapse(candidates, ['ai', 'shapes'])).toBeNull();
  });

  it('breaks ties by yielding the later declared group first', () => {
    const candidates = [group('a', ['rect']), group('b', ['ellipse'])];
    expect(nextGroupToCollapse(candidates, [])?.id).toBe('b');
  });

  it('scores a slot by its least durable member and collapses per slot', () => {
    expect(slotRetention(slot('rect'))).toBe(toolRetention('rect'));
    expect(slotRetention(flyout('boolean', ['booleanUnion']))).toBe(0);

    const candidates = [
      slot('rect'),
      slot('text'),
      slot('inspect'),
      flyout('boolean', ['booleanUnion', 'booleanSubtract']),
    ];
    expect(nextSlotToCollapse(candidates, [])).toEqual(candidates[3]);
    expect(nextSlotToCollapse(candidates, ['flyout:boolean'])).toEqual(candidates[2]);
    // rect and text tie at 90; the later declared slot yields first.
    expect(nextSlotToCollapse(candidates, ['flyout:boolean', 'tool:inspect'])).toEqual(
      candidates[1],
    );
    expect(nextSlotToCollapse(candidates, ['flyout:boolean', 'tool:inspect', 'tool:text'])).toEqual(
      candidates[0],
    );
  });

  it('keeps measurement slots collapsible while selection slots are candidates too', () => {
    // The palette collapses per slot, so a select group that also declares
    // Slice/Pixel Info/Scale/Inspect does not pin those four tools.
    expect(toolRetention('select')).toBeDefined();
    expect(toolRetention('slice')).toBeLessThan(toolRetention('select'));
    expect(toolRetention('inspect')).toBeLessThan(toolRetention('select'));
  });
});
