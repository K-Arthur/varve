import { exportDocumentToSvg } from '@strata/codegen';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorContextValue, ToolId } from '../context';
import { bindingMatchesEvent, SHORTCUT_DEFS } from './ShortcutManager';

export function useShortcuts(editor: EditorContextValue): {
  paletteOpen: boolean;
  closePalette: () => void;
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
          if (nodes.length > 0) {
            const first = nodes[0];
            if (first) e.setSelection(first.id);
          }
        };
      case 'group':
        return null;
      case 'shortcutPalette':
        return () => setPaletteOpen((p) => !p);
      case 'toolSelect':
        return () => e.setTool('select' as ToolId);
      case 'toolRect':
        return () => e.setTool('rect' as ToolId);
      case 'toolEllipse':
        return () => e.setTool('ellipse' as ToolId);
      case 'toolText':
        return () => e.setTool('text' as ToolId);
      case 'toolHand':
        return () => e.setTool('hand' as ToolId);
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

      for (const [id, def] of Object.entries(SHORTCUT_DEFS)) {
        if (!bindingMatchesEvent(e, def.binding)) continue;
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

  return { paletteOpen, closePalette: () => setPaletteOpen(false) };
}
