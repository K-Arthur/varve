/**
 * ContextAwareShortcuts — compact, modular toolbar widget for the top navigation bar.
 *
 * Dynamically resolves and displays context-sensitive shortcuts that adjust
 * based on selected layers (Image, Text, Path/Vector, Frame, Multi-selection, or Canvas).
 *
 * Keyboard shortcuts are rendered as instrument-grade micro-pills (<kbd>) with
 * action labels that can also be clicked to dispatch the action.
 */

import type { SceneNode } from '@varve/scene';
import { isExportRegion, isImageShape } from '@varve/scene';
import { Tooltip } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../context';
import './ContextAwareShortcuts.css';

interface ContextShortcut {
  id: string;
  label: string;
  key: string;
  tooltip: string;
  action: () => void;
}

export function ContextAwareShortcuts() {
  const { state, setTool, groupSelected, ungroupSelected } = useEditor();
  const sel = state.selection;
  const doc = state.document;

  const selectedNodes: SceneNode[] = useMemo(() => {
    return sel.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
  }, [sel, doc]);

  const shortcuts: ContextShortcut[] = useMemo(() => {
    if (selectedNodes.length === 0) {
      return [
        {
          id: 'tool-frame',
          label: 'Frame',
          key: 'F',
          tooltip: 'Create frame (F)',
          action: () => setTool('frame'),
        },
        {
          id: 'tool-rect',
          label: 'Rect',
          key: 'R',
          tooltip: 'Draw rectangle (R)',
          action: () => setTool('rect'),
        },
        {
          id: 'tool-text',
          label: 'Text',
          key: 'T',
          tooltip: 'Add text layer (T)',
          action: () => setTool('text'),
        },
      ];
    }

    if (selectedNodes.length === 1) {
      const node = selectedNodes[0]!;
      if (node.kind === 'shape' && isImageShape(node)) {
        return [
          {
            id: 'crop',
            label: 'Crop',
            key: 'C',
            tooltip: 'Enter crop mode (C)',
            action: () => setTool('crop'),
          },
          {
            id: 'remove-bg',
            label: 'Remove BG',
            key: 'B',
            tooltip: 'Remove background using on-device ML (B)',
            action: () => setTool('removeBg'),
          },
          {
            id: 'trace',
            label: 'Vectorize',
            key: 'Alt+V',
            tooltip: 'Convert raster to vector paths (Alt+V)',
            action: () => setTool('vectorize'),
          },
        ];
      }

      if (node.kind === 'text') {
        return [
          {
            id: 'edit-text',
            label: 'Edit',
            key: '↵',
            tooltip: 'Edit text content (Enter)',
            action: () => setTool('text'),
          },
          {
            id: 'bold',
            label: 'Bold',
            key: 'Ctrl+B',
            tooltip: 'Toggle bold weight (Ctrl+B)',
            action: () => {},
          },
        ];
      }

      if (node.kind === 'shape') {
        return [
          {
            id: 'edit-nodes',
            label: 'Edit Nodes',
            key: '↵',
            tooltip: 'Edit vector anchor points (Enter)',
            action: () => setTool('nodeEdit'),
          },
          {
            id: 'duplicate',
            label: 'Duplicate',
            key: 'Ctrl+D',
            tooltip: 'Duplicate layer (Ctrl+D)',
            action: () => {},
          },
        ];
      }

      if (node.kind === 'frame' || isExportRegion(node)) {
        return [
          {
            id: 'auto-layout',
            label: 'Auto Layout',
            key: 'Shift+A',
            tooltip: 'Apply auto-layout to frame (Shift+A)',
            action: () => {},
          },
          {
            id: 'ungroup',
            label: 'Ungroup',
            key: 'Ctrl+Shift+G',
            tooltip: 'Ungroup children (Ctrl+Shift+G)',
            action: () => ungroupSelected(),
          },
        ];
      }

      if (node.kind === 'group') {
        return [
          {
            id: 'ungroup',
            label: 'Ungroup',
            key: 'Ctrl+Shift+G',
            tooltip: 'Ungroup elements (Ctrl+Shift+G)',
            action: () => ungroupSelected(),
          },
          {
            id: 'enter-group',
            label: 'Enter',
            key: '↵',
            tooltip: 'Select first child (Enter)',
            action: () => {},
          },
        ];
      }
    }

    // Multi-selection
    return [
      {
        id: 'group',
        label: 'Group',
        key: 'Ctrl+G',
        tooltip: 'Group selected layers (Ctrl+G)',
        action: () => groupSelected(),
      },
      {
        id: 'boolean-union',
        label: 'Union',
        key: 'Ctrl+Alt+U',
        tooltip: 'Combine vector shapes (Ctrl+Alt+U)',
        action: () => setTool('booleanUnion'),
      },
      {
        id: 'align-center',
        label: 'Align',
        key: 'Alt+H',
        tooltip: 'Align centers horizontally (Alt+H)',
        action: () => {},
      },
    ];
  }, [selectedNodes, setTool, groupSelected, ungroupSelected]);

  return (
    <nav
      className="context-aware-shortcuts"
      aria-label="Contextual layer shortcuts"
      data-selection-count={selectedNodes.length}
    >
      <span className="context-aware-shortcuts__cluster" role="toolbar" aria-label="Layer actions">
        {shortcuts.map((s) => (
          <Tooltip key={s.id} label={s.tooltip}>
            <button
              type="button"
              className="context-aware-shortcuts__btn"
              onClick={s.action}
              aria-label={s.tooltip}
            >
              <span className="context-aware-shortcuts__label">{s.label}</span>
              <kbd className="context-aware-shortcuts__kbd">{s.key}</kbd>
            </button>
          </Tooltip>
        ))}
      </span>
    </nav>
  );
}
