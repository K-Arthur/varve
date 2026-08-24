import { describe, expect, it } from 'vitest';
import {
  ALL_WORKSPACE_MODES,
  getToolbarToolIds,
  getWorkspaceConfig,
} from '../workspace/workspaceTypes';
import {
  ESSENTIAL_TOOL_IDS,
  getRegisteredToolIds,
  getRegisteredTools,
  getToolDefinition,
  getToolIdForShortcutId,
  TOOL_REGISTRY,
} from './toolRegistry';

describe('tool registry', () => {
  it('has unique, complete runtime metadata for every registered tool', () => {
    const ids = getRegisteredToolIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(getRegisteredTools()).toHaveLength(ids.length);

    for (const definition of TOOL_REGISTRY) {
      expect(definition.label).toBeTruthy();
      expect(definition.icon).toBeTruthy();
      expect(getToolDefinition(definition.id)).toEqual(definition);
    }
  });

  it('covers every tool reachable from every built-in workspace, including flyouts', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      for (const id of getToolbarToolIds(getWorkspaceConfig(mode).toolbar)) {
        expect(getToolDefinition(id), `${mode} declares unregistered ${id}`).toBeDefined();
      }
    }
  });

  it('keeps recovery tools explicit and maps shortcut relationships centrally', () => {
    expect([...ESSENTIAL_TOOL_IDS]).toEqual(expect.arrayContaining(['select', 'hand', 'zoom']));
    expect(getToolIdForShortcutId('toolPen')).toBe('pen');
    expect(getToolIdForShortcutId('missingShortcut')).toBeUndefined();
    expect(getToolDefinition('booleanUnion')?.kind).toBe('command');
    expect(getToolDefinition('pen')?.kind).toBe('tool');
  });
});
