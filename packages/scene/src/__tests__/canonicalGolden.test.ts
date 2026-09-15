/**
 * Cross-platform canonical golden fixtures (ADR-0027).
 *
 * The canonical text and digest of a comprehensive document must be
 * byte-identical on Linux, Windows, and macOS, in Node and browsers.
 * Regenerate with:
 *
 *   UPDATE_GOLDENS=1 pnpm exec vitest run packages/scene/src/__tests__/canonicalGolden.test.ts
 *
 * and review the diff before committing (golden drift is a schema decision).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalizeDocument } from '../canonical';
import type { Document } from '../document';
import {
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
} from '../document';
import { solidFill } from '../fills';

const GOLDEN_DIR = join(__dirname, '..', '__goldens__');
const TEXT_GOLDEN = join(GOLDEN_DIR, 'canonical-document.json');
const HASH_GOLDEN = join(GOLDEN_DIR, 'canonical-document.sha256');

export function goldenFixtureDocument(): Document {
  let doc = createDocument('Golden fixture', { flat: true });
  doc = { ...doc, id: 'golden-doc-id-0001' } as Document;
  const frame = makeFrameNode('f1', {
    w: 800,
    h: 600,
    children: ['n1', 'n2'],
    clipContent: true,
  }) as Document['nodes'][string];
  const withCorner = { ...frame, cornerRadius: 8 } as Document['nodes'][string];
  doc = addNode(doc, withCorner);
  doc = addNode(doc, makeShapeNode('n1', { kind: 'rect', x: 10, y: 20, w: 100, h: 50 }));
  doc = addNode(
    doc,
    makeTextNode('n2', 'caf\u00e9 \u03b1\u03b2 emoji \ud83d\ude00', {
      fontSize: 24,
      fontWeight: 700,
    }),
  );
  doc = addNode(doc, makeGroupNode('n3', { children: ['n4'] }));
  doc = addNode(doc, makeShapeNode('n4', { kind: 'circle', cx: 5, cy: 5, r: 5 }));
  doc = addNode(
    doc,
    makeShapeNode('n5', { kind: 'line', from: [0, 0], to: [10, 10], tolerance: 0.5 }),
  );
  doc = {
    ...doc,
    canvasWidth: 1920,
    canvasHeight: 1080,
    dpi: 300,
    documentUnit: 'px',
    styles: {
      s1: {
        id: 's1',
        type: 'color',
        name: 'Teal',
        fill: solidFill({ space: 'rgb', r: 57, g: 208, b: 198, a: 255 }),
      },
    },
    assets: {
      'asset-abc': {
        id: 'asset-abc',
        storage: 'embedded',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        naturalWidth: 1,
        naturalHeight: 1,
        byteLength: 12,
        hash: 'abc',
      },
    },
    rasterMaskAssets: {
      'rmask-1': {
        id: 'rmask-1',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
        width: 2,
        height: 2,
        byteLength: 4,
      },
    },
    guides: [
      { id: 'g1', axis: 'vertical', position: 120, locked: false, visible: true },
      { id: 'g2', axis: 'horizontal', position: 80, locked: true, visible: true },
    ],
  } as unknown as Document;
  return doc;
}

const updating = process.env.UPDATE_GOLDENS === '1';

describe('canonical goldens (cross-platform)', () => {
  it('matches the committed canonical text golden', () => {
    const actual = canonicalizeDocument(goldenFixtureDocument());
    if (updating) {
      writeFileSync(TEXT_GOLDEN, actual);
      return;
    }
    expect(actual).toBe(readFileSync(TEXT_GOLDEN, 'utf8'));
  });

  it('matches the committed canonical digest golden', () => {
    const actual = canonicalHash(goldenFixtureDocument());
    if (updating) {
      writeFileSync(HASH_GOLDEN, `${actual}\n`);
      return;
    }
    expect(actual).toBe(readFileSync(HASH_GOLDEN, 'utf8').trim());
  });

  it('golden parse→reserialize is stable (cross-platform idempotence)', () => {
    const text = readFileSync(TEXT_GOLDEN, 'utf8');
    const reparsed = canonicalizeDocument(JSON.parse(text) as Document);
    expect(reparsed).toBe(text);
  });
});
