/**
 * Canvas right-click context menu builder.
 *
 * Extracted from Shell.tsx (hub-file line/complexity budget): the menu is a
 * pure function of the editor context + close callback. Selection facts are
 * computed locally so hub files do not import extra scene predicates.
 */
import { isImageShape } from '@varve/scene';
import type { MenuEntry } from '@varve/ui';
import { getActionRegistry } from '../actions/ActionRegistry';
import type { EditorContextValue } from '../context';

interface CanvasContextMenuOptions {
  editor: EditorContextValue;
  closeMenu: () => void;
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
  const nodeCount = Object.keys(editor.state.document.nodes).length;
  const hasNodes = nodeCount >= 1;
  const hasMultipleNodes = nodeCount >= 2;
  const record = (actionId: string) => editor.recordAction(`menu:${actionId}`);
  const items: MenuEntry[] = [
    ...(hasSelection
      ? [
          {
            id: 'ctx-cut',
            label: 'Cut',
            onAction: () => {
              record('cut');
              editor.cutSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
          {
            id: 'ctx-copy',
            label: 'Copy',
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
    ...(hasSelection
      ? [
          { id: 'ctx-sep1', separator: true as const } satisfies MenuEntry,
          {
            id: 'ctx-dup',
            label: 'Duplicate',
            onAction: () => {
              record('duplicate');
              editor.duplicateSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
          {
            id: 'ctx-del',
            label: 'Delete',
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
          { id: 'ctx-sep2', separator: true as const } satisfies MenuEntry,
          {
            id: 'ctx-group',
            label: 'Group Selection',
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
          { id: 'ctx-sep3', separator: true as const } satisfies MenuEntry,
          {
            id: 'ctx-ungroup',
            label: 'Ungroup',
            onAction: () => {
              record('ungroup');
              editor.ungroupSelected();
              closeMenu();
            },
          } satisfies MenuEntry,
        ]
      : []),
    ...(hasSelection
      ? (() => {
          // Clipping/masking entries — computed locally to avoid
          // adding imports to this hub file. Mirrors the scene
          // predicates (canBeClipMaskSource, isClippingMaskGroup).
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
          const isMaskContainer =
            single !== undefined &&
            (single.kind === 'group' || single.kind === 'frame' || single.kind === 'adjustment');
          const hasMask = isMaskContainer && single.mask != null;
          const entries: MenuEntry[] = [];
          if (hasMultiple && canClipSource) {
            entries.push({ id: 'ctx-sep-clip1', separator: true as const });
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
            entries.push({ id: 'ctx-sep-clip2', separator: true as const });
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
            entries.push({ id: 'ctx-sep-clip3', separator: true as const });
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
            entries.push({ id: 'ctx-sep-clip4', separator: true as const });
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
              onAction: () => {
                record('removeMask');
                editor.removeMaskFromSelected();
                closeMenu();
              },
            });
          }
          return entries;
        })()
      : []),
    ...(hasSelection
      ? [
          { id: 'ctx-sep-mockups', separator: true as const } satisfies MenuEntry,
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
    { id: 'ctx-sep4', separator: true as const } satisfies MenuEntry,
    {
      id: 'ctx-selectall',
      label: 'Select All',
      onAction: () => {
        record('selectAll');
        getActionRegistry().get('selectAll')?.handler();
        closeMenu();
      },
    } satisfies MenuEntry,
    ...(hasNodes
      ? [
          { id: 'ctx-sep5', separator: true as const } satisfies MenuEntry,
          ...(isSingleImage
            ? [
                {
                  id: 'ctx-vectorize',
                  label: 'Vectorize image…',
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
          ...(isSingleImage || isSingleFrame
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
    // ── File thumbnail ──────────────────────────────────────────────────
    ...(hasSelection
      ? [
          { id: 'ctx-sep-thumb', separator: true as const } satisfies MenuEntry,
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
  return items;
}
