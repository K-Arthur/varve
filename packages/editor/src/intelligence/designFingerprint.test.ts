/** @vitest-environment jsdom */

import type { Document, NodeId } from '@strata/scene';
import { addNode, createDocument, makeFrameNode, makeShapeNode, makeTextNode } from '@strata/scene';
import { translate } from '@strata/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeFingerprint,
  type DesignFingerprint,
  loadFingerprint,
  saveFingerprint,
} from './designFingerprint';

function rectShape(w: number, h: number) {
  return { kind: 'rect' as const, x: 0, y: 0, w, h };
}

function makeText(doc: Document, text: string, fontSize: number, fontFamily: string) {
  const id = `txt_${Math.random().toString(36).slice(2, 8)}` as NodeId;
  return {
    doc: addNode(doc, makeTextNode(id, text, { fontSize, fontFamily, transform: translate(0, 0) })),
    id,
  };
}

function makeRect(doc: Document, x: number, y: number, w: number, h: number) {
  const id = `rect_${Math.random().toString(36).slice(2, 8)}` as NodeId;
  return {
    doc: addNode(
      doc,
      makeShapeNode(id, rectShape(w, h), {
        name: 'Rect',
        transform: translate(x, y),
        cornerRadius: 8,
      }),
    ),
    id,
  };
}

function makeFrame(doc: Document, w: number, h: number) {
  const id = `frm_${Math.random().toString(36).slice(2, 8)}` as NodeId;
  return {
    doc: addNode(
      doc,
      makeFrameNode(id, {
        w,
        h,
        transform: translate(0, 0),
        layoutStyle: {
          mode: 'flex',
          direction: 'row',
          gap: 12,
          wrap: false,
          padding: [0, 0, 0, 0],
          grow: 0,
          shrink: 0,
        },
      }),
    ),
    id,
  };
}

describe('computeFingerprint', () => {
  it('collects colors, spacing, fonts, and corner radii from a document', () => {
    let doc = createDocument('test');
    doc = makeText(doc, 'Hello', 16, 'Inter').doc;
    doc = makeText(doc, 'World', 24, 'Inter').doc;
    doc = makeRect(doc, 0, 0, 100, 100).doc;
    doc = makeRect(doc, 120, 0, 50, 50).doc;
    doc = makeFrame(doc, 200, 200).doc;

    const fp = computeFingerprint(doc);

    expect(fp.colors.length).toBeGreaterThan(0);
    expect(fp.fontFamilies).toContain('Inter');
    expect(fp.fontSizes).toContain(16);
    expect(fp.fontSizes).toContain(24);
    expect(fp.cornerRadii).toContain(8);
    expect(fp.spacing).toContain(12);
  });

  it('returns default values for an empty document', () => {
    const doc = createDocument('empty');
    const fp = computeFingerprint(doc);
    expect(fp.colors).toEqual([]);
    expect(fp.spacing).toEqual([]);
    expect(fp.fontFamilies).toEqual([]);
    expect(fp.fontSizes).toEqual([]);
    expect(fp.cornerRadii).toEqual([]);
  });

  it('collects top 12 colors by frequency', () => {
    let doc = createDocument('color-test');
    for (let i = 0; i < 15; i++) {
      doc = makeRect(doc, i * 10, 0, 10, 10).doc;
    }
    const fp = computeFingerprint(doc);
    expect(fp.colors.length).toBeLessThanOrEqual(12);
    expect(fp.colors.every((c) => c.count > 0)).toBe(true);
  });

  it('collects top 5 gap values', () => {
    let doc = createDocument('gap-test');
    const gapValues = [4, 4, 8, 8, 8, 12, 16];
    for (const gap of gapValues) {
      const id = `f_${Math.random().toString(36).slice(2, 8)}` as NodeId;
      doc = addNode(
        doc,
        makeFrameNode(id, {
          w: 100,
          h: 100,
          transform: translate(0, 0),
          layoutStyle: {
            mode: 'flex',
            direction: 'row',
            gap,
            wrap: false,
            padding: [0, 0, 0, 0],
            grow: 0,
            shrink: 0,
          },
        }),
      );
    }
    const fp = computeFingerprint(doc);
    expect(fp.spacing.length).toBeLessThanOrEqual(5);
    expect(fp.spacing).toContain(8);
  });

  it('sorts corner radii uniquely', () => {
    let doc = createDocument('corner-test');
    doc = addNode(doc, makeShapeNode('r1' as NodeId, rectShape(100, 100), { cornerRadius: 4 }));
    doc = addNode(doc, makeShapeNode('r2' as NodeId, rectShape(100, 100), { cornerRadius: 8 }));
    doc = addNode(doc, makeShapeNode('r3' as NodeId, rectShape(100, 100), { cornerRadius: 4 }));
    doc = addNode(doc, makeShapeNode('r4' as NodeId, rectShape(100, 100), { cornerRadius: 16 }));
    const fp = computeFingerprint(doc);
    expect(fp.cornerRadii).toEqual([4, 8, 16]);
  });
});

describe('saveFingerprint / loadFingerprint', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads a fingerprint', () => {
    const fp: DesignFingerprint = {
      colors: [],
      spacing: [8, 16],
      fontFamilies: ['Inter'],
      fontSizes: [16],
      cornerRadii: [4, 8],
    };
    saveFingerprint(fp);
    const loaded = loadFingerprint();
    expect(loaded).toEqual(fp);
  });

  it('returns null when no fingerprint saved', () => {
    expect(loadFingerprint()).toBeNull();
  });

  it('returns null on corrupted data', () => {
    localStorage.setItem('strata:design-fingerprint', 'not-json');
    expect(loadFingerprint()).toBeNull();
  });

  it('round-trips with computed fingerprint', () => {
    let doc = createDocument('roundtrip');
    doc = makeText(doc, 'A', 16, 'Inter').doc;
    doc = makeRect(doc, 0, 0, 100, 100).doc;
    const fp = computeFingerprint(doc);
    saveFingerprint(fp);
    const loaded = loadFingerprint();
    expect(loaded).toEqual(fp);
  });
});
