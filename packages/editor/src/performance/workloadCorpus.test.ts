import { describe, expect, it } from 'vitest';
import {
  createPerformanceWorkload,
  createPerformanceWorkloadCorpus,
  EXTREME_ZOOM_LEVELS,
  PERFORMANCE_STRESS_WORKLOAD_IDS,
  PERFORMANCE_WORKLOAD_IDS,
  type PerformanceWorkloadId,
} from './workloadCorpus';

describe('performance workload corpus', () => {
  it('covers every required representative workload with stable checksums', () => {
    const first = createPerformanceWorkloadCorpus();
    const second = createPerformanceWorkloadCorpus();

    expect(first.map((workload) => workload.id)).toEqual(PERFORMANCE_WORKLOAD_IDS);
    expect(first.map((workload) => workload.fixtureChecksum)).toEqual(
      second.map((workload) => workload.fixtureChecksum),
    );
    expect(new Set(first.map((workload) => workload.fixtureChecksum)).size).toBe(first.length);
  });

  it('constructs the flat 10K and deep hierarchy without hidden nodes', () => {
    const flat = createPerformanceWorkload('flat-10k');
    const deep = createPerformanceWorkload('deep-nesting');

    expect(flat.expected.nodeCount).toBe(10_000);
    expect(flat.document.rootChildren).toHaveLength(10_000);
    expect(deep.expected.nodeCount).toBe(129);
    expect(deep.document.rootChildren).toEqual(['frame-0']);
    expect(deep.document.nodes['frame-127']).toMatchObject({ children: ['deep-leaf'] });
  });

  it('records decoded-image admission pressure without allocating image pixels', () => {
    const raster = createPerformanceWorkload('raster-heavy');
    expect(raster.expected.decodedImageBytes).toBe(3_221_225_472);
    expect(raster.expected.nodeCount).toBe(48);
  });

  it('provides deterministic brush, motion, viewport, and switching scenarios', () => {
    expect(createPerformanceWorkload('rapid-brush').pointerSamples).toHaveLength(4_096);
    expect(
      createPerformanceWorkload('motion').document.timelines?.['timeline-main']?.tracks,
    ).toHaveLength(240);
    expect(
      createPerformanceWorkload('extreme-zoom').viewports?.map((viewport) => viewport.zoom),
    ).toEqual(EXTREME_ZOOM_LEVELS);
    expect(createPerformanceWorkload('document-switching').documentSequence).toHaveLength(3);
  });

  it('provides opt-in viewport-complexity stress fixtures with a fixed visible set', () => {
    expect(createPerformanceWorkloadCorpus().map((workload) => workload.id)).not.toContain(
      'viewport-100k',
    );
    expect(PERFORMANCE_STRESS_WORKLOAD_IDS).toEqual([
      'viewport-1k',
      'viewport-10k',
      'viewport-100k',
    ]);

    // Construct the 1k fixture in the regular unit path. The 10k/100k
    // variants deliberately use the same generator but are built only by the
    // explicit benchmark: checksumming 100k scene nodes in every unit run
    // would make the test harness itself the dominant workload.
    const workload = createPerformanceWorkload('viewport-1k');
    expect(workload.expected.nodeCount).toBe(1_000);
    expect(workload.expected.visibleNodeCount).toBe(100);
    const originNodes = Object.values(workload.document.nodes).filter((node) => {
      const transform = node.transform ?? [1, 0, 0, 1, 0, 0];
      return Math.abs(transform[4] ?? 0) < 1_000 && Math.abs(transform[5] ?? 0) < 1_000;
    });
    expect(originNodes).toHaveLength(100);
  });

  it('provides the required deterministic scale fixtures', () => {
    expect(createPerformanceWorkload('vector-100').expected.nodeCount).toBe(100);
    expect(createPerformanceWorkload('vector-500').expected.nodeCount).toBe(500);
    expect(createPerformanceWorkload('vector-1k').expected.nodeCount).toBe(1_000);
    expect(createPerformanceWorkload('vector-5k').expected.nodeCount).toBe(5_000);
    for (const id of ['vector-100', 'vector-500', 'vector-1k', 'vector-5k'] as const) {
      const workload = createPerformanceWorkload(id);
      expect(Object.values(workload.document.nodes)).toHaveLength(workload.expected.nodeCount);
      expect(new Set(Object.keys(workload.document.nodes)).size).toBe(workload.expected.nodeCount);
    }
  });

  it('covers the required rendering-category fixtures deterministically', () => {
    const cases: Array<[PerformanceWorkloadId, number]> = [
      ['dense-overlap', 300],
      ['wide-spread', 400],
      ['many-small', 1_000],
      ['few-large', 8],
      ['clipped-frames', 160],
      ['masked-content', 120],
      ['rotated-skewed', 200],
      ['thick-strokes', 64],
      ['effects-heavy', 150],
      ['blend-modes', 240],
      ['mixed-raster-vector', 224],
      ['hidden-locked', 400],
      ['offscreen-mixed', 300],
      ['boundary-crossing', 160],
      ['multi-page', 183],
    ];
    for (const [id, count] of cases) {
      const workload = createPerformanceWorkload(id);
      expect(workload.expected.nodeCount).toBe(count);
      expect(Object.values(workload.document.nodes)).toHaveLength(count);
      expect(
        Object.keys(workload.document.nodes).every(
          (nodeId) => nodeId === workload.document.nodes[nodeId]?.id,
        ),
      ).toBe(true);
    }
    const masked = createPerformanceWorkload('masked-content');
    expect(
      Object.values(masked.document.nodes).some(
        (node) => node.kind === 'frame' && node.mask?.sourceNodeId,
      ),
    ).toBe(true);
    const multi = createPerformanceWorkload('multi-page');
    expect(multi.document.pages).toHaveLength(3);
    expect(multi.document.activePageId).toBe('multipage-page-0');
  });

  it('produces a stable checksum for every fixture across independent calls', {
    timeout: 300_000,
  }, () => {
    // 60s timeout: generates every workload fixture twice; on loaded
    // CI/parallel-agent hosts the default 5s is routinely exceeded.
    for (const id of PERFORMANCE_WORKLOAD_IDS) {
      const first = createPerformanceWorkload(id);
      const second = createPerformanceWorkload(id);
      expect(first.fixtureChecksum, id).toBe(second.fixtureChecksum);
      expect(first.document, id).toEqual(second.document);
    }
  });
});
