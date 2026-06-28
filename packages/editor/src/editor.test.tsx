import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from './context';
import { Shell } from './Shell';

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
    expect(ctx?.state.selection).toBeNull();
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
});
