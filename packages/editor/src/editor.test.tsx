import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, type ToolId, useEditor } from './context';
import { Shell } from './Shell';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Shell', () => {
  it('renders all key regions', () => {
    render(<Shell />);
    // Menubar present
    expect(screen.getByRole('menubar')).toBeTruthy();
    // Toolbar present
    expect(screen.getByRole('toolbar')).toBeTruthy();
    // Canvas region present
    expect(screen.getByRole('region', { name: /canvas/i })).toBeTruthy();
    // Layers tree present
    expect(screen.getByRole('tree')).toBeTruthy();
    // Inspector region present
    expect(screen.getByRole('region', { name: /inspector/i })).toBeTruthy();
  });

  it('renders without canvas environment errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Shell />);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('EditorContext', () => {
  it('provides default state', () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    expect(ctx?.state.tool).toBe('select');
    expect(ctx?.state.zoom).toBe(1);
    expect(ctx?.state.selection).toEqual([]);
  });

  it('updates tool via setTool', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button type="button" onClick={() => ctx?.setTool('rect')}>
          set rect
        </button>
      );
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    screen.getByText('set rect').click();
    await waitFor(() => expect(ctx?.state.tool).toBe('rect'));
  });

  it('creates a named line shape from a dragged line tool gesture', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setTool('line' as ToolId);
            ctx?.createShapeAt({ x: 10, y: 20 }, { w: 80, h: 30 });
          }}
        >
          draw line
        </button>
      );
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('draw line').click();

    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const id = ctx?.state.selection[0];
    const node = id ? ctx?.state.document.nodes[id] : undefined;
    expect(node?.name).toBe('Line 1');
    expect(node?.kind).toBe('shape');
    expect(node?.kind === 'shape' ? node.shape : undefined).toEqual({
      kind: 'line',
      from: [0, 0],
      to: [80, 30],
      tolerance: 3,
    });
  });
});
