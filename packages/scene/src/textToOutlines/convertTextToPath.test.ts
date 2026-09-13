import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHarfBuzzWasmBackend } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { addChild, createDocument, makeTextNode } from '../document';
import { convertTextNodeToPath, ORIGINAL_TEXT_META_KEY } from './convertTextToPath';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const wawoff2: { decompress: (data: Uint8Array) => Promise<Uint8Array> } = require('wawoff2');

const PROJECT_ROOT = process.cwd();

/**
 * Resolve the Geist variable font from the installed store instead of
 * hardcoding a version in the .pnpm path: the lockfile moves between
 * releases (5.2.9 -> 5.3.0) and a hardcoded version breaks the release
 * gate's fresh `pnpm install --frozen-lockfile` while passing on a dev
 * machine with a stale leftover directory.
 */
function resolveGeistPath(): string {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const resolved = execSync(
    'node -e "console.log(require.resolve(\'@fontsource-variable/geist/package.json\'))"',
    {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
    },
  ).trim();
  const pkgDir = join(resolved, '..');
  return join(pkgDir, 'files', 'geist-latin-wght-normal.woff2');
}

const GEIST_PATH = resolveGeistPath();
const OPEN_SANS_PATH = join(
  PROJECT_ROOT,
  'crates',
  'varve-print',
  'fixtures',
  'OpenSans-Regular.ttf',
);

async function loadFontData(): Promise<ArrayBuffer> {
  const woff2 = readFileSync(GEIST_PATH);
  const decompressed = await wawoff2.decompress(new Uint8Array(woff2));
  const copy = new Uint8Array(decompressed.length);
  copy.set(decompressed);
  return copy.buffer;
}

