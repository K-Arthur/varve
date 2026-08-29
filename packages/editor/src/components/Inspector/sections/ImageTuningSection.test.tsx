// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { makeSmartFilter, type SceneNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context')>();
  return { ...actual, useEditor: vi.fn() };
});

import { useEditor } from '../../../context';
import { ImageTuningSection } from './ImageTuningSection';

// Vitest 4 types mocks strictly; these tests intentionally return partial
// context values (only the fields under test), so loosen the return slot.
const mockedUseEditor = vi.mocked(useEditor) as unknown as {
  (): ReturnType<typeof useEditor>;
  mockReturnValue: (value: unknown) => void;
};

function imageNode(id: string, overrides: Record<string, unknown> = {}): SceneNode {
  return {
    id,
    kind: 'shape' as const,
    name: `Image ${id}`,
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 200, h: 120 },
    fills: [
      {
        type: 'image' as const,
        image: { src: 'data:image/png;base64,AAAA', fit: 'fill' as const, x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
    transform: [1, 0, 0, 1, 0, 0] as const,
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    strokes: [],
    effects: [],
    order: 'a0',
    ...overrides,
  } as SceneNode;
}

type NodeUpdater = { id: string; update: (node: SceneNode) => SceneNode };

function updatedNodes(nodes: readonly SceneNode[], callIndex = 0): SceneNode[] {
  const updateNodes = mockedUseEditor().updateNodes as unknown as ReturnType<typeof vi.fn>;
  const updaters = updateNodes.mock.calls[callIndex]?.[0] as readonly NodeUpdater[];
  expect(updaters).toHaveLength(nodes.length);
  return nodes.map((node) => {
    const updater = updaters.find((entry) => entry.id === node.id);
    expect(updater).toBeDefined();
    return updater?.update(node) ?? node;
  });
}

describe('ImageTuningSection', () => {
  const updateNodes = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const abortTransaction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      state: { sectionVisibility: {} },
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
      hideInspectorSection: vi.fn(),
      updateNodes,
      beginTransaction,
      commitTransaction,
      abortTransaction,
    });
  });

  afterEach(cleanup);

  it('adds the selected parameter to every image in a batch without replacing existing stacks', () => {
    const first = imageNode('image-1', {
      smartFilters: [makeSmartFilter('contrast-1', 'contrast', { value: 12 })],
    });
    const second = imageNode('image-2');

    render(<ImageTuningSection nodes={[first, second]} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Fine Texture' }), {
      target: { value: '34' },
    });

    expect(updateNodes).toHaveBeenCalledTimes(1);
    const [nextFirst, nextSecond] = updatedNodes([first, second]);
    expect(nextFirst?.smartFilters).toEqual([
      expect.objectContaining({ id: 'contrast-1', kind: 'contrast', value: 12 }),
      expect.objectContaining({ kind: 'microDetail', amount: 34, visible: true }),
    ]);
    expect(nextSecond?.smartFilters).toEqual([
      expect.objectContaining({ kind: 'microDetail', amount: 34, visible: true }),
    ]);
    expect(nextFirst?.smartFiltersEnabled).toBe(true);
    expect(nextSecond?.smartFiltersEnabled).toBe(true);
  });

  it('represents differing selected values as mixed instead of averaging them', () => {
    const first = imageNode('image-1', {
      smartFilters: [makeSmartFilter('detail-1', 'microDetail', { amount: 18 })],
    });
    const second = imageNode('image-2', {
      smartFilters: [makeSmartFilter('detail-2', 'microDetail', { amount: -24 })],
    });

    render(<ImageTuningSection nodes={[first, second]} />);

    expect(screen.getByRole('slider', { name: 'Fine Texture' })).toHaveAttribute(
      'aria-valuetext',
      'Mixed values',
    );
    expect(screen.getByRole('spinbutton', { name: /fine texture/i })).toHaveValue('—');
    expect(screen.getAllByText('Mixed').length).toBeGreaterThan(0);
  });

  it('bypasses an existing treatment without removing its stack entry or parameter', () => {
    const node = imageNode('image-1', {
      smartFilters: [makeSmartFilter('detail-1', 'microDetail', { amount: 42 })],
      smartFiltersEnabled: true,
    });

    render(<ImageTuningSection nodes={[node]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disable Fine Texture' }));

    const [next] = updatedNodes([node]);
    expect(next?.smartFilters).toEqual([
      expect.objectContaining({ id: 'detail-1', kind: 'microDetail', amount: 42, visible: false }),
    ]);
    expect(next?.smartFiltersEnabled).toBe(true);
  });

  it('resets one shared adjustment parameter without discarding its sibling control', () => {
    const node = imageNode('image-1', {
      smartFilters: [makeSmartFilter('tone-1', 'shadowHighlight', { shadows: 48, highlights: 36 })],
    });

    render(<ImageTuningSection nodes={[node]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Shadows' }));

    const [next] = updatedNodes([node]);
    expect(next?.smartFilters).toEqual([
      expect.objectContaining({ id: 'tone-1', shadows: 0, highlights: 36, visible: true }),
    ]);
  });

  it('coalesces slider changes into one gesture transaction and aborts it on Escape', () => {
    const node = imageNode('image-1');
    render(<ImageTuningSection nodes={[node]} />);
    const slider = screen.getByRole('slider', { name: 'Fine Texture' });

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.pointerUp(slider);

    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).toHaveBeenCalledTimes(1);
    expect(abortTransaction).not.toHaveBeenCalled();
    expect(updateNodes).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(slider);
    fireEvent.keyDown(slider, { key: 'Escape' });

    expect(beginTransaction).toHaveBeenCalledTimes(2);
    expect(abortTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses treatment-scoped semantic groups and avoids bare Finish control names', () => {
    render(<ImageTuningSection nodes={[imageNode('image-1')]} />);

    expect(screen.getByRole('region', { name: 'Local Contrast & Depth' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Presence' })).not.toBeInTheDocument();

    const treatmentControls = [
      ['Fine Texture', 'Fine Texture'],
      ['Local Contrast', 'Local Contrast'],
      ['Atmospheric Depth', 'Atmospheric Depth'],
      ['Dehaze', 'Dehaze'],
      ['Vignette', 'Vignette Amount'],
      ['Grain', 'Grain Amount'],
      ['Highlight Glow', 'Glow Amount'],
    ] as const;

    for (const [treatmentName, controlName] of treatmentControls) {
      const treatment = screen.getByRole('group', { name: treatmentName });
      expect(within(treatment).getByRole('slider', { name: controlName })).toBeInTheDocument();
      expect(
        within(treatment).getByText(`Advanced ${treatmentName} settings`, { exact: true }),
      ).toBeInTheDocument();
    }

    const grain = screen.getByRole('group', { name: 'Grain' });
    expect(grain).toHaveAccessibleDescription(
      'Deterministic photographic grain anchored to the image.',
    );
    fireEvent.click(within(grain).getByText('Advanced Grain settings', { exact: true }));

    for (const label of ['Grain Amount', 'Grain Size', 'Grain Roughness', 'Pattern Variation']) {
      expect(within(grain).getByRole('slider', { name: label })).toBeInTheDocument();
    }
    for (const ambiguousLabel of ['Strength', 'Scale', 'Character', 'Seed']) {
      expect(within(grain).queryByRole('slider', { name: ambiguousLabel })).not.toBeInTheDocument();
    }
  });
});
