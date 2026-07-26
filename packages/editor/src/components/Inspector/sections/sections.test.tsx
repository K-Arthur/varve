import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { AppearanceSection } from './AppearanceSection';
import { FillSection } from './FillSection';
import { ImagePlacementSection } from './ImagePlacementSection';
import { PositionSizeSection } from './PositionSizeSection';

afterEach(cleanup);

function createRectNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'shape' as const,
    name: 'Rect',
    index: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 10, 20] as const,
    fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } as const,
    strokes: [],
    effects: [],
    ...overrides,
  };
}

function renderWithProvider(element: React.ReactElement) {
  return render(<EditorProvider>{element}</EditorProvider>);
}

function createTextNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'text' as const,
    name: 'Label',
    index: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
    text: 'Hello world',
    fontSize: 16,
    transform: [1, 0, 0, 1, 10, 20] as const,
    fill: { space: 'rgb' as const, r: 240, g: 240, b: 240, a: 255 } as const,
    strokes: [],
    effects: [],
    ...overrides,
  };
}

// ── PositionSizeSection ────────────────────────────────────────────────────

describe('PositionSizeSection', () => {
  it('renders X, Y fields from transform', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    expect(screen.getByLabelText(/X.*\(px\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Y.*\(px\)/)).toBeTruthy();
    expect(screen.getByLabelText('W (px)')).toBeTruthy();
    expect(screen.getByLabelText('H (px)')).toBeTruthy();
  });

  it('keeps responsive clamp sizing out of core geometry', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    expect(screen.queryByLabelText('Min W (px)')).toBeNull();
    expect(screen.queryByLabelText('Max W (px)')).toBeNull();
    expect(screen.queryByLabelText('Min H (px)')).toBeNull();
    expect(screen.queryByLabelText('Max H (px)')).toBeNull();
  });

  it('shows Mixed for X axis when values differ', () => {
    const nodeA = createRectNode('n1', { transform: [1, 0, 0, 1, 10, 20] as const });
    const nodeB = createRectNode('n2', { transform: [1, 0, 0, 1, 30, 20] as const });
    renderWithProvider(<PositionSizeSection nodes={[nodeA, nodeB]} />);
    const input = screen.getByLabelText(/X.*\(px\)/) as HTMLInputElement;
    expect(input.getAttribute('aria-valuetext')).toBe('Mixed values');
  });

  it('renders proportion lock toggle button', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    const lockBtn = screen.getByRole('checkbox', {
      name: /constrain proportions/i,
    }) as HTMLInputElement;
    expect(lockBtn).toBeTruthy();
    expect(lockBtn.checked).toBe(false);
  });

  it('toggles proportion lock on click', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    const lockBtn = screen.getByRole('checkbox', {
      name: /constrain proportions/i,
    }) as HTMLInputElement;
    fireEvent.click(lockBtn);
    expect(lockBtn.checked).toBe(true);
    fireEvent.click(lockBtn);
    expect(lockBtn.checked).toBe(false);
  });
});

// ── AppearanceSection ───────────────────────────────────────────────────────

describe('AppearanceSection', () => {
  it('renders opacity and blend mode controls', () => {
    const node = createRectNode('n1');
    renderWithProvider(<AppearanceSection nodes={[node]} />);
    expect(screen.getByLabelText('Opacity')).toBeTruthy();
    expect(screen.getByLabelText('Blend mode')).toBeTruthy();
  });

  it('shows opacity Mixed indicator for multi-select with differing values', () => {
    const nodeA = createRectNode('n1', { opacity: 0.5 });
    const nodeB = createRectNode('n2', { opacity: 1 });
    renderWithProvider(<AppearanceSection nodes={[nodeA, nodeB]} />);
    const input = screen.getByLabelText('Opacity') as HTMLInputElement;
    expect(input.getAttribute('aria-valuetext')).toBe('Mixed values');
  });
});

// ── FillSection ──────────────────────────────────────────────────────────

describe('FillSection', () => {
  it('renders exactly one contrast indicator for a text node with a solid fill', () => {
    // Regression test: FillRow used to render two ContrastIndicator components
    // for text nodes — one importing the wrong (fgColor/bgColor) props shape,
    // which crashed at runtime since that component actually expects
    // fill/fillIndex. Only the correct one should render. FillRow doesn't
    // pass a `background`, so checkContrast always returns a "background not
    // determined" warning — the dot renders regardless of the color chosen.
    const node = createTextNode('t1', {
      fill: { space: 'rgb' as const, r: 245, g: 245, b: 245, a: 255 },
    });
    const { container } = renderWithProvider(<FillSection nodes={[node]} />);
    const dots = container.querySelectorAll('.insp-contrast-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.className).toContain('insp-contrast-dot--warn');
  });
});

describe('ImagePlacementSection', () => {
  it('can transition from an incompatible node to an image without changing hook order', () => {
    const rect = createRectNode('n1');
    const image = createRectNode('i1', {
      fills: [
        {
          type: 'image' as const,
          image: {
            src: 'data:image/png;base64,AA',
            fit: 'fill' as const,
            x: 0,
            y: 0,
            scale: 1,
          },
        },
      ],
    });
    const view = renderWithProvider(<ImagePlacementSection nodes={[rect]} />);
    expect(screen.queryByText('Image Placement')).toBeNull();
    expect(() =>
      view.rerender(
        <EditorProvider>
          <ImagePlacementSection nodes={[image]} />
        </EditorProvider>,
      ),
    ).not.toThrow();
    expect(screen.getAllByText('Image Placement')).toHaveLength(2);
  });
});