function loadOpenSansData(): ArrayBuffer {
  const bytes = readFileSync(OPEN_SANS_PATH);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function makeDocWithText(text: string, overrides: Record<string, unknown> = {}) {
  const doc = createDocument('test');
  const textNode = makeTextNode('txt1', text, {
    fontSize: 16,
    fontFamily: 'Geist',
    name: 'My Text',
    ...overrides,
  } as Parameters<typeof makeTextNode>[2]);
  const rootFrame = doc.rootChildren[0]!;
  const withText = addChild(doc, rootFrame, textNode);
  return { doc: withText, textNode, rootFrame };
}

describe('convertTextNodeToPath', () => {
  it('converts a text node to a group of shape nodes', async () => {
    const fontData = await loadFontData();
    const { doc } = makeDocWithText('Hello');
    const result = convertTextNodeToPath(doc, 'txt1', { fontData });

    // Group replaces text node
    const groupId = 'txt1-outlined';
    const group = result.document.nodes[groupId];
    expect(group).toBeDefined();
    expect(group!.kind).toBe('group');

    // Original text node is removed
    expect(result.document.nodes.txt1).toBeUndefined();

    // Group has children
    const groupNode = group as unknown as { children: string[] };
    expect(groupNode.children.length).toBeGreaterThan(0);

    // Each child is a shape node
    for (const childId of groupNode.children) {
      const child = result.document.nodes[childId];
      expect(child).toBeDefined();
      expect(child!.kind).toBe('shape');
    }

    // Root frame children reference the group
    const rootFrame = result.document.nodes[result.document.rootChildren[0]!];
    const rootFrameChildren = (rootFrame as unknown as { children: string[] }).children;
    expect(rootFrameChildren).toContain(groupId);
    expect(rootFrameChildren).not.toContain('txt1');

    // No warnings
    expect(result.warnings).toHaveLength(0);
  });

  it('stores original text in metadata', async () => {
    const fontData = await loadFontData();
    const { doc } = makeDocWithText('Test');
    const result = convertTextNodeToPath(doc, 'txt1', { fontData });

    const group = result.document.nodes['txt1-outlined'] as unknown as Record<string, unknown>;
    expect(group[ORIGINAL_TEXT_META_KEY]).toBe('Test');
  });

  it('warns for whitespace-only text', async () => {
    const fontData = await loadFontData();
    const { doc } = makeDocWithText('   \n  ');
    const result = convertTextNodeToPath(doc, 'txt1', { fontData });

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('warns when font data is not provided', () => {
    const { doc } = makeDocWithText('Hello');
    const result = convertTextNodeToPath(doc, 'txt1', {});

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]!).toContain('Font binary data');
  });

  it('refuses corrupt font data without replacing the text with placeholders', () => {
    const { doc } = makeDocWithText('Hello');
    const result = convertTextNodeToPath(doc, 'txt1', {
      fontData: new Uint8Array([0, 1, 2, 3]).buffer,
    });

    expect(result.document).toBe(doc);
    expect(result.document.nodes.txt1).toBeDefined();
    expect(result.document.nodes['txt1-outlined']).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('complete vector outlines');
  });

  it('warns when node is not text', () => {
    const doc = createDocument('test', true);
    const result = convertTextNodeToPath(doc, 'nonexistent', {});

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]!).toContain('not a text node');
  });

  it('refuses text beyond maxChars', async () => {
    const fontData = await loadFontData();
    const { doc } = makeDocWithText('A'.repeat(100));
    const result = convertTextNodeToPath(doc, 'txt1', { fontData, maxChars: 50 });

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]!).toContain('Refusing');
  });

  it('preserves text node rotation on the group', async () => {
    const fontData = await loadFontData();
    const { doc } = makeDocWithText('Hi', { rotation: 45 });
    const result = convertTextNodeToPath(doc, 'txt1', { fontData });

    const group = result.document.nodes['txt1-outlined'] as unknown as { rotation: number };
    expect(group.rotation).toBe(45);
  });

  it('advances plain multi-line text instead of overlapping the lines', async () => {
    const fontData = loadOpenSansData();
    const { doc } = makeDocWithText('A\nB', { fontFamily: 'Open Sans', fontSize: 100 });
    const result = convertTextNodeToPath(doc, 'txt1', { fontData });
    expect(result.document.nodes.txt1).toBeUndefined();
    const glyphs = Object.values(result.document.nodes).filter(
      (node) => node.kind === 'shape' && node.id.startsWith('txt1-run-'),
    );
    expect(glyphs).toHaveLength(2);
    const yPositions = glyphs.map((node) => {
      if (node.kind !== 'shape' || node.shape.kind !== 'path') return 0;
      return Math.min(...node.shape.points.map((point) => point.y));
    });
    expect(Math.abs(yPositions[1]! - yPositions[0]!)).toBeGreaterThan(1);
  });

  it('preserves editable text when a display transform or live path would be lost', async () => {
    const fontData = loadOpenSansData();
    for (const overrides of [
      { textCase: 'uppercase' },
      { textMode: 'path', pathTextSettings: { pathNodeId: 'path-1' } },
    ]) {
      const { doc } = makeDocWithText('fi', {
        fontFamily: 'Open Sans',
        ...(overrides as Record<string, unknown>),
      });
      const result = convertTextNodeToPath(doc, 'txt1', { fontData });
      expect(result.document).toBe(doc);
      expect(result.document.nodes.txt1).toBeDefined();
      expect(result.warnings.join(' ')).toMatch(/preserved|Detach|Expand/i);
    }
    const { doc, textNode } = makeDocWithText('fi', { fontFamily: 'Open Sans' });
    const warpedDoc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        txt1: { ...textNode, warps: [{ id: 'warp-1', kind: 'bend', enabled: true }] },
      },
    };
    const warpedResult = convertTextNodeToPath(warpedDoc, 'txt1', { fontData });
    expect(warpedResult.document).toBe(warpedDoc);
    expect(warpedResult.document.nodes.txt1).toBeDefined();
    expect(warpedResult.warnings.join(' ')).toMatch(/Expand|preserved/i);
  });

  it('uses shaped ligature geometry instead of raw character lookup', async () => {
    const fontData = loadOpenSansData();
    const shaped = await createHarfBuzzWasmBackend().shape({
      text: 'fi',
      fontData,
      fontSize: 100,
      features: { liga: true },
    });
    const { doc } = makeDocWithText('fi', {
      fontFamily: 'Open Sans',
      fontSize: 100,
      openTypeFeatures: { liga: true },
    });
    const result = convertTextNodeToPath(doc, 'txt1', {
      fontData,
      shapedGlyphs: shaped.glyphs,
    });

    const group = result.document.nodes['txt1-outlined'] as unknown as { children: string[] };
    expect(group.children).toHaveLength(1);
    const glyph = result.document.nodes[group.children[0]!] as {
      shape: { kind: string; points: Array<{ x: number; y: number }> };
      name: string;
    };
    expect(glyph.name).toBe('fi');
    expect(glyph.shape.kind).toBe('path');
    expect(glyph.shape.points.length).toBeGreaterThan(0);
    const metadata = (
      result.document.nodes['txt1-outlined'] as {
        outlinedTextMetadata?: {
          glyphs: Array<{ glyphId?: number; sourceStart?: number; sourceEnd?: number }>;
          sourceText: string;
        };
      }
    ).outlinedTextMetadata;
    expect(metadata?.sourceText).toBe('fi');
    expect(metadata?.glyphs[0]?.glyphId).toBe(shaped.glyphs[0]?.glyphId);
    expect(metadata?.glyphs[0]?.sourceStart).toBe(0);
    expect(metadata?.glyphs[0]?.sourceEnd).toBe(2);
    expect(result.warnings).toHaveLength(0);
  });
});
