import { describe, expect, it } from 'vitest';
import {
  generateSyntheticFixtureImage,
  getSyntheticFixtures,
} from '../imageQuality/corpusManifest';
import { evaluateFixture } from '../imageQuality/evaluator';

describe('quality corpus', () => {
  describe('synthetic fixtures manifest', () => {
    const fixtures = getSyntheticFixtures();

    it('has at least 8 fixtures', () => {
      expect(fixtures.length).toBeGreaterThanOrEqual(8);
    });

    it('every fixture has required fields', () => {
      for (const f of fixtures) {
        expect(f.id).toBeTruthy();
        expect(f.category).toBeTruthy();
        expect(f.inputPath).toBeTruthy();
        expect(f.licenceId).toBeTruthy();
        expect(f.alphaMode).toMatch(/^(opaque|binary|partial)$/);
        expect(f.expectedScale).toBeGreaterThan(0);
        expect(f.recommendedModes.length).toBeGreaterThan(0);
      }
    });

    it('covers all categories', () => {
      const categories = new Set(fixtures.map((f) => f.category));
      expect(categories.has('synthetic-diagnostic')).toBe(true);
      expect(categories.has('transparency')).toBe(true);
    });

    it('all fixture IDs are unique', () => {
      const ids = fixtures.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('synthetic fixture generation', () => {
    it('generates checkerboard', () => {
      const img = generateSyntheticFixtureImage('synthetic:checkerboard-64');
      expect(img).not.toBeNull();
      expect(img!.width).toBe(64);
      expect(img!.height).toBe(64);
    });

    it('generates gradient', () => {
      const img = generateSyntheticFixtureImage('synthetic:gradient-64');
      expect(img).not.toBeNull();
      expect(img!.width).toBe(64);
      expect(img!.height).toBe(64);
    });

    it('generates alpha ramp', () => {
      const img = generateSyntheticFixtureImage('synthetic:alpha-ramp-32');
      expect(img).not.toBeNull();
      expect(img!.width).toBe(32);
      expect(img!.height).toBe(32);
    });

    it('returns null for unknown fixture', () => {
      expect(generateSyntheticFixtureImage('unknown')).toBeNull();
    });
  });

  describe('quality evaluation', () => {
    it('evaluates synthetic fixtures with CPU algorithms', async () => {
      const fixtures = getSyntheticFixtures().slice(0, 3);
      const results = await Promise.all(
        fixtures.map((f) =>
          evaluateFixture(f, {
            algorithms: [
              { name: 'nearest-2x', type: 'cpu', scale: 2 },
              { name: 'bilinear-2x', type: 'cpu', scale: 2 },
              { name: 'bicubic-2x', type: 'cpu', scale: 2 },
            ],
          }),
        ),
      );

      for (const fixtureResults of results) {
        for (const r of fixtureResults) {
          expect(r.dimensionsMatch).toBe(true);
          expect(r.hasNanPixels).toBe(false);
        }
      }
    });

    it('evaluates pixel-art fixtures', async () => {
      const pixelArtFixture = getSyntheticFixtures().find(
        (f) => f.id === 'synth-single-pixel-lines-64',
      );
      if (!pixelArtFixture) return;

      const results = await evaluateFixture(pixelArtFixture, {
        algorithms: [
          { name: 'epx-4x', type: 'pixel-art', scale: 4, pixelArtAlgo: 'epx' },
          { name: 'hqx-4x', type: 'pixel-art', scale: 4, pixelArtAlgo: 'hqx' },
          { name: 'xbr-4x', type: 'pixel-art', scale: 4, pixelArtAlgo: 'xbr' },
        ],
      });

      for (const r of results) {
        expect(r.dimensionsMatch).toBe(true);
        expect(r.hasNanPixels).toBe(false);
      }
    });
  });
});
