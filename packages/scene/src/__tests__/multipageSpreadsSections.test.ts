/**
 * Milestone 4 tests: spread topology hardening (ADR-0128/0129) and the
 * section numbering resolver (ADR-0131).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import {
  addPage,
  createDocument,
  getFormattedPageNumber,
  getPageNumber,
  getPageSide,
  rebuildSpreads,
  setFacingPagesEnabled,
  spreadsFromProjection,
} from '../document';
import { computePageNumbering, getPageNumbering } from '../pageNumbering';
import { projectSpreads } from '../pasteboardLayout';
import type { PageNumberStyle } from '../types';

function docWithPages(count: number, facing = false): Document {
  let doc = createDocument('m4', false);
  for (let i = 1; i < count; i++) doc = addPage(doc);
  if (facing) doc = { ...doc, facingPages: { enabled: true, startOnRight: true } };
  return doc;
}

// ── Spread topology ───────────────────────────────────────────────────────────

describe('Spread topology (ADR-0128/0129)', () => {
  it('derived projection uses stable ids and correct kinds', () => {
    const doc = docWithPages(5, true);
    const spreads = spreadsFromProjection(doc);
    expect(spreads[0]!.id).toBe('spread-0');
    expect(spreads[1]!.id).toBe('spread-1');
    expect(spreads[0]!.kind).toBe('single');
    expect(spreads[1]!.kind).toBe('facing');
    expect(spreads[0]!.pageIds).toEqual([doc.pages![0]!.id]);
    expect(spreads[1]!.pageIds).toEqual([doc.pages![1]!.id, doc.pages![2]!.id]);
  });

  it('projectSpreads and spreadsFromProjection agree', () => {
    const doc = docWithPages(6, true);
    const slots = projectSpreads(doc);
    const spreads = spreadsFromProjection(doc);
    expect(spreads.length).toBe(slots.length);
    for (let i = 0; i < spreads.length; i++) {
      expect(spreads[i]!.pageIds).toEqual(slots[i]!.map((s) => s.pageId));
    }
  });

  it('spreads match between single-page and facing modes', () => {
    const doc = docWithPages(3);
    const single = spreadsFromProjection(doc, { enabled: false, startOnRight: true });
    expect(single.every((s) => s.kind === 'single')).toBe(true);
  });

  it('custom spread model protects user-authored spreads', () => {
    let doc = docWithPages(3);
    doc = {
      ...doc,
      spreadModel: 'custom',
      spreads: [
        { id: 'custom-1', pageIds: [doc.pages![0]!.id, doc.pages![1]!.id], kind: 'custom' },
      ],
      facingPages: { enabled: true, startOnRight: false },
    };
    const result = rebuildSpreads(doc, { enabled: false, startOnRight: true });
    expect(result).toBe(doc);
    expect(result.spreads![0]!.id).toBe('custom-1');
  });

  it('derived model rebuilds spread ids deterministically after reorder', () => {
    let doc = docWithPages(4, true);
    doc = rebuildSpreads(doc);
    const before = doc.spreads!.map((s) => s.id);
    doc = { ...doc, pages: [...doc.pages!].reverse() };
    doc = rebuildSpreads(doc);
    expect(doc.spreads!.map((s) => s.id)).toEqual(before);
  });

  it('RTL binding mirrors side classification (ADR-0129)', () => {
    let doc = docWithPages(4);
    doc = rebuildSpreads(doc, {
      enabled: true,
      startOnRight: true,
      bindingDirection: 'rtl',
    });
    const [p0, p1, p2] = doc.pages!;

    // Leading single-page spread: left in RTL.
    expect(getPageSide(doc, p0!.id)).toBe('left');
    // Pair: first slot is right, second is left in RTL.
    expect(getPageSide(doc, p1!.id)).toBe('right');
    expect(getPageSide(doc, p2!.id)).toBe('left');
  });

  it('LTR keeps the historical classification', () => {
    let doc = docWithPages(4);
    doc = rebuildSpreads(doc, {
      enabled: true,
      startOnRight: true,
      bindingDirection: 'ltr',
    });
    const [p0, p1] = doc.pages!;
    expect(getPageSide(doc, p0!.id)).toBe('right');
    expect(getPageSide(doc, p1!.id)).toBe('left');
  });

  it('setFacingPagesEnabled preserves ids and honors custom model', () => {
    let doc = docWithPages(3);
    doc = setFacingPagesEnabled(doc, true);
    const ids = doc.spreads!.map((s) => s.id);
    doc = setFacingPagesEnabled(doc, false);
    doc = setFacingPagesEnabled(doc, true);
    expect(doc.spreads!.map((s) => s.id)).toEqual(ids);
  });
});

// ── Section numbering resolver ────────────────────────────────────────────────

function withSections(
  doc: Document,
  sections: Array<{
    startPageId: string;
    numberStyle: PageNumberStyle;
    startNumber: number;
    showPageNumber: boolean;
    prefix?: string;
  }>,
): Document {
  return {
    ...doc,
    sections: sections.map((s, i) => {
      const startPage = doc.pages!.find((p) => p.id === s.startPageId)!;
      return {
        id: `section-${i}`,
        name: `Section ${i}`,
        startPageOrder: startPage.order,
        numberStyle: s.numberStyle,
        startNumber: s.startNumber,
        showPageNumber: s.showPageNumber,
        ...(s.prefix ? { prefix: s.prefix } : {}),
      };
    }),
  };
}

describe('Page numbering resolver (ADR-0131)', () => {
  it('assigns plain sequential numbers without sections', () => {
    const doc = docWithPages(3);
    const entries = computePageNumbering(doc);
    expect(entries.get(doc.pages![0]!.id)!.number).toBe(1);
    expect(entries.get(doc.pages![2]!.id)!.number).toBe(3);
    expect(entries.get(doc.pages![0]!.id)!.parity).toBe('odd');
    expect(entries.get(doc.pages![1]!.id)!.parity).toBe('even');
  });

  it('restarts numbering per section with styles and prefixes', () => {
    let doc = docWithPages(5);
    const [p0, p1, p2] = doc.pages!;
    doc = withSections(doc, [
      { startPageId: p0!.id, numberStyle: 'lowerRoman', startNumber: 1, showPageNumber: true },
      {
        startPageId: p2!.id,
        numberStyle: 'decimal',
        startNumber: 1,
        showPageNumber: true,
        prefix: 'A-',
      },
    ]);

    expect(getPageNumber(doc, p0!.id)).toBe(1);
    expect(getFormattedPageNumber(doc, p0!.id)).toBe('i');
    expect(getFormattedPageNumber(doc, p1!.id)).toBe('ii');
    expect(getPageNumber(doc, p2!.id)).toBe(1);
    expect(getFormattedPageNumber(doc, p2!.id)).toBe('A-1');
    expect(getFormattedPageNumber(doc, doc.pages![3]!.id)).toBe('A-2');
  });

  it('hides numbers when showPageNumber is false', () => {
    let doc = docWithPages(3);
    const [p0] = doc.pages!;
    doc = withSections(doc, [
      { startPageId: p0!.id, numberStyle: 'decimal', startNumber: 1, showPageNumber: false },
    ]);
    expect(getFormattedPageNumber(doc, p0!.id)).toBe('');
    expect(getPageNumbering(doc, p0!.id)!.showNumber).toBe(false);
  });

  it('reports first/last in section and parity after restart', () => {
    let doc = docWithPages(6);
    const p0 = doc.pages![0]!;
    const p2 = doc.pages![2]!;
    doc = withSections(doc, [
      { startPageId: p0.id, numberStyle: 'decimal', startNumber: 1, showPageNumber: true },
      { startPageId: p2.id, numberStyle: 'decimal', startNumber: 5, showPageNumber: true },
    ]);

    const entry0 = getPageNumbering(doc, doc.pages![0]!.id)!;
    const entry1 = getPageNumbering(doc, doc.pages![1]!.id)!;
    const entry2 = getPageNumbering(doc, doc.pages![2]!.id)!;
    const entry3 = getPageNumbering(doc, doc.pages![3]!.id)!;
    expect(entry0.isFirstInSection).toBe(true);
    expect(entry0.isLastInSection).toBe(false);
    expect(entry1.isLastInSection).toBe(true);
    expect(entry2.isFirstInSection).toBe(true);
    expect(entry3.parity).toBe('even'); // number 6
    expect(entry2.parity).toBe('odd'); // number 5
  });

  it('sections before the first start and unknown pages behave', () => {
    const doc = docWithPages(3);
    expect(getPageNumbering(doc, 'missing')).toBeUndefined();
    expect(getPageNumber(doc, 'missing')).toBe(0);
  });

  it('is deterministic across calls', () => {
    const doc = docWithPages(4);
    expect([...computePageNumbering(doc).entries()]).toEqual([
      ...computePageNumbering(doc).entries(),
    ]);
  });
});
