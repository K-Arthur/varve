import { describe, expect, it } from 'vitest';
import type { ToolId } from '../tools/types';
import { composeToolbar, type ToolbarFlyoutSlot } from './toolbarComposition';
import { ALL_WORKSPACE_MODES, getWorkspaceConfig, type ToolbarConfig } from './workspaceTypes';

function toolIds(toolbar: ToolbarConfig): ToolId[] {
  return composeToolbar(toolbar)
    .filter((slot) => slot.kind === 'tool')
    .map((slot) => (slot.kind === 'tool' ? slot.toolId : ('select' as ToolId)));
}

function flyouts(toolbar: ToolbarConfig): ToolbarFlyoutSlot[] {
  return composeToolbar(toolbar).filter(
    (slot): slot is ToolbarFlyoutSlot => slot.kind === 'flyout',
  );
}

describe('composeToolbar', () => {
  it('preserves the declared tool order', () => {
    const toolbar: ToolbarConfig = {
      tools: [{ toolId: 'select' }, { toolId: 'crop' }, { toolId: 'paint' }],
    };
    expect(toolIds(toolbar)).toEqual(['select', 'crop', 'paint']);
  });

  it('carries the declared group separators', () => {
    const slots = composeToolbar({
      tools: [{ toolId: 'select', groupStart: true }, { toolId: 'hand' }],
    });
    expect(slots).toEqual([
      { kind: 'tool', toolId: 'select', groupStart: true },
      { kind: 'tool', toolId: 'hand', groupStart: undefined },
    ]);
  });

  it('replaces flyout members with a single flyout anchored at the first member', () => {
    const slots = composeToolbar({
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'rect', groupStart: true },
        { toolId: 'ellipse' },
        { toolId: 'text' },
      ],
      flyouts: [{ id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse'] }],
    });
    expect(slots).toEqual([
      { kind: 'tool', toolId: 'select', groupStart: true },
      {
        kind: 'flyout',
        id: 'shapes',
        label: 'Shapes',
        tools: ['rect', 'ellipse'],
        groupStart: true,
      },
      { kind: 'tool', toolId: 'text', groupStart: undefined },
    ]);
  });

  it('appends flyouts whose members are not part of the main row', () => {
    const slots = composeToolbar({
      tools: [{ toolId: 'select' }],
      flyouts: [
        { id: 'boolean', label: 'Boolean operations', tools: ['booleanUnion', 'booleanSubtract'] },
      ],
    });
    expect(slots.at(-1)).toEqual({
      kind: 'flyout',
      id: 'boolean',
      label: 'Boolean operations',
      tools: ['booleanUnion', 'booleanSubtract'],
      groupStart: true,
    });
  });

  it('drops a flyout once customization has hidden every member', () => {
    // getEffectiveWorkspaceConfig filters hidden members out before this point;
    // an emptied flyout must not render a chevron that opens nothing.
    expect(
      flyouts({
        tools: [{ toolId: 'select' }],
        flyouts: [{ id: 'shapes', label: 'Shapes', tools: [] }],
      }),
    ).toEqual([]);
  });

  it('renders a repeated tool once', () => {
    expect(toolIds({ tools: [{ toolId: 'select' }, { toolId: 'select' }] })).toEqual(['select']);
  });

  it('assigns a tool claimed by two flyouts to the first one only', () => {
    const composed = flyouts({
      tools: [{ toolId: 'rect' }],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect'] },
        { id: 'other', label: 'Other', tools: ['rect', 'ellipse'] },
      ],
    });
    expect(composed.map((f) => [f.id, f.tools])).toEqual([
      ['shapes', ['rect']],
      ['other', ['ellipse']],
    ]);
  });

  it('handles a toolbar with no tools at all', () => {
    expect(composeToolbar({ tools: [] })).toEqual([]);
  });
});

describe('composeToolbar — built-in workspace configs', () => {
  it.each(ALL_WORKSPACE_MODES)('makes every tool %s declares reachable', (mode) => {
    const toolbar = getWorkspaceConfig(mode).toolbar;
    const slots = composeToolbar(toolbar);
    const reachable = new Set<ToolId>();
    for (const slot of slots) {
      if (slot.kind === 'tool') reachable.add(slot.toolId);
      else for (const toolId of slot.tools) reachable.add(toolId);
    }
    // Regression: the toolbar used to render from a hard-coded tool list, so
    // declared tools missing from that list (nodeEdit in Logo, refineMask and
    // trimapEdit in Image) were silently unreachable.
    for (const item of toolbar.tools) {
      expect(reachable.has(item.toolId), `${mode} drops ${item.toolId}`).toBe(true);
    }
  });

  it('renders Logo node editing, which the hard-coded toolbar dropped', () => {
    const slots = composeToolbar(getWorkspaceConfig('logo').toolbar);
    expect(slots).toContainEqual(
      expect.objectContaining({ kind: 'tool', toolId: 'nodeEdit' as ToolId }),
    );
  });

  it('groups the Image mask tools into their declared flyout', () => {
    const mask = flyouts(getWorkspaceConfig('image').toolbar).find((f) => f.id === 'mask');
    expect(mask?.tools).toEqual(['refineMask', 'trimapEdit']);
  });

  it('leads the Image toolbar with selection rather than drawing tools', () => {
    // The photo workspace declares select/lasso/hand/zoom first; the previous
    // hard-coded order led with line/text regardless of workspace intent.
    expect(toolIds(getWorkspaceConfig('image').toolbar).slice(0, 4)).toEqual([
      'select',
      'lasso',
      'hand',
      'zoom',
    ]);
  });
});
