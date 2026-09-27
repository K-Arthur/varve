import { describe, expect, it } from 'vitest';
import {
  getWorkspaceInspectorTab,
  initializeWorkspaceInspectorTabs,
  setWorkspaceInspectorTab,
} from './inspectorTabState';
import { getWorkspaceConfig } from './workspaceTypes';

describe('inspector tab state by workspace', () => {
  it('migrates a visible legacy tab into the initial non-email workspace', () => {
    const initial = initializeWorkspaceInspectorTabs(
      'design',
      getWorkspaceConfig('design'),
      'export',
    );
    expect(getWorkspaceInspectorTab('design', getWorkspaceConfig('design'), initial)).toBe(
      'export',
    );
  });

  it('uses Email authoring when Email has no saved per-workspace tab', () => {
    const initial = initializeWorkspaceInspectorTabs(
      'design',
      getWorkspaceConfig('design'),
      'properties',
    );
    expect(getWorkspaceInspectorTab('email', getWorkspaceConfig('email'), initial)).toBe('email');
  });

  it('preserves each workspace tab choice independently', () => {
    const designConfig = getWorkspaceConfig('design');
    const emailConfig = getWorkspaceConfig('email');
    const initial = initializeWorkspaceInspectorTabs('design', designConfig, 'properties');
    const afterEmailSelection = setWorkspaceInspectorTab(initial, 'email', 'export');

    expect(getWorkspaceInspectorTab('design', designConfig, afterEmailSelection)).toBe(
      'properties',
    );
    expect(getWorkspaceInspectorTab('email', emailConfig, afterEmailSelection)).toBe('export');
  });

  it('keeps a contextual tab when the live visible-tab list includes it', () => {
    const design = getWorkspaceConfig('design');
    const selectedImageConfig = {
      ...design,
      inspectorTabs: [
        ...design.inspectorTabs,
        { id: 'adjustments' as const, label: 'Adjustments', visible: true },
      ],
    };
    const selected = setWorkspaceInspectorTab({}, 'design', 'adjustments');

    expect(getWorkspaceInspectorTab('design', selectedImageConfig, selected)).toBe('adjustments');
  });

  it('falls back to the configured default if a saved tab is no longer visible', () => {
    const initial = initializeWorkspaceInspectorTabs(
      'design',
      getWorkspaceConfig('design'),
      'export',
    );
    const hiddenExport = {
      ...getWorkspaceConfig('design'),
      inspectorTabs: getWorkspaceConfig('design').inspectorTabs.map((tab) =>
        tab.id === 'export' ? { ...tab, visible: false } : tab,
      ),
    };
    expect(getWorkspaceInspectorTab('design', hiddenExport, initial)).toBe('properties');
  });
});
