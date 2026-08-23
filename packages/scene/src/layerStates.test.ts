import { describe, expect, it } from 'vitest';
import type { Affine } from '@varve/engine';
import type { ManagedColor, NodeId, SceneNode } from './types';
import type { Document } from './document';
import {
  addLayerState,
  applyLayerState,
  captureLayerState,
  normalizeLayerStates,
  recaptureLayerState,
  removeLayerState,
  renameLayerState,
} from './layerStates';

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const fill = { space: 'srgb', components: [0, 0, 0, 1] } as unknown as ManagedColor;

function shape(id: NodeId, over: Partial<{ visible: boolean; opacity: number; x: number }> = {}): SceneNode {
  return {
    kind: 'shape',
    id,
    name: id,
    visible: over.visible ?? true,
    opacity: over.opacity ?? 1,
    blendMode: 'normal',
    fill,
    transform: [1, 0, 0, 1, over.x ?? 0, 0],
  } as unknown as SceneNode;
}

function doc(): Document {
  return {
    id: 'd',
    name: 'd',
    formatVersion: 'test',
    rootChildren: ['a', 'b'],
    nodes: { a: shape('a'), b: shape('b', { visible: false, x: 50 }) },
    components: {},
    nextId: 3,
  } as unknown as Document;
}

describe('layerStates — capture / apply / integrity', () => {
  it('captures only the selected categories', () => {
    const state = captureLayerState(doc(), 'Solo', ['a', 'b'], ['visibility', 'transforms']);
    expect(state.categories).toEqual(['visibility', 'transforms']);
    expect(state.captured.visibility).toEqual({ a: true, b: false });
    expect(state.captured.transforms?.a).toEqual(IDENTITY);
    expect(state.captured.appearance).toBeUndefined();
  });

  it('applies a state to a new document without mutating the input', () => {
    const d = doc();
    const source = doc();
    (source.nodes.b as SceneNode & { visible: boolean }).visible = true;
    (source.nodes.b as SceneNode & { transform: Affine }).transform = IDENTITY;
    const state = captureLayerState(source, 'ShowAll', ['a', 'b'], ['visibility', 'transforms']);
    const { doc: applied } = applyLayerState(d, state);

    expect((applied.nodes.b as SceneNode & { visible: boolean }).visible).toBe(true);
    expect((applied.nodes.b as SceneNode & { transform?: Affine }).transform).toEqual(IDENTITY);
    // input untouched
    expect((d.nodes.b as SceneNode & { visible: boolean }).visible).toBe(false);
  });

  it('skips and reports nodes that no longer exist', () => {
    const d = doc();
    const source = doc();
    source.nodes.ghost = shape('ghost');
    const state = captureLayerState(source, 'Solo', ['a', 'ghost'], ['visibility']);
    const { doc: applied, skipped } = applyLayerState(d, state);
    expect(skipped).toEqual(['ghost']);
    expect((applied.nodes.a as SceneNode & { visible: boolean }).visible).toBe(true);
  });

  it('does not touch categories that were not captured', () => {
    const d = doc();
    const state = captureLayerState(d, 'Vis', ['a'], ['visibility']);
    const { doc: applied } = applyLayerState(d, state);
    // appearance/transform not captured → opacity stays as authored
    expect((applied.nodes.a as SceneNode & { opacity: number }).opacity).toBe(1);
    expect((applied.nodes.a as unknown as SceneNode & { transform?: Affine }).transform).toEqual(IDENTITY);
  });

  it('recaptures current values while keeping id/name', () => {
    const d = doc();
    const state = captureLayerState(d, 'S', ['a', 'b'], ['visibility']);
    // mutate b to visible, then recapture
    (d.nodes.b as SceneNode & { visible: boolean }).visible = true;
    const updated = recaptureLayerState(d, state);
    expect(updated.id).toBe(state.id);
    expect(updated.name).toBe('S');
    expect(updated.captured.visibility?.b).toBe(true);
  });
});

describe('layerStates — document storage', () => {
  it('adds, renames, and removes states on the document', () => {
    const d = doc();
    const state = captureLayerState(d, 'One', ['a'], ['visibility']);
    let next = addLayerState(d, state);
    expect(next.layerStates).toHaveLength(1);

    next = renameLayerState(next, state.id, 'Renamed');
    expect(next.layerStates?.[0]?.name).toBe('Renamed');

    next = removeLayerState(next, state.id);
    expect(next.layerStates).toHaveLength(0);
    // original doc never gained layerStates
    expect(d.layerStates).toBeUndefined();
  });

  it('normalizes malformed persisted entries without duplicating state ids', () => {
    const states = normalizeLayerStates([
      { id: 'state-1', name: 'Good', categories: ['visibility'], captured: {} },
      { id: 'state-1', name: 'Duplicate', categories: ['appearance'], captured: {} },
      null,
      { id: 'bad' },
    ]);
    expect(states).toHaveLength(1);
    expect(states[0]?.id).toBe('state-1');
    expect(states[0]?.categories).toEqual(['visibility']);
  });
});
