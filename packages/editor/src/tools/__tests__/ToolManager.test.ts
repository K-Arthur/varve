import { describe, expect, it } from 'vitest';
import { ToolManager } from '../ToolManager';
import { SelectTool } from '../SelectTool';
import { RefineMaskTool } from '../RefineMaskTool';

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
});
