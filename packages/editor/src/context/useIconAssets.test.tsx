// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { ImportService } from '@varve/import';
import type { Document, SceneNode } from '@varve/scene';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorState } from './types';
import { type IconInsertRequest, useIconAssets } from './useIconAssets';

const ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';

function makeState(): EditorState {
  return {
    document: createDocument('icons', true),
    selection: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    cameraRotation: 0,
  } as unknown as EditorState;
}

/** Build a scene doc whose single root node is the icon conversion artifact. */
function artifactDoc(): ReturnType<typeof createDocument> {
  let doc = createDocument('artifact', true);
  const node = makeShapeNode(
    'icon-root',
    { kind: 'rect', x: 0, y: 0, w: 24, h: 24 },
    { name: 'home' },
  );
  doc = addNode(doc, node);
  return doc;
}

function setup() {
  const state = makeState();
  const stateRef = { current: state } as React.MutableRefObject<EditorState>;
  const updateDoc = vi.fn<(fn: (doc: Document) => Document) => void>((fn) => {
    stateRef.current = {
      ...stateRef.current,
      document: fn(stateRef.current.document),
    };
  });
  const patch = vi.fn((partial: Partial<EditorState>) => {
    stateRef.current = { ...stateRef.current, ...partial };
  });
  const announce = vi.fn();
  const insertSubtree = vi.fn(
    (
      targetDoc: ReturnType<typeof createDocument>,
      sourceDoc: ReturnType<typeof createDocument>,
      rootId: string,
      adjustRoot?: (node: SceneNode) => SceneNode,
    ) => {
      const node = sourceDoc.nodes[rootId];
      if (!node) return null;
      const adjusted = adjustRoot ? adjustRoot(node) : node;
      return {
        doc: {
          ...targetDoc,
          nodes: { ...targetDoc.nodes, [rootId]: adjusted },
          rootChildren: [...targetDoc.rootChildren, rootId],
          nextId: targetDoc.nextId + 1,
        },
        rootId,
      };
    },
  );
  const viewportCenterWorld = vi.fn(() => ({ x: 100, y: 100 }));

  const { result } = renderHook(() =>
    useIconAssets({ stateRef, updateDoc, patch, announce, insertSubtree, viewportCenterWorld }),
  );
  return {
    stateRef,
    updateDoc,
    patch,
    announce,
    insertSubtree,
    viewportCenterWorld,
    api: result.current,
  };
}

const REQUEST: IconInsertRequest = {
  name: 'home',
  providerId: 'iconify',
  prefix: 'mdi',
  svg: ICON_SVG,
  licence: 'Apache 2.0',
  style: 'outline',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useIconAssets — insertIconAsset', () => {
  it('sanitizes the SVG before conversion and records the asset', async () => {
    const spy = vi.spyOn(ImportService, 'importFiles').mockResolvedValue({
      files: [
        {
          name: 'home.svg',
          source: 'asset-library',
          format: 'svg',
          status: 'success',
          byteCount: 1,
          durationMs: 1,
          nodeCount: 1,
          artifacts: [
            { kind: 'document-fragment', document: artifactDoc(), nodeIds: ['icon-root'] },
          ],
          warnings: [],
          unsupportedFeatures: [],
        },
      ],
      startedAt: 0,
      completedAt: 0,
      durationMs: 1,
      totalFiles: 1,
      successCount: 1,
      partialCount: 0,
      failureCount: 0,
      unsupportedCount: 0,
      warnings: [],
    });
    const { stateRef, updateDoc, patch, announce, api } = setup();

    const rootId = await act(async () => api.insertIconAsset(REQUEST));

    expect(rootId).toBe('icon-root');
    expect(spy).toHaveBeenCalled();
    const input = spy.mock.calls[0]?.[0]?.[0] as { text: string };
    expect(input.text).not.toContain('<script');
    const doc = stateRef.current.document;
    expect(doc.nodes['icon-root']?.iconAssetId).toBeTruthy();
    const assetId = doc.nodes['icon-root']?.iconAssetId;
    expect(doc.iconAssets?.[assetId!]).toMatchObject({
      name: 'home',
      prefix: 'mdi',
      providerId: 'iconify',
      licence: 'Apache 2.0',
      storageMode: 'embedded',
    });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ selection: ['icon-root'] });
    expect(announce).toHaveBeenCalledWith('Inserted icon "home"');
  });

  it('strips script payloads before conversion', async () => {
    const importSpy = vi.spyOn(ImportService, 'importFiles').mockResolvedValue({
      files: [
        {
          name: 'home.svg',
          source: 'asset-library',
          format: 'svg',
          status: 'success',
          byteCount: 1,
          durationMs: 1,
          nodeCount: 1,
          artifacts: [
            { kind: 'document-fragment', document: artifactDoc(), nodeIds: ['icon-root'] },
          ],
          warnings: [],
          unsupportedFeatures: [],
        },
      ],
      startedAt: 0,
      completedAt: 0,
      durationMs: 1,
      totalFiles: 1,
      successCount: 1,
      partialCount: 0,
      failureCount: 0,
      unsupportedCount: 0,
      warnings: [],
    });
    const { stateRef, updateDoc, api } = setup();

    const result = await act(async () =>
      api.insertIconAsset({
        ...REQUEST,
        svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M2 2h20v20H2z"/></svg>',
      }),
    );

    // The importer must never see the raw script — sanitization strips it.
    expect(result).not.toBeNull();
    const input = importSpy.mock.calls[0]?.[0]?.[0] as { text: string };
    expect(input.text).not.toContain('script');
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(stateRef.current.document.nodes['icon-root']?.iconAssetId).toBeTruthy();
  });

  it('rejects empty SVG without touching the document', async () => {
    const { stateRef, updateDoc, api, announce } = setup();
    const before = stateRef.current.document;

    const result = await act(async () => api.insertIconAsset({ ...REQUEST, svg: '' }));

    expect(result).toBeNull();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(stateRef.current.document).toBe(before);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('failed security checks'));
  });
});

