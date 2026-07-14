import { describe, it, expect } from 'vitest';
import { collectResources } from './resourceCollector';

describe('collectResources', () => {
  it('collects unique image srcs', () => {
    const nodes = [
      { fills: [{ type: 'image', image: { src: 'img1.png' } }] },
      { fills: [{ type: 'image', image: { src: 'img2.png' } }] },
      { fills: [{ type: 'image', image: { src: 'img1.png' } }] },
    ] as any[];
    const manifest = collectResources(nodes);
    expect(manifest.images).toHaveLength(2);
  });

  it('collects pattern tile srcs', () => {
    const nodes = [
      { fills: [{ type: 'pattern', pattern: { tileSrc: 'tile.png', spacing: 10 } }] },
    ] as any[];
    const manifest = collectResources(nodes);
    expect(manifest.patterns).toHaveLength(1);
    expect(manifest.images).toHaveLength(1);
    expect(manifest.patterns[0].tile_image_id).toBe(manifest.images[0].id);
  });

  it('skips invisible fills', () => {
    const nodes = [
      { fills: [{ type: 'image', visible: false, image: { src: 'hidden.png' } }] },
    ] as any[];
    const manifest = collectResources(nodes);
    expect(manifest.images).toHaveLength(0);
  });

  it('handles nodes without fills', () => {
    const nodes = [{ kind: 'shape', fills: null }] as any[];
    const manifest = collectResources(nodes);
    expect(manifest.images).toHaveLength(0);
    expect(manifest.patterns).toHaveLength(0);
  });
});
