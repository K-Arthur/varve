// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context')>();
  return { ...actual, useEditor: vi.fn() };
});

import { useEditor } from '../../../context';
import { EffectsSection } from './EffectsSection';

const mockedUseEditor = useEditor as unknown as ReturnType<typeof vi.fn>;

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

function nodeWithShadow(id: string) {
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
