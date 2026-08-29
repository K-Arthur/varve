import { describe, expect, it, vi } from 'vitest';
import { RefineMaskTool } from '../RefineMaskTool';
import { SelectTool } from '../SelectTool';
import { ToolManager } from '../ToolManager';
import type { ToolContext } from '../types';

describe('ToolManager.getTool', () => {
  it('returns undefined for a never-activated tool id', () => {
    const tm = new ToolManager('select');
    tm.register('select', () => new SelectTool());
    tm.register('refineMask', () => new RefineMaskTool());
    expect(tm.getTool('refineMask')).toBeUndefined();
  });

  it('returns the same cached instance after setTool activates it', () => {
    const tm = new ToolManager('select');
    tm.register('select', () => new SelectTool());
    tm.register('refineMask', () => new RefineMaskTool());
    tm.setTool('refineMask');
    const first = tm.getTool<RefineMaskTool>('refineMask');
    const second = tm.getTool<RefineMaskTool>('refineMask');
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it('forwards focus loss to the active tool', () => {
    const onFocusLoss = vi.fn();
    const tm = new ToolManager('select');
    tm.register('select', () => ({
      id: 'select',
      cursor: () => ({ css: 'default' }),
      onFocusLoss,
    }));
    const ctx = {} as ToolContext;

    tm.handleFocusLoss(ctx);

    expect(onFocusLoss).toHaveBeenCalledWith(ctx);
  });
});
