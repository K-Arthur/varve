import type { LayerColorName, SceneNode } from '@varve/scene';
import type { MenuEntry, MenuItem } from '@varve/ui';
import { describe, expect, it, vi } from 'vitest';
import {
  type BuildLayerMenuItemsArgs,
  buildLayerContextMenuItems,
  selectionAllHidden,
  selectionAllOwnLocked,
} from './layerContextMenu';

function makeNode(
  id: string,
  name: string,
  kind = 'shape',
  overrides?: Record<string, unknown>,
): SceneNode {
  const base: Record<string, unknown> = {
    id,
    name,
    kind,
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    index: 0,
    order: 'a0',
    rotation: 0,
  };
  if (kind === 'shape') {
    base.shape = { kind: 'rect', x: 0, y: 0, w: 10, h: 10 };
  }
  if (kind === 'frame' || kind === 'group') {
    base.children = [];
  }
  if (kind === 'frame') {
    base.w = 100;
    base.h = 100;
  }
  return { ...base, ...overrides } as unknown as SceneNode;
}

function baseArgs(
  node: SceneNode,
  overrides?: Partial<BuildLayerMenuItemsArgs>,
): BuildLayerMenuItemsArgs {
  return {
    nodeId: node.id,
    contextMenuNode: node,
    contextMenuIsContainer: node.kind === 'frame' || node.kind === 'group',
    contextMenuHasMask: false,
    canGroup: false,
    isGroupSelected: false,
    isInstanceSelected: false,
    isComponentMasterSelected: false,
    canIsolateContextMenuNode: false,
    selection: [node.id],
    documentNodes: { [node.id]: node },
    isEffectivelyLocked: (id) => (id === node.id ? node.locked : false),
    isEffectivelyHidden: (id) => (id === node.id ? node.visible === false : false),
    handleRenameFromMenu: vi.fn(),
    handleBatchRenameFromMenu: vi.fn(),
    handleDeleteFromMenu: vi.fn(),
    handleCopy: vi.fn(),
    handleCut: vi.fn(),
    handlePaste: vi.fn(),
    effectStackClipboard: null,
    canPasteEffectStack: false,
    handleCopyEffectStackFromMenu: vi.fn(),
    handlePasteEffectStackFromMenu: vi.fn(),
    handleGroup: vi.fn(),
    handleUngroup: vi.fn(),
    handleDetach: vi.fn(),
    handleSyncInstance: vi.fn(),
    handlePublishToLibrary: vi.fn(),
    handleMoveToFront: vi.fn(),
    handleBringForward: vi.fn(),
    handleSendBackward: vi.fn(),
    handleMoveToBack: vi.fn(),
    handleIndentFromMenu: vi.fn(),
    handleOutdentFromMenu: vi.fn(),
    handleCollapseOthers: vi.fn(),
    handleIsolate: vi.fn(),
    handleLockFromMenu: vi.fn(),
    handleVisibilityFromMenu: vi.fn(),
    handleSnapExclusionToggle: vi.fn(),
    handleSetLayerColor: vi.fn(),
    handleSelectSameType: vi.fn(),
    handleSelectSameLayerColor: vi.fn(),
    handleSelectAllOfType: vi.fn(),
    handleSoloFromMenu: vi.fn(),
    handleCanvasNavigation: vi.fn(),
    revealSelectionInPanel: vi.fn(),
    enableAutoReveal: vi.fn(),
    addMaskToSelected: vi.fn(),
    removeMaskFromSelected: vi.fn(),
    toggleMask: vi.fn(),
    invertMask: vi.fn(),
    setSelection: vi.fn(),
    openCafDialog: vi.fn(),
    openUpscaleDialog: vi.fn(),
    openVectorizeDialog: vi.fn(),
    closeMenu: vi.fn(),
    LAYER_COLORS: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'],
    COLOR_LABELS: {
      red: 'Red',
      orange: 'Orange',
      yellow: 'Yellow',
      green: 'Green',
      blue: 'Blue',
      purple: 'Purple',
      gray: 'Gray',
    } as Record<LayerColorName, string>,
    ...overrides,
  };
}

