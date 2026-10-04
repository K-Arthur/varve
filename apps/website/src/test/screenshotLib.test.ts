import { describe, expect, it } from 'vitest';
import { getScene, sceneFitStyle, sceneKind, scenePicture } from '../lib/screenshot';

/**
 * The website's fit policy, in isolation.
 *
 * The regression this locks in: one shared `aspect-ratio: 4/3;
 * object-fit: cover` used to be applied to every detail crop, which cut a
 * portrait layer-panel crop down to a landscape window. Fit is now derived
 * from the scene's captured kind, and a scene is never displayed larger than
 * its own pixels.
 */

const scene = (
  overrides: Partial<Parameters<typeof sceneKind>[0]> & {
    file: string;
    width: number;
    height: number;
  },
) => ({
  alt: 'A captured scene for testing the fit policy',
  caption: 'A caption',
  theme: 'light' as const,
  status: 'captured' as const,
  ...overrides,
});

describe('screenshot fit policy', () => {
  it('caps a panel crop at its intrinsic width so it is never upscaled', () => {
    const panel = scene({ file: 'panel.png', width: 320, height: 722, kind: 'panel' });
    expect(sceneFitStyle(panel)).toContain('max-width: 320px');
    const attributes = scenePicture(panel);
    expect(attributes.width).toBe(320);
    expect(attributes.height).toBe(722);
    expect(attributes.src).toBe('/screenshots/panel.png');
  });

  it('lets full and detail scenes fill their column at their own ratio', () => {
    for (const kind of ['full', 'detail', 'wide'] as const) {
      const shot = scene({ file: `${kind}.png`, width: 832, height: 620, kind });
      expect(sceneFitStyle(shot)).toBe('width: 100%;');
    }
  });

  it('contains full scene pixels in a shared card frame without cropping or upscaling panels', () => {
    const full = scene({ file: 'detail.png', width: 832, height: 701, kind: 'detail' });
    const panel = scene({ file: 'layers.png', width: 317, height: 539, kind: 'panel' });

    expect(sceneFitStyle(full, 'contain')).toBe(
      'position: absolute; inset: 0; width: 100%; height: 100%; max-width: 100%; object-fit: contain;',
    );
    expect(sceneFitStyle(panel, 'contain')).toBe(
      'position: absolute; inset: 0; width: 100%; height: 100%; max-width: min(100%, 317px); object-fit: contain;',
    );
  });

  it('defaults a scene with no recorded kind to a full frame', () => {
    expect(sceneKind(scene({ file: 'unknown.png', width: 1440, height: 900 }))).toBe('full');
  });

  it('builds srcset from real variants and never from guesswork', () => {
    const withVariants = scene({
      file: 'wide.png',
      width: 1440,
      height: 900,
      kind: 'full',
      variants: [{ file: 'wide-720.webp', width: 720, height: 450 }],
    });
    const attributes = scenePicture(withVariants, { sizes: '50vw' });
    expect(attributes.srcset).toBe('/screenshots/wide-720.webp 720w, /screenshots/wide.png 1440w');
    expect(attributes.sizes).toBe('50vw');

    const withoutVariants = scene({ file: 'plain.png', width: 1440, height: 900, kind: 'full' });
    const plain = scenePicture(withoutVariants);
    // No variants: one file, no srcset, so the browser downloads exactly one.
    expect(plain.srcset).toBeUndefined();
    expect(plain.sizes).toBeUndefined();
    expect(plain.src).toBe('/screenshots/plain.png');
  });

  it('drops a variant that is larger than the source rather than offering an upscale', () => {
    const oversized = scene({
      file: 'small.png',
      width: 320,
      height: 380,
      kind: 'panel',
      variants: [{ file: 'small-1440.webp', width: 1440, height: 1710 }],
    });
    const attributes = scenePicture(oversized);
    expect(attributes.srcset).toBeUndefined();
  });

  it('resolves only captured scenes by id', () => {
    expect(getScene('workspace')).not.toBeNull();
    expect(getScene('definitely-not-a-scene')).toBeNull();
  });
});
