// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type Adjustment, makeAdjustment } from '@varve/engine';
import {
  createDocument,
  type Document,
  type EffectLook,
  makeShapeNode,
  type SceneNode,
} from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context')>();
  return { ...actual, useEditor: vi.fn() };
});

import { useEditor } from '../../../context';
import { EffectStudioSection } from './EffectStudioSection';

const mockedUseEditor = vi.mocked(useEditor) as unknown as {
  (): ReturnType<typeof useEditor>;
  mockReturnValue: (value: unknown) => void;
};

function effectNode(id = 'shape-1', filters: Adjustment[] = []): SceneNode {
  return {
    ...makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 160, h: 100 },
      {
        name: 'Selected shape',
      },
    ),
    smartFilters: filters,
  } as SceneNode;
}

function updatedNode(node: SceneNode): SceneNode {
  const updateNode = mockedUseEditor().updateNode as unknown as ReturnType<typeof vi.fn>;
  const updater = updateNode.mock.calls.at(-1)?.[1] as
    | ((value: SceneNode) => SceneNode)
    | undefined;
  expect(updater).toBeDefined();
  return updater?.(node) ?? node;
}

describe('EffectStudioSection', () => {
  const updateNode = vi.fn();
  const updateDoc = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const abortTransaction = vi.fn();
  const addSmartFilterToSelected = vi.fn();
  const updateNodes = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      state: { sectionVisibility: {}, document: createDocument('Test', true) },
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
      hideInspectorSection: vi.fn(),
      updateNode,
      updateDoc,
      beginTransaction,
      commitTransaction,
      abortTransaction,
      addSmartFilterToSelected,
      updateNodes,
      announce,
    });
  });

  afterEach(cleanup);

  it('searches the canonical library and adds through the existing stack command', () => {
    render(<EffectStudioSection nodes={[effectNode()]} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search effects' }), {
      target: { value: 'retro' },
    });
    expect(screen.getByText('VHS')).toBeInTheDocument();
    expect(screen.queryByText('Brightness')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add VHS to stack' }));
    expect(addSmartFilterToSelected).toHaveBeenCalledWith('vhs', undefined);
  });

  it('previews, commits, replaces, and cancels without creating extra stack commands', () => {
    const node = effectNode();
    render(<EffectStudioSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Bloom' }));
    expect(beginTransaction).toHaveBeenCalledWith('preview');
    expect(updatedNode(node).smartFilters).toEqual([
      expect.objectContaining({ kind: 'bloom', visible: true }),
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(/Bloom/);

    fireEvent.click(screen.getByRole('button', { name: 'Add Bloom' }));
    expect(commitTransaction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Lens Flare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    expect(abortTransaction).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('Preview cancelled');
  });

  it('keeps Compare View ephemeral and restores the stack without an undo command', () => {
    const node = effectNode('shape-1', [makeAdjustment('grain-1', 'grain')]);
    render(<EffectStudioSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Compare original' }));
    expect(beginTransaction).toHaveBeenCalledWith('preview');
    expect(updatedNode(node).smartFiltersEnabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Show effects' }));
    expect(abortTransaction).toHaveBeenCalledTimes(1);
    expect(addSmartFilterToSelected).not.toHaveBeenCalled();
  });

  it('offers creative multi-effect presets without exposing correction controls', () => {
    const node = effectNode();
    render(<EffectStudioSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply Studio preset Chromatic Bloom' }));

    const updates = updateNodes.mock.calls.at(-1)?.[0] as
      | Array<{ update: (value: SceneNode) => SceneNode }>
      | undefined;
    const updated = updates?.[0]?.update(node);
    expect(updated?.smartFilters?.map((filter) => filter.kind)).toEqual(['bloom', 'rgbSplit']);
    expect(screen.queryByText('Brightness')).not.toBeInTheDocument();
  });

  it('saves Looks in the document and applies one through the object stack', () => {
    const node = effectNode('shape-1', [makeAdjustment('grain-1', 'grain')]);
    const document = createDocument('Test', true);
    const look: EffectLook = {
      id: 'look-warm',
      schemaVersion: 1,
      name: 'Warm',
      effects: [makeAdjustment('warm-1', 'brightness')],
    };
    mockedUseEditor.mockReturnValue({
      state: { sectionVisibility: {}, document: { ...document, effectLooks: [look] } },
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
      hideInspectorSection: vi.fn(),
      updateNode,
      updateDoc,
      beginTransaction,
      commitTransaction,
      abortTransaction,
      addSmartFilterToSelected,
      updateNodes,
      announce,
    });
    render(<EffectStudioSection nodes={[node]} />);

    fireEvent.change(screen.getByLabelText('Look name'), { target: { value: 'My Look' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current stack' }));
    const save = updateDoc.mock.calls.at(-1)?.[0] as ((value: Document) => Document) | undefined;
    const saved = save?.({ ...document, effectLooks: [] });
    expect(saved?.effectLooks?.[0]).toEqual(
      expect.objectContaining({
        name: 'My Look',
        effects: [expect.objectContaining({ kind: 'grain' })],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply Look Warm' }));
    expect(updatedNode(node).smartFilters).toEqual([
      expect.objectContaining({ kind: 'grain' }),
      expect.objectContaining({ kind: 'brightness' }),
    ]);
  });

  it('persists favorites locally and filters the library by them', () => {
    render(<EffectStudioSection nodes={[effectNode()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Favorite VHS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(screen.getByText('VHS')).toBeInTheDocument();
    expect(window.localStorage.getItem('varve:effect-studio:favorites')).toContain('vhs');
  });
});
