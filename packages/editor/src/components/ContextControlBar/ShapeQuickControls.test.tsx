import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { defaultStroke, makePaint, makeShapeNode, solidFill } from '@varve/scene';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { ShapeQuickControls } from './ShapeQuickControls';

vi.mock('../../context', () => ({ useEditor: vi.fn() }));

vi.mock('@varve/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/ui')>();
  return {
    ...actual,
    Icon: () => <span aria-hidden="true" />,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

vi.mock('../Inspector/controls/InspectorColorPopover', () => ({
  InspectorColorPopover: ({
    label,
    onChange,
    disabled,
    tooltipDisabledReason,
    swatchStyle,
  }: {
    label: string;
    onChange: (color: { space: 'rgb'; r: number; g: number; b: number; a: number }) => void;
    disabled?: boolean;
    tooltipDisabledReason?: string;
    swatchStyle?: CSSProperties;
  }) => (
    <button
      type="button"
      aria-label={label}
      title={tooltipDisabledReason}
      disabled={disabled}
      style={swatchStyle}
      onClick={() => onChange({ space: 'rgb', r: 12, g: 34, b: 56, a: 255 })}
    />
  ),
}));

const nextColor = { space: 'rgb' as const, r: 12, g: 34, b: 56, a: 255 };
const originalColor = { space: 'rgb' as const, r: 1, g: 2, b: 3, a: 255 };

function makeHarness(
  node = makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
  paints: Record<string, ReturnType<typeof makePaint>> = {},
) {
  const updateNode = vi.fn();
  const updateSelectedFillAt = vi.fn();
  const setSelectedFill = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());
  const editor = {
    state: { document: { nodes: { [node.id]: node }, paints } },
    setSelectedFill,
    updateSelectedFillAt,
    groupCompoundOperation,
    updateNode,
    beginTransaction,
    commitTransaction,
    announce: vi.fn(),
    documentColorMode: 'rgb',
  };
  vi.mocked(useEditor).mockReturnValue(editor as never);
  return {
    editor,
    updateNode,
    updateSelectedFillAt,
    setSelectedFill,
    groupCompoundOperation,
    beginTransaction,
    commitTransaction,
  };
}

