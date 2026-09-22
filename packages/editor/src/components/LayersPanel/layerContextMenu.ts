/**
 * layerContextMenu — builds the Layers panel's context-menu entries.
 *
 * Extracted from `LayersPanel/index.tsx` so the command graph is directly
 * testable (state-aware labels, arrange alternatives, availability) without
 * mounting the panel.
 *
 * Research basis: W3C ARIA APG menu-button/menu pattern; Photoshop's
 * Layer > Hide Layer / Show Layer state-aware labels; WCAG 2.5.7 Dragging
 * Movements (single-pointer non-drag alternatives for reordering).
 */

import type { EffectStackKind } from '@varve/scene';
import {
  canReceiveEffectStack,
  canReceiveLayerMask,
  isContainer,
  isVisualMaskTarget,
  LAYER_COLOR_LABELS,
  LAYER_COLORS,
  type LayerColor,
  type LayerColorName,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import type { MenuEntry } from '@varve/ui';
import { menuShortcutForAction } from '../../menu/contextMenuShortcuts';

export interface EffectStackClipboardSummary {
  sourceId: NodeId;
  sourceName: string;
  kind: EffectStackKind;
  entryCount: number;
}

function effectStackLabel(kind: EffectStackKind): string {
  return kind === 'layer-effects' ? 'Layer Effects' : 'Object Filters';
}

export interface BuildLayerMenuItemsArgs {
  nodeId: string;
  contextMenuNode: SceneNode | undefined;
  contextMenuIsContainer: boolean;
  contextMenuHasMask: boolean;
  canGroup: boolean;
  isGroupSelected: boolean;
  isInstanceSelected: boolean;
  isComponentMasterSelected: boolean;
  canIsolateContextMenuNode: boolean;
  selection: string[];
  documentNodes: Record<string, SceneNode>;
  /** Effective lock (own lock or an ancestor's) for a node id. */
  isEffectivelyLocked: (id: string) => boolean;
  /** Effective visibility (own flag AND all ancestors visible) for a node id. */
  isEffectivelyHidden: (id: string) => boolean;
  handleRenameFromMenu: () => void;
  handleDetailsFromMenu?: () => void;
  handleOpenGuideLayoutsFromMenu?: () => void;
  handleBatchRenameFromMenu: () => void;
  handleDeleteFromMenu: () => void;
  handleCopy: () => void;
  handleCut: () => void;
  handlePaste: () => void;
  effectStackClipboard: EffectStackClipboardSummary | null;
  canPasteEffectStack: boolean;
  handleCopyEffectStackFromMenu: (kind: EffectStackKind) => void;
  handlePasteEffectStackFromMenu: (mode: 'replace' | 'append') => void;
  handleGroup: () => void;
  handleUngroup: () => void;
  handleDetach: () => void;
  handleSyncInstance: () => void;
  handlePublishToLibrary: () => void;
  handleMoveToFront: () => void;
  handleBringForward: () => void;
  handleSendBackward: () => void;
  handleMoveToBack: () => void;
  /** Move the context target into the container displayed above it. */
  handleIndentFromMenu: () => void;
  /** Move the context target out of its container. */
  handleOutdentFromMenu: () => void;
  handleCollapseOthers: () => void;
  handleIsolate: () => void;
  handleLockFromMenu: (locked: boolean) => void;
  handleVisibilityFromMenu: (visible: boolean) => void;
  handleSnapExclusionToggle: () => void;
  handleSetLayerColor: (color: LayerColor) => void;
  handleSelectSameType: () => void;
  handleSelectSameLayerColor: () => void;
  handleSelectAllOfType: () => void;
  handleSoloFromMenu: () => void;
  handleCanvasNavigation: (behavior: 'reveal' | 'center' | 'fit') => void;
  /** Expand and scroll the panel's own tree to the selection. */
  revealSelectionInPanel: () => void;
  enableAutoReveal: () => void;
  addMaskToSelected: (type: 'alpha' | 'clip' | 'luminance', sourceNodeId?: string) => void;
  removeMaskFromSelected: () => void;
  toggleMask: () => void;
  invertMask: () => void;
  setSelection: (id: string) => void;
  openCafDialog: (nodeId: string) => void;
  openUpscaleDialog: () => void;
  openVectorizeDialog: (prefill?: { replaceGroupId: string } | null) => void;
  closeMenu: () => void;
  /** Use the frame/group as the file thumbnail (persists the preference). */
  onUseFrameAsFileThumbnail?: (nodeId: string) => void;
  /** Open the file thumbnail picker dialog. */
  onSetFileThumbnail?: () => void;
  LAYER_COLORS: readonly LayerColorName[];
  COLOR_LABELS: Readonly<Record<LayerColorName, string>>;
}

/**
 * Whether every selected node is hidden. Used to make the visibility command
 * state-aware: a selection that is entirely hidden offers "Show", anything
 * else offers "Hide" (matching Photoshop's Layer > Show/Hide Layer toggle).
 */
export function selectionAllHidden(selection: string[], nodes: Record<string, SceneNode>): boolean {
  return (
    selection.length > 0 &&
    selection.every((id) => {
      const node = nodes[id];
      return node != null && !node.visible;
    })
  );
}

/**
 * Whether every selected node carries its own lock. "Unlock" is only offered
 * when it can actually change something; a selection locked through an
 * ancestor keeps the "Lock" label (the ancestor must be unlocked instead).
 */
export function selectionAllOwnLocked(
  selection: string[],
  nodes: Record<string, SceneNode>,
): boolean {
  return selection.length > 0 && selection.every((id) => nodes[id]?.locked === true);
}

export function buildLayerContextMenuItems(args: BuildLayerMenuItemsArgs): MenuEntry[] {
  const {
    nodeId,
    contextMenuNode,
    contextMenuIsContainer,
    contextMenuHasMask,
    canGroup,
    isGroupSelected,
    isInstanceSelected,
    isComponentMasterSelected,
    canIsolateContextMenuNode,
    selection,
    documentNodes,
    isEffectivelyLocked,
    isEffectivelyHidden,
    handleRenameFromMenu,
    handleDetailsFromMenu,
    handleOpenGuideLayoutsFromMenu,
    handleBatchRenameFromMenu,
    handleDeleteFromMenu,
    handleCopy,
    handleCut,
    handlePaste,
    effectStackClipboard,
    canPasteEffectStack,
    handleCopyEffectStackFromMenu,
    handlePasteEffectStackFromMenu,
    handleGroup,
    handleUngroup,
    handleDetach,
    handleSyncInstance,
    handlePublishToLibrary,
    handleMoveToFront,
    handleBringForward,
    handleSendBackward,
    handleMoveToBack,
    handleIndentFromMenu,
    handleOutdentFromMenu,
    handleCollapseOthers,
    handleIsolate,
    handleLockFromMenu,
    handleVisibilityFromMenu,
    handleSnapExclusionToggle,
    handleSetLayerColor,
    handleSelectSameType,
    handleSelectSameLayerColor,
    handleSelectAllOfType,
    handleSoloFromMenu,
    handleCanvasNavigation,
    revealSelectionInPanel,
    enableAutoReveal,
    addMaskToSelected,
    removeMaskFromSelected,
    toggleMask,
    invertMask,
    setSelection,
    openCafDialog,
    openUpscaleDialog,
    openVectorizeDialog,
    closeMenu,
    LAYER_COLORS,
    COLOR_LABELS,
  } = args;

  const items: MenuEntry[] = [
    { id: 'layer-label', label: 'Layer', type: 'label' },
    {
      id: 'rename',
      label: 'Rename',
      icon: 'Pencil',
      shortcut: 'F2',
      onAction: handleRenameFromMenu,
    },
    {
      id: 'details',
      label: 'Layer details',
      icon: 'Info',
      onAction: handleDetailsFromMenu ?? closeMenu,
    },
    ...(contextMenuNode?.kind === 'frame' && handleOpenGuideLayoutsFromMenu
      ? [
          {
            id: 'guide-layouts',
            label: 'Guide Layouts…',
            onAction: handleOpenGuideLayoutsFromMenu,
          } satisfies MenuEntry,
        ]
      : []),
    {
      id: 'batch-rename',
      label: 'Batch Rename\u2026',
      description: 'Find and replace across layer names',
      onAction: handleBatchRenameFromMenu,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'Trash2',
      destructive: true,
      shortcut: menuShortcutForAction('delete'),
      onAction: handleDeleteFromMenu,
    },
    { id: 'sep1', separator: true },
    { id: 'clipboard-label', label: 'Clipboard', type: 'label' },
    {
      id: 'copy',
      label: 'Copy',
      icon: 'Copy',
      shortcut: menuShortcutForAction('copy'),
      onAction: handleCopy,
    },
    {
      id: 'cut',
      label: 'Cut',
      icon: 'Scissors',
      shortcut: menuShortcutForAction('cut'),
      onAction: handleCut,
    },
    {
      id: 'paste',
      label: 'Paste',
      icon: 'ClipboardPaste',
      shortcut: menuShortcutForAction('paste'),
      onAction: handlePaste,
    },
  ];

  const layerEffectCount =
    contextMenuNode && 'effects' in contextMenuNode ? (contextMenuNode.effects?.length ?? 0) : 0;
  const objectFilterCount = contextMenuNode?.smartFilters?.length ?? 0;
  if (layerEffectCount > 0 || objectFilterCount > 0 || effectStackClipboard) {
    items.push({ id: 'sep-appearance-stack', separator: true });
    if (layerEffectCount > 0) {
      items.push({
        id: 'copy-layer-effects',
        label: 'Copy Layer Effects',
        onAction: () => handleCopyEffectStackFromMenu('layer-effects'),
      });
    }
    if (objectFilterCount > 0) {
      items.push({
        id: 'copy-object-filters',
        label: 'Copy Object Filters',
        onAction: () => handleCopyEffectStackFromMenu('object-filters'),
      });
    }
    if (effectStackClipboard) {
      const stackName = effectStackLabel(effectStackClipboard.kind);
      items.push(
        {
          id: `paste-${effectStackClipboard.kind}`,
          label: `Paste ${stackName}`,
          disabled: !canPasteEffectStack,
          onAction: () => handlePasteEffectStackFromMenu('replace'),
        },
        {
          id: `append-${effectStackClipboard.kind}`,
          label: `Append ${stackName}`,
          disabled: !canPasteEffectStack,
          onAction: () => handlePasteEffectStackFromMenu('append'),
        },
      );
    }
  }

  items.push(
    { id: 'order-label', label: 'Arrange', type: 'label' },
    {
      id: 'front',
      label: 'Bring to Front',
      icon: 'ArrowUpToLine',
      shortcut: menuShortcutForAction('bringFront'),
      onAction: handleMoveToFront,
    },
    {
      id: 'forward',
      label: 'Bring Forward',
      icon: 'ArrowUp',
      shortcut: menuShortcutForAction('bringForward'),
      onAction: handleBringForward,
    },
    {
      id: 'backward',
      label: 'Send Backward',
      icon: 'ArrowDown',
      shortcut: menuShortcutForAction('sendBackward'),
      onAction: handleSendBackward,
    },
    {
      id: 'back',
      label: 'Send to Back',
      icon: 'ArrowDownToLine',
      shortcut: menuShortcutForAction('sendBack'),
      onAction: handleMoveToBack,
    },
    {
      id: 'indent',
      label: 'Move Into Container Above',
      icon: 'CornerDownRight',
      onAction: handleIndentFromMenu,
    },
    {
      id: 'outdent',
      label: 'Move Out of Container',
      icon: 'CornerUpRight',
      onAction: handleOutdentFromMenu,
    },
  );

  if (contextMenuNode?.kind === 'group' && contextMenuNode.traceMetadata !== undefined) {
    items.push(
      { id: 'sep-retrace', separator: true },
      {
        id: 'retrace',
        label: 'Edit Trace\u2026',
        onAction: () => {
          setSelection(nodeId);
          openVectorizeDialog({ replaceGroupId: nodeId });
          closeMenu();
        },
      },
    );
  }

  if (
    contextMenuNode?.kind === 'shape' &&
    contextMenuNode.fills?.some((f) => f.type === 'image' && f.image?.src)
  ) {
    items.push(
      { id: 'sep-upscale', separator: true },
      {
        id: 'generative-edit',
        label: 'Generative Edit\u2026',
        icon: 'WandSparkles',
        onAction: () => {
          setSelection(nodeId);
          openCafDialog(nodeId);
          closeMenu();
        },
      },
      {
        id: 'vectorize',
        label: 'Vectorize Image\u2026',
        onAction: () => {
          setSelection(nodeId);
          openVectorizeDialog();
          closeMenu();
        },
      },
      {
        id: 'upscale',
        label: 'Enhance Image\u2026',
        onAction: () => {
          setSelection(nodeId);
          openUpscaleDialog();
          closeMenu();
        },
      },
    );
  }

  // File thumbnail entries: a frame/group row can directly become the file
  // thumbnail; every row can open the picker. The entries form their own
  // group behind a separator rather than dangling after the Arrange items.
  items.push({ id: 'sep-thumb', separator: true });
  if (contextMenuNode?.kind === 'frame' || contextMenuNode?.kind === 'group') {
    items.push({
      id: 'use-as-file-thumbnail',
      label: 'Use Frame as File Thumbnail',
      onAction: () => {
        setSelection(nodeId);
        args.onUseFrameAsFileThumbnail?.(nodeId);
        closeMenu();
      },
    });
  }
  items.push({
    id: 'set-file-thumbnail',
    label: 'Set File Thumbnail\u2026',
    onAction: () => {
      setSelection(nodeId);
      args.onSetFileThumbnail?.();
      closeMenu();
    },
  });

  // Structure submenu — group/ungroup and component operations
  const hasStructuralOps =
    canGroup || isGroupSelected || isInstanceSelected || isComponentMasterSelected;
  if (hasStructuralOps) {
    items.push(
      { id: 'sep2', separator: true },
      {
        id: 'structure-submenu',
        label: 'Structure',
        type: 'submenu' as const,
        submenu: [
          {
            id: 'group',
            label: 'Group',
            shortcut: menuShortcutForAction('group'),
            disabled: !canGroup,
            onAction: handleGroup,
          },
          {
            id: 'ungroup',
            label: 'Ungroup',
            shortcut: menuShortcutForAction('ungroup'),
            disabled: !isGroupSelected,
            onAction: handleUngroup,
          },
          { id: 'struct-sep', separator: true },
          {
            id: 'detach',
            label: 'Detach Instance',
            disabled: !isInstanceSelected,
            onAction: handleDetach,
          },
          {
            id: 'sync',
            label: 'Sync Component',
            disabled: !isInstanceSelected,
            onAction: handleSyncInstance,
          },
          {
            id: 'publish',
            label: 'Publish to Library',
            disabled: !isComponentMasterSelected,
            onAction: handlePublishToLibrary,
          },
        ],
      },
    );
  }

  // Masking submenu
  const contextMenuIsVisualLeaf = contextMenuNode != null && isVisualMaskTarget(contextMenuNode);
  const hasMaskOps =
    (contextMenuNode != null && canReceiveLayerMask(contextMenuNode)) || contextMenuHasMask;
  if (hasMaskOps) {
    const maskEntries: MenuEntry[] = [];
    if ((contextMenuIsContainer || contextMenuIsVisualLeaf) && !contextMenuHasMask) {
      if (contextMenuIsVisualLeaf) {
        // Leaf nodes get a vector mask (no child-node sources)
        maskEntries.push({
          id: 'mask-vector',
          label: 'Add Vector Mask',
          onAction: () => {
            addMaskToSelected('alpha');
            closeMenu();
          },
        });
      } else {
        maskEntries.push(
          {
            id: 'mask-alpha',
            label: 'Add Alpha Mask',
            onAction: () => {
              addMaskToSelected('alpha');
              closeMenu();
            },
          },
          {
            id: 'mask-clip',
            label: 'Add Clip Mask',
            onAction: () => {
              addMaskToSelected('clip');
              closeMenu();
            },
          },
          {
            id: 'mask-luminance',
            label: 'Add Luminance Mask',
            onAction: () => {
              addMaskToSelected('luminance');
              closeMenu();
            },
          },
        );
      }
    }
    if (contextMenuHasMask) {
      if (maskEntries.length > 0) maskEntries.push({ id: 'mask-sep', separator: true });
      maskEntries.push(
        {
          id: 'mask-remove',
          label: 'Remove Mask',
          icon: 'Trash2',
          destructive: true,
          onAction: () => {
            removeMaskFromSelected();
            closeMenu();
          },
        },
        {
          id: 'mask-toggle',
          label: 'Toggle Mask',
          onAction: () => {
            toggleMask();
            closeMenu();
          },
        },
        {
          id: 'mask-invert',
          label: 'Invert Mask',
          onAction: () => {
            invertMask();
            closeMenu();
          },
        },
      );
    }
    items.push(
      { id: 'sep-mask', separator: true },
      {
        id: 'masking-submenu',
        label: 'Masking',
        type: 'submenu' as const,
        submenu: maskEntries,
      },
    );
  }

  items.push({ id: 'visibility-label', label: 'Visibility', type: 'label' });

  const isContainerNode = isContainer(documentNodes[nodeId] as SceneNode);
  if (isContainerNode) {
    items.push({
      id: 'collapse-others',
      label: 'Collapse Others',
      icon: 'FoldVertical',
      onAction: handleCollapseOthers,
    });
  }
  if (canIsolateContextMenuNode) {
    items.push({ id: 'isolate', label: 'Isolate', icon: 'Focus', onAction: handleIsolate });
  }

  // State-aware lock/visibility labels. A keyboard user reaches these through
  // the context menu (Shift+F10); offering only "Hide"/"Lock" left a hidden
  // or locked layer with no way back through the menu.
  const effectiveLocked = isEffectivelyLocked(nodeId);
  const ownLocked = documentNodes[nodeId]?.locked === true;
  const allOwnLocked = selectionAllOwnLocked(selection, documentNodes);
  const allHidden = selectionAllHidden(selection, documentNodes);
  const lockBlockedByAncestor = effectiveLocked && !ownLocked;
  // A node can carry visible=true yet paint nothing because an ancestor is
  // hidden. The command still flips the own flag (the right eventual state),
  // but it must explain why the result will not be visible until the
  // restricting ancestor is shown too.
  const hiddenByAncestor = !allHidden && isEffectivelyHidden(nodeId);

  items.push({
    id: 'lock',
    label: allOwnLocked ? 'Unlock' : 'Lock',
    icon: allOwnLocked ? 'LockOpen' : 'Lock',
    description: lockBlockedByAncestor ? 'Locked by an ancestor layer' : undefined,
    disabled: lockBlockedByAncestor,
    onAction: () => handleLockFromMenu(!allOwnLocked),
  });
  items.push({
    id: 'hide',
    label: allHidden ? 'Show' : 'Hide',
    icon: allHidden ? 'Eye' : 'EyeOff',
    description: hiddenByAncestor ? 'Hidden by an ancestor layer' : undefined,
    onAction: () => handleVisibilityFromMenu(allHidden),
  });

  const soloed = documentNodes[nodeId]?.solo === true;
  items.push({
    id: 'solo',
    label: soloed ? 'Unsolo' : 'Solo',
    icon: 'Star',
    onAction: handleSoloFromMenu,
  });

  const snapExcluded = documentNodes[nodeId]?.snapExcluded;
  items.push({
    id: 'snap-toggle',
    label: snapExcluded ? 'Include in Snapping' : 'Exclude from Snapping',
    onAction: handleSnapExclusionToggle,
  });

  items.push(
    { id: 'sep5', separator: true },
    {
      id: 'color-tag',
      label: 'Color Tag',
      type: 'submenu' as const,
      submenu: [
        ...LAYER_COLORS.map((c) => ({
          id: `color-${c}`,
          label: COLOR_LABELS[c],
          onAction: () => handleSetLayerColor(c),
        })),
        { id: 'color-none', label: 'No Color', onAction: () => handleSetLayerColor(null) },
      ],
    },
    {
      id: 'select-submenu',
      label: 'Select',
      type: 'submenu' as const,
      submenu: [
        { id: 'select-type', label: 'Select Same Type', onAction: handleSelectSameType },
        { id: 'select-color', label: 'Select Same Color', onAction: handleSelectSameLayerColor },
        { id: 'select-all-type', label: 'Select All of Type', onAction: handleSelectAllOfType },
      ],
    },
    { id: 'sep7', separator: true },
    {
      id: 'reveal-canvas',
      label: 'Reveal on Canvas',
      description: 'Pan only; keep the current zoom',
      onAction: () => handleCanvasNavigation('reveal'),
    },
    {
      id: 'center-canvas',
      label: 'Center Selection',
      description: 'Center without changing zoom',
      onAction: () => handleCanvasNavigation('center'),
    },
    {
      id: 'fit-canvas',
      label: 'Zoom to Selection',
      description: 'Center and fit the selected layers',
      shortcut: menuShortcutForAction('fitSelection'),
      onAction: () => handleCanvasNavigation('fit'),
    },
    {
      id: 'reveal-layers',
      label: 'Reveal in Layers Panel',
      onAction: () => {
        if (selection.length > 0) {
          enableAutoReveal();
          revealSelectionInPanel();
        }
        closeMenu();
      },
    },
  );

  return items;
}

export { canReceiveEffectStack, LAYER_COLOR_LABELS, LAYER_COLORS };
