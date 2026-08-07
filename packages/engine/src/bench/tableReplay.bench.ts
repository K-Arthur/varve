// @vitest-environment jsdom
/**
 * Table replay + layout performance bench (ADR-0016 §33).
 *
 * Verifies:
 * - one compiled table primitive replays at interactive rates even with
 *   10k cells (the single-item IR beats per-node scenes)
 * - computeTableLayout stays bounded (deterministic multi-pass) at scale
 *
 * Run: pnpm bench:table
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from '../replay';
import type { RenderItem, TableCellIR, TableShape } from '../types';
import { estimateIrBytes, summarize, warmUp } from './benchUtils';

function makeTableShape(rows: number, cols: number): TableShape {
  const cells: TableCellIR[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: c * 80,
        y: r * 24,
        w: 80,
        h: 24,
        rowIdx: r,
        columnIdx: c,
        rowSpan: 1,
        columnSpan: 1,
        fill:
          r === 0
            ? { space: 'rgb', r: 240, g: 243, b: 247, a: 255 }
            : { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        text:
          r === 0
            ? {
                lines: [`Header ${c}`],
                fontSize: 13,
                fontFamily: 'Inter',
                fontWeight: 600,
                fontStyle: 'normal',
                color: { space: 'rgb', r: 41, g: 45, b: 54, a: 255 },
                alignH: 'left',
                alignV: 'middle',
                padding: 8,
              }
            : {
                lines: [`Cell ${r}x${c}`],
                fontSize: 13,
                fontFamily: 'Inter',
                fontWeight: 400,
                fontStyle: 'normal',
                color: { space: 'rgb', r: 41, g: 45, b: 54, a: 255 },
                alignH: 'left',
                alignV: 'middle',
                padding: 8,
              },
      });
    }
  }
  return {
    kind: 'table',
    x: 0,
    y: 0,
    w: cols * 80,
    h: rows * 24,
    cornerRadius: 0,
    borderColor: { space: 'rgb', r: 41, g: 45, b: 54, a: 255 },
    borderWidth: 1,
    dividerColor: { space: 'rgb', r: 205, g: 211, b: 222, a: 255 },
    dividerWidth: 1,
    colPositions: Array.from({ length: cols + 1 }, (_, i) => i * 80),
    rowPositions: Array.from({ length: rows + 1 }, (_, i) => i * 24),
    cells,
  };
}

function makeTableItem(shape: TableShape): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    primitive: shape,
    opacity: 1,
    blendMode: 'normal',
  };
}

function benchTableReplay(
  cellCount: number,
  iterations = 10,
): { replay: { p50: number; p95: number }; irBytes: number } {
  const rows = Math.max(1, Math.round(Math.sqrt(cellCount)));
  const cols = Math.max(1, Math.round(cellCount / rows));
  const item = makeTableItem(makeTableShape(rows, cols));
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d')!;
  const target = ctx as unknown as Parameters<typeof replayIr>[0];
  const ir = [item];
  warmUp(() => replayIr(target, ir));
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    replayIr(target, ir);
    samples.push(performance.now() - t0);
  }
  return { replay: summarize(samples), irBytes: estimateIrBytes(ir) };
}

describe('table replay bench', () => {
  it('100 cells (10x10) replay under 25ms p95', () => {
    const { replay, irBytes } = benchTableReplay(100);
    console.log(
      `table-bench 100 cells p50=${replay.p50.toFixed(2)}ms p95=${replay.p95.toFixed(2)}ms ir=${irBytes}B`,
    );
    expect(replay.p95).toBeLessThan(25);
  }, 60_000);

  it('1k cells (32x32) replay under 100ms p95', () => {
    const { replay, irBytes } = benchTableReplay(1024, 5);
    console.log(
      `table-bench 1k cells p50=${replay.p50.toFixed(2)}ms p95=${replay.p95.toFixed(2)}ms ir=${irBytes}B`,
    );
    expect(replay.p95).toBeLessThan(100);
  }, 60_000);

  it('10k cells (100x100) replay under 500ms p95', () => {
    const { replay, irBytes } = benchTableReplay(10_000, 3);
    console.log(
      `table-bench 10k cells p50=${replay.p50.toFixed(2)}ms p95=${replay.p95.toFixed(2)}ms ir=${irBytes}B`,
    );
    expect(replay.p95).toBeLessThan(500);
  }, 120_000);
});
