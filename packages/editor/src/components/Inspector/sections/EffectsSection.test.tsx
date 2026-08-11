// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Effect, ShapeNode } from '@varve/scene';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context')>();
  return { ...actual, useEditor: vi.fn() };
});

import { useEditor } from '../../../context';
import { EffectsSection } from './EffectsSection';

// Vitest 4 types mocks strictly; these tests intentionally return partial
// context values (only the fields under test), so loosen the return slot.
const mockedUseEditor = vi.mocked(useEditor) as unknown as {
  (): ReturnType<typeof useEditor>;
  mockReturnValue: (value: unknown) => void;
};

function nodeWithGlass(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'shape' as const,
    name: 'Rect',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    visible: true,
    locked: false,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    strokes: [],
    effects: [
      {
        type: 'glassMaterial' as const,
        blur: 12,
        tint: { space: 'rgb' as const, r: 200, g: 220, b: 255, a: 60 },
        tintOpacity: 0.3,
        saturation: 1.2,
        brightness: 1.05,
        noise: 0.02,
        edgeHighlight: true,
        edgeHighlightWidth: 1.5,
        edgeHighlightColor: {
          space: 'rgb' as const,
          r: 255,
          g: 255,
          b: 255,
          a: 120,
        },
        edgeHighlightOpacity: 0.4,
        visible: true,
      },
    ],
    ...overrides,
  };
}

type DropShadowEffect = Extract<Effect, { type: 'dropShadow' }>;

