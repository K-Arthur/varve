/**
 * Canvas right-click context menu builder.
 *
 * Extracted from Shell.tsx (hub-file line/complexity budget): the menu is a
 * pure function of the editor context + close callback. Selection facts are
 * computed locally so hub files do not import extra scene predicates.
 *
 * Visual contract (session 50+):
 *   - Section labels group related commands.
 *   - Icons on frequently used items aid scanning.
 *   - Destructive actions use restrained danger treatment via `destructive: true`.
 *   - Group separators are auto-inserted by the renderer when `group` changes.
 */
import { isImageShape, isLiveBooleanNode, isVisualMaskTarget } from '@varve/scene';
import type { MenuEntry } from '@varve/ui';
import { getActionRegistry } from '../actions/ActionRegistry';
import type { EditorContextValue } from '../context';

interface CanvasContextMenuOptions {
  editor: EditorContextValue;
  closeMenu: () => void;
}

type LiveBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';

const LIVE_BOOLEAN_OPERATIONS: readonly LiveBooleanOperation[] = [
  'union',
  'subtract',
  'intersect',
  'exclude',
];

function liveBooleanOperationLabel(operation: LiveBooleanOperation): string {
  return operation === 'exclude'
    ? 'Exclude Overlap'
    : `${operation[0]!.toUpperCase()}${operation.slice(1)}`;
}