function findItem(items: readonly MenuEntry[], id: string): MenuEntry | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    // Only SubmenuItem carries `type`; narrow before reading `submenu`.
    if ('type' in item && item.type === 'submenu') {
      const nested = findItem(item.submenu, id);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** The command entry for an id (only MenuItem has `onAction`). */
function findAction(items: readonly MenuEntry[], id: string): MenuItem | undefined {
  const entry = findItem(items, id);
  return entry && 'onAction' in entry ? entry : undefined;
}

describe('buildLayerContextMenuItems — state-aware commands', () => {
  it('offers Hide on a visible layer and Show on a hidden layer', () => {
    const visible = makeNode('n1', 'Visible');
    const hidden = makeNode('n2', 'Hidden', 'shape', { visible: false });

    const visibleItems = buildLayerContextMenuItems(baseArgs(visible));
    const hiddenItems = buildLayerContextMenuItems(baseArgs(hidden));

    expect(findAction(visibleItems, 'hide')?.label).toBe('Hide');
    expect(findAction(hiddenItems, 'hide')?.label).toBe('Show');
  });

  it('offers Unlock on an own-locked layer and Lock otherwise', () => {
    const unlocked = makeNode('n1', 'Unlocked');
    const locked = makeNode('n2', 'Locked', 'shape', { locked: true });

    expect(findAction(buildLayerContextMenuItems(baseArgs(unlocked)), 'lock')?.label).toBe('Lock');
    const lockedItems = buildLayerContextMenuItems(baseArgs(locked));
    expect(findAction(lockedItems, 'lock')?.label).toBe('Unlock');
    expect(findAction(lockedItems, 'lock')?.disabled).not.toBe(true);
  });

  it('keeps Lock disabled with an ancestor explanation when the layer is effectively locked by a parent', () => {
    const child = makeNode('n1', 'Child');
    const items = buildLayerContextMenuItems(baseArgs(child, { isEffectivelyLocked: () => true }));
    const lock = findAction(items, 'lock');
    expect(lock?.label).toBe('Lock');
    expect(lock?.disabled).toBe(true);
    expect(lock?.description).toMatch(/ancestor/i);
  });

  it('describes the restricting ancestor on Hide when the layer is hidden through a parent', () => {
    const child = makeNode('n1', 'Child');
    const items = buildLayerContextMenuItems(baseArgs(child, { isEffectivelyHidden: () => true }));
    const hide = findAction(items, 'hide');
    expect(hide?.label).toBe('Hide');
    expect(hide?.description).toMatch(/ancestor/i);
    // No false positive for a live layer.
    expect(
      findAction(buildLayerContextMenuItems(baseArgs(makeNode('n2', 'Live'))), 'hide')?.description,
    ).toBeUndefined();
  });

  it('invokes the visibility handler with true when the selection is entirely hidden', () => {
    const hidden = makeNode('n1', 'Hidden', 'shape', { visible: false });
    const handleVisibilityFromMenu = vi.fn();
    const items = buildLayerContextMenuItems(baseArgs(hidden, { handleVisibilityFromMenu }));
    findAction(items, 'hide')?.onAction?.();
    expect(handleVisibilityFromMenu).toHaveBeenCalledWith(true);
  });

  it('invokes the lock handler with false (unlock) when the selection is entirely own-locked', () => {
    const locked = makeNode('n1', 'Locked', 'shape', { locked: true });
    const handleLockFromMenu = vi.fn();
    const items = buildLayerContextMenuItems(baseArgs(locked, { handleLockFromMenu }));
    findAction(items, 'lock')?.onAction?.();
    expect(handleLockFromMenu).toHaveBeenCalledWith(false);
  });
});

describe('buildLayerContextMenuItems — arrange alternatives (WCAG 2.5.7)', () => {
  it('exposes all four arrange commands as single-pointer non-drag alternatives', () => {
    const node = makeNode('n1', 'Layer');
    const handlers = {
      handleMoveToFront: vi.fn(),
      handleBringForward: vi.fn(),
      handleSendBackward: vi.fn(),
      handleMoveToBack: vi.fn(),
    };
    const items = buildLayerContextMenuItems(baseArgs(node, handlers));

    const order = ['front', 'forward', 'backward', 'back'].map(
      (id) => findAction(items, id)?.label,
    );
    expect(order).toEqual(['Bring to Front', 'Bring Forward', 'Send Backward', 'Send to Back']);

    for (const id of ['front', 'forward', 'backward', 'back']) {
      findAction(items, id)?.onAction?.();
    }
    expect(handlers.handleMoveToFront).toHaveBeenCalledTimes(1);
    expect(handlers.handleBringForward).toHaveBeenCalledTimes(1);
    expect(handlers.handleSendBackward).toHaveBeenCalledTimes(1);
    expect(handlers.handleMoveToBack).toHaveBeenCalledTimes(1);
  });

  it('resolves arrange shortcuts from the effective binding', () => {
    const items = buildLayerContextMenuItems(baseArgs(makeNode('n1', 'Layer')));
    expect(findAction(items, 'forward')?.shortcut).toBe('Ctrl+]');
    expect(findAction(items, 'backward')?.shortcut).toBe('Ctrl+[');
  });
});

describe('selection state helpers', () => {
  const nodes: Record<string, SceneNode> = {
    a: makeNode('a', 'A', 'shape', { visible: false }),
    b: makeNode('b', 'B', 'shape', { visible: false }),
    c: makeNode('c', 'C'),
  };

  it('detects an entirely hidden selection', () => {
    expect(selectionAllHidden(['a', 'b'], nodes)).toBe(true);
    expect(selectionAllHidden(['a', 'c'], nodes)).toBe(false);
    expect(selectionAllHidden([], nodes)).toBe(false);
  });

  it('detects an entirely own-locked selection', () => {
    const locked: Record<string, SceneNode> = {
      a: makeNode('a', 'A', 'shape', { locked: true }),
      b: makeNode('b', 'B'),
    };
    expect(selectionAllOwnLocked(['a'], locked)).toBe(true);
    expect(selectionAllOwnLocked(['a', 'b'], locked)).toBe(false);
    expect(selectionAllOwnLocked([], locked)).toBe(false);
  });
});
