/**
 * Tests for image fill modes (fit, fill, stretch, tile) in replay.
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import type { FillIR, RenderItem } from './types';

function makeRecorder(): {
  calls: string[];
  filter: string;
  drawImage: (image: string, dx: number, dy: number, dw: number, dh: number) => void;
  target: Parameters<typeof replayIr>[0];
} {
  const calls: string[] = [];
  let filter = 'none';
  return {
    calls,
    get filter() {
      return filter;
    },
    set filter(v: string) {
      filter = v;
    },
    drawImage: (image: string, dx: number, dy: number, dw: number, dh: number) => {
      calls.push(`drawImage ${image} ${dx.toFixed(1)} ${dy.toFixed(1)} ${dw.toFixed(1)} ${dh.toFixed(1)}`);
    },
    target: {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      transform: () => calls.push('transform'),
      fillRect: () => calls.push('fillRect'),
      strokeRect: () => calls.push('strokeRect'),
      beginPath: () => calls.push('beginPath'),
      rect: () => calls.push('rect'),
      clip: () => calls.push('clip'),
      ellipse: () => calls.push('ellipse'),
      arc: () => calls.push('arc'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      bezierCurveTo: () => calls.push('bezierCurveTo'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
      closePath: () => calls.push('closePath'),
      fillText: () => calls.push('fillText'),
      font: '10px sans-serif',
      textBaseline: 'alphabetic',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      textAlign: 'left',
      strokeStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      get filter() {
        return filter;
      },
      set filter(v: string) {
        filter = v;
      },
      lineDashOffset: 0,
      setLineDash: () => calls.push('setLineDash'),
      drawImage: (image: string, dx: number, dy: number, dw: number, dh: number) => {
        calls.push(`drawImage ${image} ${dx.toFixed(1)} ${dy.toFixed(1)} ${dw.toFixed(1)} ${dh.toFixed(1)}`);
      },
    },
  };
}

function imageFill(overrides: Omit<Extract<FillIR, { type: 'image' }>, 'opacity' | 'blendMode' | 'visible'>): FillIR {
  return { opacity: 1, blendMode: 'normal', visible: true, ...overrides } as FillIR;
}

function rectItem(w: number, h: number, fill: FillIR): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: [0, 0, 0, 255],
    fills: [fill],
    primitive: { kind: 'rect', x: 0, y: 0, w, h },
    opacity: 1,
    blendMode: 'normal',
  };
}

describe('image fill modes', () => {
  it('stretch fills the whole primitive bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [rectItem(100, 50, imageFill({ type: 'image', src: 'img1', fit: 'stretch', x: 0, y: 0, scale: 1 }))]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
    expect(draw[0]).toBe('drawImage img1 0.0 0.0 100.0 50.0');
  });

  it('fit keeps aspect ratio inside bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(100, 50, imageFill({ type: 'image', src: 'img2', fit: 'fit', x: 0, y: 0, scale: 1, imageWidth: 200, imageHeight: 100 })),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
    // 200x100 image aspect 2:1 fits in 100x50 => exactly 100x50
    expect(draw[0]).toBe('drawImage img2 0.0 0.0 100.0 50.0');
  });

  it('fit letterboxes when aspect differs', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(100, 100, imageFill({ type: 'image', src: 'img3', fit: 'fit', x: 0, y: 0, scale: 1, imageWidth: 200, imageHeight: 100 })),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw[0]).toBe('drawImage img3 0.0 25.0 100.0 50.0');
  });

  it('fill crops to cover bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(100, 100, imageFill({ type: 'image', src: 'img4', fit: 'fill', x: 0, y: 0, scale: 1, imageWidth: 200, imageHeight: 100 })),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    // 200x100 image fills 100x100 -> width 100, height 50, centered vertically? No, aspect 2:1, bounds 1:1 -> height = bounds.h = 100, width = 200
    expect(draw[0]).toBe('drawImage img4 -50.0 0.0 200.0 100.0');
  });

  it('tile repeats image across bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(100, 100, imageFill({ type: 'image', src: 'img5', fit: 'tile', x: 0, y: 0, scale: 1, imageWidth: 40, imageHeight: 40 })),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    // 100x100 bounds / 40x40 tiles = 3x3 grid = 9 draws (with some overhang)
    expect(draw.length).toBe(9);
    expect(draw[0]).toBe('drawImage img5 0.0 0.0 40.0 40.0');
  });

  it('applies image scale', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(100, 100, imageFill({ type: 'image', src: 'img6', fit: 'fit', x: 0, y: 0, scale: 2, imageWidth: 50, imageHeight: 50 })),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    // 50x50 * scale 2 = 100x100, fits exactly in 100x100
    expect(draw[0]).toBe('drawImage img6 0.0 0.0 100.0 100.0');
  });
});
