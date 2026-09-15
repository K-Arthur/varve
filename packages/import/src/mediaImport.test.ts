/**
 * Animated-media import acceptance: the animated-GIF rejection is lifted;
 * animated GIF/APNG/WebP import as animated assets with probed metadata,
 * static variants stay static.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectImageSource } from './image';
import { importFile } from './import';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../engine/src/media/__fixtures__',
);

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

describe('animated media import', () => {
  it('imports an animated GIF with probed metadata and an asset reference', () => {
    const result = importFile('basic.gif', fixture('gif-basic.gif'), { embedImages: true });
    expect(result.document.assets).toBeDefined();
    const asset = Object.values(result.document.assets!)[0];
    expect(asset?.animated).toMatchObject({
      kind: 'gif',
      frameCount: 3,
      width: 64,
      height: 64,
      loopCount: 'infinite',
      durationMs: 160,
    });
    expect(asset?.animated?.frames.map((f) => f.durationMs)).toEqual([40, 100, 20]);
    // the node references the asset and the fill is a rect sized to the canvas
    const node = result.document.nodes[result.nodeIds[0]!];
    const fill = node?.fills?.[0];
    expect(fill?.type).toBe('image');
    expect(fill?.image?.assetId).toBe(asset?.id);
    expect(fill?.image?.imageWidth).toBe(64);
    expect(fill?.image?.imageHeight).toBe(64);
  });

  it('imports APNG and animated WebP as animated assets', () => {
    const apng = importFile('basic.png', fixture('apng-basic.png'), { embedImages: true });
    expect(Object.values(apng.document.assets!)[0]?.animated?.kind).toBe('apng');
    expect(Object.values(apng.document.assets!)[0]?.animated?.frameCount).toBe(3);

    const webp = importFile('anim.webp', fixture('webp-animated.webp'), { embedImages: true });
    expect(Object.values(webp.document.assets!)[0]?.animated?.kind).toBe('webp');
    expect(Object.values(webp.document.assets!)[0]?.animated?.frames).toHaveLength(3);
  });

  it('static variants import as static, with no animated block', () => {
    for (const name of ['gif-single.gif', 'apng-single.png', 'webp-static.webp']) {
      const result = importFile(name, fixture(name), { embedImages: true });
      const asset = Object.values(result.document.assets!)[0];
      expect(asset?.animated).toBeUndefined();
      expect(inspectImageSource(fixture(name)).animated).toBeUndefined();
    }
  });
});
