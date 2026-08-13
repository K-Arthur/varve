/**
 * Page-level print geometry resolution (M12, ADR-0190).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { createDocument } from '../document';
import {
  documentBleedMm,
  pageBleedBoundsInWorld,
  pageBleedInsetsPx,
  resolvePagePrintGeometry,
  updateBleedEdge,
} from '../printGeometry';

function docWithDefaults(): Document {
  return {
    ...createDocument('print-geometry', false),
    bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' },
  };
}

describe('resolvePagePrintGeometry (M12)', () => {
  it('inherits document bleed defaults when the page has no override', () => {
    const doc = docWithDefaults();
    const resolved = resolvePagePrintGeometry(doc, doc.pages![0]!.id);
    expect(resolved.bleed).toMatchObject({
      top: (3 * 96) / 25.4,
      right: (3 * 96) / 25.4,
      bottom: (3 * 96) / 25.4,
      left: (3 * 96) / 25.4,
    });
  });

  it('unconfigured documents resolve to zero bleed (application default)', () => {
    const doc = createDocument('print-geometry', false);
    const resolved = resolvePagePrintGeometry(doc, doc.pages![0]!.id);
    expect(resolved.bleed.top).toBe(0);
    expect(resolved.bleed.right).toBe(0);
    expect(resolved.bleed.bottom).toBe(0);
    expect(resolved.bleed.left).toBe(0);
  });

  it('clamps negative bleed to zero (D5)', () => {
    const doc: Document = {
      ...createDocument('print-geometry', false),
      bleed: { top: -3, right: 0, bottom: 3, left: 3, linked: false, unit: 'mm' },
    };
    const resolved = resolvePagePrintGeometry(doc, doc.pages![0]!.id);
    expect(resolved.bleed.top).toBe(0);
  });

  it('page overrides win per-edge and per-config', () => {
    let doc = docWithDefaults();
    const page = doc.pages![0]!;
    doc = {
      ...doc,
      pages: [
        { ...page, bleed: { top: 10, right: 3, bottom: 3, left: 3, linked: false, unit: 'px' } },
      ],
    };
    const resolved = resolvePagePrintGeometry(doc, page.id);
    // The page override is a full config in px — all edges win over the
    // document's mm defaults.
    expect(resolved.bleed.top).toBeCloseTo(10, 5);
    expect(resolved.bleed.left).toBeCloseTo(3, 5);
  });

  it('converts inherited edges before merging a partial override in another unit', () => {
    const base = docWithDefaults();
    const page = base.pages![0]!;
    const doc: Document = {
      ...base,
      pages: [{ ...page, bleed: { top: 1, unit: 'in' } }],
    };
    const resolved = resolvePagePrintGeometry(doc, page.id);
    expect(resolved.bleed.unit).toBe('in');
    expect(resolved.bleed.top).toBeCloseTo(96, 5);
    expect(resolved.bleed.right).toBeCloseTo((3 / 25.4) * 96, 5);
  });

  it('resolves safe area and slug defaults', () => {
    const doc = docWithDefaults();
    const resolved = resolvePagePrintGeometry(doc, doc.pages![0]!.id);
    expect(resolved.safeArea.enabled).toBe(false);
    expect(resolved.slug.enabled).toBe(false);
    expect(resolved.slug.top).toBe(0);
  });

  it('applies page safe area and slug overrides', () => {
    let doc = docWithDefaults();
    const page = doc.pages![0]!;
    doc = {
      ...doc,
      pages: [
        {
          ...page,
          safeArea: { top: 5, right: 5, bottom: 5, left: 5, unit: 'mm', enabled: true },
          slug: { top: 12, right: 0, bottom: 0, left: 0, unit: 'mm', enabled: true },
        },
      ],
    };
    const resolved = resolvePagePrintGeometry(doc, page.id);
    expect(resolved.safeArea.enabled).toBe(true);
    expect(resolved.safeArea.top).toBeCloseTo((5 * 96) / 25.4, 5);
    expect(resolved.slug.enabled).toBe(true);
    expect(resolved.slug.top).toBeCloseTo((12 * 96) / 25.4, 5);
  });
});

describe('canonical bleed geometry (pageBleedBoundsInWorld / pageBleedInsetsPx)', () => {
  it('expands trim by per-edge bleed at a given origin (uniform mm)', () => {
    const doc = docWithDefaults();
    const pageId = doc.pages![0]!.id;
    const insets = pageBleedInsetsPx(doc, pageId);
    const b3 = (3 * 96) / 25.4;
    expect(insets.top).toBeCloseTo(b3, 5);
    expect(insets.left).toBeCloseTo(b3, 5);

    const bounds = pageBleedBoundsInWorld(doc, pageId, { x: 100, y: 200 })!;
    expect(bounds.x).toBeCloseTo(100 - b3, 5);
    expect(bounds.y).toBeCloseTo(200 - b3, 5);
    expect(bounds.width).toBeCloseTo(1920 + 2 * b3, 5);
    expect(bounds.height).toBeCloseTo(1080 + 2 * b3, 5);
  });

  it('handles per-edge override and negative origins', () => {
    let doc = docWithDefaults();
    const page = doc.pages![0]!;
    doc = {
      ...doc,
      pages: [
        { ...page, bleed: { top: 5, right: 2, bottom: 0, left: 8, linked: false, unit: 'mm' } },
      ],
    };
    const pageId = page.id;
    const bounds = pageBleedBoundsInWorld(doc, pageId, { x: -1000, y: -500 })!;
    const mm = (v: number) => (v * 96) / 25.4;
    expect(bounds.x).toBeCloseTo(-1000 - mm(8), 5);
    expect(bounds.y).toBeCloseTo(-500 - mm(5), 5);
    expect(bounds.width).toBeCloseTo(1920 + mm(2) + mm(8), 5);
    expect(bounds.height).toBeCloseTo(1080 + mm(5), 5);
  });

  it('zero bleed equals the trim rect (no phantom region)', () => {
    const doc = createDocument('print-geometry', false);
    const pageId = doc.pages![0]!.id;
    const bounds = pageBleedBoundsInWorld(doc, pageId, { x: 0, y: 0 })!;
    expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('documentBleedMm reports the document default in millimetres', () => {
    const doc = docWithDefaults();
    expect(documentBleedMm(doc)).toBeCloseTo(3, 5);
    const noBleed = createDocument('print-geometry', false);
    expect(documentBleedMm(noBleed)).toBe(0);
  });

  it('updates linked edges in the authored unit and normalizes invalid values', () => {
    const linked = { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' as const };
    expect(updateBleedEdge(linked, 'top', 0.125)).toEqual({
      top: 0.125,
      right: 0.125,
      bottom: 0.125,
      left: 0.125,
      linked: true,
      unit: 'mm',
    });
    expect(updateBleedEdge({ ...linked, linked: false }, 'left', Number.NaN).left).toBe(0);
    expect(updateBleedEdge({ ...linked, linked: false }, 'right', -2).right).toBe(0);
  });
});