export function buildCanvasContextMenuItems({
  editor,
  closeMenu,
}: CanvasContextMenuOptions): MenuEntry[] {
  const hasSelection = editor.state.selection.length > 0;
  const hasMultiple = editor.state.selection.length > 1;
  const selectedId = editor.state.selection[0];
  const isSingleGroup =
    hasSelection &&
    editor.state.selection.length === 1 &&
    selectedId !== undefined &&
    editor.state.document.nodes[selectedId]?.kind === 'group';
  const selectedNode = selectedId ? editor.state.document.nodes[selectedId] : undefined;
  const isSingleLiveBoolean = selectedNode !== undefined && isLiveBooleanNode(selectedNode);
  const isSingleImage =
    hasSelection &&
    editor.state.selection.length === 1 &&
    selectedNode?.kind === 'shape' &&
    isImageShape(selectedNode);
  const isSingleTraceGroup =
    hasSelection &&
    editor.state.selection.length === 1 &&
    selectedNode?.kind === 'group' &&
    selectedNode.traceMetadata !== undefined;
  const isSingleFrame =
    hasSelection && editor.state.selection.length === 1 && selectedNode?.kind === 'frame';
  const isSingleVisualMaskTarget =
    hasSelection &&
    editor.state.selection.length === 1 &&
    selectedNode !== undefined &&
    isVisualMaskTarget(selectedNode);
  const nodeCount = Object.keys(editor.state.document.nodes).length;
  const hasNodes = nodeCount >= 1;
  const hasMultipleNodes = nodeCount >= 2;
  const record = (actionId: string) => editor.recordAction(`menu:${actionId}`);
  const setLiveBooleanOperation = (operation: LiveBooleanOperation) => {
    if (!selectedId) return;
    editor.updateNode(selectedId, (node) => {
      if (!isLiveBooleanNode(node)) return node;
      return {
        ...node,
        name: `Boolean ${liveBooleanOperationLabel(operation)}`,
        boolean: { ...node.boolean, operation },
      };
    });
    record(`boolean-${operation}`);
    closeMenu();
  };
  // ── Section: Clipboard ────────────────────────────────────────────────
  const clipboardItems: MenuEntry[] = [
    ...(hasSelection
      ? [
          { id: 'ctx-clip-label', label: 'Clipboard', type: 'label' as const } satisfies MenuEntry,
          {
            id: 'ctx-cut',
            label: 'Cut',
            icon: 'Scissors' as const,
            onAction: () => {
              record('cut');
              editor.cutSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
          {
            id: 'ctx-copy',
            label: 'Copy',
            icon: 'Copy' as const,
            onAction: () => {
              record('copy');
              editor.copySelected();
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    {
      id: 'ctx-paste',
      label: 'Paste',
      icon: 'ClipboardPaste' as const,
      onAction: () => {
        record('paste');
        editor.paste();
        closeMenu();
      },
    } satisfies MenuEntry,
    ...(hasSelection
      ? [
          {
            id: 'ctx-copy-properties',
            label: 'Copy Properties',
            onAction: () => {
              record('copyProperties');
              editor.copySelectedProperties();
              closeMenu();
            },
          } satisfies MenuEntry,
          {
            id: 'ctx-paste-properties',
            label: 'Paste Properties',
            onAction: () => {
              record('pasteProperties');
              editor.pastePropertiesToSelection();
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
  ];

  // ── Section: Arrangement ─────────────────────────────────────────────
  const arrangementItems: MenuEntry[] = [
    ...(hasSelection
      ? [
          { id: 'ctx-arrange-label', label: 'Arrange', type: 'label' as const } satisfies MenuEntry,
          {
            id: 'ctx-dup',
            label: 'Duplicate',
            icon: 'CopyPlus' as const,
            onAction: () => {
              record('duplicate');
              editor.duplicateSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
          {
            id: 'ctx-del',
            label: 'Delete',
            icon: 'Trash2' as const,
            destructive: true,
            onAction: () => {
              record('delete');
              editor.removeSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    ...(hasMultiple
      ? [
          {
            id: 'ctx-group',
            label: 'Group Selection',
            icon: 'Group' as const,
            onAction: () => {
              record('group');
              editor.groupSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    ...(isSingleGroup
      ? [
          {
            id: 'ctx-ungroup',
            label: isSingleLiveBoolean ? 'Expand Boolean' : 'Ungroup',
            icon: 'Ungroup' as const,
            onAction: () => {
              record('ungroup');
              editor.ungroupSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
          ...(isSingleLiveBoolean
            ? LIVE_BOOLEAN_OPERATIONS.map(
                (operation) =>
                  ({
                    id: `ctx-live-boolean-${operation}`,
                    label: `Change Boolean to ${liveBooleanOperationLabel(operation)}`,
                    onAction: () => setLiveBooleanOperation(operation),
                  }) satisfies MenuEntry,
              )
            : []),
        ]
      : []),
  ];

  // ── Section: Clipping & Masking ──────────────────────────────────────
  const clippingItems: MenuEntry[] = hasSelection
    ? (() => {
        const selNodes = editor.state.selection
          .map((sid) => editor.state.document.nodes[sid])
          .filter((n) => n !== undefined);
        const canClipSource = selNodes.some((n) => {
          if (n.kind === 'frame') return true;
          if (n.kind !== 'shape') return false;
          const sk = n.shape?.kind;
          if (sk === 'line' || sk === 'arrow') return false;
          if (sk === 'path' && n.shape?.closed === false) return false;
          return true;
        });
        const single = selNodes.length === 1 ? selNodes[0] : undefined;
        const isClipGroup =
          single !== undefined &&
          (single.kind === 'group' || single.kind === 'frame') &&
          single.mask?.type === 'clip' &&
          single.mask.sourceNodeId !== undefined &&
          single.children?.includes(single.mask.sourceNodeId) === true;
        const isVisualLeaf = single !== undefined && isVisualMaskTarget(single);
        const isMaskContainer =
          single !== undefined &&
          (single.kind === 'group' ||
            single.kind === 'frame' ||
            single.kind === 'adjustment' ||
            isVisualLeaf);
        const hasMask = isMaskContainer && single.mask != null;
        const entries: MenuEntry[] = [];
        if (hasMultiple && canClipSource) {
          entries.push({
            id: 'ctx-create-clip',
            label: 'Create Clipping Mask',
            onAction: () => {
              record('createClippingMask');
              editor.createClippingMaskFromSelected();
              closeMenu();
            },
          });
        }
        if (isClipGroup) {
          entries.push({
            id: 'ctx-release-clip',
            label: 'Release Clipping Mask',
            onAction: () => {
              record('releaseClippingMask');
              editor.releaseClippingMaskFromSelected();
              closeMenu();
            },
          });
        }
        if (isMaskContainer && !hasMask) {
          for (const [type, label] of [
            ['clip', 'Add Clip Mask'],
            ['alpha', 'Add Alpha Mask'],
            ['luminance', 'Add Luminance Mask'],
          ] as const) {
            entries.push({
              id: `ctx-add-mask-${type}`,
              label,
              onAction: () => {
                record(`addMask:${type}`);
                editor.addMaskToSelected?.(type);
                closeMenu();
              },
            });
          }
        }
        if (isMaskContainer && hasMask && single) {
          entries.push({
            id: 'ctx-toggle-mask',
            label: single.mask?.visible === false ? 'Enable Mask' : 'Disable Mask',
            onAction: () => {
              record('toggleMask');
              editor.toggleMask();
              closeMenu();
            },
          });
          entries.push({
            id: 'ctx-invert-mask',
            label: 'Invert Mask',
            onAction: () => {
              record('invertMask');
              editor.invertMask();
              closeMenu();
            },
          });
          entries.push({
            id: 'ctx-remove-mask',
            label: 'Remove Mask',
            icon: 'Trash2' as const,
            destructive: true,
            onAction: () => {
              record('removeMask');
              editor.removeMaskFromSelected();
              closeMenu();
            },
          });
        }
        if (entries.length === 0) return [];
        return [
          {
            id: 'ctx-mask-label',
            label: 'Clipping & Masking',
            type: 'label' as const,
          } satisfies MenuEntry,
          ...entries,
        ];
      })()
    : [];

  // ── Section: Intelligence & Tools ────────────────────────────────────
  const toolsItems: MenuEntry[] = [
    ...(hasSelection
      ? [
          {
            id: 'ctx-mockups',
            label: 'Apply mockup…',
            onAction: () => {
              record('applyMockup');
              getActionRegistry().get('applyMockup')?.handler(undefined);
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    ...(hasNodes
      ? [
          ...(isSingleImage
            ? [
                {
                  id: 'ctx-vectorize',
                  label: 'Vectorize image…',
                  icon: 'Spline' as const,
                  onAction: () => {
                    record('vectorize');
                    editor.openVectorizeDialog();
                    closeMenu();
                  },
                } satisfies MenuEntry,
              ]
            : []),
          ...(isSingleTraceGroup
            ? [
                {
                  id: 'ctx-retrace',
                  label: 'Edit Trace…',
                  onAction: () => {
                    record('retrace');
                    if (selectedNode?.kind === 'group') {
                      editor.openVectorizeDialog({
                        replaceGroupId: selectedNode.id,
                      });
                    }
                    closeMenu();
                  },
                } satisfies MenuEntry,
              ]
            : []),
          ...(isSingleImage || isSingleFrame || isSingleVisualMaskTarget
            ? [
                {
                  id: 'ctx-paint-mask',
                  label: 'Paint Mask…',
                  onAction: () => {
                    record('paintMask');
                    editor.setTool('refineMask');
                    closeMenu();
                  },
                } satisfies MenuEntry,
              ]
            : []),
          {
            id: 'ctx-intel',
            label: 'Intelligence',
            type: 'submenu',
            icon: 'Brain' as const,
            submenu: [
              {
                id: 'ctx-intel-audit',
                label: 'Audit',
                onAction: () => {
                  editor.setInspectorTab?.('audit', 'audit');
                  closeMenu();
                },
                disabled: !hasNodes,
              },
              {
                id: 'ctx-intel-scan',
                label: 'Scan for Debt',
                onAction: () => {
                  editor.setInspectorTab?.('audit', 'debt');
                  closeMenu();
                },
                disabled: !hasNodes,
              },
              {
                id: 'ctx-intel-names',
                label: 'Suggest Names',
                onAction: () => {
                  editor.setInspectorTab?.('audit', 'naming');
                  closeMenu();
                },
                disabled: !hasSelection,
              },
              {
                id: 'ctx-intel-dupes',
                label: hasSelection
                  ? 'Detect Duplicates in Selection'
                  : 'Detect Duplicates on Page',
                onAction: () => {
                  editor.setInspectorTab?.('audit', 'components');
                  closeMenu();
                },
                disabled: !hasMultipleNodes,
              },
            ],
          } satisfies MenuEntry,
        ]
      : []),
  ];

  // ── Section: Export & Thumbnail ──────────────────────────────────────
  const exportItems: MenuEntry[] = [
    ...(isSingleFrame
      ? [
          {
            id: 'ctx-export-frame',
            label: 'Export Frame…',
            icon: 'Download' as const,
            onAction: () => {
              record('exportFrame');
              editor.setShowExportDialog(true);
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    ...(hasSelection
      ? [
          {
            id: 'ctx-use-selection-thumbnail',
            label: 'Use Selection as File Thumbnail',
            onAction: () => {
              record('setThumbnailFromSelection');
              getActionRegistry().get('setThumbnailFromSelection')?.handler(undefined);
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    ...(isSingleFrame
      ? [
          {
            id: 'ctx-use-frame-thumbnail',
            label: 'Use Frame as File Thumbnail',
            onAction: () => {
              record('setThumbnailFromFrame');
              getActionRegistry().get('setThumbnailFromFrame')?.handler(undefined);
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    {
      id: 'ctx-open-thumbnail-picker',
      label: 'Set File Thumbnail…',
      onAction: () => {
        record('openThumbnailPicker');
        getActionRegistry().get('openThumbnailPicker')?.handler(undefined);
        closeMenu();
      },
    } satisfies MenuEntry,
  ];

  // ── Assemble with section labels and separators ─────────────────────
  const items: MenuEntry[] = [
    ...clipboardItems,
    ...arrangementItems,
    ...clippingItems,
    { id: 'ctx-sep-tools', separator: true as const } satisfies MenuEntry,
    ...toolsItems,
    { id: 'ctx-sep-export', separator: true as const } satisfies MenuEntry,
    {
      id: 'ctx-selectall',
      label: 'Select All',
      icon: 'MousePointer2' as const,
      onAction: () => {
        record('selectAll');
        getActionRegistry().get('selectAll')?.handler(undefined);
        closeMenu();
      },
    } satisfies MenuEntry,
    ...exportItems,
  ];
  return items;
}
