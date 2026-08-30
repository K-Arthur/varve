// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeAdjustment } from '@varve/engine';
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

function effectNode(id = 'shape-1', filters = []): SceneNode {
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
      announce,
    });
  });

  afterEach(cleanup);

  it('searches the canonical library and adds through the existing stack command', () => {
    render(<EffectStudioSection nodes={[effectNode()]} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search effects' }), {
      target: { value: 'film' },
    });
    expect(screen.getByText('Grain')).toBeInTheDocument();
    expect(screen.queryByText('Brightness')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Grain to stack' }));
    expect(addSmartFilterToSelected).toHaveBeenCalledWith('grain', undefined);
  });

  it('previews, commits, replaces, and cancels without creating extra stack commands', () => {
    const node = effectNode();
    render(<EffectStudioSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Brightness' }));
    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(updatedNode(node).smartFilters).toEqual([
      expect.objectContaining({ kind: 'brightness', visible: true }),
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(/Brightness/);

    fireEvent.click(screen.getByRole('button', { name: 'Add Brightness', exact: true }));
    expect(commitTransaction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Contrast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    expect(abortTransaction).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('Preview cancelled');
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

    fireEvent.click(screen.getByRole('button', { name: 'Favorite Grain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(screen.getByText('Grain')).toBeInTheDocument();
    expect(window.localStorage.getItem('varve:effect-studio:favorites')).toContain('grain');
  });
});
