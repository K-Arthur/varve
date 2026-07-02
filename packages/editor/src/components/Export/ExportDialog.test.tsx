// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from './ExportDialog';

afterEach(cleanup);

function mockNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    name: 'Rectangle 1',
    kind: 'shape' as const,
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    fill: [200, 200, 200, 255] as [number, number, number, number],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    index: 0,
    order: 'a0',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    strokes: [],
    effects: [],
    presets: [
      {
        id: 'p1',
        format: 'png' as const,
        scale: { type: 'factor' as const, value: 2 },
        suffix: '@2x',
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe('ExportDialog', () => {
  it('renders when isOpen is true', () => {
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    expect(container.querySelector('.export-dialog-overlay')).toBeTruthy();
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ExportDialog
        isOpen={false}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    expect(container.querySelector('.export-dialog-overlay')).toBeNull();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(
      <ExportDialog
        isOpen={true}
        onClose={onClose}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('has correct aria attributes', () => {
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    const overlay = container.querySelector('.export-dialog-overlay');
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-modal')).toBe('true');
    expect(overlay?.getAttribute('aria-label')).toBe('Export');
  });

  it('closes on overlay click', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={onClose}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    const overlay = container.querySelector('.export-dialog-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('safe filename generation removes special chars', () => {
    const { container } = render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode({ name: 'test/file<>:"|?*.png' })]}
        onExport={async () => {}}
      />,
    );
    const fileNameEl = container.querySelector('.batch-job-row__name');
    expect(fileNameEl?.textContent).toContain('test');
  });

  it('shows close button when not running', () => {
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[mockNode()]}
        onExport={async () => {}}
      />,
    );
    expect(screen.getByText('Close')).toBeTruthy();
  });
});
