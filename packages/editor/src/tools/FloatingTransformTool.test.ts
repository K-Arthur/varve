import { describe, expect, it, vi } from 'vitest';
import { FloatingTransformTool } from './FloatingTransformTool';
import type { ToolContext } from './types';

describe('FloatingTransformTool', () => {
  it('cancels and announces a floating pixel transform on Escape', () => {
    const cancelFloatingRaster = vi.fn();
    const announce = vi.fn();
    const setTool = vi.fn();
    const tool = new FloatingTransformTool();

    const handled = tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), {
      cancelFloatingRaster,
      announce,
      setTool,
    } as unknown as ToolContext);

    expect(handled).toBe(true);
    expect(cancelFloatingRaster).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith('Pixel transform cancelled');
    expect(setTool).toHaveBeenCalledWith('select');
  });
});
