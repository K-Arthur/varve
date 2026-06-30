// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Panel } from './Panel';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function getHandle() {
  return screen.getByRole('separator');
}

describe('Panel', () => {
  it('renders children', () => {
    render(
      <Panel storageKey="test" label="Resize sidebar">
        <span>Content</span>
      </Panel>,
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('resize handle has correct ARIA attributes', () => {
    render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={200}
        minWidth={100}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    expect(handle).toHaveAttribute('role', 'separator');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-label', 'Resize sidebar');
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    expect(handle).toHaveAttribute('aria-valuemin', '100');
    expect(handle).toHaveAttribute('aria-valuemax', '400');
  });

  it('handle is focusable', () => {
    render(
      <Panel storageKey="test" label="Resize sidebar" defaultWidth={200}>
        Content
      </Panel>,
    );
    const handle = getHandle();
    expect(handle.tabIndex).toBe(0);
  });

  it('ArrowLeft decreases width by 10px', () => {
    const { container } = render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={200}
        minWidth={50}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('190px');
  });

  it('ArrowRight increases width by 10px', () => {
    const { container } = render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={200}
        minWidth={50}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('210px');
  });

  it('Shift+ArrowLeft decreases width by 40px', () => {
    const { container } = render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={200}
        minWidth={50}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('160px');
  });

  it('Shift+ArrowRight increases width by 40px', () => {
    const { container } = render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={200}
        minWidth={50}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('240px');
  });

  it('Home sets width to minWidth', () => {
    const { container } = render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={300}
        minWidth={80}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: 'Home' });
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('80px');
  });

  it('End sets width to maxWidth', () => {
    const { container } = render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={100}
        minWidth={50}
        maxWidth={500}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: 'End' });
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('500px');
  });

  it('clamps width to bounds', () => {
    const { container } = render(
      <Panel
        storageKey="test"
        label="Resize sidebar"
        defaultWidth={50}
        minWidth={100}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('100px');
  });

  it('persists width to localStorage on resize end', () => {
    render(
      <Panel
        storageKey="persist-test"
        label="Resize sidebar"
        defaultWidth={200}
        minWidth={50}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const handle = getHandle();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(localStorage.getItem('strata-panel-persist-test')).toBe('210');
  });

  it('restores width from localStorage on mount', () => {
    localStorage.setItem('strata-panel-restore-test', '350');
    const { container } = render(
      <Panel
        storageKey="restore-test"
        label="Resize sidebar"
        defaultWidth={200}
        minWidth={50}
        maxWidth={400}
      >
        Content
      </Panel>,
    );
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.style.getPropertyValue('--panel-width')).toBe('350px');
  });

  it('fires onCollapse when collapsed prop changes', () => {
    const onCollapse = vi.fn();
    const { rerender } = render(
      <Panel storageKey="test" label="Resize sidebar" collapsed={false} onCollapse={onCollapse}>
        Content
      </Panel>,
    );
    rerender(
      <Panel storageKey="test" label="Resize sidebar" collapsed={true} onCollapse={onCollapse}>
        Content
      </Panel>,
    );
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('renders with collapsed class when collapsed', () => {
    const { container } = render(
      <Panel storageKey="test" label="Resize sidebar" collapsed={true}>
        Content
      </Panel>,
    );
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.className).toContain('strata-panel--collapsed');
  });

  it('applies reduced-motion class when prefers-reduced-motion', () => {
    const matchMedia = window.matchMedia as unknown as ReturnType<typeof vi.fn>;
    matchMedia.mockReturnValue({
      matches: true,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    const { container } = render(
      <Panel storageKey="test" label="Resize sidebar">
        Content
      </Panel>,
    );
    const panelEl = container.firstChild as HTMLElement;
    expect(panelEl.className).toContain('strata-panel--reduced-motion');
  });
});
