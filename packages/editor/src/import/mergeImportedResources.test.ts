import type { GenerativeEditRecord, MockupTemplateAsset } from '@varve/scene';
import {
  createDocument,
  createVariableStore,
  deepCloneSubtree,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { mergeImportedResources } from './mergeImportedResources';

describe('mergeImportedResources', () => {
  it('remaps imported components, styles, variables and prototype targets', () => {
    const master = makeFrameNode('source-master', { name: 'Master' });
    const instance = {
      ...makeFrameNode('source-instance', {
        name: 'Instance',
        componentId: 'source-component',
      }),
      styleId: 'source-style',
      paintRefs: ['source-paint'],
      bindings: { fill: { variableId: 'source-variable' } },
    };
    const root = makeGroupNode('source-root', {
      name: 'Imported page',
      children: [master.id, instance.id],
    });
    const variableStore = createVariableStore(['light', 'dark']);
    variableStore.variables['source-variable'] = {
      id: 'source-variable',
      name: 'surface',
      type: 'color',
      valuesByMode: { light: '{source-variable}', dark: '#000000' },
    };
    const source = {
      ...createDocument('source'),
      rootChildren: [root.id],
      nodes: { [root.id]: root, [master.id]: master, [instance.id]: instance },
      components: {
        'source-component': {
          id: 'source-component',
          name: 'Button',
          slots: [],
          masterRootId: master.id,
        },
      },
      styles: {
        'source-style': {
          id: 'source-style',
          type: 'color' as const,
          name: 'Surface',
          fill: {
            type: 'solid' as const,
            opacity: 1,
            blendMode: 'normal' as const,
            visible: true,
          },
        },
      },
      paints: {
        'source-paint': {
          id: 'source-paint',
          name: 'Surface paint',
          fill: {
            type: 'solid' as const,
            opacity: 1,
            blendMode: 'normal' as const,
            visible: true,
          },
        },
      },
      variableStore,
      interactions: {
        [instance.id]: [
          {
            id: 'source-interaction',
            nodeId: instance.id,
            name: 'Navigate',
            trigger: { kind: 'onClick' },
            actions: [{ kind: 'navigateTo', targetId: master.id }],
            enabled: true,
          },
        ],
      },
      stories: {
        'source-story': {
          id: 'source-story',
          name: 'Story',
          content: { paragraphs: [] },
          thread: [instance.id],
        },
      },
      timelines: {
        'source-timeline': {
          id: 'source-timeline',
          name: 'Pulse',
          duration: 1000,
          defaultEasing: { kind: 'linear' as const },
          tracks: [
            {
              id: 'source-track',
              nodeId: instance.id,
              property: 'opacity',
              keyframes: [{ progress: 0, value: 1 }],
            },
          ],
        },
      },
    };
    const target = createDocument('target');
    const clone = deepCloneSubtree(source.nodes, target.nextId, root.id, {
      dropForeignReferences: true,
    });
    const clonedDocument = {
      ...target,
      nodes: clone.nodes,
      rootChildren: [clone.rootId],
      nextId: clone.nextId,
    };
    const merged = mergeImportedResources(clonedDocument, [
      { sourceDoc: source, idMap: clone.idMap },
    ]);
    const clonedInstance = merged.nodes[clone.idMap.get(instance.id)!] as typeof instance;
    const component = Object.values(merged.components)[0];
    const style = Object.values(merged.styles ?? {})[0];
    const variable = Object.values(merged.variableStore?.variables ?? {})[0];
    const interaction = merged.interactions?.[clonedInstance.id]?.[0];
    const paintId = clonedInstance.paintRefs?.[0];
    const story = Object.values(merged.stories ?? {})[0];
    const timeline = Object.values(merged.timelines ?? {})[0];

    expect(component?.masterRootId).toBe(clone.idMap.get(master.id));
    expect(clonedInstance.componentId).toBe(component?.id);
    expect(clonedInstance.styleId).toBe(style?.id);
    expect(clonedInstance.bindings?.fill.variableId).toBe(variable?.id);
    expect(paintId).toBeTruthy();
    expect(paintId).not.toBe('source-paint');
    expect(merged.paints?.[paintId!]?.name).toBe('Surface paint');
    expect(interaction?.nodeId).toBe(clonedInstance.id);
    expect((interaction?.actions[0] as { targetId?: string } | undefined)?.targetId).toBe(
      clone.idMap.get(master.id),
    );
    expect(story?.thread).toEqual([clonedInstance.id]);
    expect(timeline?.tracks[0]?.nodeId).toBe(clonedInstance.id);
  });

  it('remaps mockup templates referenced by imported frame instances', () => {
    const sourceFrame = makeFrameNode('source-frame', { name: 'Mockup' });
    const source = {
      ...createDocument('source-mockup'),
      rootChildren: [sourceFrame.id],
      nodes: {
        [sourceFrame.id]: {
          ...sourceFrame,
          mockup: { templateId: 'source-template', surfaceBindings: {} },
        },
      },
      mockupTemplates: {
        'source-template': {
          id: 'source-template',
          schemaVersion: 2,
          name: 'Source phone',
          category: 'devices',
          source: 'community',
          orientation: 'portrait',
          outputWidth: 100,
          outputHeight: 200,
          backgroundColor: 'transparent',
          plate: [],
          surfaces: [],
          overlays: [],
          contentHash: 'source-hash',
        } satisfies MockupTemplateAsset,
      },
    };
    const target = createDocument('target-mockup');
    const clone = deepCloneSubtree(source.nodes, target.nextId, sourceFrame.id, {
      dropForeignReferences: true,
    });
    const clonedDocument = {
      ...target,
      nodes: clone.nodes,
      rootChildren: [clone.rootId],
      nextId: clone.nextId,
    };
    const merged = mergeImportedResources(clonedDocument, [
      { sourceDoc: source, idMap: clone.idMap },
    ]);
    const clonedFrame = merged.nodes[clone.rootId];
    const templateId = clonedFrame?.kind === 'frame' ? clonedFrame.mockup?.templateId : undefined;

    expect(templateId).toBeTruthy();
    expect(templateId).not.toBe('source-template');
    expect(merged.mockupTemplates?.[templateId!]?.contentHash).toBe('source-hash');
  });

  it('remaps colliding image and raster-mask assets used by generative edits', () => {
    const sourceNode = {
      ...makeShapeNode('source-image', { kind: 'rect', x: 0, y: 0, w: 64, h: 64 }),
      fills: [
        {
          type: 'image' as const,
          image: {
            src: 'data:image/png;base64,AA==',
            assetId: 'shared-image',
            generativeEditOverlay: {
              editId: 'source-edit',
              variationId: 'source-variation',
            },
            fit: 'fill' as const,
            x: 0,
            y: 0,
            scale: 1,
          },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
        {
          type: 'image' as const,
          image: {
            src: 'data:image/png;base64,AA==',
            assetId: 'shared-image',
            generativeEditOverlay: {
              editId: 'missing-edit',
              variationId: 'missing-variation',
            },
            fit: 'fill' as const,
            x: 0,
            y: 0,
            scale: 1,
          },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
      mask: {
        type: 'alpha' as const,
        visible: true,
        rasterMask: {
          assetId: 'shared-mask',
          coordinateSpace: 'source-image-pixels' as const,
          sourceIdentity: {
            kind: 'source-metadata' as const,
            locator: 'source-image',
            revision: 1,
          },
        },
      },
    };
    const sourceEdit = {
      schemaVersion: 2,
      id: 'source-edit',
      mode: 'replace',
      sourceNodeId: sourceNode.id,
      parentEditId: 'parent-edit',
      sourceAssetId: 'shared-image',
      sourceSnapshotAssetId: 'shared-image',
      sourceLocator: 'source-image',
      sourceRevision: 1,
      placementRevision: 'placement-1',
      masks: {
        userMaskAssetId: 'shared-mask',
        inferenceMaskAssetId: 'shared-mask',
        compositeMaskAssetId: 'shared-mask',
        width: 64,
        height: 64,
        offsetX: 0,
        offsetY: 0,
        coordinateSpace: 'source-image-pixels',
      },
      outputFrame: {
        x: 0,
        y: 0,
        width: 64,
        height: 64,
        sourceWidth: 64,
        sourceHeight: 64,
        coordinateSpace: 'source-image-pixels',
      },
      maskAssetId: 'shared-mask',
      maskWidth: 64,
      maskHeight: 64,
      maskCoordinateSpace: 'source-image-pixels',
      settings: {
        quality: 'balanced',
        contextPadding: 16,
        maskExpansion: 0,
        feather: 0,
        prompt: 'a red apple',
      },
      provider: { kind: 'local', id: 'local', runtime: 'native-cpu' },
      variations: [
        {
          id: 'source-variation',
          assetId: 'shared-image',
          contextAssetId: 'shared-image',
          width: 64,
          height: 64,
          createdAt: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    } satisfies GenerativeEditRecord;
    const parentEdit = {
      ...sourceEdit,
      id: 'parent-edit',
      parentEditId: undefined,
    } satisfies GenerativeEditRecord;
    const sourceAsset = {
      id: 'shared-image',
      storage: 'embedded' as const,
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AA==',
      naturalWidth: 1,
      naturalHeight: 1,
      byteLength: 1,
      hash: 'source-image-hash',
    };
    const sourceMask = {
      id: 'shared-mask',
      mimeType: 'image/png' as const,
      dataUrl: 'data:image/png;base64,Ag==',
      width: 1,
      height: 1,
      byteLength: 1,
    };
    const source = {
      ...createDocument('source-assets'),
      rootChildren: [sourceNode.id],
      nodes: { [sourceNode.id]: sourceNode },
      assets: { [sourceAsset.id]: sourceAsset },
      rasterMaskAssets: { [sourceMask.id]: sourceMask },
      generativeEdits: {
        [sourceEdit.id]: sourceEdit,
        [parentEdit.id]: parentEdit,
      },
    };
    const targetAsset = { ...sourceAsset, dataUrl: 'data:image/png;base64,BA==', hash: 'target' };
    const targetMask = { ...sourceMask, dataUrl: 'data:image/png;base64,Bg==' };
    const target = {
      ...createDocument('target-assets'),
      assets: { [targetAsset.id]: targetAsset },
      rasterMaskAssets: { [targetMask.id]: targetMask },
    };
    const clone = deepCloneSubtree(source.nodes, target.nextId, sourceNode.id, {
      dropForeignReferences: true,
    });
    const clonedDocument = {
      ...target,
      nodes: clone.nodes,
      rootChildren: [clone.rootId],
      nextId: clone.nextId,
    };

    const merged = mergeImportedResources(clonedDocument, [
      { sourceDoc: source, idMap: clone.idMap },
    ]);
    const clonedNode = merged.nodes[clone.rootId]!;
    const imageAssetId = clonedNode.fills?.[0]?.image?.assetId;
    const maskAssetId = clonedNode.mask?.rasterMask?.assetId;
    const importedEdit = Object.values(merged.generativeEdits ?? {}).find(
      (edit) => edit.id !== 'parent-edit' && edit.sourceNodeId === clone.rootId,
    );
    const importedParent = Object.values(merged.generativeEdits ?? {}).find(
      (edit) => edit.id !== importedEdit?.id && edit.sourceNodeId === clone.rootId,
    );

    expect(imageAssetId).toBeTruthy();
    expect(imageAssetId).not.toBe('shared-image');
    expect(maskAssetId).toBeTruthy();
    expect(maskAssetId).not.toBe('shared-mask');
    expect(merged.assets?.shared?.dataUrl).toBeUndefined();
    expect(merged.assets?.['shared-image']?.dataUrl).toBe(targetAsset.dataUrl);
    expect(merged.assets?.[imageAssetId!]?.dataUrl).toBe(sourceAsset.dataUrl);
    expect(merged.rasterMaskAssets?.['shared-mask']?.dataUrl).toBe(targetMask.dataUrl);
    expect(merged.rasterMaskAssets?.[maskAssetId!]?.dataUrl).toBe(sourceMask.dataUrl);
    expect(clonedNode.fills?.[0]?.image?.src).toBe(sourceAsset.dataUrl);
    expect(clonedNode.fills?.[0]?.image?.generativeEditOverlay).toEqual({
      editId: importedEdit?.id,
      variationId: 'source-variation',
    });
    expect(clonedNode.fills?.[1]?.image?.generativeEditOverlay).toBeUndefined();
    expect(importedEdit?.parentEditId).toBe(importedParent?.id);
    expect(importedEdit?.sourceAssetId).toBe(imageAssetId);
    expect(importedEdit?.sourceSnapshotAssetId).toBe(imageAssetId);
    expect(importedEdit?.maskAssetId).toBe(maskAssetId);
    expect(importedEdit?.masks.userMaskAssetId).toBe(maskAssetId);
    expect(importedEdit?.variations[0]?.assetId).toBe(imageAssetId);
    expect(importedEdit?.variations[0]?.contextAssetId).toBe(imageAssetId);
  });
});