describe('ShapeQuickControls actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the visible first inline fill instead of the ignored legacy fill field', () => {
    const firstFill = { ...solidFill(originalColor), opacity: 0.6, blendMode: 'multiply' as const };
    const shape = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fills: [firstFill, solidFill({ space: 'rgb', r: 90, g: 80, b: 70, a: 255 })],
    };
    const { updateSelectedFillAt, setSelectedFill, groupCompoundOperation } = makeHarness(shape);

    render(
      <ShapeQuickControls node={shape} setSelectedFlipH={vi.fn()} setSelectedFlipV={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fill colour' }));

    expect(groupCompoundOperation).toHaveBeenCalledWith('Change fill color', expect.any(Function));
    expect(updateSelectedFillAt).toHaveBeenCalledWith(0, { ...firstFill, color: nextColor });
    expect(setSelectedFill).not.toHaveBeenCalled();
  });

  it('keeps legacy single-fill nodes on the legacy fill command', () => {
    const shape = makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const { updateSelectedFillAt, setSelectedFill } = makeHarness(shape);

    render(
      <ShapeQuickControls node={shape} setSelectedFlipH={vi.fn()} setSelectedFlipV={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fill colour' }));

    expect(setSelectedFill).toHaveBeenCalledWith(nextColor);
    expect(updateSelectedFillAt).not.toHaveBeenCalled();
  });

  it('shows and blocks fills that need Inspector handling instead of writing an invisible legacy value', () => {
    const sharedFill = solidFill(originalColor);
    const paint = makePaint('shared-fill', 'Brand', sharedFill);
    const shape = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      paintRefs: [paint.id],
    };
    const { setSelectedFill, updateSelectedFillAt } = makeHarness(shape, { [paint.id]: paint });

    render(
      <ShapeQuickControls node={shape} setSelectedFlipH={vi.fn()} setSelectedFlipV={vi.fn()} />,
    );
    const fillButton = screen.getByRole('button', { name: 'Fill colour' });

    expect(fillButton).toBeDisabled();
    expect(fillButton).toHaveAttribute('title', expect.stringContaining('shared paint'));
    expect(fillButton).toHaveStyle({ background: 'rgba(1, 2, 3, 1.00)' });
    fireEvent.click(fillButton);
    expect(setSelectedFill).not.toHaveBeenCalled();
    expect(updateSelectedFillAt).not.toHaveBeenCalled();
  });

  it('edits stroke colour in the existing first stroke and preserves its other settings', () => {
    const stroke = { ...defaultStroke(), id: 'stroke-1', weight: 4 };
    const shape = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      strokes: [stroke],
    };
    const { updateNode, beginTransaction, commitTransaction } = makeHarness(shape);

    render(
      <ShapeQuickControls node={shape} setSelectedFlipH={vi.fn()} setSelectedFlipV={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stroke colour' }));

    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commitTransaction).toHaveBeenCalledOnce();
    const [, updater] = updateNode.mock.calls[0] as [
      string,
      (current: typeof shape) => typeof shape,
    ];
    expect(updater(shape).strokes?.[0]).toEqual({
      ...stroke,
      color: nextColor,
      gradient: undefined,
    });
  });

  it('disables the quick stroke swatch for gradient strokes instead of replacing them with solids', () => {
    const gradientColor = { space: 'rgb' as const, r: 30, g: 60, b: 90, a: 255 };
    const stroke = {
      ...defaultStroke(),
      id: 'stroke-gradient',
      gradient: {
        type: 'linear' as const,
        stops: [
          { position: 0, color: gradientColor },
          { position: 1, color: nextColor },
        ],
      },
    };
    const shape = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      strokes: [stroke],
    };
    const { updateNode, beginTransaction, commitTransaction } = makeHarness(shape);

    render(
      <ShapeQuickControls node={shape} setSelectedFlipH={vi.fn()} setSelectedFlipV={vi.fn()} />,
    );
    const strokeButton = screen.getByRole('button', { name: 'Stroke colour' });

    expect(strokeButton).toBeDisabled();
    expect(strokeButton).toHaveAttribute('title', expect.stringContaining('gradient'));
    expect(strokeButton).toHaveStyle({ background: 'rgba(30, 60, 90, 1.00)' });
    fireEvent.click(strokeButton);
    expect(updateNode).not.toHaveBeenCalled();
    expect(beginTransaction).not.toHaveBeenCalled();
    expect(commitTransaction).not.toHaveBeenCalled();
  });

  it('commits a valid stroke width and rejects out-of-range values', () => {
    const stroke = { ...defaultStroke(), id: 'stroke-1', weight: 2 };
    const shape = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      strokes: [stroke],
    };
    const { updateNode, beginTransaction, commitTransaction } = makeHarness(shape);

    render(
      <ShapeQuickControls node={shape} setSelectedFlipH={vi.fn()} setSelectedFlipV={vi.fn()} />,
    );
    const width = screen.getByRole('spinbutton', { name: 'Stroke width' });
    fireEvent.change(width, { target: { value: '7.5' } });
    fireEvent.blur(width);

    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commitTransaction).toHaveBeenCalledOnce();
    const [, updater] = updateNode.mock.calls[0] as [
      string,
      (current: typeof shape) => typeof shape,
    ];
    expect(updater(shape).strokes?.[0]?.weight).toBe(7.5);

    updateNode.mockClear();
    fireEvent.change(width, { target: { value: '1001' } });
    fireEvent.blur(width);
    expect(updateNode).not.toHaveBeenCalled();
  });

  it('adds the default stroke as one transaction', () => {
    const shape = makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const { updateNode, beginTransaction, commitTransaction } = makeHarness(shape);

    render(
      <ShapeQuickControls node={shape} setSelectedFlipH={vi.fn()} setSelectedFlipV={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add stroke' }));

    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commitTransaction).toHaveBeenCalledOnce();
    const [, updater] = updateNode.mock.calls[0] as [
      string,
      (current: typeof shape) => typeof shape,
    ];
    expect(updater(shape).strokes).toHaveLength(1);
    expect(updater(shape).strokes?.[0]?.weight).toBeGreaterThan(0);
  });
});
