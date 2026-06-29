import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { AppearanceSection } from './AppearanceSection';
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
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 10, 20] as const,
    fill: [57, 208, 198, 255] as const,
    strokes: [],
    effects: [],
    ...overrides,
  };
}

function renderWithProvider(element: React.ReactElement) {
  return render(<EditorProvider>{element}</EditorProvider>);
}

// ── PositionSizeSection ────────────────────────────────────────────────────

describe('PositionSizeSection', () => {
  it('renders X, Y fields from transform', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    expect(screen.getByLabelText('X (px)')).toBeTruthy();
    expect(screen.getByLabelText('Y (px)')).toBeTruthy();
    expect(screen.getByLabelText('W (px)')).toBeTruthy();
    expect(screen.getByLabelText('H (px)')).toBeTruthy();
  });

  it('shows Mixed for X axis when values differ', () => {
    const nodeA = createRectNode('n1', { transform: [1, 0, 0, 1, 10, 20] as const });
    const nodeB = createRectNode('n2', { transform: [1, 0, 0, 1, 30, 20] as const });
    renderWithProvider(<PositionSizeSection nodes={[nodeA, nodeB]} />);
    const input = screen.getByLabelText('X (px)') as HTMLInputElement;
    expect(input.getAttribute('aria-valuetext')).toBe('Mixed values');
  });

  it('renders proportion lock toggle button', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    const lockBtn = screen.getByRole('checkbox', { name: /constrain proportions/i });
    expect(lockBtn).toBeTruthy();
    expect(lockBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles proportion lock on click', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    const lockBtn = screen.getByRole('checkbox', { name: /constrain proportions/i });
    fireEvent.click(lockBtn);
    expect(lockBtn.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(lockBtn);
    expect(lockBtn.getAttribute('aria-checked')).toBe('false');
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
