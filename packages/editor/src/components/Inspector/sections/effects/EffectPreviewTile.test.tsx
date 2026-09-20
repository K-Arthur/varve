// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { Effect } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EffectPreviewTile } from './EffectPreviewTile';

afterEach(cleanup);

const BLACK = { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
const RED = { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 };
const BLUE = { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 };

function previewShape(effect: Effect): HTMLElement {
  render(<EffectPreviewTile effect={effect} label="Test" />);
  const tile = document.querySelector('.insp-preview-tile__shape');
  if (!(tile instanceof HTMLElement)) throw new Error('preview shape did not render');
  return tile;
}

describe('EffectPreviewTile — symbolic accuracy', () => {
  it('renders a drop shadow with its offsets, blur, spread, and opacity-scaled colour', () => {
    const shape = previewShape({
      type: 'dropShadow',
      x: 4,
      y: -2,
      blur: 8,
      spread: 1,
      color: BLACK,
      opacity: 0.5,
      blendMode: 'normal',
      visible: true,
    });
    expect(shape.style.boxShadow).toContain('4px -2px 8px 1px');
    expect(shape.style.boxShadow).toContain('rgba(0, 0, 0, 0.50)');
  });

  it('renders an inner glow as an inset shadow using blur as softness and spread as spread', () => {
    const shape = previewShape({
      type: 'innerGlow',
      blur: 12,
      spread: 3,
      color: RED,
      opacity: 1,
      blendMode: 'screen',
      visible: true,
    });
    expect(shape.style.boxShadow).toContain('inset 0 0 12px 3px');
  });

  it('renders both gradient endpoints for a gradient glow instead of a flat colour', () => {
    const shape = previewShape({
      type: 'outerGlow',
      blur: 10,
      spread: 0,
      colorMode: 'gradient',
      gradient: {
        stops: [
          { position: 0, color: RED },
          { position: 1, color: BLUE },
        ],
      },
      color: RED,
      opacity: 1,
      blendMode: 'screen',
      visible: true,
    });
    expect(shape.style.boxShadow).toContain('rgba(255, 0, 0');
    expect(shape.style.boxShadow).toContain('rgba(0, 0, 255');
  });

  it('uses the declared per-channel colours for RGB-split chromatic aberration', () => {
    const shape = previewShape({
      type: 'chromaticAberration',
      offsets: { redX: 3, redY: 0, greenX: 0, greenY: 0, blueX: -3, blueY: 0 },
      channelColors: { red: RED, green: BLUE, blue: BLUE },
      intensity: 1,
      opacity: 1,
      mix: 1,
      blendMode: 'normal',
      visible: true,
    });
    expect(shape.style.textShadow).toContain('rgba(255, 0, 0');
    expect(shape.style.textShadow).toContain('rgba(0, 0, 255');
  });

  it('uses contribution colours and offsets in custom colour-split mode', () => {
    const shape = previewShape({
      type: 'chromaticAberration',
      offsets: { redX: 3, redY: 0, greenX: 0, greenY: 0, blueX: -3, blueY: 0 },
      channelMode: 'custom',
      customChannels: [
        {
          enabled: true,
          source: 'red',
          color: BLUE,
          strength: 1,
          x: 5,
          y: 1,
        },
      ],
      intensity: 1,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    });
    expect(shape.style.textShadow).toContain('5px 1px');
    expect(shape.style.textShadow).toContain('rgba(0, 0, 255');
  });

  it('blurs the layer preview by the declared radius', () => {
    const shape = previewShape({ type: 'layerBlur', radius: 16, visible: true });
    expect(shape.style.filter).toBe('blur(8px)');
  });

  it('renders nothing visual for a bypassed effect', () => {
    const shape = previewShape({
      type: 'dropShadow',
      x: 4,
      y: 4,
      blur: 8,
      spread: 0,
      color: BLACK,
      opacity: 1,
      blendMode: 'normal',
      visible: false,
    });
    expect(shape.style.boxShadow).toBe('');
  });
});
