/**
 * Page decorations (ADR-0144): shadows, trim fills, active-page accent and
 * labels paint for every visible page in viewport order, on the content
 * canvas between the board fill and content replay.
 */
import type { Document, NodeId } from '@varve/scene';
import { addPage, createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { drawPageDecorations, PAGE_LABEL_BAND } from '../pageDecorations';

interface RecordedCall {
  type: 'fillRect' | 'strokeRect' | 'fillText' | 'save' | 'restore';
  args: number[];
  style?: string;
}

function mockCtx() {
  const calls: RecordedCall[] = [];
  const ctx = {
    save: vi.fn(() => calls.push({ type: 'save', args: [] })),
    restore: vi.fn(() => calls.push({ type: 'restore', args: [] })),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) =>
      calls.push({ type: 'fillRect', args: [x, y, w, h], style: ctx.fillStyle as string }),
    ),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) =>
      calls.push({ type: 'strokeRect', args: [x, y, w, h], style: ctx.strokeStyle as string }),
    ),
    fillText: vi.fn((_text: string, x: number, y: number) =>
      calls.push({ type: 'fillText', args: [x, y] }),
    ),
    fillStyle: '',
    strokeStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  return { ctx, calls };
}

function twoPageDoc(): { doc: Document; pages: NodeId[] } {
  let doc = createDocument('decor', false);
  doc = addPage(doc, {});
  doc = {
    ...doc,
    pages: doc.pages!.map((p, i) => ({
      ...p,
      placement: { x: i * 400, y: i * 200 },
    })),
  };
  return { doc, pages: doc.pages!.map((p) => p.id) };
}

describe('drawPageDecorations (ADR-0144)', () => {
  it('fills and strokes every page in viewport order, then labels them', () => {
    const { ctx, calls } = mockCtx();
    const { doc } = twoPageDoc();
    const camera = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    drawPageDecorations(
      ctx as unknown as CanvasRenderingContext2D,
      doc,
      camera,
      {
        width: 2000,
        height: 2000,
      },
      { themeRevision: 1 },
    );

    const fills = calls.filter((c) => c.type === 'fillRect' && c.args[2] === 1920);
    expect(fills.length).toBe(2);
    expect(fills[0]!.args.slice(0, 2)).toEqual([0, 0]);
    expect(fills[1]!.args.slice(0, 2)).toEqual([400, 200]);

    const labels = calls.filter((c) => c.type === 'fillText');
    expect(labels.length).toBe(2);
    // Label sits in the band below the page trim.
    expect(labels[0]!.args[1]).toBe(0 + 1080 + 6);
    expect(labels[1]!.args[1]).toBe(200 + 1080 + 6);
  });

  it('culls pages outside the viewport', () => {
    const { ctx, calls } = mockCtx();
    const { doc } = twoPageDoc();
    const camera = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    drawPageDecorations(
      ctx as unknown as CanvasRenderingContext2D,
      doc,
      camera,
      {
        width: 100,
        height: 100,
      },
      { themeRevision: 1 },
    );
    const fills = calls.filter((c) => c.type === 'fillRect' && c.args[2] === 1920);
    expect(fills.length).toBe(1);
    expect(fills[0]!.args.slice(0, 2)).toEqual([0, 0]);
  });

  it('draws the active-page accent ring around the active page only', () => {
    const { ctx, calls } = mockCtx();
    const { doc, pages } = twoPageDoc();
    const camera = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    drawPageDecorations(
      ctx as unknown as CanvasRenderingContext2D,
      doc,
      camera,
      {
        width: 2000,
        height: 2000,
      },
      { themeRevision: 1, activePageId: pages[1]! },
    );

    const rings = calls.filter(
      (c) => c.type === 'strokeRect' && c.args[2] === 1920 + 2 && c.args[3] === 1080 + 2,
    );
    expect(rings.length).toBe(1);
    expect(rings[0]!.args.slice(0, 2)).toEqual([400 - 1, 200 - 1]);
  });

  it('exposes the label band constant for dirty-region expansion', () => {
    expect(PAGE_LABEL_BAND).toBeGreaterThan(0);
    expect(Number.isFinite(PAGE_LABEL_BAND)).toBe(true);
  });
});
