/**
 * Tests for replayIr — particularly the text rendering case not covered by
 * the existing engine.test.ts (which tests the stub engine, not replayIr).
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import type { ReplayTarget } from './replay';
import type { RenderItem } from './types';

/**
 * Recorder that implements ReplayTarget to capture calls.
 * Used instead of a real Canvas2D context (which requires jsdom + HTMLCanvasElement shim).
 */
class Recorder implements ReplayTarget {
  public calls: string[] = [];
  save() {
    this.calls.push('save');
  }
  restore() {
    this.calls.push('restore');
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.calls.push(`transform(${a},${b},${c},${d},${e},${f})`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`fillRect(${x},${y},${w},${h})`);
  }
  beginPath() {
    this.calls.push('beginPath');
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number) {
    this.calls.push(`ellipse(${x},${y},${rx},${ry},${rot},${start},${end})`);
  }
  arc(x: number, y: number, r: number, start: number, end: number) {
    this.calls.push(`arc(${x},${y},${r},${start},${end})`);
  }
  moveTo(x: number, y: number) {
    this.calls.push(`moveTo(${x},${y})`);
  }
  lineTo(x: number, y: number) {
    this.calls.push(`lineTo(${x},${y})`);
  }
  fill() {
    this.calls.push('fill');
  }
  stroke() {
    this.calls.push('stroke');
  }
  closePath() {
    this.calls.push('closePath');
  }
  fillStyle: string = '';
  lineWidth: number = 1;
  lineCap: CanvasLineCap = 'round';
  font: string = '';
  textAlign: CanvasTextAlign = 'left';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  fillText(text: string, x: number, y: number) {
    this.calls.push(`fillText("${text}",${x},${y})`);
  }
}

describe('replayIr', () => {
  it('renders text primitive with correct font settings', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 10, 20] as const,
        fill: [0, 0, 0, 255] as const,
        primitive: {
          kind: 'text',
          text: 'Hello',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
        },
      },
    ];
    const recorder = new Recorder();
    replayIr(recorder, items);

    expect(recorder.font).toContain('400');
    expect(recorder.font).toContain('16px');
    expect(recorder.font).toContain('"Inter"');
    expect(recorder.textAlign).toBe('left');
    expect(recorder.textBaseline).toBe('top');
    expect(recorder.calls).toContain('fillText("Hello",0,0)');
    expect(recorder.calls).toContain('save');
    expect(recorder.calls).toContain('restore');
  });

  it('renders italic text with correct font prefix', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: [0, 0, 0, 255] as const,
        primitive: {
          kind: 'text',
          text: 'Italic',
          fontSize: 20,
          fontFamily: 'Serif',
          fontWeight: 700,
          fontStyle: 'italic' as const,
          textAlign: 'center' as const,
        },
      },
    ];
    const recorder = new Recorder();
    replayIr(recorder, items);
    expect(recorder.font).toMatch(/^italic /);
  });

  it('handles empty string text gracefully', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: [0, 0, 0, 255] as const,
        primitive: {
          kind: 'text',
          text: '',
          fontSize: 12,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
        },
      },
    ];
    const recorder = new Recorder();
    expect(() => replayIr(recorder, items)).not.toThrow();
    expect(recorder.calls).toContain('fillText("",0,0)');
  });

  it('clamps fontWeight to valid CSS range', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: [0, 0, 0, 255] as const,
        primitive: {
          kind: 'text',
          text: 'test',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 9999,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
        },
      },
    ];
    const recorder = new Recorder();
    replayIr(recorder, items);
    // Clamped to 1000
    expect(recorder.font).toContain('1000');
  });
});
