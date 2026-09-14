import { makeGroupNode, makeRasterLayerNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { liquifyUnsupportedReason, resolveLiquifyTarget } from './LiquifyTool';
import type { ToolContext } from './types';

function frequencyDocument() {
  const low = {
    ...makeRasterLayerNode('tone', { width: 80, height: 60 }),
    frequencySeparationRole: { groupId: 'separation', role: 'low' as const },
  };
  const high = {
    ...makeRasterLayerNode('detail', { width: 80, height: 60 }),
    frequencySeparationRole: { groupId: 'separation', role: 'high' as const },
  };
  const group = {
    ...makeGroupNode('separation', { children: ['tone', 'detail'] }),
    frequencySeparation: {
      version: 1 as const,
      method: 'gaussian' as const,
      radius: 4,
      lowNodeId: 'tone',
      highNodeId: 'detail',
    },
  };
  return { nodes: { separation: group, tone: low, detail: high } };
}

describe('Liquify target resolution', () => {
  it('allows an explicitly selected frequency band as an advanced target', () => {
    const document = frequencyDocument();
    const context = { document, selection: ['detail'] } as unknown as Pick<
      ToolContext,
      'document' | 'selection'
    >;

    expect(resolveLiquifyTarget(context)).toMatchObject({
      id: 'detail',
      width: 80,
      height: 60,
      freezeSupported: true,
    });
    expect(liquifyUnsupportedReason(context)).toBeNull();
  });
});