describe('useIconAssets — detachIconNodes', () => {
  it('clears iconAssetId and prunes unreferenced assets', () => {
    const { stateRef, api } = setup();
    const node = makeShapeNode(
      'icon-node',
      { kind: 'rect', x: 0, y: 0, w: 24, h: 24 },
      { name: 'home' },
    );
    stateRef.current = {
      ...stateRef.current,
      document: {
        ...stateRef.current.document,
        nodes: {
          ...stateRef.current.document.nodes,
          'icon-node': { ...node, iconAssetId: 'icon-mdi-abc' },
        },
        rootChildren: [...stateRef.current.document.rootChildren, 'icon-node'],
        iconAssets: {
          'icon-mdi-abc': {
            id: 'icon-mdi-abc',
            providerId: 'iconify',
            name: 'home',
            prefix: 'mdi',
            storageMode: 'embedded',
            svg: ICON_SVG,
            style: 'outline',
            availableStyles: ['outline'],
            tags: [],
            viewBox: '0 0 24 24',
            defaultWidth: 24,
            defaultHeight: 24,
            overrides: {},
            instanceNodeIds: [],
            createdAt: 1,
            updatedAt: 1,
            hash: 'abc',
          },
        },
      },
    };

    act(() => api.detachIconNodes(['icon-node']));

    const doc = stateRef.current.document;
    expect(doc.nodes['icon-node']?.iconAssetId).toBeUndefined();
    expect(doc.iconAssets).toBeUndefined();
  });
});

describe('useIconAssets — replaceIconAsset', () => {
  it('removes the old node and keeps the new one within a single transaction', async () => {
    vi.spyOn(ImportService, 'importFiles').mockResolvedValue({
      files: [
        {
          name: 'star.svg',
          source: 'asset-library',
          format: 'svg',
          status: 'success',
          byteCount: 1,
          durationMs: 1,
          nodeCount: 1,
          artifacts: [
            { kind: 'document-fragment', document: artifactDoc(), nodeIds: ['icon-root'] },
          ],
          warnings: [],
          unsupportedFeatures: [],
        },
      ],
      startedAt: 0,
      completedAt: 0,
      durationMs: 1,
      totalFiles: 1,
      successCount: 1,
      partialCount: 0,
      failureCount: 0,
      unsupportedCount: 0,
      warnings: [],
    });
    const { stateRef, api } = setup();
    const oldNode = {
      ...makeShapeNode('old-icon', { kind: 'rect', x: 0, y: 0, w: 48, h: 48 }, { name: 'old' }),
      transform: [1, 0, 0, 1, 10, 20] as unknown as SceneNode['transform'],
    };
    stateRef.current = {
      ...stateRef.current,
      document: {
        ...stateRef.current.document,
        nodes: {
          ...stateRef.current.document.nodes,
          'old-icon': { ...oldNode, iconAssetId: 'icon-mdi-old' },
        },
        rootChildren: [...stateRef.current.document.rootChildren, 'old-icon'],
        iconAssets: {
          'icon-mdi-old': {
            id: 'icon-mdi-old',
            providerId: 'iconify',
            name: 'old',
            prefix: 'mdi',
            storageMode: 'embedded',
            svg: ICON_SVG,
            style: 'outline',
            availableStyles: ['outline'],
            tags: [],
            viewBox: '0 0 24 24',
            defaultWidth: 24,
            defaultHeight: 24,
            overrides: {},
            instanceNodeIds: [],
            createdAt: 1,
            updatedAt: 1,
            hash: 'old',
          },
        },
      },
    };

    const newId = await act(async () => api.replaceIconAsset(['old-icon'], REQUEST));

    expect(newId).toBe('icon-root');
    const doc = stateRef.current.document;
    expect(doc.nodes['old-icon']).toBeUndefined();
    expect(doc.nodes['icon-root']).toBeDefined();
    expect(doc.nodes['icon-root']?.iconAssetId).toBeTruthy();
    expect(doc.rootChildren).not.toContain('old-icon');
    // The replacement lands at the old node's position.
    const placed = doc.nodes['icon-root'] as unknown as { transform?: number[] };
    expect(placed.transform?.[4]).toBe(10);
    expect(placed.transform?.[5]).toBe(20);
  });
});
