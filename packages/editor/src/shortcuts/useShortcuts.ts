import { exportDocumentToSvg } from '@strata/codegen';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorContextValue, ToolId } from '../context';
import { bindingMatchesEvent, getEffectiveBinding, SHORTCUT_DEFS } from './ShortcutManager';

export function useShortcuts(editor: EditorContextValue): {
  paletteOpen: boolean;
  closePalette: () => void;
  openPalette: () => void;
} {
  const ref = useRef(editor);
  ref.current = editor;

  const [paletteOpen, setPaletteOpen] = useState(false);

  const getHandler = useCallback((id: string): (() => void) | null => {
    const e = ref.current;
    switch (id) {
      case 'undo':
        return () => e.undo();
      case 'redo':
        return () => e.redo();
      case 'delete':
        return () => e.removeSelected();
      case 'newDocument':
        return () => e.newDocument();
      case 'open':
        return () => {
          const input = document.querySelector<HTMLInputElement>('#file-open-input');
          input?.click();
        };
      case 'save':
      case 'saveAs':
        return () => {
          const json = e.serializeDocument();
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${e.state.document.name || 'untitled'}.strata.json`;
          a.click();
          URL.revokeObjectURL(url);
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
        return () => e.setZoom(1);
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
        return null;
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
      default:
        return null;
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  };
}
