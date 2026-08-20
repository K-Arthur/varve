import { useEffect, useRef } from 'react';

/** E4 (2026-08-10): document-level heading label for SR heading navigation. */
export function editorHeadingLabel(
  sessions: { id: string; name: string }[],
  activeId: string | null,
): string {
  const name = sessions.find((s) => s.id === activeId)?.name;
  return name ? `${name} — Varve` : 'Varve editor';
}

type FitEditor = {
  state: { document: { nodes: Record<string, unknown> } };
  fitAll: () => void;
};

/** Fit a newly loaded document once the canvas has a measurable viewport. */
export function useFitOnFirstDocument(editor: FitEditor, enabled: boolean): void {
  const fittedRef = useRef(false);
  const hasNodes = Object.keys(editor.state.document.nodes).length > 0;
  const fitAllRef = useRef(editor.fitAll);
  fitAllRef.current = editor.fitAll;

  useEffect(() => {
    if (!enabled || fittedRef.current || !hasNodes) return;
    let frame = 0;
    let attempts = 0;
    const tryFit = () => {
      const canvas = document.querySelector<HTMLElement>('.editor-canvas');
      if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        fittedRef.current = true;
        fitAllRef.current();
        return;
      }
      if (++attempts > 300) return;
      frame = requestAnimationFrame(tryFit);
    };
    frame = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(frame);
  }, [enabled, hasNodes]);
}

/**
 * Shell hook barrel — consolidates Shell's workspace hook imports.
 *
 * Shell is at its import ceiling (audit-health); grouping the workspace
 * hooks behind one barrel keeps the statement count down without
 * changing behavior.
 */

export { useDetachedPanels } from './useDetachedPanels';
export { useEffectiveWorkspaceConfig } from './useWorkspaceConfig';
export { useWorkspacePanelWidths } from './useWorkspacePanelWidths';
