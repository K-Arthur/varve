// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function updatedBatchNode(node: SceneNode): SceneNode {
  const updates = mockedUseEditor().updateNodes as unknown as ReturnType<typeof vi.fn>;
  const batch = updates.mock.calls.at(-1)?.[0] as
    | Array<{ update: (value: SceneNode) => SceneNode }>
    | undefined;
  expect(batch).toBeDefined();
  return batch?.[0]?.update(node) ?? node;
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

  it('searches curated treatments and applies their full editable stack', () => {
    render(<EffectStudioSection nodes={[effectNode()]} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search treatments' }), {
      target: { value: 'crosshatch' },
    });
    expect(screen.getByText('Crosshatch')).toBeInTheDocument();
    expect(screen.queryByText('Brightness')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Crosshatch' }));
    expect(updatedBatchNode(effectNode()).smartFilters?.map((filter) => filter.kind)).toEqual([
      'blackAndWhite',
      'halftone',
    ]);
  });

  it('previews, commits, replaces, and cancels without creating extra stack commands', () => {
    const node = effectNode();
    render(<EffectStudioSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Chromatic Bloom' }));
    expect(beginTransaction).toHaveBeenCalledWith('preview');
    expect(updatedNode(node).smartFilters?.map((filter) => filter.kind)).toEqual([
      'bloom',
      'rgbSplit',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(/Chromatic Bloom/);

    fireEvent.click(screen.getByRole('button', { name: 'Apply Chromatic Bloom' }));
    expect(commitTransaction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Aperture Star' }));
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

  it('keeps low-level primitives separate from the curated gallery', () => {
    const node = effectNode();
    render(<EffectStudioSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply Palette Cut' }));
    expect(updatedBatchNode(node).smartFilters?.map((filter) => filter.kind)).toEqual([
      'posterize',
      'paletteSnap',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Add VHS primitive to stack' }));
    expect(addSmartFilterToSelected).toHaveBeenCalledWith('vhs', undefined);
    expect(screen.getByText(/Use Image Tuning for photo correction/i)).toBeInTheDocument();
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

  it('persists saved treatments locally and filters the gallery by them', () => {
    render(<EffectStudioSection nodes={[effectNode()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Analog Signal' }));
    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Treatment gallery filters' })).getByRole(
        'button',
        {
          name: 'Saved',
        },
      ),
    );
    expect(screen.getByText('Analog Signal')).toBeInTheDocument();
    expect(window.localStorage.getItem('varve:effect-studio:favorites')).toContain(
      'studio-analog-signal',
    );
  });

  it('migrates saved primitive IDs to their closest curated treatment', () => {
    window.localStorage.setItem('varve:effect-studio:favorites', JSON.stringify(['vhs']));
    render(<EffectStudioSection nodes={[effectNode()]} />);

    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Treatment gallery filters' })).getByRole(
        'button',
        {
          name: 'Saved',
        },
      ),
    );
    expect(screen.getByText('Analog Signal')).toBeInTheDocument();
    expect(window.localStorage.getItem('varve:effect-studio:favorites')).toContain(
      'studio-analog-signal',
    );
  });
});
