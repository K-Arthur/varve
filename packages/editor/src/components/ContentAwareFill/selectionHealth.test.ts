import { describe, expect, it } from 'vitest';
import {
  analyzeSelectionHealth,
  emptySelectionHealth,
  maskMatchesSourceGeometry,
} from './selectionHealth';

describe('analyzeSelectionHealth', () => {
  it('reports disconnected regions, bounds, and edge contact', () => {
    const mask = new Uint8Array(8 * 6);
    mask[0] = 255;
    mask[1] = 255;
    mask[4 * 8 + 6] = 255;
    mask[4 * 8 + 7] = 255;

    const health = analyzeSelectionHealth(mask, 8, 6, 'remove');

    expect(health.coveredPixels).toBe(4);
    expect(health.hardPixels).toBe(4);
    expect(health.componentCount).toBe(2);
    expect(health.largestComponentPixels).toBe(2);
    expect(health.bounds).toEqual({ x: 0, y: 0, width: 8, height: 5 });
    expect(health.touchesEdge).toBe(true);
    expect(health.blockingReason).toBeNull();
    expect(health.warnings).toEqual([
      'The mask contains 2 separate regions; verify each region is intentional.',
      'The mask touches the image edge; context is limited on that side.',
    ]);
  });

  it('blocks empty and tiny masks before inference', () => {
    expect(analyzeSelectionHealth(new Uint8Array(20 * 20), 20, 20, 'replace').blockingReason).toBe(
      'Select pixels to define the edit region.',
    );

    const tiny = new Uint8Array(20 * 20);
    tiny[10 * 20 + 10] = 255;
    expect(analyzeSelectionHealth(tiny, 20, 20, 'remove').blockingReason).toContain('too small');
  });

  it('warns on broad and soft masks without blocking valid coverage', () => {
    const mask = new Uint8Array(4 * 4).fill(64);
    mask[0] = 0;
    const health = analyzeSelectionHealth(mask, 4, 4, 'fill');

    expect(health.blockingReason).toBeNull();
    expect(health.coverage).toBe(15 / 16);
    expect(health.hardPixels).toBe(0);
    expect(health.warnings).toContain(
      'The mask covers almost the entire image; the model has little surrounding context.',
    );
    expect(health.warnings).toContain(
      'The mask contains only soft coverage; verify the visible overlay before generating.',
    );
  });

  it('blocks a near-full edit region so inference retains usable context', () => {
    const mask = new Uint8Array(20 * 20).fill(255);
    mask[0] = 0;

    const health = analyzeSelectionHealth(mask, 20, 20, 'remove');

    expect(health.coverage).toBe(399 / 400);
    expect(health.blockingReason).toBe(
      'The edit region covers nearly the entire image; leave surrounding context or use Expand.',
    );
    expect(health.warnings).toContain(
      'The mask covers almost the entire image; the model has little surrounding context.',
    );
  });

  it('allows expansion to use its explicit output padding without a source mask', () => {
    const health = emptySelectionHealth('expand');
    expect(health.coveredPixels).toBe(0);
    expect(health.blockingReason).toBeNull();
  });

  it('rejects masks from a different crop while allowing rounded previews', () => {
    expect(maskMatchesSourceGeometry(160, 90, 16, 9)).toBe(true);
    expect(maskMatchesSourceGeometry(100, 100, 16, 9)).toBe(false);
  });
});
