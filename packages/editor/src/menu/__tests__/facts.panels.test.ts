import type { SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeSelectionFacts } from '../facts';

function frame(id: string, panel = false, children: string[] = []) {
  return {
    id,
    kind: 'frame' as const,
    name: id,
    children,
    transform: [1, 0, 0, 1, 0, 0],
    ...(panel ? { panel: { version: 1, panelId: id } } : {}),
  };
}

describe('computeSelectionFacts — comic panel facts', () => {
  it('counts semantic panels in a multi-selection', () => {
    const nodes = {
      'panel-a': frame('panel-a', true),
      'panel-b': frame('panel-b', true),
      'plain-c': frame('plain-c'),
    } as unknown as Record<string, SceneNode>;
    const facts = computeSelectionFacts(['panel-a', 'panel-b', 'plain-c'], nodes);
    expect(facts.semanticPanelCount).toBe(2);
    expect(facts.count).toBe(3);
  });

  it('reports child panels of a single selected frame', () => {
    const nodes = {
      'parent-d': frame('parent-d', false, ['kid-1', 'kid-2', 'kid-3']),
      'kid-1': frame('kid-1', true),
      'kid-2': frame('kid-2', true),
      'kid-3': { id: 'kid-3', kind: 'rect', name: 'kid-3', transform: [1, 0, 0, 1, 0, 0] },
    } as unknown as Record<string, SceneNode>;
    const facts = computeSelectionFacts(['parent-d'], nodes);
    expect(facts.selectedFramePanelChildren).toBe(2);
    expect(facts.semanticPanelCount).toBe(0);
  });

  it('reports zero panel facts for ordinary selections', () => {
    const nodes = {
      'rect-e': { id: 'rect-e', kind: 'rect', name: 'rect-e', transform: [1, 0, 0, 1, 0, 0] },
    } as unknown as Record<string, SceneNode>;
    const facts = computeSelectionFacts(['rect-e'], nodes);
    expect(facts.semanticPanelCount).toBe(0);
    expect(facts.selectedFramePanelChildren).toBe(0);
  });
});
