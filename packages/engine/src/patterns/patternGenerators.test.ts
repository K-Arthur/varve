// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generatePattern } from './patternGenerators';

describe('generatePattern', () => {
  it('generates a checkerboard data URL', () => {
    const url = generatePattern('checkerboard', {
      tileSize: 32,
      color1: '#ffffff',
      color2: '#000000',
    });
    expect(url).toMatch(/^data:image\/png/);
  });

  it('generates stripes data URL', () => {
    const url = generatePattern('stripes', {
      tileSize: 32,
      color1: '#ffffff',
      color2: '#000000',
      angle: 45,
      density: 0.5,
    });
    expect(url).toMatch(/^data:image\/png/);
  });

  it('generates polka dots data URL', () => {
    const url = generatePattern('polka-dots', {
      tileSize: 32,
      color1: '#ffffff',
      color2: '#000000',
      density: 0.3,
    });
    expect(url).toMatch(/^data:image\/png/);
  });

  it('generates crosshatch data URL', () => {
    const url = generatePattern('crosshatch', {
      tileSize: 32,
      color1: '#ffffff',
      color2: '#000000',
      density: 0.5,
    });
    expect(url).toMatch(/^data:image\/png/);
  });

  it('generates hex grid data URL', () => {
    const url = generatePattern('hex-grid', {
      tileSize: 32,
      color1: '#ffffff',
      color2: '#000000',
      gap: 2,
    });
    expect(url).toMatch(/^data:image\/png/);
  });

  it('is deterministic with same seed', () => {
    const a = generatePattern('polka-dots', {
      tileSize: 64,
      color1: '#ffffff',
      color2: '#000000',
      density: 0.4,
      seed: 42,
    });
    const b = generatePattern('polka-dots', {
      tileSize: 64,
      color1: '#ffffff',
      color2: '#000000',
      density: 0.4,
      seed: 42,
    });
    expect(a).toBe(b);
  });

  it('clamps tile size to valid range', () => {
    const url = generatePattern('checkerboard', {
      tileSize: 512,
      color1: '#fff',
      color2: '#000',
    });
    expect(url).toMatch(/^data:image\/png/);

    const urlSmall = generatePattern('checkerboard', {
      tileSize: 4,
      color1: '#fff',
      color2: '#000',
    });
    expect(urlSmall).toMatch(/^data:image\/png/);
  });
});
