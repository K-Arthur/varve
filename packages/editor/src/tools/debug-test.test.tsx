import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolId } from '../context';
import { EditorProvider, useEditor } from '../context';

describe('Debug tool test', () => {
  it('debug: check toolRef', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      console.log('CONSOLE.ERROR:', JSON.stringify(args));
    });
    let ctx: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      ctx = useEditor();
      return null;
    }
    render(<EditorProvider><TestComponent /></EditorProvider>);
    if (!ctx) throw new Error('ctx not found');
    const editor = ctx;
    editor.setTool('rect' as ToolId);
    // Wait for state to flush
    await new Promise(r => setTimeout(r, 200));
    console.log('tool state after flush:', editor.state.tool);
    const initialNodes = Object.keys(editor.state.document.nodes).length;
    editor.createShapeAt({ x: 100, y: 100 }, { w: 50, h: 30 });
    await new Promise(r => setTimeout(r, 200));
    console.log('nodes after createShapeAt:', Object.keys(editor.state.document.nodes).length);
    console.log('tool state now:', editor.state.tool);
    errorSpy.mockRestore();
    expect(true).toBe(true);
  });
});
