import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

async function loadFontData(): Promise<ArrayBuffer> {
  const woff2 = readFileSync(GEIST_PATH);
  const decompressed = await wawoff2.decompress(new Uint8Array(woff2));
  const copy = new Uint8Array(decompressed.length);
  copy.set(decompressed);
  return copy.buffer;
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
});
