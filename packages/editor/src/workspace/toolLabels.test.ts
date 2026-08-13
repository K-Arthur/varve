import { describe, expect, it } from 'vitest';
import { ESSENTIAL_TOOL_IDS, toolLabel } from './toolLabels';

describe('workspace tool labels', () => {
  it('uses product language instead of internal ids', () => {
    expect(toolLabel('rect')).toBe('Rectangle');
    expect(toolLabel('cloneStamp')).toBe('Clone Stamp');
    expect(toolLabel('futureTool')).toBe('Future Tool');
  });

  it('protects the essential canvas recovery tools', () => {
    expect([...ESSENTIAL_TOOL_IDS]).toEqual(expect.arrayContaining(['select', 'hand', 'zoom']));
  });
});
