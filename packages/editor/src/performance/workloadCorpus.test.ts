import { describe, expect, it } from 'vitest';
import {
  createPerformanceWorkload,
  createPerformanceWorkloadCorpus,
  PERFORMANCE_WORKLOAD_IDS,
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
    expect(createPerformanceWorkload('extreme-zoom').viewports).toHaveLength(3);
    expect(createPerformanceWorkload('document-switching').documentSequence).toHaveLength(3);
  });
});
