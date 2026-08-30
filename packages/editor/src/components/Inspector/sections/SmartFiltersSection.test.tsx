// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { filterKindDisplayName } from '@varve/engine';
import { makeSmartFilter, type SceneNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context')>();
  return { ...actual, useEditor: vi.fn() };
});

import { useEditor } from '../../../context';
import { SmartFiltersSection } from './SmartFiltersSection';

const mockedUseEditor = vi.mocked(useEditor) as unknown as {
  (): ReturnType<typeof useEditor>;
  mockReturnValue: (value: unknown) => void;
};

function vectorNode(id = 'vector-1'): SceneNode {
  return {
    id,
    kind: 'shape',
    name: 'Gray rectangle',
    shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 120 },
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 128, g: 128, b: 128, a: 255 },
    visible: true,
    locked: false,
    opacity: 0.5,
    blendMode: 'normal',
    rotation: 0,
    strokes: [],
    effects: [],
    order: 'a0',
  } as SceneNode;
}

function imageNode(id = 'image-1'): SceneNode {
  return {
    ...vectorNode(id),
    name: 'Image',
    fills: [
      {
        type: 'image',
        image: { src: 'data:image/png;base64,AAAA', fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
  } as SceneNode;
}

function grainNode(id = 'grain-object-1'): SceneNode {
  return {
    ...vectorNode(id),
    smartFilters: [makeSmartFilter('grain-filter-1', 'grain')],
  } as SceneNode;
}

type NodeUpdater = (node: SceneNode) => SceneNode;

function latestUpdatedNode(node: SceneNode): SceneNode {
  const updateNode = mockedUseEditor().updateNode as unknown as ReturnType<typeof vi.fn>;
  const update = updateNode.mock.calls.at(-1)?.[1] as NodeUpdater | undefined;
  expect(update).toBeDefined();
  return update?.(node) ?? node;
}

describe('SmartFiltersSection — object finishing shortcuts', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      state: { sectionVisibility: {} },
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
      hideInspectorSection: vi.fn(),
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
    });
  });

  afterEach(cleanup);

  it('offers labelled object-finishing actions for a non-image vector object', () => {
    render(<SmartFiltersSection nodes={[vectorNode()]} />);

    expect(screen.getByRole('heading', { name: 'Object Finishing' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Add object finishing' })).toBeInTheDocument();
    expect(
      screen.getByText(/vector, text, or container object\. Its fill and opacity stay editable/i),
    ).toBeInTheDocument();

    for (const kind of ['grain', 'edgeFalloff', 'softBloom'] as const) {
      expect(
        screen.getByRole('button', {
          name: `Add ${filterKindDisplayName(kind)} object filter`,
        }),
      ).toHaveAttribute('data-object-finishing-action', kind);
    }
  });

  it.each([
    ['grain', { strength: 35, scale: 1, character: 60 }],
    ['edgeFalloff', { strength: -35, midpoint: 55, feather: 65 }],
    ['softBloom', { strength: 35, radius: 20, threshold: 0.35, softness: 0.45 }],
  ] as const)(
    'adds an immediately visible %s preset without changing object opacity',
    (kind, preset) => {
      const node = vectorNode();
      render(<SmartFiltersSection nodes={[node]} />);

      fireEvent.click(
        screen.getByRole('button', { name: `Add ${filterKindDisplayName(kind)} object filter` }),
      );

      const updated = latestUpdatedNode(node);
      expect(updated.opacity).toBe(0.5);
      expect(updated.smartFilters).toEqual([
        expect.objectContaining({ kind, visible: true, opacity: 1, ...preset }),
      ]);
      expect(announce).toHaveBeenCalledWith(`Added ${filterKindDisplayName(kind)} filter`);
    },
  );

  it('keeps advanced photo-local filters available with an honest flat-fill hint', () => {
    render(<SmartFiltersSection nodes={[vectorNode()]} />);

    expect(
      screen.getByText(/photo-local controls may be subtle on a flat fill/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Add Object Filter' }));

    for (const kind of ['microDetail', 'definition', 'atmosphere', 'dehaze'] as const) {
      expect(screen.getByRole('option', { name: filterKindDisplayName(kind) })).toBeInTheDocument();
    }
  });

  it('keeps the object-finishing shortcut specific to non-image objects', () => {
    render(<SmartFiltersSection nodes={[imageNode()]} />);

    expect(screen.queryByRole('heading', { name: 'Object Finishing' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Add Object Filter' })).toBeInTheDocument();
  });

  it('keeps the selected treatment editor compact and avoids repeating default metadata', () => {
    render(<SmartFiltersSection nodes={[grainNode()]} />);

    expect(screen.getByRole('button', { name: 'Grain' })).toBeInTheDocument();
    expect(screen.queryByText('Grain Amount value')).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Grain Amount slider' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Grain Amount value (%)' })).toBeInTheDocument();
    expect(screen.getAllByRole('slider')).toHaveLength(5);
    expect(document.querySelectorAll('.adj-editor__parameter-controls')).toHaveLength(4);
    expect(document.querySelector('.smart-filters__meta')).not.toBeInTheDocument();
  });
});
