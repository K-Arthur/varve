import { describe, expect, it } from 'vitest';
import {
  type BreadcrumbPlan,
  MAX_INLINE_BREADCRUMB_SEGMENTS,
  planBreadcrumbSegments,
} from './SelectionBreadcrumb';

function levels(count: number): ReturnType<typeof planBreadcrumbSegments>['visible'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    name: `Node ${index}`,
    kind: 'frame' as const,
    isContainer: true,
  }));
}

describe('planBreadcrumbSegments', () => {
  it('keeps paths up to the inline limit in full', () => {
    for (let count = 1; count <= MAX_INLINE_BREADCRUMB_SEGMENTS; count += 1) {
      const segments = levels(count);
      const plan = planBreadcrumbSegments(segments);
      expect(plan.visible).toEqual(segments);
      expect(plan.hidden).toEqual([]);
    }
  });

  it('folds the middle levels and keeps both ends inline', () => {
    const segments = levels(8);
    const plan = planBreadcrumbSegments(segments);

    expect(plan.visible.map((segment) => segment.id)).toEqual([
      'node-0',
      'node-1',
      'node-6',
      'node-7',
    ]);
    expect(plan.hidden.map((segment) => segment.id)).toEqual([
      'node-2',
      'node-3',
      'node-4',
      'node-5',
    ]);
  });

  it('partitions the path so no level is dropped or listed twice', () => {
    for (let count = 0; count <= 12; count += 1) {
      const segments = levels(count);
      const plan: BreadcrumbPlan = planBreadcrumbSegments(segments);
      const combined = [...plan.visible, ...plan.hidden];

      expect(combined).toHaveLength(segments.length);
      expect(new Set(combined.map((segment) => segment.id)).size).toBe(count);
      // The leaf is the node the path identifies: it must stay inline.
      if (count > 0) expect(plan.visible.at(-1)?.id).toBe(`node-${count - 1}`);
    }
  });

  it('honours an explicit inline limit', () => {
    const segments = levels(6);
    const plan = planBreadcrumbSegments(segments, 6);
    expect(plan.visible).toEqual(segments);
    expect(plan.hidden).toEqual([]);
  });

  it('does not mutate the path it was given', () => {
    const segments = levels(7);
    const snapshot = [...segments];
    planBreadcrumbSegments(segments);
    expect(segments).toEqual(snapshot);
  });
});
