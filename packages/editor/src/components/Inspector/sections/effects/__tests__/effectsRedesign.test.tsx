// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Effect, ShapeNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../context')>();
  return { ...actual, useEditor: vi.fn() };
});

import { useEditor } from '../../../../../context';
import { EffectsSection } from '../../EffectsSection';

const mockedUseEditor = vi.mocked(useEditor) as unknown as {
  (): ReturnType<typeof useEditor>;
  mockReturnValue: (value: unknown) => void;
};

function nodeWithShadow(
  id: string,
  overrides: Partial<Extract<Effect, { type: 'dropShadow' }>> = {},
): ShapeNode {
  return {
    id,
    kind: 'shape' as const,
    name: 'Card',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 200, h: 120 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    visible: true,
    locked: false,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
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
        ...overrides,
      },
    ],
  };
}

function nodeWithBlur(id: string, radius = 8): ShapeNode {
  return {
    id,
    kind: 'shape' as const,
    name: 'Photo',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 200, h: 120 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    visible: true,
    locked: false,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 100, g: 150, b: 200, a: 255 },
    strokes: [],
    effects: [
      {
        type: 'layerBlur' as const,
        radius,
        visible: true,
      },
    ],
  };
}

describe('Effects Redesign — Elevation Presets & 2D Light Pad', () => {
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

  it('renders elevation preset buttons inside the shadow popover', async () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    // Expand shadow parameters
    fireEvent.click(screen.getByRole('button', { name: /expand drop shadow parameters/i }));

    const presetsGroup = await screen.findByRole('group', { name: /shadow elevation presets/i });
    expect(presetsGroup).toBeTruthy();

    expect(screen.getByRole('button', { name: /subtle/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /medium/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /raised/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /dramatic/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ambient/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /graphic/i })).toBeTruthy();
  });

  it('applies dramatic elevation preset on click', async () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand drop shadow parameters/i }));

    const dramaticBtn = await screen.findByRole('button', { name: /dramatic/i });
    fireEvent.click(dramaticBtn);

    expect(beginTransaction).toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith('n1', expect.any(Function));
    expect(commitTransaction).toHaveBeenCalled();
  });

  it('renders interactive 2D Light Pad with compass direction snap buttons', async () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand drop shadow parameters/i }));

    const lightPad = await screen.findByRole('slider', { name: /light direction angle/i });
    expect(lightPad).toBeTruthy();

    expect(screen.getByRole('button', { name: /light down 90 degrees/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /light bottom-right 45 degrees/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /center 0 offset/i })).toBeTruthy();
  });

  it('updates light angle via snap buttons', async () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand drop shadow parameters/i }));

    const snapDown = await screen.findByRole('button', { name: /light down 90 degrees/i });
    fireEvent.click(snapDown);

    expect(beginTransaction).toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalled();
    expect(commitTransaction).toHaveBeenCalled();
  });

  it('provides direct in-row blur radius editing for layer blur', async () => {
    render(<EffectsSection nodes={[nodeWithBlur('n1', 12)]} />);

    const inRowInput = screen.getByLabelText(/layer blur radius/i) as HTMLInputElement;
    expect(inRowInput).toBeTruthy();
    expect(inRowInput.value).toBe('12');

    fireEvent.change(inRowInput, { target: { value: '24' } });
    expect(beginTransaction).toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith('n1', expect.any(Function));
    expect(commitTransaction).toHaveBeenCalled();
  });

  it('renders quick blur radius chips inside blur popover', async () => {
    render(<EffectsSection nodes={[nodeWithBlur('n1', 12)]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand layer blur parameters/i }));

    const chipsGroup = await screen.findByRole('group', { name: /blur radius presets/i });
    expect(chipsGroup).toBeTruthy();

    const chip16 = screen.getByRole('button', { name: '16px' });
    expect(chip16).toBeTruthy();
    fireEvent.click(chip16);

    expect(beginTransaction).toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith('n1', expect.any(Function));
    expect(commitTransaction).toHaveBeenCalled();
  });

  it('displays live preview tile inside the focused editor', async () => {
    render(<EffectsSection nodes={[nodeWithShadow('n1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /expand drop shadow parameters/i }));

    const preview = await screen.findByRole('img', { name: /preview of drop shadow/i });
    expect(preview).toBeTruthy();
  });
});
