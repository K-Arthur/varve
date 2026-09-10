/**
 * Native table primitive: IR build passthrough and replay painting.
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { primitiveBounds, replayIr } from './replay';
import type { RenderItem, TableShape } from './types';

const tableShape: TableShape = {
  kind: 'table',
  x: 0,
  y: 0,
  w: 300,
  h: 120,
  cornerRadius: 4,
  borderColor: { space: 'rgb', r: 10, g: 10, b: 10, a: 255 },
  borderWidth: 1,
  dividerColor: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
  dividerWidth: 1,
  colPositions: [0, 150, 300],
  rowPositions: [0, 40, 120],
  cells: [
    {
      x: 0,
      y: 0,
      w: 150,
      h: 40,
      fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 255 },
      rowIdx: 0,
      columnIdx: 0,
      rowSpan: 1,
      columnSpan: 1,
      text: {
        lines: ['Header A'],
        fontSize: 13,
        fontFamily: 'Inter',
        fontWeight: 600,
        fontStyle: 'normal',
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        alignH: 'left',
        alignV: 'middle',
        padding: 8,
      },
    },
    {
      x: 150,
      y: 0,
      w: 150,
      h: 40,
      fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 255 },
      rowIdx: 0,
      columnIdx: 1,
      rowSpan: 1,
      columnSpan: 1,
    },
    {
      x: 0,
      y: 40,
      w: 150,
      h: 80,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      rowIdx: 1,
      columnIdx: 0,
      rowSpan: 1,
      columnSpan: 1,
    },
    {
      x: 150,
      y: 40,
      w: 150,
      h: 80,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      rowIdx: 1,
      columnIdx: 1,
      rowSpan: 1,
      columnSpan: 1,
    },
  ],
};

class Recorder {
  calls: string[] = [];
  font = '';
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  textAlign: CanvasTextAlign = 'start';
  lineWidth = 0;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  filter: string = 'none';
  lineDashOffset = 0;
  setLineDash(): void {}
  save(): void {
    this.calls.push('save');
  }
  restore(): void {
    this.calls.push('restore');
  }
  transform(): void {}
  translate(x?: number, y?: number): void {
    this.calls.push(`translate(${x ?? 0},${y ?? 0})`);
  }
  rotate(): void {}
  scale(): void {}
  beginPath(): void {
    this.calls.push('beginPath');
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`rect(${x},${y},${w},${h})`);
  }
  roundRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`roundRect(${x},${y},${w},${h})`);
  }
  ellipse(): void {}
  arc(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  fill(): void {
    this.calls.push('fill');
  }
  stroke(): void {
    this.calls.push('stroke');
  }
  closePath(): void {}
  clip(): void {
    this.calls.push('clip');
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect(${x},${y},${w},${h})`);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`strokeRect(${x},${y},${w},${h})`);
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push(`fillText("${text}",${x},${y})`);
  }
  canvas: { width: number; height: number } | undefined = undefined;
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  setTransform(): void {}
  drawImage(): void {}
  createLinearGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
  createRadialGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
  globalAlphaGet = 1;
  get globalAlphaValue(): number {
    return this.globalAlpha;
  }
}

function tableItem(): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    primitive: tableShape,
    opacity: 1,
    blendMode: 'normal',
  };
}

describe('table primitive IR build', () => {
  it('stub engine passes the compiled table shape through unchanged', async () => {
    const engine = await createEngine();
    const item = tableItem();
    const built = await engine.buildIr({
      nodes: [
        {
          id: 't1',
          name: 'Table',
          transform: [1, 0, 0, 1, 0, 0],
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          shape: tableShape,
          fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        },
      ],
    });
    expect(built[0]?.primitive.kind).toBe('table');
    const prim = built[0]?.primitive as TableShape;
    expect(prim.cells).toHaveLength(4);
    expect(prim.cells[0]?.text?.lines).toEqual(['Header A']);
    expect(prim.colPositions).toEqual([0, 150, 300]);
    void item;
  });

  it('primitiveBounds covers the table rect', () => {
    expect(primitiveBounds(tableShape)).toEqual({ x: 0, y: 0, w: 300, h: 120 });
  });
});

describe('table primitive replay', () => {
  it('paints cell fills, wrapped text, dividers, and the border', () => {
    const rec = new Recorder();
    replayIr(rec, [tableItem()]);
    const calls = rec.calls;
    // 4 cell fills + 2 inner dividers (1 vertical + 1 horizontal). Table-edge
    // positions are NOT painted as dividers (the outer border covers them),
    // and with no spans the fast path draws each divider as one full-length
    // rect — visually identical to the previous per-segment rendering.
    expect(calls.filter((c) => c.startsWith('fillRect(')).length).toBe(6);
    // Header text with middle vertical alignment
    const textCalls = calls.filter((c) => c.startsWith('fillText('));
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0]).toMatch(/Header A/);
    // Outer border stroke
    expect(calls.some((c) => c.startsWith('strokeRect(') || c === 'stroke')).toBe(true);
    // Clipped to the table bounds
    expect(calls.includes('clip')).toBe(true);
  });

  it('clips text to the padded cell rect', () => {
    const rec = new Recorder();
    replayIr(rec, [tableItem()]);
    // The text clip begins with the padded cell rect.
    const rectCalls = rec.calls.filter((c) => c.startsWith('rect('));
    expect(rectCalls.some((c) => c.includes('8,8,134,24') || c.includes('8,8'))).toBe(true);
  });

  it('skip painting when the table has zero size', () => {
    const rec = new Recorder();
    replayIr(rec, [{ ...tableItem(), primitive: { ...tableShape, w: 0, h: 0 } }]);
    expect(rec.calls.filter((c) => c.startsWith('fillRect(')).length).toBe(0);
  });

  it('suppresses dividers through merged cells only in the spanned rows', () => {
    // 2x2 table where the header row cells merge across both columns.
    const mergedShape: TableShape = {
      ...tableShape,
      cells: [
        {
          x: 0,
          y: 0,
          w: 300,
          h: 40,
          fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 255 },
          rowIdx: 0,
          columnIdx: 0,
          rowSpan: 1,
          columnSpan: 2,
        },
        {
          x: 0,
          y: 40,
          w: 150,
          h: 80,
          fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
          rowIdx: 1,
          columnIdx: 0,
          rowSpan: 1,
          columnSpan: 1,
        },
        {
          x: 150,
          y: 40,
          w: 150,
          h: 80,
          fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
          rowIdx: 1,
          columnIdx: 1,
          rowSpan: 1,
          columnSpan: 1,
        },
      ],
    };
    const rec = new Recorder();
    replayIr(rec, [{ ...tableItem(), primitive: mergedShape }]);
    const rects = rec.calls.filter((c) => c.startsWith('fillRect('));
    // The vertical divider at x=150 (drawn at 149.5, width 1) must appear
    // only in the body row band (y=40..120), NOT through the merged header
    // cell (y=0..40).
    expect(rects.some((c) => c.startsWith('fillRect(149.5,40,1,80)'))).toBe(true);
    expect(rects.some((c) => c.startsWith('fillRect(149.5,0,1,40)'))).toBe(false);
    // Horizontal divider still spans the full width in the unmerged band
    // (drawn as per-column segments).
    expect(rects.some((c) => c.startsWith('fillRect(0,39.5,150,1)'))).toBe(true);
    expect(rects.some((c) => c.startsWith('fillRect(150,39.5,150,1)'))).toBe(true);
    // Table-edge dividers (x=300 / y=120) are not painted — border covers them.
    expect(rects.some((c) => c.startsWith('fillRect(299.5'))).toBe(false);
  });

  it('paints rich scene content inside the cell, clipped to it', () => {
    const contentShape: TableShape = {
      ...tableShape,
      cells: [
        {
          ...tableShape.cells[0]!,
          content: {
            fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
            transform: [1, 0, 0, 1, 8, 8],
            opacity: 1,
            blendMode: 'normal',
            strokes: [],
            effects: [],
            primitive: { kind: 'rect', x: 0, y: 0, w: 134, h: 24 },
          },
        },
      ],
    };
    const rec = new Recorder();
    replayIr(rec, [{ ...tableItem(), primitive: contentShape }]);
    // The content item is replayed after a translate to the cell origin and
    // a clip to the padded cell rect: expect a translate and an extra clip.
    expect(rec.calls.some((c) => c.startsWith('translate(0,0)'))).toBe(true);
    expect(rec.calls.filter((c) => c === 'clip').length).toBeGreaterThanOrEqual(2);
  });
});
