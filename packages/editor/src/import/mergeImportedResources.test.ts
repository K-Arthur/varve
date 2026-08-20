import {
  createDocument,
  createVariableStore,
  deepCloneSubtree,
  makeFrameNode,
  makeGroupNode,
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

    expect(component?.masterRootId).toBe(clone.idMap.get(master.id));
    expect(clonedInstance.componentId).toBe(component?.id);
    expect(clonedInstance.styleId).toBe(style?.id);
    expect(clonedInstance.bindings?.fill.variableId).toBe(variable?.id);
    expect(interaction?.nodeId).toBe(clonedInstance.id);
    expect((interaction?.actions[0] as { targetId?: string } | undefined)?.targetId).toBe(
      clone.idMap.get(master.id),
    );
  });
});