function nodeWithShadow(id: string): ShapeNode & { effects: [DropShadowEffect] } {
  return {
    id,
    kind: 'shape' as const,
    name: 'Rect',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    visible: true,
    locked: false,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    strokes: [],
    effects: [
      {
        type: 'dropShadow' as const,
        x: 0,
        y: 4,
        blur: 8,
        spread: 0,
        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 76 },
        opacity: 0.3,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
  };
}

describe('EffectsSection — glass material tint swatch', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('renders glass tint swatch for glass material effect', () => {
    render(<EffectsSection nodes={[nodeWithGlass('n1')]} />);
    expect(screen.getByRole('button', { name: /glass tint/i })).toBeTruthy();
  });

  it('does not render glass tint swatch for non-glass effects', () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    expect(screen.queryByRole('button', { name: /glass tint/i })).toBeNull();
  });

  it('opens color picker popover when tint swatch is clicked', async () => {
    render(<EffectsSection nodes={[nodeWithGlass('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /glass tint/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /pick glass tint/i })).toBeTruthy();
    });
  });

  it('updates effect tint when color is selected in popover', async () => {
    render(<EffectsSection nodes={[nodeWithGlass('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /glass tint/i }));
    await screen.findByRole('dialog', { name: /pick glass tint/i });

    const teal = screen.getByRole('option', { name: /teal 500/i });
    fireEvent.click(teal);

    expect(beginTransaction).toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith('n1', expect.any(Function));
    expect(commitTransaction).toHaveBeenCalled();
  });

  it('shows correct swatch background for custom tint', () => {
    const customTint = {
      space: 'rgb' as const,
      r: 100,
      g: 200,
      b: 150,
      a: 80,
    };
    const node = nodeWithGlass('n1', {
      effects: [
        {
          type: 'glassMaterial' as const,
          blur: 12,
          tint: customTint,
          tintOpacity: 0.3,
          saturation: 1.2,
          brightness: 1.05,
          noise: 0.02,
          edgeHighlight: true,
          edgeHighlightWidth: 1.5,
          edgeHighlightColor: {
            space: 'rgb' as const,
            r: 255,
            g: 255,
            b: 255,
            a: 120,
          },
          edgeHighlightOpacity: 0.4,
          visible: true,
        },
      ],
    });
    render(<EffectsSection nodes={[node]} />);
    const swatch = screen.getByRole('button', { name: /glass tint/i });
    // managedColorToRgba returns [100, 200, 150, 80]; 80/255 ≈ 0.31
    expect(swatch).toHaveStyle({ background: 'rgba(100,200,150,0.31)' });
  });

  it('preserves default blue tint when no custom tint is set', () => {
    render(<EffectsSection nodes={[nodeWithGlass('n1')]} />);
    const swatch = screen.getByRole('button', { name: /glass tint/i });
    // managedColorToRgba returns [200, 220, 255, 60]; 60/255 ≈ 0.24
    expect(swatch).toHaveStyle({ background: 'rgba(200,220,255,0.24)' });
  });
});

function nodeWithChromaticAberration(id: string) {
  return {
    id,
    kind: 'shape' as const,
    name: 'Rect',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    visible: true,
    locked: false,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    strokes: [],
    effects: [
      {
        type: 'chromaticAberration' as const,
        offsets: { redX: 3, redY: 0, greenX: 0, greenY: 0, blueX: -3, blueY: 0 },
        intensity: 1,
        blendMode: 'normal' as const,
        opacity: 1,
        visible: true,
      },
    ],
  };
}

function nodeWithGlitch(id: string) {
  return {
    id,
    kind: 'shape' as const,
    name: 'Rect',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    visible: true,
    locked: false,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    strokes: [],
    effects: [
      {
        type: 'glitch' as const,
        seed: 42,
        strength: 8,
        density: 0.3,
        sliceHeight: 8,
        blockCount: 5,
        blockSize: 20,
        blockStrength: 10,
        noiseIntensity: 0.05,
        scanlineIntensity: 0.15,
        scanlineSpacing: 4,
        direction: 'horizontal' as const,
        channelShift: { redX: 0, redY: 0, greenX: 0, greenY: 0, blueX: 0, blueY: 0 },
        channelShiftMode: 'static' as const,
        blendMode: 'normal' as const,
        opacity: 1,
        visible: true,
      },
    ],
  };
}

function nodeWithOuterGlow(id: string) {
  return {
    id,
    kind: 'shape' as const,
    name: 'Rect',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    visible: true,
    locked: false,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    strokes: [],
    effects: [
      {
        type: 'outerGlow' as const,
        blur: 6,
        spread: 0,
        color: { space: 'rgb' as const, r: 255, g: 200, b: 100, a: 128 },
        opacity: 0.6,
        blendMode: 'screen' as const,
        visible: true,
      },
    ],
  };
}

describe('EffectsSection — per-row collapse/expand', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('collapses effect parameters by default', () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    expect(screen.queryByLabelText('Blur')).toBeNull();
    expect(screen.getByRole('button', { name: /expand dropShadow parameters/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('reveals effect parameters when the row is expanded', () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand dropShadow parameters/i }));
    expect(screen.getByLabelText('Blur')).toBeTruthy();
    expect(screen.getByRole('button', { name: /collapse dropShadow parameters/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('collapses parameters again on a second click', () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    const toggle = screen.getByRole('button', { name: /expand dropShadow parameters/i });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Blur')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /collapse dropShadow parameters/i }));
    expect(screen.queryByLabelText('Blur')).toBeNull();
  });

  it('mounts a newly added effect already expanded', () => {
    // updateNode must actually apply the updater and re-render with the new
    // node for this — the plain vi.fn() spy used by the other tests in this
    // file never mutates `nodes`, so a second effect row would never appear.
    function StatefulHarness() {
      const [node, setNode] = useState(nodeWithShadow('n1'));
      mockedUseEditor.mockReturnValue({
        updateNode: (_id: string, updater: (n: typeof node) => typeof node) =>
          setNode((prev) => updater(prev)),
        beginTransaction,
        commitTransaction,
        announce,
        documentColorMode: 'rgb',
      });
      return <EffectsSection nodes={[node]} />;
    }

    render(<StatefulHarness />);
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // The pre-existing dropShadow row (index 0) stays collapsed…
    expect(screen.getAllByRole('button', { name: /expand dropShadow parameters/i })).toHaveLength(
      1,
    );
    // …but the newly added row (index 1, default type: dropShadow) opens expanded.
    expect(screen.getByRole('button', { name: /collapse dropShadow parameters/i })).toBeTruthy();
  });
});

describe('EffectsSection — effect type dropdown', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  function openDropdown() {
    const trigger = screen.getByRole('combobox', { name: /new effect type/i });
    fireEvent.click(trigger);
  }

  it('includes chromatic aberration in new effect type options', async () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    openDropdown();
    await waitFor(() => {
      const options = screen.getAllByRole('option');
      const labels = options.map((o) => o.textContent);
      expect(labels).toContain('Chromatic Aberration');
    });
  });

  it('includes glitch in new effect type options', () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    openDropdown();
    const options = screen.getAllByRole('option');
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain('Glitch');
  });
});

describe('EffectsSection — chromatic aberration', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('renders effect row with type label', () => {
    render(<EffectsSection nodes={[nodeWithChromaticAberration('n1')]} />);
    expect(screen.getByText((c) => c.includes('chromaticAberration'))).toBeTruthy();
  });

  it('renders intensity control once expanded', () => {
    render(<EffectsSection nodes={[nodeWithChromaticAberration('n1')]} />);
    // Params are collapsed by default (see EffectsSection's per-row disclosure).
    fireEvent.click(screen.getByRole('button', { name: /expand chromaticAberration parameters/i }));
    expect(screen.getByLabelText('Intensity')).toBeTruthy();
  });

  it('renders opacity control once expanded', () => {
    render(<EffectsSection nodes={[nodeWithChromaticAberration('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand chromaticAberration parameters/i }));
    expect(screen.getByLabelText('Opacity')).toBeTruthy();
  });

  it('renders blend mode selector once expanded', () => {
    render(<EffectsSection nodes={[nodeWithChromaticAberration('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand chromaticAberration parameters/i }));
    expect(screen.getByLabelText('Aberration blend mode')).toBeTruthy();
  });
});

describe('EffectsSection — glitch', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('renders effect row with type label', () => {
    render(<EffectsSection nodes={[nodeWithGlitch('n1')]} />);
    expect(screen.getByText((c) => c.includes('glitch'))).toBeTruthy();
  });

  it('renders strength and density controls once expanded', () => {
    render(<EffectsSection nodes={[nodeWithGlitch('n1')]} />);
    // Params are collapsed by default (see EffectsSection's per-row disclosure).
    fireEvent.click(screen.getByRole('button', { name: /expand glitch parameters/i }));
    expect(screen.getByLabelText('Strength')).toBeTruthy();
    expect(screen.getByLabelText('Density')).toBeTruthy();
  });

  it('renders direction selector once expanded', () => {
    render(<EffectsSection nodes={[nodeWithGlitch('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand glitch parameters/i }));
    expect(screen.getByLabelText('Glitch direction')).toBeTruthy();
  });

  it('shows advanced section on click', async () => {
    render(<EffectsSection nodes={[nodeWithGlitch('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand glitch parameters/i }));
    const advancedBtn = screen.getByText('Advanced...');
    fireEvent.click(advancedBtn);
    await waitFor(() => {
      expect(screen.getByText('Hide advanced')).toBeTruthy();
    });
    expect(screen.getByLabelText('Slice Height')).toBeTruthy();
  });
});

describe('EffectsSection — outerGlow color swatch', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('renders effect color swatch for outer glows', () => {
    render(<EffectsSection nodes={[nodeWithOuterGlow('n1')]} />);
    expect(screen.getByRole('button', { name: /effect colour/i })).toBeTruthy();
  });
});

describe('EffectsSection — group-level effects', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('renders effects for group nodes so group shadows are editable', () => {
    const group = {
      id: 'g1',
      kind: 'group' as const,
      name: 'Group',
      transform: [1, 0, 0, 1, 0, 0] as const,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      visible: true,
      locked: false,
      order: 'a0',
      children: ['n1'],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      effects: [
        {
          type: 'dropShadow' as const,
          x: 0,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 76 },
          opacity: 0.3,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    };
    render(<EffectsSection nodes={[group]} />);
    expect(screen.getByText('Drop Shadow')).toBeTruthy();
    expect(screen.getByLabelText('Remove effect')).toBeTruthy();
  });
});

describe('EffectsSection — stack actions', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('duplicates an effect next to its source with a fresh stable id', () => {
    const node = nodeWithShadow('n1');
    node.effects[0] = { ...node.effects[0], id: 'source-effect' };
    render(<EffectsSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate effect' }));

    const updater = updateNode.mock.calls[0]?.[1] as (value: typeof node) => typeof node;
    const updated = updater(node);
    expect(updated.effects).toHaveLength(2);
    expect(updated.effects[0]?.id).toBe('source-effect');
    expect(updated.effects[1]?.id).toBeTypeOf('string');
    expect(updated.effects[1]?.id).not.toBe('source-effect');
    expect(updated.effects[1]?.type).toBe('dropShadow');
    expect(announce).toHaveBeenCalledWith('Effect duplicated');
  });

  it('resets parameters while preserving the effect identity', () => {
    const node = nodeWithShadow('n1');
    node.effects[0] = {
      ...node.effects[0],
      id: 'stable-effect',
      x: 30,
      y: -12,
      blur: 80,
      opacity: 0.9,
      visible: false,
    };
    render(<EffectsSection nodes={[node]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset effect' }));

    const updater = updateNode.mock.calls[0]?.[1] as (value: typeof node) => typeof node;
    const updated = updater(node);
    expect(updated.effects[0]).toMatchObject({
      id: 'stable-effect',
      type: 'dropShadow',
      x: 0,
      y: 4,
      blur: 8,
      opacity: 0.3,
      visible: true,
    });
    expect(announce).toHaveBeenCalledWith('Effect reset');
  });
});

describe('EffectsSection — glitch displacement controls', () => {
  const updateNode = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const announce = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseEditor.mockReturnValue({
      updateNode,
      beginTransaction,
      commitTransaction,
      announce,
      documentColorMode: 'rgb',
    });
  });

  afterEach(cleanup);

  it('exposes block strength, channel mode, and per-channel offsets', () => {
    render(<EffectsSection nodes={[nodeWithGlitch('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand glitch parameters/i }));
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));

    expect(screen.getByLabelText('Block Strength')).toBeTruthy();
    expect(screen.getByLabelText('Channel shift mode')).toBeTruthy();
    expect(screen.getByLabelText('Red X')).toBeTruthy();
    expect(screen.getByLabelText('Green Y')).toBeTruthy();
    expect(screen.getByLabelText('Blue X')).toBeTruthy();
  });

  it('updates a channel offset through one undo transaction', () => {
    const node = nodeWithGlitch('n1');
    render(<EffectsSection nodes={[node]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand glitch parameters/i }));
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    const redX = screen.getByLabelText('Red X');
    fireEvent.change(redX, { target: { value: '12' } });
    fireEvent.blur(redX);

    expect(beginTransaction).toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith('n1', expect.any(Function));
    expect(commitTransaction).toHaveBeenCalled();
  });
});
