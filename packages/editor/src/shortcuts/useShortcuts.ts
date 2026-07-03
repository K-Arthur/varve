import { exportDocumentToSvg } from '@strata/codegen';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorContextValue, ToolId } from '../context';
import { bindingMatchesEvent, getEffectiveBinding, SHORTCUT_DEFS } from './ShortcutManager';

export function useShortcuts(
  editor: EditorContextValue,
  onBackToHome?: () => void,
  enabled = true,
): {
  paletteOpen: boolean;
  closePalette: () => void;
  openPalette: () => void;
  quickActionsOpen: boolean;
  setQuickActionsOpen: (open: boolean) => void;
} {
  const ref = useRef(editor);
  ref.current = editor;

  const onBackToHomeRef = useRef(onBackToHome);
  onBackToHomeRef.current = onBackToHome;

  // While the editor is hidden (home screen shown over a kept-alive shell),
  // its global shortcuts must not fire.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  const getHandler = useCallback((id: string): (() => void) | null => {
    const e = ref.current;
    switch (id) {
      case 'undo':
        return () => e.undo();
      case 'redo':
        return () => e.redo();
      case 'delete':
        return () => e.removeSelected();
      case 'copy':
        return () => e.copySelected();
      case 'cut':
        return () => e.cutSelected();
      case 'paste':
        return () => e.paste();
      case 'duplicate':
        return () => e.duplicateSelected();
      case 'flipH':
        return () => e.setSelectedFlipH();
      case 'flipV':
        return () => e.setSelectedFlipV();
      case 'newDocument':
        return () => e.newDocument();
      case 'open':
        return () => {
          const input = document.querySelector<HTMLInputElement>('#file-open-input');
          input?.click();
        };
      case 'save':
        return () => {
          e.save();
        };
      case 'saveAs':
        return () => {
          e.saveAs();
        };
      case 'exportSvg':
        return () => {
          const svg = exportDocumentToSvg(e.state.document);
          const blob = new Blob([svg], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${e.state.document.name || 'untitled'}.svg`;
          a.click();
          URL.revokeObjectURL(url);
        };
      case 'zoomReset':
        return () => e.zoomTo(1);
      case 'zoomIn':
        return () => e.zoomIn();
      case 'zoomOut':
        return () => e.zoomOut();
      case 'fitAll':
        return () => e.fitAll();
      case 'fitSelection':
        return () => e.revealSelection({ fit: true });
      case 'zoom50':
        return () => e.zoomTo(0.5);
      case 'zoom75':
        return () => e.zoomTo(0.75);
      case 'zoom100':
        return () => e.zoomTo(1);
      case 'zoom150':
        return () => e.zoomTo(1.5);
      case 'zoom200':
        return () => e.zoomTo(2);
      case 'zoom400':
        return () => e.zoomTo(4);
      case 'selectAll':
        return () => {
          const nodes = e.rootNodes();
          if (nodes.length === 0) return;
          e.setSelection(nodes[0]?.id ?? null);
          for (let i = 1; i < nodes.length; i++) {
            const n = nodes[i];
            if (n) e.toggleSelection(n.id, true);
          }
          e.announceSelection(nodes);
        };
      case 'tabNew':
        return () => e.newTab();
      case 'tabClose':
        return () => {
          if (!e.closeTab(e.state.activeId)) {
            const sess = e.state.sessions.find((s) => s.id === e.state.activeId);
            if (confirm(`Close "${sess?.name ?? 'Untitled'}"? Unsaved changes will be lost.`)) {
              e.closeTab(e.state.activeId, true);
            }
          }
        };
      case 'tabNext': {
        return () => {
          const { sessions, activeId } = e.state;
          const idx = sessions.findIndex((s) => s.id === activeId);
          const next = sessions[(idx + 1) % sessions.length];
          if (next) e.switchTab(next.id);
        };
      }
      case 'tabPrev': {
        return () => {
          const { sessions, activeId } = e.state;
          const idx = sessions.findIndex((s) => s.id === activeId);
          const prev = sessions[(idx - 1 + sessions.length) % sessions.length];
          if (prev) e.switchTab(prev.id);
        };
      }
      case 'group':
        return () => e.groupSelected();
      case 'ungroup':
        return () => e.ungroupSelected();
      case 'bringFront':
        return () => e.arrangeSelected('front');
      case 'sendBack':
        return () => e.arrangeSelected('back');
      case 'bringForward':
        return () => e.arrangeSelected('forward');
      case 'sendBackward':
        return () => e.arrangeSelected('backward');
      case 'alignLeft':
        return () => e.alignSelected('left');
      case 'alignCenterH':
        return () => e.alignSelected('centerH');
      case 'alignRight':
        return () => e.alignSelected('right');
      case 'alignTop':
        return () => e.alignSelected('top');
      case 'alignCenterV':
        return () => e.alignSelected('centerV');
      case 'alignBottom':
        return () => e.alignSelected('bottom');
      case 'distributeHorizontal':
        return () => e.distributeSelected('horizontal');
      case 'distributeVertical':
        return () => e.distributeSelected('vertical');
      case 'bindField':
        return () => {
          if (e.focusedField) {
            e.setBindingField(e.focusedField);
          }
        };
      case 'shortcutPalette':
        return () => setPaletteOpen((p) => !p);
      case 'toolSelect':
        return () => e.setTool('select' as ToolId);
      case 'toolFrame':
        return () => e.setTool('frame' as ToolId);
      case 'toolRect':
        return () => e.setTool('rect' as ToolId);
      case 'toolEllipse':
        return () => e.setTool('ellipse' as ToolId);
      case 'toolLine':
        return () => e.setTool('line' as ToolId);
      case 'toolPen':
        return () => e.setTool('pen' as ToolId);
      case 'toolText':
        return () => e.setTool('text' as ToolId);
      case 'toolHand':
        return () => e.setTool('hand' as ToolId);
      case 'toolZoom':
        return () => e.setTool('zoom' as ToolId);
      case 'toolInspect':
        return () => e.setTool('inspect' as ToolId);
      case 'toggleSnap':
        return () => e.setSnapEnabled(!e.state.snapEnabled);
      case 'toggleLeftPanel':
        return () => e.toggleLeftPanel();
      case 'toggleRightPanel':
        return () => e.toggleRightPanel();
      case 'booleanUnion':
        return () => e.booleanOp('union');
      case 'booleanSubtract':
        return () => e.booleanOp('subtract');
      case 'booleanIntersect':
        return () => e.booleanOp('intersect');
      case 'booleanExclude':
        return () => e.booleanOp('exclude');
      case 'quickActions':
        return () => setQuickActionsOpen((p) => !p);
      case 'present':
        return () => {
          if (e.state.prototypeMode) {
            e.stopPresentation();
          } else {
            e.startPresentation();
          }
        };
      case 'home':
        return () => onBackToHomeRef.current?.();
      default:
        return null;
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      // The canvas keydown handler (zoom presets, tool keys, Space-pan) calls
      // preventDefault on keys it consumes — don't double-handle them here.
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement).tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (e.target as HTMLElement).isContentEditable
      )
        return;
      if ((e.target as HTMLElement).closest?.('[data-shortcut-ignore]')) return;

      for (const [id, _def] of Object.entries(SHORTCUT_DEFS)) {
        const binding = getEffectiveBinding(id);
        if (!binding?.key || !bindingMatchesEvent(e, binding)) continue;
        e.preventDefault();
        getHandler(id)?.();
        return;
      }

      if (
        !e.repeat &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'Delete' || e.key === 'Del')
      ) {
        e.preventDefault();
        ref.current.removeSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [getHandler]);

  return {
    paletteOpen,
    closePalette: () => setPaletteOpen(false),
    openPalette: () => setPaletteOpen(true),
    quickActionsOpen,
    setQuickActionsOpen,
  };
}
