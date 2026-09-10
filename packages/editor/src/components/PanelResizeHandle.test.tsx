// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultPanelWidth, PANEL_LIMITS, PanelResizeHandle } from './PanelResizeHandle';

describe('PanelResizeHandle semantics', () => {
  it('exposes the default width when no persisted width exists', () => {
    render(<PanelResizeHandle side="layers" width={null} onResize={vi.fn()} />);

    const splitter = screen.getByRole('separator', { name: 'Resize layers panel' });
    expect(splitter).toHaveAttribute(
      'aria-valuenow',
      String(defaultPanelWidth('layers', window.innerWidth)),
    );
    expect(splitter).toHaveAttribute('aria-valuemin', String(PANEL_LIMITS.layers.min));
    expect(splitter).toHaveAttribute('aria-valuemax', String(PANEL_LIMITS.layers.max));
    expect(splitter).toHaveAttribute('aria-valuetext', expect.stringContaining('pixels'));
    expect(splitter).toHaveAttribute('aria-controls', 'editor-layers-panel');
  });

  it('exposes a persisted width and supports keyboard resize', () => {
    const onResize = vi.fn();
    render(<PanelResizeHandle side="inspector" width={360} onResize={onResize} />);

    const splitter = screen.getByRole('separator', { name: 'Resize inspector panel' });
    expect(splitter).toHaveAttribute('aria-valuenow', '360');
    expect(splitter).toHaveAttribute('aria-controls', 'editor-inspector-panel');

    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(376);
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(onResize).toHaveBeenCalledWith(PANEL_LIMITS.inspector.min);
  });
});
